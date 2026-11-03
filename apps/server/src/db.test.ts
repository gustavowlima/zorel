import { expect, test } from "bun:test"
import { open, repository } from "./db.ts"

test("memórias: dedupe por texto normalizado, busca FTS por escopo, exclui as já no prompt", () => {
  const r = repository(open(":memory:"))
  const p = r.createProject({ name: "Site", brief: "" })
  const a = r.addMemory({ scope: `project:${p.id}`, text: "Deploy é feito na Vercel às sextas", state: "active", origin: "manual", chatId: null })!
  expect(r.addMemory({ scope: `project:${p.id}`, text: "deploy é feito na vercel às sextas!", state: "pending", origin: "auto", chatId: null })).toBeUndefined()
  const b = r.addMemory({ scope: "user", text: "Prefere respostas curtas", state: "active", origin: "manual", chatId: null })!
  r.addMemory({ scope: "project:outro", text: "Deploy no Fly.io", state: "active", origin: "manual", chatId: null })

  const scopes = ["user", `project:${p.id}`]
  expect(r.searchMemories(scopes, "como faço o deploy?", [], 5).map((m) => m.id)).toEqual([a.id])
  expect(r.searchMemories(scopes, "como faço o deploy?", [a.id], 5)).toEqual([])
  expect(r.searchMemories(scopes, "respostas", [], 5).map((m) => m.id)).toEqual([b.id])

  r.updateMemory(a.id, { text: "Deploy é feito no Netlify" })
  expect(r.searchMemories(scopes, "netlify", [], 5).map((m) => m.id)).toEqual([a.id])
  r.removeProject(p.id)
  expect(r.memory(a.id)).toBeUndefined()
})

test("migração 2 → 3: agente do chat vira membro, memórias entram no índice novo", () => {
  const { Database } = require("bun:sqlite")
  const { MIGRATIONS } = require("./db.ts")
  const path = `${require("node:os").tmpdir()}/zero-mig-${crypto.randomUUID()}.db`
  const old = new Database(path)
  old.transaction(() => {
    for (const s of MIGRATIONS.slice(0, 2)) old.run(s)
    old.run("PRAGMA user_version = 2")
  })()
  old.run("INSERT INTO projects VALUES ('p', 'P', '', 1)")
  old.run("INSERT INTO agents VALUES ('a', 'p', 'Dev', '', 'x/y', 1)")
  old.run("INSERT INTO chats (id, project_id, agent_id, title, model, created_at) VALUES ('c', 'p', 'a', 'T', 'x/y', 1)")
  old.run("INSERT INTO memories (id, scope, text, normalized, state, origin, created_at, confirmed_at) VALUES ('m', 'user', 'Gosta de deploy às sextas', 'x', 'active', 'manual', 1, 1)")
  old.close()

  const r = repository(open(path))
  expect(r.chat("c")!.agentIds).toEqual(["a"])
  expect(r.memory("m")).toMatchObject({ kind: "fact", title: "" })
  expect(r.searchMemories(["user"], "deploy", [], 5).map((m) => m.id)).toEqual(["m"])
})
