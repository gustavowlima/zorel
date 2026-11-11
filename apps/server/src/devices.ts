// Paired devices (spec 014 M4; the phone app is spec 016). A signed-in person makes a one-time pairing code (5 min) shown
// as a QR with the server's address and the fingerprint of the server's identity key. The device makes its own P-256
// key, claims the code with its public half, and gets the claim back signed by the server (so a device that scanned
// the code knows it reached that server, not something in between). It waits until the person (or an admin) confirms
// it by name. Then it asks for sessions by signing a challenge: each lasts an hour, and approvals from a device need
// its signature too. A revoked device never signs in again.
import type { Database } from "bun:sqlite"
import { createHash, randomBytes } from "node:crypto"
import { Effect, Layer, Option } from "effect"
import { HttpRouter, type HttpServerRequest, HttpServerResponse } from "effect/http"
import { auditRaw, personOf, roleOf, type ZorelAuth } from "./auth.ts"
import { Runtime } from "./runtime.ts"
import type { ServerMode } from "./server-mode.ts"

const CODE_MS = 5 * 60 * 1000
const SESSION_MS = 60 * 60 * 1000
const SKEW_MS = 2 * 60 * 1000 // a signed request's time may be this far from the server's
const ECDSA = { name: "ECDSA", namedCurve: "P-256" } as const
const SIGN = { name: "ECDSA", hash: "SHA-256" } as const
const b64u = (bytes: ArrayBuffer | Uint8Array) => Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("base64url")
const hashOf = (s: string) => createHash("sha256").update(s).digest("base64url")

// The server's identity: a P-256 key kept in the vault, made once. Its fingerprint (SHA-256 of the public key, SPKI)
// goes in every pairing QR.
export async function serverIdentity(stored: string | undefined, save: (jwk: string) => Promise<void>) {
  let jwk = stored ? (JSON.parse(stored) as JsonWebKey) : undefined
  if (!jwk) {
    const pair = await crypto.subtle.generateKey(ECDSA, true, ["sign", "verify"])
    jwk = await crypto.subtle.exportKey("jwk", pair.privateKey)
    await save(JSON.stringify(jwk))
  }
  const privateKey = await crypto.subtle.importKey("jwk", jwk, ECDSA, false, ["sign"])
  const { d: _d, ...pub } = jwk
  const publicKey = await crypto.subtle.importKey("jwk", { ...pub, key_ops: ["verify"] }, ECDSA, true, ["verify"])
  const spki = await crypto.subtle.exportKey("spki", publicKey)
  return {
    publicJwk: { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y },
    fingerprint: b64u(createHash("sha256").update(new Uint8Array(spki)).digest()),
    sign: async (text: string) => b64u(await crypto.subtle.sign(SIGN, privateKey, new TextEncoder().encode(text)))
  }
}
export type ServerIdentity = Awaited<ReturnType<typeof serverIdentity>>

// A device's signature over `text` with the public key it registered (JWK, P-256).
export async function verifyDevice(publicKey: string, text: string, signature: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("jwk", JSON.parse(publicKey) as JsonWebKey, ECDSA, false, ["verify"])
    return await crypto.subtle.verify(SIGN, key, Buffer.from(signature, "base64url"), new TextEncoder().encode(text))
  } catch {
    return false
  }
}

// A signed request's freshness: its time near the server's, its nonce never seen before (kept for the skew window).
export function replayGuard(now = () => Date.now()) {
  const seen = new Map<string, number>()
  return (timestamp: number, nonce: string) => {
    const at = now()
    for (const [n, t] of seen) if (at - t > 2 * SKEW_MS) seen.delete(n)
    if (!Number.isFinite(timestamp) || Math.abs(at - timestamp) > SKEW_MS || nonce.length < 16 || nonce.length > 100 || seen.has(nonce)) return false
    seen.set(nonce, at)
    return true
  }
}

type DeviceRow = { id: string; person_id: string; name: string; public_key: string; state: "waiting" | "active" | "revoked"; created_at: number; used_at: number | null }
const deviceOf = (db: Database, id: string) => db.query("SELECT * FROM devices WHERE id = ?").get(id) as DeviceRow | null
const reply = (body: unknown, status = 200) => HttpServerResponse.jsonUnsafe(body, { status })
const bodyOf = (req: HttpServerRequest.HttpServerRequest) => Effect.orElseSucceed(req.json, () => ({})) as Effect.Effect<Record<string, unknown>>
const lastPart = (req: HttpServerRequest.HttpServerRequest, back = 1) => new URL(req.url, "http://x").pathname.split("/").at(-back)!
// Claims: a few per minute per address, whatever the code (the code itself is 128 bits).
const claimLimit = () => {
  const hits = new Map<string, number[]>()
  return (ip: string) => {
    const now = Date.now()
    const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000)
    recent.push(now)
    hits.set(ip, recent)
    return recent.length <= 10
  }
}

export function deviceRoutes(mode: ServerMode, a: ZorelAuth, identity: ServerIdentity) {
  const fresh = replayGuard()
  const limited = claimLimit()
  const signedIn = (req: HttpServerRequest.HttpServerRequest) => Effect.promise(() => personOf(a, new Headers(req.headers as Record<string, string>)))

  // A pairing code and the QR's contents.
  const Pair = HttpRouter.add("POST", "/api/devices/pair", (req) =>
    Effect.gen(function* () {
      const me = yield* signedIn(req)
      if (!me) return reply({ error: "signed_out" }, 401)
      const code = randomBytes(16).toString("base64url")
      a.db.query("INSERT INTO pairing_codes (hash, person_id, expires_at, used) VALUES (?, ?, ?, 0)").run(hashOf(code), me.id, Date.now() + CODE_MS)
      return reply({ code, expiresAt: Date.now() + CODE_MS, qr: JSON.stringify({ v: 1, url: mode.publicUrl.origin, code, fp: identity.fingerprint }) })
    })
  )

  // Open: a device claims a code with its public key; the answer is signed by the server's identity key.
  const Claim = HttpRouter.add("POST", "/api/devices/claim", (req) =>
    Effect.gen(function* () {
      // The client's address: the forwarded one only behind a proxy the server was told to trust.
      const peer = Option.getOrUndefined(req.peerAddress)
      const forwarded = peer && mode.trustedProxies.includes(peer) ? (req.headers["x-forwarded-for"] as string | undefined)?.split(",").at(-1)?.trim() : undefined
      const ip = forwarded || peer || "local"
      if (!limited(ip)) return reply({ error: "too_many" }, 429)
      const body = yield* bodyOf(req)
      const code = typeof body.code === "string" ? body.code : ""
      const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : ""
      const jwk = body.publicKey as JsonWebKey | undefined
      if (!code || !name || jwk?.kty !== "EC" || jwk.crv !== "P-256" || typeof jwk.x !== "string" || typeof jwk.y !== "string" || "d" in jwk) return reply({ error: "invalid" }, 400)
      // Used at once, whatever happens next: a code works one time.
      const row = a.db.query("UPDATE pairing_codes SET used = 1 WHERE hash = ? AND used = 0 AND expires_at > ? RETURNING person_id").get(hashOf(code), Date.now()) as { person_id: string } | null
      if (!row || !roleOf(a, row.person_id)) return reply({ error: "code_invalid" }, 404)
      const publicKey = JSON.stringify({ kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y })
      const id = crypto.randomUUID()
      a.db.query("INSERT INTO devices (id, person_id, name, public_key, state, created_at) VALUES (?, ?, ?, ?, 'waiting', ?)").run(id, row.person_id, name, publicKey, Date.now())
      auditRaw(a.db, { action: "device.paired", actorId: row.person_id, target: { type: "device", id, name } })
      const signature = yield* Effect.promise(() => identity.sign(`${id}.${hashOf(publicKey)}`))
      return reply({ deviceId: id, state: "waiting", server: { publicKey: identity.publicJwk, fingerprint: identity.fingerprint, signature } })
    })
  )

  // The person's devices (an admin sees everyone's).
  const List = HttpRouter.add("GET", "/api/devices", (req) =>
    Effect.gen(function* () {
      const me = yield* signedIn(req)
      if (!me) return reply({ error: "signed_out" }, 401)
      const rows = (me.role === "member" ? a.db.query("SELECT * FROM devices WHERE person_id = ? AND state != 'revoked' ORDER BY created_at").all(me.id) : a.db.query("SELECT * FROM devices WHERE state != 'revoked' ORDER BY created_at").all()) as DeviceRow[]
      return reply({ devices: rows.map((d) => ({ id: d.id, personId: d.person_id, name: d.name, state: d.state, createdAt: d.created_at, usedAt: d.used_at })) })
    })
  )

  // Confirm or revoke: the device's person, or an admin (a revoke of someone else's device needs a recent sign-in).
  const decide = (state: "active" | "revoked") => (req: HttpServerRequest.HttpServerRequest) =>
    Effect.gen(function* () {
      const me = yield* signedIn(req)
      if (!me) return reply({ error: "signed_out" }, 401)
      const d = deviceOf(a.db, lastPart(req, state === "active" ? 2 : 1))
      if (!d || d.state === "revoked") return reply({ error: "not_found" }, 404)
      const own = d.person_id === me.id
      if (!own && me.role === "member") return reply({ error: "not_found" }, 404)
      if (!own && state === "revoked" && Date.now() - me.sessionAt > 5 * 60 * 1000) return reply({ error: "step_up" }, 403)
      a.db.query("UPDATE devices SET state = ? WHERE id = ?").run(state, d.id)
      if (state === "revoked") a.db.query("DELETE FROM auth_sessions WHERE userAgent = ?").run(`device:${d.id}`) // signed out at once
      auditRaw(a.db, { action: state === "active" ? "device.confirmed" : "device.revoked", actorId: me.id, target: { type: "device", id: d.id, name: d.name } })
      return reply({ ok: true })
    })
  const Confirm = HttpRouter.add("POST", "/api/devices/:id/confirm", decide("active"))
  const Revoke = HttpRouter.add("DELETE", "/api/devices/:id", decide("revoked"))

  // Open: a confirmed device signs "<deviceId>.session.<timestamp>.<nonce>" and gets a one-hour session (a bearer token).
  const Session = HttpRouter.add("POST", "/api/devices/:id/session", (req) =>
    Effect.gen(function* () {
      const d = deviceOf(a.db, lastPart(req, 2))
      const body = yield* bodyOf(req)
      const timestamp = Number(body.timestamp)
      const nonce = typeof body.nonce === "string" ? body.nonce : ""
      const signature = typeof body.signature === "string" ? body.signature : ""
      if (d?.state !== "active" || !roleOf(a, d.person_id)) return reply({ error: "device_not_active" }, 403)
      if (!(yield* Effect.promise(() => verifyDevice(d.public_key, `${d.id}.session.${timestamp}.${nonce}`, signature))) || !fresh(timestamp, nonce)) return reply({ error: "bad_signature" }, 403)
      const ctx = yield* Effect.promise(() => a.auth.$context)
      const session = yield* Effect.promise(() => ctx.internalAdapter.createSession(d.person_id, false, { expiresAt: new Date(Date.now() + SESSION_MS), userAgent: `device:${d.id}` }))
      a.db.query("UPDATE devices SET used_at = ? WHERE id = ?").run(Date.now(), d.id)
      return reply({ token: session.token, expiresAt: Date.now() + SESSION_MS })
    })
  )

  // An approval from a device: signed "<deviceId>.approve.<approvalId>.<outcome>.<timestamp>.<nonce>" by its key, from
  // its own session. The approval must still be pending; the runtime checks it belongs to a chat the person sees.
  const Approve = HttpRouter.add("POST", "/api/devices/:id/approve", (req) =>
    Effect.gen(function* () {
      const me = yield* signedIn(req)
      const d = deviceOf(a.db, lastPart(req, 2))
      const body = yield* bodyOf(req)
      const approvalId = typeof body.approvalId === "string" ? body.approvalId : ""
      const outcome = body.outcome === "approved" || body.outcome === "denied" ? body.outcome : undefined
      const timestamp = Number(body.timestamp)
      const nonce = typeof body.nonce === "string" ? body.nonce : ""
      const signature = typeof body.signature === "string" ? body.signature : ""
      if (!me || !d || d.state !== "active" || d.person_id !== me.id || !outcome) return reply({ error: "not_allowed" }, 403)
      if (!(yield* Effect.promise(() => verifyDevice(d.public_key, `${d.id}.approve.${approvalId}.${outcome}.${timestamp}.${nonce}`, signature))) || !fresh(timestamp, nonce)) return reply({ error: "bad_signature" }, 403)
      const runtime = yield* Runtime
      const done = yield* runtime.decide(approvalId, outcome).pipe(Effect.as(true), Effect.catchTag("ApprovalNotFound", () => Effect.succeed(false)))
      if (done) auditRaw(a.db, { action: "device.approved", actorId: me.id, target: { type: "approval", id: approvalId, name: `${d.name}: ${outcome}` } })
      return done ? reply({ ok: true }) : reply({ error: "not_found" }, 404)
    })
  )

  return Layer.mergeAll(Pair, Claim, List, Confirm, Revoke, Session, Approve)
}
