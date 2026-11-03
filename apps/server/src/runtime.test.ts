// Critérios da fase 1 (ARCHITECTURE §13): reenvio não duplica, interromper guarda o parcial,
// kill -9 no meio de um turno vira `interrupted` com o texto parcial na próxima subida.
import { expect, test } from "bun:test"
import type { ChatEvent } from "@zero/contracts/events"
import { Deferred, Effect, Fiber, Layer, Stream } from "effect"
import { mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DataDir } from "./chat.ts"
import { Store } from "./db.ts"
import { Engines, type EngineEvent } from "./engines.ts"
import { Runtime } from "./runtime.ts"
import { Secrets } from "./secrets.ts"
import { Tools } from "./tools.ts"

// Engine que manda "parte" e depois fica pendurado: dá tempo de interromper.
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

// Coleta eventos do chat até `until` dizer que basta.
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
  })))

test("interromper guarda o texto parcial e emite interrupted", () =>
  runWith(":memory:", Hanging, Effect.gen(function* () {
    const store = yield* Store
    const runtime = yield* Runtime
    const chat = yield* store.createChat({ projectId: null, agentIds: [], model: "x/y" })
    const c = yield* collect(chat.id, (e) => e._tag === "interrupted")
    yield* runtime.send({ chatId: chat.id, clientId: "client-456", text: "oi" })
    // espera o primeiro texto chegar antes de interromper
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
  // Primeira vida: um turno fica `running` com texto parcial gravado (como se o processo morresse aqui).
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
  // Segunda vida: o runtime sobe e recupera.
  await runWith(path, Echo, Effect.gen(function* () {
    const store = yield* Store
    expect(yield* store.turnsIn("running")).toEqual([])
    const [turn] = yield* store.turnsIn("interrupted")
    expect(turn!.error).toBe("server restarted")
    const msgs = yield* store.messages(chatId)
    expect(msgs.at(-1)).toMatchObject({ role: "assistant", text: "meio caminho" })
  }))
})
