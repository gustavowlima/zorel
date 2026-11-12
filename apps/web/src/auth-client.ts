// Server mode's sign-in (spec 014): Better Auth's client on the same origin, with passkeys and the authenticator code.
// Only used when the server says it's a server (GET /api/server); the desktop and local modes never load it.
import type { ServerInfo } from "@zorel/contracts/routes"
import { passkeyClient } from "@better-auth/passkey/client"
import { createAuthClient } from "better-auth/client"
import { twoFactorClient } from "better-auth/client/plugins"

export const authClient = createAuthClient({
  baseURL: location.origin,
  basePath: "/api/auth",
  plugins: [passkeyClient(), twoFactorClient()]
})

export type { ServerInfo }

// Whether this Zorel is a team server: a local one has no such route.
export const serverInfo = (): Promise<ServerInfo | undefined> =>
  fetch("/api/server", { credentials: "same-origin" }).then(
    (r) => (r.ok ? (r.json() as Promise<ServerInfo>).catch(() => undefined) : undefined), // not JSON: no such route, local
    () => undefined
  )
