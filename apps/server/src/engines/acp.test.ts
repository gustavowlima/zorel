import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { commandFor, kindOf, opencodeEnv, permission, writableRoots } from "./acp.ts"

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
  test("full runs as is; others run in bubblewrap on Linux, and are refused where there's no sandbox", () => {
    const t = { args: ["acp"], access: "full" as const, cwd: "/tmp", state: [] }
    expect(commandFor("/bin/oc", t, "linux", null)).toEqual(["/bin/oc", "acp"])
    expect(commandFor("/bin/oc", { ...t, access: "workspace" }, "linux", null)).toBeUndefined() // bwrap not installed
    expect(commandFor("/bin/oc", { ...t, access: "workspace" }, "win32", null)).toBeUndefined()
    const linux = commandFor("/bin/oc", { ...t, access: "workspace" }, "linux", "/usr/bin/bwrap")!
    expect(linux.slice(0, 5)).toEqual(["/usr/bin/bwrap", "--ro-bind", "/", "/", "--dev"])
    expect(linux.slice(-3)).toEqual(["--", "/bin/oc", "acp"])
  })
  test("the chat folder is writable only in workspace", () => {
    const cwd = mkdtempSync(join(tmpdir(), "acp-"))
    const roots = writableRoots("workspace", cwd, [".opencode-x"], "/Users/someone")
    expect(roots).toContain(realpathSync(cwd))
    expect(roots).toContain("/Users/someone/.opencode-x")
    expect(writableRoots("ask", cwd, [], "/Users/someone")).not.toContain(realpathSync(cwd))
  })
  // macOS (Seatbelt), or Linux with bubblewrap installed.
  test.skipIf(process.platform !== "darwin" && !(process.platform === "linux" && Bun.which("bwrap")))("the sandbox blocks writes outside the roots", () => {
    const cwd = mkdtempSync(join(tmpdir(), "acp-"))
    const outside = mkdtempSync(join(homedir(), ".zorel-acp-test-"))
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

describe("opencode as the API-key harness", () => {
  test("the key stays in the environment; the config names the model; locals get their URL", () => {
    const env = opencodeEnv("openrouter", "anthropic/claude-sonnet", { key: "sk-1", baseURL: "https://openrouter.ai/api/v1" })
    const config = JSON.parse(env.OPENCODE_CONFIG_CONTENT!)
    expect(config.model).toBe("openrouter/anthropic/claude-sonnet")
    expect(config.provider.openrouter.options).toEqual({ apiKey: "{env:ZOREL_PROVIDER_KEY}" })
    expect(env.ZOREL_PROVIDER_KEY).toBe("sk-1")
    expect(env.OPENCODE_CONFIG_CONTENT).not.toContain("sk-1")
    const local = JSON.parse(opencodeEnv("ollama", "qwen3", { baseURL: "http://localhost:11434/v1" }).OPENCODE_CONFIG_CONTENT!)
    expect(local.provider.ollama).toEqual({ npm: "@ai-sdk/openai-compatible", name: "ollama", options: { baseURL: "http://localhost:11434/v1" }, models: { qwen3: { name: "qwen3" } } })
  })
})
