// The team on a server (spec 014, M2): who's in it, invites (a link, a day, the role fixed when made), roles, and
// removing someone, which cuts their access at once. Admin actions need a recent confirmation: a session begun in the
// last 5 minutes (a passkey or password + code just now), else 403 "step_up" and the web asks again. Better Auth
// keeps the members and invitations and checks its own rules; Zorel adds the step-up, the last owner, removing the
// person's sessions and whatever else they held (devices, routines: onRemoved).
import { Effect, Layer } from "effect"
import { HttpRouter, type HttpServerRequest, HttpServerResponse } from "effect/http"
import { auditRaw, personOf, type Role, roleOf, type SignedIn, STEP_UP_MS, teamId, type ZorelAuth } from "./auth.ts"
import type { ServerMode } from "./server-mode.ts"

const ROLES = new Set<Role>(["owner", "admin", "member"])
const reply = (body: unknown, status = 200) => HttpServerResponse.jsonUnsafe(body, { status })
const headersOf = (req: HttpServerRequest.HttpServerRequest) => new Headers(req.headers as Record<string, string>)
const bodyOf = (req: HttpServerRequest.HttpServerRequest) => Effect.orElseSucceed(req.json, () => ({})) as Effect.Effect<Record<string, unknown>>
const owners = (a: ZorelAuth) => (a.db.query("SELECT COUNT(*) AS n FROM auth_members WHERE role LIKE '%owner%'").get() as { n: number }).n

export function teamRoutes(mode: ServerMode, a: ZorelAuth, onRemoved: (userId: string) => Promise<void> = async () => {}) {
  const link = (id: string) => `${mode.publicUrl.origin}/invite/${id}`
  // The signed-in person, else 401; an admin action also needs an admin and a recent confirmation.
  const who = (req: HttpServerRequest.HttpServerRequest, admin: boolean) =>
    Effect.promise(() => personOf(a, headersOf(req))).pipe(
      Effect.map((p): SignedIn | { error: number; code: string } => {
        if (!p) return { error: 401, code: "signed_out" }
        if (!admin) return p
        if (p.role === "member") return { error: 403, code: "admins_only" }
        if (Date.now() - p.sessionAt > STEP_UP_MS) return { error: 403, code: "step_up" }
        return p
      })
    )
  const log = (actor: SignedIn, action: string, target: { type: string; id: string; name: string }) => auditRaw(a.db, { action, actorId: actor.id, target })

  const Team = HttpRouter.add("GET", "/api/team", (req) =>
    Effect.gen(function* () {
      const me = yield* who(req, false)
      if ("error" in me) return reply({ error: me.code }, me.error)
      const members = a.db.query("SELECT m.userId AS userId, m.role AS role, m.createdAt AS since, u.name AS name, u.email AS email FROM auth_members m JOIN auth_users u ON u.id = m.userId ORDER BY m.createdAt").all()
      const invitations =
        me.role === "member"
          ? []
          : (a.db.query("SELECT id, email, role, expiresAt FROM auth_invitations WHERE status = 'pending' AND expiresAt > ? ORDER BY expiresAt").all(Date.now()) as Array<{ id: string }>).map((i) => ({ ...i, link: link(i.id) }))
      return reply({ me: { id: me.id, role: me.role, fresh: Date.now() - me.sessionAt <= STEP_UP_MS }, members, invitations })
    })
  )

  const Invite = HttpRouter.add("POST", "/api/team/invitations", (req) =>
    Effect.gen(function* () {
      const me = yield* who(req, true)
      if ("error" in me) return reply({ error: me.code }, me.error)
      const body = yield* bodyOf(req)
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : ""
      const role = body.role as Role
      if (!email.includes("@") || email.length > 254 || !ROLES.has(role)) return reply({ error: "invalid" }, 400)
      if (role === "owner" && me.role !== "owner") return reply({ error: "owners_only" }, 403) // only an owner makes owners
      const made = yield* Effect.tryPromise(() => a.auth.api.createInvitation({ headers: headersOf(req), body: { email, role, organizationId: teamId(a)! } })).pipe(Effect.option)
      if (made._tag === "None") return reply({ error: "invite_failed" }, 400)
      log(me, "team.invited", { type: "invitation", id: made.value.id, name: `${email} (${role})` })
      return reply({ id: made.value.id, link: link(made.value.id), expiresAt: made.value.expiresAt })
    })
  )

  const CancelInvite = HttpRouter.add("DELETE", "/api/team/invitations/:id", (req) =>
    Effect.gen(function* () {
      const me = yield* who(req, true)
      if ("error" in me) return reply({ error: me.code }, me.error)
      const id = new URL(req.url, "http://x").pathname.split("/").at(-1)!
      yield* Effect.tryPromise(() => a.auth.api.cancelInvitation({ headers: headersOf(req), body: { invitationId: id } })).pipe(Effect.ignore)
      log(me, "team.invite_cancelled", { type: "invitation", id, name: id })
      return reply({ ok: true })
    })
  )

  const ChangeRole = HttpRouter.add("PATCH", "/api/team/members/:userId", (req) =>
    Effect.gen(function* () {
      const me = yield* who(req, true)
      if ("error" in me) return reply({ error: me.code }, me.error)
      const userId = new URL(req.url, "http://x").pathname.split("/").at(-1)!
      const role = (yield* bodyOf(req)).role as Role
      const current = roleOf(a, userId)
      if (!current || !ROLES.has(role)) return reply({ error: "invalid" }, 400)
      if ((role === "owner" || current === "owner") && me.role !== "owner") return reply({ error: "owners_only" }, 403)
      if (current === "owner" && role !== "owner" && owners(a) <= 1) return reply({ error: "last_owner" }, 409) // always one owner
      a.db.query("UPDATE auth_members SET role = ? WHERE userId = ?").run(role, userId)
      log(me, "team.role_changed", { type: "person", id: userId, name: `${current} → ${role}` })
      return reply({ ok: true })
    })
  )

  // Removing someone: their membership, every session (open pages and devices sign out at once), and onRemoved.
  const Remove = HttpRouter.add("DELETE", "/api/team/members/:userId", (req) =>
    Effect.gen(function* () {
      const me = yield* who(req, true)
      if ("error" in me) return reply({ error: me.code }, me.error)
      const userId = new URL(req.url, "http://x").pathname.split("/").at(-1)!
      const current = roleOf(a, userId)
      if (!current) return reply({ error: "not_found" }, 404)
      if (current === "owner" && me.role !== "owner") return reply({ error: "owners_only" }, 403)
      if (current === "owner" && owners(a) <= 1) return reply({ error: "last_owner" }, 409)
      a.db.query("DELETE FROM auth_members WHERE userId = ?").run(userId)
      a.db.query("DELETE FROM auth_sessions WHERE userId = ?").run(userId)
      yield* Effect.promise(() => onRemoved(userId).catch((e: unknown) => console.warn("removal cleanup failed", e)))
      log(me, "team.member_removed", { type: "person", id: userId, name: userId })
      return reply({ ok: true })
    })
  )

  // Open: what an invite link is for (the e-mail it names, the role, whether it still works).
  const pending = (id: string) =>
    a.db.query("SELECT id, email, role, expiresAt, status FROM auth_invitations WHERE id = ?").get(id) as { id: string; email: string; role: Role; expiresAt: number; status: string } | null
  const valid = (i: ReturnType<typeof pending>) => !!i && i.status === "pending" && new Date(i.expiresAt).getTime() > Date.now()

  const InviteInfo = HttpRouter.add("GET", "/api/invite/:id", (req) => {
    const i = pending(new URL(req.url, "http://x").pathname.split("/").at(-1)!)
    return Effect.succeed(valid(i) ? reply({ email: i!.email, role: i!.role }) : reply({ error: "invite_invalid" }, 404))
  })

  // Open: joining through an invite (name and password; the e-mail is the invite's), then signed in.
  const Join = HttpRouter.add("POST", "/api/invite/:id", (req) =>
    Effect.gen(function* () {
      const i = pending(new URL(req.url, "http://x").pathname.split("/").at(-1)!)
      if (!valid(i)) return reply({ error: "invite_invalid" }, 404)
      const body = yield* bodyOf(req)
      const name = typeof body.name === "string" ? body.name.trim() : ""
      const password = typeof body.password === "string" ? body.password : ""
      if (!name || name.length > 80 || password.length < 10 || password.length > 200) return reply({ error: "invalid" }, 400)
      const made = yield* Effect.tryPromise(() => a.auth.api.signUpEmail({ body: { name, email: i!.email, password } })).pipe(Effect.option)
      if (made._tag === "None") return reply({ error: "account_exists" }, 409)
      yield* Effect.tryPromise(() => a.auth.api.addMember({ body: { userId: made.value.user.id, role: i!.role, organizationId: teamId(a)! } })).pipe(Effect.orDie)
      a.db.query("UPDATE auth_invitations SET status = 'accepted' WHERE id = ?").run(i!.id) // the link works once
      auditRaw(a.db, { action: "team.joined", actorId: made.value.user.id, target: { type: "invitation", id: i!.id, name: `${i!.email} (${i!.role})` } })
      const signedIn = yield* Effect.tryPromise(() => a.auth.api.signInEmail({ body: { email: i!.email, password }, asResponse: true })).pipe(Effect.orDie)
      return HttpServerResponse.fromWeb(signedIn)
    })
  )

  // Who's in a project (admins manage it): members see its chats, files and agents; owners and admins see every project.
  const projectOf = (req: HttpServerRequest.HttpServerRequest) => new URL(req.url, "http://x").pathname.split("/")[4]!
  const ProjectMembers = HttpRouter.add("GET", "/api/team/projects/:id/members", (req) =>
    Effect.gen(function* () {
      const me = yield* who(req, false)
      if ("error" in me) return reply({ error: me.code }, me.error)
      return reply({ members: (a.db.query("SELECT person_id AS personId FROM project_members WHERE project_id = ?").all(projectOf(req)) as Array<{ personId: string }>).map((m) => m.personId) })
    })
  )
  const SetProjectMember = HttpRouter.add("PUT", "/api/team/projects/:id/members", (req) =>
    Effect.gen(function* () {
      const me = yield* who(req, false)
      if ("error" in me) return reply({ error: me.code }, me.error)
      if (me.role === "member") return reply({ error: "admins_only" }, 403)
      const body = yield* bodyOf(req)
      const personId = typeof body.personId === "string" ? body.personId : ""
      if (!roleOf(a, personId)) return reply({ error: "invalid" }, 400)
      const project = projectOf(req)
      if (body.member === true) a.db.query("INSERT OR IGNORE INTO project_members (project_id, person_id, added_at) VALUES (?, ?, ?)").run(project, personId, Date.now())
      else a.db.query("DELETE FROM project_members WHERE project_id = ? AND person_id = ?").run(project, personId)
      log(me, body.member === true ? "team.project_member_added" : "team.project_member_removed", { type: "project", id: project, name: personId })
      return reply({ ok: true })
    })
  )

  return Layer.mergeAll(Team, Invite, CancelInvite, ChangeRole, Remove, InviteInfo, Join, ProjectMembers, SetProjectMember)
}
