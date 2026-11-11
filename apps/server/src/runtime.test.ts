// Phase 1 criteria (ARCHITECTURE §13): resend doesn't duplicate, interrupt keeps the partial,
// kill -9 mid-turn becomes `interrupted` with the partial text on the next boot.
import { expect, test } from "bun:test"
import { type ChatEvent, type ChatStatus, ErrorCode } from "@zorel/contracts/events"
import { Deferred, Effect, Exit, Fiber, Layer, Logger, Stream } from "effect"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Accounts } from "./accounts.ts"
import { Audit } from "./audit.ts"
import { BrowserService } from "./browser.ts"
import { Busy, consolidate, DataDir, mapEarlierFacts, NotFound } from "./chat.ts"
import { type Repository, Store } from "./db.ts"
import { Engines, type EngineEvent } from "./engines.ts"
import { quietly, Runtime, replyTiming, runawayGuard } from "./runtime.ts"
import { Secrets } from "./secrets.ts"
import { Tools } from "./tools.ts"
import { Pricing } from "./pricing.ts"
import { Workspace } from "./workspace.ts"

// Every chat needs an agent (spec 015): tests that don't care who answers get a plain one, on the chat's model.
const plainAgent = (store: Repository) => store.createAgent({ projectId: null, name: "Tester", instructions: "", model: "x/y" })

// Prices for tests (USD per million tokens): no network.
const PRICES = { anthropic: { "claude-sonnet-5-5": { cost: { input: 2, output: 10, cache_read: 0.1 }, family: "claude-sonnet", release_date: "2026-09-28" } } }

// Engine that sends "part" and then hangs: leaves time to interrupt.
const Hanging = Layer.succeed(Engines, {
  run: () => Stream.concat(Stream.make<EngineEvent[]>({ type: "text", delta: "part" }), Stream.never)
})
const Echo = Layer.succeed(Engines, {
  run: (t) => Stream.make<EngineEvent[]>({ type: "text", delta: `echo: ${t.messages.at(-1)!.text}` }, { type: "done", usage: { inputTokens: 1, outputTokens: 1 } })
})

const layer = (dbPath: string, engines: Layer.Layer<Engines>) => {
  const store = Store.layer(dbPath)
  const base = Layer.mergeAll(Layer.provideMerge(Layer.mergeAll(engines, Tools.layer), Layer.provideMerge(Secrets.memory(), store)), DataDir.layer(join(tmpdir(), "zorel-rt")))
  return Layer.provideMerge(Runtime.layer, Layer.provideMerge(Layer.mergeAll(Accounts.layer, Workspace.layer, Pricing.fixed(PRICES), Audit.layer, BrowserService.layer), base))
}
const runWith = <A, E>(dbPath: string, engines: Layer.Layer<Engines>, f: Effect.Effect<A, E, Runtime | Store>) =>
  Effect.runPromise(Effect.scoped(f).pipe(Effect.provide(layer(dbPath, engines))) as Effect.Effect<A>)

// Collects chat events until `until` says enough.
const collect = (chatId: string, until: (e: ChatEvent) => boolean) =>
  Effect.gen(function* () {
    const runtime = yield* Runtime
    const ready = yield* Deferred.make<void>()
    const events: ChatEvent[] = []
    const fiber = yield* runtime.subscribeChat(chatId).pipe(
      Stream.tap((e) => (e._tag === "snapshot" ? Deferred.succeed(ready, undefined) : Effect.sync(() => void events.push(e)))),
      Stream.takeUntil((e) => e._tag !== "snapshot" && until(e)),
      Stream.runDrain,
      Effect.forkChild
    )
    yield* Deferred.await(ready)
    return { events, done: Fiber.join(fiber).pipe(Effect.timeout("3 seconds")) }
  })

test("resending the same clientId returns the same turn and doesn't duplicate the message", () =>
  runWith(":memory:", Echo, Effect.gen(function* () {
    const store = yield* Store
    const runtime = yield* Runtime
    const chat = yield* store.createChat({ projectId: null, agentIds: [(yield* plainAgent(store)).id], model: "x/y" })
    const c = yield* collect(chat.id, (e) => e._tag === "turn-completed")
    const a = yield* runtime.send({ chatId: chat.id, clientId: "client-123", text: "hi" })
    const b = yield* runtime.send({ chatId: chat.id, clientId: "client-123", text: "hi" })
    expect(b.turnId).toBe(a.turnId)
    yield* c.done
    const msgs = yield* store.messages(chat.id)
    expect(msgs.map((m) => [m.role, m.text])).toEqual([["user", "hi"], ["assistant", "echo: hi"]])
    // per-turn metrics: start, first text and end recorded, in order
    const t = (yield* store.turnRow(a.turnId))!
    expect(t.startedAt! <= t.firstTokenAt! && t.firstTokenAt! <= t.endedAt!).toBe(true)
  })))

test("interrupting keeps the partial text and emits interrupted", () =>
  runWith(":memory:", Hanging, Effect.gen(function* () {
    const store = yield* Store
    const runtime = yield* Runtime
    const chat = yield* store.createChat({ projectId: null, agentIds: [(yield* plainAgent(store)).id], model: "x/y" })
    const c = yield* collect(chat.id, (e) => e._tag === "interrupted")
    yield* runtime.send({ chatId: chat.id, clientId: "client-456", text: "hi" })
    // waits for the first text before interrupting
    while (!c.events.some((e) => e._tag === "text")) yield* Effect.sleep("10 millis")
    yield* runtime.interrupt(chat.id)
    yield* c.done
    const last = c.events.at(-1)!
    expect(last._tag).toBe("interrupted")
    const msgs = yield* store.messages(chat.id)
    expect(msgs.at(-1)).toMatchObject({ role: "assistant", text: "part" })
    expect(msgs.at(-1)!.error).toBeTruthy()
  })))

// The chat rests "failed" after a failed last turn (the sidebar says so until the next turn), idle after a good one.
const Failing = Layer.succeed(Engines, { run: () => Stream.make<EngineEvent[]>({ type: "error", message: "upstream timed out" }) })
const restingState = (engines: Layer.Layer<Engines>) =>
  runWith(":memory:", engines, Effect.gen(function* () {
    const store = yield* Store
    const runtime = yield* Runtime
    const chat = yield* store.createChat({ projectId: null, agentIds: [(yield* plainAgent(store)).id], model: "x/y" })
    const c = yield* collect(chat.id, (e) => e._tag === "status" && e.status.state !== "running")
    yield* runtime.send({ chatId: chat.id, clientId: crypto.randomUUID(), text: "hi" })
    yield* c.done
    const last = c.events.filter((e) => e._tag === "status").at(-1)
    return last?._tag === "status" ? last.status.state : undefined
  }))
test("a failed last turn leaves the chat failed, a good one leaves it idle", async () => {
  expect(await restingState(Failing)).toBe("failed")
  expect(await restingState(Echo)).toBe("idle")
})

// Text, a step, more text, all inside one 100 ms batch: the step is saved where the text stood when it began, and the
// live view gets the first words before the step (the chat lays the reply out in that order).
const Interleaved = Layer.succeed(Engines, {
  run: () => {
    const step = { id: "s1", kind: "run" as const, title: "Run the tests", detail: "bun test", files: [] }
    return Stream.make<EngineEvent[]>(
      { type: "text", delta: "Let me check." },
      { type: "step", step: { ...step, status: "running", output: "" } },
      { type: "step", step: { ...step, status: "ok", output: "1 pass" } },
      { type: "text", delta: " All green." },
      { type: "done", usage: { inputTokens: 1, outputTokens: 1 } }
    )
  }
})
test("a step keeps where the reply's text stood when it began, and goes out after the words before it", () =>
  runWith(":memory:", Interleaved, Effect.gen(function* () {
    const store = yield* Store
    const runtime = yield* Runtime
    const chat = yield* store.createChat({ projectId: null, agentIds: [(yield* plainAgent(store)).id], model: "x/y" })
    const c = yield* collect(chat.id, (e) => e._tag === "turn-completed")
    yield* runtime.send({ chatId: chat.id, clientId: crypto.randomUUID(), text: "hi" })
    yield* c.done
    const order = c.events.flatMap((e) => (e._tag === "text" ? [`text:${e.delta}`] : e._tag === "step-started" ? ["step"] : []))
    expect(order).toEqual(["text:Let me check.", "step", "text: All green."])
    const reply = (yield* store.messages(chat.id)).at(-1)!
    expect(reply.text).toBe("Let me check. All green.")
    expect(reply.steps.find((s) => s.tool === "run")?.at).toBe("Let me check.".length)
  })))

test("kill -9 mid-turn: on the next boot the turn becomes interrupted with the partial text", async () => {
  const dir = join(tmpdir(), `zorel-rt-${crypto.randomUUID()}`)
  mkdirSync(dir)
  const path = join(dir, "zorel.db")
  // First life: a turn stays `running` with partial text saved (as if the process died here).
  const chatId = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const store = yield* Store
        const chat = yield* store.createChat({ projectId: null, agentIds: [(yield* plainAgent(store)).id], model: "x/y" })
        const t = yield* store.enqueueTurn({ chatId: chat.id, agentId: null, model: "x/y", clientId: "client-789", depth: 0 })
        yield* store.startTurn(t.id)
        yield* store.savePartial(t.id, "halfway")
        return chat.id
      })
    ).pipe(Effect.provide(Store.layer(path)))
  )
  // Second life: the runtime boots and recovers.
  await runWith(path, Echo, Effect.gen(function* () {
    const store = yield* Store
    expect(yield* store.turnsIn("running")).toEqual([])
    const [turn] = yield* store.turnsIn("interrupted")
    expect(turn!.error).toBe("server_restarted")
    const msgs = yield* store.messages(chatId)
    expect(msgs.at(-1)).toMatchObject({ role: "assistant", text: "halfway" })
  }))
})

// Fake native-session engine: records how many sessions opened and what each turn received.
const sessionLog = { opened: [] as string[], prompts: [] as string[], interrupts: 0, homes: [] as Array<string | null | undefined>, efforts: [] as unknown[] }
const Sessions = Layer.succeed(Engines, {
  run: () => Stream.make<EngineEvent[]>({ type: "error", message: "should use the session" }),
  hasSession: () => true,
  open: (o) => {
    sessionLog.opened.push(o.system)
    sessionLog.homes.push(o.account?.home)
    return {
      alive: () => true,
      close: Effect.void,
      turn: (input) => {
        sessionLog.prompts.push(input.prompt)
        sessionLog.efforts.push(input.effort)
        if (input.prompt.includes("slow"))
          return Stream.concat(Stream.make<EngineEvent[]>({ type: "text", delta: "part" }), Stream.never).pipe(
            Stream.onExit((exit) => Effect.sync(() => void (Exit.hasInterrupts(exit) && sessionLog.interrupts++)))
          )
        return Stream.make<EngineEvent[]>({ type: "text", delta: "ok" }, { type: "done", usage: { inputTokens: input.prompt.includes("big") ? 70_000 : 1, outputTokens: 1 } })
      }
    }
  }
})

test("native session: opens once, later turns send only what is new, a stable-context change reopens with the checkpoint", () =>
  runWith(":memory:", Sessions, Effect.gen(function* () {
    const store = yield* Store
    const runtime = yield* Runtime
    const chat = yield* store.createChat({ projectId: null, agentIds: [(yield* plainAgent(store)).id], model: "claude-cli/haiku" })
    const turnOnce = (text: string) =>
      Effect.gen(function* () {
        const c = yield* collect(chat.id, (e) => e._tag === "turn-completed")
        yield* runtime.send({ chatId: chat.id, clientId: crypto.randomUUID(), text })
        yield* c.done
      })
    yield* turnOnce("first")
    yield* turnOnce("second")
    expect(sessionLog.opened).toHaveLength(1)
    expect(sessionLog.prompts[0]).toContain("first")
    expect(sessionLog.prompts[1]).toContain("second")
    expect(sessionLog.prompts[1]).not.toContain("first") // the session already has it

    // A new memory doesn't reopen it (that would resend the whole history): it comes as a note with the turn.
    const m = (yield* store.addMemory({ scope: "user", text: "Prefere respostas curtas", state: "active", origin: "manual", chatId: null }))!
    yield* turnOnce("third")
    expect(sessionLog.opened).toHaveLength(1)
    expect(sessionLog.prompts[2]).toContain("- New: Prefere respostas curtas")
    expect(sessionLog.prompts[2]).not.toContain("first")
    // Forgotten again: nothing left to tell (the session never had it in its prompt).
    yield* store.updateMemory(m.id, { state: "forgotten" })
    yield* turnOnce("fourth")
    expect(sessionLog.prompts[3]).not.toContain("Prefere")

    // Grown past SESSION_MAX_CONTEXT: the next turn starts a fresh session with the checkpoint.
    yield* turnOnce("big")
    yield* turnOnce("fifth")
    expect(sessionLog.opened).toHaveLength(2)
    expect(sessionLog.prompts.at(-1)).toContain("first")

    // A change of what the session is tied to (a pinned page, a new tool) reopens it too.
    const page = yield* store.savePage({ scope: "user", title: "Style guide", body: "Short." })
    yield* store.pinPage(page.id, true)
    yield* turnOnce("sixth")
    expect(sessionLog.opened).toHaveLength(3)
    expect(sessionLog.opened[2]).toContain("Style guide")
  })))

test("native session: interrupting stops the turn but keeps the session", () =>
  runWith(":memory:", Sessions, Effect.gen(function* () {
    const store = yield* Store
    const runtime = yield* Runtime
    const chat = yield* store.createChat({ projectId: null, agentIds: [(yield* plainAgent(store)).id], model: "claude-cli/haiku" })
    const before = sessionLog.opened.length
    const c = yield* collect(chat.id, (e) => e._tag === "interrupted")
    yield* runtime.send({ chatId: chat.id, clientId: crypto.randomUUID(), text: "slow" })
    while (!c.events.some((e) => e._tag === "text")) yield* Effect.sleep("10 millis")
    yield* runtime.interrupt(chat.id)
    yield* c.done
    expect(sessionLog.interrupts).toBe(1)
    const d = yield* collect(chat.id, (e) => e._tag === "turn-completed")
    yield* runtime.send({ chatId: chat.id, clientId: crypto.randomUUID(), text: "again" })
    yield* d.done
    expect(sessionLog.opened.length - before).toBe(1) // same session after the interrupt
    expect(sessionLog.prompts.at(-1)).not.toContain("slow") // the partial reply is already in the session
  })))

// Two agents, each with a session that can take a steer. A prompt ending in "slow" says "part @bee" and hangs (a turn to
// stop); any other finishes with "ok:<who>". `steered` records what each session took mid-turn.
const Steering = (steered: Array<[string, string]>, started: string[]) =>
  Layer.succeed(Engines, {
    run: () => Stream.make<EngineEvent[]>({ type: "error", message: "should use the session" }),
    hasSession: () => true,
    open: (o) => {
      const who = o.system.includes("You are Bee") ? "bee" : "lee"
      return {
        alive: () => true,
        close: Effect.void,
        steer: async (text: string) => {
          steered.push([who, text])
          return true
        },
        turn: (input) => {
          started.push(who)
          if (input.prompt.trimEnd().endsWith("slow")) return Stream.concat(Stream.make<EngineEvent[]>({ type: "text", delta: "part @bee please" }), Stream.never) // only the last message counts: a new session's prompt carries the history
          return Stream.make<EngineEvent[]>({ type: "text", delta: `ok:${who}` }, { type: "done", usage: { inputTokens: 1, outputTokens: 1 } })
        }
      }
    }
  })

const steerSetup = Effect.gen(function* () {
  const store = yield* Store
  const runtime = yield* Runtime
  const lee = yield* store.createAgent({ projectId: null, name: "Lee", instructions: "I am Lee", model: "claude-cli/haiku" })
  const bee = yield* store.createAgent({ projectId: null, name: "Bee", instructions: "I am Bee", model: "claude-cli/haiku" })
  const chat = yield* store.createChat({ projectId: null, agentIds: [lee.id, bee.id], model: "claude-cli/haiku" })
  return { store, runtime, lee, bee, chat }
})
// Starts Lee on a turn that hangs and waits until it has said something.
const leeBusy = (chatId: string) =>
  Effect.gen(function* () {
    const runtime = yield* Runtime
    const c = yield* collect(chatId, () => false)
    yield* runtime.send({ chatId, clientId: crypto.randomUUID(), text: "@lee slow" })
    while (!c.events.some((e) => e._tag === "text")) yield* Effect.sleep("10 millis")
  })
const waitFor = (ok: () => Effect.Effect<boolean, never, Store | Runtime>) =>
  Effect.gen(function* () {
    for (let i = 0; i < 300; i++) {
      if (yield* ok()) return
      yield* Effect.sleep("10 millis")
    }
    throw new Error("timed out")
  })

test("steer: a message for the agent that is working goes into its reply; the others it names are queued", () => {
  const steered: Array<[string, string]> = []
  return runWith(":memory:", Steering(steered, []), Effect.gen(function* () {
    const { store, runtime, chat, bee } = yield* steerSetup
    yield* leeBusy(chat.id)
    // No one named: the lead (Lee) is the recipient, and Lee is the one running.
    expect(yield* runtime.steer(chat.id, "keep going")).toEqual({ joined: true })
    expect(steered).toEqual([["lee", "keep going"]])
    expect((yield* store.messages(chat.id)).at(-1)).toMatchObject({ role: "user", text: "keep going" })
    // Naming Bee too: it joins Lee's reply, and Bee gets a turn of its own, behind it.
    expect(yield* runtime.steer(chat.id, "@lee @bee both")).toEqual({ joined: true })
    expect(steered.at(-1)).toEqual(["lee", "@lee @bee both"])
    expect((yield* store.activeTurns(chat.id)).filter((t) => t.state === "queued").map((t) => t.agentId)).toEqual([bee.id])
    yield* runtime.interrupt(chat.id)
  }))
})

test("steer: a message for another agent leaves the running reply alone; that agent answers at the same time", () => {
  const steered: Array<[string, string]> = []
  const started: string[] = []
  return runWith(":memory:", Steering(steered, started), Effect.gen(function* () {
    const { store, runtime, chat, lee } = yield* steerSetup
    yield* leeBusy(chat.id)
    expect(yield* runtime.steer(chat.id, "@bee do it")).toEqual({ joined: false })
    expect(steered).toEqual([]) // Lee's reply wasn't the recipient's: nothing went into it
    yield* waitFor(() => Effect.map(store.messages(chat.id), (m) => m.some((x) => x.text === "ok:bee")))
    // Bee answered while Lee is still at work (spec 016): only the recipients are touched.
    expect((yield* store.activeTurns(chat.id)).filter((t) => t.state === "running").map((t) => t.agentId)).toEqual([lee.id])
    expect(started).toEqual(["lee", "bee"])
    yield* runtime.interrupt(chat.id)
  }))
})

test("two agents called by one message work at the same time; Stop on one reply leaves the other", () => {
  const started: string[] = []
  return runWith(":memory:", Steering([], started), Effect.gen(function* () {
    const { store, runtime, chat, lee, bee } = yield* steerSetup
    const c = yield* collect(chat.id, () => false)
    yield* runtime.send({ chatId: chat.id, clientId: crypto.randomUUID(), text: "@lee @bee slow" })
    yield* waitFor(() => Effect.map(store.activeTurns(chat.id), (ts) => ts.filter((t) => t.state === "running").length === 2))
    expect(new Set(started)).toEqual(new Set(["lee", "bee"]))
    // The chat's status names both at work.
    yield* waitFor(() => Effect.succeed(c.events.some((e) => e._tag === "status" && (e.status.agentIds?.length ?? 0) === 2)))
    const leeTurn = (yield* store.activeTurns(chat.id)).find((t) => t.agentId === lee.id)!
    yield* runtime.interrupt(chat.id, leeTurn.id)
    yield* waitFor(() => Effect.map(store.activeTurns(chat.id), (ts) => ts.map((t) => t.agentId).join() === bee.id))
    yield* runtime.interrupt(chat.id)
  }))
})

test("send now: a message of yours runs before the hand-offs already queued", () => {
  const started: string[] = []
  return runWith(":memory:", Steering([], started), Effect.gen(function* () {
    const { store, runtime, chat, bee } = yield* steerSetup
    yield* leeBusy(chat.id)
    // Three replies the agents handed to Bee are waiting (depth > 0).
    for (let i = 0; i < 3; i++) yield* store.enqueueTurn({ chatId: chat.id, agentId: bee.id, model: "claude-cli/haiku", clientId: null, depth: 1 })
    expect(yield* runtime.steer(chat.id, "@bee now")).toEqual({ joined: false })
    yield* waitFor(() => Effect.map(store.turnsIn("completed"), (c) => c.filter((t) => t.agentId === bee.id).length === 4))
    const order = (yield* store.turnsIn("completed")).filter((t) => t.agentId === bee.id).sort((x, y) => (x.startedAt ?? 0) - (y.startedAt ?? 0))
    expect(order.map((t) => t.depth)).toEqual([0, 1, 1, 1]) // yours first, then the hand-offs
    yield* runtime.interrupt(chat.id)
  }))
})

test("queuedTurns: your messages go first, each group in order; a wrap-up or a task result waits behind what it awaits", () =>
  runWith(":memory:", Echo, Effect.gen(function* () {
    const store = yield* Store
    const chat = yield* store.createChat({ projectId: null, agentIds: [(yield* plainAgent(store)).id], model: "x/y" })
    const add = (depth: number) => store.enqueueTurn({ chatId: chat.id, agentId: null, model: "x/y", clientId: null, depth })
    const chained = [yield* add(2), yield* add(1)]
    const mine = [yield* add(0), yield* add(0)]
    const order = (yield* store.queuedTurns(chat.id)).map((t) => t.id)
    expect(order).toEqual([mine[0]!.id, mine[1]!.id, chained[0]!.id, chained[1]!.id])
  })))

test("accounts: the chat's account reaches the session as its login folder; switching accounts opens a new session", () =>
  runWith(":memory:", Sessions, Effect.gen(function* () {
    const store = yield* Store
    const runtime = yield* Runtime
    yield* store.ensureAccount({ id: "work", label: "Claude work", kind: "subscription", provider: "claude", home: "/tmp/zorel-acc-work", secret: null, baseUrl: null, identity: null })
    yield* store.ensureAccount({ id: "cdx", label: "Codex 2", kind: "subscription", provider: "codex", home: "/tmp/zorel-acc-cdx", secret: null, baseUrl: null, identity: null })
    const chat = yield* store.createChat({ projectId: null, agentIds: [(yield* plainAgent(store)).id], model: "claude-cli/haiku", accountId: "work" })
    const turnOnce = (text: string) =>
      Effect.gen(function* () {
        const c = yield* collect(chat.id, (e) => e._tag === "turn-completed")
        const { turnId } = yield* runtime.send({ chatId: chat.id, clientId: crypto.randomUUID(), text })
        yield* c.done
        return (yield* store.turnRow(turnId))!
      })
    const before = sessionLog.opened.length
    const t1 = yield* turnOnce("a")
    expect(t1.accountId).toBe("work")
    expect(sessionLog.homes.at(-1)).toBe("/tmp/zorel-acc-work")
    // An account of another provider doesn't apply: falls back to Claude's default (the CLI's own login).
    yield* store.updateChat(chat.id, { accountId: "cdx" })
    yield* turnOnce("b")
    expect(sessionLog.opened.length - before).toBe(2) // new account, new session
    expect(sessionLog.homes.at(-1)).toBeNull()
  })))

// Fake session that supports steering: a "slow" turn waits until it is steered, then finishes with it.
const Steerable = Layer.succeed(Engines, {
  run: () => Stream.make<EngineEvent[]>({ type: "error", message: "should use the session" }),
  hasSession: () => true,
  open: () => {
    let steered: ((text: string) => void) | undefined
    return {
      alive: () => true,
      close: Effect.void,
      steer: async (text) => {
        if (!steered) return false
        steered(text)
        return true
      },
      turn: (input) =>
        input.prompt.includes("slow")
          ? Stream.concat(
              Stream.make<EngineEvent[]>({ type: "text", delta: "part" }),
              Stream.fromEffect(Effect.promise(() => new Promise<string>((r) => { steered = r }))).pipe(
                Stream.flatMap((t) => Stream.make<EngineEvent[]>({ type: "text", delta: ` + ${t}` }, { type: "done", usage: { inputTokens: 1, outputTokens: 1 } })),
                Stream.ensuring(Effect.sync(() => { steered = undefined }))
              )
            )
          : Stream.make<EngineEvent[]>({ type: "text", delta: "ok" }, { type: "done", usage: { inputTokens: 1, outputTokens: 1 } })
    }
  }
})

test("steering: joins the running turn when the session can; otherwise it becomes the next turn", () =>
  runWith(":memory:", Steerable, Effect.gen(function* () {
    const store = yield* Store
    const runtime = yield* Runtime
    const chat = yield* store.createChat({ projectId: null, agentIds: [(yield* plainAgent(store)).id], model: "codex-cli/default" })
    const c = yield* collect(chat.id, (e) => e._tag === "turn-completed")
    yield* runtime.send({ chatId: chat.id, clientId: crypto.randomUUID(), text: "slow" })
    while (!c.events.some((e) => e._tag === "text")) yield* Effect.sleep("10 millis")
    yield* runtime.steer(chat.id, "use src")
    yield* c.done
    const msgs = yield* store.messages(chat.id)
    expect(msgs.map((m) => [m.role, m.text])).toEqual([["user", "slow"], ["user", "use src"], ["assistant", "part + use src"]])
    expect(yield* store.activeTurns(chat.id)).toEqual([]) // nothing extra queued

    // No turn running: the correction is just the next turn.
    const d = yield* collect(chat.id, (e) => e._tag === "turn-completed")
    yield* runtime.steer(chat.id, "and now?")
    yield* d.done
    expect((yield* store.messages(chat.id)).at(-1)).toMatchObject({ role: "assistant", text: "ok" })
  })))

// No steering in the engine: the first call hangs after "part"; later ones answer.
const hangs = { calls: 0 }
const HangThenEcho = Layer.succeed(Engines, {
  run: (t) =>
    hangs.calls++ === 0
      ? Stream.concat(Stream.make<EngineEvent[]>({ type: "text", delta: "part" }), Stream.never)
      : Stream.make<EngineEvent[]>({ type: "text", delta: `echo: ${t.messages.at(-1)!.text}` }, { type: "done", usage: { inputTokens: 1, outputTokens: 1 } })
})

test("steering without engine support: stops the running turn and sends the message as the next one", () =>
  runWith(":memory:", HangThenEcho, Effect.gen(function* () {
    hangs.calls = 0
    const store = yield* Store
    const runtime = yield* Runtime
    const chat = yield* store.createChat({ projectId: null, agentIds: [(yield* plainAgent(store)).id], model: "x/y" })
    const c = yield* collect(chat.id, (e) => e._tag === "turn-completed")
    yield* runtime.send({ chatId: chat.id, clientId: crypto.randomUUID(), text: "long job" })
    while (!c.events.some((e) => e._tag === "text")) yield* Effect.sleep("10 millis")
    yield* runtime.steer(chat.id, "do this now")
    yield* c.done
    const msgs = yield* store.messages(chat.id)
    expect(msgs.map((m) => [m.role, m.text])).toEqual([["user", "long job"], ["assistant", "part"], ["user", "do this now"], ["assistant", "echo: do this now"]])
    expect(c.events.some((e) => e._tag === "interrupted")).toBe(true) // the first turn was stopped, not left running
    expect(yield* store.activeTurns(chat.id)).toEqual([])
  })))

test("steering with images: the running turn is stopped too, the message is not lost", () =>
  runWith(":memory:", Steerable, Effect.gen(function* () {
    const store = yield* Store
    const runtime = yield* Runtime
    const chat = yield* store.createChat({ projectId: null, agentIds: [(yield* plainAgent(store)).id], model: "codex-cli/default" })
    const c = yield* collect(chat.id, (e) => e._tag === "turn-completed")
    yield* runtime.send({ chatId: chat.id, clientId: crypto.randomUUID(), text: "slow" })
    while (!c.events.some((e) => e._tag === "text")) yield* Effect.sleep("10 millis")
    yield* runtime.steer(chat.id, "look at this", ["no-such-attachment"])
    yield* c.done
    expect(c.events.some((e) => e._tag === "interrupted")).toBe(true)
    expect((yield* store.messages(chat.id)).at(-1)).toMatchObject({ role: "assistant", text: "ok" })
  })))

test("effort: the chat's level reaches the session on every turn", () =>
  runWith(":memory:", Sessions, Effect.gen(function* () {
    const store = yield* Store
    const runtime = yield* Runtime
    const chat = yield* store.createChat({ projectId: null, agentIds: [(yield* plainAgent(store)).id], model: "claude-cli/haiku", effort: "high" })
    const c = yield* collect(chat.id, (e) => e._tag === "turn-completed")
    yield* runtime.send({ chatId: chat.id, clientId: crypto.randomUUID(), text: "think" })
    yield* c.done
    expect(sessionLog.efforts.at(-1)).toBe("high")
  })))

test("switching Claude → Codex → Claude: the Claude session survives and gets only what is new on return", () =>
  runWith(":memory:", Sessions, Effect.gen(function* () {
    const store = yield* Store
    const runtime = yield* Runtime
    const chat = yield* store.createChat({ projectId: null, agentIds: [(yield* plainAgent(store)).id], model: "claude-cli/haiku" })
    const turnOnce = (text: string, model: string) =>
      Effect.gen(function* () {
        const c = yield* collect(chat.id, (e) => e._tag === "turn-completed")
        yield* runtime.send({ chatId: chat.id, clientId: crypto.randomUUID(), text, model })
        yield* c.done
      })
    const before = sessionLog.opened.length
    yield* turnOnce("alpha", "claude-cli/haiku")
    yield* turnOnce("bravo", "codex-cli/default")
    yield* turnOnce("charlie", "claude-cli/haiku")
    expect(sessionLog.opened.length - before).toBe(2) // Claude once, Codex once
    const back = sessionLog.prompts.at(-1)!
    expect(back).not.toContain("alpha") // Claude already has it
    expect(back).toContain("bravo") // what happened on Codex
    expect(back).toContain("charlie")
  })))

// ---------- failover (ARCHITECTURE §6.1) ----------

// Engine scripted per model: each call takes the next reply for that model ("ok" answers; anything else fails).
type Script = Record<string, Array<"ok" | { message: string; failure?: EngineEvent extends infer E ? (E extends { type: "error"; failure?: infer F } ? F : never) : never }>>
const scripted = (script: Script, calls: string[]) =>
  Layer.succeed(Engines, {
    run: (t) => {
      calls.push(t.model)
      const next = script[t.model]?.shift() ?? "ok"
      return next === "ok"
        ? Stream.make<EngineEvent[]>({ type: "text", delta: `from ${t.model}` }, { type: "done", usage: { inputTokens: 1, outputTokens: 1 } })
        : Stream.make<EngineEvent[]>({ type: "text", delta: "half" }, { type: "error", ...next })
    }
  })

const sendAndWait = (chatId: string, text: string) =>
  Effect.gen(function* () {
    const runtime = yield* Runtime
    const c = yield* collect(chatId, (e) => e._tag === "turn-completed" || e._tag === "turn-failed")
    yield* runtime.send({ chatId, clientId: crypto.randomUUID(), text })
    yield* c.done
    return c.events
  })

test("failover: a provider error before acting moves the turn to the next route; the failed one is skipped for a while", () => {
  const calls: string[] = []
  return runWith(":memory:", scripted({ "a/m": [{ message: "529 overloaded", failure: { reason: "unavailable" } }] }, calls), Effect.gen(function* () {
    const store = yield* Store
    const agent = yield* store.createAgent({ projectId: null, name: "Dev", instructions: "", model: "a/m", failover: [{ model: "b/m", accountId: null }] })
    const chat = yield* store.createChat({ projectId: null, agentIds: [agent.id], model: "a/m" })

    const events = yield* sendAndWait(chat.id, "hi")
    expect(calls).toEqual(["a/m", "b/m"])
    const sw = events.find((e) => e._tag === "failover")
    expect(sw?._tag === "failover" && [sw.switch.fromModel, sw.switch.toModel, sw.switch.reason]).toEqual(["a/m", "b/m", "unavailable"])
    const reply = (yield* store.messages(chat.id)).at(-1)!
    expect(reply).toMatchObject({ text: "from b/m", model: "b/m", error: null }) // the partial of the failed route is dropped
    expect(reply.switches.map((s) => s.reason)).toEqual(["unavailable"])

    // Within 10 minutes the failed route is skipped without trying it.
    yield* sendAndWait(chat.id, "again")
    expect(calls).toEqual(["a/m", "b/m", "b/m"])
  }))
})

test("failover: errors another model would repeat, or a turn without alternatives, don't switch", () => {
  const calls: string[] = []
  return runWith(":memory:", scripted({ "a/m": [{ message: "prompt too long" }, { message: "529", failure: { reason: "unavailable" } }] }, calls), Effect.gen(function* () {
    const store = yield* Store
    const agent = yield* store.createAgent({ projectId: null, name: "Dev", instructions: "", model: "a/m", failover: [{ model: "b/m", accountId: null }] })
    const withList = yield* store.createChat({ projectId: null, agentIds: [agent.id], model: "a/m" })
    yield* sendAndWait(withList.id, "hi")
    expect(calls).toEqual(["a/m"]) // content error: no switch
    expect((yield* store.messages(withList.id)).at(-1)).toMatchObject({ error: "prompt too long", switches: [] })

    const noList = yield* store.createChat({ projectId: null, agentIds: [(yield* plainAgent(store)).id], model: "a/m" })
    yield* sendAndWait(noList.id, "hi")
    expect(calls).toEqual(["a/m", "a/m"]) // failover off: empty list
  }))
})

test("failover: a subscription limit holds the account until its reset, then the primary comes back by itself", () => {
  const calls: string[] = []
  const until = Date.now() + 400
  return runWith(":memory:", scripted({ "claude-cli/sonnet": [{ message: "usage limit reached", failure: { reason: "limit", until } }] }, calls), Effect.gen(function* () {
    const store = yield* Store
    const chat = yield* store.createChat({ projectId: null, agentIds: [(yield* plainAgent(store)).id], model: "claude-cli/sonnet" })
    yield* store.updateChat(chat.id, { failover: [{ model: "b/m", accountId: null }] }) // the chat's own list

    yield* sendAndWait(chat.id, "one")
    expect(calls).toEqual(["claude-cli/sonnet", "b/m"])
    expect((yield* store.account("claude-default"))!.limitedUntil).toBe(until)

    const held = yield* sendAndWait(chat.id, "two") // still limited: straight to the alternative
    expect(calls).toEqual(["claude-cli/sonnet", "b/m", "b/m"])
    const sw = held.find((e) => e._tag === "failover")
    expect(sw?._tag === "failover" && [sw.switch.reason, sw.switch.until]).toEqual(["limit", until])

    yield* Effect.sleep("450 millis")
    yield* sendAndWait(chat.id, "three") // reset passed: back on the primary
    expect(calls.at(-1)).toBe("claude-cli/sonnet")
  }))
})

test("failover (spec 011): a limit on a route without an account holds until its reset, across a restart; a past one is dropped", async () => {
  const dir = mkdtempSync(join(tmpdir(), "zorel-aside-"))
  const db = join(dir, "zorel.db")
  const calls: string[] = []
  const until = Date.now() + 2 * 60 * 60_000 // two hours: well past the 10 minutes other failures get
  let chatId = ""
  await runWith(db, scripted({ "a/m": [{ message: "usage limit reached", failure: { reason: "limit", until } }] }, calls), Effect.gen(function* () {
    const store = yield* Store
    const chat = yield* store.createChat({ projectId: null, agentIds: [(yield* plainAgent(store)).id], model: "a/m" })
    chatId = chat.id
    yield* store.updateChat(chat.id, { failover: [{ model: "b/m", accountId: null }] })
    yield* sendAndWait(chat.id, "one")
    expect(calls).toEqual(["a/m", "b/m"])
    expect(JSON.parse((yield* store.preference("setAsideRoutes"))!)).toEqual({ "provider:a": { until, reason: "limit" } })
  }))
  // A restart: the route is still set aside, so the turn goes straight to the alternative.
  await runWith(db, scripted({}, calls), Effect.gen(function* () {
    yield* sendAndWait(chatId, "two")
    expect(calls).toEqual(["a/m", "b/m", "b/m"])
    // Its reset now in the past: the next start drops it.
    yield* (yield* Store).setPreference("setAsideRoutes", JSON.stringify({ "provider:a": { until: Date.now() - 1, reason: "limit" } }))
  }))
  await runWith(db, scripted({}, calls), Effect.gen(function* () {
    yield* sendAndWait(chatId, "three")
    expect(calls.at(-1)).toBe("a/m")
  }))
  rmSync(dir, { recursive: true, force: true })
})

test("failover: when every route fails, the turn fails once and lists each attempt", () => {
  const calls: string[] = []
  const down = { message: "fetch failed", failure: { reason: "network" as const } }
  return runWith(":memory:", scripted({ "a/m": [down], "b/m": [down] }, calls), Effect.gen(function* () {
    const store = yield* Store
    const chat = yield* store.createChat({ projectId: null, agentIds: [(yield* plainAgent(store)).id], model: "a/m" })
    yield* store.updateChat(chat.id, { failover: [{ model: "b/m", accountId: null }] })
    const events = yield* sendAndWait(chat.id, "hi")
    expect(calls).toEqual(["a/m", "b/m"])
    expect(events.filter((e) => e._tag === "turn-failed")).toHaveLength(1)
    const error = (yield* store.messages(chat.id)).at(-1)!.error!
    expect(error).toContain("a/m: network")
    expect(error).toContain("b/m: network")
  }))
})

// ---------- workspace (ARCHITECTURE §9.1) ----------

test("workspace: the agent works in the project folder; the turn records what it changed; the next turn knows", () => {
  const folder = mkdtempSync(join(tmpdir(), "zorel-proj-"))
  writeFileSync(join(folder, "a.ts"), "export const a = 1\n")
  const prompts: string[] = []
  const editing = Layer.succeed(Engines, {
    run: (t) => {
      prompts.push(t.messages.map((m) => m.text).join("\n"))
      if (t.messages.length === 1) writeFileSync(join(t.cwd, "a.ts"), "export const a = 2\n")
      return Stream.make<EngineEvent[]>(
        { type: "step", step: { id: "s1", kind: "edit", title: "Edit a.ts", detail: "a.ts", files: ["a.ts"], status: "running", output: "" } },
        { type: "step", step: { id: "s1", kind: "edit", title: "Edit a.ts", detail: "a.ts", files: ["a.ts"], status: "ok", output: "" } },
        { type: "text", delta: `cwd=${t.cwd}` },
        { type: "done", usage: { inputTokens: 1, outputTokens: 1 } }
      )
    }
  })
  return runWith(":memory:", editing, Effect.gen(function* () {
    const store = yield* Store
    const project = yield* store.createProject({ name: "app", brief: "", path: folder })
    const chat = yield* store.createChat({ projectId: project.id, agentIds: [(yield* plainAgent(store)).id], model: "x/y" })
    const events = yield* sendAndWait(chat.id, "change a")
    expect(events.some((e) => e._tag === "step-finished" && e.step.kind === "edit" && e.step.status === "ok")).toBe(true)
    const reply = (yield* store.messages(chat.id)).at(-1)!
    expect(reply.text).toBe(`cwd=${folder}`)
    expect(reply.changes).toEqual([{ path: "a.ts", added: 1, removed: 1, status: "modified" }])
    // The saved step keeps the live list's summary and detail (the transcript keeps `args`), so a finished reply shows the same lines.
    expect(reply.steps).toHaveLength(2)
    expect(reply.steps[0]).toMatchObject({ tool: "edit", args: "a.ts", status: "ok", result: "", title: "Edit a.ts", detail: "a.ts" })
    expect(reply.steps[1]).toMatchObject({ tool: "reply", title: "Replied" }) // the reply's own time closes the list
    const turn = (yield* store.turnRow(reply.turnId!))!
    expect(turn.treeBefore && turn.treeAfter && turn.treeBefore !== turn.treeAfter).toBe(true)

    yield* sendAndWait(chat.id, "and now?")
    expect(prompts[1]).toContain("[Done in this turn: edited a.ts (+1 −1)]")
    rmSync(folder, { recursive: true, force: true })
  }))
})

test("timing steps: Thought before the tools, Replied after, both for the reader only (not the transcript)", () => {
  const prompts: string[] = []
  const thinking = Layer.succeed(Engines, {
    run: (t) => {
      prompts.push(t.messages.map((m) => m.text).join("\n"))
      return Stream.make<EngineEvent[]>(
        { type: "thinking" },
        { type: "step", step: { id: "r1", kind: "run", title: "Check git status", detail: "git status", files: [], status: "running", output: "" } },
        { type: "step", step: { id: "r1", kind: "run", title: "Check git status", detail: "git status", files: [], status: "ok", output: "clean" } },
        { type: "text", delta: "all clean" },
        { type: "done", usage: { inputTokens: 1, outputTokens: 1 } }
      )
    }
  })
  return runWith(":memory:", thinking, Effect.gen(function* () {
    const store = yield* Store
    const chat = yield* store.createChat({ projectId: null, agentIds: [(yield* plainAgent(store)).id], model: "claude-cli/opus" })
    yield* sendAndWait(chat.id, "status?")
    const reply = (yield* store.messages(chat.id)).at(-1)!
    expect(reply.steps.map((s) => s.tool)).toEqual(["thought", "run", "reply"])
    expect(reply.steps[0]).toMatchObject({ title: "Thought", detail: "Claude Code · Opus", status: "ok" })
    expect(typeof reply.steps[0]!.ms).toBe("number")
    expect(reply.steps[1]).toMatchObject({ args: "git status", title: "Check git status", detail: "git status" })
    expect(reply.steps[2]).toMatchObject({ title: "Replied", detail: "Claude Code · Opus" })
    yield* sendAndWait(chat.id, "again")
    // The next prompt remembers the command, not the two timing steps.
    expect(prompts[1]).toContain("ran `git status` (ok)")
    expect(prompts[1]).not.toContain("Thought")
    expect(prompts[1]).not.toContain("Replied")
  }))
})

test("timing steps: no Thought when the engine showed no reasoning; no Replied without an answer", () => {
  const t = replyTiming()
  expect(t.steps([], "Codex", 10)).toEqual([])
  t.text(100)
  t.text(1600)
  expect(t.steps([], "Codex", 2000)).toEqual([{ tool: "reply", args: "", status: "ok", result: "", title: "Replied", detail: "Codex", ms: 1500 }])
  // Reasoning runs from its first sign to the next text or step; two spans add up.
  const u = replyTiming()
  u.thinking(0)
  u.thinking(400)
  u.step(1000)
  u.thinking(5000)
  u.text(5300)
  const steps = u.steps([], "Codex", 5400)
  expect(steps.map((s) => s.tool)).toEqual(["thought", "reply"])
  expect(steps[0]!.ms).toBe(1300)
  // Writing is timed on its own: text, a 5 s tool, text again adds up the writing, not the tool.
  const w = replyTiming()
  w.text(0)
  w.text(1000)
  w.step(1100) // the tool starts
  w.text(6100) // it ended; the agent writes again
  w.text(7100)
  expect(w.steps([], "Codex", 7200).find((s) => s.tool === "reply")!.ms).toBe(2000)
  // A failover starts the reply over.
  u.reset()
  expect(u.steps([], "Codex", 9000)).toEqual([])
})

test("runaway guard: the same step and result 4 times is a loop; 6 failures in a row is stuck", () => {
  const g = runawayGuard()
  const step = (title: string, status = "ok", output = "same") => g({ kind: "run", title, status, output })
  expect(step("ls")).toBeUndefined()
  expect(step("ls")).toBeUndefined()
  expect(step("ls", "ok", "different")).toBeUndefined() // a different result resets
  expect(step("ls", "ok", "different")).toBeUndefined()
  expect(step("ls", "ok", "different")).toBeUndefined()
  expect(step("ls", "ok", "different")).toContain("4 times")
  const h = runawayGuard()
  for (let i = 0; i < 5; i++) expect(h({ kind: "run", title: `t${i}`, status: "error", output: "" })).toBeUndefined()
  expect(h({ kind: "run", title: "t5", status: "error", output: "" })).toContain("6 steps")
})

test("runaway guard: successful edits of one file are progress, failed ones and repeated commands are not", () => {
  const edit = (status: string, output = "The file a.ts has been updated successfully.") => ({ kind: "edit", title: "Edit a.ts", detail: "a.ts", status, output })
  const run = (output = "same") => ({ kind: "run", title: "Check git status", detail: "git status", status: "ok", output })
  // The same successful edit, many times: the file changes each time, so it never trips.
  const a = runawayGuard()
  for (let i = 0; i < 12; i++) expect(a(edit("ok"))).toBeUndefined()
  // The same failed edit does.
  const b = runawayGuard()
  for (let i = 0; i < 3; i++) expect(b(edit("error", "old_string not found"))).toBeUndefined()
  expect(b(edit("error", "old_string not found"))).toContain("4 times")
  // The same command with the same output does.
  const c = runawayGuard()
  for (let i = 0; i < 3; i++) expect(c(run())).toBeUndefined()
  expect(c(run())).toContain("4 times")
  // An edit between identical commands resets the count.
  const d = runawayGuard()
  for (let i = 0; i < 3; i++) expect(d(run())).toBeUndefined()
  expect(d(edit("ok"))).toBeUndefined()
  for (let i = 0; i < 3; i++) expect(d(run())).toBeUndefined()
  expect(d(run())).toContain("4 times")
  // A refused edit is not progress: an agent that keeps asking for what was denied is stopped.
  const f = runawayGuard()
  for (let i = 0; i < 3; i++) expect(f(edit("refused", "The user denied this."))).toBeUndefined()
  expect(f(edit("refused", "The user denied this."))).toContain("4 times")
  // A successful edit also clears the failure streak.
  const e = runawayGuard()
  for (let i = 0; i < 5; i++) expect(e({ kind: "run", title: `t${i}`, status: "error", output: "" })).toBeUndefined()
  expect(e(edit("ok"))).toBeUndefined()
  expect(e({ kind: "run", title: "t6", status: "error", output: "" })).toBeUndefined()
})

// zorel_start_task: the teammate works in its own chat and its answer comes back to the asking chat, where the
// asking agent takes the next turn.
const Delegating = Layer.succeed(Engines, {
  run: (t) =>
    Stream.unwrap(
      Effect.promise(async () => {
        const last = t.messages.at(-1)!.text
        let text = "thanks, got it"
        if (last.startsWith("Task from")) {
          await new Promise((r) => setTimeout(r, 100)) // long enough for the asking chat to show it waits
          text = "the answer is 42"
        } else if (last === "delegate") {
          const r = await t.tools!.call("zorel_start_task", { agent: "@helper", task: "work out the answer" })
          text = r.isError ? `refused: ${JSON.stringify(r.content)}` : "started"
        }
        return Stream.make<EngineEvent[]>({ type: "text", delta: text }, { type: "done", usage: { inputTokens: 1, outputTokens: 1 } })
      })
    )
})

test("start_task: the teammate's answer comes back to the asking chat and the asker continues", () =>
  runWith(":memory:", Delegating, Effect.gen(function* () {
    const store = yield* Store
    const runtime = yield* Runtime
    const lead = yield* store.createAgent({ projectId: null, name: "Lead", instructions: "", model: "x/y" })
    const helper = yield* store.createAgent({ projectId: null, name: "Helper", instructions: "", model: "x/y" })
    const chat = yield* store.createChat({ projectId: null, agentIds: [lead.id], model: "x/y", access: "workspace" })
    const seen: ChatStatus[] = []
    yield* Effect.forkDetach(Stream.runForEach(runtime.subscribeStatus, (s) => Effect.sync(() => s.chatId === chat.id && seen.push(s))))
    yield* Effect.sleep("10 millis")
    yield* runtime.send({ chatId: chat.id, clientId: "task-1", text: "delegate" })
    let msgs = yield* store.messages(chat.id)
    for (let i = 0; i < 300 && msgs.length < 4; i++) {
      yield* Effect.sleep("10 millis")
      msgs = yield* store.messages(chat.id)
    }
    expect(msgs.map((m) => m.text.split("\n")[0])).toEqual(["delegate", "started", "the answer is 42", "thanks, got it"])
    expect(msgs[2]!.text).toContain("[Open the task](#/chat/")
    expect(yield* store.openTasks()).toEqual([]) // reported once
    // While the task ran, the chat said the lead waits for the helper; once it reported back, nobody waits.
    expect(seen.some((s) => s.waits?.[0]?.agentId === lead.id && s.waits[0].on[0] === helper.id && s.waits[0].taskChatId !== null)).toBe(true)
    expect(seen.at(-1)?.waits).toEqual([])
    expect((yield* store.chats()).find((c) => c.id !== chat.id)?.access).toBe("workspace") // the chat's level carries over
    expect((yield* store.chats()).find((c) => c.id !== chat.id)?.parentId).toBe(chat.id) // still under the asking chat after it reported back
    const runs = yield* store.agentRuns(lead.id) // its sessions' runs, newest first: the wrap-up, then the delegation
    expect(runs.map((r) => [r.chatId, r.state, r.preview])).toEqual([[chat.id, "completed", "thanks, got it"], [chat.id, "completed", "started"]])
  })))

// zorel_ask_user: the agent waits on a question card; the person's answer comes back as the tool's result.
const Asking = Layer.succeed(Engines, {
  run: (t) =>
    Stream.unwrap(
      Effect.promise(async () => {
        const r = await t.tools!.call("zorel_ask_user", { question: "Which port?", options: ["3000", "8080"] })
        const text = r.content.map((c) => ("text" in c ? c.text : "")).join("")
        return Stream.make<EngineEvent[]>({ type: "text", delta: text }, { type: "done", usage: { inputTokens: 1, outputTokens: 1 } })
      })
    )
})

test("ask_user: the question waits as a card and the answer comes back to the agent", () =>
  runWith(":memory:", Asking, Effect.gen(function* () {
    const store = yield* Store
    const runtime = yield* Runtime
    const chat = yield* store.createChat({ projectId: null, agentIds: [(yield* plainAgent(store)).id], model: "x/y" })
    const c = yield* collect(chat.id, (e) => e._tag === "turn-completed")
    yield* runtime.send({ chatId: chat.id, clientId: "ask-1", text: "start the server" })
    while (!c.events.some((e) => e._tag === "approval")) yield* Effect.sleep("10 millis")
    const card = c.events.find((e) => e._tag === "approval")!
    expect(card._tag === "approval" && [card.approval.kind, card.approval.summary, card.approval.args]).toEqual(["question", "Which port?", '{"options":["3000","8080"]}'])
    if (card._tag === "approval") yield* runtime.decide(card.approval.id, "approved", "8080")
    yield* c.done
    const msgs = yield* store.messages(chat.id)
    expect(msgs.at(-1)!.text).toBe("The user answered: 8080")
  })))

// A lead that gives a teammate a task and also names it ("handed to @helper") hands the work over once.
const TaskAndMention = Layer.succeed(Engines, {
  run: (t) =>
    Stream.unwrap(
      Effect.promise(async () => {
        const last = t.messages.at(-1)!.text
        let text = "done"
        if (last === "go") {
          await t.tools!.call("zorel_start_task", { agent: "@helper", task: "do it", reply: false })
          text = "I've handed it to @helper."
        }
        return Stream.make<EngineEvent[]>({ type: "text", delta: text }, { type: "done", usage: { inputTokens: 1, outputTokens: 1 } })
      })
    )
})

test("start_task: naming the teammate it tasked doesn't also chain it in the chat", () =>
  runWith(":memory:", TaskAndMention, Effect.gen(function* () {
    const store = yield* Store
    const runtime = yield* Runtime
    const lead = yield* store.createAgent({ projectId: null, name: "Lead", instructions: "", model: "x/y" })
    const helper = yield* store.createAgent({ projectId: null, name: "Helper", instructions: "", model: "x/y" })
    const chat = yield* store.createChat({ projectId: null, agentIds: [lead.id, helper.id], model: "x/y" })
    yield* runtime.send({ chatId: chat.id, clientId: "tm-1", text: "go" })
    for (let i = 0; i < 100 && runtime.busy(chat.id); i++) yield* Effect.sleep("10 millis")
    yield* Effect.sleep("200 millis")
    const msgs = yield* store.messages(chat.id)
    expect(msgs.map((m) => m.text)).toEqual(["go", "I've handed it to @helper."]) // no second Helper turn here
  })))

// Lead hands over by mention; the helper answers; the lead gets the wrap-up turn. A follow-up with no mention after
// you spoke to the helper goes on with the helper.
const Team = Layer.succeed(Engines, {
  run: (t) =>
    Stream.unwrap(
      Effect.promise(async () => {
        const me = /## You are ([^,\n]+)/.exec(t.system)?.[1]
        const last = t.messages.at(-1)!.text
        const text =
          me === "Lead" ? (last.includes("[Helper]") ? "wrap: all good" : "@helper please do it") : me === "Helper" ? `helper on: ${last.split("\n").at(-1)}` : "?"
        return Stream.make<EngineEvent[]>({ type: "text", delta: text }, { type: "done", usage: { inputTokens: 1, outputTokens: 1 } })
      })
    )
})

test("teams: the agent that handed over by mention wraps up; a follow-up stays with the teammate you spoke to", () =>
  runWith(":memory:", Team, Effect.gen(function* () {
    const store = yield* Store
    const runtime = yield* Runtime
    const lead = yield* store.createAgent({ projectId: null, name: "Lead", instructions: "Leads.", model: "x/y" })
    const helper = yield* store.createAgent({ projectId: null, name: "Helper", instructions: "Helps.", model: "x/y" })
    const chat = yield* store.createChat({ projectId: null, agentIds: [lead.id, helper.id], model: "x/y" })
    const settle = Effect.gen(function* () {
      yield* Effect.sleep("50 millis")
      for (let i = 0; i < 200 && runtime.busy(chat.id); i++) yield* Effect.sleep("10 millis")
      yield* Effect.sleep("100 millis")
    })
    yield* runtime.send({ chatId: chat.id, clientId: "w-1", text: "get it done" })
    yield* settle
    const who = (id: string | null) => (id === lead.id ? "Lead" : id === helper.id ? "Helper" : "you")
    let msgs = yield* store.messages(chat.id)
    expect(msgs.map((m) => `${who(m.agentId)}: ${m.text}`)).toEqual(["you: get it done", "Lead: @helper please do it", "Helper: helper on: @helper please do it", "Lead: wrap: all good"])
    yield* runtime.send({ chatId: chat.id, clientId: "w-2", text: "@helper one more" })
    yield* settle
    yield* runtime.send({ chatId: chat.id, clientId: "w-3", text: "and another" })
    yield* settle
    msgs = yield* store.messages(chat.id)
    expect(msgs.slice(-2).map((m) => `${who(m.agentId)}: ${m.text}`)).toEqual(["you: and another", "Helper: helper on: and another"])
  })))

// A message naming no one in a team: the router's pick answers it (here the helper), with a note saying so.
const Routed = Layer.succeed(Engines, {
  run: (t) => {
    const last = t.messages.at(-1)!.text
    const me = /## You are ([^,\n]+)/.exec(t.system)?.[1]
    const text = last.startsWith("You route a message") ? '{"handle": "helper", "reason": "its remit"}' : `${me}: on it`
    return Stream.make<EngineEvent[]>({ type: "text", delta: text }, { type: "done", usage: { inputTokens: 1, outputTokens: 1 } })
  }
})

test("router: a message naming no one goes to the teammate the router picks", () =>
  runWith(":memory:", Routed, Effect.gen(function* () {
    const store = yield* Store
    const runtime = yield* Runtime
    const lead = yield* store.createAgent({ projectId: null, name: "Lead", instructions: "Leads.", model: "x/y" })
    const helper = yield* store.createAgent({ projectId: null, name: "Helper", title: "Writes tests", instructions: "Helps.", model: "x/y" })
    const chat = yield* store.createChat({ projectId: null, agentIds: [lead.id, helper.id], model: "x/y" })
    const c = yield* collect(chat.id, (e) => e._tag === "turn-completed")
    yield* runtime.send({ chatId: chat.id, clientId: "r-1", text: "we need tests for sum" })
    yield* c.done
    const note = c.events.find((e) => e._tag === "handoff")
    expect(note?._tag === "handoff" && [note.via, note.to, note.reason]).toEqual(["route", [helper.id], "its remit"])
    expect((yield* store.messages(chat.id)).at(-1)!.text).toBe("Helper: on it")
  })))

// Settings › General › "Agents working at once": over the limit a chat keeps its turn queued and waits in line; when a
// chat at work ends (here: stopped), the one waiting starts on its own.
test("a limit on chats at work: over it a chat waits for a free slot, then starts by itself", () =>
  runWith(":memory:", Hanging, Effect.gen(function* () {
    const store = yield* Store
    const runtime = yield* Runtime
    const stateOf = (chatId: string) => store.activeTurns(chatId).pipe(Effect.map((ts) => ts.map((t) => t.state)))
    const until = (chatId: string, state: string) =>
      Effect.gen(function* () {
        for (let i = 0; i < 100; i++) {
          if ((yield* stateOf(chatId)).includes(state as never)) return
          yield* Effect.sleep("20 millis")
        }
        throw new Error(`${chatId} never reached ${state}`)
      })
    yield* runtime.setMaxRunning(1)
    const a = yield* store.createChat({ projectId: null, agentIds: [(yield* plainAgent(store)).id], model: "x/y" })
    const b = yield* store.createChat({ projectId: null, agentIds: [(yield* plainAgent(store)).id], model: "x/y" })
    yield* runtime.send({ chatId: a.id, clientId: crypto.randomUUID(), text: "first" })
    yield* until(a.id, "running")
    yield* runtime.send({ chatId: b.id, clientId: crypto.randomUUID(), text: "second" })
    yield* Effect.sleep("150 millis")
    expect(yield* stateOf(b.id)).toEqual(["queued"]) // the one slot is taken: it waits
    yield* runtime.interrupt(a.id)
    yield* until(b.id, "running") // the slot freed: it started without being sent again
    yield* runtime.interrupt(b.id)
  })))

// Per-agent token limits, Retry and archive. The engine reports a big reply the first time it runs, then echoes.
const BigThenEcho = () => {
  let calls = 0
  return Layer.succeed(Engines, {
    run: (t) => {
      calls++
      if (calls === 1) return Stream.concat(Stream.make<EngineEvent[]>({ type: "text", delta: "long" }, { type: "usage", usage: { inputTokens: 5000, outputTokens: 10, cachedTokens: 0 } }), Stream.never)
      return Stream.make<EngineEvent[]>({ type: "text", delta: `again: ${t.messages.at(-1)!.text}` }, { type: "done", usage: { inputTokens: 1, outputTokens: 1 } })
    }
  })
}
const Spends = Layer.succeed(Engines, {
  run: () => Stream.make<EngineEvent[]>({ type: "text", delta: "ok" }, { type: "done", usage: { inputTokens: 1500, outputTokens: 0 } })
})
const replies = (chatId: string) =>
  Effect.gen(function* () {
    const store = yield* Store
    for (let i = 0; i < 100; i++) {
      const ms = (yield* store.messages(chatId)).filter((m) => m.role === "assistant")
      if (ms.length) return ms
      yield* Effect.sleep("20 millis")
    }
    return []
  })
const nthReply = (chatId: string, n: number) =>
  Effect.gen(function* () {
    const store = yield* Store
    for (let i = 0; i < 100; i++) {
      const ms = (yield* store.messages(chatId)).filter((m) => m.role === "assistant")
      if (ms.length >= n) return ms
      yield* Effect.sleep("20 millis")
    }
    return (yield* store.messages(chatId)).filter((m) => m.role === "assistant")
  })

test("a reply past its agent's token limit stops there; Retry has the agent answer again", () =>
  runWith(":memory:", BigThenEcho(), Effect.gen(function* () {
    const store = yield* Store
    const runtime = yield* Runtime
    const a = yield* store.createAgent({ projectId: null, name: "Writer", instructions: "", model: "x/y" })
    yield* store.updateAgent(a.id, { replyTokens: 1000 })
    const chat = yield* store.createChat({ projectId: null, agentIds: [a.id], model: "x/y" })
    yield* runtime.send({ chatId: chat.id, clientId: crypto.randomUUID(), text: "write it all" })
    const [first] = yield* replies(chat.id)
    expect(first).toMatchObject({ error: ErrorCode.replyLimit, text: "long", agentId: a.id }) // stopped with what it had
    yield* runtime.retry(chat.id, first!.id)
    const all = yield* nthReply(chat.id, 2)
    // The same agent answers again, seeing what it already wrote (its partial reply is in the conversation).
    expect(all.at(-1)).toMatchObject({ error: null, agentId: a.id, text: "again: long" })
  })))

test("an agent over its month's tokens doesn't start, and says so", () =>
  runWith(":memory:", Spends, Effect.gen(function* () {
    const store = yield* Store
    const runtime = yield* Runtime
    const a = yield* store.createAgent({ projectId: null, name: "Spender", instructions: "", model: "x/y" })
    yield* store.updateAgent(a.id, { monthlyTokens: 1000 })
    const chat = yield* store.createChat({ projectId: null, agentIds: [a.id], model: "x/y" })
    yield* runtime.send({ chatId: chat.id, clientId: crypto.randomUUID(), text: "one" }) // spends 1500: over the month's 1000
    yield* nthReply(chat.id, 1)
    yield* runtime.send({ chatId: chat.id, clientId: crypto.randomUUID(), text: "two" })
    const all = yield* nthReply(chat.id, 2)
    expect(all.at(-1)).toMatchObject({ error: ErrorCode.monthlyLimit, text: "" })
  })))

test("an archived agent answers no one in its chats, and nothing answers in its place (spec 015)", () =>
  runWith(":memory:", Echo, Effect.gen(function* () {
    const store = yield* Store
    const runtime = yield* Runtime
    const a = yield* store.createAgent({ projectId: null, name: "Gone", instructions: "", model: "x/y" })
    yield* store.updateAgent(a.id, { archivedAt: Date.now() })
    const chat = yield* store.createChat({ projectId: null, agentIds: [a.id], model: "x/y" })
    const sent = yield* runtime.send({ chatId: chat.id, clientId: crypto.randomUUID(), text: "hello" }).pipe(Effect.flip)
    expect(sent._tag).toBe("ChatNeedsAgent") // the app asks who continues; the message isn't saved meanwhile
    expect(yield* store.messages(chat.id)).toEqual([])
  })))

// Quiet learning (consolidate "quiet"): a short chat learns on the provider's small model, leaves its summary and
// window alone, and never takes a message it already learned from as evidence again.
const learnerModels: string[] = []
const Learner = Layer.succeed(Engines, {
  run: (t) => {
    learnerModels.push(t.model)
    const text = t.messages.at(-1)!.text
    const tabs = /#(\d+) \[user\]( \(learned\))? I prefer tabs/.exec(text)
    const fact = tabs?.[2] ? "Uses tabs in every project" : "Prefers tabs over spaces" // a second try on a learned message
    const reply = { summary: "", memories: tabs ? [{ scope: "user", text: fact, keywords: "indent", evidence: [Number(tabs[1])] }] : [] }
    return Stream.make<EngineEvent[]>({ type: "text", delta: JSON.stringify(reply) }, { type: "done", usage: { inputTokens: 1, outputTokens: 1 } })
  }
})

test("quiet learning: a short chat learns on the small model; the summary stays; a learned message is never evidence again", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const store = yield* Store
        const chat = yield* store.createChat({ projectId: null, agentIds: [(yield* plainAgent(store)).id], model: "claude-cli/sonnet" })
        const say = (role: "user" | "assistant", text: string) =>
          Effect.andThen(Effect.sleep("2 millis"), store.addMessage({ chatId: chat.id, role, agentId: null, text, model: null, error: null, steps: [], inputTokens: 0, outputTokens: 0 }))
        yield* say("user", "I prefer tabs over spaces")
        yield* say("assistant", "Noted.")
        expect(yield* consolidate(chat.id, "quiet")).toMatchObject({ learnedUntil: 0 }) // under QUIET_MIN: no call
        expect(learnerModels).toEqual([])
        yield* say("user", "thanks")
        const after = yield* consolidate(chat.id, "quiet")
        expect(learnerModels).toEqual(["claude-cli/haiku"])
        expect(after.summary).toBe("")
        expect(after.summaryUntil).toBe(0)
        expect(after.learnedUntil).toBeGreaterThan(0)
        expect((yield* store.memories()).map((m) => [m.text, m.state])).toEqual([["Prefers tabs over spaces", "pending"]])
        yield* consolidate(chat.id, "quiet") // nothing new since: no call
        expect(learnerModels.length).toBe(1)
        yield* say("assistant", "Anything else?")
        yield* say("user", "no")
        yield* say("assistant", "Bye.")
        yield* consolidate(chat.id, "quiet") // reads the tabs message again, as context only
        expect(learnerModels.length).toBe(2)
        expect((yield* store.memories()).map((m) => m.text)).toEqual(["Prefers tabs over spaces"])
        // A model chosen in Settings learns instead of the automatic one.
        yield* store.setPreference("memoryModel", "anthropic/claude-haiku-5-5")
        for (const t of ["more", "words", "here"]) yield* say(t === "words" ? "assistant" : "user", t)
        yield* consolidate(chat.id, "quiet")
        expect(learnerModels.at(-1)).toBe("anthropic/claude-haiku-5-5")
      })
    ).pipe(Effect.provide(layer(":memory:", Learner)))
  ))

// Tools offered only when useful: reading ones wait for something to read; writing ones stay.
const offered: string[][] = []
const ToolLister = Layer.succeed(Engines, {
  run: (t) => {
    offered.push((t.tools?.defs ?? []).map((d) => d.name))
    return Stream.make<EngineEvent[]>({ type: "text", delta: "ok" }, { type: "done", usage: { inputTokens: 1, outputTokens: 1 } })
  }
})

test("reading tools come once there's something to read: pages, skills, memories past the prompt", () =>
  runWith(":memory:", ToolLister, Effect.gen(function* () {
    const store = yield* Store
    const runtime = yield* Runtime
    const chat = yield* store.createChat({ projectId: null, agentIds: [(yield* plainAgent(store)).id], model: "x/y" })
    const turnOnce = (text: string) =>
      Effect.gen(function* () {
        const c = yield* collect(chat.id, (e) => e._tag === "turn-completed")
        yield* runtime.send({ chatId: chat.id, clientId: crypto.randomUUID(), text })
        yield* c.done
      })
    yield* turnOnce("hi")
    const first = offered.at(-1)!
    for (const idle of ["zorel_knowledge_search", "zorel_knowledge_read", "zorel_read_skill", "zorel_search_memories"]) expect(first).not.toContain(idle)
    for (const kept of ["zorel_knowledge_write", "zorel_propose_skill"]) expect(first).toContain(kept)
    yield* store.savePage({ scope: "user", title: "Notes", body: "x" })
    yield* store.addMemory({ scope: "user", kind: "skill", title: "Release", text: "1. tag", state: "active", origin: "manual", chatId: null })
    yield* turnOnce("again")
    for (const now of ["zorel_knowledge_search", "zorel_knowledge_read", "zorel_read_skill"]) expect(offered.at(-1)!).toContain(now)
  })))

// The facts kept before the map existed are filed on it in batches, once (a cursor keeps them from being read again).
let mapCalls = 0
const Mapper = Layer.succeed(Engines, {
  run: (t) => {
    mapCalls++
    const n = (t.messages.at(-1)!.text.match(/^#\d+/gm) ?? []).length
    const items = Array.from({ length: n }, (_, i) => ({ n: i + 1, entities: [{ name: "Deploy", type: "subject" }, { name: "Vercel", type: "concept" }], relations: [["Deploy", "goes to", "Vercel"]] }))
    return Stream.make<EngineEvent[]>({ type: "text", delta: `ok ${JSON.stringify({ items })}` }, { type: "done", usage: { inputTokens: 1, outputTokens: 1 } })
  }
})

test("earlier facts go on the map once, on the small model", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const store = yield* Store
        const p = yield* store.createProject({ name: "Zorel", brief: "" })
        yield* store.createChat({ projectId: p.id, agentIds: [(yield* plainAgent(store)).id], model: "claude-cli/sonnet" })
        for (const text of ["Deploys go to Vercel", "Deploys happen on Fridays", "Previews deploy on Vercel"]) yield* store.addMemory({ scope: `project:${p.id}`, text, state: "active", origin: "manual", chatId: null })
        yield* Effect.sleep("2 millis")
        expect(yield* mapEarlierFacts()).toBe(3)
        expect(mapCalls).toBe(1) // one batch
        const map = yield* store.entitiesIn([`project:${p.id}`])
        expect(map.map((e) => [e.name, Number(e.facts)]).sort()).toEqual([["Deploy", 3], ["Vercel", 3], ["Zorel", 3]])
        expect(yield* mapEarlierFacts()).toBe(0) // nothing left: no call
        expect(mapCalls).toBe(1)
      })
    ).pipe(Effect.provide(layer(":memory:", Mapper)))
  ))

test("quietly (spec 011): a failure in background work is logged once with the chat; busy, gone and fine say nothing", async () => {
  const lines: string[] = []
  const capture = Logger.formatLogFmt.pipe(Logger.map((l) => lines.push(l)))
  const run = (e: Effect.Effect<unknown, unknown>) => Effect.runPromise(e.pipe(quietly("consolidation", "chat-1"), Effect.provide(Logger.layer([capture]))))
  await run(Effect.fail(new Busy()))
  await run(Effect.fail(new NotFound()))
  await run(Effect.succeed(1))
  expect(lines).toEqual([])
  await run(Effect.die(new Error("disk is full")))
  await run(Effect.fail(new Error("no model answered")))
  expect(lines).toHaveLength(2)
  expect(lines[0]).toContain("consolidation failed")
  expect(lines[0]).toContain("chat-1")
  expect(lines[0]).toContain("disk is full")
  expect(lines[1]).toContain("no model answered")
})

test("release (spec 011): a deleted chat's open stream ends, and it can't be subscribed again", () =>
  runWith(":memory:", Echo, Effect.gen(function* () {
    const store = yield* Store
    const runtime = yield* Runtime
    const chat = yield* store.createChat({ projectId: null, agentIds: [(yield* plainAgent(store)).id], model: "a/m" })
    yield* sendAndWait(chat.id, "hi") // the hub exists and has had events
    const ready = yield* Deferred.make<void>()
    const open = yield* runtime.subscribeChat(chat.id).pipe(
      Stream.tap((e) => (e._tag === "snapshot" ? Deferred.succeed(ready, undefined) : Effect.void)),
      Stream.runDrain,
      Effect.forkChild
    )
    yield* Deferred.await(ready)
    yield* store.removeChat(chat.id)
    yield* runtime.release(chat.id)
    const ended = yield* Fiber.join(open).pipe(Effect.timeout("1 second"), Effect.exit)
    expect(Exit.isSuccess(ended)).toBe(true) // the stream ended by itself, not by the timeout
    const again = yield* runtime.subscribeChat(chat.id).pipe(Stream.runDrain, Effect.exit)
    expect(Exit.isFailure(again)).toBe(true)
  })))
