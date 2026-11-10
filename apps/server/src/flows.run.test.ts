// Spec 013: flow runs end to end against a fake MCP server, with a stub runtime (each agent turn answers at once).
// Restarts are what the database keeps: rows left halfway, then resumeFlow.
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from "@modelcontextprotocol/sdk/types.js"
import { type Agent, type AgentPermissions, type FlowGraph, type FlowNode, type McpServer, validateFlow } from "@zorel/contracts"
import { Effect, Layer, ManagedRuntime, Stream } from "effect"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DataDir } from "./chat.ts"
import { type Repository, type RoutineRow, Store } from "./db.ts"
import { Engines } from "./engines.ts"
import { flowTiming, type FlowHooks, onFlowTurn, recoverDeliveries, resumeFlow, runFlow, testTrigger } from "./flows.ts"
import { resolveStep, runRoutine, tick } from "./routines.ts"
import { Runtime, type RunStepApproval, type RuntimeService } from "./runtime.ts"
import { createRoutineFor, freshItems } from "./schedule.ts"
import { Secrets } from "./secrets.ts"
import { Tools } from "./tools.ts"

// ---------- fake connector ----------
const calls: Array<{ name: string; args: unknown }> = []
const failNext: Array<number> = [] // error codes the next post_message calls throw, in order
let listText = JSON.stringify({ items: [{ id: "i1", title: "First" }] })
const mcp = Bun.serve({
  port: 0,
  async fetch(req) {
    const server = new Server({ name: "chat", version: "1" }, { capabilities: { tools: {} } })
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        { name: "list_items", description: "Lists items", inputSchema: { type: "object", properties: { q: { type: "string" } } } },
        { name: "post_message", description: "Posts", inputSchema: { type: "object", properties: { channel: { type: "string" }, text: { type: "string" } }, required: ["channel", "text"] } }
      ]
    }))
    server.setRequestHandler(CallToolRequestSchema, async (r) => {
      calls.push({ name: r.params.name, args: r.params.arguments })
      const code = r.params.name === "post_message" ? failNext.shift() : undefined
      if (code !== undefined) throw new McpError(code, "nope")
      return { content: [{ type: "text", text: r.params.name === "list_items" ? listText : "posted" }] }
    })
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true })
    await server.connect(transport)
    return transport.handleRequest(req)
  }
})

// ---------- stub runtime ----------
const sent: Array<{ text: string; outside: boolean }> = []
const approvals: RunStepApproval[] = []
let approvalAnswer: "approved" | "denied" | "expired" = "approved"
let reply = "Two new items.\nOutcome: something new"
const StubRuntime = Layer.effect(
  Runtime,
  Effect.gen(function* () {
    const store = yield* Store
    return {
      send: (input: { chatId: string; clientId: string; text: string }, opts?: { outside?: boolean }) =>
        Effect.gen(function* () {
          sent.push({ text: input.text, outside: !!opts?.outside })
          const m = yield* store.addMessage({ chatId: input.chatId, role: "assistant", agentId: null, text: reply, model: null, error: null, steps: [], inputTokens: 0, outputTokens: 0 })
          yield* Effect.forkDetach(Effect.andThen(Effect.sleep("5 millis"), onFlowTurn({ turnId: "t", chatId: input.chatId, clientId: input.clientId, state: "completed", messageId: m.id, error: null, cost: null })))
          return { turnId: "t" }
        }),
      requestApproval: (req: RunStepApproval) =>
        Effect.sync(() => {
          approvals.push(req)
          return approvalAnswer
        }),
      finished: Stream.empty,
      subscribeStatus: Stream.empty,
      busy: () => false,
      paused: () => false
    } as unknown as RuntimeService
  })
)
const layer = Layer.provideMerge(
  Layer.mergeAll(StubRuntime, Tools.layer, DataDir.layer(mkdtempSync(join(tmpdir(), "zorel-flows-"))), Layer.succeed(Engines, {} as never)),
  Layer.provideMerge(Secrets.memory(), Store.layer(":memory:"))
)
const rt = ManagedRuntime.make(layer)
const withStore = <A, E, R>(f: (s: Repository) => Effect.Effect<A, E, R>) => Effect.gen(function* () {
  return yield* f(yield* Store)
})
const go = <A>(e: Effect.Effect<A, unknown, Store | Runtime | Tools | DataDir | Engines | Secrets>) => rt.runPromise(e)
afterAll(async () => {
  await rt.dispose()
  void mcp.stop(true)
})

let server: McpServer
let agent: Agent
beforeAll(async () => {
  server = await go(withStore((s) => s.createMcpServer({ projectId: null, name: "Chat", command: "", args: [], url: `http://127.0.0.1:${mcp.port}`, envKeys: [], mode: "auto", auth: "none" })))
  agent = await go(withStore((s) => s.createAgent({ projectId: null, name: "Atlas", instructions: "", model: "x/y", access: "workspace" })))
  flowTiming.retryMs = 1
})
beforeEach(() => {
  calls.length = 0
  sent.length = 0
  approvals.length = 0
  failNext.length = 0
  approvalAnswer = "approved"
  reply = "Two new items.\nOutcome: something new"
})

// ---------- helpers ----------
const at = { x: 0, y: 0 }
const trigger = (on: "manual" | "webhook" = "manual"): FlowNode => ({ id: "t", kind: "trigger", ...at, config: { on } })
const read: FlowNode = { id: "read", kind: "tool", ...at, config: { serverId: "", tool: "list_items", args: { q: "new" } } }
const think: FlowNode = { id: "think", kind: "agent", ...at, config: { prompt: "Sum up the items" } }
const post = (args: Record<string, unknown> = { channel: "C1", text: { $from: "think" } }, retries = 1): FlowNode => ({ id: "post", kind: "tool", ...at, config: { serverId: "", tool: "post_message", args, retries } })
const chain = (...nodes: FlowNode[]): FlowGraph => ({
  nodes: nodes.map((n) => (n.kind === "tool" ? { ...n, config: { ...n.config, serverId: server.id } } : n)),
  edges: nodes.slice(1).map((n, i) => ({ id: `e${i}`, from: nodes[i]!.id, to: n.id }))
})

const routineWith = (graph: FlowGraph, perms?: AgentPermissions) =>
  go(
    Effect.gen(function* () {
      const store = yield* Store
      const who = perms ? yield* store.createAgent({ projectId: null, name: `A${crypto.randomUUID().slice(0, 4)}`, instructions: "", model: "x/y", access: "workspace", permissions: perms }) : agent
      const r = yield* createRoutineFor(store, who, { name: "Flow", prompt: "x", cron: null, webhook: true }).pipe(Effect.orDie)
      yield* store.addVersion(r.id, graph)
      return (yield* store.routine(r.id))!
    })
  )
const settled = async (routineId: string) => {
  for (let i = 0; i < 300; i++) {
    const runs = await go(withStore((s) => s.routineRunsOf(routineId)))
    if (runs[0] && (runs[0].state === "done" || runs[0].outcome === "needs")) return runs[0]
    await Bun.sleep(10)
  }
  throw new Error("the run didn't settle")
}
const stepsOf = (runId: string) => go(withStore((s) => s.stepsOfRun(runId)))
const ended: Array<{ outcome: string; summary: string; report?: string }> = []
const hooks: FlowHooks = { finish: (end) => Effect.sync(() => void ended.push(end)), needs: (summary) => Effect.sync(() => void ended.push({ outcome: "needs", summary })) }

// ---------- tests ----------
test("read → agent → post: every step kept with its previews; the agent's reply is posted once", async () => {
  const r = await routineWith(chain(trigger(), read, think, post()))
  await go(runRoutine(r.id, `now-${Date.now()}`))
  const run = await settled(r.id)
  expect(run.outcome).toBe("something")
  expect(run.version).toBe(1)
  const steps = await stepsOf(run.id)
  expect(steps.map((s) => [s.nodeId, s.state])).toEqual([["t", "done"], ["read", "done"], ["think", "done"], ["post", "done"]])
  expect(steps[1]!.output).toContain("First")
  expect(steps[2]!.input).toContain("First") // the agent got the read's result
  expect(sent[0]!.text).toContain('"title": "First"')
  expect(calls.map((c) => c.name)).toEqual(["list_items", "post_message"])
  expect(calls[1]!.args).toEqual({ channel: "C1", text: "Two new items." }) // the marker line is off the reply
})

test("rules as chat: an agent with read access can't post; an outside trigger asks first; a declined post sends nothing", async () => {
  const readOnly = await routineWith(chain(trigger(), post({ channel: "C1", text: "hi" })), { web: false, browser: false, grants: {}, always: [], apps: false, computer: "none" } as unknown as AgentPermissions)
  await go(withStore((s) => s.updateAgent(readOnly.agentId, { permissions: { ...(({}) as AgentPermissions), web: false, browser: false, always: [], grants: { [server.id]: "read" } } as AgentPermissions })))
  await go(runRoutine(readOnly.id, `now-${Date.now()}`))
  const refused = await settled(readOnly.id)
  expect(refused.outcome).toBe("needs")
  expect((await stepsOf(refused.id)).at(-1)!.error).toContain("can't use post_message")
  expect(calls).toEqual([])

  // a webhook's body is outside text: the post waits for the person even on an "auto" connector
  const outside = await routineWith(chain(trigger("webhook"), post({ channel: "C1", text: "hi" })))
  approvalAnswer = "denied"
  await go(runRoutine(outside.id, `hook-${Date.now()}`, { from: "someone" }))
  const declined = await settled(outside.id)
  expect(approvals).toHaveLength(1)
  expect(approvals[0]!.runStepId).toBeDefined()
  expect(declined.outcome).toBe("nothing")
  expect(calls).toEqual([])
})

test("retries: a post refused before running goes again; one that may have run doesn't", async () => {
  const r = await routineWith(chain(trigger(), post({ channel: "C1", text: "hi" })))
  failNext.push(ErrorCode.InvalidParams)
  await go(runRoutine(r.id, `now-${Date.now()}`))
  const ok = await settled(r.id)
  expect(calls.map((c) => c.name)).toEqual(["post_message", "post_message"])
  expect((await stepsOf(ok.id)).at(-1)).toMatchObject({ state: "done", attempt: 2 })

  calls.length = 0
  failNext.push(ErrorCode.InternalError)
  await go(runRoutine(r.id, `now-${Date.now() + 1}`))
  const failed = await settled(r.id)
  expect(failed.outcome).toBe("needs")
  expect(calls).toHaveLength(1)
  expect((await stepsOf(failed.id)).at(-1)!.error).toContain("isn't sent again")
})

test("restart mid-read: the read runs again and the run goes on", async () => {
  const r = await routineWith(chain(trigger(), read, think))
  const run = await go(
    Effect.gen(function* () {
      const store = yield* Store
      const run = yield* store.addRun({ routineId: r.id, trigger: "now", state: "running", version: 1 })
      const t = yield* store.addRunStep({ runId: run.id, nodeId: "t" })
      yield* store.updateRunStep(t.id, { state: "done" })
      yield* store.addRunStep({ runId: run.id, nodeId: "read" }) // the server stopped here
      return run
    })
  )
  ended.length = 0
  await go(resumeFlow(r, run, hooks))
  expect(ended).toEqual([{ outcome: "something", summary: "Two new items.", report: "Two new items." }])
  const steps = await stepsOf(run.id)
  expect(steps.find((s) => s.nodeId === "read")).toMatchObject({ state: "done", attempt: 2 })
  expect(calls.map((c) => c.name)).toEqual(["list_items"])
})

test("restart mid-write: uncertain, the person is asked; send again posts once", async () => {
  const r = await routineWith(chain(trigger(), post({ channel: "C1", text: "hi" })))
  const run = await go(
    Effect.gen(function* () {
      const store = yield* Store
      const run = yield* store.addRun({ routineId: r.id, trigger: "now", state: "running", version: 1 })
      const t = yield* store.addRunStep({ runId: run.id, nodeId: "t" })
      yield* store.updateRunStep(t.id, { state: "done" })
      const p = yield* store.addRunStep({ runId: run.id, nodeId: "post" })
      yield* store.updateRunStep(p.id, { mayHaveWritten: true }) // sent, then the server stopped
      return run
    })
  )
  ended.length = 0
  await go(resumeFlow(r, run, hooks))
  expect(calls).toEqual([])
  expect(ended[0]!.outcome).toBe("needs")
  const uncertain = (await stepsOf(run.id)).at(-1)!
  expect(uncertain.state).toBe("uncertain")
  // resolving it again does nothing more than once
  expect(await go(resolveStep(run.id, uncertain.id, "again"))).toBe(true)
  expect(await go(resolveStep(run.id, uncertain.id, "again"))).toBe(false)
  const done = await settled(r.id)
  expect(done.state).toBe("done")
  expect(calls.map((c) => c.name)).toEqual(["post_message"])
})

test("a run stays on its version; previews are masked", async () => {
  const r: RoutineRow = await routineWith(chain(trigger(), read))
  await go(withStore((s) => s.addVersion(r.id, chain(trigger(), { ...read, config: { ...read.config, args: { q: "v2" } } }))))
  listText = JSON.stringify({ items: [{ id: "i2", token: `sk-ant-api03-${"a".repeat(93)}AA` }] })
  const run = await go(withStore((s) => s.addRun({ routineId: r.id, trigger: "now", state: "running", version: 1 })))
  ended.length = 0
  await go(runFlow(r, run, hooks))
  expect(calls[0]!.args).toEqual({ q: "new" }) // version 1's input, though version 2 is current
  const out = (await stepsOf(run.id)).at(-1)!.output
  expect(out).not.toContain("sk-ant-api03")
  expect(out).toContain("[redacted]")
})

// ---------- P2: triggers, delivery to a connector, branches and "Ask me" ----------
const listWatch = { on: "watch" as const, serverId: "", tool: "list_items", args: { q: "new" } }

test("Test now on a watch: the first look only learns; later, new items run; nothing is marked seen, no run starts", async () => {
  const r = await routineWith(chain(trigger()))
  listText = JSON.stringify({ items: [{ id: "a", title: "A" }] })
  const config = { ...listWatch, serverId: server.id }
  const first = await go(testTrigger(r, config, "UTC"))
  expect(first.first).toBe(true)
  expect(first.items.map((i) => i.verdict)).toEqual(["seen"])
  // the routine has polled once (it saw "a"); now "b" is new
  const seen = freshItems(null, [{ id: "a", title: "A" }]).seen
  await go(withStore((s) => s.updateRoutine(r.id, { watch: { serverId: server.id, tool: "list_items", args: { q: "new" } }, watchSeen: seen })))
  listText = JSON.stringify({ items: [{ id: "a", title: "A" }, { id: "b", title: "B" }] })
  const later = await go(testTrigger((await go(withStore((s) => s.routine(r.id))))!, config, "UTC"))
  expect(later.first).toBe(false)
  expect(later.items.map((i) => i.verdict)).toEqual(["seen", "runs"])
  expect((await go(withStore((s) => s.routine(r.id))))!.watchSeen).toEqual(seen)
  expect(await go(withStore((s) => s.routineRunsOf(r.id)))).toEqual([])
  const clock = await go(testTrigger(r, { on: "monthly", day: 31, time: "08:00" }, "UTC"))
  expect(clock.times).toHaveLength(3)
})

test("a one-time routine runs once, then turns itself off", async () => {
  const r = await routineWith(chain(trigger(), { id: "fin", kind: "end", ...at, config: {} }))
  await go(withStore((s) => s.updateRoutine(r.id, { schedule: { kind: "once", date: "2026-01-01", time: "09:00" }, nextRunAt: Date.now() - 1000 })))
  await go(tick)
  const after = (await go(withStore((s) => s.routine(r.id))))!
  expect(after.enabled).toBe(false)
  expect(after.nextRunAt).toBeNull()
  expect((await settled(r.id)).state).toBe("done")
})

const waitFor = async (check: () => Promise<boolean>) => {
  for (let i = 0; i < 300 && !(await check()); i++) await Bun.sleep(10)
}
test("send to a connector: the result is posted in its text field; nothing new posts nothing; an interrupted send isn't repeated", async () => {
  const r = await routineWith(chain(trigger(), think))
  await go(withStore((s) => s.updateRoutine(r.id, { delivery: { channels: [], connectors: [{ serverId: server.id, tool: "post_message", args: { channel: "C9" }, textField: "text" }] } })))
  await go(runRoutine(r.id, `now-${Date.now()}`))
  const run = await settled(r.id)
  await waitFor(async () => calls.some((c) => c.name === "post_message"))
  expect(calls.find((c) => c.name === "post_message")!.args).toEqual({ channel: "C9", text: "Two new items." })
  await waitFor(async () => (await stepsOf(run.id)).some((s) => s.nodeId === "deliver:0" && s.state === "done"))
  expect((await stepsOf(run.id)).find((s) => s.nodeId === "deliver:0")!.state).toBe("done")

  calls.length = 0
  reply = "Nothing changed.\nOutcome: nothing new"
  await go(runRoutine(r.id, `now-${Date.now() + 1}`))
  const quiet = await settled(r.id)
  await Bun.sleep(50)
  expect(quiet.outcome).toBe("nothing")
  expect(calls.filter((c) => c.name === "post_message")).toEqual([])

  // a send left halfway by a restart waits for the person, and isn't sent on its own
  const half = await go(withStore((s) => s.addRunStep({ runId: run.id, nodeId: "deliver:0" })))
  await go(withStore((s) => s.updateRunStep(half.id, { mayHaveWritten: true })))
  await go(recoverDeliveries)
  expect((await go(withStore((s) => s.runStep(half.id))))!.state).toBe("uncertain")
  expect(calls).toEqual([])
  expect(await go(resolveStep(run.id, half.id, "skip"))).toBe(true)
})

test("a condition takes its path; when the small model can't answer, the default one", async () => {
  const yes: FlowNode = { id: "ok", kind: "end", ...at, label: "yes", config: {} }
  const no: FlowNode = { id: "nope", kind: "end", ...at, label: "no", config: {} }
  const graphOf = (config: Extract<FlowNode, { kind: "condition" }>["config"]): FlowGraph => ({
    nodes: [trigger(), { ...read, config: { ...read.config, serverId: server.id } }, { id: "c", kind: "condition", ...at, config }, yes, no],
    edges: [{ id: "e1", from: "t", to: "read" }, { id: "e2", from: "read", to: "c" }, { id: "e3", from: "c", to: "ok", branch: "yes" }, { id: "e4", from: "c", to: "nope", branch: "no" }]
  })
  const branchOf = async (config: Extract<FlowNode, { kind: "condition" }>["config"]) => {
    const r = await routineWith(graphOf(config))
    await go(runRoutine(r.id, `now-${Date.now()}`))
    const run = await settled(r.id)
    return { run, steps: await stepsOf(run.id) }
  }
  listText = JSON.stringify({ items: [{ id: "x" }] })
  expect((await branchOf({ rule: "hasItems", input: { $from: "read" }, defaultBranch: "yes" })).steps.map((s) => s.nodeId)).toEqual(["t", "read", "c", "ok"])
  expect((await branchOf({ rule: "contains", input: { $from: "read" }, arg: "zzz", defaultBranch: "yes" })).steps.at(-1)!.nodeId).toBe("nope")
  const asked = await branchOf({ rule: "ask", arg: "Is it urgent?", defaultBranch: "no" }) // the stub has no model
  expect(asked.steps.find((s) => s.nodeId === "c")).toMatchObject({ branch: "no" })
  expect(asked.steps.find((s) => s.nodeId === "c")!.output).toContain("default")
  expect(asked.run.outcome).toBe("nothing") // ended quietly
})

test("Ask me: approved goes on, declined without a no path ends quietly, unanswered ends needing you", async () => {
  const askMe: FlowNode = { id: "ask", kind: "approval", ...at, config: { summary: "Post it?" } }
  const g = chain(trigger(), askMe, post({ channel: "C1", text: "hi" }))
  const r = await routineWith({ ...g, edges: g.edges.map((e) => (e.from === "ask" ? { ...e, branch: "yes" as const } : e)) })
  expect(validateFlow({ ...g, edges: g.edges.map((e) => (e.from === "ask" ? { ...e, branch: "yes" as const } : e)) })).toEqual({ ok: true })
  await go(runRoutine(r.id, `now-${Date.now()}`))
  expect((await settled(r.id)).outcome).toBe("something")
  expect(approvals[0]).toMatchObject({ kind: "question", summary: "Flow: Post it?" })
  expect(calls.map((c) => c.name)).toEqual(["post_message"])

  calls.length = 0
  approvalAnswer = "denied"
  await go(runRoutine(r.id, `now-${Date.now() + 1}`))
  expect((await settled(r.id)).outcome).toBe("nothing")
  approvalAnswer = "expired"
  await go(runRoutine(r.id, `now-${Date.now() + 2}`))
  expect((await settled(r.id)).outcome).toBe("needs")
  expect(calls).toEqual([])
})
