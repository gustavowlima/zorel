// Engines: what runs a turn. Two families behind the same interface:
// - subscription: the user's official CLI (Claude Code, Codex), without its own session
//   (--no-session-persistence / --ephemeral): the context is always built by us.
//   We never read or store these CLIs' OAuth login (provider terms).
// - api: direct call with a token via effect/ai (Anthropic, OpenAI, OpenRouter, Ollama…).
// Since the context is ours, switching models between turns needs no handoff.
// Tools always come through Zero's MCP gateway (tools.ts); the CLIs get no others.
// CLI arguments and parsers derive from Tucano (Apache-2.0), see NOTICE.
import { AnthropicClient, AnthropicLanguageModel } from "@effect/ai-anthropic"
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai-compat"
import type { Access, AccountWindow, FailureReason, ModelInfo } from "@zero/contracts"
import { Context, Effect, Layer, Queue, Redacted, Stream } from "effect"
import { LanguageModel, Prompt, Tool, Toolkit } from "effect/ai"
import { FetchHttpClient } from "effect/http"
import { readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { openClaudeSession } from "#server/engines/claude-sdk.ts"
import { openCodexSession } from "#server/engines/codex.ts"
import type { Approver } from "#server/engines/session.ts"
import type { EngineSession } from "#server/engines/session.ts"
import { Secrets, type SecretStore } from "./secrets.ts"
import { resultText, type Session, type ToolDef } from "./tools.ts"

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
  readonly system: string // stable + dynamic: what a sessionless engine receives
  readonly stable?: string // part that opens a native session
  readonly dynamic?: string // part sent with the message each turn in a native session
  readonly messages: ReadonlyArray<TurnMessage> // ends with a user message
  readonly cwd: string // empty directory: the CLI gets nobody's files
  readonly tools?: TurnTools | undefined
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
  | { readonly type: "done"; readonly usage: Usage }
  | { readonly type: "error"; readonly message: string; readonly failure?: EngineFailure | undefined }
  // A limit reading of the account the session runs on (Claude rate_limit_event, Codex account/rateLimits).
  | { readonly type: "limits"; readonly windows: ReadonlyArray<AccountWindow> }
  // A native tool call (read, edit, command…): sent when it starts and again when it ends, same id.
  | { readonly type: "step"; readonly step: NativeStep }

export interface NativeStep {
  readonly id: string
  readonly kind: "read" | "edit" | "run" | "search" | "tool"
  readonly title: string // "Read src/a.ts", "bun test"
  readonly files: ReadonlyArray<string> // relative to the workspace
  readonly status: "running" | "ok" | "error" | "refused"
  readonly output: string // start of the result
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
export const MAX_TOOL_STEPS = 12

// ---------- providers ----------

type Provider = {
  readonly kind: "subscription" | "api"
  readonly hint: string
  readonly suggestions: ReadonlyArray<string>
  readonly key?: string // API key name (env or keychain)
  readonly bin?: string // subscription CLI
  readonly local?: true // local server: available only if it responds, and models come from it
}

// OpenAI-compatible base URLs. Ollama/LM Studio run locally and need no key.
const COMPAT: Record<string, () => string> = {
  openai: () => process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  openrouter: () => "https://openrouter.ai/api/v1",
  ollama: () => process.env.OLLAMA_URL ?? "http://localhost:11434/v1",
  lmstudio: () => process.env.LMSTUDIO_URL ?? "http://localhost:1234/v1"
}

export const PROVIDERS: Record<string, Provider> = {
  "claude-cli": { kind: "subscription", hint: "Claude Code logado (claude auth login)", suggestions: ["sonnet", "opus", "haiku"], bin: "claude" },
  "codex-cli": { kind: "subscription", hint: "Codex logado (codex login); 'default' usa o modelo padrão dele", suggestions: ["default"], bin: "codex" },
  anthropic: { kind: "api", hint: "ANTHROPIC_API_KEY", suggestions: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"], key: "ANTHROPIC_API_KEY" },
  openai: { kind: "api", hint: "OPENAI_API_KEY (OPENAI_BASE_URL opcional)", suggestions: [], key: "OPENAI_API_KEY" },
  openrouter: { kind: "api", hint: "OPENROUTER_API_KEY", suggestions: [], key: "OPENROUTER_API_KEY" },
  ollama: { kind: "api", hint: "Ollama rodando (OLLAMA_URL)", suggestions: [], local: true },
  lmstudio: { kind: "api", hint: "LM Studio rodando (LMSTUDIO_URL)", suggestions: [], local: true }
}

export function splitModel(id: string): { provider: string; model: string } {
  const i = id.indexOf("/")
  return { provider: id.slice(0, i), model: id.slice(i + 1) }
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
    const available = p.local ? !!local : p.key ? !!secrets.get(p.key) : !!Bun.which(p.bin!)
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
  if (isImage(f)) return `[imagem anexada: ${f.name}]`
  const textual = /^text\/|json|xml|yaml|toml|javascript|typescript/.test(f.mime) || /\.(md|txt|csv|ts|tsx|js|json|ya?ml|toml|py|go|rs|sql|sh)$/i.test(f.name)
  if (textual) {
    try {
      if (statSync(f.path).size <= TEXT_INLINE_BYTES) return `<arquivo nome="${f.name}">\n${readFileSync(f.path, "utf8")}\n</arquivo>`
    } catch {
      // gone from disk: fall back to the name
    }
  }
  return `[arquivo anexado: ${f.name} (${f.mime})]`
}
const withFiles = (m: TurnMessage) => (m.files?.length ? `${m.text}\n\n${m.files.map(fileNote).join("\n")}` : m.text)

export function transcript(messages: ReadonlyArray<TurnMessage>): string {
  const last = messages.at(-1)!
  const before = messages.slice(0, -1)
  if (!before.length) return withFiles(last)
  const lines = before.map((m) => `<${m.role}>\n${withFiles(m)}\n</${m.role}>`).join("\n")
  return `Conversa até aqui, da mais antiga para a mais nova:\n${lines}\n\nNova mensagem do usuário:\n${withFiles(last)}`
}

const GATEWAY = "zero"

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
    ? ["--mcp-config", JSON.stringify({ mcpServers: { [GATEWAY]: { type: "http", url: t.tools.url } } }), "--allowedTools", `mcp__${GATEWAY}`] // the gateway decides
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
        return []
      }
      if (ev.type !== "result") return []
      finished = true
      if (ev.is_error === true || ev.subtype !== "success") {
        const message = (typeof ev.result === "string" && ev.result) || `Claude Code terminou com erro (${ev.subtype}).`
        const mapped = errorCode ? CLAUDE_ERRORS[errorCode] : undefined
        const failure: EngineFailure | undefined = rejectedUntil ? { reason: "limit", until: rejectedUntil } : mapped ? { reason: mapped } : errorCode ? undefined : classifyMessage(message)
        return [{ type: "error", message, failure }]
      }
      const u = ev.usage ?? {}
      return [{ type: "done", usage: { inputTokens: num(u.input_tokens) + num(u.cache_read_input_tokens) + num(u.cache_creation_input_tokens), outputTokens: num(u.output_tokens), cachedTokens: num(u.cache_read_input_tokens) } }]
    },
    end(code, stderr) {
      return finished ? [] : [{ type: "error", message: `Claude Code saiu sem resposta (código ${code ?? "?"}).\n${tail(stderr)}`.trim(), failure: classifyMessage(stderr) ?? { reason: "unavailable" } }]
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
      if (ev.type === "turn.completed") {
        finished = true
        const u = ev.usage ?? {}
        return [{ type: "done", usage: { inputTokens: num(u.input_tokens), outputTokens: num(u.output_tokens) } }]
      }
      if (ev.type === "turn.failed" || ev.type === "error") {
        finished = true
        const message = ev.error?.message || ev.message || "Codex terminou com erro."
        return [{ type: "error", message, failure: classifyMessage(message) }]
      }
      return []
    },
    end(code, stderr) {
      return finished ? [] : [{ type: "error", message: `Codex saiu sem resposta (código ${code ?? "?"}).\n${tail(stderr)}`.trim(), failure: classifyMessage(stderr) ?? { reason: "unavailable" } }]
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
  const path = Bun.which(bin)
  if (!path) return one({ type: "error", message: `${bin} não está instalado ou não está no PATH.`, failure: { reason: "unavailable" } })
  return Stream.fromAsyncIterable(runCli(path, args, stdin, cwd, parser), (e) => e).pipe(Stream.catch((e) => one({ type: "error", message: String(e), failure: classifyMessage(String(e)) })))
}

// ---------- API (effect/ai) ----------

function apiLayer(secrets: SecretStore, provider: string, model: string): Layer.Layer<LanguageModel.LanguageModel> | string {
  const p = PROVIDERS[provider]
  if (p?.kind !== "api") return `Provider desconhecido: ${provider}.`
  const key = p.key ? secrets.get(p.key) : undefined
  if (p.key && !key) return `Defina ${p.key} (em Configurações ou no ambiente) para usar ${provider}.`
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

export interface OpenSession {
  readonly model: string
  readonly system: string // stable part of the context
  readonly cwd: string
  readonly gatewayUrl: string // stable for the session; the runtime swaps the tools behind it each turn
  readonly dataDir: string // where Zero-owned account folders live (e.g. CODEX_HOME)
  readonly account?: { readonly id: string; readonly home: string | null } | undefined // §6.1: whose login runs this session
  readonly access: Access // §9.2: what the agent may do in `cwd` without asking
  readonly approve: Approver // asks the person (the approval card) for a native call
}

export interface EnginesService {
  // Stateless: every call gets the whole layered context (API engines, CLIs without a session, consolidation).
  readonly run: (turn: Turn) => Stream.Stream<EngineEvent>
  // Native session for providers that have one; undefined = use `run`; string = could not open (shown as the turn error).
  readonly open?: (o: OpenSession) => EngineSession | string | undefined
  readonly hasSession?: (model: string) => boolean
}

const NATIVE = new Set(["claude-cli", "codex-cli"])

export class Engines extends Context.Service<Engines, EnginesService>()("Engines") {
  static layer = Layer.effect(
    Engines,
    Effect.gen(function* () {
      const secrets = yield* Secrets
      return {
        run: (t: Turn) => {
          const { provider } = splitModel(t.model)
          if (provider === "claude-cli") return cli("claude", claudeArgs(t), transcript(t.messages), t.cwd, claudeParser())
          if (provider === "codex-cli") return cli("codex", codexArgs(t), transcript(t.messages), t.cwd, codexParser())
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
