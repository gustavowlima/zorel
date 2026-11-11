// Spec 015: the person's last agent can't go, and channels answer as an agent (chosen, else the one used last).
import { expect, test } from "bun:test"
import { Effect } from "effect"
import { Store } from "./db.ts"
import { keepsAnAgent } from "./main.ts"
import { channelAgent } from "./telegram.ts"

const run = <A, E>(e: Effect.Effect<A, E, Store>) => Effect.runPromise(e.pipe(Effect.provide(Store.layer(":memory:"))))

test("the last teammate can't be archived or deleted; the Builder and archived agents don't count", () =>
  run(
    Effect.gen(function* () {
      const store = yield* Store
      const a = yield* store.createAgent({ projectId: null, name: "Ana", instructions: "", model: "x/y" })
      yield* store.createAgent({ projectId: null, name: "Builder", instructions: "", model: "x/y", builtin: "builder" })
      const old = yield* store.createAgent({ projectId: null, name: "Old", instructions: "", model: "x/y" })
      yield* store.updateAgent(old.id, { archivedAt: Date.now() })
      expect((yield* keepsAnAgent(store, a.id).pipe(Effect.flip))._tag).toBe("LastAgent")
      const b = yield* store.createAgent({ projectId: null, name: "Bia", instructions: "", model: "x/y" })
      yield* keepsAnAgent(store, a.id) // another teammate exists: fine
      expect(b.id).toBeTruthy()
    })
  ))

test("a channel answers as the chosen agent, else the one used last, else the first", () =>
  run(
    Effect.gen(function* () {
      const store = yield* Store
      expect(yield* channelAgent(store, null)).toBeUndefined() // no agents: nobody
      const a = yield* store.createAgent({ projectId: null, name: "Ana", instructions: "", model: "x/y" })
      const b = yield* store.createAgent({ projectId: null, name: "Bia", instructions: "", model: "x/y" })
      expect((yield* channelAgent(store, null))?.id).toBe(a.id) // no chats yet: the first
      yield* store.createChat({ projectId: null, agentIds: [b.id], model: "x/y" })
      expect((yield* channelAgent(store, null))?.id).toBe(b.id) // the one used last
      expect((yield* channelAgent(store, a.id))?.id).toBe(a.id) // the chosen one wins
      yield* store.updateAgent(a.id, { archivedAt: Date.now() })
      expect((yield* channelAgent(store, a.id))?.id).toBe(b.id) // chosen but archived: the one used last
    })
  ))
