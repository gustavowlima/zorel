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
      expect(yield* r.pendingCount([])).toBe(0) // empty list doesn't break the IN

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

  // Second open: nothing pending, no new backup.
  await run(path, (r) => r.projects())
  expect(readdirSync(join(dir, "backups"))).toHaveLength(1)
  rmSync(dir, { recursive: true })
  expect(existsSync(dir)).toBe(false)
})

test("backup: um por dia mesmo sem migration pendente, e só os 7 mais novos ficam", async () => {
  const dir = join(tmpdir(), `zero-bk-${crypto.randomUUID()}`)
  const path = join(dir, "zero.db")
  require("node:fs").mkdirSync(join(dir, "backups"), { recursive: true })
  await run(path, (r) => r.projects()) // new database: nothing to do
  // 8 old backups (over a day old): the next boot makes today's and deletes the excess
  const old = new Date(Date.now() - 3 * 24 * 60 * 60_000)
  for (let i = 0; i < 8; i++) {
    const f = join(dir, "backups", `zero-2020-01-0${i + 1}T00-00-00-000Z.db`)
    require("node:fs").writeFileSync(f, "")
    require("node:fs").utimesSync(f, old, old)
  }
  await run(path, (r) => r.projects())
  const files = readdirSync(join(dir, "backups")).sort()
  expect(files).toHaveLength(7)
  expect(files.at(-1)!.startsWith("zero-2026") || files.at(-1)! > "zero-2020-01-08").toBe(true)
  rmSync(dir, { recursive: true })
})

test("memória sobre a pessoa só o dono ouve; a do projeto, o projeto", async () => {
  const dir = join(tmpdir(), `zero-aud-${crypto.randomUUID()}`)
  const path = join(dir, "zero.db")
  require("node:fs").mkdirSync(dir)
  await run(path, (r) =>
    Effect.gen(function* () {
      yield* r.addMemory({ scope: "user", text: "Prefere Biome", state: "active", origin: "manual", chatId: null, owner: "local" })
      yield* r.addMemory({ scope: "project:p", text: "Deploy na Vercel", state: "active", origin: "manual", chatId: null })
    })
  )
  // owner/audience aren't in the public contract yet (D17 seams): check directly in the database
  const rows = new Database(path, { readonly: true }).query("SELECT scope, owner, audience FROM memories ORDER BY scope").all()
  expect(rows).toEqual([
    { scope: "project:p", owner: "local", audience: "project" },
    { scope: "user", owner: "local", audience: "owner" }
  ])
  rmSync(dir, { recursive: true })
})

test("agent versions: one per real change, with who made it; deleting the agent drops them", () =>
  run(":memory:", (r) =>
    Effect.gen(function* () {
      const a = yield* r.createAgent({ projectId: null, name: "Dev", instructions: "v1", model: "x/y" })
      yield* r.updateAgent(a.id, { instructions: "v2" }, "Lead")
      yield* r.updateAgent(a.id, { instructions: "v2" }) // no change: no version
      yield* r.updateAgent(a.id, { access: "ask" })
      const vs = yield* r.agentVersions(a.id)
      expect(vs.map((v) => [v.n, v.by, v.profile.instructions, v.profile.access])).toEqual([
        [3, "you", "v2", "ask"],
        [2, "Lead", "v2", "workspace"],
        [1, "you", "v1", "workspace"]
      ])
      yield* r.removeAgent(a.id)
      expect(yield* r.agentVersions(a.id)).toEqual([])
    })
  ))

test("resume after limit: due chats only, cleared by setting null", () =>
  run(":memory:", (r) =>
    Effect.gen(function* () {
      const a = yield* r.createChat({ projectId: null, agentIds: [], model: "x/y" })
      const b = yield* r.createChat({ projectId: null, agentIds: [], model: "x/y" })
      yield* r.setResumeAt(a.id, 1000)
      yield* r.setResumeAt(b.id, 5000)
      expect((yield* r.dueResumes(2000)).map((c) => c.id)).toEqual([a.id])
      yield* r.updateChat(a.id, { resumeAt: null })
      expect(yield* r.dueResumes(2000)).toEqual([])
      expect((yield* r.chat(b.id))!.resumeAt).toBe(5000)
    })
  ))
