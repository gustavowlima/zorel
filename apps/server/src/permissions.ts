// Per-agent permissions (ARCHITECTURE §9.2; ideas from a reference app, own code): which MCP tools an agent sees and which
// wait for the person, whether it may use the browser, and the "always allow" rules it was given. `access`
// (files and shell) stays the engine's sandbox; this covers everything that reaches past the folder.
import { type AgentPermissions, DEFAULT_PERMISSIONS, type Grant, type McpServer, type ToolInfo } from "@zero/contracts"

export const permissionsOf = (agent: { permissions?: AgentPermissions } | undefined): AgentPermissions => agent?.permissions ?? DEFAULT_PERMISSIONS

// A server the agent was given nothing for follows the server's own mode.
export const grantFor = (p: AgentPermissions, server: Pick<McpServer, "id" | "mode">): Grant => p.grants[server.id] ?? (server.mode === "read" ? "read" : "write")

export interface ToolRoute {
  readonly expose: boolean
  readonly approve: boolean
  readonly alwaysKey: string // the rule "Always allow" saves
}

// One MCP tool for this agent. Destructive tools ask unless the server is trusted ("auto") or the person allowed
// this tool for good; writing tools ask on an "approve" server or when the agent asks first.
export function mcpRoute(p: AgentPermissions, server: Pick<McpServer, "id" | "mode">, tool: Pick<ToolInfo, "name" | "cls">, askFirst: boolean): ToolRoute {
  const grant = grantFor(p, server)
  const alwaysKey = `${server.id}:${tool.name}`
  const expose = grant === "write" || (grant === "read" && tool.cls === "read")
  const asks = (tool.cls === "sensitive" && server.mode !== "auto") || (tool.cls === "write" && (server.mode === "approve" || askFirst))
  return { expose, approve: expose && asks && !p.always.includes(alwaysKey), alwaysKey }
}

// Clicks whose words commit to something in the world (buying, posting, deleting…) always wait for the person,
// whatever the access level, and can't be allowed for good.
const RISKY = /\b(buy|pay|purchase|checkout|order|place order|publish|post|send|submit|confirm|delete|remove|transfer|donate|subscribe|book|sign up|comprar|pagar|publicar|enviar|confirmar|apagar|excluir|remover|transferir|assinar)\b/i

export function browserRoute(p: AgentPermissions, name: string, args: Record<string, unknown>, writes: boolean, askFirst: boolean): { approve: boolean; alwaysKey: string | null } {
  const label = typeof args.element === "string" ? args.element : ""
  if (name === "browser_click" && RISKY.test(label)) return { approve: true, alwaysKey: null }
  if (writes && askFirst) return { approve: !p.always.includes("browser"), alwaysKey: "browser" }
  return { approve: false, alwaysKey: null }
}

// An agent asking for more than it has (zero_request_access): the person approves on a card.
export const REQUEST_ACCESS_TOOL = {
  name: "zero_request_access",
  description:
    "Ask the user for access you don't have: what = 'web' (search and read pages), 'browser' (your own browser) or a connector's name (an MCP server here) with level 'read' or 'write'. Say why in reason. The user approves or declines on a card; granted access works from your next turn.",
  inputSchema: {
    properties: {
      what: { type: "string" },
      level: { type: "string", enum: ["read", "write"] },
      reason: { type: "string" }
    },
    required: ["what", "reason"]
  },
  writes: true
} as const

// The change a request asks for, or why it can't be asked (unknown connector, nothing to add).
export function accessChange(
  p: AgentPermissions,
  what: string,
  level: string | undefined,
  servers: ReadonlyArray<Pick<McpServer, "id" | "name" | "mode">>
): { label: string; next: AgentPermissions } | string {
  const w = what.trim().toLowerCase()
  if (w === "web") return p.web ? "You already have web access." : { label: "use the web", next: { ...p, web: true } }
  if (w === "browser") return p.browser ? "You already have a browser." : { label: "use its own browser", next: { ...p, browser: true } }
  const s = servers.find((x) => x.name.toLowerCase() === w)
  if (!s) return `No connector "${what}" here. Ask for web, browser or one of: ${servers.map((x) => x.name).join(", ") || "(none)"}.`
  const want: Grant = level === "write" ? "write" : "read"
  const have = grantFor(p, s)
  if (have === want || have === "write") return `You already have ${have} access to ${s.name}.`
  return { label: `${want === "write" ? "read and write" : "read"} ${s.name}`, next: { ...p, grants: { ...p.grants, [s.id]: want } } }
}

// A rule saved by "Always allow" (deduplicated, newest last, capped like the schema).
export const withAlways = (p: AgentPermissions, key: string): AgentPermissions => (p.always.includes(key) ? p : { ...p, always: [...p.always, key].slice(-200) })
