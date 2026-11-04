// Export on one data folder, import on another: the database and attachments move, paths follow, the old data stays
// as a backup, and a file that isn't an export is refused.
import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { applyPendingImport, exportWorkspace, pendingImport, stageImport } from "./transfer.ts"

const folder = (name: string, projects: string[]) => {
  const dir = mkdtempSync(join(tmpdir(), `zorel-transfer-${name}-`))
  const db = new Database(join(dir, "zorel.db"))
  db.run("CREATE TABLE projects (id TEXT, name TEXT)")
  db.run("CREATE TABLE chats (id TEXT)")
  db.run("CREATE TABLE attachments (id TEXT, path TEXT)")
  for (const p of projects) db.run("INSERT INTO projects VALUES (?, ?)", [p, p])
  mkdirSync(join(dir, "attachments", "c1"), { recursive: true })
  writeFileSync(join(dir, "attachments", "c1", "a1"), `file of ${name}`)
  db.run("INSERT INTO chats VALUES ('c1')")
  db.run("INSERT INTO attachments VALUES ('a1', ?)", [join(dir, "attachments", "c1", "a1")])
  db.close()
  return dir
}

test("a workspace moves to another data folder, keeping the one it replaces", async () => {
  const from = folder("from", ["alpha", "beta"])
  const to = folder("to", ["old"])
  const bytes = await exportWorkspace(join(from, "zorel.db"), from)
  expect(await stageImport(bytes, to)).toEqual({ projects: 2, chats: 1 })
  expect(pendingImport(to)).toBe(true)
  expect(await applyPendingImport(to, join(to, "zorel.db"))).toBe(true)
  expect(pendingImport(to)).toBe(false)
  const db = new Database(join(to, "zorel.db"), { readonly: true })
  expect((db.query("SELECT name FROM projects ORDER BY name").all() as Array<{ name: string }>).map((p) => p.name)).toEqual(["alpha", "beta"])
  const path = (db.query("SELECT path FROM attachments").get() as { path: string }).path
  db.close()
  expect(path).toBe(join(to, "attachments", "c1", "a1"))
  expect(await Bun.file(path).text()).toBe("file of from")
  const kept = readdirSync(join(to, "backups")).find((d) => d.startsWith("before-import-"))!
  expect(existsSync(join(to, "backups", kept, "zorel.db"))).toBe(true)
  expect(await Bun.file(join(to, "backups", kept, "attachments", "c1", "a1")).text()).toBe("file of to")
})

test("a file that isn't a Zorel export is refused and nothing is pending", async () => {
  const to = folder("bad", [])
  await expect(stageImport(new Uint8Array([1, 2, 3]), to)).rejects.toThrow("not a Zorel export")
  expect(pendingImport(to)).toBe(false)
})
