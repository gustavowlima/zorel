// Server mode end to end (spec 014, M1): the real HTTP server with Better Auth on a temp data folder. The setup token
// works once, the owner signs in, protected routes need a session, other origins and public sign-up are refused.
import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BunHttpServer } from "@effect/platform-bun"
import { Cause, Effect, Fiber, Layer, Stream } from "effect"
import { HttpRouter } from "effect/http"
import { Actor } from "./access.ts"
import { Accounts } from "./accounts.ts"
import { Audit } from "./audit.ts"
import { hasOwner, makeAuth, migrateAuth, setupToken, type ZorelAuth } from "./auth.ts"
import { BrowserService } from "./browser.ts"
import { DataDir, DbPath } from "./chat.ts"
import { Store } from "./db.ts"
import { Engines } from "./engines.ts"
import { AppLive } from "./main.ts"
import { Pricing } from "./pricing.ts"
import { Runtime } from "./runtime.ts"
import { Secrets } from "./secrets.ts"
import { serverModeFrom } from "./server-mode.ts"
import { serverRoutes } from "./server-routes.ts"
import { serverIdentity, verifyDevice } from "./devices.ts"
import { Tools } from "./tools.ts"
import { Workspace } from "./workspace.ts"

const port = 4400 + Math.floor(Math.random() * 500)
const base = `http://localhost:${port}`
const mode = serverModeFrom({ ZOREL_SERVER: "1", ZOREL_PUBLIC_URL: base, ZOREL_LISTEN: `127.0.0.1:${port}` })!
const dir = mkdtempSync(join(tmpdir(), "zorel-server-"))
const dbPath = join(dir, "zorel.db")
let a: ZorelAuth
const setup = setupToken()
let stop = () => Promise.resolve()

const NoEngines = Layer.succeed(Engines, { run: () => Stream.empty } as never)

beforeAll(async () => {
  a = makeAuth({ dbPath, secret: "t".repeat(43), mode })
  const identity = await serverIdentity(undefined, async () => {})
  await migrateAuth(a)
  const store = Store.layer(dbPath)
  const secrets = Layer.provideMerge(Secrets.memory(), store)
  const core = Layer.mergeAll(Layer.provideMerge(Layer.mergeAll(NoEngines, Tools.layer), secrets), DataDir.layer(dir), DbPath.layer(dbPath))
  const services = Layer.mergeAll(Layer.provideMerge(Runtime.layer, Layer.provideMerge(Layer.mergeAll(Accounts.layer, Workspace.layer, Pricing.fixed({}), Audit.layer, BrowserService.layer), core)), Actor.local) // as start() does; per request in M3
  const server = AppLive(undefined, serverRoutes(mode, a, setup, identity)).pipe(HttpRouter.serve, Layer.provide(services), Layer.provide(BunHttpServer.layer({ port, hostname: "127.0.0.1" })))
  let failed = ""
  const fiber = Effect.runFork(Layer.launch(server).pipe(Effect.tapCause((c) => Effect.sync(() => (failed = Cause.pretty(c))))))
  stop = () => Effect.runPromise(Fiber.interrupt(fiber)).then(() => undefined)
  for (let i = 0; i < 500 && !failed && !(await fetch(`${base}/api/server`).catch(() => null)); i++) await Bun.sleep(20)
  if (failed) throw new Error(failed)
}, 20_000)
afterAll(() => stop())

const json = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", origin: base, ...headers }, body: JSON.stringify(body) })
const cookieOf = (r: Response) => r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ")

test("server mode: setup once, sign in, protected routes need a session; other origins and public sign-up refused", async () => {
  expect(await (await fetch(`${base}/api/server`)).json()).toEqual({ mode: "server", needsOwner: true })
  // Signed out: the API refuses.
  expect((await fetch(`${base}/api/projects`)).status).toBe(401)

  // The setup token, once.
  const owner = { name: "Owner", email: "owner@team.local", password: "correct horse battery" }
  expect((await json("/api/setup", { ...owner, token: "wrong" })).status).toBe(403)
  const made = await json("/api/setup", { ...owner, token: setup.value })
  expect(made.status).toBe(200)
  const cookie = cookieOf(made)
  expect(hasOwner(a)).toBe(true)
  expect((await json("/api/setup", { ...owner, token: setup.value })).status).toBe(409) // never again

  // Signed in: the API answers.
  expect((await fetch(`${base}/api/projects`, { headers: { cookie } })).status).toBe(200)
  // Another site can't use the cookie.
  expect((await fetch(`${base}/api/projects`, { headers: { cookie, origin: "https://evil.example" } })).status).toBe(403)
  expect((await json("/api/projects", { name: "X", brief: "" }, { cookie, origin: "https://evil.example" })).status).toBe(403)
  // Public sign-up is closed (accounts come from the setup and invites).
  expect((await json("/api/auth/sign-up/email", { name: "Eve", email: "eve@x.local", password: "another long pass" })).status).toBe(403)

  // Sign out, then in again with the password.
  await json("/api/auth/sign-out", {}, { cookie })
  expect((await fetch(`${base}/api/projects`, { headers: { cookie } })).status).toBe(401)
  const again = await json("/api/auth/sign-in/email", { email: owner.email, password: owner.password })
  expect(again.status).toBe(200)
  expect((await fetch(`${base}/api/projects`, { headers: { cookie: cookieOf(again) } })).status).toBe(200)
})

test("team (M2): invite by link once, a member is refused admin routes, the last owner stays, removal cuts access at once", async () => {
  const owner = cookieOf(await json("/api/auth/sign-in/email", { email: "owner@team.local", password: "correct horse battery" })) // a fresh session: step-up ok
  const made = await json("/api/team/invitations", { email: "ana@team.local", role: "member" }, { cookie: owner })
  expect(made.status).toBe(200)
  const { id, link } = (await made.json()) as { id: string; link: string }
  expect(link).toBe(`${base}/invite/${id}`)
  expect(await (await fetch(`${base}/api/invite/${id}`)).json()).toEqual({ email: "ana@team.local", role: "member" })

  // Ana joins through the link, once.
  const joined = await json(`/api/invite/${id}`, { name: "Ana", password: "ana's long pass" })
  expect(joined.status).toBe(200)
  const ana = cookieOf(joined)
  expect((await json(`/api/invite/${id}`, { name: "Eve", password: "eve's long pass" })).status).toBe(404) // spent

  // A member: no admin routes, no inviting.
  expect((await fetch(`${base}/api/audit`, { headers: { cookie: ana } })).status).toBe(403)
  expect((await fetch(`${base}/api/keys/OPENAI_API_KEY`, { method: "PUT", headers: { cookie: ana, origin: base, "content-type": "application/json" }, body: '{"value":"x"}' })).status).toBe(403)
  expect((await json("/api/team/invitations", { email: "x@team.local", role: "member" }, { cookie: ana })).status).toBe(403)
  const team = (await (await fetch(`${base}/api/team`, { headers: { cookie: ana } })).json()) as { me: { role: string }; members: unknown[]; invitations: unknown[] }
  expect(team.me.role).toBe("member")
  expect(team.members).toHaveLength(2)
  expect(team.invitations).toEqual([]) // members don't see invites

  // The owner can't step down while alone; owners see the activity log.
  const ownerId = ((await (await fetch(`${base}/api/team`, { headers: { cookie: owner } })).json()) as { me: { id: string } }).me.id
  const patch = (userId: string, role: string) => fetch(`${base}/api/team/members/${userId}`, { method: "PATCH", headers: { cookie: owner, origin: base, "content-type": "application/json" }, body: JSON.stringify({ role }) })
  expect((await patch(ownerId, "member")).status).toBe(409)
  expect((await fetch(`${base}/api/audit`, { headers: { cookie: owner } })).status).toBe(200)

  // Removing Ana: her open session stops working at once.
  const anaId = (team.members as Array<{ userId: string; email: string }>).find((m) => m.email === "ana@team.local")!.userId
  expect((await fetch(`${base}/api/projects`, { headers: { cookie: ana } })).status).toBe(200)
  expect((await fetch(`${base}/api/team/members/${anaId}`, { method: "DELETE", headers: { cookie: owner, origin: base } })).status).toBe(200)
  expect((await fetch(`${base}/api/projects`, { headers: { cookie: ana } })).status).toBe(401)
})

test("what stays a person's own (M3): private chats, projects by membership, personal memory", async () => {
  const owner = cookieOf(await json("/api/auth/sign-in/email", { email: "owner@team.local", password: "correct horse battery" }))
  const { link } = (await (await json("/api/team/invitations", { email: "bia@team.local", role: "member" }, { cookie: owner })).json()) as { link: string }
  const bia = cookieOf(await json(`/api/invite/${link.split("/").at(-1)}`, { name: "Bia", password: "bia's long pass" }))
  const get = (path: string, cookie: string) => fetch(`${base}${path}`, { headers: { cookie } })
  const api = async <T>(path: string, cookie: string, body: unknown, method = "POST") => (await fetch(`${base}${path}`, { method, headers: { cookie, origin: base, "content-type": "application/json" }, body: JSON.stringify(body) })).json() as Promise<T>

  // The owner's agent and private chat: Bia sees neither the chat in the list nor by its id.
  const agent = await api<{ id: string }>("/api/agents", owner, { projectId: null, name: "Iris", instructions: "", model: "claude-cli/sonnet" })
  const mine = await api<{ id: string }>("/api/chats", owner, { projectId: null, agentIds: [agent.id], model: "claude-cli/sonnet" })
  expect(((await (await get("/api/chats", owner)).json()) as Array<{ id: string }>).some((c) => c.id === mine.id)).toBe(true)
  expect(((await (await get("/api/chats", bia)).json()) as Array<{ id: string }>).some((c) => c.id === mine.id)).toBe(false)
  expect((await get(`/api/chats/${mine.id}/messages`, bia)).status).toBe(404)
  // Hers is hers: not even the owner reads it.
  const hers = await api<{ id: string }>("/api/chats", bia, { projectId: null, agentIds: [agent.id], model: "claude-cli/sonnet" })
  expect((await get(`/api/chats/${hers.id}/messages`, owner)).status).toBe(404)

  // A project: invisible to Bia until an admin adds her.
  const project = await api<{ id: string }>("/api/projects", owner, { name: "Site", brief: "" })
  const inProject = await api<{ id: string }>("/api/chats", owner, { projectId: project.id, agentIds: [agent.id], model: "claude-cli/sonnet" })
  expect(((await (await get("/api/projects", bia)).json()) as Array<{ id: string }>).some((p) => p.id === project.id)).toBe(false)
  expect((await get(`/api/chats/${inProject.id}/messages`, bia)).status).toBe(404)
  const biaId = ((await (await get("/api/team", bia)).json()) as { me: { id: string } }).me.id
  await api(`/api/team/projects/${project.id}/members`, owner, { personId: biaId, member: true }, "PUT")
  expect(((await (await get("/api/projects", bia)).json()) as Array<{ id: string }>).some((p) => p.id === project.id)).toBe(true)
  expect((await get(`/api/chats/${inProject.id}/messages`, bia)).status).toBe(200)

  // Personal memory: what the owner keeps about themself never reaches Bia's list.
  await api("/api/memories", owner, { scope: "user", kind: "fact", title: "", text: "The owner drinks green tea" })
  const biaMemories = (await (await get("/api/memories", bia)).json()) as Array<{ text: string }>
  expect(biaMemories.some((m) => m.text.includes("green tea"))).toBe(false)
  const ownerMemories = (await (await get("/api/memories", owner)).json()) as Array<{ text: string }>
  expect(ownerMemories.some((m) => m.text.includes("green tea"))).toBe(true)
})

// One RPC call over the WebSocket with a person's cookie (the JSON protocol: a Request, then its Exit).
const rpcCall = (cookie: string, tag: string, payload: unknown) =>
  new Promise<{ _tag: string; exit?: { _tag: string; cause?: unknown; value?: unknown } }>((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/rpc`, { headers: { cookie, origin: base } } as unknown as string[])
    ws.onopen = () => ws.send(JSON.stringify({ _tag: "Request", id: "1", tag, payload, headers: [] }))
    ws.onmessage = (e) => {
      const msgs = ([] as unknown[]).concat(JSON.parse(String(e.data))) as Array<{ _tag: string }>
      const exit = msgs.find((m) => m._tag === "Exit")
      if (exit) {
        ws.close()
        resolve(exit as never)
      }
    }
    ws.onerror = () => reject(new Error("socket failed"))
    setTimeout(() => reject(new Error("no answer")), 5000)
  })

test("the chat socket (M3): a person sends to their own chat; another person's chat answers as missing", async () => {
  const owner = cookieOf(await json("/api/auth/sign-in/email", { email: "owner@team.local", password: "correct horse battery" }))
  const bia = cookieOf(await json("/api/auth/sign-in/email", { email: "bia@team.local", password: "bia's long pass" }))
  const agent = (await (await fetch(`${base}/api/agents`, { headers: { cookie: owner } })).json()) as Array<{ id: string }>
  const chat = (await (await fetch(`${base}/api/chats`, { method: "POST", headers: { cookie: owner, origin: base, "content-type": "application/json" }, body: JSON.stringify({ projectId: null, agentIds: [agent[0]!.id], model: "claude-cli/sonnet" }) })).json()) as { id: string }
  const mine = await rpcCall(owner, "send", { chatId: chat.id, clientId: crypto.randomUUID(), text: "hi" })
  expect(mine.exit?._tag ?? mine._tag).toBe("Success")
  const theirs = await rpcCall(bia, "send", { chatId: chat.id, clientId: crypto.randomUUID(), text: "hi" })
  expect(JSON.stringify(theirs)).toContain("ChatNotFound")
})

test("devices (M4): pair by a one-time code, confirmed by the person, signed sessions and approvals, revoked at once", async () => {
  const owner = cookieOf(await json("/api/auth/sign-in/email", { email: "owner@team.local", password: "correct horse battery" }))
  const { code, qr } = (await (await json("/api/devices/pair", {}, { cookie: owner })).json()) as { code: string; qr: string }
  const scanned = JSON.parse(qr) as { url: string; code: string; fp: string }
  expect(scanned.url).toBe(base)

  // The phone: its own P-256 key; claims the code (no cookie, no Origin) and checks the server's signature.
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])
  const { kty, crv, x, y } = await crypto.subtle.exportKey("jwk", keys.publicKey)
  const phone = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) })
  const claimed = await phone("/api/devices/claim", { code, name: "Pixel", publicKey: { kty, crv, x, y } })
  expect(claimed.status).toBe(200)
  const { deviceId, server } = (await claimed.json()) as { deviceId: string; server: { publicKey: JsonWebKey; fingerprint: string; signature: string } }
  expect(server.fingerprint).toBe(scanned.fp)
  const keyHash = new Bun.CryptoHasher("sha256").update(JSON.stringify({ kty, crv, x, y })).digest("base64url")
  expect(await verifyDevice(JSON.stringify(server.publicKey), `${deviceId}.${keyHash}`, server.signature)).toBe(true)
  expect((await phone("/api/devices/claim", { code, name: "Again", publicKey: { kty, crv, x, y } })).status).toBe(404) // the code works once

  const sign = async (text: string) => Buffer.from(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, new TextEncoder().encode(text))).toString("base64url")
  const session = async () => {
    const timestamp = Date.now()
    const nonce = crypto.randomUUID()
    return phone(`/api/devices/${deviceId}/session`, { timestamp, nonce, signature: await sign(`${deviceId}.session.${timestamp}.${nonce}`) })
  }
  expect((await session()).status).toBe(403) // waiting: not confirmed yet
  expect((await json(`/api/devices/${deviceId}/confirm`, {}, { cookie: owner })).status).toBe(200)
  const { token } = (await (await session()).json()) as { token: string }
  const bearer = { authorization: `Bearer ${token}` }
  expect((await fetch(`${base}/api/projects`, { headers: bearer })).status).toBe(200)
  // A replayed signature is refused; so is a signature from another key.
  const timestamp = Date.now()
  const nonce = crypto.randomUUID()
  const signed = { timestamp, nonce, signature: await sign(`${deviceId}.session.${timestamp}.${nonce}`) }
  expect((await phone(`/api/devices/${deviceId}/session`, signed)).status).toBe(200)
  expect((await phone(`/api/devices/${deviceId}/session`, signed)).status).toBe(403)
  // An approval needs the device's signature; the plain socket's decide is refused for a device session.
  const unknown = { approvalId: "nope", outcome: "approved", timestamp: Date.now(), nonce: crypto.randomUUID() }
  expect((await phone(`/api/devices/${deviceId}/approve`, { ...unknown, signature: "bad" }, bearer)).status).toBe(403)
  expect((await phone(`/api/devices/${deviceId}/approve`, { ...unknown, signature: await sign(`${deviceId}.approve.nope.approved.${unknown.timestamp}.${unknown.nonce}`) }, bearer)).status).toBe(404)

  // Revoked: its session stops at once and it never signs in again.
  expect((await fetch(`${base}/api/devices/${deviceId}`, { method: "DELETE", headers: { cookie: owner, origin: base } })).status).toBe(200)
  expect((await fetch(`${base}/api/projects`, { headers: bearer })).status).toBe(401)
  expect((await session()).status).toBe(403)
})

test("connectors (M6): the service's return to the public URL reaches Zorel without a session; a made-up state connects nothing", async () => {
  const back = await fetch(`${base}/api/oauth/callback?code=abc&state=${crypto.randomUUID()}`)
  expect(back.status).toBe(400) // not 401: the guard lets it through, and the state is checked instead
  expect(await back.text()).toContain("Not connected")
})

test("SC-004 (M3): another person's memory by its id answers as missing; the server machine is admins' only", async () => {
  const owner = cookieOf(await json("/api/auth/sign-in/email", { email: "owner@team.local", password: "correct horse battery" }))
  const bia = cookieOf(await json("/api/auth/sign-in/email", { email: "bia@team.local", password: "bia's long pass" }))
  const made = (await (await json("/api/memories", { scope: "user", kind: "fact", title: "", text: "The owner's private plan" }, { cookie: owner })).json()) as { id: string }
  const patch = (cookie: string) => fetch(`${base}/api/memories/${made.id}`, { method: "PATCH", headers: { cookie, origin: base, "content-type": "application/json" }, body: JSON.stringify({ text: "changed" }) })
  expect((await patch(bia)).status).toBe(404)
  expect((await fetch(`${base}/api/memories/${made.id}/versions`, { headers: { cookie: bia } })).status).toBe(404)
  expect((await patch(owner)).status).toBe(200)
  for (const path of ["/api/processes", "/api/folders", "/api/usage"]) expect((await fetch(`${base}${path}`, { headers: { cookie: bia } })).status).toBe(403)
})
