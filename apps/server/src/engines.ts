// Engines: quem executa um turno. Duas famílias atrás da mesma interface:
// - assinatura: a CLI oficial do usuário (Claude Code, Codex), sem sessão própria
//   (--no-session-persistence / --ephemeral): o contexto é sempre montado por nós.
//   Nunca lemos nem guardamos o login OAuth dessas CLIs (termos dos providers).
// - api: chamada direta com token via effect/ai (Anthropic, OpenAI, OpenRouter, Ollama…).
// Como o contexto é nosso, trocar de modelo entre turnos não exige handoff.
// Ferramentas chegam sempre pelo gateway MCP do Zero (tools.ts); as CLIs não recebem nenhuma outra.
// Argumentos e parsers das CLIs derivam do Tucano (Apache-2.0), ver NOTICE.
import { AnthropicClient, AnthropicLanguageModel } from "@effect/ai-anthropic"
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai-compat"
import type { ModelInfo } from "@zero/contracts"
import { Context, Effect, Layer, Queue, Redacted, Stream } from "effect"
import { LanguageModel, Prompt, Tool, Toolkit } from "effect/ai"
import { FetchHttpClient } from "effect/http"
import { Secrets, type SecretStore } from "./secrets.ts"
import { resultText, type Session, type ToolDef } from "./tools.ts"

export interface TurnMessage {
  readonly role: "user" | "assistant"
  readonly text: string
  readonly at?: number // ordem no chat: a marcação da sessão nativa compara por aqui
}

export interface TurnTools {
  readonly url: string // sessão do gateway MCP para as CLIs
  readonly defs: ReadonlyArray<ToolDef>
  readonly call: Session["call"] // o mesmo caminho, chamado direto pelo engine de API
}

export interface Turn {
  readonly model: string // "<provider>/<modelo>"
  readonly system: string // stable + dynamic: o que um engine sem sessão recebe
  readonly stable?: string // parte que abre uma sessão nativa
  readonly dynamic?: string // parte que vai junto da mensagem a cada turno numa sessão nativa
  readonly messages: ReadonlyArray<TurnMessage> // termina numa mensagem do usuário
  readonly cwd: string // diretório vazio: a CLI não recebe arquivos de ninguém
  readonly tools?: TurnTools | undefined
}

export interface Usage {
  readonly inputTokens: number
  readonly outputTokens: number
}

export type EngineEvent =
  | { readonly type: "text"; readonly delta: string }
  | { readonly type: "done"; readonly usage: Usage }
  | { readonly type: "error"; readonly message: string }

const one = (e: EngineEvent): Stream.Stream<EngineEvent> => Stream.make(e)
export const MAX_TOOL_STEPS = 12

// ---------- providers ----------

type Provider = {
  readonly kind: "subscription" | "api"
  readonly hint: string
  readonly suggestions: ReadonlyArray<string>
  readonly key?: string // nome da chave de API (env ou chaveiro)
  readonly bin?: string // CLI de assinatura
  readonly local?: true // servidor local: disponível só se responder, e os modelos vêm dele
}

// Bases OpenAI-compatíveis. Ollama/LM Studio rodam local e não pedem chave.
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

// Modelos que um servidor OpenAI-compatível local lista; undefined se não responde.
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

// Sugestões conhecidas (ou as que o servidor local lista) + "<provider>/…" livre: qualquer modelo pode ser digitado.
export async function listModels(secrets: SecretStore): Promise<ModelInfo[]> {
  const entries = Object.entries(PROVIDERS)
  const found = await Promise.all(entries.map(([id, p]) => (p.local ? probe(COMPAT[id]!()) : Promise.resolve(undefined))))
  return entries.flatMap(([provider, p], i) => {
    const local = found[i]
    const available = p.local ? !!local : p.key ? !!secrets.get(p.key) : !!Bun.which(p.bin!)
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

// Histórico vira transcrição: a CLI recebe um único prompt por turno.
export function transcript(messages: ReadonlyArray<TurnMessage>): string {
  const last = messages.at(-1)!
  const before = messages.slice(0, -1)
  if (!before.length) return last.text
  const lines = before.map((m) => `<${m.role}>\n${m.text}\n</${m.role}>`).join("\n")
  return `Conversa até aqui, da mais antiga para a mais nova:\n${lines}\n\nNova mensagem do usuário:\n${last.text}`
}

const GATEWAY = "zero"

export const claudeArgs = (t: Turn) => [
  "-p",
  "--output-format", "stream-json",
  "--verbose",
  "--include-partial-messages",
  "--model", splitModel(t.model).model,
  "--system-prompt", t.system,
  "--tools", "", // sem shell nem arquivos: só conversa e as ferramentas do gateway
  "--strict-mcp-config",
  "--setting-sources", "", // ignora hooks, plugins e permissões do usuário
  "--no-session-persistence",
  ...(t.tools
    ? ["--mcp-config", JSON.stringify({ mcpServers: { [GATEWAY]: { type: "http", url: t.tools.url } } }), "--allowedTools", `mcp__${GATEWAY}`] // o gateway decide
    : [])
]

export function claudeParser(): Parser {
  let finished = false
  let wrote = false
  let newCall = false
  return {
    line(line) {
      const ev = json(line)
      if (!ev) return []
      if (ev.type === "stream_event") {
        const e = ev.event ?? {}
        if (e.type === "message_start") newCall = true
        const d = e.delta
        if (e.type === "content_block_delta" && d?.type === "text_delta" && typeof d.text === "string") {
          const sep = newCall && wrote ? "\n\n" : "" // texto antes/depois de ferramentas vira parágrafo
          newCall = false
          wrote = true
          return [{ type: "text", delta: sep + d.text }]
        }
        return []
      }
      if (ev.type !== "result") return []
      finished = true
      if (ev.is_error === true || ev.subtype !== "success") return [{ type: "error", message: (typeof ev.result === "string" && ev.result) || `Claude Code terminou com erro (${ev.subtype}).` }]
      const u = ev.usage ?? {}
      return [{ type: "done", usage: { inputTokens: num(u.input_tokens) + num(u.cache_read_input_tokens) + num(u.cache_creation_input_tokens), outputTokens: num(u.output_tokens) } }]
    },
    end(code, stderr) {
      return finished ? [] : [{ type: "error", message: `Claude Code saiu sem resposta (código ${code ?? "?"}).\n${tail(stderr)}`.trim() }]
    }
  }
}

// Codex sem ferramentas próprias, sem config/regras do usuário e sem sessão salva.
const CODEX_DISABLED = ["shell_tool", "unified_exec", "apps", "plugins", "browser_use", "computer_use", "image_generation", "multi_agent", "view_image", "hooks", "memories"]
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
          "-c", `mcp_servers.${GATEWAY}.default_tools_approval_mode="approve"`, // o gateway decide
          "-c", `mcp_servers.${GATEWAY}.tool_timeout_sec=900` // aprovação humana pode demorar
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
        return [{ type: "error", message: ev.error?.message || ev.message || "Codex terminou com erro." }]
      }
      return []
    },
    end(code, stderr) {
      return finished ? [] : [{ type: "error", message: `Codex saiu sem resposta (código ${code ?? "?"}).\n${tail(stderr)}`.trim() }]
    }
  }
}

// Roda a CLI e transforma cada linha do stdout em eventos. Interromper o stream mata o processo.
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
  if (!path) return one({ type: "error", message: `${bin} não está instalado ou não está no PATH.` })
  return Stream.fromAsyncIterable(runCli(path, args, stdin, cwd, parser), (e) => e).pipe(Stream.catch((e) => one({ type: "error", message: String(e) })))
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

// Ferramentas do gateway como toolkit do effect/ai; o handler passa pelo mesmo `call` (política e aprovação).
function toolkitOf(tools: TurnTools) {
  const kit = Toolkit.make(...tools.defs.map((d) => Tool.dynamic(d.name, { description: d.description, parameters: { type: "object", ...d.inputSchema } as any })))
  const handlers = Object.fromEntries(
    tools.defs.map((d) => [d.name, (params: unknown) => Effect.promise(() => tools.call(d.name, (params ?? {}) as Record<string, unknown>)).pipe(Effect.map(resultText))])
  )
  return (kit as any).pipe(Effect.provide(kit.toLayer(handlers as any))) as Effect.Effect<any>
}

// Loop de ferramentas: enquanto o modelo pedir ferramenta, roda e devolve o resultado, até MAX_TOOL_STEPS.
const api = (secrets: SecretStore, t: Turn): Stream.Stream<EngineEvent> => {
  const { provider, model } = splitModel(t.model)
  const layer = apiLayer(secrets, provider, model)
  if (typeof layer === "string") return one({ type: "error", message: layer })
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
              } else if (part.type === "error") Queue.offerUnsafe(q, { type: "error", message: String(part.error) })
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
          Queue.offerUnsafe(q, { type: "error", message: e?.message ?? String(e) })
          Queue.endUnsafe(q)
        })
      )
    )
  )
}

// ---------- serviço ----------

export class Engines extends Context.Service<Engines, { readonly run: (turn: Turn) => Stream.Stream<EngineEvent> }>()("Engines") {
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
        }
      }
    })
  )
}
