// Server mode's front door (spec 014): the guard every request passes, Better Auth's routes, and the first owner's
// setup. Locally none of this is loaded (main.ts keeps LocalOnly and the per-launch secret).
import type { ServerInfo } from "@zorel/contracts/routes"
import { Effect, Layer } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { Actor } from "./access.ts"
import { createOwner, hasOwner, personOf, type setupToken, STEP_UP_MS, type ZorelAuth } from "./auth.ts"
import type { ServerMode } from "./server-mode.ts"
import { teamRoutes } from "./team-routes.ts"
import { deviceRoutes, type ServerIdentity } from "./devices.ts"
import { mayReach } from "./visibility.ts"

const SAFE = new Set(["GET", "HEAD", "OPTIONS"])
// Open without a session: the app's files, Better Auth (sign-in, passkeys), the setup, OAuth returns (state-bound),
// routine webhooks (token-bound) and whether this is a server.
export const openPath = (path: string) =>
  (!path.startsWith("/api/") && path !== "/rpc") || path.startsWith("/api/auth/") || path.startsWith("/api/setup") || path === "/api/server" || path.startsWith("/api/invite/") || signedByDevice(path) || path === "/api/oauth/callback" || path.startsWith("/api/hooks/")
const deny = (status: number, error: string) => HttpServerResponse.jsonUnsafe({ error }, { status })

// The team's settings (FR-006): admins only. Reading: the activity log, the keys, an export. Changing: AI accounts,
// keys, connectors, the computer apps program, CLIs, storage, preferences, skills found on this server, channels,
// pausing everything, importing. Of those, the ones that hand out access also need a recent confirmation (FR-007).
// The server machine itself (its processes, folders, desktop, spending) is for admins: a member sees the team's work.
const ADMIN_READ = ["/api/audit", "/api/keys", "/api/workspace/export", "/api/processes", "/api/folders", "/api/desktop", "/api/usage", "/api/storage", "/api/cli"]
const ADMIN_WRITE = ["/api/installer", "/api/accounts", "/api/keys", "/api/mcp", "/api/desktop", "/api/cli/", "/api/storage", "/api/preferences", "/api/skills/files", "/api/channels/", "/api/pause", "/api/workspace/", "/api/processes", "/api/computer/erase"]
const FRESH_WRITE = ["/api/installer", "/api/accounts", "/api/keys", "/api/mcp", "/api/channels/", "/api/workspace/import"]
const under = (path: string, prefixes: ReadonlyArray<string>) => prefixes.some((p) => path === p || path.startsWith(p.endsWith("/") ? p : `${p}/`))
// A member may still list a connector's options for a routine step they build (read-only).
const memberMay = (method: string, path: string) => method === "POST" && /^\/api\/mcp\/[^/]+\/options$/.test(path)
export function adminCheck(method: string, path: string, p: { role: string; sessionAt: number }, now = Date.now()): "admins_only" | "step_up" | undefined {
  const write = !SAFE.has(method)
  if (!(write ? under(path, ADMIN_WRITE) : under(path, ADMIN_READ)) || memberMay(method, path)) return undefined
  if (p.role === "member") return "admins_only"
  if (write && under(path, FRESH_WRITE) && now - p.sessionAt > STEP_UP_MS) return "step_up"
  return undefined
}

// A device's pairing and sign-in: no cookie and no Origin (a phone app), checked by the code or the device's signature.
const signedByDevice = (path: string) => path === "/api/devices/claim" || /^\/api\/devices\/[^/]+\/session$/.test(path)

export function serverRoutes(mode: ServerMode, a: ZorelAuth, setup: ReturnType<typeof setupToken>, identity: ServerIdentity, onRemoved?: (userId: string) => Promise<void>) {
  const origin = mode.publicUrl.origin
  // Every request: an Origin, when sent, must be the public URL (other sites can't act or open sockets with the
  // person's cookie); a request that changes something from a browser must say it's same-origin; past the open paths,
  // a signed-in team member, who becomes the request's Actor. Public sign-up is closed: accounts come from the setup
  // and from invites.
  const Guard = HttpRouter.middleware(
    (app) =>
      Effect.gen(function* () {
        const req = yield* HttpServerRequest.HttpServerRequest
        const path = new URL(req.url, "http://x").pathname
        const unsafe = !SAFE.has(req.method)
        if (req.headers.origin && req.headers.origin !== origin) return deny(403, "wrong_origin")
        if (unsafe && req.headers["sec-fetch-site"] && req.headers["sec-fetch-site"] !== "same-origin") return deny(403, "cross_site")
        if (unsafe && !req.headers.origin && !req.headers.authorization && !signedByDevice(path)) return deny(403, "no_origin") // a browser always sends it; devices use a bearer
        if (path.startsWith("/api/auth/sign-up")) return deny(403, "sign_up_closed")
        if (openPath(path)) return yield* app
        const person = yield* Effect.promise(() => personOf(a, new Headers(req.headers as Record<string, string>)))
        if (!person) return deny(401, "signed_out")
        const refused = adminCheck(req.method, path, person)
        if (refused) return deny(403, refused)
        // A chat, project or attachment the person can't see answers as if it didn't exist.
        if (!(yield* mayReach(person, path, new URL(req.url, "http://x").searchParams))) return deny(404, "not_found")
        // A device's session (a bearer token) can read and chat; approving goes through its signed route (devices.ts).
        return yield* app.pipe(Effect.provideService(Actor, { id: person.id, role: person.role, device: !!req.headers.authorization }))
      }),
    { global: true }
  )

  // Better Auth's own routes, as web Requests.
  const AuthRoute = HttpRouter.add("*", "/api/auth/*", (req) =>
    HttpServerRequest.toWeb(req).pipe(
      Effect.flatMap((web) => Effect.promise(() => a.auth.handler(web))),
      Effect.map(HttpServerResponse.fromWeb),
      Effect.orDie
    )
  )

  // Whether this is a server and whether it still needs its first owner (the web app shows the setup or sign-in).
  const ServerInfo = HttpRouter.add("GET", "/api/server", () => Effect.succeed(HttpServerResponse.jsonUnsafe({ mode: "server", needsOwner: !hasOwner(a) } satisfies ServerInfo)))

  // The first owner: with the token printed at start, once.
  const Setup = HttpRouter.add("POST", "/api/setup", (req) =>
    Effect.gen(function* () {
      if (hasOwner(a)) return deny(409, "has_owner")
      const body = (yield* Effect.orDie(req.json)) as Record<string, unknown>
      const str = (k: string, max: number) => (typeof body[k] === "string" && (body[k] as string).trim().length > 0 && (body[k] as string).length <= max ? (body[k] as string).trim() : undefined)
      const token = str("token", 200)
      const name = str("name", 80)
      const email = str("email", 254)
      const password = typeof body.password === "string" && body.password.length >= 10 && body.password.length <= 200 ? body.password : undefined
      if (!token || !name || !email?.includes("@") || !password) return deny(400, "invalid")
      if (!setup.use(token)) return deny(403, "bad_token")
      const res = yield* Effect.tryPromise(() => createOwner(a, { name, email, password })).pipe(Effect.catch((e) => Effect.logError("setup failed", e).pipe(Effect.as(undefined))))
      return res ? HttpServerResponse.fromWeb(res) : deny(500, "setup_failed")
    })
  )

  return Layer.mergeAll(Guard, AuthRoute, ServerInfo, Setup, teamRoutes(mode, a, onRemoved), deviceRoutes(mode, a, identity))
}
