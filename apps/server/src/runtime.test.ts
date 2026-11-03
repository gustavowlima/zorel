// Phase 1 criteria (ARCHITECTURE §13): resend doesn't duplicate, interrupt keeps the partial,
// kill -9 mid-turn becomes `interrupted` with the partial text on the next boot.
import { expect, test } from "bun:test"
import type { ChatEvent } from "@zero/contracts/events"
import { Deferred, Effect, Exit, Fiber, Layer, Stream } from "effect"
import { mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DataDir } from "./chat.ts"
import { Store } from "./db.ts"
import { Engines, type EngineEvent } from "./engines.ts"
import { Runtime } from "./runtime.ts"
import { Secrets } from "./secrets.ts"
import { Tools } from "./tools.ts"

// Engine that sends "parte" and then hangs: leaves time to interrupt.
const Hanging = Layer.succeed(Engines, {
  run: () => Stream.concat(Stream.make<EngineEvent[]>({ type: "text", delta: "parte" }), Stream.never)
})
const Echo = Layer.succeed(Engines, {
  run: (t) => Stream.make<EngineEvent[]>({ type: "text", delta: `eco: ${t.messages.at(-1)!.text}` }, { type: "done", usage: { inputTokens: 1, outputTokens: 1 } })
})

const layer = (dbPath: string, engines: Layer.Layer<Engines>) => {
  const store = Store.layer(dbPath)
  const base = Layer.mergeAll(Layer.provideMerge(Layer.mergeAll(engines, Tools.layer), Layer.provideMerge(Secrets.memory(), store)), DataDir.layer(join(tmpdir(), "zero-rt")))
  return Layer.provideMerge(Runtime.layer, base)
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

test("reenviar o mesmo clientId devolve o mesmo turno e não duplica a mensagem", () =>
  runWith(":memory:", Echo, Effect.gen(function* () {
    const store = yield* Store
    const runtime = yield* Runtime
    const chat = yield* store.createChat({ projectId: null, agentIds: [], model: "x/y" })
    const c = yield* collect(chat.id, (e) => e._tag === "turn-completed")
    const a = yield* runtime.send({ chatId: chat.id, clientId: "client-123", text: "oi" })
    const b = yield* runtime.send({ chatId: chat.id, clientId: "client-123", text: "oi" })
    expect(b.turnId).toBe(a.turnId)
    yield* c.done
    const msgs = yield* store.messages(chat.id)
    expect(msgs.map((m) => [m.role, m.text])).toEqual([["user", "oi"], ["assistant", "eco: oi"]])
    // per-turn metrics: start, first text and end recorded, in order
    const t = (yield* store.turnRow(a.turnId))!
    expect(t.startedAt! <= t.firstTokenAt! && t.firstTokenAt! <= t.endedAt!).toBe(true)
  })))

test("interromper guarda o texto parcial e emite interrupted", () =>
  runWith(":memory:", Hanging, Effect.gen(function* () {
    const store = yield* Store
    const runtime = yield* Runtime
    const chat = yield* store.createChat({ projectId: null, agentIds: [], model: "x/y" })
    const c = yield* collect(chat.id, (e) => e._tag === "interrupted")
    yield* runtime.send({ chatId: chat.id, clientId: "client-456", text: "oi" })
    // waits for the first text before interrupting
    while (!c.events.some((e) => e._tag === "text")) yield* Effect.sleep("10 millis")
    yield* runtime.interrupt(chat.id)
    yield* c.done
    const last = c.events.at(-1)!
    expect(last._tag).toBe("interrupted")
    const msgs = yield* store.messages(chat.id)
    expect(msgs.at(-1)).toMatchObject({ role: "assistant", text: "parte" })
    expect(msgs.at(-1)!.error).toBeTruthy()
  })))

test("kill -9 no meio do turno: na próxima subida o turno vira interrupted com o parcial", async () => {
  const dir = join(tmpdir(), `zero-rt-${crypto.randomUUID()}`)
  mkdirSync(dir)
  const path = join(dir, "zero.db")
  // First life: a turn stays `running` with partial text saved (as if the process died here).
  const chatId = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const store = yield* Store
        const chat = yield* store.createChat({ projectId: null, agentIds: [], model: "x/y" })
        const t = yield* store.enqueueTurn({ chatId: chat.id, agentId: null, model: "x/y", clientId: "client-789", depth: 0 })
        yield* store.startTurn(t.id)
        yield* store.savePartial(t.id, "meio caminho")
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
    expect(msgs.at(-1)).toMatchObject({ role: "assistant", text: "meio caminho" })
  }))
})

// Fake native-session engine: records how many sessions opened and what each turn received.
const sessionLog = { opened: [] as string[], prompts: [] as string[], interrupts: 0 }
const Sessions = Layer.succeed(Engines, {
  run: () => Stream.make<EngineEvent[]>({ type: "error", message: "should use the session" }),
  open: (o) => {
    sessionLog.opened.push(o.system)
    return {
      alive: () => true,
      close: Effect.void,
      turn: (input) => {
        sessionLog.prompts.push(input.prompt)
        if (input.prompt.includes("slow"))
          return Stream.concat(Stream.make<EngineEvent[]>({ type: "text", delta: "parte" }), Stream.never).pipe(
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
    yield* turnOnce("primeira")
    yield* turnOnce("segunda")
    expect(sessionLog.opened).toHaveLength(1)
    expect(sessionLog.prompts[0]).toContain("primeira")
    expect(sessionLog.prompts[1]).toContain("segunda")
    expect(sessionLog.prompts[1]).not.toContain("primeira") // the session already has it

    // A new user memory changes the stable context: new session, which gets the whole checkpoint.
    yield* store.addMemory({ scope: "user", text: "Prefere respostas curtas", state: "active", origin: "manual", chatId: null })
    yield* turnOnce("terceira")
    expect(sessionLog.opened).toHaveLength(2)
    expect(sessionLog.opened[1]).toContain("Prefere respostas curtas")
    expect(sessionLog.prompts[2]).toContain("primeira")
    expect(sessionLog.prompts[2]).toContain("terceira")
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
    yield* runtime.send({ chatId: chat.id, clientId: crypto.randomUUID(), text: "de novo" })
    yield* d.done
    expect(sessionLog.opened.length - before).toBe(1) // same session after the interrupt
    expect(sessionLog.prompts.at(-1)).not.toContain("slow") // the partial reply is already in the session
  })))
