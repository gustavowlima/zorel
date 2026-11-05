import { describe, expect, test } from "bun:test"
import { Effect, Stream } from "effect"
import { chmodSync, existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { acpRun, commandFor, gitCommonDir, kindOf, opencodeEnv, permission, writableRoots } from "./acp.ts"

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
    expect(roots).toContain(realpathSync.native(cwd))
    expect(roots).toContain(resolve("/Users/someone/.opencode-x")) // D:\Users\… on Windows
    expect(writableRoots("ask", cwd, [], "/Users/someone")).not.toContain(realpathSync.native(cwd))
  })
  test("a worktree's main .git is writable; a .git file the agent wrote (gitdir: /etc/x) adds nothing", () => {
    const dir = mkdtempSync(join(tmpdir(), "acp-git-"))
    try {
      const git = (...a: string[]) => Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: join(dir, "repo") })
      Bun.spawnSync(["git", "init", "-q", "repo"], { cwd: dir })
      git("commit", "-q", "--allow-empty", "-m", "x")
      git("worktree", "add", "-q", join(dir, "wt"))
      expect(gitCommonDir(join(dir, "wt"))).toBe(realpathSync.native(join(dir, "repo", ".git")))
      for (const forged of ["gitdir: /etc/x", "gitdir: /usr/x", `gitdir: ${join(dir, "repo", ".git", "worktrees", "other")}`]) {
        writeFileSync(join(dir, "wt", ".git"), forged)
        expect(gitCommonDir(join(dir, "wt"))).toBeUndefined()
        expect(writableRoots("workspace", join(dir, "wt"), [])).not.toContain("/")
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
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

// An ACP agent in a few lines: asks permission once, then says what it got.
const FAKE_AGENT = `#!/usr/bin/env bun
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\\n")
let buf = ""
for await (const chunk of process.stdin) {
  buf += chunk
  const lines = buf.split("\\n")
  buf = lines.pop()
  for (const line of lines.filter(Boolean)) {
    const m = JSON.parse(line)
    if (m.method === "initialize") send({ id: m.id, result: { protocolVersion: 1, agentCapabilities: {} } })
    else if (m.method === "session/new") send({ id: m.id, result: { sessionId: "s" } })
    else if (m.method === "session/prompt") {
      globalThis.prompt = m.id
      send({ id: 99, method: "session/request_permission", params: { toolCall: { kind: "execute", title: "rm -rf build" }, options: [{ optionId: "yes", kind: "allow_once" }, { optionId: "no", kind: "reject_once" }] } })
    } else if (m.id === 99) {
      send({ method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: JSON.stringify(m.result.outcome) } } } })
      send({ id: globalThis.prompt, result: { stopReason: "end_turn" } })
    }
  }
}
`
describe("acp at Ask first", () => {
  test.skipIf(process.platform !== "darwin" && !(process.platform === "linux" && Bun.which("bwrap")))("a permission request becomes the approval card; its answer goes back to the agent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "acp-ask-"))
    const bin = join(dir, "fake-acp")
    writeFileSync(bin, FAKE_AGENT)
    chmodSync(bin, 0o755)
    const cards: string[] = []
    const turn = (ok: boolean) =>
      Effect.runPromise(Stream.runCollect(acpRun({ bin, args: [], model: "default", cwd: dir, prompt: "go", access: "ask", approve: async (r) => {
            cards.push(`${r.kind}: ${r.summary}`)
            return ok
          } })))
    const text = (events: ReadonlyArray<{ type: string; delta?: string }>) => events.filter((e) => e.type === "text").map((e) => e.delta).join("")
    expect(text(await turn(true))).toContain('"optionId":"yes"')
    expect(text(await turn(false))).toContain('"outcome":"cancelled"')
    expect(cards).toEqual(["command: rm -rf build", "command: rm -rf build"])
    rmSync(dir, { recursive: true, force: true })
  }, 30_000)
})
