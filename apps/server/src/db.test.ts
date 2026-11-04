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

test("memories: dedupe by normalized text, FTS search by scope, excludes those already in the prompt", () =>
  run(":memory:", (r) =>
    Effect.gen(function* () {
      const p = yield* r.createProject({ name: "Site", brief: "" })
      const a = (yield* r.addMemory({ scope: `project:${p.id}`, text: "Deploys go to Vercel on Fridays", state: "active", origin: "manual", chatId: null }))!
      expect(yield* r.addMemory({ scope: `project:${p.id}`, text: "deploys go to vercel on fridays!", state: "pending", origin: "auto", chatId: null })).toBeUndefined()
      const b = (yield* r.addMemory({ scope: "user", text: "Prefers short answers", state: "active", origin: "manual", chatId: null }))!
      yield* r.addMemory({ scope: "project:other", text: "Deploys on Fly.io", state: "active", origin: "manual", chatId: null })

      const scopes = ["user", `project:${p.id}`]
      expect((yield* r.searchMemories(scopes, "how do I deploy?", [], 5)).map((m) => m.id)).toEqual([a.id])
      expect(yield* r.searchMemories(scopes, "how do I deploy?", [a.id], 5)).toEqual([])
      expect((yield* r.searchMemories(scopes, "answers", [], 5)).map((m) => m.id)).toEqual([b.id])
      expect(yield* r.pendingCount([])).toBe(0) // empty list doesn't break the IN

      yield* r.updateMemory(a.id, { text: "Deploys go to Netlify" })
      expect((yield* r.searchMemories(scopes, "netlify", [], 5)).map((m) => m.id)).toEqual([a.id])
      yield* r.removeProject(p.id)
      expect(yield* r.memory(a.id)).toBeUndefined()
    })
  ))

test("chats: members in order, and cascade when the project is deleted", () =>
  run(":memory:", (r) =>
    Effect.gen(function* () {
      const p = yield* r.createProject({ name: "P", brief: "" })
      const a = yield* r.createAgent({ projectId: p.id, name: "Dev", instructions: "", model: "x/y" })
      const b = yield* r.createAgent({ projectId: p.id, name: "Rev", instructions: "", model: "x/y" })
      const c = yield* r.createChat({ projectId: p.id, agentIds: [b.id, a.id, b.id], model: "x/y" })
      expect(c.agentIds).toEqual([b.id, a.id])
      yield* r.addMessage({ chatId: c.id, role: "user", agentId: null, text: "hi", model: null, error: null, steps: [], inputTokens: 0, outputTokens: 0 })
      expect((yield* r.messages(c.id)).map((m) => m.text)).toEqual(["hi"])
      yield* r.removeProject(p.id)
      expect(yield* r.chat(c.id)).toBeUndefined()
      expect(yield* r.agents()).toEqual([])
    })
  ))

test("the MVP database (user_version 2) is adopted: backup made, data kept, migration 3 applied", async () => {
  const dir = join(tmpdir(), `zorel-mig-${crypto.randomUUID()}`)
  const path = join(dir, "zorel.db")
  require("node:fs").mkdirSync(dir)
  const old = new Database(path)
  old.transaction(() => {
    for (const s of LEGACY_MIGRATIONS.slice(0, 2)) old.run(s)
    old.run("PRAGMA user_version = 2")
  })()
  old.run("INSERT INTO projects VALUES ('p', 'P', '', 1)")
  old.run("INSERT INTO agents VALUES ('a', 'p', 'Dev', '', 'x/y', 1)")
  old.run("INSERT INTO chats (id, project_id, agent_id, title, model, created_at) VALUES ('c', 'p', 'a', 'T', 'x/y', 1)")
  old.run("INSERT INTO memories (id, scope, text, normalized, state, origin, created_at, confirmed_at) VALUES ('m', 'user', 'Likes to deploy on Fridays', 'x', 'active', 'manual', 1, 1)")
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

test("backup: one a day even with no pending migration, and only the 7 newest stay", async () => {
  const dir = join(tmpdir(), `zorel-bk-${crypto.randomUUID()}`)
  const path = join(dir, "zorel.db")
  require("node:fs").mkdirSync(join(dir, "backups"), { recursive: true })
  await run(path, (r) => r.projects()) // new database: nothing to do
  // 8 old backups (over a day old): the next boot makes today's and deletes the excess
  const old = new Date(Date.now() - 3 * 24 * 60 * 60_000)
  for (let i = 0; i < 8; i++) {
    const f = join(dir, "backups", `zorel-2020-01-0${i + 1}T00-00-00-000Z.db`)
    require("node:fs").writeFileSync(f, "")
    require("node:fs").utimesSync(f, old, old)
  }
  await run(path, (r) => r.projects())
  const files = readdirSync(join(dir, "backups")).sort()
  expect(files).toHaveLength(7)
  expect(files.at(-1)!.startsWith("zorel-2026") || files.at(-1)! > "zorel-2020-01-08").toBe(true)
  rmSync(dir, { recursive: true })
})

test("a memory about the person only reaches its owner; a project's, the project", async () => {
  const dir = join(tmpdir(), `zorel-aud-${crypto.randomUUID()}`)
  const path = join(dir, "zorel.db")
  require("node:fs").mkdirSync(dir)
  await run(path, (r) =>
    Effect.gen(function* () {
      yield* r.addMemory({ scope: "user", text: "Prefers Biome", state: "active", origin: "manual", chatId: null, owner: "local" })
      yield* r.addMemory({ scope: "project:p", text: "Deploy on Vercel", state: "active", origin: "manual", chatId: null })
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

test("searchMessages: case-insensitive words, newest first, % and _ are literal", () =>
  run(":memory:", (r) =>
    Effect.gen(function* () {
      const c = yield* r.createChat({ projectId: null, agentIds: [], model: "x/y" })
      const add = (text: string) => r.addMessage({ chatId: c.id, role: "user", agentId: null, text, model: null, error: null, steps: [], inputTokens: 0, outputTokens: 0 })
      yield* add("Deploy on Vercel")
      yield* add("the deploy failed with 100% errors")
      yield* add("unrelated")
      expect((yield* r.searchMessages("DEPLOY")).map((m) => m.text)).toEqual(["the deploy failed with 100% errors", "Deploy on Vercel"])
      expect((yield* r.searchMessages("100%")).length).toBe(1)
      expect(yield* r.searchMessages("_")).toEqual([])
    })
  ))

test("pages: every edit a version; search by words in scopes; pinned titles", () =>
  run(":memory:", (r) =>
    Effect.gen(function* () {
      const a = yield* r.savePage({ scope: "project:p1", title: "Deploy", body: "We deploy on Vercel on Fridays." })
      yield* r.savePage({ id: a.id, scope: a.scope, title: "Deploy", body: "We deploy on Fly.io now." }, "Dev")
      yield* r.savePage({ id: a.id, scope: a.scope, title: "Deploy", body: "We deploy on Fly.io now." }) // no change: no version
      yield* r.savePage({ scope: "project:p2", title: "Other", body: "deploy elsewhere" })
      expect((yield* r.pageVersions(a.id)).map((v) => [v.n, v.by])).toEqual([[2, "Dev"], [1, "you"]])
      expect((yield* r.searchPages(["user", "project:p1"], "fly", 5)).map((p) => p.id)).toEqual([a.id])
      expect(yield* r.searchPages(["project:p1"], "vercel", 5)).toEqual([]) // the old text is only in versions
      expect(yield* r.pinnedPages(["project:p1"])).toEqual([])
      yield* r.pinPage(a.id, true)
      expect((yield* r.pinnedPages(["project:p1"])).map((p) => p.title)).toEqual(["Deploy"])
    })
  ))
