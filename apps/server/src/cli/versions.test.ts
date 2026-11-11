import { expect, test } from "bun:test"
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { swapIn } from "./install.ts"
import { newer, versionOf } from "./versions.ts"

test("versions read from what each CLI prints, compared part by part", () => {
  expect(versionOf("codex-cli 0.167.1")).toEqual([0, 167, 1])
  expect(versionOf("2.1.322 (Claude Code)")).toEqual([2, 1, 322])
  expect(versionOf("v1.4.10")).toEqual([1, 4, 10])
  expect(versionOf("no version")).toBeUndefined()
  expect(newer([0, 168, 0], [0, 167, 9])).toBe(true)
  expect(newer([1, 4, 10], [1, 4, 9])).toBe(true) // 10 > 9, not "10" < "9"
  expect(newer([1, 4, 9], [1, 4, 9])).toBe(false)
  expect(newer([1, 3, 99], [1, 4, 0])).toBe(false)
})

// A program that answers `--version` (or fails), as a shell script.
const program = (dir: string, name: string, body: string) => {
  const path = join(dir, name)
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
  return path
}

test.skipIf(process.platform === "win32")("an update swaps the program in, and puts the old one back when the new one doesn't start", async () => {
  const dir = mkdtempSync(join(tmpdir(), "zorel-swap-"))
  const dest = program(dir, "tool", "echo tool 1.0.0")
  expect(await swapIn(program(dir, "broken", "exit 1"), dest)).toBe(false)
  expect(readFileSync(dest, "utf8")).toContain("1.0.0") // the old one is back
  expect(await swapIn(program(dir, "good", "echo tool 1.1.0"), dest)).toBe(true)
  expect(readFileSync(dest, "utf8")).toContain("1.1.0")
})
