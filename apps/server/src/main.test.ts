// Ponta a ponta pelo contrato: server real (Bun) + client tipado, com um engine falso que grava os turnos
// e, quando pedido, chama ferramentas pela URL do gateway MCP — exatamente como uma CLI faria.
import { afterAll, beforeAll, expect, test } from "bun:test"
import { BunHttpServer } from "@effect/platform-bun"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { Api, type SendEvent } from "@zero/contracts"
import { Effect, Fiber, Layer, Stream } from "effect"
import { FetchHttpClient, HttpRouter } from "effect/http"
import { HttpApiClient } from "effect/http-api"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DataDir } from "./chat.ts"
import { CONSOLIDATION_SYSTEM } from "./context.ts"
import { Store } from "./db.ts"
import { Engines, type EngineEvent, type Turn } from "./engines.ts"
import { AppLive } from "./main.ts"
import { Secrets } from "./secrets.ts"
import { Tools } from "./tools.ts"

// ---------- servidor MCP de teste ----------
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

// ---------- engine falso ----------
const turns: Turn[] = []
const mentionNext = new Map<string, string>() // texto da resposta por nome de agente (para testar repasse)

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
    if (t.system === CONSOLIDATION_SYSTEM)
      return Stream.make(
        { type: "text" as const, delta: JSON.stringify({ summary: "Falaram de deploy.", memories: [{ scope: "project", text: "Deploy é na Vercel" }, { scope: "team", text: "fora do escopo" }], skills: [{ scope: "project", title: "Publicar o site", text: "1. bun run build\n2. vercel deploy" }] }) },
        { type: "done" as const, usage: { inputTokens: 1, outputTokens: 1 } }
      )
    const last = t.messages.at(-1)!.text
    const me = /## Você é (.+)\n/.exec(t.system)?.[1]
    const tool = /^tool:(\S+)/.exec(last)?.[1]
    if (tool)
      return Stream.fromEffect(Effect.promise(() => useTool(t, tool, { q: "deploy" }))).pipe(
        Stream.flatMap((r) => Stream.make<EngineEvent[]>({ type: "text", delta: `${r.listed.join(",")} => ${r.text}` }, { type: "done", usage: { inputTokens: 1, outputTokens: 1 } }))
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
  const services = Layer.mergeAll(Layer.provideMerge(Layer.mergeAll(FakeEngines, Tools.layer), secrets), DataDir.layer(join(tmpdir(), "zero-test")))
  const server = AppLive().pipe(HttpRouter.serve, Layer.provide(services), Layer.provide(BunHttpServer.layer({ port })))
  const fiber = Effect.runFork(Layer.launch(server))
  stop = () => Effect.runPromise(Fiber.interrupt(fiber)).then(() => void mcp.stop(true))
  for (let i = 0; i < 50 && !(await fetch(`${base}/api/models`).catch(() => null)); i++) await Bun.sleep(20)
})
afterAll(() => stop())

const api = <A, E>(f: (c: HttpApiClient.ForApi<typeof Api>) => Effect.Effect<A, E>) =>
  Effect.runPromise(Effect.flatMap(HttpApiClient.make(Api, { baseUrl: base }), f).pipe(Effect.provide(FetchHttpClient.layer)))

// Envia e lê o SSE; `onApproval` decide pedidos de aprovação enquanto o turno espera.
async function send(chatId: string, body: unknown, onApproval?: (e: Extract<SendEvent, { type: "approval" }>) => boolean) {
  const res = await fetch(`${base}/api/chats/${chatId}/send`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  const events: SendEvent[] = []
  if (!res.body) return { status: res.status, events }
  let buf = ""
  for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
    buf += chunk
    let i: number
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const line = buf.slice(0, i)
      buf = buf.slice(i + 2)
      if (!line.startsWith("data: ")) continue
      const ev = JSON.parse(line.slice(6)) as SendEvent
      events.push(ev)
      if (ev.type === "approval" && onApproval) await api((c) => c.tools.decide({ params: { id: ev.id }, payload: { approve: onApproval(ev) } }))
    }
  }
  return { status: res.status, events }
}
const dones = (events: SendEvent[]) => events.flatMap((e) => (e.type === "done" ? [e.message] : []))

test("projeto → agente → chat: streaming, contexto em camadas, troca de modelo, consolidação com memórias e skills", async () => {
  const project = await api((c) => c.projects.create({ payload: { name: "Site", brief: "Landing em Astro." } }))
  const agent = await api((c) => c.agents.create({ payload: { projectId: project.id, name: "Dev", instructions: "Escreve código enxuto.", model: "claude-cli/sonnet" } }))
  await api((c) => c.memories.create({ payload: { scope: "user", kind: "fact", title: "", text: "Prefere respostas curtas" } }))
  const chat = await api((c) => c.chats.create({ payload: { projectId: project.id, agentIds: [agent.id], model: "claude-cli/sonnet" } }))

  const first = await send(chat.id, { text: "oi" })
  expect(first.status).toBe(200)
  expect(first.events.map((e) => e.type)).toEqual(["user", "start", "text", "done"])
  expect(dones(first.events)[0]).toMatchObject({ role: "assistant", agentId: agent.id, text: "eco: oi", model: "claude-cli/sonnet", inputTokens: 10 })
  const t1 = turns.at(-1)!
  for (const s of ["Landing em Astro.", "Escreve código enxuto.", "Prefere respostas curtas"]) expect(t1.system).toContain(s)
  expect(t1.tools).toBeUndefined()

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
  expect(turns.at(-1)!.system).not.toContain("Deploy é na Vercel") // pendente não entra
  expect(turns.at(-1)!.messages.map((m) => m.text)).toEqual(["como publico?"])

  for (const m of pending) await api((c) => c.memories.update({ params: { id: m.id }, payload: { state: "active" } }))
  await send(chat.id, { text: "e para publicar o site?" })
  const sys = turns.at(-1)!.system
  expect(sys).toContain("Deploy é na Vercel")
  expect(sys).toContain("- Publicar o site") // listada
  expect(sys).toContain("vercel deploy") // relevante: passo a passo inteiro
  expect((await api((c) => c.chats.list())).find((c) => c.id === chat.id)!.title).toBe("oi")
})

test("canal: @menção escolhe quem responde; agente passa a vez mencionando outro; limite de repasses", async () => {
  const project = await api((c) => c.projects.create({ payload: { name: "Canal", brief: "" } }))
  const mk = (name: string, model: string) => api((c) => c.agents.create({ payload: { projectId: project.id, name, instructions: `Sou ${name}.`, model } }))
  const [lia, leo, nico] = [await mk("Lia", "claude-cli/haiku"), await mk("Leo", "codex-cli/default"), await mk("Nico", "ollama/llama3")]
  const chat = await api((c) => c.chats.create({ payload: { projectId: project.id, agentIds: [lia.id, leo.id, nico.id], model: "claude-cli/sonnet" } }))

  // sem menção: líder (Lia) com o modelo do chat
  let r = await send(chat.id, { text: "bom dia" })
  expect(dones(r.events).map((m) => [m.agentId, m.model])).toEqual([[lia.id, "claude-cli/sonnet"]])
  expect(turns.at(-1)!.system).toContain("@leo (Leo)")

  // menção direta: Leo com o modelo dele; Leo passa para @nico, que vê a fala do Leo com nome
  mentionNext.set("Leo", "achei o bug, @nico revisa?")
  r = await send(chat.id, { text: "@leo investiga o erro" })
  expect(dones(r.events).map((m) => [m.agentId, m.model])).toEqual([[leo.id, "codex-cli/default"], [nico.id, "ollama/llama3"]])
  expect(turns.at(-1)!.messages.at(-1)).toEqual({ role: "user", text: "[Leo]\nachei o bug, @nico revisa?" })

  // ping-pong para no limite
  mentionNext.set("Nico", "@leo de novo")
  mentionNext.set("Leo", "@nico de novo")
  r = await send(chat.id, { text: "@leo vai" })
  expect(dones(r.events)).toHaveLength(3)
  expect(r.events.at(-1)).toMatchObject({ type: "error" })
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
  expect(msg.text).toBe("docs__search_docs => resultado de search_docs") // só a de leitura listada
  expect(msg.steps).toEqual([{ tool: "docs__search_docs", args: '{"q":"deploy"}', status: "ok", result: "resultado de search_docs" }])

  await api((c) => c.tools.update({ params: { id: server.id }, payload: { mode: "approve" } }))
  r = await send(chat.id, { text: "tool:docs__delete_page" }, () => false)
  msg = dones(r.events)[0]!
  expect(r.events.some((e) => e.type === "approval" && e.tool === "docs__delete_page")).toBe(true)
  expect(msg.text).toContain("O usuário recusou")
  expect(msg.steps.at(-1)!.status).toBe("refused")
  expect(toolCalls).toEqual(["search_docs"]) // recusada não chegou ao servidor

  r = await send(chat.id, { text: "tool:docs__delete_page" }, () => true)
  expect(dones(r.events)[0]!.text).toContain("resultado de delete_page")
  expect(toolCalls).toEqual(["search_docs", "delete_page"])

  // chat fora do projeto não enxerga o servidor
  const other = await api((c) => c.chats.create({ payload: { projectId: null, agentIds: [], model: "claude-cli/sonnet" } }))
  await send(other.id, { text: "oi" })
  expect(turns.at(-1)!.tools).toBeUndefined()
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
  expect((await send(chat.id, { text: "   " })).status).toBe(400)
  expect((await send(chat.id, { text: "oi", model: "sem-barra" })).status).toBe(400)
  expect((await send("nao-existe", { text: "oi" })).status).toBe(404)

  const other = await api((c) => c.projects.create({ payload: { name: "Outro", brief: "" } }))
  const foreign = await api((c) => c.agents.create({ payload: { projectId: other.id, name: "X", instructions: "", model: "ollama/llama3" } }))
  const res = await fetch(`${base}/api/chats`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: null, agentIds: [foreign.id], model: "ollama/llama3" }) })
  expect(res.status).toBe(404)
})
