// End to end through the contract: real server (Bun) + typed client, with a fake engine that records turns
// and, when asked, calls tools through the MCP gateway URL — exactly like a CLI would.
import { afterAll, beforeAll, expect, test } from "bun:test"
import { BunHttpServer } from "@effect/platform-bun"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { Api, type Message } from "@zorel/contracts"
import { type Approval, type ChatEvent, type Notice, ZorelRpc } from "@zorel/contracts/events"
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Stream } from "effect"
import { FetchHttpClient, HttpRouter } from "effect/http"
import { HttpApiClient } from "effect/http-api"
import { RpcClient, RpcSerialization } from "effect/rpc"
import { Socket } from "effect/socket"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DataDir, DbPath } from "./chat.ts"
import { CONSOLIDATION_SYSTEM } from "./context.ts"
import { Store } from "./db.ts"
import { Engines, type EngineEvent, type Turn } from "./engines.ts"
import { AppLive, SESSION } from "./main.ts"
import { LOGIN_PATH, SESSION_HEADER } from "@zorel/contracts/session"
import { snippet } from "./context.ts"
import { Accounts } from "./accounts.ts"
import { Audit } from "./audit.ts"
import { BrowserService } from "./browser.ts"
import { Actor } from "./access.ts"
import { Runtime } from "./runtime.ts"
import { Secrets } from "./secrets.ts"
import { Tools } from "./tools.ts"
import { Pricing } from "./pricing.ts"
import { Workspace } from "./workspace.ts"

// Zorel's own tools (the chat's browser, the team), always offered next to the MCP ones.
const zorelOwn = (n: string) => n.startsWith("browser_") || n.startsWith("zorel_")

// Prices for tests (USD per million tokens): no network.
const PRICES = { anthropic: { "claude-sonnet-5-5": { cost: { input: 2, output: 10, cache_read: 0.1 }, family: "claude-sonnet", release_date: "2026-09-28" } } }

// ---------- test MCP server ----------
const toolCalls: string[] = []
let manyTools = 0 // > 0: the server also lists this many filler tools (deferred tools)
const mcp = Bun.serve({
  port: 0,
  async fetch(req) {
    const server = new Server({ name: "docs", version: "1" }, { capabilities: { tools: {} } })
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        { name: "search_docs", description: "Searches the docs", inputSchema: { type: "object", properties: { q: { type: "string" } } } },
        { name: "delete_page", description: "Deletes a page", inputSchema: { type: "object", properties: { id: { type: "string" } } } },
        ...Array.from({ length: manyTools }, (_, i) => ({ name: `get_report_${i}`, description: `Gets report number ${i} of the quarterly finance dashboard, with every column described at length so the definitions weigh what real servers' do.`, inputSchema: { type: "object", properties: { period: { type: "string" } } } }))
      ]
    }))
    server.setRequestHandler(CallToolRequestSchema, async (r) => {
      toolCalls.push(r.params.name)
      return { content: [{ type: "text", text: `result of ${r.params.name}` }] }
    })
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true })
    await server.connect(transport)
    return transport.handleRequest(req)
  }
})

// ---------- fake engine ----------
const turns: Turn[] = []
const mentionNext = new Map<string, string>() // reply text per agent name (to test handoff)
let routeNext = "" // the router's answer (empty: the fake echoes, which names no one: the fallback)
let triageNext = '{"act": false, "why": "nothing to do"}' // the cheap check's answer for routines that look first (spec 012)
let manyMemories = 0 // > 0: the fake consolidation proposes this many user memories
let manyWord = "subject" // ...worded "Likes <word><letter>x"

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
        { type: "text", delta: JSON.stringify({ summary: "S", memories: Array.from({ length: manyMemories }, (_, i) => ({ scope: "user", text: `Likes ${manyWord}${"abcdefghijklmnopqrstuvwxyz"[i]}x` /* grounded: no names or numbers the person didn't say */, evidence: [1] })) }) },
        { type: "done", usage: { inputTokens: 1, outputTokens: 1 } }
      )
    if (t.system === CONSOLIDATION_SYSTEM)
      return Stream.make(
        { type: "text" as const, delta: JSON.stringify({ summary: "They talked about deploying.", memories: [{ scope: "project", text: "Deploys go out on fridays", evidence: [1], entities: [{ name: "Deploy", type: "subject" }, { name: "Fridays", type: "concept" }], relations: [["Deploy", "happens on", "Fridays"]] }, { scope: "team", text: "out of scope", evidence: [1] }], skills: [{ scope: "project", title: "Publish the site", text: "1. bun run build\n2. vercel deploy" }] }) },
        { type: "done" as const, usage: { inputTokens: 1, outputTokens: 1 } }
      )
    const last = t.messages.at(-1)!.text
    if (last.startsWith("A routine watches for events")) return Stream.make<EngineEvent[]>({ type: "text", delta: triageNext }, { type: "done", usage: { inputTokens: 40, outputTokens: 5 } })
    if (routeNext && last.startsWith("You route a message")) return Stream.make<EngineEvent[]>({ type: "text", delta: routeNext }, { type: "done", usage: { inputTokens: 1, outputTokens: 1 } })
    const me = /## You are (.+)\n/.exec(t.system)?.[1]
    const call = /^tool:(\S+)(?:\s+(\{[\s\S]*\}))?/m.exec(last) // any line: a routine's prompt comes after its title
    const tool = call?.[1]
    if (tool)
      return Stream.fromEffect(Effect.promise(() => useTool(t, tool, call?.[2] ? JSON.parse(call[2]) : { q: "deploy" }))).pipe(
        Stream.flatMap((r) => Stream.make<EngineEvent[]>({ type: "text", delta: `${r.listed.filter((n) => !zorelOwn(n)).join(",")} => ${r.text}` }, { type: "done", usage: { inputTokens: 1, outputTokens: 1 } }))
      )
    return Stream.make<EngineEvent[]>({ type: "text", delta: (me && mentionNext.get(me)) || `echo: ${last}` }, { type: "done", usage: { inputTokens: 10, outputTokens: 3 } })
  }
})

// ---------- server ----------
const port = 40000 + Math.floor(Math.random() * 10000)
const base = `http://localhost:${port}`
let stop: () => Promise<void>

// The owner's UI sends the session secret on every request (the desktop app as a header): so do these clients.
// rawFetch is a client without it.
const rawFetch = globalThis.fetch
globalThis.fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = new Request(input, init)
  if (new URL(req.url).port === String(port) && !req.headers.has(SESSION_HEADER)) req.headers.set(SESSION_HEADER, SESSION)
  return rawFetch(req)
}, rawFetch)
const RawWebSocket = globalThis.WebSocket
globalThis.WebSocket = class extends RawWebSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, { headers: { [SESSION_HEADER]: SESSION }, ...(protocols ? { protocols: typeof protocols === "string" ? [protocols] : protocols } : {}) } as unknown as string[])
  }
} as typeof WebSocket

beforeAll(async () => {
  const store = Store.layer(":memory:")
  const secrets = Layer.provideMerge(Secrets.memory(), store)
  const core = Layer.mergeAll(Layer.provideMerge(Layer.mergeAll(FakeEngines, Tools.layer), secrets), DataDir.layer(join(tmpdir(), "zorel-test")), DbPath.layer(":memory:"))
  const services = Layer.mergeAll(Layer.provideMerge(Runtime.layer, Layer.provideMerge(Layer.mergeAll(Accounts.layer, Workspace.layer, Pricing.fixed(PRICES), Audit.layer, BrowserService.layer), core)), Actor.local)
  const server = AppLive().pipe(HttpRouter.serve, Layer.provide(services), Layer.provide(BunHttpServer.layer({ port })))
  let failed = "" // why the server stopped, if it did: otherwise every test only says "Transport error"
  const fiber = Effect.runFork(Layer.launch(server).pipe(Effect.tapCause((c) =>
      Effect.sync(() => {
        failed = Cause.pretty(c)
      })
    )))
  stop = () => Effect.runPromise(Fiber.interrupt(fiber)).then(() => void mcp.stop(true))
  // waits for the server (up to 15 s: a cold CI runner is slow)
  for (let i = 0; i < 750 && !failed && !(await fetch(`${base}/api/models`).catch(() => null)); i++) await Bun.sleep(20)
  if (failed) throw new Error(`the test server didn't start:\n${failed}`)
}, 20_000)
afterAll(() => stop())

const api = <A, E>(f: (c: HttpApiClient.ForApi<typeof Api>) => Effect.Effect<A, E>) =>
  Effect.runPromise(Effect.flatMap(HttpApiClient.make(Api, { baseUrl: base }), f).pipe(Effect.provide(FetchHttpClient.layer), Effect.provideService(FetchHttpClient.Fetch, globalThis.fetch)))

// Real RPC client (WebSocket at /rpc), as the web uses it.
const rpcLayer = () =>
  RpcClient.layerProtocolSocket().pipe(
    Layer.provide(Socket.layerWebSocket(`ws://localhost:${port}/rpc`)),
    Layer.provide(Socket.layerWebSocketConstructorGlobal),
    Layer.provide(RpcSerialization.layerJson)
  )
type Rpc = Effect.Success<ReturnType<typeof RpcClient.make<typeof ZorelRpc extends { requests: ReadonlyMap<string, infer R> } ? R : never>>>
const rpc = <A, E>(f: (c: Rpc) => Effect.Effect<A, E>) =>
  Effect.runPromise(Effect.scoped(Effect.flatMap(RpcClient.make(ZorelRpc), (c) => f(c as Rpc))).pipe(Effect.provide(rpcLayer())))

// Subscribes to the chat, sends and waits for the chat to go idle again. `onApproval` decides requests while the turn waits.
async function send(chatId: string, body: { text: string; model?: string; attachmentIds?: string[] }, onApproval?: (a: Approval) => boolean | "always") {
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
            if (e._tag === "approval" && onApproval) {
              const o = onApproval(e.approval)
              yield* c.decide({ approvalId: e.approval.id, outcome: o === "always" ? "always" : o ? "approved" : "denied" })
            }
            if (e._tag === "turn-completed" || e._tag === "turn-failed" || e._tag === "interrupted") ended++
            if (e._tag === "status" && (e.status.state === "idle" || e.status.state === "failed") && ended) yield* Deferred.succeed(idle, undefined) // the chat at rest
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

test("project → agent → chat: streaming, layered context, model switch, consolidation with memories and skills", async () => {
  const project = await api((c) => c.projects.create({ payload: { name: "Site", brief: "Astro landing page." } }))
  const agent = await api((c) => c.agents.create({ payload: { projectId: project.id, name: "Dev", instructions: "Writes lean code.", model: "claude-cli/sonnet" } }))
  await api((c) => c.memories.create({ payload: { scope: "user", kind: "fact", title: "", text: "Prefers short answers" } }))
  const chat = await api((c) => c.chats.create({ payload: { projectId: project.id, agentIds: [agent.id], model: "claude-cli/sonnet" } }))

  const first = await send(chat.id, { text: "hi" })
  expect(first.events.map((e) => e._tag)).toEqual(["message", "queued", "turn-started", "status", "text", "turn-completed", "status"])
  expect(dones(first.events)[0]).toMatchObject({ role: "assistant", agentId: agent.id, text: "echo: hi", model: "claude-cli/sonnet", inputTokens: 10 })
  const t1 = turns.at(-1)!
  for (const s of ["Astro landing page.", "Writes lean code.", "Prefers short answers"]) expect(t1.system).toContain(s)
  expect(t1.tools?.defs.map((d) => d.name).every(zorelOwn)).toBe(true) // no MCP server: only Zorel's own (browser, team)

  await send(chat.id, { text: "and now?", model: "anthropic/claude-sonnet-5-5" })
  expect(turns.at(-1)!.model).toBe("anthropic/claude-sonnet-5-5")
  expect(turns.at(-1)!.messages.map((m) => m.text)).toEqual(["hi", "echo: hi", "and now?"])

  const compacted = await api((c) => c.chats.consolidate({ params: { id: chat.id } }))
  expect(compacted.summary).toBe("They talked about deploying.")
  const pending = (await api((c) => c.memories.list())).filter((m) => m.state === "pending")
  expect(pending.map((m) => [m.kind, m.scope, m.title || m.text])).toEqual([
    ["skill", `project:${project.id}`, "Publish the site"],
    ["fact", `project:${project.id}`, "Deploys go out on fridays"]
  ])
  // The fact is on the project's map: its point, what it's about and how those relate (pending until approved).
  const map = await api((c) => c.memories.map({ query: { scope: `project:${project.id}` } }))
  const named = (id: string) => map.points.find((p) => p.id === id)?.name
  expect(map.points.map((p) => [p.name, p.type, p.pending]).sort()).toEqual([["Deploy", "subject", 1], ["Fridays", "concept", 1], ["Site", "project", 1]])
  expect(map.links.map((l) => [named(l.a), l.rel, named(l.b)])).toContainEqual(["Deploy", "happens on", "Fridays"])
  const bad = (f: () => Promise<unknown>) => f().then(() => "ok", (e: { _tag?: string }) => e._tag)
  const [deploy, fridays] = ["Deploy", "Fridays"].map((n) => map.points.find((p) => p.name === n)!.id) as [string, string]
  expect(await bad(() => api((c) => c.memories.connect({ payload: { a: deploy, b: fridays } })))).toBe("BadRequest") // same map
  expect(await bad(() => api((c) => c.memories.connect({ payload: { a: deploy, b: "nothing" } })))).toBe("NotFound")

  await send(chat.id, { text: "como publico?" })
  expect(turns.at(-1)!.system).toContain("They talked about deploying.")
  expect(turns.at(-1)!.system).not.toContain("Deploys go out on fridays") // pending doesn't get in
  expect(turns.at(-1)!.messages.map((m) => m.text)).toEqual(["como publico?"])

  for (const m of pending) await api((c) => c.memories.update({ params: { id: m.id }, payload: { state: "active" } }))
  await send(chat.id, { text: "and to publish the site?" })
  const sys = turns.at(-1)!.system
  expect(sys).toContain("Deploys go out on fridays")
  expect(sys).toContain("- Publish the site") // listed
  expect(sys).not.toContain("vercel deploy") // a related message only lists it: the steps are read on demand
  await send(chat.id, { text: "do it with $publish-the-site" })
  expect(turns.at(-1)!.system).toContain("vercel deploy") // named with $handle: full step-by-step
  expect((await api((c) => c.chats.list())).find((c) => c.id === chat.id)!.title).toBe("hi")

  // Usage: this chat's finished turns, summed per model.
  const usage = (await api((c) => c.settings.usage())).filter((u) => u.projectId === project.id)
  const byModel = Object.fromEntries(usage.map((u) => [u.model, [u.turns, u.agentId, u.inputTokens > 0]]))
  expect(byModel).toEqual({ "claude-cli/sonnet": [1, agent.id, true], "anthropic/claude-sonnet-5-5": [4, agent.id, true] }) // the switch sticks to the chat
  // Cost: priced from the catalog; the subscription row is the API equivalent (claude-cli/sonnet → newest Sonnet).
  const billed = Object.fromEntries(usage.map((u) => [u.model, [u.billing, (u.cost ?? 0) > 0]]))
  expect(billed).toEqual({ "claude-cli/sonnet": ["subscription", true], "anthropic/claude-sonnet-5-5": ["api", true] })
  const top = await api((c) => c.settings.topTurns({ query: { since: 0 } }))
  expect(top[0]!.cost).toBeGreaterThan(0)
  expect(top.every((t, i) => i === 0 || t.cost <= top[i - 1]!.cost)).toBe(true)
})

test("channel: an @mention picks who answers; an agent hands off by mentioning another; the handoff limit", async () => {
  const project = await api((c) => c.projects.create({ payload: { name: "Channel", brief: "" } }))
  const mk = (name: string, model: string) => api((c) => c.agents.create({ payload: { projectId: project.id, name, instructions: `I am ${name}.`, model } }))
  const [lia, leo, nico] = [await mk("Lia", "claude-cli/haiku"), await mk("Leo", "codex-cli/default"), await mk("Nico", "ollama/llama3")]
  const chat = await api((c) => c.chats.create({ payload: { projectId: project.id, agentIds: [lia.id, leo.id, nico.id], model: "claude-cli/sonnet" } }))

  // no mention: leader (Lia) with the chat model
  let r = await send(chat.id, { text: "good morning" })
  expect(dones(r.events).map((m) => [m.agentId, m.model])).toEqual([[lia.id, "claude-cli/sonnet"]])
  expect(turns.at(-1)!.system).toContain("@leo (Leo)")

  // direct mention: Leo with his model; Leo hands off to @nico, who sees Leo's line with his name; once Nico
  // answers, Leo gets the wrap-up turn (and his scripted reply mentioning Nico again stops at the hop limit)
  mentionNext.set("Leo", "found the bug, @nico can you review?")
  r = await send(chat.id, { text: "@leo look into the error" })
  expect(dones(r.events).map((m) => [m.agentId, m.model])).toEqual([[leo.id, "codex-cli/default"], [nico.id, "ollama/llama3"], [leo.id, "codex-cli/default"]])
  expect(turns.at(-2)!.messages.at(-1)).toMatchObject({ role: "user", text: "[Leo]\nfound the bug, @nico can you review?" })
  expect(turns.at(-1)!.messages.at(-1)!.text).toStartWith("[Nico]")

  // ping-pong stops at the limit
  mentionNext.set("Nico", "@leo again")
  mentionNext.set("Leo", "@nico again")
  r = await send(chat.id, { text: "@leo go" })
  expect(dones(r.events)).toHaveLength(3) // Leo → Nico → Leo and stops
  mentionNext.clear()
})

test("teams: handles are unique with agents, members stay in reach, @team routes to one member, deleting keeps the agents", async () => {
  const project = await api((c) => c.projects.create({ payload: { name: "Teams", brief: "" } }))
  const mk = (name: string, title: string, projectId: string | null = project.id) => api((c) => c.agents.create({ payload: { projectId, name, title, instructions: `I am ${name}.`, model: "claude-cli/haiku" } }))
  const [ana, ted, lead] = [await mk("Ana", "UI design"), await mk("Ted", "Writes tests"), await mk("Boss", "Lead")]
  const err = (p: Promise<unknown>) => p.then(() => undefined, (e: { _tag?: string }) => e._tag)

  const team = await api((c) => c.agents.createTeam({ payload: { projectId: project.id, name: "Front End", agentIds: [ana.id, ted.id] } }))
  expect(team).toMatchObject({ handle: "front-end", agentIds: [ana.id, ted.id] })
  expect(await err(api((c) => c.agents.createTeam({ payload: { projectId: project.id, name: "Ana", agentIds: [] } })))).toBe("TeamHandleTaken")
  expect(await err(api((c) => c.agents.update({ params: { id: lead.id }, payload: { name: "Front End" } })))).toBe("TeamHandleTaken")
  expect(await err(api((c) => c.agents.createTeam({ payload: { projectId: null, name: "Everyone", agentIds: [ana.id] } })))).toBe("TeamInvalid") // a global team holds global agents
  // Joining a team from the agent's side: last in line.
  await api((c) => c.agents.update({ params: { id: lead.id }, payload: { teamIds: [team.id] } }))
  expect((await api((c) => c.agents.teams())).find((t) => t.id === team.id)!.agentIds).toEqual([ana.id, ted.id, lead.id])
  await api((c) => c.agents.updateTeam({ params: { id: team.id }, payload: { agentIds: [ana.id, ted.id] } }))

  // @team: one routed turn; the router's pick answers, and the chat says which team it routed for.
  const chat = await api((c) => c.chats.create({ payload: { projectId: project.id, agentIds: [lead.id, ana.id, ted.id], model: "claude-cli/sonnet" } }))
  routeNext = '{"handle": "ted", "reason": "tests"}'
  let r = await send(chat.id, { text: "@front-end write tests for the header" })
  expect(dones(r.events).map((m) => m.agentId)).toEqual([ted.id])
  expect(r.events.some((e) => e._tag === "handoff" && e.via === "route" && e.reason === "Front End · tests")).toBe(true)
  // An answer naming someone outside the team (or unreadable) falls back to the team's first member.
  routeNext = '{"handle": "boss", "reason": "x"}'
  r = await send(chat.id, { text: "@front-end hi" })
  expect(dones(r.events).map((m) => m.agentId)).toEqual([ana.id])
  routeNext = ""
  // In backticks it calls no one: the lead answers.
  r = await send(chat.id, { text: "what does `@front-end` mean?" })
  expect(dones(r.events).map((m) => m.agentId)).toEqual([lead.id])

  await api((c) => c.agents.removeTeam({ params: { id: team.id } }))
  expect((await api((c) => c.agents.list())).filter((a) => [ana.id, ted.id].includes(a.id))).toHaveLength(2)
  expect((await api((c) => c.agents.teams())).some((t) => t.id === team.id)).toBe(false)
  // Deleting an agent drops it from its teams.
  const crew = await api((c) => c.agents.createTeam({ payload: { projectId: project.id, name: "Crew", agentIds: [ana.id, ted.id] } }))
  await api((c) => c.agents.remove({ params: { id: ted.id } }))
  expect((await api((c) => c.agents.teams())).find((t) => t.id === crew.id)!.agentIds).toEqual([ana.id])
})

test("MCP tools: read mode hides writes; approve mode asks and respects the decision", async () => {
  const project = await api((c) => c.projects.create({ payload: { name: "Docs", brief: "" } }))
  const server = await api((c) => c.tools.create({ payload: { projectId: project.id, name: "docs", command: "", args: [], url: `http://localhost:${mcp.port}/mcp`, env: { Authorization: "Bearer x" }, mode: "read" } }))
  expect(server.envKeys).toEqual(["Authorization"])
  const inspected = await api((c) => c.tools.inspect({ params: { id: server.id } }))
  expect(inspected).toEqual({ tools: [{ name: "search_docs", description: "Searches the docs", cls: "read" }, { name: "delete_page", description: "Deletes a page", cls: "sensitive" }], error: null })

  const chat = await api((c) => c.chats.create({ payload: { projectId: project.id, agentIds: [], model: "claude-cli/sonnet" } }))
  let r = await send(chat.id, { text: "tool:docs__search_docs" })
  let msg = dones(r.events)[0]!
  expect(msg.text).toBe("docs__search_docs => result of search_docs") // only the read one listed
  expect(msg.steps.filter((s) => s.tool !== "reply")).toEqual([{ tool: "docs__search_docs", args: '{"q":"deploy"}', status: "ok", result: "result of search_docs", at: 0 }]) // the reply's own time closes the list; the tool ran before any words (at 0)

  await api((c) => c.tools.update({ params: { id: server.id }, payload: { mode: "approve" } }))
  r = await send(chat.id, { text: "tool:docs__delete_page" }, () => false)
  msg = dones(r.events)[0]!
  expect(r.events.some((e) => e._tag === "approval" && e.approval.tool === "docs__delete_page")).toBe(true)
  expect(r.events.some((e) => e._tag === "approval-resolved" && e.outcome === "denied")).toBe(true)
  expect(r.openWhileWaiting.map((a) => [a.chatId, a.tool])).toEqual([[chat.id, "docs__delete_page"]])
  expect(await rpc((c) => c.approvals())).toEqual([]) // decided: gone from "Needs you"
  expect(msg.text).toContain("The user declined")
  expect(msg.steps.find((s) => s.tool === "docs__delete_page")!.status).toBe("refused")
  expect(toolCalls).toEqual(["search_docs"]) // denied one never reached the server

  r = await send(chat.id, { text: "tool:docs__delete_page" }, () => true)
  expect(dones(r.events)[0]!.text).toContain("result of delete_page")
  expect(toolCalls).toEqual(["search_docs", "delete_page"])

  // chat outside the project doesn't see the server
  const other = await api((c) => c.chats.create({ payload: { projectId: null, agentIds: [], model: "claude-cli/sonnet" } }))
  await send(other.id, { text: "hi" })
  expect(turns.at(-1)!.tools?.defs.map((d) => d.name).every(zorelOwn)).toBe(true)
})

test("API keys: saved through the interface, never returned; unknown name 404", async () => {
  await api((c) => c.settings.setKey({ params: { name: "OPENROUTER_API_KEY" }, payload: { value: "sk-or-123" } }))
  const keys = await api((c) => c.settings.keys())
  expect(keys.find((k) => k.name === "OPENROUTER_API_KEY")).toEqual({ name: "OPENROUTER_API_KEY", set: true, fromEnv: false })
  expect(JSON.stringify(keys)).not.toContain("sk-or-123")
  expect((await api((c) => c.settings.models())).find((m) => m.provider === "openrouter")!.available).toBe(true)
  const res = await fetch(`${base}/api/keys/PATH`, { method: "PUT", headers: { "content-type": "application/json" }, body: '{"value":"x"}' })
  expect(res.status).toBe(404)
})

test("errors at the boundary: invalid input 400, missing chat 404, another project's agent 404", async () => {
  const chat = await api((c) => c.chats.create({ payload: { projectId: null, agentIds: [], model: "ollama/llama3" } }))
  const sendExit = (chatId: string, text: string, model?: string) =>
    rpc((c) => Effect.exit(c.send({ chatId, clientId: crypto.randomUUID(), text, ...(model && { model }) } as never)))
  expect(Exit.isFailure(await sendExit(chat.id, "   "))).toBe(true) // empty text: rejected by the schema
  expect(Exit.isFailure(await sendExit(chat.id, "hi", "no-slash"))).toBe(true)
  const missing = await sendExit("does-not-exist", "hi")
  expect(JSON.stringify(missing)).toContain("ChatNotFound")

  const other = await api((c) => c.projects.create({ payload: { name: "Other", brief: "" } }))
  const foreign = await api((c) => c.agents.create({ payload: { projectId: other.id, name: "X", instructions: "", model: "ollama/llama3" } }))
  const res = await fetch(`${base}/api/chats`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: null, agentIds: [foreign.id], model: "ollama/llama3" }) })
  expect(res.status).toBe(404)
})

test("local only: an odd Host (DNS rebinding) and another site's Origin (CSRF) get 403", async () => {
  const { isLocalRequest } = await import("./main.ts")
  const t = { [SESSION_HEADER]: "s" }
  expect(isLocalRequest({ host: "localhost:5173", ...t }, "/api/x", "s")).toBe(true)
  expect(isLocalRequest({ host: "127.0.0.1:4317", origin: "http://127.0.0.1:4317", cookie: "a=1; zorel=s" }, "/rpc", "s")).toBe(true)
  expect(isLocalRequest({ host: "evil.example:4317", ...t }, "/api/x", "s")).toBe(false)
  expect(isLocalRequest({ host: "localhost:4317", origin: "https://evil.example", ...t }, "/api/x", "s")).toBe(false)
  expect(isLocalRequest({ host: "localhost:4317", origin: "null", ...t }, "/api/x", "s")).toBe(false)
  expect(isLocalRequest({ host: "127.0.0.1:4317", origin: "http://127.0.0.1:3000", ...t }, "/api/x", "s")).toBe(false) // another local port
  expect(isLocalRequest({}, "/api/x", "s")).toBe(false)
  // Another process on this computer (an agent): local, no Origin, but no secret.
  expect(isLocalRequest({ host: "127.0.0.1:4317" }, "/api/agents/a", "s")).toBe(false)
  expect(isLocalRequest({ host: "127.0.0.1:4317", [SESSION_HEADER]: "wrong" }, "/rpc", "s")).toBe(false)
  for (const open of ["/", "/assets/a.js", LOGIN_PATH, "/api/oauth/callback", "/api/hooks/abc"]) expect(isLocalRequest({ host: "127.0.0.1:4317" }, open, "s")).toBe(true)
  expect((await rawFetch(`${base}/api/projects`)).status).toBe(403)
  expect((await rawFetch(`${base}${LOGIN_PATH}?t=wrong`, { redirect: "manual" })).status).toBe(403)
  const login = await rawFetch(`${base}${LOGIN_PATH}?t=${SESSION}`, { redirect: "manual" })
  expect(login.status).toBe(302)
  const cookie = login.headers.get("set-cookie")!
  expect(cookie).toContain("HttpOnly")
  expect((await rawFetch(`${base}/api/projects`, { headers: { cookie: cookie.split(";")[0]! } })).status).toBe(200)

  // "Simple" POST (text/plain) from another page and WebSocket from another origin: blocked before any effect.
  const res = await fetch(`${base}/api/projects`, { method: "POST", headers: { "content-type": "text/plain", origin: "https://evil.example" }, body: '{"name":"x","brief":""}' })
  expect(res.status).toBe(403)
  expect((await fetch(`${base}/rpc`, { headers: { origin: "https://evil.example", upgrade: "websocket", connection: "Upgrade" } })).status).toBe(403)
  expect((await fetch(`${base}/api/projects`, { headers: { origin: "https://evil.example" } })).status).toBe(403)
  expect((await fetch(`${base}/api/projects`, { headers: { origin: base } })).status).toBe(200)
})

test("learning: forgotten ones go to consolidation and can be restored; a cap of 20 pending", async () => {
  const forgotten = await api((c) => c.memories.create({ payload: { scope: "user", kind: "fact", title: "", text: "Likes emojis" } }))
  await api((c) => c.memories.update({ params: { id: forgotten.id }, payload: { state: "forgotten" } }))
  const chat = await api((c) => c.chats.create({ payload: { projectId: null, agentIds: [], model: "ollama/llama3" } }))
  await send(chat.id, { text: "hi" })

  manyMemories = 25
  const before = (await api((c) => c.memories.list())).filter((m) => m.state === "pending" && m.scope === "user").length
  await api((c) => c.chats.consolidate({ params: { id: chat.id } }))
  manyMemories = 0
  expect(turns.at(-1)!.messages[0]!.text).toContain("asked to forget (don't propose it again, not even in other words):\n- Likes emojis")
  const pending = (await api((c) => c.memories.list())).filter((m) => m.state === "pending" && m.scope === "user")
  expect(pending.length).toBe(Math.max(before, 20))

  // way back: the forgotten one stays listed and becomes active again
  expect((await api((c) => c.memories.list())).find((m) => m.id === forgotten.id)!.state).toBe("forgotten")
  await api((c) => c.memories.update({ params: { id: forgotten.id }, payload: { state: "active" } }))
  await send(chat.id, { text: "so?" })
  expect(turns.at(-1)!.system).toContain("Likes emojis")
})

test("accounts: defaults are created by themselves and can't be removed; an extra one gets its own folder and it goes away with it", async () => {
  const list = await api((c) => c.accounts.list())
  expect(list.filter((a) => a.isDefault).map((a) => a.provider).sort()).toEqual(["claude", "codex"])
  const extra = await api((c) => c.accounts.create({ payload: { provider: "codex", label: "Codex work" } }))
  expect(extra).toMatchObject({ provider: "codex", isDefault: false, loggedIn: false })
  expect((await api((c) => c.accounts.update({ params: { id: extra.id }, payload: { label: "Codex 2" } }))).label).toBe("Codex 2")
  const home = join(tmpdir(), "zorel-test", "accounts", extra.id)
  expect(require("node:fs").existsSync(home)).toBe(true) // each extra account gets its own login folder
  const def = list.find((a) => a.provider === "claude" && a.isDefault)!
  expect((await fetch(`${base}/api/accounts/${def.id}`, { method: "DELETE" })).status).toBe(409)
  expect((await fetch(`${base}/api/accounts/${extra.id}`, { method: "DELETE" })).status).toBe(204)
  expect(require("node:fs").existsSync(home)).toBe(false)
}, 20_000) // runs the real claude/codex status commands, whose latency depends on the machine

test("attachments: upload, a message with files, the engine gets paths; text inline, image by name; deleting the chat deletes the files", async () => {
  const chat = await api((c) => c.chats.create({ payload: { projectId: null, agentIds: [], model: "ollama/llama3" } }))
  const up = async (name: string, mime: string, body: BodyInit) => {
    const r = await fetch(`${base}/api/chats/${chat.id}/attachments`, { method: "POST", headers: { "content-type": mime, "x-file-name": encodeURIComponent(name) }, body })
    return { status: r.status, json: (await r.json()) as { id: string; name: string; size: number } }
  }
  const note = await up("project notes.md", "text/markdown", "# Deploy\nVercel on Fridays ✓")
  const png = await up("screen.png", "image/png", new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))
  expect(note.status).toBe(200)
  expect(note.json).toMatchObject({ name: "project notes.md", size: 30 }) // bytes, not characters
  expect((await up("large.bin", "application/octet-stream", new Uint8Array(20 * 1024 * 1024 + 1))).status).toBe(413)

  const r = await send(chat.id, { text: "see the attachments", attachmentIds: [note.json.id, png.json.id] })
  const user = r.events.find((e) => e._tag === "message")
  expect(user && user._tag === "message" && user.message.attachments.map((a) => a.name)).toEqual(["project notes.md", "screen.png"])
  const files = turns.at(-1)!.messages.at(-1)!.files!
  expect(files.map((f) => [f.name, f.mime])).toEqual([["project notes.md", "text/markdown"], ["screen.png", "image/png"]])
  const { transcript } = await import("./engines.ts")
  const text = transcript(turns.at(-1)!.messages)
  expect(text).toContain("Vercel on Fridays ✓") // small text file inline
  expect(text).toContain("[attached image: screen.png]")

  const served = await fetch(`${base}/api/attachments/${note.json.id}`)
  expect(served.headers.get("content-type")).toContain("text/markdown")
  expect(await served.text()).toBe("# Deploy\nVercel on Fridays ✓")
  expect(served.headers.get("content-security-policy")).toStartWith("sandbox")
  expect(served.headers.get("content-disposition")).toStartWith("attachment") // markdown isn't shown as a page
  const page = await up("report.html", "text/html", "<script>fetch('/api/chats')</script>")
  expect((await fetch(`${base}/api/attachments/${page.json.id}`)).headers.get("content-disposition")).toStartWith("attachment")
  expect((await fetch(`${base}/api/attachments/${png.json.id}`)).headers.get("content-disposition")).toStartWith("inline")

  const dir = join(tmpdir(), "zorel-test", "attachments", chat.id)
  expect(require("node:fs").existsSync(dir)).toBe(true)
  await api((c) => c.chats.remove({ params: { id: chat.id } }))
  expect(require("node:fs").existsSync(dir)).toBe(false)
})

test("sidebar order: projects in the given order (new ones on top); chats only reorder within their own group", async () => {
  const a = await api((c) => c.projects.create({ payload: { name: "A", brief: "" } }))
  const b = await api((c) => c.projects.create({ payload: { name: "B", brief: "" } }))
  await api((c) => c.projects.reorder({ payload: { ids: [a.id, b.id] } }))
  const fresh = await api((c) => c.projects.create({ payload: { name: "New", brief: "" } }))
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

test("audit log: changes with before → after; an API key only by name, never its value", async () => {
  const agent = await api((c) => c.agents.create({ payload: { projectId: null, name: "Audited", instructions: "", model: "ollama/llama3" } }))
  await api((c) => c.agents.update({ params: { id: agent.id }, payload: { model: "ollama/qwen", name: "Audited" } }))
  await api((c) => c.agents.update({ params: { id: agent.id }, payload: { model: "ollama/llama3" } }))
  await api((c) => c.agents.update({ params: { id: agent.id }, payload: { model: "ollama/qwen" } })) // the same change again, at once: kept too
  await api((c) => c.settings.setKey({ params: { name: "OPENROUTER_API_KEY" }, payload: { value: "sk-super-secret" } }))
  await api((c) => c.settings.setKey({ params: { name: "OPENROUTER_API_KEY" }, payload: { value: "" } }))
  const log = (await api((c) => c.settings.audit({ query: {} }))).entries
  const updates = log.filter((e) => e.action === "agent.updated" && e.target.id === agent.id)
  expect(updates).toHaveLength(3)
  const update = updates.at(-1)!
  expect(update.actor).toEqual({ type: "user", id: "local" })
  expect(update.changes).toEqual([{ field: "model", before: "ollama/llama3", after: "ollama/qwen" }]) // the unchanged name is left out
  expect(log.some((e) => e.action === "agent.created" && e.target.name === "Audited")).toBe(true)
  expect(log.filter((e) => e.target.id === "OPENROUTER_API_KEY").map((e) => e.action).slice(0, 2)).toEqual(["api_key.cleared", "api_key.set"]) // newest first
  expect(JSON.stringify(log)).not.toContain("sk-super-secret")

  // Narrowed: by kind, by words, by time; paged with the total.
  const providers = await api((c) => c.settings.audit({ query: { kind: "providers" } }))
  expect(providers.entries.length).toBeGreaterThan(0)
  expect(providers.entries.every((e) => e.action.startsWith("api_key.") || e.action.startsWith("account.") || e.action.startsWith("failover_terms."))).toBe(true)
  const words = await api((c) => c.settings.audit({ query: { q: "Audited" } }))
  expect(words.entries.length).toBeGreaterThan(0)
  expect(words.entries.every((e) => e.target.name === "Audited")).toBe(true)
  expect((await api((c) => c.settings.audit({ query: { q: "100%_nothing" } }))).total).toBe(0) // LIKE wildcards are literal
  expect((await api((c) => c.settings.audit({ query: { from: Date.now() + 60_000 } }))).total).toBe(0)
  const all = await api((c) => c.settings.audit({ query: {} }))
  expect(all.pageSize).toBe(50)
  expect(all.total).toBeGreaterThanOrEqual(all.entries.length)
  expect((await api((c) => c.settings.audit({ query: { page: 99 } }))).entries).toHaveLength(0)
})

test("storage: measures the data folder; cleaning only removes folders of chats and projects that no longer exist", async () => {
  const dir = join(tmpdir(), "zorel-test")
  const live = await api((c) => c.chats.create({ payload: { projectId: null, agentIds: [], model: "ollama/llama3" } }))
  mkdirSync(join(dir, "runs", live.id), { recursive: true })
  writeFileSync(join(dir, "runs", live.id, "notes.md"), "x".repeat(2048))
  mkdirSync(join(dir, "runs", "deleted-chat"), { recursive: true })
  writeFileSync(join(dir, "runs", "deleted-chat", "big.bin"), "x".repeat(4096))

  const report = await api((c) => c.settings.storage())
  expect(report.total).toBeGreaterThan(0)
  expect(report.cleanup.find((c) => c.id === "orphans")!.bytes).toBeGreaterThanOrEqual(4096)
  expect(report.chats.find((c) => c.id === live.id)?.bytes).toBe(2048)

  const after = await api((c) => c.settings.cleanStorage({ params: { id: "orphans" } }))
  expect(after.cleanup.find((c) => c.id === "orphans")!.bytes).toBe(0)
  expect(existsSync(join(dir, "runs", "deleted-chat"))).toBe(false)
  expect(existsSync(join(dir, "runs", live.id, "notes.md"))).toBe(true) // a live chat's folder stays
  expect((await api((c) => c.settings.audit({ query: {} }))).entries.some((e) => e.action === "storage.cleaned" && e.target.id === "orphans")).toBe(true)
})

test("terminal: opening a file only inside the chat folder; with no shells, the list is empty", async () => {
  const chat = await api((c) => c.chats.create({ payload: { projectId: null, agentIds: [], model: "ollama/llama3" } }))
  expect(await api((c) => c.chats.terminals({ params: { id: chat.id } }))).toEqual([])
  const open = (path: string) => api((c) => Effect.exit(c.chats.openFile({ params: { id: chat.id }, payload: { path } })))
  expect(Exit.isFailure(await open("../../../etc/hosts"))).toBe(true) // outside the chat's folder
  expect(Exit.isFailure(await open("missing.txt"))).toBe(true)
})

test("context: estimates the next turn part by part; messages count", async () => {
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

test("routines: created with their own chat, invalid cron 400, the webhook sends the message with the body, turned off doesn't run", async () => {
  const agent = await api((c) => c.agents.create({ payload: { projectId: null, name: "Ops", instructions: "", model: "claude-cli/sonnet" } }))
  const bad = await api((c) => c.routines.create({ payload: { agentId: agent.id, name: "X", prompt: "p", cron: "not a cron!", webhook: false } })).catch((e: unknown) => e)
  expect((bad as { _tag?: string })._tag).toBe("CronInvalid")
  const noServer = await api((c) => c.routines.create({ payload: { agentId: agent.id, name: "W", prompt: "p", cron: null, webhook: false, watch: { serverId: "missing", tool: "list_issues", args: {} } } })).catch((e: unknown) => e)
  expect((noServer as { _tag?: string })._tag).toBe("NotFound") // a connector that isn't there
  const r = await api((c) => c.routines.create({ payload: { agentId: agent.id, name: "Triage", prompt: "Triage the issue", cron: "0 9 * * *", webhook: true } }))
  expect(r.nextRunAt).toBeGreaterThan(Date.now())
  expect(r.token).toBeTruthy()
  const chat = (await api((c) => c.chats.list())).find((c) => c.id === r.chatId)!
  expect(chat.agentIds).toEqual([agent.id])
  await api((c) => c.routines.hook({ params: { token: r.token! }, payload: { issue: 42 } }))
  for (let i = 0; i < 50 && !(await api((c) => c.chats.messages({ params: { id: r.chatId } }))).some((m) => m.role === "assistant"); i++) await Bun.sleep(100)
  const msgs = await api((c) => c.chats.messages({ params: { id: r.chatId } }))
  expect(msgs[0]!.text).toContain('Routine "Triage"')
  expect(msgs[0]!.text).toContain('"issue": 42')
  expect((await api((c) => c.routines.list())).find((x) => x.id === r.id)!.lastStatus).toBe("started")
  await api((c) => c.routines.update({ params: { id: r.id }, payload: { enabled: false } }))
  const off = await api((c) => c.routines.hook({ params: { token: r.token! }, payload: {} })).catch((e: unknown) => e)
  expect((off as { _tag?: string })._tag).toBe("NotFound")
  expect((await api((c) => c.routines.list())).find((x) => x.id === r.id)!.nextRunAt).toBeNull()
})

test("pause all: new messages wait in the queue; resuming answers", async () => {
  const chat = await api((c) => c.chats.create({ payload: { projectId: null, agentIds: [], model: "claude-cli/sonnet" } }))
  await api((c) => c.settings.pause({ payload: { paused: true } }))
  expect((await api((c) => c.settings.preferences())).paused).toBe(true)
  await rpc((c) => c.send({ chatId: chat.id, clientId: crypto.randomUUID(), text: "hi" }))
  await Bun.sleep(400)
  expect((await api((c) => c.chats.messages({ params: { id: chat.id } }))).map((m) => m.role)).toEqual(["user"])
  await api((c) => c.settings.pause({ payload: { paused: false } }))
  for (let i = 0; i < 50 && (await api((c) => c.chats.messages({ params: { id: chat.id } }))).length < 2; i++) await Bun.sleep(100)
  expect((await api((c) => c.chats.messages({ params: { id: chat.id } }))).map((m) => m.role)).toEqual(["user", "assistant"])
})

test("snippet: the words around the first match, one line", () => {
  expect(snippet("a\nb deploy c", "deploy")).toBe("a b deploy c")
  const long = `${"x".repeat(100)} target ${"y".repeat(100)}`
  expect(snippet(long, "TARGET", 10)).toBe(`…${"x".repeat(9)} target ${"y".repeat(9)}…`)
})

test("edit from here: the conversation goes back to before the message and it comes back as text", async () => {
  const chat = await api((c) => c.chats.create({ payload: { projectId: null, agentIds: [], model: "claude-cli/sonnet" } }))
  await send(chat.id, { text: "first" })
  await send(chat.id, { text: "second" })
  const msgs = await api((c) => c.chats.messages({ params: { id: chat.id } }))
  expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"])
  const r = await api((c) => c.chats.rewind({ params: { id: chat.id }, payload: { messageId: msgs[2]!.id, files: false } }))
  expect(r.text).toBe("second")
  expect((await api((c) => c.chats.messages({ params: { id: chat.id } }))).map((m) => m.text.slice(0, 8))).toEqual(["first", msgs[1]!.text.slice(0, 8)])
  const notUser = await api((c) => c.chats.rewind({ params: { id: chat.id }, payload: { messageId: msgs[1]!.id, files: false } })).catch((e: unknown) => e)
  expect((notUser as { _tag?: string })._tag).toBe("NotFound") // only a message of yours
})

test("a project's default agent: only a global one or one from the project", async () => {
  const p = await api((c) => c.projects.create({ payload: { name: "Def", brief: "" } }))
  const other = await api((c) => c.projects.create({ payload: { name: "Other", brief: "" } }))
  const foreign = await api((c) => c.agents.create({ payload: { projectId: other.id, name: "Foreign", instructions: "", model: "claude-cli/sonnet" } }))
  const global = await api((c) => c.agents.create({ payload: { projectId: null, name: "Global", instructions: "", model: "claude-cli/sonnet" } }))
  const bad = await api((c) => c.projects.update({ params: { id: p.id }, payload: { defaultAgentId: foreign.id } })).catch((e: unknown) => e)
  expect((bad as { _tag?: string })._tag).toBe("NotFound")
  expect((await api((c) => c.projects.update({ params: { id: p.id }, payload: { defaultAgentId: global.id } }))).defaultAgentId).toBe(global.id)
  expect((await api((c) => c.projects.list())).find((x) => x.id === p.id)!.defaultAgentId).toBe(global.id)
})

test("pages by agents: writing in the project becomes a version, search and read; the pinned one enters the context", async () => {
  const project = await api((c) => c.projects.create({ payload: { name: "Wiki", brief: "" } }))
  const chat = await api((c) => c.chats.create({ payload: { projectId: project.id, agentIds: [], model: "claude-cli/sonnet" } }))
  const write = dones((await send(chat.id, { text: 'tool:zorel_knowledge_write {"title":"Deploy","body":"We deploy on Fly.io.","scope":"project"}' })).events)[0]!
  expect(write.text).toContain('Saved "Deploy"')
  const page = (await api((c) => c.pages.list())).find((p) => p.title === "Deploy")!
  expect(page.scope).toBe(`project:${project.id}`)
  expect(dones((await send(chat.id, { text: 'tool:zorel_knowledge_search {"query":"fly"}' })).events)[0]!.text).toContain(`Deploy [${page.id}]`)
  expect(dones((await send(chat.id, { text: `tool:zorel_knowledge_read {"page":"${page.id}"}` })).events)[0]!.text).toContain("We deploy on Fly.io.")
  // Changing a page that exists waits for the person: refused, it stays; approved, it changes.
  const change = `tool:zorel_knowledge_write {"page":"${page.id}","title":"Deploy","body":"We deploy on Vercel."}`
  expect(dones((await send(chat.id, { text: change }, () => false)).events)[0]!.text).toContain("declined")
  expect((await api((c) => c.pages.list())).find((p) => p.id === page.id)!.body).toBe("We deploy on Fly.io.")
  await send(chat.id, { text: change }, () => true)
  expect((await api((c) => c.pages.list())).find((p) => p.id === page.id)!.body).toBe("We deploy on Vercel.")
  await api((c) => c.pages.update({ params: { id: page.id }, payload: { pinned: true } }))
  await send(chat.id, { text: "hi" })
  expect(turns.at(-1)!.system).toContain(`### Deploy [${page.id}]\nWe deploy on Vercel.`)
})

test("agent permissions: connector per agent, always-allow saved, and requesting access", async () => {
  const project = await api((c) => c.projects.create({ payload: { name: "Perms", brief: "" } }))
  const server = await api((c) => c.tools.create({ payload: { projectId: project.id, name: "kb", command: "", args: [], url: `http://localhost:${mcp.port}/mcp`, env: {}, mode: "approve" } }))
  const agent = await api((c) => c.agents.create({ payload: { projectId: project.id, name: "Ana", instructions: "", model: "claude-cli/sonnet", permissions: { web: false, browser: false, grants: { [server.id]: "none" }, always: [] } } }))
  const chat = await api((c) => c.chats.create({ payload: { projectId: project.id, agentIds: [agent.id], model: "claude-cli/sonnet" } }))
  // No access: the connector isn't offered; neither is the browser.
  await send(chat.id, { text: "hi" })
  expect(turns.at(-1)!.tools?.defs.map((d) => d.name).filter((n) => n.startsWith("kb__") || n.startsWith("browser_"))).toEqual([])

  // The agent asks for read access; approved, it's saved on the agent.
  let r = await send(chat.id, { text: 'tool:zorel_request_access {"what":"kb","level":"read","reason":"look up docs"}' }, () => true)
  expect(dones(r.events)[0]!.text).toContain("Granted: read kb")
  expect((await api((c) => c.agents.list())).find((a) => a.id === agent.id)!.permissions.grants[server.id]).toBe("read")
  await send(chat.id, { text: "hi" })
  expect(turns.at(-1)!.tools?.defs.map((d) => d.name).filter((n) => n.startsWith("kb__"))).toEqual(["kb__search_docs"])

  // Read and write: a destructive tool asks; "Always allow" saves the rule and the next call doesn't ask.
  await api((c) => c.agents.update({ params: { id: agent.id }, payload: { permissions: { web: false, browser: false, grants: { [server.id]: "write" }, always: [] } } }))
  r = await send(chat.id, { text: "tool:kb__delete_page" }, () => "always")
  expect(r.events.find((e) => e._tag === "approval")?._tag === "approval" && (r.events.find((e) => e._tag === "approval") as { approval: Approval }).approval.alwaysKey).toBe(`${server.id}:delete_page`)
  expect((await api((c) => c.agents.list())).find((a) => a.id === agent.id)!.permissions.always).toEqual([`${server.id}:delete_page`])
  r = await send(chat.id, { text: "tool:kb__delete_page" }, () => false)
  expect(r.events.some((e) => e._tag === "approval")).toBe(false)
  expect(dones(r.events)[0]!.text).toContain("result of delete_page")
})

test("skills: read, propose an improvement, approve seeing the change and restore the previous version", async () => {
  const project = await api((c) => c.projects.create({ payload: { name: "Skills", brief: "" } }))
  const skill = await api((c) => c.memories.create({ payload: { scope: `project:${project.id}`, kind: "skill", title: "Release", text: "1. bun test\n2. tag" } }))
  const chat = await api((c) => c.chats.create({ payload: { projectId: project.id, agentIds: [], model: "claude-cli/sonnet" } }))
  expect(dones((await send(chat.id, { text: 'tool:zorel_read_skill {"skill":"release"}' })).events)[0]!.text).toContain("1. bun test")
  const proposed = dones((await send(chat.id, { text: 'tool:zorel_propose_skill {"title":"Release","steps":"1. bun test\\n2. lint\\n3. tag","reason":"lint caught a bug","improves":"Release"}' })).events)[0]!
  expect(proposed.text).toContain("seeing what changes")
  const pending = (await api((c) => c.memories.list())).find((m) => m.state === "pending" && m.replaces === skill.id)!
  expect(pending.reason).toBe("lint caught a bug")
  // Approving applies it to the skill; the proposal goes away and the old text is a version.
  const applied = await api((c) => c.memories.update({ params: { id: pending.id }, payload: { state: "active" } }))
  expect(applied.id).toBe(skill.id)
  expect(applied.text).toBe("1. bun test\n2. lint\n3. tag")
  expect((await api((c) => c.memories.list())).some((m) => m.id === pending.id)).toBe(false)
  const versions = await api((c) => c.memories.versions({ params: { id: skill.id } }))
  expect(versions.map((v) => v.text)).toEqual(["1. bun test\n2. tag"])
  const restored = await api((c) => c.memories.restore({ params: { id: skill.id }, payload: { versionId: versions[0]!.id } }))
  expect(restored.text).toBe("1. bun test\n2. tag")
  expect((await api((c) => c.memories.versions({ params: { id: skill.id } }))).length).toBe(2)
})

// Compact ("force") on a chat, listening: what the chat is told while it runs.
const compactListening = (chatId: string) =>
  rpc((c) =>
    Effect.gen(function* () {
      const events: ChatEvent[] = []
      const ready = yield* Deferred.make<void>()
      const fiber = yield* c.subscribeChat({ chatId }).pipe(
        Stream.runForEach((e) => (e._tag === "snapshot" ? Deferred.succeed(ready, undefined) : Effect.sync(() => void events.push(e)))),
        Effect.forkChild
      )
      yield* Deferred.await(ready)
      yield* Effect.promise(() => api((x) => x.chats.consolidate({ params: { id: chatId } })))
      yield* Effect.sleep("100 millis")
      yield* Fiber.interrupt(fiber)
      return events
    })
  )

// Listens to a chat while `act` starts its work (a webhook, a "Run now"), until it rests again. Approvals are denied.
const listening = (chatId: string, act: () => Promise<unknown>) =>
  rpc((c) =>
    Effect.gen(function* () {
      const events: ChatEvent[] = []
      const ready = yield* Deferred.make<void>()
      const idle = yield* Deferred.make<void>()
      let ended = 0
      const fiber = yield* c.subscribeChat({ chatId }).pipe(
        Stream.runForEach((e) =>
          Effect.gen(function* () {
            if (e._tag === "snapshot") return yield* Deferred.succeed(ready, undefined)
            events.push(e)
            if (e._tag === "approval") yield* c.decide({ approvalId: e.approval.id, outcome: "denied" })
            if (e._tag === "turn-completed" || e._tag === "turn-failed" || e._tag === "interrupted") ended++
            if (e._tag === "status" && (e.status.state === "idle" || e.status.state === "failed") && ended) yield* Deferred.succeed(idle, undefined)
          })
        ),
        Effect.forkChild
      )
      yield* Deferred.await(ready)
      yield* Effect.promise(act)
      yield* Deferred.await(idle).pipe(Effect.timeout("5 seconds"))
      yield* Fiber.interrupt(fiber)
      return events
    })
  )

test("outside text (spec 011): a webhook run asks even at Full access, what it hands off too; the person's own message and a plain run don't", async () => {
  const server = await api((c) => c.tools.create({ payload: { projectId: null, name: "docs", command: "", args: [], url: `http://localhost:${mcp.port}/mcp`, env: {}, mode: "auto" } }))
  const helper = await api((c) => c.agents.create({ payload: { projectId: null, name: "Helper Out", instructions: "Helps.", model: "claude-cli/sonnet", access: "full" } }))
  const ops = await api((c) => c.agents.create({ payload: { projectId: null, name: "Ops Out", instructions: "Runs ops.", model: "claude-cli/sonnet", access: "full" } }))
  const r = await api((c) => c.routines.create({ payload: { agentId: ops.id, name: "Cleanup", prompt: "tool:docs__delete_page", cron: null, webhook: true } }))
  const asked = (events: ChatEvent[]) => events.filter((e) => e._tag === "approval").length

  // The webhook's body is outside text: the sensitive tool waits for the person (denied here) though the agent has Full access.
  const hooked = await listening(r.chatId, () => api((c) => c.routines.hook({ params: { token: r.token! }, payload: { page: 7 } })))
  expect(asked(hooked)).toBe(1)
  expect(dones(hooked)[0]!.text).toContain("The user declined")

  // "Run now" carries only the person's own prompt: Full access, no card.
  const plain = await listening(r.chatId, () => api((c) => c.routines.run({ params: { id: r.id } })))
  expect(asked(plain)).toBe(0)
  expect(dones(plain)[0]!.text).toContain("=> result of delete_page")

  // The person writing in the same chat: Full access, no card.
  const own = await send(r.chatId, { text: "tool:docs__delete_page" })
  expect(asked(own.events)).toBe(0)

  // A hand-off from an outside turn carries the cap: the helper's call asks too.
  const relay = await api((c) => c.routines.create({ payload: { agentId: ops.id, name: "Relay", prompt: "@ops-out pass it on", cron: null, webhook: true } }))
  await api((c) => c.chats.update({ params: { id: relay.chatId }, payload: { agentIds: [ops.id, helper.id] } }))
  mentionNext.set("Ops Out", "@helper-out\ntool:docs__delete_page")
  const handed = await listening(relay.chatId, () => api((c) => c.routines.hook({ params: { token: relay.token! }, payload: { page: 8 } })))
  mentionNext.delete("Ops Out")
  expect(handed.some((e) => e._tag === "handoff" && e.to.includes(helper.id))).toBe(true)
  expect(asked(handed)).toBe(1)
  await api((c) => c.tools.remove({ params: { id: server.id } }))
})

// ---------- useful routines (spec 012) ----------
// What routines tell the person while `act` runs, until `done` says the run is over.
const noticesWhile = (act: () => Promise<unknown>, done: () => Promise<boolean>) =>
  rpc((c) =>
    Effect.gen(function* () {
      const got: Notice[] = []
      const fiber = yield* c.notices().pipe(Stream.runForEach((n) => Effect.sync(() => void got.push(n))), Effect.forkChild)
      yield* Effect.sleep("50 millis")
      yield* Effect.promise(act)
      for (let i = 0; i < 100 && !(yield* Effect.promise(done)); i++) yield* Effect.sleep("50 millis")
      yield* Effect.sleep("100 millis")
      yield* Fiber.interrupt(fiber)
      return got
    })
  )
const historyOf = (id: string) => api((c) => c.routines.history({ params: { id }, query: {} }))
const doneRuns = (id: string, n: number) => async () => (await historyOf(id)).filter((r) => r.state === "done").length >= n
const routine = async (name: string, extra: Record<string, unknown> = {}) => {
  const agent = await api((c) => c.agents.create({ payload: { projectId: null, name, instructions: `I am ${name}.`, model: "claude-cli/sonnet" } }))
  return api((c) => c.routines.create({ payload: { agentId: agent.id, name: `${name} check`, prompt: "Check the PRs", cron: null, webhook: true, ...extra } }))
}

test("routines (spec 012): the outcome decides the ping, the marker leaves the reply, the next run gets the last report", async () => {
  const r = await routine("Rex")
  mentionNext.set("Rex", "Nothing changed since yesterday.\n\nOutcome: nothing new")
  const quiet = await noticesWhile(() => api((c) => c.routines.run({ params: { id: r.id } })), doneRuns(r.id, 1))
  expect(quiet).toEqual([])
  let runs = await historyOf(r.id)
  expect(runs[0]).toMatchObject({ trigger: "now", state: "done", outcome: "nothing", summary: "Nothing changed since yesterday.", deliveredAt: null })
  const msgs = await api((c) => c.chats.messages({ params: { id: r.chatId } }))
  expect(msgs.at(-1)!.text).toBe("Nothing changed since yesterday.") // the marker line is gone
  expect(msgs[0]!.text).toContain("Outcome: needs you") // the run's instruction

  mentionNext.set("Rex", "PR #212 is now 4 days old.\nOutcome: something new")
  const told = await noticesWhile(() => api((c) => c.routines.run({ params: { id: r.id } })), doneRuns(r.id, 2))
  expect(told.map((n) => [n.outcome, n.text])).toEqual([["something", "PR #212 is now 4 days old."]])
  expect(turns.at(-1)!.messages.at(-1)!.text).toContain("<previous-run>\nNothing changed since yesterday.\n</previous-run>")

  mentionNext.set("Rex", "Here is a report with no marker.") // unreadable: "something", nothing dropped
  await noticesWhile(() => api((c) => c.routines.run({ params: { id: r.id } })), doneRuns(r.id, 3))
  runs = await historyOf(r.id)
  expect(runs[0]!.outcome).toBe("something")
  expect(runs.map((x) => x.state)).toEqual(["done", "done", "done"]) // newest first
  mentionNext.delete("Rex")
}, 20_000)

test("routines (spec 012): webhooks wait in line, in order; 20 waiting at most; a cheap check can end a run with no turn", async () => {
  const r = await routine("Quinn")
  await api((c) => c.settings.pause({ payload: { paused: true } }))
  for (let i = 1; i <= 20; i++) await api((c) => c.routines.hook({ params: { token: r.token! }, payload: { n: i } }))
  const full = await api((c) => c.routines.hook({ params: { token: r.token! }, payload: { n: 21 } })).catch((e: { _tag?: string }) => e._tag)
  expect(full).toBe("RoutineQueueFull")
  const runs = await historyOf(r.id)
  expect(runs.filter((x) => x.state === "queued")).toHaveLength(20)
  expect(runs[0]).toMatchObject({ state: "done", deliveryNote: "refused" })
  await api((c) => c.routines.remove({ params: { id: r.id } })) // its queue goes with it
  await api((c) => c.settings.pause({ payload: { paused: false } }))

  // In order, one after another.
  const q = await routine("Queue")
  const before = turns.length
  for (const n of [1, 2, 3]) await api((c) => c.routines.hook({ params: { token: q.token! }, payload: { n } }))
  for (let i = 0; i < 100 && !(await doneRuns(q.id, 3)()); i++) await Bun.sleep(50)
  const seen = turns.slice(before).map((t) => t.messages.at(-1)!.text).filter((x) => x.startsWith('Routine "Queue check"')).map((x) => /"n": (\d)/.exec(x)?.[1])
  expect(seen).toEqual(["1", "2", "3"])

  // Look first: the small model says no, so the agent never starts.
  const lf = await routine("Lookout", { lookFirst: true })
  const turnsBefore = turns.length
  await api((c) => c.routines.hook({ params: { token: lf.token! }, payload: { status: "green" } }))
  for (let i = 0; i < 100 && !(await doneRuns(lf.id, 1)()); i++) await Bun.sleep(50)
  expect((await historyOf(lf.id))[0]).toMatchObject({ outcome: "nothing", summary: "Checked: nothing to do", turnId: null, triageTokens: 45 })
  expect(turns.slice(turnsBefore).some((t) => t.messages.at(-1)!.text.startsWith("Routine"))).toBe(false)
  triageNext = "not json at all" // a check that can't be read: the agent runs
  await api((c) => c.routines.hook({ params: { token: lf.token! }, payload: { status: "red" } }))
  for (let i = 0; i < 100 && !(await doneRuns(lf.id, 2)()); i++) await Bun.sleep(50)
  expect((await historyOf(lf.id))[0]!.turnId).not.toBeNull()
  triageNext = '{"act": false, "why": "nothing to do"}'
  const anyAgent = (await api((x) => x.agents.list()))[0]!.id
  const bad = await api((c) => c.routines.create({ payload: { agentId: anyAgent, name: "No trigger", prompt: "x", cron: "0 9 * * *", webhook: false, lookFirst: true } })).catch((e: { _tag?: string }) => e._tag)
  expect(bad).toBe("RoutineInvalid")
}, 20_000)

test("routines (spec 012): quiet hours hold pings for Today; urgent needs you still pings; page and Telegram delivery", async () => {
  const r = await routine("Nora")
  const hm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const bad = await api((c) => c.settings.timeProfile({ payload: { timeZone: "Mars/Base", quietHours: null, dayStartSet: null } })).catch((e: { _tag?: string }) => e._tag)
  expect(bad).toBe("BadRequest")
  const prefs = await api((c) => c.settings.timeProfile({ payload: { timeZone: zone, quietHours: { from: hm(new Date(Date.now() - 3_600_000)), to: hm(new Date(Date.now() + 3_600_000)) }, dayStartSet: 540 } }))
  expect(prefs.timeProfile).toMatchObject({ timeZone: zone, dayStartMinutes: 540, dayStartSet: 540 })

  mentionNext.set("Nora", "Two new issues.\nOutcome: something new")
  const held = await noticesWhile(() => api((c) => c.routines.run({ params: { id: r.id } })), doneRuns(r.id, 1))
  expect(held).toEqual([])
  expect((await historyOf(r.id))[0]).toMatchObject({ outcome: "something", held: true })
  const today = await api((c) => c.routines.today())
  expect(today.found.map((x) => x.summary)).toContain("Two new issues.")

  await api((c) => c.routines.update({ params: { id: r.id }, payload: { urgent: true } }))
  mentionNext.set("Nora", "Pick one of the two proposals.\nOutcome: needs you")
  const urgent = await noticesWhile(() => api((c) => c.routines.run({ params: { id: r.id } })), doneRuns(r.id, 2))
  expect(urgent.map((n) => n.outcome)).toEqual(["needs"])
  const needs = (await api((c) => c.routines.today())).needs.find((x) => x.routineId === r.id)!
  await api((c) => c.routines.todayRead({ payload: { runIds: [needs.id] } }))
  expect((await api((c) => c.routines.today())).needs.some((x) => x.id === needs.id)).toBe(false)
  await api((c) => c.settings.timeProfile({ payload: { timeZone: zone, quietHours: null, dayStartSet: null } }))

  // A page: its body becomes the report, with a version kept. Telegram not paired: the notification instead.
  const page = await api((c) => c.pages.create({ payload: { scope: "user", title: "Issues today", body: "old" } }))
  await api((c) => c.routines.update({ params: { id: r.id }, payload: { delivery: { channels: ["page", "telegram"], pageId: page.id } } }))
  mentionNext.set("Nora", "Three new issues.\n- #1\n- #2\n- #3\nOutcome: something new")
  const fallback = await noticesWhile(() => api((c) => c.routines.run({ params: { id: r.id } })), doneRuns(r.id, 3))
  expect(fallback.map((n) => n.text)).toEqual(["Three new issues."])
  expect((await historyOf(r.id))[0]!.deliveryNote).toBe("telegram not paired")
  expect((await api((c) => c.pages.list())).find((p) => p.id === page.id)!.body).toBe("Three new issues.\n- #1\n- #2\n- #3")
  const noPage = await api((c) => c.routines.update({ params: { id: r.id }, payload: { delivery: { channels: ["page"] } } })).catch((e: { _tag?: string }) => e._tag)
  expect(noPage).toBe("RoutineInvalid")
  mentionNext.delete("Nora")

  await api((c) => c.routines.clearHistory({ params: { id: r.id } }))
  expect(await historyOf(r.id)).toEqual([])
  const week = await api((c) => c.routines.week({ query: { from: Date.now() - 86_400_000, to: Date.now() + 86_400_000 } }))
  expect(Array.isArray(week.runs) && Array.isArray(week.planned)).toBe(true)
  expect(await api((c) => c.routines.week({ query: { from: 0, to: Date.now() } })).catch((e: { _tag?: string }) => e._tag)).toBe("BadRequest")
}, 20_000)

test("routines (spec 012): a run that waits for approval needs you before it ends", async () => {
  const server = await api((c) => c.tools.create({ payload: { projectId: null, name: "docs2", command: "", args: [], url: `http://localhost:${mcp.port}/mcp`, env: {}, mode: "approve" } }))
  const r = await routine("Wade")
  await api((c) => c.routines.update({ params: { id: r.id }, payload: { prompt: "tool:docs2__delete_page" } }))
  const got = await noticesWhile(() => listening(r.chatId, () => api((c) => c.routines.run({ params: { id: r.id } }))), doneRuns(r.id, 1))
  expect(got[0]?.outcome).toBe("needs") // told while it waited
  expect(got).toHaveLength(1) // and not again when it ended
  await api((c) => c.tools.remove({ params: { id: server.id } }))
}, 20_000)

const approval = (a: "review" | "undo") => api((c) => c.settings.memoryApproval({ payload: { approval: a } }))

test("memory approval: review proposes, undo saves facts (skills still wait, with a notice); an agent that doesn't learn keeps its chats from learning", async () => {
  // The user's pending memories from earlier tests fill the review cap (20): the person clears them.
  for (const m of (await api((c) => c.memories.list())).filter((x) => x.state === "pending" && x.scope === "user")) await api((c) => c.memories.update({ params: { id: m.id }, payload: { state: "forgotten" } }))
  // A project each: a proposal that repeats a pending one in the same scope is dropped.
  let n = 0
  const learned = async (learns: boolean[]) => {
    const project = await api((c) => c.projects.create({ payload: { name: `Learning ${++n}`, brief: "" } }))
    const mk = async (on: boolean, i: number) => {
      const a = await api((c) => c.agents.create({ payload: { projectId: project.id, name: `A${i}`, instructions: "x", model: "claude-cli/sonnet" } }))
      expect(a).toMatchObject({ memory: "ask", knowledge: "write" }) // the defaults: it learns, and reads and writes pages
      return on ? a : api((c) => c.agents.update({ params: { id: a.id }, payload: { memory: "read" } }))
    }
    const agents = await Promise.all(learns.map(mk))
    const chat = await api((c) => c.chats.create({ payload: { projectId: project.id, agentIds: agents.map((a) => a.id), model: "claude-cli/sonnet" } }))
    await send(chat.id, { text: "hi" })
    const events = await compactListening(chat.id)
    const mine = (await api((c) => c.memories.list())).filter((m) => m.chatId === chat.id)
    const summary = (await api((c) => c.chats.list())).find((x) => x.id === chat.id)!.summary
    return { events, mine, summary }
  }

  expect((await api((c) => c.settings.preferences())).memoryApproval).toBe("review") // the default
  const review = await learned([true])
  expect(review.mine.map((m) => [m.kind, m.state]).sort()).toEqual([["fact", "pending"], ["skill", "pending"]])
  expect(review.events.some((e) => e._tag === "remembered")).toBe(false)

  await approval("undo")
  const undo = await learned([true])
  const fact = undo.mine.find((m) => m.kind === "fact")!
  expect(fact).toMatchObject({ state: "active", origin: "auto", text: "Deploys go out on fridays" })
  expect(undo.mine.find((m) => m.kind === "skill")!.state).toBe("pending") // a skill is instructions: it never turns on by itself
  const note = undo.events.find((e) => e._tag === "remembered")
  expect(note && note._tag === "remembered" && note.memories.map((m) => m.id)).toEqual([fact.id])
  // Undo: forgetting it is the existing PATCH.
  expect((await api((c) => c.memories.update({ params: { id: fact.id }, payload: { state: "forgotten" } }))).state).toBe("forgotten")

  const read = await learned([false])
  expect(read.mine).toEqual([]) // proposes nothing, saves nothing
  expect(read.summary).toBe("They talked about deploying.") // the chat's own summary still folds
  // One agent that doesn't learn keeps a shared chat from learning.
  expect((await learned([true, false])).mine).toEqual([])
  await approval("review")
})

test("memory approval undo (spec 011): a stretch holding a webhook's text only proposes", async () => {
  for (const m of (await api((c) => c.memories.list())).filter((x) => x.state === "pending")) await api((c) => c.memories.update({ params: { id: m.id }, payload: { state: "forgotten" } }))
  const project = await api((c) => c.projects.create({ payload: { name: "Outside learning", brief: "" } }))
  const agent = await api((c) => c.agents.create({ payload: { projectId: project.id, name: "Watcher", instructions: "Watches.", model: "claude-cli/sonnet" } }))
  const r = await api((c) => c.routines.create({ payload: { agentId: agent.id, name: "Intake", prompt: "Read it", cron: null, webhook: true } }))
  await approval("undo")
  await listening(r.chatId, () => api((c) => c.routines.hook({ params: { token: r.token! }, payload: { note: "deploys go out on fridays" } })))
  await compactListening(r.chatId)
  const mine = (await api((c) => c.memories.list())).filter((m) => m.chatId === r.chatId && m.kind === "fact")
  expect(mine.length).toBeGreaterThan(0)
  expect(mine.every((m) => m.state === "pending")).toBe(true) // with "undo" on, a plain chat keeps it (test above)
  await approval("review")
})

test("memory approval undo: at most 20 facts on their own per consolidation", async () => {
  await approval("undo")
  const agent = await api((c) => c.agents.create({ payload: { projectId: null, name: "Eager", instructions: "x", model: "claude-cli/sonnet" } }))
  const chat = await api((c) => c.chats.create({ payload: { projectId: null, agentIds: [agent.id], model: "claude-cli/sonnet" } }))
  await send(chat.id, { text: "hi" })
  manyMemories = 25
  manyWord = "gadget" // not the words an earlier test already stored
  const events = await compactListening(chat.id)
  manyMemories = 0
  manyWord = "subject"
  await approval("review")
  const mine = (await api((c) => c.memories.list())).filter((m) => m.chatId === chat.id)
  expect(mine.filter((m) => m.state === "active").length).toBe(20)
  const note = events.find((e) => e._tag === "remembered")
  expect(note && note._tag === "remembered" && note.memories.length).toBe(20)
})

test("memory mode and knowledge access gate the tools and the context, not only the screen", async () => {
  const project = await api((c) => c.projects.create({ payload: { name: "Gates", brief: "" } }))
  const page = await api((c) => c.pages.create({ payload: { scope: `project:${project.id}`, title: "Runbook", body: "Restart nginx" } }))
  await api((c) => c.pages.update({ params: { id: page.id }, payload: { pinned: true } }))
  await api((c) => c.memories.create({ payload: { scope: `project:${project.id}`, kind: "skill", title: "Restart", text: "1. restart" } })) // the prompt lists skills only when there are some
  const agent = await api((c) => c.agents.create({ payload: { projectId: project.id, name: "Gated", instructions: "x", model: "claude-cli/sonnet" } }))
  const chat = await api((c) => c.chats.create({ payload: { projectId: project.id, agentIds: [agent.id], model: "claude-cli/sonnet" } }))
  const names = () => turns.at(-1)!.tools!.defs.map((d) => d.name)

  await send(chat.id, { text: "hi" })
  expect(names()).toEqual(expect.arrayContaining(["zorel_knowledge_write", "zorel_knowledge_read", "zorel_knowledge_search", "zorel_propose_skill"]))
  expect(turns.at(-1)!.system).toContain(`### Runbook [${page.id}]\nRestart nginx`)
  expect(turns.at(-1)!.system).toContain("propose it with zorel_propose_skill")

  await api((c) => c.agents.update({ params: { id: agent.id }, payload: { memory: "read", knowledge: "read" } }))
  const refused = dones((await send(chat.id, { text: 'tool:zorel_knowledge_write {"title":"Nope","body":"x","scope":"project"}' })).events)[0]!
  expect(names()).not.toContain("zorel_knowledge_write")
  expect(names()).not.toContain("zorel_propose_skill")
  expect(names()).toEqual(expect.arrayContaining(["zorel_knowledge_read", "zorel_knowledge_search", "zorel_read_skill"])) // reading stays
  expect(refused.text).not.toContain("Saved")
  expect((await api((c) => c.pages.list())).some((p) => p.title === "Nope")).toBe(false)
  expect(turns.at(-1)!.system).not.toContain("propose it with zorel_propose_skill")

  await api((c) => c.agents.update({ params: { id: agent.id }, payload: { memory: "ask", knowledge: "none" } }))
  await send(chat.id, { text: "hi again" })
  for (const n of ["zorel_knowledge_write", "zorel_knowledge_read", "zorel_knowledge_search"]) expect(names()).not.toContain(n)
  expect(turns.at(-1)!.system).not.toContain("Runbook")
  expect(names()).toContain("zorel_propose_skill") // skills aren't knowledge pages

  // Every change is a version of the agent, and can be restored.
  const versions = await api((c) => c.agents.versions({ params: { id: agent.id } }))
  expect(versions[0]!.profile).toMatchObject({ memory: "ask", knowledge: "none" })
  expect(versions.map((v) => v.profile.memory)).toContain("read")
})

test("skills by agent: a skill that lists agents shows only to them; empty means everyone", async () => {
  const project = await api((c) => c.projects.create({ payload: { name: "Teams", brief: "" } }))
  const mk = (name: string) => api((c) => c.agents.create({ payload: { projectId: project.id, name, instructions: "x", model: "claude-cli/sonnet" } }))
  const [rev, dev] = [await mk("Rev"), await mk("Dev")]
  const scope = `project:${project.id}`
  const only = await api((c) => c.memories.create({ payload: { scope, kind: "skill", title: "Review PRs", text: "1. read the diff", agents: [rev.id] } }))
  await api((c) => c.memories.create({ payload: { scope, kind: "skill", title: "Ship it", text: "1. tag" } }))
  expect(only.agents).toEqual([rev.id])
  const chatOf = (agentId: string) => api((c) => c.chats.create({ payload: { projectId: project.id, agentIds: [agentId], model: "claude-cli/sonnet" } }))
  const [forRev, forDev] = [await chatOf(rev.id), await chatOf(dev.id)]

  await send(forRev.id, { text: "hi" })
  expect(turns.at(-1)!.system).toContain("- Review PRs")
  expect(turns.at(-1)!.system).toContain("- Ship it")
  await send(forDev.id, { text: "hi" })
  expect(turns.at(-1)!.system).not.toContain("Review PRs")
  expect(turns.at(-1)!.system).toContain("- Ship it")
  // $handle and search don't bring it to the others either
  await send(forDev.id, { text: "use $review-prs on the diff" })
  expect(turns.at(-1)!.system).not.toContain("1. read the diff")
  await send(forRev.id, { text: "use $review-prs on the diff" })
  expect(turns.at(-1)!.system).toContain("1. read the diff")
  // zorel_read_skill
  expect(dones((await send(forDev.id, { text: 'tool:zorel_read_skill {"skill":"Review PRs"}' })).events)[0]!.text).toContain('No skill "Review PRs"')
  expect(dones((await send(forRev.id, { text: 'tool:zorel_read_skill {"skill":"Review PRs"}' })).events)[0]!.text).toContain("1. read the diff")
  // improving one the agent can't see is refused like a missing one
  expect(dones((await send(forDev.id, { text: 'tool:zorel_propose_skill {"title":"Review PRs","steps":"x","reason":"y","improves":"Review PRs"}' })).events)[0]!.text).toContain("No skill")

  // Empty again: everyone.
  await api((c) => c.memories.update({ params: { id: only.id }, payload: { agents: [] } }))
  await send(forDev.id, { text: "hi" })
  expect(turns.at(-1)!.system).toContain("- Review PRs")

  // The server checks the ids: unknown, archived, or on something that isn't a skill.
  const bad = (f: () => Promise<unknown>) => f().then(() => "ok", (e: { _tag?: string }) => e._tag)
  expect(await bad(() => api((c) => c.memories.update({ params: { id: only.id }, payload: { agents: ["nobody"] } })))).toBe("BadRequest")
  const gone = await mk("Gone")
  await api((c) => c.agents.update({ params: { id: gone.id }, payload: { archived: true } }))
  expect(await bad(() => api((c) => c.memories.update({ params: { id: only.id }, payload: { agents: [gone.id] } })))).toBe("BadRequest")
  expect(await bad(() => api((c) => c.memories.create({ payload: { scope, kind: "skill", title: "X", text: "y", agents: ["nobody"] } })))).toBe("BadRequest")
  const fact = await api((c) => c.memories.create({ payload: { scope, kind: "fact", title: "", text: "A fact", } }))
  expect(await bad(() => api((c) => c.memories.update({ params: { id: fact.id }, payload: { agents: [rev.id] } })))).toBe("BadRequest")
})

test("file skills: only a path the scan found can be turned on", async () => {
  const bad = await api((c) => c.settings.pickFileSkill({ payload: { path: "/etc/passwd", enabled: true } })).catch((e: unknown) => e)
  expect((bad as { _tag?: string })._tag).toBe("NotFound")
  const list = await api((c) => c.settings.fileSkills())
  expect(list.every((s) => !s.enabled)).toBe(true)
})

test("memory edits that collide are refused (409), and a removed project takes its pages with it", async () => {
  const project = await api((c) => c.projects.create({ payload: { name: "Cleanup", brief: "" } }))
  const scope = `project:${project.id}`
  await api((c) => c.memories.create({ payload: { scope, kind: "fact", title: "", text: "Builds run on CI" } }))
  const other = await api((c) => c.memories.create({ payload: { scope, kind: "fact", title: "", text: "Releases on Mondays" } }))
  const taken = await api((c) => c.memories.update({ params: { id: other.id }, payload: { text: "builds run on CI!" } })).catch((e: unknown) => e)
  expect((taken as { _tag?: string })._tag).toBe("Conflict")
  expect((await api((c) => c.memories.update({ params: { id: other.id }, payload: { text: "Releases on Tuesdays" } }))).text).toBe("Releases on Tuesdays")

  const agent = await api((c) => c.agents.create({ payload: { projectId: project.id, name: "Keeper", instructions: "", model: "claude-cli/sonnet" } }))
  await api((c) => c.pages.create({ payload: { scope, title: "Cleanup runbook", body: "x" } }))
  await api((c) => c.pages.create({ payload: { scope: `agent:${agent.id}`, title: "Keeper notes", body: "y" } }))
  await api((c) => c.projects.remove({ params: { id: project.id } }))
  const titles = (await api((c) => c.pages.list())).map((p) => p.title)
  expect(titles).not.toContain("Cleanup runbook")
  expect(titles).not.toContain("Keeper notes")
})

test("memory moves to another owner that exists; only a forgotten one is deleted for good", async () => {
  const project = await api((c) => c.projects.create({ payload: { name: "Mover", brief: "" } }))
  const m = await api((c) => c.memories.create({ payload: { scope: "user", kind: "fact", title: "", text: "Ships on Thursdays" } }))
  const moved = await api((c) => c.memories.update({ params: { id: m.id }, payload: { scope: `project:${project.id}` } }))
  expect(moved.scope).toBe(`project:${project.id}`)
  const nowhere = await api((c) => c.memories.update({ params: { id: m.id }, payload: { scope: "project:missing" } })).catch((e: unknown) => e)
  expect((nowhere as { _tag?: string })._tag).toBe("BadRequest")
  const active = await api((c) => c.memories.remove({ params: { id: m.id } })).catch((e: unknown) => e)
  expect((active as { _tag?: string })._tag).toBe("Conflict") // forget it first
  await api((c) => c.memories.update({ params: { id: m.id }, payload: { state: "forgotten" } }))
  await api((c) => c.memories.remove({ params: { id: m.id } }))
  expect((await api((c) => c.memories.list())).some((x) => x.id === m.id)).toBe(false)
})

test("zorel_remember: the approval setting decides (undo keeps, review proposes); an agent that doesn't learn lacks the tool; credentials and repeats aren't kept", async () => {
  const agent = await api((c) => c.agents.create({ payload: { projectId: null, name: "Keeper", instructions: "x", model: "claude-cli/sonnet" } }))
  await approval("undo")
  const chat = await api((c) => c.chats.create({ payload: { projectId: null, agentIds: [agent.id], model: "claude-cli/sonnet" } }))
  const remember = (text: string, about = "user") => send(chat.id, { text: `tool:zorel_remember ${JSON.stringify({ text, about })}` })
  const mine = async () => (await api((c) => c.memories.list())).filter((m) => m.chatId === chat.id)

  expect(dones((await remember("Drinks green tea")).events)[0]!.text).toContain("Kept")
  expect((await mine()).find((m) => m.text === "Drinks green tea")).toMatchObject({ state: "active", agentId: agent.id, scope: "user" })
  expect(dones((await remember("Drinks green tea")).events)[0]!.text).toContain("Already kept") // a repeat confirms it
  expect(dones((await remember("Plays chess", "project")).events)[0]!.text).toContain("no project")
  expect(dones((await remember("The api key is sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH")).events)[0]!.text).toContain("credential")

  await approval("review")
  await remember("Works from Lisbon")
  expect((await mine()).find((m) => m.text === "Works from Lisbon")?.state).toBe("pending")

  await api((c) => c.agents.update({ params: { id: agent.id }, payload: { memory: "read" } }))
  await send(chat.id, { text: "hi" })
  expect(turns.at(-1)!.tools!.defs.map((d) => d.name)).not.toContain("zorel_remember")
})

test("many MCP tools: the turn lists find/use instead, and a found tool is called through the same path", async () => {
  manyTools = 80
  try {
    const project = await api((c) => c.projects.create({ payload: { name: "Big", brief: "" } }))
    await api((c) => c.tools.create({ payload: { projectId: project.id, name: "docs", command: "", args: [], url: `http://localhost:${mcp.port}/mcp`, env: {}, mode: "read" } }))
    const chat = await api((c) => c.chats.create({ payload: { projectId: project.id, agentIds: [], model: "claude-cli/sonnet" } }))
    const found = dones((await send(chat.id, { text: 'tool:zorel_find_tools {"query":"search the docs"}' })).events)[0]!
    const listed = turns.at(-1)!.tools!.defs.map((d) => d.name)
    expect(listed).toEqual(expect.arrayContaining(["zorel_find_tools", "zorel_use_tool"]))
    expect(listed).not.toContain("docs__search_docs") // not listed: found on demand
    expect(found.text).toContain("docs__search_docs: Searches the docs")
    const used = dones((await send(chat.id, { text: 'tool:zorel_use_tool {"name":"docs__search_docs","arguments":{"q":"deploy"}}' })).events)[0]!
    expect(used.text).toContain("result of search_docs")
    const unknown = dones((await send(chat.id, { text: 'tool:zorel_use_tool {"name":"docs__nope"}' })).events)[0]!
    expect(unknown.text).toContain("Find it with zorel_find_tools first")
  } finally {
    manyTools = 0
  }
})

test("Telegram channel: strangers are turned away, a paired account talks to Zorel and gets the reply", async () => {
  const inbox: Array<{ update_id: number; message: { text: string; chat: { id: number }; from: { id: number } } }> = []
  const sent: Array<{ chat_id: number; text: string }> = []
  let next = 1
  const tg = Bun.serve({
    port: 0,
    async fetch(req) {
      const method = new URL(req.url).pathname.split("/").pop()
      const body = (await req.json()) as { offset?: number; chat_id?: number; text?: string }
      if (method === "getUpdates") {
        const ready = inbox.filter((u) => u.update_id >= (body.offset ?? 0))
        if (!ready.length) await Bun.sleep(100)
        return Response.json({ ok: true, result: ready })
      }
      if (method === "sendMessage") sent.push({ chat_id: body.chat_id!, text: body.text! })
      return Response.json({ ok: true, result: true })
    }
  })
  const say = (from: number, text: string) => inbox.push({ update_id: next++, message: { text, chat: { id: from }, from: { id: from } } })
  const replyTo = async (chat: number, has: string) => {
    for (let i = 0; i < 200; i++) {
      const m = sent.find((s) => s.chat_id === chat && s.text.includes(has))
      if (m) return m.text
      await Bun.sleep(50)
    }
    throw new Error(`no reply with "${has}" to ${chat}; got ${JSON.stringify(sent)}`)
  }
  process.env.ZOREL_TELEGRAM_API = `http://localhost:${tg.port}`
  try {
    expect((await api((c) => c.settings.telegram())).tokenSet).toBe(false)
    await api((c) => c.settings.setKey({ params: { name: "TELEGRAM_BOT_TOKEN" }, payload: { value: "123:fake" } }))
    say(777, "hello?")
    expect(await replyTo(777, "This bot is private")).toContain("/pair")
    const { pairing } = await api((c) => c.settings.telegramPair())
    say(777, "/pair WRONG1")
    await replyTo(777, "This bot is private")
    say(42, `/pair ${pairing!.code}`)
    expect(await replyTo(42, "Paired with Zorel")).toBeTruthy()
    expect((await api((c) => c.settings.telegram())).users).toBe(1)
    expect((await api((c) => c.settings.telegram())).pairing).toBeNull() // one use
    say(42, "what's up")
    expect(await replyTo(42, "echo: what's up")).toBe("echo: what's up")
    expect((await api((c) => c.chats.list())).some((c) => c.title === "Telegram")).toBe(true)
    say(777, "what's up") // still a stranger
    await Bun.sleep(300)
    expect(sent.filter((s) => s.chat_id === 777 && s.text.startsWith("echo")).length).toBe(0)
    await api((c) => c.settings.telegramUnpair())
    expect((await api((c) => c.settings.telegram())).users).toBe(0)
  } finally {
    await api((c) => c.settings.setKey({ params: { name: "TELEGRAM_BOT_TOKEN" }, payload: { value: "" } }))
    delete process.env.ZOREL_TELEGRAM_API
    tg.stop(true)
  }
}, 30_000)

test("routine flows (spec 013): an old routine's flow, versions, refusals, the tool catalog, Test step and a run's steps", async () => {
  const agent = await api((c) => c.agents.create({ payload: { projectId: null, name: "Flowy", instructions: "", model: "claude-cli/sonnet" } }))
  const server = await api((c) => c.tools.create({ payload: { projectId: null, name: "wiki", command: "", args: [], url: `http://localhost:${mcp.port}/mcp`, env: {}, mode: "read" } }))
  const r = await api((c) => c.routines.create({ payload: { agentId: agent.id, name: "Flow", prompt: "Sum it up", cron: null, webhook: false } }))
  const old = await api((c) => c.routines.flow({ params: { id: r.id } }))
  expect(old.version).toBeNull()
  expect(old.graph.nodes.map((n) => n.kind)).toEqual(["trigger", "agent", "end"])

  const tagOf = (e: unknown) => (e as { _tag?: string })._tag
  const save = (graph: typeof old.graph, baseVersion: number | null) => api((c) => c.routines.saveFlow({ params: { id: r.id }, payload: { graph, baseVersion } }))
  const stray = { id: "x", kind: "agent" as const, x: 0, y: 0, config: { prompt: "alone" } }
  const unreachable = await save({ ...old.graph, nodes: [...old.graph.nodes, stray] }, null).catch((e: unknown) => e)
  expect(unreachable).toMatchObject({ _tag: "FlowInvalid", nodeId: "x" })
  const tool = { id: "look", kind: "tool" as const, x: 0, y: 80, config: { serverId: server.id, tool: "search_docs", args: { q: "deploy" } } }
  const graph = {
    nodes: [old.graph.nodes[0]!, tool, old.graph.nodes[1]!, old.graph.nodes[2]!],
    edges: [{ id: "a", from: "trigger", to: "look" }, { id: "b", from: "look", to: "agent" }, { id: "c", from: "agent", to: "end" }]
  }
  const missingTool = await save({ ...graph, nodes: graph.nodes.map((n) => (n.id === "look" ? { ...tool, config: { ...tool.config, tool: "nope" } } : n)) }, null).catch((e: unknown) => e)
  expect(missingTool).toMatchObject({ _tag: "FlowInvalid", nodeId: "look", field: "tool" })
  expect((await save(graph, null)).version).toBe(1)
  expect(tagOf(await save(graph, null).catch((e: unknown) => e))).toBe("FlowConflict") // saved on top of an old version
  expect((await api((c) => c.routines.flowVersion({ params: { id: r.id, n: 1 } }))).graph).toEqual(graph)
  expect((await api((c) => c.routines.list())).find((x) => x.id === r.id)!.version).toBe(1)

  // the picker: a "read" connector lets this agent read, not delete
  const catalog = await api((c) => c.tools.catalog({ params: { id: server.id }, query: { agentId: agent.id } }))
  expect(Object.fromEntries(catalog.tools.map((t) => [t.name, t.state]))).toMatchObject({ search_docs: "usable", delete_page: "read-only" })
  expect(tagOf(await api((c) => c.tools.options({ params: { id: server.id }, payload: { tool: "delete_page", args: {} } })).catch((e: unknown) => e))).toBe("BadRequest")
  const tested = await api((c) => c.routines.testStep({ params: { id: r.id }, payload: { graph, nodeId: "look" } }))
  expect(tested).toEqual({ output: "result of search_docs", dry: false, error: null })

  // a run goes through the flow: trigger, the tool, the agent (given the tool's result), the end
  await api((c) => c.routines.run({ params: { id: r.id } }))
  let runs = await api((c) => c.routines.history({ params: { id: r.id }, query: {} }))
  for (let i = 0; i < 100 && runs[0]?.state !== "done"; i++) {
    await Bun.sleep(50)
    runs = await api((c) => c.routines.history({ params: { id: r.id }, query: {} }))
  }
  const detail = await api((c) => c.routines.runDetail({ params: { id: r.id, runId: runs[0]!.id } }))
  expect(detail.run.version).toBe(1)
  expect(detail.steps.map((s) => [s.nodeId, s.state])).toEqual([["trigger", "done"], ["look", "done"], ["agent", "done"], ["end", "done"]])
  expect(detail.steps[2]!.input).toBe("result of search_docs")
  expect(detail.steps[2]!.output).toContain("echo: Routine \"Flow\"")
  expect((await api((c) => c.routines.stepOutput({ params: { id: r.id, runId: runs[0]!.id, stepId: detail.steps[1]!.id } }))).text).toBe("result of search_docs")
  expect(tagOf(await api((c) => c.routines.resolveStep({ params: { id: r.id, runId: runs[0]!.id }, payload: { stepId: detail.steps[1]!.id, choice: "again" } })).catch((e: unknown) => e))).toBe("BadRequest") // not uncertain
}, 20_000)

test("routine flows P2 (spec 013): schedules from the trigger, a connector destination checked on save, a gone connector blocks turning on", async () => {
  const agent = await api((c) => c.agents.create({ payload: { projectId: null, name: "Planner", instructions: "", model: "claude-cli/sonnet" } }))
  const server = await api((c) => c.tools.create({ payload: { projectId: null, name: "kb2", command: "", args: [], url: `http://localhost:${mcp.port}/mcp`, env: {}, mode: "approve" } }))
  const r = await api((c) => c.routines.create({ payload: { agentId: agent.id, name: "Monthly", prompt: "Close the month", cron: null, webhook: false } }))
  const old = await api((c) => c.routines.flow({ params: { id: r.id } }))
  const withTrigger = (config: Record<string, unknown>) => ({ ...old.graph, nodes: old.graph.nodes.map((n) => (n.kind === "trigger" ? { ...n, config } : n)) }) as typeof old.graph
  await api((c) => c.routines.saveFlow({ params: { id: r.id }, payload: { graph: withTrigger({ on: "monthly", day: 31, time: "08:00" }), baseVersion: null } }))
  const saved = (await api((c) => c.routines.list())).find((x) => x.id === r.id)!
  expect(saved.schedule).toEqual({ kind: "monthly", day: 31, time: "08:00" })
  expect(saved.cron).toBeNull()
  expect(saved.nextRunAt).toBeGreaterThan(Date.now())
  const past = await api((c) => c.routines.saveFlow({ params: { id: r.id }, payload: { graph: withTrigger({ on: "once", date: "2020-01-01", time: "08:00" }), baseVersion: 1 } })).catch((e: unknown) => e)
  expect(past).toMatchObject({ _tag: "FlowInvalid", field: "date" })
  const times = await api((c) => c.routines.testTrigger({ params: { id: r.id }, payload: { graph: withTrigger({ on: "monthly", day: 31, time: "08:00" }) } }))
  expect(times.times).toHaveLength(3)

  // a destination must be a tool that writes, with that text input
  const delivery = (tool: string, textField: string) => ({ channels: ["notify" as const], connectors: [{ serverId: server.id, tool, args: {}, textField }] })
  expect(await api((c) => c.routines.update({ params: { id: r.id }, payload: { delivery: delivery("search_docs", "q") } })).catch((e: unknown) => e)).toMatchObject({ _tag: "RoutineInvalid" })
  expect(await api((c) => c.routines.update({ params: { id: r.id }, payload: { delivery: delivery("delete_page", "body") } })).catch((e: unknown) => e)).toMatchObject({ _tag: "RoutineInvalid" })
  expect((await api((c) => c.routines.update({ params: { id: r.id }, payload: { delivery: delivery("delete_page", "id") } }))).delivery.connectors).toHaveLength(1)

  // the connector goes; the routine can't be turned on again until that's fixed
  await api((c) => c.routines.update({ params: { id: r.id }, payload: { enabled: false } }))
  await api((c) => c.tools.remove({ params: { id: server.id } }))
  expect(await api((c) => c.routines.update({ params: { id: r.id }, payload: { enabled: true } })).catch((e: unknown) => e)).toMatchObject({ _tag: "RoutineInvalid" })
}, 20_000)
