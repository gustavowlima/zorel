import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { canonical, sameName, Store, twins } from "./db.ts"
import { LEGACY_MIGRATIONS } from "./migrate.ts"
import { recall } from "./chat.ts"
import { mappedOf } from "./context.ts"

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

test("memories: the same fact in other small words confirms the existing one; another meaning, owner or scope stays apart", () =>
  run(":memory:", (r) =>
    Effect.gen(function* () {
      const add = (text: string, scope = "project:p", extra: { owner?: string } = {}) => r.addMemory({ scope, text, state: "active", origin: "auto", chatId: null, ...extra })
      // Merged: dropped article, plural, third-person rewrite.
      expect(yield* add("The API runs on port 8080")).toBeDefined()
      expect(yield* add("API runs on port 8080")).toBeUndefined()
      expect(yield* add("Deploys happen on Fridays")).toBeDefined()
      expect(yield* add("Deploys happen on Friday")).toBeUndefined()
      expect(yield* add("Uses Neovim as the editor", "user")).toBeDefined()
      expect(yield* add("The user uses Neovim as their editor", "user")).toBeUndefined()
      // Kept apart: reversed order, a negation, another number, another owner, another scope.
      expect(yield* add("Prefers TypeScript over JavaScript")).toBeDefined()
      expect(yield* add("Prefers JavaScript over TypeScript")).toBeDefined()
      expect(yield* add("Never deploys happen on Fridays")).toBeDefined()
      expect(yield* add("The API runs on port 8081")).toBeDefined()
      expect(yield* add("The user uses Neovim as their editor", "user", { owner: "bob" })).toBeDefined()
      expect(yield* add("API runs on port 8080", "project:q")).toBeDefined()
      // A forgotten fact is not "the same" as a new one.
      const old = (yield* add("Likes emojis", "user"))!
      yield* r.updateMemory(old.id, { state: "forgotten" })
      expect(yield* add("Likes the emojis", "user")).toBeDefined()
      expect(canonical("The user uses Neovim as their editor")).toBe(canonical("Uses Neovim as the editor"))
    })
  ))

test("memories: another owner's notes about themselves never reach this one; keywords find other wordings", () =>
  run(":memory:", (r) =>
    Effect.gen(function* () {
      const mine = (yield* r.addMemory({ scope: "user", text: "Lives in Berlin", keywords: "city home address relocated", state: "active", origin: "auto", chatId: null }))!
      yield* r.addMemory({ scope: "user", text: "Bob's canary note", state: "active", origin: "manual", chatId: null, owner: "bob" })
      yield* r.addMemory({ scope: "user", text: "Bob is waiting", state: "pending", origin: "auto", chatId: null, owner: "bob" })
      expect((yield* r.activeMemories(["user"])).map((m) => m.text)).toEqual(["Lives in Berlin"])
      expect(yield* r.searchMemories(["user"], "canary", [], 5)).toEqual([])
      expect(yield* r.pendingCount(["user"])).toBe(0)
      expect((yield* r.activeMemories(["user"], "fact", "bob")).map((m) => m.text)).toEqual(["Bob's canary note"])
      // A question in other words: the keywords hold "address", the text doesn't.
      expect((yield* r.searchMemories(["user"], "what's my address?", [], 5)).map((m) => m.id)).toEqual([mine.id])
      // Marked essential: it says so, and keeps its keywords out of the contract.
      const marked = (yield* r.updateMemory(mine.id, { essential: true }))!
      expect(marked.essential).toBe(true)
      expect("keywords" in marked).toBe(false)
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

test("chat access: null by default, set on create or by patch, cleared with null, untouched by other patches", () =>
  run(":memory:", (r) =>
    Effect.gen(function* () {
      const a = yield* r.createChat({ projectId: null, agentIds: [], model: "x/y" })
      expect(a.access).toBeNull() // each agent's own level
      const b = yield* r.createChat({ projectId: null, agentIds: [], model: "x/y", access: "ask" })
      expect(b.access).toBe("ask")
      expect((yield* r.updateChat(a.id, { access: "full" }))!.access).toBe("full")
      expect((yield* r.updateChat(a.id, { title: "renamed" }))!.access).toBe("full") // another patch leaves it
      expect((yield* r.updateChat(a.id, { access: null }))!.access).toBeNull() // back to the agents' own
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

test("skills by agent: search and lists hide what's limited to other agents; an agent's own scope and the unlimited ones stay", () =>
  run(":memory:", (r) =>
    Effect.gen(function* () {
      const p = yield* r.createProject({ name: "Site", brief: "" })
      const scope = `project:${p.id}`
      const some = (title: string, agents: string[], s = scope) => r.addMemory({ scope: s, kind: "skill", title, text: `${title} steps for deploy`, state: "active", origin: "manual", chatId: null, agents })
      yield* some("Rev deploy", ["rev"])
      yield* some("Shared deploy", [])
      yield* some("Own deploy", ["other"], "agent:dev") // the agent scope isn't limited by the list
      const titles = (xs: ReadonlyArray<{ title: string }>) => xs.map((m) => m.title).sort()
      const scopes = [scope, "agent:dev"]
      expect(titles(yield* r.activeMemories(scopes, "skill", undefined, "rev"))).toEqual(["Own deploy", "Rev deploy", "Shared deploy"])
      expect(titles(yield* r.activeMemories(scopes, "skill", undefined, "dev"))).toEqual(["Own deploy", "Shared deploy"])
      expect(titles(yield* r.activeMemories(scopes, "skill", undefined, null))).toEqual(["Own deploy", "Shared deploy"])
      expect(titles(yield* r.activeMemories(scopes, "skill"))).toEqual(["Own deploy", "Rev deploy", "Shared deploy"]) // no agent given: unfiltered
      expect(titles(yield* r.searchMemories(scopes, "deploy", [], 10, "skill", undefined, "dev"))).toEqual(["Own deploy", "Shared deploy"])
      expect(titles(yield* r.searchMemories(scopes, "deploy", [], 10, "skill", undefined, "rev"))).toEqual(["Own deploy", "Rev deploy", "Shared deploy"])
      // only a skill can be limited
      const fact = (yield* r.addMemory({ scope, text: "A fact", state: "active", origin: "manual", chatId: null, agents: ["rev"] }))!
      expect(fact.agents).toEqual([])
      // editing the list
      const rev = (yield* r.activeMemories([scope], "skill")).find((m) => m.title === "Rev deploy")!
      yield* r.updateMemory(rev.id, { agents: [] })
      expect(titles(yield* r.activeMemories([scope], "skill", undefined, "dev"))).toEqual(["Rev deploy", "Shared deploy"])
    })
  ))

// Pages as Markdown files: the folder is the truth, the rows index it.
const runWithPages = <A>(dir: string, f: (r: typeof Store.Service) => Effect.Effect<A>) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () { return yield* f(yield* Store) }).pipe(Effect.provide(Store.layer(":memory:", dir)))))

test("pages as files: written, renamed, pinned and removed through Zorel; edits, new files and deletes from outside come back", () => {
  const dir = mkdtempSync(join(tmpdir(), "zorel-pages-"))
  const at = (f: string) => join(dir, ...f.split("/"))
  return runWithPages(dir, (r) =>
    Effect.gen(function* () {
      const p = yield* r.createProject({ name: "Zorel App", brief: "" })
      const scope = `project:${p.id}`
      const a = yield* r.savePage({ scope, title: "Deploy runbook", body: "1. bun test" })
      expect(a.file).toBe("projects/zorel-app/Deploy runbook.md")
      expect(readFileSync(at(a.file!), "utf8")).toBe(`---\nid: ${a.id}\nscope: ${scope}\npinned: false\n---\n1. bun test\n`)

      // Renamed: the file follows; a name that can't be a file name keeps the title in the front matter.
      const b = yield* r.savePage({ id: a.id, scope, title: "Deploy: prod/staging", body: "1. bun test" })
      expect(b.file).toBe("projects/zorel-app/Deploy prod staging.md")
      expect(existsSync(at(a.file!))).toBe(false)
      expect(readFileSync(at(b.file!), "utf8")).toContain('title: "Deploy: prod/staging"')
      yield* r.pinPage(a.id, true)
      expect(readFileSync(at(b.file!), "utf8")).toContain("pinned: true")
      expect(yield* r.syncPages(true)).toEqual({ imported: 0, updated: 0, written: 0, removed: 0 }) // our own writes: nothing to do

      // Edited in an editor: the page takes it, as a version by "outside".
      writeFileSync(at(b.file!), readFileSync(at(b.file!), "utf8").replace("1. bun test", "1. bun test\n2. tag"))
      expect((yield* r.syncPages(true)).updated).toBe(1)
      expect((yield* r.page(a.id))!.body).toBe("1. bun test\n2. tag")
      expect((yield* r.pageVersions(a.id))[0]!.by).toBe("outside")

      // A new file in you/: a page about the user, with an id and scope written into it.
      mkdirSync(at("you"), { recursive: true })
      writeFileSync(at("you/Writing style.md"), "Short sentences.")
      expect((yield* r.syncPages(true)).imported).toBe(1)
      const style = (yield* r.pages()).find((x) => x.title === "Writing style")!
      expect(style).toMatchObject({ scope: "user", body: "Short sentences." })
      expect(readFileSync(at("you/Writing style.md"), "utf8")).toContain(`id: ${style.id}`)

      // Moved and renamed outside: still the same page (its id), at its new place.
      mkdirSync(at("projects/zorel-app/ops"), { recursive: true })
      renameSync(at(b.file!), at("projects/zorel-app/ops/Release.md"))
      yield* r.syncPages(true)
      expect((yield* r.page(a.id))).toMatchObject({ title: "Deploy: prod/staging", file: "projects/zorel-app/ops/Release.md" })

      // Deleted while watched: the page goes. At start, a missing file is written again instead.
      rmSync(at("you/Writing style.md"))
      expect((yield* r.syncPages(false)).written).toBe(1)
      expect(existsSync(at("you/Writing style.md"))).toBe(true)
      rmSync(at("you/Writing style.md"))
      expect((yield* r.syncPages(true)).removed).toBe(1)
      expect(yield* r.page(style.id)).toBeUndefined()

      // Removing the project removes its pages' files.
      yield* r.removeProject(p.id)
      expect(existsSync(at("projects/zorel-app/ops/Release.md"))).toBe(false)
    })
  ).finally(() => rmSync(dir, { recursive: true, force: true }))
})

test("memory map: a fact's entities are found by name, alias or close spelling; a project's facts hang off its point; forgotten facts leave the map", () =>
  run(":memory:", (r) =>
    Effect.gen(function* () {
      const p = yield* r.createProject({ name: "Zorel", brief: "" })
      const scope = `project:${p.id}`
      const known = [{ id: p.id, name: "Zorel", type: "project" as const }]
      const add = (text: string, state: "active" | "pending" = "active") => Effect.map(r.addMemory({ scope, text, state, origin: "auto", chatId: null }), (m) => m!)
      const a = yield* add("Deploys go to Vercel on Fridays")
      yield* r.linkMemory(a.id, scope, { entities: [{ name: "Deploy", type: "subject" }, { name: "Vercel", type: "concept" }], relations: [["Deploy", "goes to", "Vercel"]] }, known)
      const b = yield* add("Previews run on vercel.com for every PR", "pending")
      yield* r.linkMemory(b.id, scope, { entities: [{ name: "vercel.com", type: "concept" }, { name: "Previews", type: "subject" }], relations: [] }, known)
      const c = yield* add("The landing copy is short")
      yield* r.linkMemory(c.id, "user", { entities: [{ name: "Vercel", type: "concept" }], relations: [] }) // another scope: its own Vercel

      const map = yield* r.entitiesIn([scope])
      const byName = (n: string) => map.find((e) => e.name === n)!
      expect(map.map((e) => e.name).sort()).toEqual(["Deploy", "Previews", "Vercel", "Zorel"])
      expect(byName("Zorel")).toMatchObject({ type: "project", facts: 2 }) // the project's point holds both facts
      expect(byName("Vercel")).toMatchObject({ type: "concept", facts: 2, weight: 2 }) // "vercel.com" is the same Vercel
      expect(byName("Previews").pending).toBe(1) // only a pending fact mentions it
      expect((yield* r.entitiesIn(["user"])).map((e) => e.name)).toEqual(["Vercel"]) // maps don't mix

      yield* r.updateMemory(b.id, { state: "forgotten" })
      expect((yield* r.entitiesIn([scope])).map((e) => e.name).sort()).toEqual(["Deploy", "Vercel", "Zorel"])
    })
  ))

test("same name: one spelling holds the other whole, or most letter pairs match; short names must be equal", () => {
  expect(sameName("vercel", "vercel com")).toBe(true)
  expect(sameName("postgres", "postgresql")).toBe(true) // Dice on letter pairs
  expect(sameName("deploy", "deployment")).toBe(false) // not a whole word inside, too few shared pairs
  expect(sameName("ai", "ai sdk")).toBe(false) // short: exact only
})

test("recall by association finds a fact its words don't (the measure for A2): deploy → Vercel → its build rule", () =>
  run(":memory:", (r) =>
    Effect.gen(function* () {
      const p = yield* r.createProject({ name: "Shop", brief: "" })
      const scope = `project:${p.id}`
      const fact = (text: string, entities: string[], relations: Array<[string, string, string]> = []) =>
        Effect.gen(function* () {
          const m = (yield* r.addMemory({ scope, text, state: "active", origin: "manual", chatId: null }))!
          yield* r.linkMemory(m.id, scope, { entities: entities.map((name) => ({ name, type: "concept" as const })), relations }, [])
          return m
        })
      const deploy = yield* fact("Deploys go to Vercel on Fridays", ["Deploy", "Vercel"], [["Deploy", "goes to", "Vercel"]])
      const build = yield* fact("Builds need NODE_VERSION 22 set in the dashboard", ["Vercel", "Node"]) // never says "deploy"
      yield* fact("Lunch is at noon", ["Lunch"])
      const query = "how do we deploy?"
      const byWords = (yield* r.searchMemories([scope], query, [], 5)).map((m) => m.id)
      expect(byWords).toContain(deploy.id)
      expect(byWords).not.toContain(build.id) // its words don't match
      const recalled = (yield* recall(r, [scope], query, [])).map((m) => m.text)
      expect(recalled).toContain("Builds need NODE_VERSION 22 set in the dashboard") // association does
      expect(recalled).not.toContain("Lunch is at noon")
    })
  ))

test("aliases and categories let a question in other words reach the fact (paraphrase without embeddings)", () =>
  run(":memory:", (r) =>
    Effect.gen(function* () {
      const m = (yield* r.addMemory({ scope: "user", text: "Drinks green tea in the morning", state: "active", origin: "auto", chatId: null }))!
      yield* r.linkMemory(m.id, "user", mappedOf([{ name: "Green tea", type: "concept", aliases: ["chá verde"], category: "Beverage" }], []))
      expect((yield* r.searchMemories(["user"], "which hot beverage do I like?", [], 5)).length).toBe(0) // its words don't match
      expect((yield* recall(r, ["user"], "which hot beverage do I like?", [])).map((x) => x.id)).toEqual([m.id]) // its category does
      expect((yield* recall(r, ["user"], "quero um chá verde?", [])).map((x) => x.id)).toEqual([m.id]) // and its other name
    })
  ))

test("a bridge between two projects' points: on both maps, and recall crosses it to that point's own facts only", () =>
  run(":memory:", (r) =>
    Effect.gen(function* () {
      const add = (scope: string, text: string, ents: Array<{ name: string; type: "concept" | "subject" }>, rels: Array<[string, string, string]> = []) =>
        Effect.gen(function* () {
          const m = (yield* r.addMemory({ scope, text, state: "active", origin: "auto", chatId: null }))!
          yield* r.linkMemory(m.id, scope, mappedOf(ents, rels))
          return m
        })
      yield* add("project:a", "Billing runs on Stripe", [{ name: "Billing", type: "subject" }, { name: "Stripe", type: "concept" }], [["Billing", "runs on", "Stripe"]])
      const webhooks = yield* add("project:b", "Stripe webhooks need the signing secret", [{ name: "Stripe", type: "concept" }, { name: "Webhooks", type: "concept" }])
      const unrelated = yield* add("project:b", "Webhooks retry three times", [{ name: "Webhooks", type: "concept" }, { name: "Retry", type: "concept" }])
      const pointIn = (scope: string) => Effect.map(r.entitiesIn([scope]), (es) => es.find((e) => e.name === "Stripe")!.id)
      const [a, b] = [yield* pointIn("project:a"), yield* pointIn("project:b")]
      const before = (yield* recall(r, ["user", "project:a"], "how is billing set up?", [])).map((m) => m.id)
      expect(before).not.toContain(webhooks.id)
      yield* r.connectEntities(b, a)
      expect((yield* r.bridgesOf([a])).others.map((o) => o.id)).toEqual([b])
      const after = (yield* recall(r, ["user", "project:a"], "how is billing set up?", [])).map((m) => m.id)
      expect(after).toContain(webhooks.id) // the other side's point's own fact
      expect(after).not.toContain(unrelated.id) // not the rest of that project's map
      yield* r.disconnectEntities(a, b)
      expect((yield* r.bridgesOf([a])).links).toEqual([])
      yield* r.connectEntities(a, b)
      const project = yield* r.createProject({ name: "B", brief: "" })
      yield* r.linkMemory(webhooks.id, `project:${project.id}`, mappedOf([{ name: "Gone", type: "concept" }], []))
      expect((yield* r.entitiesIn([`project:${project.id}`])).length).toBe(1)
      yield* r.removeProject(project.id)
      expect((yield* r.entitiesIn([`project:${project.id}`])).length).toBe(0) // a removed project takes its map along
    })
  ))

test("the map's sleep: orphan points go, twins of one map merge (facts, relations, bridges)", () =>
  run(":memory:", (r) =>
    Effect.gen(function* () {
      const add = (scope: string, text: string, ents: Array<{ name: string; type: "concept" | "subject"; aliases?: string[] }>, rels: Array<[string, string, string]> = []) =>
        Effect.gen(function* () {
          const m = (yield* r.addMemory({ scope, text, state: "active", origin: "auto", chatId: null }))!
          yield* r.linkMemory(m.id, scope, mappedOf(ents, rels))
          return m
        })
      const names = (scope: string) => Effect.map(r.entitiesIn([scope]), (es) => es.map((e) => e.name).sort())
      // "PG" is its own point until a later fact calls Postgres "pg": then they're twins.
      const first = yield* add("project:a", "PG needs the token", [{ name: "PG", type: "concept" }, { name: "Token", type: "concept" }], [["PG", "needs", "Token"]])
      yield* add("project:a", "Data lives in Postgres", [{ name: "Postgres", type: "concept", aliases: ["pg"] }, { name: "Data", type: "subject" }], [["Data", "lives in", "Postgres"]])
      yield* add("project:a", "Postgres runs on Fridays backups", [{ name: "Postgres", type: "concept" }])
      const other = yield* add("project:b", "Releases go out on deploy day", [{ name: "Release", type: "concept" }])
      const pg = (yield* r.entitiesIn(["project:a"])).find((e) => e.name === "PG")!.id
      yield* r.connectEntities(pg, (yield* r.entitiesIn(["project:b"]))[0]!.id)
      yield* add("project:c", "Stays", [{ name: "Kept", type: "concept" }])
      const kept = (yield* r.entitiesIn(["project:c"]))[0]!.id
      yield* r.connectEntities(pg, kept)
      yield* r.removeMemory(other.id) // its point is left with no fact
      expect(yield* r.sleepMap()).toEqual({ removed: 1, merged: 1 })
      expect(yield* names("project:a")).toEqual(["Data", "Postgres", "Token"])
      expect(yield* names("project:b")).toEqual([])
      const map = yield* r.entitiesIn(["project:a"])
      const postgres = map.find((e) => e.name === "Postgres")!
      expect(postgres.memory_ids.split(",")).toContain(first.id) // the twin's fact moved over
      expect((yield* r.linksAmong(map.map((e) => e.id))).map((l) => l.rel)).toContain("needs") // and its relation
      expect((yield* r.bridgesOf([postgres.id])).others.map((o) => o.id)).toEqual([kept]) // and its bridge
      expect(yield* r.sleepMap()).toEqual({ removed: 0, merged: 0 })
    })
  ))

test("twins: another name or a plural or a close spelling, not a longer name holding it", () => {
  const p = (normalized: string, aliases: string[] = []) => ({ normalized, aliases })
  expect(twins(p("postgres", ["pg"]), p("pg"))).toBe(true)
  expect(twins(p("deploys"), p("deploy"))).toBe(true)
  expect(twins(p("kubernetes"), p("kubernets"))).toBe(true)
  expect(twins(p("memory"), p("memory map"))).toBe(false)
  expect(twins(p("bus"), p("bu"))).toBe(false)
})
