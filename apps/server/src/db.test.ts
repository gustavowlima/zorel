import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { existsSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { Store } from "./db.ts"
import { LEGACY_MIGRATIONS } from "./migrate.ts"

const run = <A>(path: string, f: (r: typeof Store.Service) => Effect.Effect<A>) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () { return yield* f(yield* Store) }).pipe(Effect.provide(Store.layer(path)))))

test("memórias: dedupe por texto normalizado, busca FTS por escopo, exclui as já no prompt", () =>
  run(":memory:", (r) =>
    Effect.gen(function* () {
      const p = yield* r.createProject({ name: "Site", brief: "" })
      const a = (yield* r.addMemory({ scope: `project:${p.id}`, text: "Deploy é feito na Vercel às sextas", state: "active", origin: "manual", chatId: null }))!
      expect(yield* r.addMemory({ scope: `project:${p.id}`, text: "deploy é feito na vercel às sextas!", state: "pending", origin: "auto", chatId: null })).toBeUndefined()
      const b = (yield* r.addMemory({ scope: "user", text: "Prefere respostas curtas", state: "active", origin: "manual", chatId: null }))!
      yield* r.addMemory({ scope: "project:outro", text: "Deploy no Fly.io", state: "active", origin: "manual", chatId: null })

      const scopes = ["user", `project:${p.id}`]
      expect((yield* r.searchMemories(scopes, "como faço o deploy?", [], 5)).map((m) => m.id)).toEqual([a.id])
      expect(yield* r.searchMemories(scopes, "como faço o deploy?", [a.id], 5)).toEqual([])
      expect((yield* r.searchMemories(scopes, "respostas", [], 5)).map((m) => m.id)).toEqual([b.id])
      expect(yield* r.pendingCount([])).toBe(0) // lista vazia não quebra o IN

      yield* r.updateMemory(a.id, { text: "Deploy é feito no Netlify" })
      expect((yield* r.searchMemories(scopes, "netlify", [], 5)).map((m) => m.id)).toEqual([a.id])
      yield* r.removeProject(p.id)
      expect(yield* r.memory(a.id)).toBeUndefined()
    })
  ))

test("chats: membros em ordem e cascata ao apagar o projeto", () =>
  run(":memory:", (r) =>
    Effect.gen(function* () {
      const p = yield* r.createProject({ name: "P", brief: "" })
      const a = yield* r.createAgent({ projectId: p.id, name: "Dev", instructions: "", model: "x/y" })
      const b = yield* r.createAgent({ projectId: p.id, name: "Rev", instructions: "", model: "x/y" })
      const c = yield* r.createChat({ projectId: p.id, agentIds: [b.id, a.id, b.id], model: "x/y" })
      expect(c.agentIds).toEqual([b.id, a.id])
      yield* r.addMessage({ chatId: c.id, role: "user", agentId: null, text: "oi", model: null, error: null, steps: [], inputTokens: 0, outputTokens: 0 })
      expect((yield* r.messages(c.id)).map((m) => m.text)).toEqual(["oi"])
      yield* r.removeProject(p.id)
      expect(yield* r.chat(c.id)).toBeUndefined()
      expect(yield* r.agents()).toEqual([])
    })
  ))

test("banco do MVP (user_version 2) é adotado: backup feito, dados mantidos, migração 3 aplicada", async () => {
  const dir = join(tmpdir(), `zero-mig-${crypto.randomUUID()}`)
  const path = join(dir, "zero.db")
  require("node:fs").mkdirSync(dir)
  const old = new Database(path)
  old.transaction(() => {
    for (const s of LEGACY_MIGRATIONS.slice(0, 2)) old.run(s)
    old.run("PRAGMA user_version = 2")
  })()
  old.run("INSERT INTO projects VALUES ('p', 'P', '', 1)")
  old.run("INSERT INTO agents VALUES ('a', 'p', 'Dev', '', 'x/y', 1)")
  old.run("INSERT INTO chats (id, project_id, agent_id, title, model, created_at) VALUES ('c', 'p', 'a', 'T', 'x/y', 1)")
  old.run("INSERT INTO memories (id, scope, text, normalized, state, origin, created_at, confirmed_at) VALUES ('m', 'user', 'Gosta de deploy às sextas', 'x', 'active', 'manual', 1, 1)")
  old.close()

  await run(path, (r) =>
    Effect.gen(function* () {
      expect((yield* r.chat("c"))!.agentIds).toEqual(["a"])
      expect(yield* r.memory("m")).toMatchObject({ kind: "fact", title: "" })
      expect((yield* r.searchMemories(["user"], "deploy", [], 5)).map((m) => m.id)).toEqual(["m"])
    })
  )
  const backups = readdirSync(join(dir, "backups"))
  expect(backups).toHaveLength(1)
  expect(new Database(join(dir, "backups", backups[0]!)).query("SELECT count(*) AS n FROM chats").get()).toEqual({ n: 1 })

  // Segunda abertura: nada pendente, nenhum backup novo.
  await run(path, (r) => r.projects())
  expect(readdirSync(join(dir, "backups"))).toHaveLength(1)
  rmSync(dir, { recursive: true })
  expect(existsSync(dir)).toBe(false)
})
