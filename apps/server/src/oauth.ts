// Connectors that sign in with OAuth (the MCP authorization spec, through the SDK: discovery, dynamic client
// registration, PKCE, refresh). One provider per MCP server: its client registration, tokens and PKCE verifier live
// in the system keychain (never in the database). Connecting gives an authorization URL the person opens; the
// service redirects back to this server (/api/oauth/callback) with a code and the state Zorel issued, which is
// checked before anything is exchanged.
import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js"
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js"
import { oauthKey, type SecretStore } from "./secrets.ts"

type Stored = { client?: OAuthClientInformationMixed | undefined; tokens?: OAuthTokens | undefined; verifier?: string | undefined }

// state → server id, for authorizations started and not yet finished (10 min).
const pending = new Map<string, { serverId: string; at: number }>()
const PENDING_MS = 10 * 60_000

// This server's address as the browser reaches it (set by start()).
const callbackUrl = () => `${process.env.ZOREL_ORIGIN ?? "http://127.0.0.1:4317"}/api/oauth/callback`

export class McpOAuth implements OAuthClientProvider {
  authorizeUrl: string | undefined
  constructor(
    private readonly secrets: SecretStore,
    private readonly serverId: string
  ) {}
  private read(): Stored {
    try {
      return JSON.parse(this.secrets.get(oauthKey(this.serverId)) ?? "{}") as Stored
    } catch {
      return {}
    }
  }
  private write(patch: Stored) {
    return this.secrets.set(oauthKey(this.serverId), JSON.stringify({ ...this.read(), ...patch }))
  }
  get redirectUrl() {
    return callbackUrl()
  }
  get clientMetadata(): OAuthClientMetadata {
    return { client_name: "Zorel", redirect_uris: [callbackUrl()], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }
  }
  state() {
    const s = crypto.randomUUID()
    pending.set(s, { serverId: this.serverId, at: Date.now() })
    return s
  }
  clientInformation() {
    return this.read().client
  }
  saveClientInformation(client: OAuthClientInformationMixed) {
    return this.write({ client })
  }
  tokens() {
    return this.read().tokens
  }
  saveTokens(tokens: OAuthTokens) {
    return this.write({ tokens })
  }
  redirectToAuthorization(url: URL) {
    this.authorizeUrl = url.toString()
  }
  saveCodeVerifier(verifier: string) {
    return this.write({ verifier })
  }
  codeVerifier() {
    return this.read().verifier ?? ""
  }
  // The service rejected what Zorel has: start over from what it says is stale.
  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    if (scope === "all") return this.secrets.set(oauthKey(this.serverId), "")
    if (scope === "client") return this.write({ client: undefined, tokens: undefined })
    if (scope === "tokens") return this.write({ tokens: undefined })
    if (scope === "verifier") return this.write({ verifier: undefined })
    return undefined
  }
}

export const isSignedIn = (secrets: SecretStore, serverId: string) => !!new McpOAuth(secrets, serverId).tokens()?.access_token

// Start (or refresh) the sign-in: the URL to open, or null when Zorel already holds a working token.
export async function startSignIn(secrets: SecretStore, serverId: string, serverUrl: string): Promise<string | null> {
  const provider = new McpOAuth(secrets, serverId)
  const result = await auth(provider, { serverUrl })
  return result === "REDIRECT" ? (provider.authorizeUrl ?? null) : null
}

// The service sent the person back: check the state, exchange the code. Returns the server id it was for.
export async function finishSignIn(secrets: SecretStore, state: string, code: string, urlOf: (serverId: string) => Promise<string | undefined>): Promise<string> {
  const p = pending.get(state)
  pending.delete(state)
  if (!p || Date.now() - p.at > PENDING_MS) throw new Error("This sign-in link expired or was already used. Connect again from Zorel.")
  const serverUrl = await urlOf(p.serverId)
  if (!serverUrl) throw new Error("That connector no longer exists.")
  const result = await auth(new McpOAuth(secrets, p.serverId), { serverUrl, authorizationCode: code })
  if (result !== "AUTHORIZED") throw new Error("The service didn't authorize Zorel.")
  return p.serverId
}
