import { expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { commit, commitDraftPrompt, parsePorcelain, parsePrDraft, push, status, switchToNewBranch } from "./git.ts"

test("parsePorcelain reads the branch line and the files", () => {
  expect(parsePorcelain("## main...origin/main [ahead 2, behind 1]\n M a.ts\n?? b.ts\n")).toEqual({ branch: "main", upstream: "origin/main", ahead: 2, behind: 1, files: ["a.ts", "b.ts"] })
  expect(parsePorcelain("## feat/x\n")).toMatchObject({ branch: "feat/x", upstream: null, ahead: 0, files: [] })
  expect(parsePorcelain("## No commits yet on main\n")).toMatchObject({ branch: "main" })
  expect(parsePorcelain("## main...origin/main [behind 3]\n")).toMatchObject({ ahead: 0, behind: 3 })
})

test("parsePrDraft takes JSON, or falls back to the first line", () => {
  expect(parsePrDraft('```json\n{"title":"Add min","body":"Adds min()."}\n```')).toEqual({ title: "Add min", body: "Adds min()." })
  expect(parsePrDraft("# Add min\n\nAdds min().")).toEqual({ title: "Add min", body: "Adds min()." })
})

test("status, draft, commit and branch in a real repository", async () => {
  const dir = mkdtempSync(join(tmpdir(), "zero-git-"))
  expect((await status(dir)).repo).toBe(false)
  const sh = (...cmd: string[]) => Bun.spawnSync(cmd, { cwd: dir })
  sh("git", "init", "-q", "-b", "main")
  sh("git", "config", "user.email", "t@t")
  sh("git", "config", "user.name", "t")
  writeFileSync(join(dir, "a.ts"), "export const a = 1\n")
  sh("git", "add", "-A")
  sh("git", "commit", "-qm", "feat: first")
  writeFileSync(join(dir, "a.ts"), "export const a = 2\n")
  writeFileSync(join(dir, "b.ts"), "export const b = 1\n")
  const s = await status(dir)
  expect(s).toMatchObject({ repo: true, branch: "main", base: "main", remote: false, pr: null })
  expect([...s.files].sort()).toEqual(["a.ts", "b.ts"])
  const prompt = await commitDraftPrompt(dir)
  expect(prompt).toContain("feat: first") // the style to follow
  expect(prompt).toContain("new file b.ts") // untracked files are read
  expect(Bun.spawnSync(["git", "diff", "--cached", "--name-only"], { cwd: dir }).stdout.toString()).toBe("") // index untouched
  expect(await commit(dir, "feat: second")).toMatch(/^[0-9a-f]{7,}$/)
  expect((await status(dir)).files).toEqual([])
  await expect(commitDraftPrompt(dir)).rejects.toThrow("Nothing to commit")
  await switchToNewBranch(dir, "feat/x")
  expect((await status(dir)).branch).toBe("feat/x")
  await expect(switchToNewBranch(dir, "bad..name")).rejects.toThrow()
  await expect(push(dir)).rejects.toThrow() // no remote
})
