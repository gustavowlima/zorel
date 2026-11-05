// ACP engine (Agent Client Protocol, phase 5): one adapter for every agent CLI that speaks it — Gemini CLI
// (`gemini --acp`), OpenCode (`opencode acp`), and others the same way. Stateless like the CLI fallback: each turn
// starts the agent in ACP mode in the chat's folder, opens a session (with Zorel's tool gateway as an HTTP MCP server
// when the agent takes one), sends the layered context and the conversation as one prompt, and turns the agent's
// session/update notifications into text and work steps. JSON-RPC 2.0, one message per line on stdio.
// Permissions: the agent asks before acting; with access "ask" Zorel refuses (no approval card in a stateless turn,
// the reply says so), with "workspace" or "full" it allows once. Files and terminals stay the agent's own (Zorel
// declares neither capability), and Zorel's checkpoints still record what changed.
// Confinement: below "full", the whole agent process runs in the macOS sandbox (sandbox-exec, Seatbelt), so its
// shell, edits and every process or MCP server it starts can write only to the chat's folder ("workspace"), the
// temporary folders, caches and the CLI's own state. Reads, network and process starts stay open, as the access
// level says. On Linux the same rule runs in bubblewrap (bwrap: the whole system read-only, the roots bound writable),
// when it is installed. On Windows there is no such sandbox yet: below "full" the turn is refused.
import { existsSync, readFileSync, realpathSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import type { Access } from "@zorel/contracts"
import { Stream } from "effect"
import type { EngineEvent, NativeStep } from "../engines.ts"
import { approvalFor } from "./policy.ts"
import type { Approver, NativeApproval } from "./session.ts"

export interface AcpTurn {
  readonly bin: string
  readonly args: ReadonlyArray<string>
  readonly model: string // the agent's own model id; "default" keeps the agent's choice
  readonly cwd: string
  readonly prompt: string
  readonly access: Access
  readonly gatewayUrl?: string | undefined
  readonly web?: boolean // the agent may fetch and search the web
  readonly state?: ReadonlyArray<string> // folders under home the CLI writes its own data to
  readonly env?: Readonly<Record<string, string>> // extra environment (OpenCode's injected config and the API key)
  readonly approve?: Approver | undefined // at "ask", each permission request becomes the turn's approval card
}

// OpenCode as the harness of an API-key model (phase 5): its config goes in OPENCODE_CONFIG_CONTENT, the key in an
// environment variable the config points to ({env:…}), so it never lands in a file; the person's own opencode.json
// and their Claude Code prompt and skills stay out (Zorel gives the context). Local servers (Ollama, LM Studio) are
// OpenAI-compatible providers at their URL.
export function opencodeEnv(provider: string, model: string, o: { key?: string | undefined; baseURL?: string | undefined }): Record<string, string> {
  const local = provider === "ollama" || provider === "lmstudio"
  const options: Record<string, string> = {}
  if (o.key) options.apiKey = "{env:ZOREL_PROVIDER_KEY}"
  if (o.baseURL && (local || provider === "openai")) options.baseURL = o.baseURL
  const block = local ? { npm: "@ai-sdk/openai-compatible", name: provider, options, models: { [model]: { name: model } } } : { options }
  const config = { $schema: "https://opencode.ai/config.json", model: `${provider}/${model}`, provider: { [provider]: block }, autoupdate: false }
  return {
    OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
    ...(o.key ? { ZOREL_PROVIDER_KEY: o.key } : {}),
    OPENCODE_DISABLE_CLAUDE_CODE: "1",
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_DISABLE_AUTOUPDATE: "1"
  }
}

type Json = Record<string, any>
const PROTOCOL = 1

// ACP tool kinds to Zorel's step kinds.
export const kindOf = (k: unknown): NativeStep["kind"] => (k === "read" ? "read" : k === "edit" || k === "delete" || k === "move" ? "edit" : k === "execute" ? "run" : k === "search" || k === "fetch" ? "search" : "tool")

const CANCELLED = { outcome: { outcome: "cancelled" } }
// The approval card's kind for an ACP tool kind.
const CARD_KIND: Record<string, NativeApproval["kind"]> = { edit: "edit", delete: "edit", move: "edit", execute: "command", fetch: "network" }

// The permission answer for an access level: the first "allow once" option, else cancelled.
export function permission(options: ReadonlyArray<{ optionId: string; kind: string }>, access: Access): Json {
  const allow = access !== "ask" && (options.find((o) => o.kind === "allow_once") ?? options.find((o) => o.kind === "allow_always"))
  return allow ? { outcome: { outcome: "selected", optionId: allow.optionId } } : { outcome: { outcome: "cancelled" } }
}

const SANDBOX_EXEC = "/usr/bin/sandbox-exec"
// .native: on Windows it also expands short names (RUNNER~1), so a path compares equal however it was written.
const real = (p: string) => {
  try {
    return realpathSync.native(p)
  } catch {
    return resolve(p)
  }
}
const quote = (p: string) => JSON.stringify(p) // Seatbelt strings use the same escapes as JSON

// A git worktree keeps its index and refs in the main repository's .git: commits there need it writable. cwd/.git is
// a file the agent itself can write, so its "gitdir:" is believed only for a real worktree: <repo>/.git/worktrees/<name>
// whose own gitdir file (outside cwd, out of the agent's reach) points back at this .git.
export function gitCommonDir(cwd: string): string | undefined {
  const dotGit = join(cwd, ".git")
  if (!existsSync(dotGit)) return undefined
  const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8").toString().trim())
  if (!m) return undefined
  const gitdir = real(resolve(cwd, m[1]!.trim()))
  const common = dirname(dirname(gitdir))
  if (basename(dirname(gitdir)) !== "worktrees" || basename(common) !== ".git") return undefined
  try {
    return real(readFileSync(join(gitdir, "gitdir"), "utf8").trim()) === real(dotGit) ? common : undefined
  } catch {
    return undefined
  }
}

// The folders a confined agent may write, by access level.
export function writableRoots(access: Access, cwd: string, state: ReadonlyArray<string>, home = homedir()): string[] {
  const roots = [tmpdir(), "/tmp", "/private/tmp", join(home, ".cache"), join(home, "Library/Caches"), ...state.map((s) => join(home, s))]
  if (access === "workspace") {
    roots.push(cwd)
    try {
      const common = gitCommonDir(cwd)
      if (common) roots.push(common)
    } catch {
      // .git is a folder (a normal repo inside cwd): already writable
    }
  }
  return [...new Set(roots.map(real))]
}

// Seatbelt profile: everything allowed except writing outside the roots (and the terminal devices a shell needs).
export function seatbeltProfile(roots: ReadonlyArray<string>): string {
  return [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    `(allow file-write* ${roots.map((r) => `(subpath ${quote(r)})`).join(" ")})`,
    '(allow file-write* (literal "/dev/null") (literal "/dev/zero") (literal "/dev/tty") (literal "/dev/ptmx") (literal "/dev/dtracehelper") (regex #"^/dev/ttys[0-9]+$") (regex #"^/dev/fd/"))'
  ].join("\n")
}

// The command line for a turn: confined below "full"; undefined when it can't be confined here.
export function commandFor(path: string, t: Pick<AcpTurn, "args" | "access" | "cwd" | "state">, platform = process.platform, bwrap = Bun.which("bwrap")): string[] | undefined {
  if (t.access === "full") return [path, ...t.args]
  const roots = () => writableRoots(t.access, t.cwd, t.state ?? [])
  if (platform === "darwin" && existsSync(SANDBOX_EXEC)) return [SANDBOX_EXEC, "-p", seatbeltProfile(roots()), path, ...t.args]
  if (platform === "linux" && bwrap) return [...bwrapArgs(bwrap, roots().filter((r) => existsSync(r))), path, ...t.args]
  return undefined
}

// bubblewrap: everything read-only, then each root bound writable over it; devices and /proc as usual. Network and
// process starts stay open, as on macOS. Exits with Zorel (--die-with-parent).
export const bwrapArgs = (bwrap: string, roots: ReadonlyArray<string>) => [
  bwrap, "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", ...roots.flatMap((r) => ["--bind", r, r]), "--die-with-parent", "--"
]

export function acpRun(t: AcpTurn): Stream.Stream<EngineEvent> {
  return Stream.fromAsyncIterable(run(t), (e) => e).pipe(Stream.catch((e) => Stream.make<EngineEvent[]>({ type: "error", message: String(e instanceof Error ? e.message : e), failure: { reason: "unavailable" } })))
}

async function* run(t: AcpTurn): AsyncGenerator<EngineEvent> {
  const path = Bun.which(t.bin)
  if (!path) {
    yield { type: "error", message: `${t.bin} is not installed or not on the PATH.`, failure: { reason: "unavailable" } }
    return
  }
  const cmd = commandFor(path, t)
  if (!cmd) {
    yield { type: "error", message: process.platform === "linux" ? `${t.bin} runs confined in bubblewrap, which isn't installed (install the bubblewrap package), or give this agent Full access.` : `${t.bin} can't be confined on this system yet. Give this agent Full access to run it here.`, failure: { reason: "unavailable" } }
    return
  }
  const proc = Bun.spawn(cmd, { cwd: t.cwd, stdin: "pipe", stdout: "pipe", stderr: "pipe", env: { ...process.env, ...t.env } })
  const queue: EngineEvent[] = []
  let wake: (() => void) | undefined
  const push = (e: EngineEvent) => {
    queue.push(e)
    wake?.()
  }
  const pending = new Map<number, { resolve: (v: Json) => void; reject: (e: Error) => void }>()
  let nextId = 1
  const send = (msg: Json) => proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`)
  const request = (method: string, params: Json) =>
    new Promise<Json>((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      send({ id, method, params })
    })
  const steps = new Map<string, { title: string; kind: NativeStep["kind"] }>()
  let refused = 0

  // The agent's messages: responses to ours, its notifications, and its own requests (permission).
  const onMessage = (m: Json) => {
    if (m.id !== undefined && m.method === undefined) {
      const p = pending.get(m.id)
      pending.delete(m.id)
      if (m.error) p?.reject(new Error(m.error.message ?? JSON.stringify(m.error)))
      else p?.resolve(m.result ?? {})
      return
    }
    if (m.method === "session/request_permission") {
      const options = m.params?.options ?? []
      const call = m.params?.toolCall ?? {}
      const reply = (answer: Json) => {
        if (answer.outcome.outcome === "cancelled") refused++
        send({ id: m.id, result: answer })
      }
      if (call.kind === "fetch" && !t.web) return reply(CANCELLED)
      if (t.access !== "ask" || !t.approve) return reply(permission(options, t.access))
      // "Ask first": the person decides on the turn's approval card while the agent waits.
      const title = String(call.title ?? "A tool call")
      void t.approve(approvalFor(CARD_KIND[String(call.kind)] ?? "tool", title, title, call.rawInput ?? call, t.cwd)).then(
        (ok) => reply(ok ? permission(options, "workspace") : CANCELLED),
        () => reply(CANCELLED)
      )
      return
    }
    if (m.method !== undefined && m.id !== undefined) {
      send({ id: m.id, error: { code: -32601, message: `Zorel does not handle ${m.method}` } })
      return
    }
    if (m.method !== "session/update") return
    const u = m.params?.update ?? {}
    if (u.sessionUpdate === "agent_message_chunk" && u.content?.type === "text") push({ type: "text", delta: String(u.content.text ?? "") })
    else if (u.sessionUpdate === "tool_call") {
      const step = { title: String(u.title ?? "Tool"), kind: kindOf(u.kind) }
      steps.set(u.toolCallId, step)
      push({ type: "step", step: { id: u.toolCallId, ...step, files: (u.locations ?? []).map((l: Json) => String(l.path)), status: "running", output: "" } })
    } else if (u.sessionUpdate === "tool_call_update" && (u.status === "completed" || u.status === "failed")) {
      const step = steps.get(u.toolCallId) ?? { title: String(u.title ?? "Tool"), kind: kindOf(u.kind) }
      const text = (u.content ?? []).map((c: Json) => c?.content?.text ?? "").join("\n")
      push({ type: "step", step: { id: u.toolCallId, ...step, files: [], status: u.status === "completed" ? "ok" : "error", output: String(text).slice(0, 2000) } })
    }
  }

  // stdout: one JSON-RPC message per line.
  void (async () => {
    const decoder = new TextDecoder()
    let buf = ""
    for await (const chunk of proc.stdout) {
      buf += decoder.decode(chunk, { stream: true })
      const lines = buf.split("\n")
      buf = lines.pop() ?? ""
      for (const raw of lines) {
        const line = raw.trim()
        if (!line) continue
        try {
          onMessage(JSON.parse(line))
        } catch {
          // not JSON-RPC (a log line): ignore
        }
      }
    }
  })()
  const stderr = new Response(proc.stderr).text()

  const turn = (async () => {
    const init = await request("initialize", { protocolVersion: PROTOCOL, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } })
    const http = init.agentCapabilities?.mcpCapabilities?.http === true
    const mcpServers = t.gatewayUrl && http ? [{ type: "http", name: "zorel", url: t.gatewayUrl, headers: [] }] : []
    const session = await request("session/new", { cwd: t.cwd, mcpServers })
    const sessionId = String(session.sessionId)
    if (t.model && t.model !== "default") await request("session/set_model", { sessionId, modelId: t.model }).catch(() => undefined) // not every agent has it
    return request("session/prompt", { sessionId, prompt: [{ type: "text", text: t.prompt }] })
  })()
  let done: { stopReason?: string; usage?: { inputTokens?: number; outputTokens?: number; cachedReadTokens?: number } } | undefined
  let failed: Error | undefined
  void turn.then(
    (r) => {
      done = r
      wake?.()
    },
    (e: Error) => {
      failed = e
      wake?.()
    }
  )
  void proc.exited.then(() => {
    if (!done && !failed) failed = new Error("exited")
    wake?.()
  })

  try {
    while (true) {
      while (queue.length) yield queue.shift()!
      if (done || failed) break
      await new Promise<void>((r) => {
        wake = r
      })
      wake = undefined
    }
    while (queue.length) yield queue.shift()!
    if (failed) {
      const err = (await Promise.race([stderr, Bun.sleep(300).then(() => "")])).trim().split("\n").slice(-3).join("\n")
      yield { type: "error", message: `${t.bin}: ${failed.message}${err ? `\n${err}` : ""}`, failure: { reason: /auth|login|credential/i.test(`${failed.message} ${err}`) ? "auth" : "unavailable" } }
      return
    }
    if (refused && !t.approve) yield { type: "text", delta: `\n\n_(${refused} action${refused > 1 ? "s" : ""} refused: this agent's access is "Ask first", and nobody was there to ask.)_` }
    // The prompt's answer carries the turn's tokens (OpenCode does; an agent that doesn't counts 0).
    const u = done?.usage
    yield { type: "done", usage: { inputTokens: Number(u?.inputTokens) || 0, outputTokens: Number(u?.outputTokens) || 0, ...(u?.cachedReadTokens ? { cachedTokens: Number(u.cachedReadTokens) } : {}) } }
  } finally {
    proc.kill()
  }
}
