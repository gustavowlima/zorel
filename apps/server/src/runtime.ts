// Turn runtime (ARCHITECTURE §5): per-chat queue in the database, one turn at a time, live events per chat.
// The turn doesn't depend on the client: closing the tab stops nothing; reconnect = subscribe again (snapshot + events).
// Chaining: a reply that mentions another member queues that member's turn (up to MAX_DEPTH without a message from you).
import type { Agent, Chat, Step } from "@zero/contracts"
import { ApprovalNotFound, type ApprovalOutcome, type ChatEvent, ChatNotFound, type ChatStatus, ErrorCode, type Turn, type WorkStep } from "@zero/contracts/events"
import { Context, Deferred, Duration, Effect, Fiber, Layer, PubSub, Stream } from "effect"
import { consolidate, DataDir, members, prepare } from "./chat.ts"
import { MAX_DEPTH, mentioned } from "./context.ts"
import { Store, type Repository, type TurnRow } from "./db.ts"
import { Engines, type TurnTools } from "./engines.ts"
import { exposedName, needsApproval, resultText, textResult, Tools, type Gateway, type Hub, type Session, type ToolDef } from "./tools.ts"

const MAX_MENTIONS = 3
const APPROVAL_MS = 30 * 60_000 // ARCHITECTURE §9.2: expires in 30 min and counts as denial
const TEXT_BATCH = Duration.millis(100) // batched deltas (a reference app 100 ms, Zeron 120 ms)

export interface SendInput {
  readonly chatId: string
  readonly clientId: string
  readonly text: string
  readonly model?: string | undefined
}

export interface RuntimeService {
  readonly send: (input: SendInput) => Effect.Effect<{ turnId: string }, ChatNotFound>
  readonly interrupt: (chatId: string) => Effect.Effect<void>
  readonly decide: (approvalId: string, outcome: Exclude<ApprovalOutcome, "expired">, reason?: string) => Effect.Effect<void, ApprovalNotFound>
  readonly subscribeChat: (chatId: string) => Stream.Stream<ChatEvent, ChatNotFound>
  readonly subscribeStatus: Stream.Stream<ChatStatus>
}

const ev = <T extends ChatEvent["_tag"]>(_tag: T, body: Omit<Extract<ChatEvent, { _tag: T }>, "_tag">) => ({ _tag, ...body }) as unknown as ChatEvent

export const makeRuntime = Effect.gen(function* () {
  const store = yield* Store
  const engines = yield* Engines
  const dataDir = yield* DataDir
  const { hub, gateway } = yield* Tools
  const services = yield* Effect.context<Store | Engines | DataDir>()

  // ---------- events ----------
  const hubs = new Map<string, PubSub.PubSub<ChatEvent>>()
  const hubOf = (chatId: string) => {
    let h = hubs.get(chatId)
    if (!h) {
      h = Effect.runSync(PubSub.unbounded<ChatEvent>())
      hubs.set(chatId, h)
    }
    return h
  }
  const publish = (chatId: string, e: ChatEvent) => PubSub.publish(hubOf(chatId), e).pipe(Effect.asVoid)
  const statusHub = yield* PubSub.unbounded<ChatStatus>()
  const statuses = new Map<string, ChatStatus>()
  const idle = (chatId: string): ChatStatus => ({ chatId, state: "idle", agentId: null, label: "", unread: false, updatedAt: Date.now() })
  const setStatus = (chatId: string, state: ChatStatus["state"], agentId: string | null, label: string) =>
    Effect.gen(function* () {
      const status: ChatStatus = { chatId, state, agentId, label, unread: false, updatedAt: Date.now() }
      statuses.set(chatId, status)
      yield* PubSub.publish(statusHub, status)
      yield* publish(chatId, ev("status", { status }))
    })

  // ---------- in-memory state (the database is the source; this only holds fibers and waits) ----------
  const workers = new Map<string, { kicked: boolean }>()
  const running = new Map<string, Fiber.Fiber<unknown, unknown>>()
  const waiting = new Map<string, Deferred.Deferred<ApprovalOutcome>>()
  const nameOf = (agent: Agent | undefined) => agent?.name ?? "Assistant"
  const run = <A>(e: Effect.Effect<A>) => Effect.runPromise(e)

  // ---------- turn tools: steps and approvals persisted and published ----------
  const openTools = async (chat: Chat, row: TurnRow, agent: Agent | undefined, legacy: Step[]) => {
    const routes = new Map<string, { server: string; tool: string; approve: boolean }>()
    const defs: ToolDef[] = []
    const step = (title: string, tool: string) => run(store.addStep({ turnId: row.id, kind: "tool", title, tool, files: [], status: "running" }).pipe(Effect.tap((s) => publish(chat.id, ev("step-started", { step: s })))))
    const finish = (s: WorkStep, status: WorkStep["status"], output = "") =>
      run(store.finishStep(s, { status, output: output.slice(0, 300) }).pipe(Effect.tap((done) => publish(chat.id, ev("step-finished", { step: done })))))
    for (const s of await run(store.mcpServersFor(chat.projectId))) {
      const listed = await hub.tools(s).catch(async (e: unknown) => {
        const msg = `Não conectou: ${e instanceof Error ? e.message : e}`
        legacy.push({ tool: s.name, args: "", status: "error", result: msg })
        await finish(await step(`Connect ${s.name}`, s.name), "error", msg)
        return []
      })
      for (const t of listed) {
        if (s.mode === "read" && t.cls !== "read") continue
        const name = exposedName(s.name, t.name)
        routes.set(name, { server: s.id, tool: t.name, approve: needsApproval(s.mode, t.cls) })
        defs.push({ name, description: t.description, inputSchema: t.inputSchema })
      }
    }
    if (!defs.length) return { tools: undefined as TurnTools | undefined, close: () => {} }

    const call: Session["call"] = async (name, args) => {
      const route = routes.get(name)
      const server = route && (await run(store.mcpServer(route.server)))
      if (!route || !server) return textResult(`Ferramenta não permitida: ${name}`, true)
      const shown = JSON.stringify(args).slice(0, 300)
      const s = await step(name, name)
      if (route.approve) {
        const outcome = await run(askApproval(chat, row, agent, s, name, args))
        if (outcome === "denied" || outcome === "expired") {
          legacy.push({ tool: name, args: shown, status: "refused", result: "" })
          await finish(s, "refused")
          return textResult("O usuário recusou esta ação. Não tente de novo sem pedir.", true)
        }
      }
      const r = await run(
        Effect.promise(() => hub.call(server, route.tool, args).catch((e: unknown) => textResult(String(e instanceof Error ? e.message : e), true))).pipe(
          Effect.withSpan("tool.call", { attributes: { tool: name, server: server.name, turnId: row.id } })
        )
      )
      const out = resultText(r)
      legacy.push({ tool: name, args: shown, status: r.isError ? "error" : "ok", result: out.slice(0, 300) })
      await finish(s, r.isError ? "error" : "ok", out)
      return r
    }
    const session = gateway.open({ tools: defs, call })
    return { tools: { url: session.url, defs, call } as TurnTools, close: () => session.close() }
  }

  const askApproval = (chat: Chat, row: TurnRow, agent: Agent | undefined, s: WorkStep, tool: string, args: unknown) =>
    Effect.gen(function* () {
      const now = Date.now()
      const approval = yield* store.addApproval({
        chatId: chat.id, turnId: row.id, stepId: s.id, agentId: agent?.id ?? null, kind: "tool", tool,
        summary: `${nameOf(agent)} wants to use ${tool}`, args: JSON.stringify(args, null, 2).slice(0, 4000), cwd: null, expiresAt: now + APPROVAL_MS
      })
      const d = yield* Deferred.make<ApprovalOutcome>()
      waiting.set(approval.id, d)
      yield* publish(chat.id, ev("step-finished", { step: { ...s, status: "waiting" } }))
      yield* publish(chat.id, ev("approval", { approval }))
      yield* setStatus(chat.id, "waiting", agent?.id ?? null, `${nameOf(agent)} waits for your OK`)
      const outcome = yield* Deferred.await(d).pipe(
        Effect.timeoutOption(Duration.millis(APPROVAL_MS)),
        Effect.flatMap((o) => (o._tag === "Some" ? Effect.succeed(o.value) : expire(chat.id, approval.id)))
      )
      waiting.delete(approval.id)
      yield* setStatus(chat.id, "running", agent?.id ?? null, `${nameOf(agent)} is working`)
      return outcome
    })

  const expire = (chatId: string, id: string) =>
    store.resolveApproval(id, "expired", null, "expiry").pipe(
      Effect.tap((a) => (a ? publish(chatId, ev("approval-resolved", { approvalId: id, outcome: "expired", reason: null, by: "expiry" })) : Effect.void)),
      Effect.as<ApprovalOutcome>("expired")
    )

  // ---------- one turn ----------
  const runTurn = (row: TurnRow) =>
    Effect.gen(function* () {
      const chatId = row.chatId
      const chat = yield* store.chat(chatId)
      if (!chat) return yield* store.finishTurn(row.id, { state: "failed", error: ErrorCode.chatRemoved, messageId: null }).pipe(Effect.as(undefined))
      const team = yield* members(store, chat)
      const agent = team.find((a) => a.id === row.agentId)
      const acc = { text: "", error: undefined as string | undefined, usage: { inputTokens: 0, outputTokens: 0 }, steps: [] as Step[], saved: false }
      const save = (state: "completed" | "failed" | "interrupted", error: string | null) =>
        Effect.gen(function* () {
          if (acc.saved) return
          acc.saved = true
          const message = yield* store.addMessage({ chatId, role: "assistant", agentId: agent?.id ?? null, text: acc.text, model: row.model, error, steps: acc.steps, ...acc.usage })
          const turn = yield* store.finishTurn(row.id, { state, error, messageId: message.id, usage: acc.usage })
          const tag = state === "completed" ? "turn-completed" : state === "failed" ? "turn-failed" : "interrupted"
          yield* publish(chatId, ev(tag, { turn, message }))
        })

      const started = yield* store.startTurn(row.id)
      yield* publish(chatId, ev("turn-started", { turn: store.toTurn(started) }))
      yield* setStatus(chatId, "running", agent?.id ?? null, `${nameOf(agent)} is working`)

      yield* Effect.gen(function* () {
        const opened = yield* Effect.promise(() => openTools(chat, row, agent, acc.steps))
        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            opened.close()
            // Turn ended: its open requests become denials.
            for (const a of yield* store.openApprovals(chatId)) if (a.turnId === row.id) yield* expire(chatId, a.id)
          })
        )
        const turn = yield* prepare(store, (yield* store.chat(chatId))!, agent, row.model, dataDir, opened.tools)
        yield* engines.run(turn).pipe(
          Stream.withSpan("engine.run", { attributes: { model: row.model } }),
          Stream.groupedWithin(512, TEXT_BATCH),
          Stream.runForEach((batch) =>
            Effect.gen(function* () {
              let delta = ""
              for (const e of batch) {
                if (e.type === "text") delta += e.delta
                else if (e.type === "done") acc.usage = e.usage
                else acc.error = e.message
              }
              if (!delta) return
              if (!acc.text) yield* store.markFirstToken(row.id)
              acc.text += delta
              yield* publish(chatId, ev("text", { turnId: row.id, delta }))
              yield* store.savePartial(row.id, acc.text)
            })
          )
        )
        yield* save(acc.error ? "failed" : "completed", acc.error ?? null)
      }).pipe(
        Effect.scoped,
        Effect.onExit((exit) => (exit._tag === "Failure" ? save("interrupted", acc.error ?? ErrorCode.interrupted) : Effect.void))
      )
      return acc.error ? undefined : { text: acc.text, agent, team }
    }).pipe(
      Effect.withSpan("turn", { attributes: { chatId: row.chatId, turnId: row.id, agentId: row.agentId ?? "", model: row.model } }),
      Effect.annotateLogs({ chatId: row.chatId, turnId: row.id })
    )

  // Mentions in the reply queue the teammates (chaining, up to MAX_DEPTH consecutive replies).
  const chain = (row: TurnRow, done: { text: string; agent: Agent | undefined; team: Agent[] }) =>
    Effect.gen(function* () {
      const next = mentioned(done.text, done.team.filter((a) => a.id !== done.agent?.id)).slice(0, MAX_MENTIONS)
      if (!next.length) return
      if (row.depth + 1 >= MAX_DEPTH) return yield* Effect.logInfo("encadeamento parado no limite", { chatId: row.chatId, depth: row.depth })
      yield* publish(row.chatId, ev("handoff", { turnId: row.id, from: done.agent?.id ?? null, to: next.map((a) => a.id), via: "mention" }))
      for (const a of next) {
        const t = yield* store.enqueueTurn({ chatId: row.chatId, agentId: a.id, model: a.model, clientId: null, depth: row.depth + 1 })
        yield* publish(row.chatId, ev("queued", { turn: store.toTurn(t) }))
      }
    })

  // ---------- per-chat worker ----------
  const worker = (chatId: string): Effect.Effect<void> =>
    Effect.gen(function* () {
      const self = workers.get(chatId)!
      while (true) {
        const row = yield* store.nextQueued(chatId)
        if (!row) {
          if (self.kicked) {
            self.kicked = false
            continue
          }
          break
        }
        const fiber = yield* Effect.forkDetach(runTurn(row))
        running.set(chatId, fiber)
        const done = yield* Fiber.join(fiber).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        running.delete(chatId)
        if (done) yield* chain(row, done)
      }
      workers.delete(chatId)
      yield* setStatus(chatId, "idle", null, "")
      yield* Effect.forkDetach(consolidate(chatId).pipe(Effect.provide(services), Effect.ignore))
    }).pipe(Effect.ensuring(Effect.sync(() => workers.delete(chatId))))

  const ensureWorker = (chatId: string) =>
    Effect.suspend(() => {
      const w = workers.get(chatId)
      if (w) {
        w.kicked = true
        return Effect.void
      }
      workers.set(chatId, { kicked: false })
      return Effect.forkDetach(worker(chatId)).pipe(Effect.asVoid)
    })

  // ---------- boot recovery ----------
  // A `running` turn with no process becomes `interrupted` with the partial text; never repeats an uncertain side effect.
  for (const row of yield* store.turnsIn("running")) {
    const message = yield* store.addMessage({ chatId: row.chatId, role: "assistant", agentId: row.agentId, text: row.partialText, model: row.model, error: ErrorCode.serverRestarted, steps: [], inputTokens: 0, outputTokens: 0 })
    yield* store.finishTurn(row.id, { state: "interrupted", error: ErrorCode.serverRestarted, messageId: message.id })
  }
  for (const a of yield* store.openApprovals()) yield* store.resolveApproval(a.id, "expired", null, "expiry")
  for (const chatId of new Set((yield* store.turnsIn("queued")).map((t) => t.chatId))) yield* ensureWorker(chatId)

  // ---------- API ----------
  const service: RuntimeService = {
    send: (input) =>
      Effect.gen(function* () {
        const existing = yield* store.turnByClientId(input.clientId)
        if (existing) return { turnId: existing.id } // resending the same clientId doesn't duplicate
        let chat = yield* store.chat(input.chatId)
        if (!chat) return yield* new ChatNotFound({ chatId: input.chatId })
        if (input.model && input.model !== chat.model) chat = (yield* store.updateChat(chat.id, { model: input.model }))!
        if (chat.title === "Novo chat") chat = (yield* store.updateChat(chat.id, { title: input.text.replace(/\s+/g, " ").slice(0, 60) }))!
        const message = yield* store.addMessage({ chatId: chat.id, role: "user", agentId: null, text: input.text, model: null, error: null, steps: [], inputTokens: 0, outputTokens: 0 })
        yield* publish(chat.id, ev("message", { message }))
        const team = yield* members(store, chat)
        const lead = team[0]
        const targets: Array<Agent | undefined> = mentioned(input.text, team).slice(0, MAX_MENTIONS)
        if (!targets.length) targets.push(lead)
        let first: string | undefined
        for (const [i, a] of targets.entries()) {
          // The leader uses the chat model (the one you picked); other members use their own.
          const model = !a || a.id === lead?.id ? chat.model : a.model
          const t = yield* store.enqueueTurn({ chatId: chat.id, agentId: a?.id ?? null, model, clientId: i === 0 ? input.clientId : null, depth: 0 })
          first ??= t.id
          yield* publish(chat.id, ev("queued", { turn: store.toTurn(t) }))
        }
        yield* ensureWorker(chat.id)
        return { turnId: first! }
      }),

    interrupt: (chatId) =>
      Effect.gen(function* () {
        for (const t of (yield* store.activeTurns(chatId)).filter((t) => t.state === "queued")) {
          const turn = yield* store.finishTurn(t.id, { state: "interrupted", error: ErrorCode.cancelled, messageId: null })
          yield* publish(chatId, ev("interrupted", { turn, message: null }))
        }
        const fiber = running.get(chatId)
        if (fiber) yield* Fiber.interrupt(fiber)
      }),

    decide: (approvalId, outcome, reason) =>
      Effect.gen(function* () {
        const a = yield* store.resolveApproval(approvalId, outcome, reason ?? null, "user")
        if (!a) return yield* new ApprovalNotFound({ approvalId })
        // ponytail: "always" approves only this call; the persistent "always allow" rule is phase 4.
        const d = waiting.get(approvalId)
        if (d) yield* Deferred.succeed(d, outcome)
        yield* publish(a.chatId, ev("approval-resolved", { approvalId, outcome, reason: reason ?? null, by: "user" }))
      }),

    subscribeChat: (chatId) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const chat = yield* store.chat(chatId)
          if (!chat) return yield* new ChatNotFound({ chatId })
          // Subscribe before the snapshot: no event falls in the gap.
          const sub = yield* PubSub.subscribe(hubOf(chatId))
          const turns = yield* store.activeTurns(chatId)
          const runningIds = turns.filter((t) => t.state === "running").map((t) => t.id)
          const partial = []
          for (const id of runningIds) partial.push({ turnId: id, text: (yield* store.turnRow(id))?.partialText ?? "" })
          const snapshot = {
            messages: yield* store.messagesAfter(chatId, chat.summaryUntil),
            turns,
            partial,
            steps: yield* store.stepsOf(runningIds),
            approvals: yield* store.openApprovals(chatId),
            status: statuses.get(chatId) ?? idle(chatId)
          }
          return Stream.concat(Stream.make(ev("snapshot", { snapshot })), Stream.fromSubscription(sub))
        })
      ),

    subscribeStatus: Stream.unwrap(
      Effect.gen(function* () {
        const sub = yield* PubSub.subscribe(statusHub)
        return Stream.concat(Stream.fromIterable([...statuses.values()]), Stream.fromSubscription(sub))
      })
    )
  }
  return service
})

export class Runtime extends Context.Service<Runtime, RuntimeService>()("Runtime") {
  static layer = Layer.effect(Runtime, makeRuntime)
}

export type { Turn }
export type { Repository }
