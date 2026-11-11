// Identity in server mode (spec 014, research R1–R4): Better Auth on the same SQLite file through its own connection,
// its tables prefixed auth_, telemetry off, mounted at /api/auth/*. It owns accounts, passkeys, password + TOTP,
// sessions, rate limits and the team (one organization, roles owner / admin / member). Zorel owns the first owner's
// setup token, who a request is (Actor), and everything about resources.
import { Database } from "bun:sqlite"
import { randomBytes, timingSafeEqual } from "node:crypto"
import { passkey } from "@better-auth/passkey"
import { betterAuth } from "better-auth"
import { createAuthMiddleware } from "better-auth/api"
import { getMigrations } from "better-auth/db/migration"
import { bearer, organization, twoFactor } from "better-auth/plugins"
import type { ServerMode } from "./server-mode.ts"

export type Role = "owner" | "admin" | "member"
export interface Person {
  readonly id: string
  readonly role: Role
}
// A person and the session the request came with: when it began says whether an admin action may go ahead (step-up).
export interface SignedIn extends Person {
  readonly name: string
  readonly sessionAt: number
}
export const STEP_UP_MS = 5 * 60 * 1000

// Audit rows written straight to Zorel's table (sign-ins and the team happen outside Zorel's Effect services).
export function auditRaw(db: Database, e: { action: string; actorId: string; target: { type: string; id: string; name: string }; outcome?: "success" | "failure" | "denied"; reason?: string }) {
  db.query("INSERT INTO audit_events (id, at, action, actor_type, actor_id, target_type, target_id, target_name, outcome, reason, changes) VALUES (?, ?, ?, 'user', ?, ?, ?, ?, ?, ?, '[]')").run(
    crypto.randomUUID(),
    Date.now(),
    e.action,
    e.actorId,
    e.target.type,
    e.target.id,
    e.target.name,
    e.outcome ?? "success",
    e.reason ?? null
  )
}

export function makeAuth(o: { dbPath: string; secret: string; mode: ServerMode }) {
  const db = new Database(o.dbPath)
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA busy_timeout = 5000") // Zorel's own connection writes the same file
  const origin = o.mode.publicUrl.origin
  // Sign-ins and failed attempts go to the activity log (FR-012, FR-018); a failure names the e-mail tried, never the password.
  const log = (action: string, actorId: string, target: { type: string; id: string; name: string }, outcome: "success" | "failure" = "success") => {
    try {
      auditRaw(db, { action, actorId, target, outcome })
    } catch (e) {
      console.warn("audit write failed", e) // the log must not stop a sign-in
    }
  }
  const auth = betterAuth({
    database: db,
    baseURL: origin,
    basePath: "/api/auth",
    secret: o.secret,
    trustedOrigins: [origin],
    telemetry: { enabled: false },
    // Accounts are made by Zorel (the setup and invite pages call auth.api): the public sign-up route is closed by the
    // guard. The e-mail is only the sign-in name: nothing is ever sent to it.
    emailAndPassword: { enabled: true, minPasswordLength: 10 },
    user: { modelName: "auth_users" },
    session: { modelName: "auth_sessions", expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24, freshAge: 60 * 5 },
    account: { modelName: "auth_accounts" },
    verification: { modelName: "auth_verifications" },
    rateLimit: { enabled: true, window: 60, max: 60, customRules: { "/sign-in/*": { window: 60, max: 10 }, "/two-factor/*": { window: 60, max: 10 } } },
    databaseHooks: {
      session: { create: { after: async (s) => log("auth.signed_in", s.userId, { type: "session", id: s.id, name: s.userAgent ?? "" }) } }
    },
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        const returned = ctx.context.returned as { status?: unknown; statusCode?: number } | undefined
        const failed = returned instanceof Error || (typeof returned?.statusCode === "number" && returned.statusCode >= 400)
        if (failed && ctx.path.startsWith("/sign-in")) log("auth.sign_in_failed", "anonymous", { type: "account", id: String((ctx.body as { email?: string } | undefined)?.email ?? ""), name: ctx.path }, "failure")
      })
    },
    advanced: {
      useSecureCookies: o.mode.publicUrl.protocol === "https:",
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"], trustedProxies: [...o.mode.trustedProxies] }
    },
    plugins: [
      passkey({ rpID: o.mode.publicUrl.hostname, rpName: "Zorel", origin, schema: { passkey: { modelName: "auth_passkeys" } } }),
      twoFactor({ issuer: "Zorel", schema: { twoFactor: { modelName: "auth_two_factors" } } }),
      organization({
        allowUserToCreateOrganization: false, // one team per server, made with its first owner
        invitationExpiresIn: 24 * 60 * 60, // an invite link lasts a day (FR-005)
        cancelPendingInvitationsOnReInvite: true,
        schema: { organization: { modelName: "auth_organizations" }, member: { modelName: "auth_members" }, invitation: { modelName: "auth_invitations" } }
      }),
      bearer() // paired devices (spec 016) send their session as a bearer token
    ]
  })
  return { auth, db }
}
export type ZorelAuth = ReturnType<typeof makeAuth>

// Its own tables, created or updated at start (after Zorel's migrations; Zorel never writes them).
export const migrateAuth = async (a: ZorelAuth) => (await getMigrations(a.auth.options)).runMigrations()

// Who a request is: its session (cookie, or a device's bearer) and their role in the team; none when signed out or no
// longer a member (removed people keep no access even if a session survived).
export async function personOf(a: ZorelAuth, headers: Headers): Promise<SignedIn | undefined> {
  const session = await a.auth.api.getSession({ headers }).catch(() => null)
  if (!session) return undefined
  const role = roleOf(a, session.user.id)
  return role ? { id: session.user.id, role, name: session.user.name, sessionAt: new Date(session.session.createdAt).getTime() } : undefined
}
export function roleOf(a: ZorelAuth, userId: string): Role | undefined {
  const row = a.db.query("SELECT role FROM auth_members WHERE userId = ? LIMIT 1").get(userId) as { role: string } | null
  const role = row?.role.split(",")[0]
  return role === "owner" || role === "admin" || role === "member" ? role : undefined
}
export const teamId = (a: ZorelAuth) => (a.db.query("SELECT id FROM auth_organizations LIMIT 1").get() as { id: string } | null)?.id

export const hasOwner = (a: ZorelAuth) => !!a.db.query("SELECT 1 FROM auth_members WHERE role LIKE '%owner%' LIMIT 1").get()

// The first owner's setup: a one-time token printed on the console while the server has no owner, valid 1 hour.
const SETUP_MS = 60 * 60 * 1000
export function setupToken(now = Date.now()) {
  let token: string | undefined = randomBytes(24).toString("base64url")
  const until = now + SETUP_MS
  return {
    value: token,
    // True once, for the right token before it expires; the token is gone afterwards either way it was used.
    use(given: string, at = Date.now()) {
      if (!token || at > until || given.length !== token.length || !timingSafeEqual(Buffer.from(given), Buffer.from(token))) return false
      token = undefined
      return true
    }
  }
}

// Makes the owner and the team, then signs the owner in (the response carries the session cookie).
export async function createOwner(a: ZorelAuth, input: { name: string; email: string; password: string }): Promise<Response> {
  const made = await a.auth.api.signUpEmail({ body: input })
  await a.auth.api.createOrganization({ body: { name: "Team", slug: "team", userId: made.user.id } })
  return a.auth.api.signInEmail({ body: { email: input.email, password: input.password }, asResponse: true })
}
