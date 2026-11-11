// Server mode (spec 014): Zorel on a person's own server, used by a team. Switched on by the environment of whoever
// runs it; the desktop and local modes never read these. The public URL is where people reach it (a reverse proxy
// with HTTPS, or a private network name): passkeys, origins and OAuth returns all come from it, never from a request.
export interface ServerMode {
  readonly host: string // where the server listens
  readonly port: number
  readonly publicUrl: URL // how people reach it
  readonly trustedProxies: ReadonlyArray<string> // whose X-Forwarded-For is believed
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"])

// From the environment, or undefined when server mode is off. Throws a plain message when it's on but misconfigured
// (the server then refuses to start rather than run open).
export function serverModeFrom(env: Readonly<Record<string, string | undefined>>): ServerMode | undefined {
  if (env.ZOREL_SERVER !== "1") return undefined
  const raw = env.ZOREL_PUBLIC_URL?.trim()
  if (!raw) throw new Error("ZOREL_PUBLIC_URL is required in server mode: the address people use to reach Zorel (https://…).")
  let publicUrl: URL
  try {
    publicUrl = new URL(raw)
  } catch {
    throw new Error(`ZOREL_PUBLIC_URL isn't a URL: ${raw}`)
  }
  // Sign-in over plain HTTP from another machine would hand sessions to the network: only HTTPS, or this machine.
  if (publicUrl.protocol !== "https:" && !(publicUrl.protocol === "http:" && LOOPBACK.has(publicUrl.hostname)))
    throw new Error("ZOREL_PUBLIC_URL must be https:// (a reverse proxy with a certificate, or tailscale serve); plain http only for localhost.")
  const [host, portText] = splitListen(env.ZOREL_LISTEN?.trim() || `127.0.0.1:${env.PORT ?? 4317}`)
  const port = Number(portText)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`ZOREL_LISTEN has no valid port: ${env.ZOREL_LISTEN}`)
  const trustedProxies = (env.ZOREL_TRUSTED_PROXIES ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  return { host, port, publicUrl: new URL(publicUrl.origin), trustedProxies }
}

// "0.0.0.0:4317", "[::]:4317", "4317" (all interfaces? no: a bare port listens on this machine only).
function splitListen(value: string): [string, string] {
  if (/^\d+$/.test(value)) return ["127.0.0.1", value]
  const v6 = /^\[([^\]]+)\]:(\d+)$/.exec(value)
  if (v6) return [v6[1]!, v6[2]!]
  const at = value.lastIndexOf(":")
  return at > 0 ? [value.slice(0, at), value.slice(at + 1)] : [value, "4317"]
}
