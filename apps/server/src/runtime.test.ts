// Phase 1 criteria (ARCHITECTURE §13): resend doesn't duplicate, interrupt keeps the partial,
// kill -9 mid-turn becomes `interrupted` with the partial text on the next boot.
import { expect, test } from "bun:test"
import type { ChatEvent } from "@zorel/contracts/events"
import { Deferred, Effect, Exit, Fiber, Layer, Stream } from "effect"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Accounts } from "./accounts.ts"
import { Audit } from "./audit.ts"
import { BrowserService } from "./browser.ts"
import { DataDir } from "./chat.ts"
import { Store } from "./db.ts"
import { Engines, type EngineEvent } from "./engines.ts"
import { Runtime, runawayGuard } from "./runtime.ts"
import { Secrets } from "./secrets.ts"
import { Tools } from "./tools.ts"
import { Pricing } from "./pricing.ts"
import { Workspace } from "./workspace.ts"

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
    const chat = yield* store.createChat({ projectId: null, agentIds: [], model: "x/y" })
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
    const chat = yield* store.createChat({ projectId: null, agentIds: [], model: "x/y" })
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

test("kill -9 mid-turn: on the next boot the turn becomes interrupted with the partial text", async () => {
  const dir = join(tmpdir(), `zorel-rt-${crypto.randomUUID()}`)
  mkdirSync(dir)
  const path = join(dir, "zorel.db")
  // First life: a turn stays `running` with partial text saved (as if the process died here).
  const chatId = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const store = yield* Store
        const chat = yield* store.createChat({ projectId: null, agentIds: [], model: "x/y" })
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
        return Stream.make<EngineEvent[]>({ type: "text", delta: "ok" }, { type: "done", usage: { inputTokens: 1, outputTokens: 1 } })
      }
    }
  }
})

test("native session: opens once, later turns send only what is new, a stable-context change reopens with the checkpoint", () =>
  runWith(":memory:", Sessions, Effect.gen(function* () {
    const store = yield* Store
    const runtime = yield* Runtime
    const chat = yield* store.createChat({ projectId: null, agentIds: [], model: "claude-cli/haiku" })
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

    // A new user memory changes the stable context: new session, which gets the whole checkpoint.
    yield* store.addMemory({ scope: "user", text: "Prefere respostas curtas", state: "active", origin: "manual", chatId: null })
    yield* turnOnce("third")
    expect(sessionLog.opened).toHaveLength(2)
    expect(sessionLog.opened[1]).toContain("Prefere respostas curtas")
    expect(sessionLog.prompts[2]).toContain("first")
    expect(sessionLog.prompts[2]).toContain("third")
  })))

test("native session: interrupting stops the turn but keeps the session", () =>
  runWith(":memory:", Sessions, Effect.gen(function* () {
    const store = yield* Store
    const runtime = yield* Runtime
    const chat = yield* store.createChat({ projectId: null, agentIds: [], model: "claude-cli/haiku" })
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

test("accounts: the chat's account reaches the session as its login folder; switching accounts opens a new session", () =>
  runWith(":memory:", Sessions, Effect.gen(function* () {
    const store = yield* Store
    const runtime = yield* Runtime
    yield* store.ensureAccount({ id: "work", label: "Claude work", kind: "subscription", provider: "claude", home: "/tmp/zorel-acc-work", secret: null, baseUrl: null, identity: null })
    yield* store.ensureAccount({ id: "cdx", label: "Codex 2", kind: "subscription", provider: "codex", home: "/tmp/zorel-acc-cdx", secret: null, baseUrl: null, identity: null })
    const chat = yield* store.createChat({ projectId: null, agentIds: [], model: "claude-cli/haiku", accountId: "work" })
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
    const chat = yield* store.createChat({ projectId: null, agentIds: [], model: "codex-cli/default" })
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

test("effort: the chat's level reaches the session on every turn", () =>
  runWith(":memory:", Sessions, Effect.gen(function* () {
    const store = yield* Store
    const runtime = yield* Runtime
    const chat = yield* store.createChat({ projectId: null, agentIds: [], model: "claude-cli/haiku", effort: "high" })
    const c = yield* collect(chat.id, (e) => e._tag === "turn-completed")
    yield* runtime.send({ chatId: chat.id, clientId: crypto.randomUUID(), text: "think" })
    yield* c.done
    expect(sessionLog.efforts.at(-1)).toBe("high")
  })))

test("switching Claude → Codex → Claude: the Claude session survives and gets only what is new on return", () =>
  runWith(":memory:", Sessions, Effect.gen(function* () {
    const store = yield* Store
    const runtime = yield* Runtime
    const chat = yield* store.createChat({ projectId: null, agentIds: [], model: "claude-cli/haiku" })
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

    const noList = yield* store.createChat({ projectId: null, agentIds: [], model: "a/m" })
    yield* sendAndWait(noList.id, "hi")
    expect(calls).toEqual(["a/m", "a/m"]) // failover off: empty list
  }))
})

test("failover: a subscription limit holds the account until its reset, then the primary comes back by itself", () => {
  const calls: string[] = []
  const until = Date.now() + 400
  return runWith(":memory:", scripted({ "claude-cli/sonnet": [{ message: "usage limit reached", failure: { reason: "limit", until } }] }, calls), Effect.gen(function* () {
    const store = yield* Store
    const chat = yield* store.createChat({ projectId: null, agentIds: [], model: "claude-cli/sonnet" })
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

test("failover: when every route fails, the turn fails once and lists each attempt", () => {
  const calls: string[] = []
  const down = { message: "fetch failed", failure: { reason: "network" as const } }
  return runWith(":memory:", scripted({ "a/m": [down], "b/m": [down] }, calls), Effect.gen(function* () {
    const store = yield* Store
    const chat = yield* store.createChat({ projectId: null, agentIds: [], model: "a/m" })
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
        { type: "step", step: { id: "s1", kind: "edit", title: "Edit a.ts", files: ["a.ts"], status: "running", output: "" } },
        { type: "step", step: { id: "s1", kind: "edit", title: "Edit a.ts", files: ["a.ts"], status: "ok", output: "" } },
        { type: "text", delta: `cwd=${t.cwd}` },
        { type: "done", usage: { inputTokens: 1, outputTokens: 1 } }
      )
    }
  })
  return runWith(":memory:", editing, Effect.gen(function* () {
    const store = yield* Store
    const project = yield* store.createProject({ name: "app", brief: "", path: folder })
    const chat = yield* store.createChat({ projectId: project.id, agentIds: [], model: "x/y" })
    const events = yield* sendAndWait(chat.id, "change a")
    expect(events.some((e) => e._tag === "step-finished" && e.step.kind === "edit" && e.step.status === "ok")).toBe(true)
    const reply = (yield* store.messages(chat.id)).at(-1)!
    expect(reply.text).toBe(`cwd=${folder}`)
    expect(reply.changes).toEqual([{ path: "a.ts", added: 1, removed: 1, status: "modified" }])
    const turn = (yield* store.turnRow(reply.turnId!))!
    expect(turn.treeBefore && turn.treeAfter && turn.treeBefore !== turn.treeAfter).toBe(true)

    yield* sendAndWait(chat.id, "and now?")
    expect(prompts[1]).toContain("[Done in this turn: edited a.ts (+1 −1)]")
    rmSync(folder, { recursive: true, force: true })
  }))
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

// zorel_start_task: the teammate works in its own chat and its answer comes back to the asking chat, where the
// asking agent takes the next turn.
const Delegating = Layer.succeed(Engines, {
  run: (t) =>
    Stream.unwrap(
      Effect.promise(async () => {
        const last = t.messages.at(-1)!.text
        let text = "thanks, got it"
        if (last.startsWith("Task from")) text = "the answer is 42"
        else if (last === "delegate") {
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
    yield* store.createAgent({ projectId: null, name: "Helper", instructions: "", model: "x/y" })
    const chat = yield* store.createChat({ projectId: null, agentIds: [lead.id], model: "x/y" })
    yield* runtime.send({ chatId: chat.id, clientId: "task-1", text: "delegate" })
    let msgs = yield* store.messages(chat.id)
    for (let i = 0; i < 300 && msgs.length < 4; i++) {
      yield* Effect.sleep("10 millis")
      msgs = yield* store.messages(chat.id)
    }
    expect(msgs.map((m) => m.text.split("\n")[0])).toEqual(["delegate", "started", "the answer is 42", "thanks, got it"])
    expect(msgs[2]!.text).toContain("[Open the task](#/chat/")
    expect(yield* store.openTasks()).toEqual([]) // reported once
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
    const chat = yield* store.createChat({ projectId: null, agentIds: [], model: "x/y" })
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
