// Ferramentas dos agentes via MCP.
// - Hub: conexões com os servidores MCP configurados (stdio ou http), reaproveitadas entre turnos.
// - Gateway: um servidor MCP local; cada turno abre uma sessão com URL secreta e só as ferramentas
//   permitidas. É a única fonte de ferramentas de qualquer engine (CLI ou API): quem decide é o Zero.
// Classificação e modelo de gateway por turno derivam do Tucano (Apache-2.0), ver NOTICE.
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import type { McpServer, ToolInfo } from "@zero/contracts"
import { Context, Effect, Layer } from "effect"
import { mcpEnv, Secrets, type SecretStore } from "./secrets.ts"

const CONNECT_MS = 20_000
const CALL_MS = 5 * 60_000
export const MAX_RESULT_CHARS = 40_000

// ---------- política ----------

const READ = new Set(["get", "list", "search", "read", "find", "fetch", "query", "describe", "show", "view", "count", "lookup", "retrieve"])
const SENSITIVE = new Set(["delete", "remove", "merge", "deploy", "send", "publish", "transfer", "pay", "destroy", "drop", "revoke", "post", "email"])
const words = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

// Anotações primeiro; depois o nome. Uma palavra sensível em qualquer posição vence um verbo de leitura,
// porque classificar errado como "read" pularia a aprovação.
export function classify(tool: { name: string; annotations?: { readOnlyHint?: boolean | undefined; destructiveHint?: boolean | undefined } | undefined }): ToolInfo["cls"] {
  if (tool.annotations?.readOnlyHint === true) return "read"
  if (tool.annotations?.destructiveHint === true) return "sensitive"
  const w = words(tool.name)
  if (w.some((x) => SENSITIVE.has(x))) return "sensitive"
  return w[0] && READ.has(w[0]) ? "read" : "write"
}

export const exposed = (mode: McpServer["mode"], cls: ToolInfo["cls"]) => mode !== "read" || cls === "read"
export const needsApproval = (mode: McpServer["mode"], cls: ToolInfo["cls"]) => mode === "approve" && cls !== "read"

export const textResult = (text: string, isError = false): CallToolResult => ({ content: [{ type: "text", text }], isError })
export function resultText(r: CallToolResult): string {
  const text = (r.content ?? []).map((c) => (c.type === "text" ? c.text : `[${c.type}]`)).join("\n")
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n[… resultado cortado]` : text
}

// ---------- hub ----------

export interface RemoteTool extends ToolInfo {
  readonly inputSchema: Record<string, unknown>
}

export class Hub {
  private clients = new Map<string, Promise<Client>>()
  constructor(private secrets: SecretStore) {}

  private connect(s: McpServer): Promise<Client> {
    const cached = this.clients.get(s.id)
    if (cached) return cached
    const p = (async () => {
      const client = new Client({ name: "zero", version: "0.1.0" })
      const env = mcpEnv(this.secrets, s.id)
      const transport = s.url
        ? new StreamableHTTPClientTransport(new URL(s.url), { requestInit: { headers: env } }) // http: variáveis viram cabeçalhos (ex.: Authorization)
        : new StdioClientTransport({ command: s.command, args: [...s.args], env: { ...getDefaultEnvironment(), ...env }, stderr: "ignore" })
      await client.connect(transport, { timeout: CONNECT_MS })
      return client
    })()
    p.catch(() => this.clients.delete(s.id))
    this.clients.set(s.id, p)
    return p
  }

  async tools(s: McpServer): Promise<RemoteTool[]> {
    const client = await this.connect(s)
    const out: RemoteTool[] = []
    let cursor: string | undefined
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined, { timeout: CONNECT_MS })
      for (const t of page.tools) out.push({ name: t.name, description: t.description ?? "", cls: classify(t), inputSchema: t.inputSchema as Record<string, unknown> })
      cursor = page.nextCursor
    } while (cursor)
    return out
  }

  async call(s: McpServer, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const client = await this.connect(s)
    return (await client.callTool({ name, arguments: args }, undefined, { timeout: CALL_MS })) as CallToolResult
  }

  async close(id: string) {
    const c = this.clients.get(id)
    this.clients.delete(id)
    await c?.then((x) => x.close()).catch(() => {})
  }

  closeAll = () => Promise.all([...this.clients.keys()].map((id) => this.close(id)))
}

// ---------- gateway ----------

export interface ToolDef {
  readonly name: string // nome exposto ao modelo: <servidor>__<ferramenta>
  readonly description: string
  readonly inputSchema: Record<string, unknown>
}

export interface Session {
  readonly tools: ReadonlyArray<ToolDef>
  readonly call: (name: string, args: Record<string, unknown>) => Promise<CallToolResult>
}

export class Gateway {
  private sessions = new Map<string, Session>()
  private server: ReturnType<typeof Bun.serve> | undefined

  start() {
    this.server = Bun.serve({ port: 0, hostname: "127.0.0.1", idleTimeout: 0, fetch: (req) => this.handle(req) })
  }
  stop() {
    this.server?.stop(true)
  }

  // URL entregue ao engine e a função que a revoga.
  open(session: Session): { url: string; close: () => void } {
    const token = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("hex")
    this.sessions.set(token, session)
    return { url: `http://127.0.0.1:${this.server!.port}/mcp/${token}`, close: () => this.sessions.delete(token) }
  }

  private async handle(req: Request): Promise<Response> {
    const token = /^\/mcp\/([a-f0-9]{48})$/.exec(new URL(req.url).pathname)?.[1]
    const session = token ? this.sessions.get(token) : undefined
    if (!session) return new Response(null, { status: 404 })
    // Sem estado: um servidor MCP por requisição, preso às ferramentas desta sessão.
    const server = new Server({ name: "zero", version: "0.1.0" }, { capabilities: { tools: {} } })
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: session.tools.map((t) => ({ ...t, inputSchema: { type: "object" as const, ...t.inputSchema } })) }))
    server.setRequestHandler(CallToolRequestSchema, async (r) => {
      // Defesa em profundidade: ferramenta fora da lista do turno nunca roda.
      if (!session.tools.some((t) => t.name === r.params.name)) return textResult(`Ferramenta não permitida: ${r.params.name}`, true)
      return session.call(r.params.name, (r.params.arguments ?? {}) as Record<string, unknown>)
    })
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true }) // sem sessionIdGenerator: modo sem estado
    await server.connect(transport)
    try {
      return await transport.handleRequest(req)
    } finally {
      void server.close()
    }
  }
}

// Nome exposto: só [a-zA-Z0-9_-], até 64 caracteres (limite comum dos providers).
export const exposedName = (server: string, tool: string) => `${server}__${tool}`.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 64)

export class Tools extends Context.Service<Tools, { readonly hub: Hub; readonly gateway: Gateway }>()("Tools") {
  static layer = Layer.effect(
    Tools,
    Effect.gen(function* () {
      const secrets = yield* Secrets
      return yield* Effect.acquireRelease(
        Effect.sync(() => {
          const gateway = new Gateway()
          gateway.start()
          return { hub: new Hub(secrets), gateway }
        }),
        (t) => Effect.promise(async () => (t.gateway.stop(), await t.hub.closeAll()))
      )
    })
  )
}
