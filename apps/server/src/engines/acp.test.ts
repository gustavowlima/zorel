import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { commandFor, kindOf, permission, writableRoots } from "./acp.ts"

describe("acp", () => {
  test("maps ACP tool kinds to step kinds", () => {
    expect([kindOf("read"), kindOf("edit"), kindOf("move"), kindOf("execute"), kindOf("fetch"), kindOf("think")]).toEqual(["read", "edit", "edit", "run", "search", "tool"])
  })
  test("allows once unless access is ask", () => {
    const options = [{ optionId: "a", kind: "allow_always" }, { optionId: "o", kind: "allow_once" }, { optionId: "r", kind: "reject_once" }]
    expect(permission(options, "workspace")).toEqual({ outcome: { outcome: "selected", optionId: "o" } })
    expect(permission(options, "ask")).toEqual({ outcome: { outcome: "cancelled" } })
    expect(permission([{ optionId: "r", kind: "reject_once" }], "full")).toEqual({ outcome: { outcome: "cancelled" } })
  })
})

describe("acp confinement", () => {
  test("full runs as is; others are sandboxed on macOS and refused elsewhere", () => {
    const t = { args: ["acp"], access: "full" as const, cwd: "/tmp", state: [] }
    expect(commandFor("/bin/oc", t, "linux")).toEqual(["/bin/oc", "acp"])
    expect(commandFor("/bin/oc", { ...t, access: "workspace" }, "linux")).toBeUndefined()
  })
  test("the chat folder is writable only in workspace", () => {
    const cwd = mkdtempSync(join(tmpdir(), "acp-"))
    const roots = writableRoots("workspace", cwd, [".opencode-x"], "/Users/someone")
    expect(roots).toContain(realpathSync(cwd))
    expect(roots).toContain("/Users/someone/.opencode-x")
    expect(writableRoots("ask", cwd, [], "/Users/someone")).not.toContain(realpathSync(cwd))
  })
  test.skipIf(process.platform !== "darwin")("the sandbox blocks writes outside the roots", () => {
    const cwd = mkdtempSync(join(tmpdir(), "acp-"))
    const outside = mkdtempSync(join(homedir(), ".zero-acp-test-"))
    try {
      const cmd = commandFor("/bin/sh", { args: ["-c", `touch ${cwd}/in && touch ${outside}/out`], access: "workspace", cwd, state: [] })!
      const r = Bun.spawnSync(cmd)
      expect(r.exitCode).not.toBe(0)
      expect(existsSync(join(cwd, "in"))).toBe(true)
      expect(existsSync(join(outside, "out"))).toBe(false)
    } finally {
      rmSync(outside, { recursive: true })
    }
  })
})
