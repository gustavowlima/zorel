// End to end through the contract: real server (Bun) + typed client, with a fake engine that records turns
// and, when asked, calls tools through the MCP gateway URL — exactly like a CLI would.
import { afterAll, beforeAll, expect, test } from "bun:test"
import { BunHttpServer } from "@effect/platform-bun"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { Api, type Message } from "@zero/contracts"
import { type Approval, type ChatEvent, ZeroRpc } from "@zero/contracts/events"
import { Deferred, Effect, Exit, Fiber, Layer, Stream } from "effect"
import { FetchHttpClient, HttpRouter } from "effect/http"
import { HttpApiClient } from "effect/http-api"
import { RpcClient, RpcSerialization } from "effect/rpc"
import { Socket } from "effect/socket"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DataDir } from "./chat.ts"
import { CONSOLIDATION_SYSTEM } from "./context.ts"
import { Store } from "./db.ts"
import { Engines, type EngineEvent, type Turn } from "./engines.ts"
import { AppLive } from "./main.ts"
import { Accounts } from "./accounts.ts"
import { Audit } from "./audit.ts"
import { BrowserService } from "./browser.ts"
import { Actor } from "./access.ts"
import { Runtime } from "./runtime.ts"
import { Secrets } from "./secrets.ts"
import { Tools } from "./tools.ts"
import { Pricing } from "./pricing.ts"
import { Workspace } from "./workspace.ts"

// Zero's own tools (the chat's browser, the team), always offered next to the MCP ones.
const zeroOwn = (n: string) => n.startsWith("browser_") || n.startsWith("zero_")

// Prices for tests (USD per million tokens): no network.
const PRICES = { anthropic: { "claude-sonnet-5-5": { cost: { input: 2, output: 10, cache_read: 0.1 }, family: "claude-sonnet", release_date: "2026-09-28" } } }

// ---------- test MCP server ----------
const toolCalls: string[] = []
const mcp = Bun.serve({
  port: 0,
  async fetch(req) {
    const server = new Server({ name: "docs", version: "1" }, { capabilities: { tools: {} } })
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        { name: "search_docs", description: "Busca na documentação", inputSchema: { type: "object", properties: { q: { type: "string" } } } },
        { name: "delete_page", description: "Apaga uma página", inputSchema: { type: "object", properties: { id: { type: "string" } } } }
      ]
    }))
    server.setRequestHandler(CallToolRequestSchema, async (r) => {
      toolCalls.push(r.params.name)
      return { content: [{ type: "text", text: `resultado de ${r.params.name}` }] }
    })
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true })
    await server.connect(transport)
    return transport.handleRequest(req)
  }
})

// ---------- fake engine ----------
const turns: Turn[] = []
const mentionNext = new Map<string, string>() // reply text per agent name (to test handoff)
let manyMemories = 0 // > 0: the fake consolidation proposes this many user memories

async function useTool(t: Turn, name: string, args: Record<string, unknown>) {
  const client = new Client({ name: "fake-cli", version: "1" })
  await client.connect(new StreamableHTTPClientTransport(new URL(t.tools!.url)))
  const listed = await client.listTools()
  const r = (await client.callTool({ name, arguments: args })) as any
  await client.close()
  return { listed: listed.tools.map((x) => x.name), text: r.content[0].text as string }
}

const FakeEngines = Layer.succeed(Engines, {
  run: (t) => {
    turns.push(t)
    if (t.system === CONSOLIDATION_SYSTEM && manyMemories)
      return Stream.make<EngineEvent[]>(
        { type: "text", delta: JSON.stringify({ summary: "S", memories: Array.from({ length: manyMemories }, (_, i) => ({ scope: "user", text: `Preferência número ${i}`, evidence: [1] })) }) },
        { type: "done", usage: { inputTokens: 1, outputTokens: 1 } }
      )
    if (t.system === CONSOLIDATION_SYSTEM)
      return Stream.make(
        { type: "text" as const, delta: JSON.stringify({ summary: "Falaram de deploy.", memories: [{ scope: "project", text: "Deploy é na Vercel", evidence: [1] }, { scope: "team", text: "fora do escopo", evidence: [1] }], skills: [{ scope: "project", title: "Publicar o site", text: "1. bun run build\n2. vercel deploy" }] }) },
        { type: "done" as const, usage: { inputTokens: 1, outputTokens: 1 } }
      )
    const last = t.messages.at(-1)!.text
    const me = /## Você é (.+)\n/.exec(t.system)?.[1]
    const tool = /^tool:(\S+)/.exec(last)?.[1]
    if (tool)
      return Stream.fromEffect(Effect.promise(() => useTool(t, tool, { q: "deploy" }))).pipe(
        Stream.flatMap((r) => Stream.make<EngineEvent[]>({ type: "text", delta: `${r.listed.filter((n) => !zeroOwn(n)).join(",")} => ${r.text}` }, { type: "done", usage: { inputTokens: 1, outputTokens: 1 } }))
      )
    return Stream.make<EngineEvent[]>({ type: "text", delta: (me && mentionNext.get(me)) || `eco: ${last}` }, { type: "done", usage: { inputTokens: 10, outputTokens: 3 } })
  }
})

// ---------- server ----------
const port = 40000 + Math.floor(Math.random() * 10000)
const base = `http://localhost:${port}`
let stop: () => Promise<void>

beforeAll(async () => {
  const store = Store.layer(":memory:")
  const secrets = Layer.provideMerge(Secrets.memory(), store)
  const base = Layer.mergeAll(Layer.provideMerge(Layer.mergeAll(FakeEngines, Tools.layer), secrets), DataDir.layer(join(tmpdir(), "zero-test")))
  const services = Layer.mergeAll(Layer.provideMerge(Runtime.layer, Layer.provideMerge(Layer.mergeAll(Accounts.layer, Workspace.layer, Pricing.fixed(PRICES), Audit.layer, BrowserService.layer), base)), Actor.local)
  const server = AppLive().pipe(HttpRouter.serve, Layer.provide(services), Layer.provide(BunHttpServer.layer({ port })))
  const fiber = Effect.runFork(Layer.launch(server))
  stop = () => Effect.runPromise(Fiber.interrupt(fiber)).then(() => void mcp.stop(true))
  for (let i = 0; i < 50 && !(await fetch(`${base}/api/models`).catch(() => null)); i++) await Bun.sleep(20)
})
afterAll(() => stop())

const api = <A, E>(f: (c: HttpApiClient.ForApi<typeof Api>) => Effect.Effect<A, E>) =>
  Effect.runPromise(Effect.flatMap(HttpApiClient.make(Api, { baseUrl: base }), f).pipe(Effect.provide(FetchHttpClient.layer)))

// Real RPC client (WebSocket at /rpc), as the web uses it.
const rpcLayer = () =>
  RpcClient.layerProtocolSocket().pipe(
    Layer.provide(Socket.layerWebSocket(`ws://localhost:${port}/rpc`)),
    Layer.provide(Socket.layerWebSocketConstructorGlobal),
    Layer.provide(RpcSerialization.layerJson)
  )
type Rpc = Effect.Success<ReturnType<typeof RpcClient.make<typeof ZeroRpc extends { requests: ReadonlyMap<string, infer R> } ? R : never>>>
const rpc = <A, E>(f: (c: Rpc) => Effect.Effect<A, E>) =>
  Effect.runPromise(Effect.scoped(Effect.flatMap(RpcClient.make(ZeroRpc), (c) => f(c as Rpc))).pipe(Effect.provide(rpcLayer())))

// Subscribes to the chat, sends and waits for the chat to go idle again. `onApproval` decides requests while the turn waits.
async function send(chatId: string, body: { text: string; model?: string; attachmentIds?: string[] }, onApproval?: (a: Approval) => boolean) {
  return rpc((c) =>
    Effect.gen(function* () {
      const events: ChatEvent[] = []
      let openWhileWaiting: ReadonlyArray<Approval> = [] // what "Needs you" lists while the turn waits
      const ready = yield* Deferred.make<void>()
      const idle = yield* Deferred.make<void>()
      let ended = 0
      const fiber = yield* c.subscribeChat({ chatId }).pipe(
        Stream.runForEach((e) =>
          Effect.gen(function* () {
            if (e._tag === "snapshot") return yield* Deferred.succeed(ready, undefined)
            events.push(e)
            if (e._tag === "approval") openWhileWaiting = yield* c.approvals()
            if (e._tag === "approval" && onApproval) yield* c.decide({ approvalId: e.approval.id, outcome: onApproval(e.approval) ? "approved" : "denied" })
            if (e._tag === "turn-completed" || e._tag === "turn-failed" || e._tag === "interrupted") ended++
            if (e._tag === "status" && e.status.state === "idle" && ended) yield* Deferred.succeed(idle, undefined)
          })
        ),
        Effect.forkChild
      )
      yield* Deferred.await(ready)
      yield* c.send({ chatId, clientId: crypto.randomUUID(), ...body })
      yield* Deferred.await(idle).pipe(Effect.timeout("5 seconds"))
      yield* Fiber.interrupt(fiber)
      return { events, openWhileWaiting }
    })
  )
}
const dones = (events: ChatEvent[]): Message[] => events.flatMap((e) => ((e._tag === "turn-completed" || e._tag === "turn-failed") && e.message ? [e.message] : []))

test("projeto → agente → chat: streaming, contexto em camadas, troca de modelo, consolidação com memórias e skills", async () => {
  const project = await api((c) => c.projects.create({ payload: { name: "Site", brief: "Landing em Astro." } }))
  const agent = await api((c) => c.agents.create({ payload: { projectId: project.id, name: "Dev", instructions: "Escreve código enxuto.", model: "claude-cli/sonnet" } }))
  await api((c) => c.memories.create({ payload: { scope: "user", kind: "fact", title: "", text: "Prefere respostas curtas" } }))
  const chat = await api((c) => c.chats.create({ payload: { projectId: project.id, agentIds: [agent.id], model: "claude-cli/sonnet" } }))

  const first = await send(chat.id, { text: "oi" })
  expect(first.events.map((e) => e._tag)).toEqual(["message", "queued", "turn-started", "status", "text", "turn-completed", "status"])
  expect(dones(first.events)[0]).toMatchObject({ role: "assistant", agentId: agent.id, text: "eco: oi", model: "claude-cli/sonnet", inputTokens: 10 })
  const t1 = turns.at(-1)!
  for (const s of ["Landing em Astro.", "Escreve código enxuto.", "Prefere respostas curtas"]) expect(t1.system).toContain(s)
  expect(t1.tools?.defs.map((d) => d.name).every(zeroOwn)).toBe(true) // no MCP server: only Zero's own (browser, team)

  await send(chat.id, { text: "e agora?", model: "anthropic/claude-sonnet-5-5" })
  expect(turns.at(-1)!.model).toBe("anthropic/claude-sonnet-5-5")
  expect(turns.at(-1)!.messages.map((m) => m.text)).toEqual(["oi", "eco: oi", "e agora?"])

  const compacted = await api((c) => c.chats.consolidate({ params: { id: chat.id } }))
  expect(compacted.summary).toBe("Falaram de deploy.")
  const pending = (await api((c) => c.memories.list())).filter((m) => m.state === "pending")
  expect(pending.map((m) => [m.kind, m.scope, m.title || m.text])).toEqual([
    ["skill", `project:${project.id}`, "Publicar o site"],
    ["fact", `project:${project.id}`, "Deploy é na Vercel"]
  ])

  await send(chat.id, { text: "como publico?" })
  expect(turns.at(-1)!.system).toContain("Falaram de deploy.")
  expect(turns.at(-1)!.system).not.toContain("Deploy é na Vercel") // pending doesn't get in
  expect(turns.at(-1)!.messages.map((m) => m.text)).toEqual(["como publico?"])

  for (const m of pending) await api((c) => c.memories.update({ params: { id: m.id }, payload: { state: "active" } }))
  await send(chat.id, { text: "e para publicar o site?" })
  const sys = turns.at(-1)!.system
  expect(sys).toContain("Deploy é na Vercel")
  expect(sys).toContain("- Publicar o site") // listed
  expect(sys).toContain("vercel deploy") // relevant: full step-by-step
  expect((await api((c) => c.chats.list())).find((c) => c.id === chat.id)!.title).toBe("oi")

  // Usage: this chat's finished turns, summed per model.
  const usage = (await api((c) => c.settings.usage())).filter((u) => u.projectId === project.id)
  const byModel = Object.fromEntries(usage.map((u) => [u.model, [u.turns, u.agentId, u.inputTokens > 0]]))
  expect(byModel).toEqual({ "claude-cli/sonnet": [1, agent.id, true], "anthropic/claude-sonnet-5-5": [3, agent.id, true] }) // the switch sticks to the chat
  // Cost: priced from the catalog; the subscription row is the API equivalent (claude-cli/sonnet → newest Sonnet).
  const billed = Object.fromEntries(usage.map((u) => [u.model, [u.billing, (u.cost ?? 0) > 0]]))
  expect(billed).toEqual({ "claude-cli/sonnet": ["subscription", true], "anthropic/claude-sonnet-5-5": ["api", true] })
  const top = await api((c) => c.settings.topTurns({ query: { since: 0 } }))
  expect(top[0]!.cost).toBeGreaterThan(0)
  expect(top.every((t, i) => i === 0 || t.cost <= top[i - 1]!.cost)).toBe(true)
})

test("canal: @menção escolhe quem responde; agente passa a vez mencionando outro; limite de repasses", async () => {
  const project = await api((c) => c.projects.create({ payload: { name: "Canal", brief: "" } }))
  const mk = (name: string, model: string) => api((c) => c.agents.create({ payload: { projectId: project.id, name, instructions: `Sou ${name}.`, model } }))
  const [lia, leo, nico] = [await mk("Lia", "claude-cli/haiku"), await mk("Leo", "codex-cli/default"), await mk("Nico", "ollama/llama3")]
  const chat = await api((c) => c.chats.create({ payload: { projectId: project.id, agentIds: [lia.id, leo.id, nico.id], model: "claude-cli/sonnet" } }))

  // no mention: leader (Lia) with the chat model
  let r = await send(chat.id, { text: "bom dia" })
  expect(dones(r.events).map((m) => [m.agentId, m.model])).toEqual([[lia.id, "claude-cli/sonnet"]])
  expect(turns.at(-1)!.system).toContain("@leo (Leo)")

  // direct mention: Leo with his model; Leo hands off to @nico, who sees Leo's line with his name
  mentionNext.set("Leo", "achei o bug, @nico revisa?")
  r = await send(chat.id, { text: "@leo investiga o erro" })
  expect(dones(r.events).map((m) => [m.agentId, m.model])).toEqual([[leo.id, "codex-cli/default"], [nico.id, "ollama/llama3"]])
  expect(turns.at(-1)!.messages.at(-1)).toMatchObject({ role: "user", text: "[Leo]\nachei o bug, @nico revisa?" })

  // ping-pong stops at the limit
  mentionNext.set("Nico", "@leo de novo")
  mentionNext.set("Leo", "@nico de novo")
  r = await send(chat.id, { text: "@leo vai" })
  expect(dones(r.events)).toHaveLength(3) // Leo → Nico → Leo and stops
  mentionNext.clear()
})

test("ferramentas MCP: modo leitura esconde escrita; modo aprovação pede e respeita a decisão", async () => {
  const project = await api((c) => c.projects.create({ payload: { name: "Docs", brief: "" } }))
  const server = await api((c) => c.tools.create({ payload: { projectId: project.id, name: "docs", command: "", args: [], url: `http://localhost:${mcp.port}/mcp`, env: { Authorization: "Bearer x" }, mode: "read" } }))
  expect(server.envKeys).toEqual(["Authorization"])
  const inspected = await api((c) => c.tools.inspect({ params: { id: server.id } }))
  expect(inspected).toEqual({ tools: [{ name: "search_docs", description: "Busca na documentação", cls: "read" }, { name: "delete_page", description: "Apaga uma página", cls: "sensitive" }], error: null })

  const chat = await api((c) => c.chats.create({ payload: { projectId: project.id, agentIds: [], model: "claude-cli/sonnet" } }))
  let r = await send(chat.id, { text: "tool:docs__search_docs" })
  let msg = dones(r.events)[0]!
  expect(msg.text).toBe("docs__search_docs => resultado de search_docs") // only the read one listed
  expect(msg.steps).toEqual([{ tool: "docs__search_docs", args: '{"q":"deploy"}', status: "ok", result: "resultado de search_docs" }])

  await api((c) => c.tools.update({ params: { id: server.id }, payload: { mode: "approve" } }))
  r = await send(chat.id, { text: "tool:docs__delete_page" }, () => false)
  msg = dones(r.events)[0]!
  expect(r.events.some((e) => e._tag === "approval" && e.approval.tool === "docs__delete_page")).toBe(true)
  expect(r.events.some((e) => e._tag === "approval-resolved" && e.outcome === "denied")).toBe(true)
  expect(r.openWhileWaiting.map((a) => [a.chatId, a.tool])).toEqual([[chat.id, "docs__delete_page"]])
  expect(await rpc((c) => c.approvals())).toEqual([]) // decided: gone from "Needs you"
  expect(msg.text).toContain("O usuário recusou")
  expect(msg.steps.at(-1)!.status).toBe("refused")
  expect(toolCalls).toEqual(["search_docs"]) // denied one never reached the server

  r = await send(chat.id, { text: "tool:docs__delete_page" }, () => true)
  expect(dones(r.events)[0]!.text).toContain("resultado de delete_page")
  expect(toolCalls).toEqual(["search_docs", "delete_page"])

  // chat outside the project doesn't see the server
  const other = await api((c) => c.chats.create({ payload: { projectId: null, agentIds: [], model: "claude-cli/sonnet" } }))
  await send(other.id, { text: "oi" })
  expect(turns.at(-1)!.tools?.defs.map((d) => d.name).every(zeroOwn)).toBe(true)
})

test("chaves de API: salvas pela interface, nunca devolvidas; nome desconhecido 404", async () => {
  await api((c) => c.settings.setKey({ params: { name: "OPENROUTER_API_KEY" }, payload: { value: "sk-or-123" } }))
  const keys = await api((c) => c.settings.keys())
  expect(keys.find((k) => k.name === "OPENROUTER_API_KEY")).toEqual({ name: "OPENROUTER_API_KEY", set: true, fromEnv: false })
  expect(JSON.stringify(keys)).not.toContain("sk-or-123")
  expect((await api((c) => c.settings.models())).find((m) => m.provider === "openrouter")!.available).toBe(true)
  const res = await fetch(`${base}/api/keys/PATH`, { method: "PUT", headers: { "content-type": "application/json" }, body: '{"value":"x"}' })
  expect(res.status).toBe(404)
})

test("erros na fronteira: entrada inválida 400, chat inexistente 404, agente de outro projeto 404", async () => {
  const chat = await api((c) => c.chats.create({ payload: { projectId: null, agentIds: [], model: "ollama/llama3" } }))
  const sendExit = (chatId: string, text: string, model?: string) =>
    rpc((c) => Effect.exit(c.send({ chatId, clientId: crypto.randomUUID(), text, ...(model && { model }) } as never)))
  expect(Exit.isFailure(await sendExit(chat.id, "   "))).toBe(true) // empty text: rejected by the schema
  expect(Exit.isFailure(await sendExit(chat.id, "oi", "sem-barra"))).toBe(true)
  const missing = await sendExit("nao-existe", "oi")
  expect(JSON.stringify(missing)).toContain("ChatNotFound")

  const other = await api((c) => c.projects.create({ payload: { name: "Outro", brief: "" } }))
  const foreign = await api((c) => c.agents.create({ payload: { projectId: other.id, name: "X", instructions: "", model: "ollama/llama3" } }))
  const res = await fetch(`${base}/api/chats`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: null, agentIds: [foreign.id], model: "ollama/llama3" }) })
  expect(res.status).toBe(404)
})

test("só local: Host estranho (DNS rebinding) e Origin de outro site (CSRF) recebem 403", async () => {
  const { isLocalRequest } = await import("./main.ts")
  expect(isLocalRequest({ host: "localhost:5173" })).toBe(true)
  expect(isLocalRequest({ host: "127.0.0.1:4317", origin: "http://127.0.0.1:4317" })).toBe(true)
  expect(isLocalRequest({ host: "evil.example:4317" })).toBe(false)
  expect(isLocalRequest({ host: "localhost:4317", origin: "https://evil.example" })).toBe(false)
  expect(isLocalRequest({ host: "localhost:4317", origin: "null" })).toBe(false)
  expect(isLocalRequest({})).toBe(false)

  // "Simple" POST (text/plain) from another page and WebSocket from another origin: blocked before any effect.
  const res = await fetch(`${base}/api/projects`, { method: "POST", headers: { "content-type": "text/plain", origin: "https://evil.example" }, body: '{"name":"x","brief":""}' })
  expect(res.status).toBe(403)
  expect((await fetch(`${base}/rpc`, { headers: { origin: "https://evil.example", upgrade: "websocket", connection: "Upgrade" } })).status).toBe(403)
  expect((await fetch(`${base}/api/projects`, { headers: { origin: "https://evil.example" } })).status).toBe(403)
  expect((await fetch(`${base}/api/projects`, { headers: { origin: base } })).status).toBe(200)
})

test("aprendizado: esquecidas vão para a consolidação e podem ser restauradas; teto de 20 pendentes", async () => {
  const forgotten = await api((c) => c.memories.create({ payload: { scope: "user", kind: "fact", title: "", text: "Gosta de emojis" } }))
  await api((c) => c.memories.update({ params: { id: forgotten.id }, payload: { state: "forgotten" } }))
  const chat = await api((c) => c.chats.create({ payload: { projectId: null, agentIds: [], model: "ollama/llama3" } }))
  await send(chat.id, { text: "oi" })

  manyMemories = 25
  const before = (await api((c) => c.memories.list())).filter((m) => m.state === "pending" && m.scope === "user").length
  await api((c) => c.chats.consolidate({ params: { id: chat.id } }))
  manyMemories = 0
  expect(turns.at(-1)!.messages[0]!.text).toContain("mandou esquecer (não proponha de novo, nem com outras palavras):\n- Gosta de emojis")
  const pending = (await api((c) => c.memories.list())).filter((m) => m.state === "pending" && m.scope === "user")
  expect(pending.length).toBe(Math.max(before, 20))

  // way back: the forgotten one stays listed and becomes active again
  expect((await api((c) => c.memories.list())).find((m) => m.id === forgotten.id)!.state).toBe("forgotten")
  await api((c) => c.memories.update({ params: { id: forgotten.id }, payload: { state: "active" } }))
  await send(chat.id, { text: "e aí" })
  expect(turns.at(-1)!.system).toContain("Gosta de emojis")
})

test("contas: padrão criadas sozinhas e não removíveis; extra ganha pasta própria e some com ela", async () => {
  const list = await api((c) => c.accounts.list())
  expect(list.filter((a) => a.isDefault).map((a) => a.provider).sort()).toEqual(["claude", "codex"])
  const extra = await api((c) => c.accounts.create({ payload: { provider: "codex", label: "Codex trabalho" } }))
  expect(extra).toMatchObject({ provider: "codex", isDefault: false, loggedIn: false })
  expect((await api((c) => c.accounts.update({ params: { id: extra.id }, payload: { label: "Codex 2" } }))).label).toBe("Codex 2")
  const home = join(tmpdir(), "zero-test", "accounts", extra.id)
  expect(require("node:fs").existsSync(home)).toBe(true) // each extra account gets its own login folder
  const def = list.find((a) => a.provider === "claude" && a.isDefault)!
  expect((await fetch(`${base}/api/accounts/${def.id}`, { method: "DELETE" })).status).toBe(409)
  expect((await fetch(`${base}/api/accounts/${extra.id}`, { method: "DELETE" })).status).toBe(204)
  expect(require("node:fs").existsSync(home)).toBe(false)
}, 20_000) // runs the real claude/codex status commands, whose latency depends on the machine

test("anexos: upload, mensagem com arquivos, o engine recebe caminhos; texto inline, imagem pelo nome; apagar o chat apaga os arquivos", async () => {
  const chat = await api((c) => c.chats.create({ payload: { projectId: null, agentIds: [], model: "ollama/llama3" } }))
  const up = async (name: string, mime: string, body: BodyInit) => {
    const r = await fetch(`${base}/api/chats/${chat.id}/attachments`, { method: "POST", headers: { "content-type": mime, "x-file-name": encodeURIComponent(name) }, body })
    return { status: r.status, json: (await r.json()) as { id: string; name: string; size: number } }
  }
  const note = await up("notas do projeto.md", "text/markdown", "# Deploy\nVercel às sextas")
  const png = await up("tela.png", "image/png", new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))
  expect(note.status).toBe(200)
  expect(note.json).toMatchObject({ name: "notas do projeto.md", size: 26 }) // bytes, not characters
  expect((await up("grande.bin", "application/octet-stream", new Uint8Array(20 * 1024 * 1024 + 1))).status).toBe(413)

  const r = await send(chat.id, { text: "veja os anexos", attachmentIds: [note.json.id, png.json.id] })
  const user = r.events.find((e) => e._tag === "message")
  expect(user && user._tag === "message" && user.message.attachments.map((a) => a.name)).toEqual(["notas do projeto.md", "tela.png"])
  const files = turns.at(-1)!.messages.at(-1)!.files!
  expect(files.map((f) => [f.name, f.mime])).toEqual([["notas do projeto.md", "text/markdown"], ["tela.png", "image/png"]])
  const { transcript } = await import("./engines.ts")
  const text = transcript(turns.at(-1)!.messages)
  expect(text).toContain("Vercel às sextas") // small text file inline
  expect(text).toContain("[imagem anexada: tela.png]")

  const served = await fetch(`${base}/api/attachments/${note.json.id}`)
  expect(served.headers.get("content-type")).toContain("text/markdown")
  expect(await served.text()).toBe("# Deploy\nVercel às sextas")

  const dir = join(tmpdir(), "zero-test", "attachments", chat.id)
  expect(require("node:fs").existsSync(dir)).toBe(true)
  await api((c) => c.chats.remove({ params: { id: chat.id } }))
  expect(require("node:fs").existsSync(dir)).toBe(false)
})

test("ordem da barra lateral: projetos na ordem dada (novos no topo); chats só reordenam dentro do próprio grupo", async () => {
  const a = await api((c) => c.projects.create({ payload: { name: "A", brief: "" } }))
  const b = await api((c) => c.projects.create({ payload: { name: "B", brief: "" } }))
  await api((c) => c.projects.reorder({ payload: { ids: [a.id, b.id] } }))
  const fresh = await api((c) => c.projects.create({ payload: { name: "Novo", brief: "" } }))
  const ids = (await api((c) => c.projects.list())).map((p) => p.id)
  expect(ids.indexOf(fresh.id)).toBeLessThan(ids.indexOf(a.id)) // not placed yet: on top
  expect(ids.indexOf(a.id)).toBeLessThan(ids.indexOf(b.id))

  const inA = await api((c) => c.chats.create({ payload: { projectId: a.id, agentIds: [], model: "ollama/llama3" } }))
  const inB = await api((c) => c.chats.create({ payload: { projectId: b.id, agentIds: [], model: "ollama/llama3" } }))
  await api((c) => c.chats.reorder({ payload: { projectId: a.id, ids: [inB.id, inA.id] } }))
  const chats = await api((c) => c.chats.list())
  const after = (id: string) => chats.find((x) => x.id === id)!
  expect(after(inA.id).position).toBe(1)
  expect(after(inB.id).position).toBeNull() // another project's chat is ignored
  expect(after(inB.id).projectId).toBe(b.id) // and never moves
})

test("audit log: mudanças com antes → depois; chave de API só pelo nome, nunca o valor", async () => {
  const agent = await api((c) => c.agents.create({ payload: { projectId: null, name: "Auditado", instructions: "", model: "ollama/llama3" } }))
  await api((c) => c.agents.update({ params: { id: agent.id }, payload: { model: "ollama/qwen", name: "Auditado" } }))
  await api((c) => c.agents.update({ params: { id: agent.id }, payload: { model: "ollama/llama3" } }))
  await api((c) => c.agents.update({ params: { id: agent.id }, payload: { model: "ollama/qwen" } })) // the same change again, at once: kept too
  await api((c) => c.settings.setKey({ params: { name: "OPENROUTER_API_KEY" }, payload: { value: "sk-super-secreta" } }))
  await api((c) => c.settings.setKey({ params: { name: "OPENROUTER_API_KEY" }, payload: { value: "" } }))
  const log = (await api((c) => c.settings.audit({ query: {} }))).entries
  const updates = log.filter((e) => e.action === "agent.updated" && e.target.id === agent.id)
  expect(updates).toHaveLength(3)
  const update = updates.at(-1)!
  expect(update.actor).toEqual({ type: "user", id: "local" })
  expect(update.changes).toEqual([{ field: "model", before: "ollama/llama3", after: "ollama/qwen" }]) // the unchanged name is left out
  expect(log.some((e) => e.action === "agent.created" && e.target.name === "Auditado")).toBe(true)
  expect(log.filter((e) => e.target.id === "OPENROUTER_API_KEY").map((e) => e.action).slice(0, 2)).toEqual(["api_key.cleared", "api_key.set"]) // newest first
  expect(JSON.stringify(log)).not.toContain("sk-super-secreta")

  // Narrowed: by kind, by words, by time; paged with the total.
  const providers = await api((c) => c.settings.audit({ query: { kind: "providers" } }))
  expect(providers.entries.length).toBeGreaterThan(0)
  expect(providers.entries.every((e) => e.action.startsWith("api_key.") || e.action.startsWith("account.") || e.action.startsWith("failover_terms."))).toBe(true)
  const words = await api((c) => c.settings.audit({ query: { q: "Auditado" } }))
  expect(words.entries.length).toBeGreaterThan(0)
  expect(words.entries.every((e) => e.target.name === "Auditado")).toBe(true)
  expect((await api((c) => c.settings.audit({ query: { q: "100%_nada" } }))).total).toBe(0) // LIKE wildcards are literal
  expect((await api((c) => c.settings.audit({ query: { from: Date.now() + 60_000 } }))).total).toBe(0)
  const all = await api((c) => c.settings.audit({ query: {} }))
  expect(all.pageSize).toBe(50)
  expect(all.total).toBeGreaterThanOrEqual(all.entries.length)
  expect((await api((c) => c.settings.audit({ query: { page: 99 } }))).entries).toHaveLength(0)
})

test("armazenamento: mede a pasta de dados; limpar só remove pastas de chats e projetos que não existem mais", async () => {
  const dir = join(tmpdir(), "zero-test")
  const live = await api((c) => c.chats.create({ payload: { projectId: null, agentIds: [], model: "ollama/llama3" } }))
  mkdirSync(join(dir, "runs", live.id), { recursive: true })
  writeFileSync(join(dir, "runs", live.id, "notes.md"), "x".repeat(2048))
  mkdirSync(join(dir, "runs", "chat-apagado"), { recursive: true })
  writeFileSync(join(dir, "runs", "chat-apagado", "big.bin"), "x".repeat(4096))

  const report = await api((c) => c.settings.storage())
  expect(report.total).toBeGreaterThan(0)
  expect(report.cleanup.find((c) => c.id === "orphans")!.bytes).toBeGreaterThanOrEqual(4096)
  expect(report.chats.find((c) => c.id === live.id)?.bytes).toBe(2048)

  const after = await api((c) => c.settings.cleanStorage({ params: { id: "orphans" } }))
  expect(after.cleanup.find((c) => c.id === "orphans")!.bytes).toBe(0)
  expect(existsSync(join(dir, "runs", "chat-apagado"))).toBe(false)
  expect(existsSync(join(dir, "runs", live.id, "notes.md"))).toBe(true) // a live chat's folder stays
  expect((await api((c) => c.settings.audit({ query: {} }))).entries.some((e) => e.action === "storage.cleaned" && e.target.id === "orphans")).toBe(true)
})

test("terminal: abrir arquivo só dentro da pasta do chat; sem shells, a lista vem vazia", async () => {
  const chat = await api((c) => c.chats.create({ payload: { projectId: null, agentIds: [], model: "ollama/llama3" } }))
  expect(await api((c) => c.chats.terminals({ params: { id: chat.id } }))).toEqual([])
  const open = (path: string) => api((c) => Effect.exit(c.chats.openFile({ params: { id: chat.id }, payload: { path } })))
  expect(Exit.isFailure(await open("../../../etc/hosts"))).toBe(true) // outside the chat's folder
  expect(Exit.isFailure(await open("nao-existe.txt"))).toBe(true)
})

test("contexto: estima o próximo turno parte por parte; mensagens contam", async () => {
  const chat = await api((c) => c.chats.create({ payload: { projectId: null, agentIds: [], model: "ollama/llama3" } }))
  const empty = await api((c) => c.chats.context({ params: { id: chat.id } }))
  await rpc((c) => c.send({ chatId: chat.id, clientId: crypto.randomUUID(), text: "x".repeat(400) }))
  for (let i = 0; i < 50 && (await api((c) => c.chats.messages({ params: { id: chat.id } }))).length < 2; i++) await Bun.sleep(20)
  const after = await api((c) => c.chats.context({ params: { id: chat.id } }))
  const messages = (u: typeof after) => u.parts.find((p) => p.id === "messages")!.tokens
  expect(messages(after)).toBeGreaterThanOrEqual(messages(empty) + 100) // 400 characters ≈ 100 tokens
  expect(after.usedTokens).toBe(after.parts.reduce((n, p) => n + p.tokens, 0))
  expect(after.compactAfter).toBe(50)
  expect(after.messagesSinceSummary).toBeGreaterThanOrEqual(2)
})
