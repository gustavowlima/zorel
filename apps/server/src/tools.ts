// Agent tools via MCP.
// - Hub: connections to the configured MCP servers (stdio or http), reused across turns.
// - Gateway: a local MCP server; each turn opens a session with a secret URL and only the allowed
//   tools. It's the only tool source for any engine (CLI or API): Zorel decides.
// Classification and the per-turn gateway model derive from third-party code, see NOTICE.
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import type { McpServer, ToolInfo } from "@zorel/contracts"
import { Context, Effect, Layer } from "effect"
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import { McpOAuth } from "./oauth.ts"
import { mcpEnv, Secrets, type SecretStore } from "./secrets.ts"

const CONNECT_MS = 20_000
const CALL_MS = 5 * 60_000
export const MAX_RESULT_CHARS = 40_000

// ---------- policy ----------

const READ = new Set(["get", "list", "search", "read", "find", "fetch", "query", "describe", "show", "view", "count", "lookup", "retrieve"])
const SENSITIVE = new Set(["delete", "remove", "merge", "deploy", "send", "publish", "transfer", "pay", "destroy", "drop", "revoke", "post", "email"])
const words = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

// Annotations first; then the name. A sensitive word in any position beats a read verb,
// because misclassifying as "read" would skip approval.
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
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n[… result cut]` : text
}

// ---------- large results ----------
// A result of Zorel's own tools (MCP, browser) over COMPACT_AT characters reaches the agent as its first COMPACT_HEAD
// and a handle; the whole text stays here, readable with zorel_read_result. A big result would otherwise be sent
// again at every later step of the turn.
export const COMPACT_AT = 16_000
export const COMPACT_HEAD = 3_000
const KEPT_PER_CHAT = 20
const KEPT_CHATS = 50
// ponytail: in memory, lost on restart (the agent is told to run the tool again); LRU by chat.
const kept = new Map<string, { n: number; results: Array<{ id: string; text: string }> }>()

export function compact(chatId: string, r: CallToolResult): CallToolResult {
  const content = r.content ?? []
  const text = content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("\n")
  if (text.length <= COMPACT_AT) return r
  const entry = kept.get(chatId) ?? { n: 0, results: [] }
  kept.delete(chatId)
  kept.set(chatId, entry) // most recent last
  if (kept.size > KEPT_CHATS) kept.delete(kept.keys().next().value!)
  const id = `r${++entry.n}`
  entry.results = [...entry.results, { id, text }].slice(-KEPT_PER_CHAT)
  const line = `[Result shortened: ${text.length.toLocaleString("en-US")} characters in all, the first ${COMPACT_HEAD.toLocaleString("en-US")} shown. Read more with zorel_read_result {"id":"${id}","offset":${COMPACT_HEAD}}, or {"id":"${id}","find":"some text"} for the lines holding it.]`
  return { ...r, content: [...content.filter((c) => c.type !== "text"), { type: "text", text: `${text.slice(0, COMPACT_HEAD)}\n${line}` }] }
}

// zorel_read_result: a slice of a shortened result, or its lines holding a text. Bad input is a tool error.
export function readResult(chatId: string, args: Record<string, unknown>): CallToolResult {
  const found = kept.get(chatId)?.results.find((x) => x.id === args.id)
  if (!found) return textResult("That result is no longer available; run the tool again.", true)
  const text = found.text
  if (typeof args.find === "string" && args.find.trim()) {
    const want = args.find.trim().toLowerCase()
    const lines = text.split("\n").filter((l) => l.toLowerCase().includes(want))
    let out = ""
    let k = 0
    for (const l of lines) {
      if (out.length + l.length + 1 > COMPACT_AT) break
      out += `${l}\n`
      k++
    }
    return textResult(`${out}[${k} matching lines${k < lines.length ? ` of ${lines.length}` : ""}]`)
  }
  const offset = Number.isInteger(args.offset) && (args.offset as number) >= 0 ? (args.offset as number) : 0
  if (offset >= text.length) return textResult(`The result has ${text.length} characters.`, true)
  const length = Number.isInteger(args.length) ? Math.min(COMPACT_AT, Math.max(1, args.length as number)) : COMPACT_HEAD
  const end = Math.min(text.length, offset + length)
  return textResult(`${text.slice(offset, end)}\n[characters ${offset}–${end} of ${text.length}]`)
}

// ---------- hub ----------

export interface RemoteTool extends ToolInfo {
  readonly inputSchema: Record<string, unknown>
}

export class Hub {
  private clients = new Map<string, Promise<Client>>()
  private pids = new Map<string, number>() // local (stdio) servers' processes
  // Servers that refused the stored sign-in (token revoked or expired, refresh failed): Settings asks to reconnect.
  readonly refused = new Set<string>()
  // Servers with a client open now (a local one is a process of its own).
  connected = () => [...this.clients.keys()]
  pidOf = (id: string) => this.pids.get(id)
  constructor(private secrets: SecretStore) {}

  private connect(s: McpServer): Promise<Client> {
    const cached = this.clients.get(s.id)
    if (cached) return cached
    const p = (async () => {
      const client = new Client({ name: "zorel", version: "0.1.0" })
      const env = mcpEnv(this.secrets, s.id)
      const transport = s.url
        ? new StreamableHTTPClientTransport(new URL(s.url), {
            requestInit: { headers: env }, // http: variables become headers (e.g. Authorization)
            ...(s.auth === "oauth" && { authProvider: new McpOAuth(this.secrets, s.id) }) // signed in through the browser; refreshed here
          })
        : new StdioClientTransport({ command: s.command, args: [...s.args], env: { ...getDefaultEnvironment(), ...env }, stderr: "ignore" })
      await client.connect(transport, { timeout: CONNECT_MS })
      if ("pid" in transport && transport.pid) this.pids.set(s.id, transport.pid)
      this.refused.delete(s.id)
      return client
    })()
    p.catch((e: unknown) => {
      this.clients.delete(s.id)
      if (e instanceof UnauthorizedError || (e as { code?: unknown })?.code === 401) this.refused.add(s.id)
    })
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
    this.refused.delete(id) // new credentials: try again before saying it's refused
    this.pids.delete(id)
    await c?.then((x) => x.close()).catch(() => {})
  }

  closeAll = () => Promise.all([...this.clients.keys()].map((id) => this.close(id)))
}

// ---------- gateway ----------

export interface ToolDef {
  readonly name: string // name exposed to the model: <server>__<tool>
  readonly description: string
  readonly inputSchema: Record<string, unknown>
}

export interface Session {
  readonly tools: ReadonlyArray<ToolDef>
  readonly call: (name: string, args: Record<string, unknown>) => Promise<CallToolResult>
}

export interface GatewayHandle {
  readonly url: string
  readonly update: (session: Session) => void
  readonly close: () => void
}

// No tools: what a native session's gateway serves between turns.
export const NO_TOOLS: Session = { tools: [], call: async (name) => textResult(`Tool not allowed: ${name}`, true) }

export class Gateway {
  private sessions = new Map<string, Session>()
  private server: ReturnType<typeof Bun.serve> | undefined

  start() {
    this.server = Bun.serve({ port: 0, hostname: "127.0.0.1", idleTimeout: 0, fetch: (req) => this.handle(req) })
  }
  stop() {
    this.server?.stop(true)
  }

  // URL handed to the engine, a way to swap the tools behind it (native sessions keep one URL across
  // turns), and the function that revokes it.
  open(session: Session): GatewayHandle {
    const token = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("hex")
    this.sessions.set(token, session)
    return {
      url: `http://127.0.0.1:${this.server!.port}/mcp/${token}`,
      update: (next) => void this.sessions.set(token, next),
      close: () => this.sessions.delete(token)
    }
  }

  private async handle(req: Request): Promise<Response> {
    const token = /^\/mcp\/([a-f0-9]{48})$/.exec(new URL(req.url).pathname)?.[1]
    const session = token ? this.sessions.get(token) : undefined
    if (!session) return new Response(null, { status: 404 })
    // Stateless: one MCP server per request, bound to this session's tools.
    const server = new Server({ name: "zorel", version: "0.1.0" }, { capabilities: { tools: {} } })
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: session.tools.map((t) => ({ ...t, inputSchema: { type: "object" as const, ...t.inputSchema } })) }))
    server.setRequestHandler(CallToolRequestSchema, async (r) => {
      // Defense in depth: a tool outside the turn's list never runs.
      if (!session.tools.some((t) => t.name === r.params.name)) return textResult(`Tool not allowed: ${r.params.name}`, true)
      return session.call(r.params.name, (r.params.arguments ?? {}) as Record<string, unknown>)
    })
    // SSE responses (no sessionIdGenerator: stateless): the headers go out at once and a ping every 30 s keeps the
    // call open while a card waits for the person. A JSON response sent only at the end hit the engines' HTTP
    // client limit (undici: 300 s to the first byte), so an approval or question over 5 minutes failed.
    const transport = new WebStandardStreamableHTTPServerTransport({})
    await server.connect(transport)
    const res = await transport.handleRequest(req).catch((e: unknown) => {
      void server.close()
      throw e
    })
    if (!res.body || !res.headers.get("content-type")?.includes("text/event-stream")) {
      void server.close()
      return res
    }
    return new Response(withPings(res.body, () => void server.close()), { status: res.status, headers: res.headers })
  }
}

// An SSE body with a comment line (": ping") every `every` ms until it ends; `onEnd` when it ends or is cancelled.
export function withPings(body: ReadableStream<Uint8Array>, onEnd: () => void, every = 30_000): ReadableStream<Uint8Array> {
  const reader = body.getReader()
  const ping = new TextEncoder().encode(": ping\n\n")
  let timer: ReturnType<typeof setInterval> | undefined
  const end = () => {
    clearInterval(timer)
    onEnd()
  }
  return new ReadableStream<Uint8Array>({
    start(controller) {
      timer = setInterval(() => controller.enqueue(ping), every)
    },
    async pull(controller) {
      const { value, done } = await reader.read()
      if (done) {
        end()
        controller.close()
      } else controller.enqueue(value)
    },
    cancel() {
      end()
      void reader.cancel()
    }
  })
}

// Exposed name: only [a-zA-Z0-9_-], up to 64 characters (common provider limit).
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
        (t) =>
          Effect.promise(async () => {
            t.gateway.stop()
            await t.hub.closeAll()
          })
      )
    })
  )
}
