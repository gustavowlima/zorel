import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { discover, frontmatter, readSkill } from "./file-skills.ts"

test("frontmatter: quoted, plain and folded values", () => {
  expect(frontmatter("---\nname: a\ndescription: 'Does x: y'\n---\nbody")).toEqual({ name: "a", description: "Does x: y" })
  expect(frontmatter("---\nname: b\ndescription: >\n  first line\n  second\n---\n")).toEqual({ name: "b", description: "first line second" })
  expect(frontmatter("no frontmatter")).toEqual({})
})

test("discover: each source, plugins' newest version, a linked folder once; read drops the frontmatter", () => {
  const home = mkdtempSync(join(tmpdir(), "zero-skills-"))
  const skill = (dir: string, name: string) => {
    mkdirSync(join(dir, name), { recursive: true })
    writeFileSync(join(dir, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} help\n---\n# ${name}\nsteps`)
  }
  skill(join(home, ".agents", "skills"), "review")
  mkdirSync(join(home, ".claude", "skills"), { recursive: true })
  symlinkSync(join(home, ".agents", "skills", "review"), join(home, ".claude", "skills", "review")) // same skill, linked
  skill(join(home, ".codex", "skills"), "deploy")
  skill(join(home, ".claude", "plugins", "cache", "market", "tools", "1.0.0", "skills"), "lint")
  const found = discover(home)
  expect(found.map((s) => `${s.source}:${s.name}`).sort()).toEqual(["claude:review", "codex:deploy", "plugin:lint"])
  expect(found.find((s) => s.name === "lint")?.plugin).toBe("tools")
  expect(readSkill(found.find((s) => s.name === "deploy")!.path)).toBe("# deploy\nsteps")
})
