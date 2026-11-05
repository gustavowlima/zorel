import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { listFolders } from "./folders.ts"

test("folders: only folders, visible first, git marked; ~ is home; a file or a relative path is refused", () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "zorel-folders-")))
  for (const d of ["zeta", "Alpha", ".config", "repo/.git"]) mkdirSync(join(home, d), { recursive: true })
  writeFileSync(join(home, "notes.txt"), "x")

  const l = listFolders("~", home)
  expect(l.dir).toBe(home)
  expect(l.folders.map((f) => f.name)).toEqual(["Alpha", "repo", "zeta", ".config"])
  expect(l.folders.find((f) => f.name === "repo")?.git).toBe(true)
  expect(listFolders("~/repo", home).folders.map((f) => f.name)).toEqual([".git"])
  expect(listFolders(undefined, home).dir).toBe(home)
  expect(listFolders(join(home, "zeta"), home).parent).toBe(home)

  expect(() => listFolders(join(home, "notes.txt"), home)).toThrow()
  expect(() => listFolders("relative/path", home)).toThrow()
  expect(() => listFolders(join(home, "nope"), home)).toThrow()
})
