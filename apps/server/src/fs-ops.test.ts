import { expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createFile, inside, moveInto, osCommand, readText, renamePath, restore, trash } from "./fs-ops.ts"

const folder = () => {
  const root = mkdtempSync(join(tmpdir(), "zorel-fs-"))
  mkdirSync(join(root, "src"))
  writeFileSync(join(root, "src", "a.ts"), "a")
  writeFileSync(join(root, "b.ts"), "b")
  return root
}

test("paths can't leave the folder", () => {
  const root = folder()
  expect(() => inside(root, "../x")).toThrow()
  expect(() => inside(root, "/etc/passwd")).toThrow()
  expect(() => inside(root, "")).toThrow()
  expect(inside(root, "src/a.ts")).toBe(join(root, "src", "a.ts"))
})

test("new file (with folders), rename, move into a folder", () => {
  const root = folder()
  createFile(root, "lib/new/c.ts")
  expect(existsSync(join(root, "lib", "new", "c.ts"))).toBe(true)
  expect(() => createFile(root, "b.ts")).toThrow("already exists")
  renamePath(root, "b.ts", "bb.ts")
  expect(readFileSync(join(root, "bb.ts"), "utf8")).toBe("b")
  moveInto(root, ["bb.ts"], "src")
  expect(existsSync(join(root, "src", "bb.ts"))).toBe(true)
  expect(() => moveInto(root, ["src"], "src")).toThrow()
})

test("delete goes to the trash and undo brings it back", () => {
  const root = folder()
  const trashDir = mkdtempSync(join(tmpdir(), "zorel-trash-"))
  const id = trash(root, ["src/a.ts", "src", "b.ts"], trashDir) // a file inside a selected folder goes with it
  expect(existsSync(join(root, "src"))).toBe(false)
  restore(root, id, trashDir)
  expect(readFileSync(join(root, "src", "a.ts"), "utf8")).toBe("a")
  expect(readFileSync(join(root, "b.ts"), "utf8")).toBe("b")
})

test("the viewer reads text, not binaries", () => {
  const root = folder()
  writeFileSync(join(root, "img.bin"), new Uint8Array([137, 80, 0, 1]))
  expect(readText(root, "src/a.ts")).toEqual({ contents: "a", size: 1 })
  expect(readText(root, "img.bin").contents).toBeNull()
  expect(() => readText(root, "../x")).toThrow()
})

test("open and reveal use each system's command", () => {
  expect(osCommand("reveal", "/p/a.ts", "darwin")).toEqual(["open", "-R", "/p/a.ts"])
  expect(osCommand("reveal", "C:\\p\\a.ts", "win32")).toEqual(["explorer", "/select,C:\\p\\a.ts"])
  expect(osCommand("open", "/p/a.ts", "linux")).toEqual(["xdg-open", "/p/a.ts"])
  expect(osCommand("open", "C:\\p\\a&calc", "win32")[0]).not.toBe("cmd") // & in a name is a command separator for cmd
})
