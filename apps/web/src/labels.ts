// Readable labels derived from data: model and provider names, memory scopes, chat titles, live status,
// and each agent's identity tone (its position among its teammates, so colors don't repeat).
import type { Agent, Chat, ModelInfo, Project, ProviderAccount, Switch } from "@zorel/contracts"
import type { AgentWait, ChatStatus } from "@zorel/contracts/events"
import { formatTime, type MessageKey, t } from "@zorel/i18n"

const has = <K extends string>(map: Record<K, unknown>, k: string): k is K => k in map

export const splitModel = (id: string) => {
  const i = id.indexOf("/")
  return i < 0 ? { provider: id, model: "" } : { provider: id.slice(0, i), model: id.slice(i + 1) }
}

const PROVIDERS = { "claude-cli": 1, "codex-cli": 1, "gemini-cli": 1, opencode: 1, antigravity: 1, anthropic: 1, openai: 1, openrouter: 1, ollama: 1, lmstudio: 1 }
export const providerLabel = (provider: string) => (has(PROVIDERS, provider) ? t(`model.providers.${provider}` as MessageKey) : provider)

// "claude-cli/opus" → "Opus"; "codex-cli/default" → "CLI default"; API models keep their id.
// Names the subscription CLIs give their models today ("claude-cli/opus" → "Opus 5.5"), from the model list.
// The shell remembers them on every render of that list, so every label below sees the same names.
const named = new Map<string, Pick<ModelInfo, "name" | "note">>()
export function rememberModels(models: ReadonlyArray<ModelInfo>) {
  for (const m of models) if (m.name) named.set(m.id, m)
}

export function modelName(id: string): string {
  const real = named.get(id)?.name
  if (real) return real
  const { provider, model } = splitModel(id)
  if (model === "default") return t("model.cliDefault")
  // A full Claude id ("claude-sonnet-5-5") reads like the picker: "Sonnet 5.5".
  const claude = /^claude-(opus|sonnet|haiku)-(\d+)-(\d+)/.exec(model)
  if (claude) return `${claude[1]!.charAt(0).toUpperCase()}${claude[1]!.slice(1)} ${claude[2]}.${claude[3]}`
  if (provider === "claude-cli" || provider === "codex-cli") return model.charAt(0).toUpperCase() + model.slice(1)
  return model
}
// "Claude Code · Opus"
export const modelLabel = (id: string) => `${providerLabel(splitModel(id).provider)} · ${modelName(id)}`

const NOTES = { opus: 1, sonnet: 1, haiku: 1, default: 1 }
export function modelNote(id: string): string {
  const real = named.get(id)?.note
  if (real) return real
  const { model } = splitModel(id)
  return has(NOTES, model) ? t(`model.notes.${model}` as MessageKey) : ""
}

// Account provider that serves a model provider (multi-account subscriptions).
export const ACCOUNT_OF_MODEL: Record<string, "claude" | "codex"> = { "claude-cli": "claude", "codex-cli": "codex" }

// Chats start untitled; the server names them after the first message. "New chat" ("Novo chat" before) is the
// placeholder stored before i18n.
export const chatTitle = (chat: Pick<Chat, "title">) => (chat.title && chat.title !== "New chat" && chat.title !== "Novo chat" ? chat.title : t("chat.untitled"))

export function scopeLabel(scope: string, projects: ReadonlyArray<Project>, agents: ReadonlyArray<Agent>): string {
  if (scope === "user") return t("scope.user")
  const [kind, id] = scope.split(":")
  if (kind === "project") {
    const p = projects.find((x) => x.id === id)
    return p ? t("scope.project", { name: p.name }) : t("scope.unknown")
  }
  const a = agents.find((x) => x.id === id)
  return a ? t("scope.agent", { name: a.name }) : t("scope.unknown")
}

// Identity tone: position among the agents of the same project (or among the global ones).
export const agentTone = (agent: Agent, agents: ReadonlyArray<Agent>) => Math.max(0, agents.filter((a) => a.projectId === agent.projectId).findIndex((a) => a.id === agent.id))
// The agent's identity tint (styles.css: tint-1…6 set --tint; tinted, tint-text and tint-edge draw it). Whole class
// names so Tailwind sees them; six, as the avatar colors.
const TINTS = ["tint-1", "tint-2", "tint-3", "tint-4", "tint-5", "tint-6"] as const
export const tintFor = (tone: number) => TINTS[tone % TINTS.length]!
export const agentTint = (agent: Agent, agents: ReadonlyArray<Agent>) => tintFor(agentTone(agent, agents))

export const agentName = (id: string | null, agents: ReadonlyArray<Agent>) => agents.find((a) => a.id === id)?.name ?? t("common.assistant")

export function statusLabel(status: ChatStatus, agents: ReadonlyArray<Agent>): string {
  const agent = agentName(status.agentId, agents)
  if (status.state === "running") return t("status.running", { agent })
  if (status.state === "waiting") return status.label === "question" ? t("status.asking", { agent }) : t("status.waiting", { agent }) // "question": the server's mark for zorel_ask_user
  if (status.state === "failed") return t("status.failed")
  const wait = status.waits?.[0]
  return wait ? waitLabel(wait, agents) : ""
}

// "Leo waits for Iris" / "Leo waits for Iris and Nico".
export const waitLabel = (w: AgentWait, agents: ReadonlyArray<Agent>) =>
  t("status.waitsFor", { agent: agentName(w.agentId, agents), other: new Intl.ListFormat(undefined, { type: "conjunction" }).format(w.on.map((id) => agentName(id, agents))) })

// @handle from an agent name: "Ana Júlia" → "ana-julia" (what the server matches in mentions).
export const handleOf = (a: Pick<Agent, "name">) =>
  a.name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "")

// A failover route for people: "Claude · work · Opus" for a subscription account, "Anthropic · claude-…" otherwise.
function routeLabel(model: string, accountId: string | null, accounts: ReadonlyArray<ProviderAccount>): string {
  const provider = ACCOUNT_OF_MODEL[splitModel(model).provider]
  const mine = provider ? accounts.filter((a) => a.provider === provider) : []
  const account = mine.find((a) => a.id === accountId) ?? mine.find((a) => a.isDefault)
  return account && mine.length > 1 ? `${account.label} · ${modelName(model)}` : modelLabel(model)
}

// "Claude · personal · Opus hit its limit until 14:30, continuing with Codex · Default"
export function switchText(sw: Switch, accounts: ReadonlyArray<ProviderAccount>): string {
  const why = sw.reason === "limit" ? t("failover.why.limit", { time: sw.until ? formatTime(sw.until) : "?" }) : t(`failover.why.${sw.reason}`)
  return t("failover.switched", { from: routeLabel(sw.fromModel, sw.fromAccountId, accounts), why, to: routeLabel(sw.toModel, sw.toAccountId, accounts) })
}

// A limit window's name: "5-hour", "Weekly", "Weekly · Opus", "30-day", or the model a window is scoped to.
const NAMED_WINDOWS = { five_hour: 1, seven_day: 1, seven_day_opus: 1, seven_day_sonnet: 1, seven_day_oauth_apps: 1 }
export function windowLabel(id: string): string {
  if (has(NAMED_WINDOWS, id)) return t(`usage.windows.${id}` as MessageKey)
  if (id.startsWith("model:")) return id.slice(6)
  // A length scoped to a group of models ("300m:Gemini" → "Gemini · 5 hours").
  const scoped = /^(\d+m):(.+)$/.exec(id)
  if (scoped) return `${scoped[2]} · ${windowLabel(scoped[1]!)}`
  const minutes = Number(id.replace(/m$/, ""))
  if (!Number.isFinite(minutes)) return id
  return minutes % 1440 === 0 ? t("usage.windows.days", { count: minutes / 1440 }) : t("usage.windows.hours", { count: Math.round(minutes / 60) })
}

// How long a window lasts, in minutes (null for one scoped to a model), to order windows longest first.
const WINDOW_MINUTES: Record<string, number> = { five_hour: 300, seven_day: 10080, seven_day_opus: 10080, seven_day_sonnet: 10080, seven_day_oauth_apps: 10080 }
export function windowMinutes(id: string): number | null {
  if (id.startsWith("model:")) return null
  const minutes = WINDOW_MINUTES[id] ?? Number(id.replace(/m(:.*)?$/, ""))
  return Number.isFinite(minutes) ? minutes : null
}

// How a limit window is going at `now`: used and elapsed (0..1) and, when the burn so far would empty it before
// it resets, roughly when. No projection in the window's first tenth: too little to go on.
// ponytail: a straight line from the window's start; a recent-rate estimate needs readings over time.
export interface Pace {
  readonly used: number
  readonly elapsed: number | null
  readonly runsOutAt: number | null
  readonly risk: number // > 1 when it runs out early; otherwise how full it is
}
export function paceOf(w: { id: string; usedPercent: number; resetsAt: number | null }, now = Date.now()): Pace {
  const used = w.usedPercent / 100
  const minutes = windowMinutes(w.id)
  if (!minutes || !w.resetsAt) return { used, elapsed: null, runsOutAt: null, risk: used }
  const length = minutes * 60_000
  const start = w.resetsAt - length
  const elapsed = Math.max(0, Math.min(1, (now - start) / length))
  const out = used > 0 && elapsed >= 0.1 ? start + (now - start) / used : null
  const runsOutAt = out !== null && out < w.resetsAt ? out : null
  return { used, elapsed, runsOutAt, risk: runsOutAt ? 1 + (w.resetsAt - runsOutAt) / length : used }
}

// The fullest window of an account (0..1), for alerts and compact meters.
export const fullest = (a: Pick<ProviderAccount, "usage">) => Math.max(0, ...(a.usage?.windows ?? []).map((w) => w.usedPercent / 100))

let money: Intl.NumberFormat | undefined
// $0.0042 for small amounts, $1.24 otherwise.
export function formatCost(usd: number): string {
  money ??= new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 })
  return usd > 0 && usd < 0.01 ? `$${usd.toPrecision(2)}` : money.format(usd)
}

// A command line as a shell would split it, for the usual cases: words, "double" or 'single' quoted arguments.
export const splitCommand = (line: string) => [...line.trim().matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "")

// What deserves a notification when a chat's state changes from `before` to `now`.
export function noteworthy(before: ChatStatus["state"] | undefined, now: ChatStatus["state"]): "waiting" | "failed" | "done" | undefined {
  if (now === before) return undefined
  if (now === "waiting" || now === "failed") return now
  if (now === "idle" && before === "running") return "done"
  return undefined
}

// Minutes since midnight as "09:30", and back.
export const hm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
export const toMinutes = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5))
