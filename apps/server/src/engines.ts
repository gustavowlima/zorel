// Engines: what runs a turn. Two families behind the same interface:
// - subscription: the user's official CLI (Claude Code, Codex), without its own session
//   (--no-session-persistence / --ephemeral): the context is always built by us.
//   We never read or store these CLIs' OAuth login (provider terms).
// - api: direct call with a token via effect/ai (Anthropic, OpenAI, OpenRouter, Ollama…).
// Since the context is ours, switching models between turns needs no handoff.
// Tools always come through Zorel's MCP gateway (tools.ts); the CLIs get no others.
// CLI arguments and parsers derive from third-party code, see NOTICE.
import { AnthropicClient, AnthropicLanguageModel } from "@effect/ai-anthropic"
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai-compat"
import type { Access, AccountWindow, FailureReason, ModelInfo } from "@zorel/contracts"
import { acpRun, opencodeEnv } from "./engines/acp.ts"
import { Context, Effect, Layer, Queue, Redacted, Stream } from "effect"
import { LanguageModel, Prompt, Tool, Toolkit } from "effect/ai"
import { FetchHttpClient } from "effect/http"
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { openClaudeSession } from "#server/engines/claude-sdk.ts"
import { openCodexSession } from "#server/engines/codex.ts"
import type { Approver } from "#server/engines/session.ts"
import type { EngineSession } from "#server/engines/session.ts"
import { GATEWAY_TOOL_TIMEOUT_MS } from "#server/engines/session.ts"
import { Secrets, type SecretStore } from "./secrets.ts"
import { resultText, type Session, type ToolDef } from "./tools.ts"
import { which } from "./cli/index.ts"

export interface TurnFile {
  readonly name: string
  readonly mime: string
  readonly path: string
}

export interface TurnMessage {
  readonly role: "user" | "assistant"
  readonly text: string
  readonly files?: ReadonlyArray<TurnFile> | undefined // attachments of this message
  readonly at?: number // order in the chat: the native session marker compares by this
}

export interface TurnTools {
  readonly url: string // MCP gateway session for the CLIs
  readonly defs: ReadonlyArray<ToolDef>
  readonly call: Session["call"] // the same path, called directly by the API engine
}

export interface Turn {
  readonly model: string // "<provider>/<model>"
  readonly system: string // stable + dynamic (sessionless engines get stable, and dynamic after the message: sessionless())
  readonly stable?: string // part that opens a native session
  readonly frame?: string // the stable part without the memories: what a native session is tied to
  readonly dynamic?: string // part sent with the message each turn in a native session
  readonly memories?: ReadonlyArray<{ readonly id: string; readonly text: string }> // the memories in `stable`
  readonly activeMemoryIds?: ReadonlyArray<string> // every memory still active in scope (in `stable` or not)
  readonly messages: ReadonlyArray<TurnMessage> // ends with a user message
  readonly cwd: string // empty directory: the CLI gets nobody's files
  readonly tools?: TurnTools | undefined
  readonly access?: Access | undefined // what the agent may do without asking (ACP agents ask through Zorel)
  readonly approve?: Approver | undefined // the turn's approval card, for an engine that asks mid-turn (ACP at "ask")
  readonly web?: boolean | undefined // the agent may search and read the web (its permissions)
  readonly account?: { readonly id: string; readonly home: string | null } | undefined // §6.1: whose login runs an ACP turn
  // Characters of each part of the context (the composer's context meter estimates tokens from them).
  readonly parts?: { readonly instructions: number; readonly memories: number; readonly skills: number; readonly summary: number }
}

export interface Usage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cachedTokens?: number // input read from the provider's prompt cache (part of inputTokens)
}

// Why an engine failed, when failover may help (ARCHITECTURE §6.1). Absent: content or request errors,
// which another model would repeat. `until`: a subscription limit that comes back at that time (ms).
export interface EngineFailure {
  readonly reason: FailureReason
  readonly until?: number | undefined
}

export type EngineEvent =
  | { readonly type: "text"; readonly delta: string }
  // The engine is reasoning (Claude thinking blocks, Codex reasoning items, ACP thought chunks), one per sign of it.
  // No content: Zorel only times it. Engines that don't show their reasoning never send it.
  | { readonly type: "thinking" }
  | { readonly type: "done"; readonly usage: Usage }
  // The turn's tokens so far (engines that report them while it runs: Claude, Codex), for a reply's token limit.
  | { readonly type: "usage"; readonly usage: Usage }
  | { readonly type: "error"; readonly message: string; readonly failure?: EngineFailure | undefined }
  // A limit reading of the account the session runs on (Claude rate_limit_event, Codex account/rateLimits).
  | { readonly type: "limits"; readonly windows: ReadonlyArray<AccountWindow> }
  // A native tool call (read, edit, command…): sent when it starts and again when it ends, same id.
  | { readonly type: "step"; readonly step: NativeStep }

export interface NativeStep {
  readonly id: string
  readonly kind: "read" | "edit" | "run" | "search" | "tool"
  readonly title: string // a short summary: "Check git status", "Read a.ts"
  readonly detail: string // what the summary stands for: the command, the path, the URL; "" when the title says it all
  readonly files: ReadonlyArray<string> // relative to the workspace
  readonly status: "running" | "ok" | "error" | "refused"
  readonly output: string // start of the result
}

export const STEP_TITLE_MAX = 120
export const STEP_DETAIL_MAX = 300

// A command with no description of its own: "Run git" over the whole command. A shell wrapper is looked through, so
// the title names the real program: `/bin/zsh -lc '…'` (how Codex reports commands), `powershell -Command "…"`,
// `cmd /c …`. Paths may use `/` or a backslash and may be quoted (`"C:\Program Files\Git\git.exe" status`).
// A function declaration, not a const: codex.ts and acp.ts import this module while it is still loading.
const WORD = /^("[^"]*"|'[^']*'|\S+)\s*([\s\S]*)$/
const programName = (token: string) => (token.replace(/^["']|["']$/g, "").split(/[\\/]/).pop() ?? "").replace(/\.(?:exe|cmd|bat|com)$/i, "")

function unwrapShell(text: string): string {
  const [, shell = "", rest = ""] = WORD.exec(text) ?? []
  const name = programName(shell).toLowerCase()
  if (["sh", "bash", "zsh", "dash", "fish"].includes(name)) return /^-\w*c\s+(["'])([\s\S]*)\1$/.exec(rest)?.[2] ?? text
  if (name === "powershell" || name === "pwsh") return /^(?:-(?!c(?:ommand)?\s)\w+\s+)*-c(?:ommand)?\s+(["']?)([\s\S]*?)\1$/i.exec(rest)?.[2] ?? text
  if (name === "cmd") return /^(?:\/[dsq]\s+)*\/[ck]\s+(["']?)([\s\S]*?)\1$/i.exec(rest)?.[2] ?? text
  return text
}

export function commandStep(command: string): Pick<NativeStep, "title" | "detail"> {
  const text = command.trim()
  const first = unwrapShell(text)
    .trim()
    .replace(/^cd\s+(?:\/d\s+)?(?:"[^"]*"|\S+)\s*(?:&&|;)\s*/i, "") // `cd dir &&` doesn't name the work
    .replace(/^(?:\w+=\S*\s+)+/, "") // nor does `VAR=1`
    .replace(/^&\s+/, "") // PowerShell's call operator
  const program = programName(WORD.exec(first)?.[1] ?? "")
  return { title: (program ? `Run ${program}` : "Run a command").slice(0, STEP_TITLE_MAX), detail: text.slice(0, STEP_DETAIL_MAX) }
}

// Seconds or milliseconds → milliseconds (CLIs report epoch seconds).
export const toMillis = (t: number) => (t < 1e12 ? t * 1000 : t)

// Last resort for engines without structured errors (API SDKs, a dying process): read the message.
export function classifyMessage(message: string): EngineFailure | undefined {
  const m = message.toLowerCase()
  if (/usage limit|limit reached|quota exceeded|out of credits/.test(m)) return { reason: "limit" }
  if (/\b429\b|rate.?limit|too many requests/.test(m)) return { reason: "rate_limit" }
  if (/\b402\b|billing|payment|insufficient (credit|balance|funds)/.test(m)) return { reason: "billing" }
  if (/\b40[13]\b|unauthori[sz]ed|forbidden|invalid api key|authentication|not logged in|log ?in|login/.test(m)) return { reason: "auth" }
  if (/timed? ?out|timeout/.test(m)) return { reason: "timeout" }
  if (/econn|enotfound|network|fetch failed|socket|connection (reset|refused|closed)/.test(m)) return { reason: "network" }
  if (/\b5\d\d\b|overloaded|unavailable|server error|not installed|exited|saiu|encerrou/.test(m)) return { reason: "unavailable" }
  return undefined
}

// Claude SDK assistant-message error codes → failover reasons (content/request errors don't switch).
const CLAUDE_ERRORS: Record<string, FailureReason | undefined> = {
  authentication_failed: "auth", oauth_org_not_allowed: "auth", account_on_hold: "auth", verification_required: "auth", cloud_credential_error: "auth",
  billing_error: "billing", rate_limit: "rate_limit", overloaded: "unavailable", server_error: "unavailable"
}

const one = (e: EngineEvent): Stream.Stream<EngineEvent> => Stream.make(e)
const MAX_TOOL_STEPS = 12

// ---------- providers ----------

type Provider = {
  readonly kind: "subscription" | "api"
  readonly hint: string
  readonly suggestions: ReadonlyArray<string>
  readonly key?: string // API key name (env or keychain)
  readonly bin?: string // subscription CLI
  readonly local?: true // local server: available only if it responds, and models come from it
  readonly cheap?: string // its small, fast model: background calls (routing, memory) go there
}

// OpenAI-compatible base URLs. Ollama/LM Studio run locally and need no key.
const COMPAT: Record<string, () => string> = {
  openai: () => process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  openrouter: () => "https://openrouter.ai/api/v1",
  ollama: () => process.env.OLLAMA_URL ?? "http://localhost:11434/v1",
  lmstudio: () => process.env.LMSTUDIO_URL ?? "http://localhost:1234/v1"
}

export const PROVIDERS: Record<string, Provider> = {
  "claude-cli": { kind: "subscription", hint: "Claude Code logado (claude auth login)", suggestions: ["sonnet", "opus", "haiku"], bin: "claude", cheap: "haiku" },
  "codex-cli": { kind: "subscription", hint: "Codex signed in (codex login); 'default' uses its default model", suggestions: ["default"], bin: "codex" },
  anthropic: { kind: "api", hint: "ANTHROPIC_API_KEY", suggestions: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"], key: "ANTHROPIC_API_KEY", cheap: "claude-haiku-5-5" },
  openai: { kind: "api", hint: "OPENAI_API_KEY (OPENAI_BASE_URL opcional)", suggestions: [], key: "OPENAI_API_KEY" },
  openrouter: { kind: "api", hint: "OPENROUTER_API_KEY", suggestions: [], key: "OPENROUTER_API_KEY" },
  // ACP agents (phase 5): any CLI that speaks the Agent Client Protocol, through one adapter (engines/acp.ts).
  "gemini-cli": { kind: "subscription", hint: "Gemini CLI logado (gemini, then sign in)", suggestions: ["default", "gemini-2.5-pro", "gemini-2.5-flash"], bin: "gemini", cheap: "gemini-2.5-flash" },
  opencode: { kind: "subscription", hint: "OpenCode set up (opencode auth login); uses its own providers and keys", suggestions: ["default"], bin: "opencode" },
  // Google's Antigravity CLI (agy): signed in with a Google account; its models come from `agy models`.
  antigravity: { kind: "subscription", hint: "Antigravity CLI signed in (run agy, then sign in with Google)", suggestions: ["default"], bin: "agy", cheap: "gemini-3.8-flash-low" },
  ollama: { kind: "api", hint: "Ollama rodando (OLLAMA_URL)", suggestions: [], local: true },
  lmstudio: { kind: "api", hint: "LM Studio rodando (LMSTUDIO_URL)", suggestions: [], local: true }
}

export function splitModel(id: string): { provider: string; model: string } {
  const i = id.indexOf("/")
  return { provider: id.slice(0, i), model: id.slice(i + 1) }
}

// The same provider's small model (same login, a fraction of the cost), else the model itself.
export const cheapModel = (model: string) => {
  const { provider } = splitModel(model)
  const cheap = PROVIDERS[provider]?.cheap
  return cheap ? `${provider}/${cheap}` : model
}

const ENGINE_NAMES: Record<string, string> = { "claude-cli": "Claude Code", "codex-cli": "Codex", "gemini-cli": "Gemini CLI", opencode: "OpenCode", antigravity: "Antigravity", anthropic: "Anthropic", openai: "OpenAI", openrouter: "OpenRouter", ollama: "Ollama", lmstudio: "LM Studio" }

// "claude-cli/opus" → "Claude Code · Opus"; "claude-cli/claude-sonnet-5-5" → "Claude Code · Sonnet 5.5"; API models keep their id.
// Saved as text on the timing steps, so it reads without the model list (the picker's own names come from it).
export function engineLabel(id: string): string {
  const { provider, model } = id.includes("/") ? splitModel(id) : { provider: id, model: "" }
  const engine = ENGINE_NAMES[provider] ?? provider
  const claude = /^claude-(opus|sonnet|haiku)-(\d+)-(\d+)/.exec(model)
  const name = claude ? `${claude[1]!.charAt(0).toUpperCase()}${claude[1]!.slice(1)} ${claude[2]}.${claude[3]}` : model === "default" || !model ? "" : provider === "claude-cli" ? model.charAt(0).toUpperCase() + model.slice(1) : model
  return name ? `${engine} · ${name}` : engine
}

// Models a local OpenAI-compatible server lists; undefined if it doesn't respond.
async function probe(url: string): Promise<string[] | undefined> {
  try {
    const r = await fetch(`${url}/models`, { signal: AbortSignal.timeout(500) })
    if (!r.ok) return undefined
    const body = (await r.json()) as { data?: Array<{ id: unknown }> }
    return (body.data ?? []).map((m) => String(m.id))
  } catch {
    return undefined
  }
}

// A model a subscription CLI offers today, as the CLI names it ("opus" → "Opus 5.5").
export interface CliModel {
  readonly id: string
  readonly name: string
  readonly note: string
}

// Known suggestions (or those the local server lists) + free "<provider>/…": any model can be typed.
export async function listModels(secrets: SecretStore, cli: Partial<Record<string, ReadonlyArray<CliModel>>> = {}): Promise<ModelInfo[]> {
  const entries = Object.entries(PROVIDERS)
  const found = await Promise.all(entries.map(([id, p]) => (p.local ? probe(COMPAT[id]!()) : Promise.resolve(undefined))))
  return entries.flatMap(([provider, p], i) => {
    const local = found[i]
    const available = p.local ? !!local : p.key ? !!secrets.get(p.key) : !!which(p.bin!)
    const named = cli[provider]
    if (named?.length) {
      // Codex keeps "default" (its own pick) ahead of the listed models.
      const all = provider === "codex-cli" ? [{ id: "default", name: undefined, note: undefined }, ...named] : named
      return all.map((m) => ({ id: `${provider}/${m.id}`, provider, kind: p.kind, available, hint: p.hint, name: m.name, note: m.note }))
    }
    const suggestions = local?.length ? local : p.suggestions
    return (suggestions.length ? suggestions : ["…"]).map((m) => ({ id: `${provider}/${m}`, provider, kind: p.kind, available, hint: p.hint }))
  })
}

// ---------- CLIs ----------

export interface Parser {
  line(line: string): EngineEvent[]
  end(code: number | null, stderr: string): EngineEvent[]
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0)
const json = (line: string): Record<string, any> | undefined => {
  try {
    const v = JSON.parse(line)
    return v && typeof v === "object" ? v : undefined
  } catch {
    return undefined
  }
}
const tail = (s: string) => s.trim().split("\n").slice(-5).join("\n")

// History becomes a transcript: the CLI gets a single prompt per turn.
export const isImage = (f: TurnFile) => /^image\/(png|jpeg|gif|webp)$/.test(f.mime)
const TEXT_INLINE_BYTES = 64 * 1024
// How a file shows up in the text: images go as images (native sessions) and are only named here;
// small text files go inline; anything else by name until agents have file tools (workspace phase).
function fileNote(f: TurnFile): string {
  if (isImage(f)) return `[attached image: ${f.name}]`
  const textual = /^text\/|json|xml|yaml|toml|javascript|typescript/.test(f.mime) || /\.(md|txt|csv|ts|tsx|js|json|ya?ml|toml|py|go|rs|sql|sh)$/i.test(f.name)
  if (textual) {
    try {
      if (statSync(f.path).size <= TEXT_INLINE_BYTES) return `<file name="${f.name}">\n${readFileSync(f.path, "utf8")}\n</file>`
    } catch {
      // gone from disk: fall back to the name
    }
  }
  return `[attached file: ${f.name} (${f.mime})]`
}
const withFiles = (m: TurnMessage) => (m.files?.length ? `${m.text}\n\n${m.files.map(fileNote).join("\n")}` : m.text)

// ACP agents get text only: an attached image is named in the transcript but never seen. Said plainly, so the model
// doesn't describe a picture it didn't get.
export const imagesNotShown = (messages: ReadonlyArray<TurnMessage>) =>
  messages.some((m) => m.files?.some(isImage))
    ? "\n\n(Note from Zorel: the images attached in this conversation couldn't be shown to you; this agent takes text only. If asked about an image, say you couldn't see it.)"
    : ""

export function transcript(messages: ReadonlyArray<TurnMessage>): string {
  const last = messages.at(-1)!
  const before = messages.slice(0, -1)
  if (!before.length) return withFiles(last)
  const lines = before.map((m) => `<${m.role}>\n${withFiles(m)}\n</${m.role}>`).join("\n")
  return `Conversation so far, oldest first:\n${lines}\n\nNew message from the user:\n${withFiles(last)}`
}

// A sessionless engine gets the stable part as its system prompt and the per-turn part (skill bodies, summary,
// recalled memories) in a <context> block after the new message, so what the provider caches (system, tools, the
// conversation's start) stays the same from one turn to the next. A turn without `stable` (internal tasks) is as is.
export function sessionless(t: Turn): Turn {
  if (t.stable === undefined) return t
  const last = t.messages.at(-1)!
  const messages = t.dynamic ? [...t.messages.slice(0, -1), { ...last, text: `${last.text}\n\n<context>\n${t.dynamic}\n</context>` }] : t.messages
  return { ...t, system: t.stable, messages }
}

const GATEWAY = "zorel"

export const claudeArgs = (t: Turn) => [
  "-p",
  "--output-format", "stream-json",
  "--verbose",
  "--include-partial-messages",
  "--model", splitModel(t.model).model,
  "--system-prompt", t.system,
  "--tools", "", // no shell or files: only chat and the gateway tools
  "--strict-mcp-config",
  "--setting-sources", "", // ignores the user's hooks, plugins and permissions
  "--no-session-persistence",
  ...(t.tools
    ? ["--mcp-config", JSON.stringify({ mcpServers: { [GATEWAY]: { type: "http", url: t.tools.url, timeout: GATEWAY_TOOL_TIMEOUT_MS } } }), "--allowedTools", `mcp__${GATEWAY}`] // the gateway decides
    : [])
]

export function claudeParser(): Parser {
  let finished = false
  let wrote = false
  let newCall = false
  let errorCode: string | undefined // last assistant-message error code
  let rejectedUntil: number | undefined // the subscription refused this turn: back at this time
  return {
    line(line) {
      const ev = json(line)
      if (!ev) return []
      if (ev.type === "assistant" && typeof ev.error === "string") errorCode = ev.error
      if (ev.type === "rate_limit_event") {
        const info = ev.rate_limit_info ?? {}
        const resetsAt = typeof info.resetsAt === "number" ? toMillis(info.resetsAt) : null
        if (info.status === "rejected") rejectedUntil = resetsAt ?? Date.now() + 60 * 60_000
        const used = typeof info.utilization === "number" ? (info.utilization <= 1 ? info.utilization * 100 : info.utilization) : info.status === "rejected" ? 100 : undefined
        const id = typeof info.rateLimitType === "string" ? info.rateLimitType : "five_hour"
        return used === undefined ? [] : [{ type: "limits", windows: [{ id, usedPercent: used, resetsAt }] }]
      }
      if (ev.type === "stream_event") {
        const e = ev.event ?? {}
        if (e.type === "message_start") newCall = true
        const d = e.delta
        if (e.type === "content_block_delta" && d?.type === "text_delta" && typeof d.text === "string") {
          const sep = newCall && wrote ? "\n\n" : "" // text before/after tools becomes a paragraph
          newCall = false
          wrote = true
          return [{ type: "text", delta: sep + d.text }]
        }
        if ((e.type === "content_block_start" && e.content_block?.type === "thinking") || (e.type === "content_block_delta" && d?.type === "thinking_delta")) return [{ type: "thinking" }]
        return []
      }
      if (ev.type !== "result") return []
      finished = true
      if (ev.is_error === true || ev.subtype !== "success") {
        const message = (typeof ev.result === "string" && ev.result) || `Claude Code ended with an error (${ev.subtype}).`
        const mapped = errorCode ? CLAUDE_ERRORS[errorCode] : undefined
        const failure: EngineFailure | undefined = rejectedUntil ? { reason: "limit", until: rejectedUntil } : mapped ? { reason: mapped } : errorCode ? undefined : classifyMessage(message)
        return [{ type: "error", message, failure }]
      }
      const u = ev.usage ?? {}
      return [{ type: "done", usage: { inputTokens: num(u.input_tokens) + num(u.cache_read_input_tokens) + num(u.cache_creation_input_tokens), outputTokens: num(u.output_tokens), cachedTokens: num(u.cache_read_input_tokens) } }]
    },
    end(code, stderr) {
      return finished ? [] : [{ type: "error", message: `Claude Code exited without an answer (code ${code ?? "?"}).\n${tail(stderr)}`.trim(), failure: classifyMessage(stderr) ?? { reason: "unavailable" } }]
    }
  }
}

// Codex without its own tools, without user config/rules and without a saved session.
export const CODEX_DISABLED = ["shell_tool", "unified_exec", "apps", "plugins", "browser_use", "computer_use", "image_generation", "multi_agent", "view_image", "hooks", "memories"]
export const codexArgs = (t: Turn) => {
  const { model } = splitModel(t.model)
  return [
    "exec", "--json", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--skip-git-repo-check",
    "-s", "read-only",
    "-C", t.cwd,
    ...(model === "default" ? [] : ["-m", model]),
    "-c", `developer_instructions=${JSON.stringify(t.system)}`,
    "-c", "project_doc_max_bytes=0",
    "-c", 'web_search="disabled"',
    ...CODEX_DISABLED.flatMap((f) => ["--disable", f]),
    ...(t.tools
      ? [
          "-c", `mcp_servers.${GATEWAY}.url=${JSON.stringify(t.tools.url)}`,
          "-c", `mcp_servers.${GATEWAY}.default_tools_approval_mode="approve"`, // the gateway decides
          "-c", `mcp_servers.${GATEWAY}.tool_timeout_sec=900` // human approval can take a while
        ]
      : []),
    "-"
  ]
}

export function codexParser(): Parser {
  let wrote = false
  let finished = false
  return {
    line(line) {
      const ev = json(line)
      if (!ev) return []
      if (ev.type === "item.completed" && ev.item?.type === "agent_message" && typeof ev.item.text === "string") {
        const delta = (wrote ? "\n\n" : "") + ev.item.text
        wrote = true
        return [{ type: "text", delta }]
      }
      if ((ev.type === "item.started" || ev.type === "item.completed") && ev.item?.type === "reasoning") return [{ type: "thinking" }]
      if (ev.type === "turn.completed") {
        finished = true
        const u = ev.usage ?? {}
        return [{ type: "done", usage: { inputTokens: num(u.input_tokens), outputTokens: num(u.output_tokens) } }]
      }
      if (ev.type === "turn.failed" || ev.type === "error") {
        finished = true
        const message = ev.error?.message || ev.message || "Codex ended with an error."
        return [{ type: "error", message, failure: classifyMessage(message) }]
      }
      return []
    },
    end(code, stderr) {
      return finished ? [] : [{ type: "error", message: `Codex exited without an answer (code ${code ?? "?"}).\n${tail(stderr)}`.trim(), failure: classifyMessage(stderr) ?? { reason: "unavailable" } }]
    }
  }
}

// Runs the CLI and turns each stdout line into events. Interrupting the stream kills the process.
async function* runCli(bin: string, args: string[], stdin: string, cwd: string, parser: Parser): AsyncGenerator<EngineEvent> {
  await Bun.$`mkdir -p ${cwd}`.quiet()
  const proc = Bun.spawn([bin, ...args], { cwd, stdin: new Blob([stdin]), stdout: "pipe", stderr: "pipe" })
  const stderr = new Response(proc.stderr).text()
  try {
    let buf = ""
    for await (const chunk of proc.stdout.pipeThrough(new TextDecoderStream())) {
      buf += chunk
      for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
        yield* parser.line(buf.slice(0, nl))
        buf = buf.slice(nl + 1)
      }
    }
    if (buf.trim()) yield* parser.line(buf)
    yield* parser.end(await proc.exited, await stderr)
  } finally {
    if (proc.exitCode === null) proc.kill()
  }
}

const cli = (bin: string, args: string[], stdin: string, cwd: string, parser: Parser): Stream.Stream<EngineEvent> => {
  const path = which(bin)
  if (!path) return one({ type: "error", message: `${bin} isn't installed or isn't on the PATH.`, failure: { reason: "unavailable" } })
  return Stream.fromAsyncIterable(runCli(path, args, stdin, cwd, parser), (e) => e).pipe(Stream.catch((e) => one({ type: "error", message: String(e), failure: classifyMessage(String(e)) })))
}

// ---------- API (effect/ai) ----------

function apiLayer(secrets: SecretStore, provider: string, model: string): Layer.Layer<LanguageModel.LanguageModel> | string {
  const p = PROVIDERS[provider]
  if (p?.kind !== "api") return `Provider desconhecido: ${provider}.`
  const key = p.key ? secrets.get(p.key) : undefined
  if (p.key && !key) return `Set ${p.key} (in Settings or the environment) to use ${provider}.`
  if (provider === "anthropic")
    return AnthropicLanguageModel.layer({ model, config: { max_tokens: 8192 } }).pipe(
      Layer.provide(AnthropicClient.layer({ apiKey: Redacted.make(key!) })),
      Layer.provide(FetchHttpClient.layer)
    )
  return OpenAiLanguageModel.layer({ model }).pipe(
    Layer.provide(OpenAiClient.layer({ apiUrl: COMPAT[provider]!(), ...(key ? { apiKey: Redacted.make(key) } : {}) })),
    Layer.provide(FetchHttpClient.layer)
  )
}

// Gateway tools as an effect/ai toolkit; the handler goes through the same `call` (policy and approval).
function toolkitOf(tools: TurnTools) {
  const kit = Toolkit.make(...tools.defs.map((d) => Tool.dynamic(d.name, { description: d.description, parameters: { type: "object", ...d.inputSchema } as any })))
  const handlers = Object.fromEntries(
    tools.defs.map((d) => [d.name, (params: unknown) => Effect.promise(() => tools.call(d.name, (params ?? {}) as Record<string, unknown>)).pipe(Effect.map(resultText))])
  )
  return (kit as any).pipe(Effect.provide(kit.toLayer(handlers as any))) as Effect.Effect<any>
}

// Tool loop: while the model asks for a tool, run it and return the result, up to MAX_TOOL_STEPS.
const api = (secrets: SecretStore, t: Turn): Stream.Stream<EngineEvent> => {
  const { provider, model } = splitModel(t.model)
  const layer = apiLayer(secrets, provider, model)
  if (typeof layer === "string") return one({ type: "error", message: layer, failure: { reason: "auth" } }) // missing key
  return Stream.callback<EngineEvent>((q) =>
    Effect.gen(function* () {
      const toolkit = t.tools?.defs.length ? yield* toolkitOf(t.tools) : undefined
      let prompt = Prompt.make([{ role: "system", content: t.system }, ...t.messages.map((m) => ({ role: m.role, content: m.text }))])
      const usage = { inputTokens: 0, outputTokens: 0 }
      let wrote = false
      for (let step = 0; step < MAX_TOOL_STEPS; step++) {
        const parts: any[] = []
        let reason = "stop"
        let first = true
        yield* (LanguageModel.streamText(toolkit ? { prompt, toolkit } : { prompt }) as Stream.Stream<any, any, LanguageModel.LanguageModel>).pipe(
          Stream.runForEach((part: any) =>
            Effect.sync(() => {
              parts.push(part)
              if (part.type === "text-delta") {
                Queue.offerUnsafe(q, { type: "text", delta: (first && wrote ? "\n\n" : "") + part.delta })
                first = false
                wrote = true
              } else if (part.type === "error") Queue.offerUnsafe(q, { type: "error", message: String(part.error), failure: classifyMessage(String(part.error)) })
              else if (part.type === "finish") {
                reason = part.reason
                usage.inputTokens += part.usage.inputTokens.total ?? 0
                usage.outputTokens += part.usage.outputTokens.total ?? 0
              }
            })
          )
        )
        if (reason !== "tool-calls" || !toolkit) break
        prompt = Prompt.concat(prompt, Prompt.fromResponseParts(parts))
      }
      Queue.offerUnsafe(q, { type: "done", usage })
      yield* Queue.end(q)
    }).pipe(
      Effect.provide(layer),
      Effect.catch((e: any) =>
        Effect.sync(() => {
          const message = e?.message ?? String(e)
          Queue.offerUnsafe(q, { type: "error", message, failure: classifyMessage(`${message} ${e?.reason?.status ?? e?.status ?? ""}`) })
          Queue.endUnsafe(q)
        })
      )
    )
  )
}

// ---------- service ----------

interface OpenSession {
  readonly model: string
  readonly system: string // stable part of the context
  readonly cwd: string
  readonly gatewayUrl: string // stable for the session; the runtime swaps the tools behind it each turn
  readonly dataDir: string // where Zorel-owned account folders live (e.g. CODEX_HOME)
  readonly account?: { readonly id: string; readonly home: string | null } | undefined // §6.1: whose login runs this session
  readonly access: Access // §9.2: what the agent may do in `cwd` without asking
  readonly web: boolean // the agent's web permission: the engine's own search/fetch tools on or off
  readonly nativeSkills: boolean // the harness may use its own skills (the person's, its plugins'), not only Zorel's
  readonly approve: Approver // asks the person (the approval card) for a native call
}

interface EnginesService {
  // Stateless: every call gets the whole layered context (API engines, CLIs without a session, consolidation).
  readonly run: (turn: Turn) => Stream.Stream<EngineEvent>
  // Native session for providers that have one; undefined = use `run`; string = could not open (shown as the turn error).
  readonly open?: (o: OpenSession) => EngineSession | string | undefined
  readonly hasSession?: (model: string) => boolean
}

const NATIVE = new Set(["claude-cli", "codex-cli"])
// ACP agents: the binary and its arguments for a model ("default": the agent's own choice).
// `state`: folders (under home, or absolute) the CLI writes its own sessions, logs and caches to; the sandbox lets it
// write there. `home`: the folder of the account the turn runs on (null: the CLI's own login).
type AcpCommand = { bin: string; args: string[]; state: string[]; env?: Record<string, string> }
const ACP: Record<string, (model: string, home: string | null) => AcpCommand> = {
  "gemini-cli": (model) => ({ bin: "gemini", args: ["--acp", ...(model && model !== "default" ? ["-m", model] : [])], state: [".gemini"] }),
  opencode: () => ({ bin: "opencode", args: ["acp"], state: [".local/share/opencode", ".local/state/opencode", ".cache/opencode", ".config/opencode"] }),
  // The model is chosen in the session (session/set_model). agy runs from a folder of Zorel's (--gemini-dir): the
  // person's settings could say "always-proceed" (no permission request ever reaches Zorel, at "Ask first" too),
  // and their MCP servers, global rules and skills would load. The default login stays the system keychain's; an
  // extra account's folder is its --gemini-dir, with the login in a file there (ANTIGRAVITY_FILE_LOGIN).
  antigravity: (_model, home) => ({
    bin: "agy",
    args: ["acp", "--disable-telemetry", "--gemini-dir", antigravityDir(home ? antigravityGeminiDir(home) : undefined)],
    state: [".gemini", ".antigravity", ...(home ? [home] : [])],
    ...(home && { env: ANTIGRAVITY_FILE_LOGIN })
  })
}

// HACK: agy keeps one Google login per computer user, in the system keychain. It keeps it in a file under --gemini-dir
// instead when it believes it runs over SSH (as on headless hosts), so each account folder holds its own login and
// several accounts run side by side. If agy stops honouring this, extra accounts read as signed out; the default
// account (keychain) is unaffected.
export const ANTIGRAVITY_FILE_LOGIN: Readonly<Record<string, string>> = { SSH_CONNECTION: "127.0.0.1 0 127.0.0.1 0" }
// An account folder holds agy's data in .gemini, where agy looks when HOME is that folder (agy -p /usage has no
// --gemini-dir); its file login lives in there (agy writes it; Zorel reads only its e-mail).
export const antigravityGeminiDir = (home: string) => join(home, ".gemini")
export const antigravityLoginFile = (geminiDir: string) => join(geminiDir, "antigravity-cli", "antigravity-oauth-token")

// Antigravity's settings for Zorel: ask before edits and commands (Zorel's access level then decides, engines/acp.ts),
// and Zorel's own tools without asking (its gateway applies its own approvals).
export const ANTIGRAVITY_SETTINGS = { toolPermission: "request-review", permissions: { allow: ["mcp(zorel/*)"] }, notifications: false, showTips: false, showFeedbackSurvey: false }
export function antigravityDir(dir = join(homedir(), ".gemini", "zorel")): string {
  mkdirSync(join(dir, "antigravity-cli"), { recursive: true })
  mkdirSync(join(dir, "config"), { recursive: true })
  writeFileSync(join(dir, "antigravity-cli", "settings.json"), JSON.stringify(ANTIGRAVITY_SETTINGS, null, 2))
  writeFileSync(join(dir, "config", "mcp_config.json"), JSON.stringify({ mcpServers: {} })) // the gateway comes with the session
  return dir
}

// `agy models` prints "<id>\t<label>" per line after a "Fetching…" line; signed out, an error.
export const parseAntigravityModels = (out: string): CliModel[] =>
  out.split(/\r?\n/).flatMap((line) => {
    const m = /^([a-z0-9][a-z0-9.-]*)\t(.+)$/i.exec(line.trim())
    return m ? [{ id: m[1]!, name: m[2]!.trim(), note: "" }] : []
  })
export async function readAntigravityModels(): Promise<CliModel[]> {
  const bin = which("agy")
  if (!bin) return []
  const proc = Bun.spawn([bin, "models"], { stdin: "ignore", stdout: "pipe", stderr: "ignore", timeout: 20_000, killSignal: "SIGKILL", windowsHide: true })
  const [out] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
  return parseAntigravityModels(out)
}

// `agy -p /usage` prints "<group>\t<window> Limit Remaining\t<n>%\t<ISO reset>" per line (its official quota
// command; no model call). Each becomes a window "<minutes>m:<group>" (a length scoped to a model group) with the
// share used; a window of an unknown length stays "model:<group> · <name>".
const ANTIGRAVITY_WINDOWS: Record<string, number> = { "Five Hour": 300, Weekly: 10080 }
export const parseAntigravityUsage = (out: string): AccountWindow[] =>
  out.split(/\r?\n/).flatMap((line) => {
    const m = /^([^\t]+)\t(.+?) Limit Remaining\t(\d+(?:\.\d+)?)%\t(\S+)$/.exec(line.trim())
    if (!m) return []
    const resets = Date.parse(m[4]!)
    const group = m[1]!.replace(/ models$/i, "")
    const minutes = ANTIGRAVITY_WINDOWS[m[2]!]
    return [{ id: minutes ? `${minutes}m:${group}` : `model:${group} · ${m[2]}`, usedPercent: Math.max(0, Math.min(100, 100 - Number(m[3]))), resetsAt: Number.isFinite(resets) ? resets : null }]
  })
// An extra account (home) runs with HOME there and its file login (ANTIGRAVITY_FILE_LOGIN); null: the keychain login.
export async function readAntigravityLimits(home: string | null): Promise<AccountWindow[]> {
  const bin = which("agy")
  if (!bin) throw new Error("agy is not installed")
  const env = home ? { ...process.env, HOME: home, USERPROFILE: home, ...ANTIGRAVITY_FILE_LOGIN } : process.env
  const proc = Bun.spawn([bin, "-p", "/usage", "--print-timeout", "60s"], { env, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 90_000, killSignal: "SIGKILL", windowsHide: true })
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  const windows = parseAntigravityUsage(out)
  if (!windows.length) throw new Error(`agy /usage gave no reading: ${(err || out).trim().slice(0, 200)}`)
  return windows
}

export class Engines extends Context.Service<Engines, EnginesService>()("Engines") {
  static layer = Layer.effect(
    Engines,
    Effect.gen(function* () {
      const secrets = yield* Secrets
      return {
        run: (turn: Turn) => {
          const t = sessionless(turn)
          const { provider } = splitModel(t.model)
          if (provider === "claude-cli") return cli("claude", claudeArgs(t), transcript(t.messages), t.cwd, claudeParser())
          if (provider === "codex-cli") return cli("codex", codexArgs(t), transcript(t.messages), t.cwd, codexParser())
          const acp = ACP[provider]
          if (acp) {
            const { model } = splitModel(t.model)
            return acpRun({ ...acp(model, t.account?.home ?? null), model, cwd: t.cwd, prompt: `${t.system}\n\n${transcript(t.messages)}${imagesNotShown(t.messages)}`, access: t.access ?? "workspace", web: t.web ?? false, gatewayUrl: t.tools?.url, approve: t.approve })
          }
          // An API-key model in a chat turn runs in OpenCode (files, shell, edits, its tools) when it's installed;
          // internal tasks (summaries, titles) and machines without it keep the direct API engine.
          const p = PROVIDERS[provider]
          // ZOREL_API_ENGINE=direct keeps the direct engine (tests, or if OpenCode misbehaves).
          if (p?.kind === "api" && t.tools && process.env.ZOREL_API_ENGINE !== "direct" && which("opencode")) {
            const key = p.key ? secrets.get(p.key) : undefined
            if (p.key && !key) return one({ type: "error", message: `Set ${p.key} (in Settings or the environment) to use ${provider}.`, failure: { reason: "auth" } })
            const { model } = splitModel(t.model)
            return acpRun({
              ...ACP.opencode!("default", null),
              model: "default", // the injected config already names the model
              cwd: t.cwd,
              prompt: `${t.system}\n\n${transcript(t.messages)}${imagesNotShown(t.messages)}`,
              access: t.access ?? "workspace",
              web: t.web ?? false,
              gatewayUrl: t.tools.url,
              approve: t.approve,
              env: opencodeEnv(provider, model, { key, baseURL: COMPAT[provider]?.() })
            })
          }
          return api(secrets, t)
        },
        hasSession: (model: string) => NATIVE.has(splitModel(model).provider),
        open: (o: OpenSession) => {
          const { provider } = splitModel(o.model)
          if (provider === "claude-cli") return openClaudeSession({ ...o, configDir: o.account?.home ?? undefined })
          if (provider === "codex-cli") return openCodexSession({ ...o, home: o.account?.home ?? join(o.dataDir, "accounts", "codex-default") })
          return undefined
        }
      }
    })
  )
}
