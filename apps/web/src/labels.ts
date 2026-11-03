// Readable labels derived from data: model and provider names, memory scopes, chat titles, live status,
// and each agent's identity tone (its position among its teammates, so colors don't repeat).
import type { Agent, Chat, Project } from "@zero/contracts"
import type { ChatStatus } from "@zero/contracts/events"
import { type MessageKey, t } from "@zero/i18n"

const has = <K extends string>(map: Record<K, unknown>, k: string): k is K => k in map

export const splitModel = (id: string) => {
  const i = id.indexOf("/")
  return i < 0 ? { provider: id, model: "" } : { provider: id.slice(0, i), model: id.slice(i + 1) }
}

const PROVIDERS = { "claude-cli": 1, "codex-cli": 1, anthropic: 1, openai: 1, openrouter: 1, ollama: 1, lmstudio: 1 }
export const providerLabel = (provider: string) => (has(PROVIDERS, provider) ? t(`model.providers.${provider}` as MessageKey) : provider)

// "claude-cli/opus" → "Opus"; "codex-cli/default" → "Default"; API models keep their id.
export function modelName(id: string): string {
  const { provider, model } = splitModel(id)
  if (model === "default") return t("common.default")
  if (provider === "claude-cli" || provider === "codex-cli") return model.charAt(0).toUpperCase() + model.slice(1)
  return model
}
// "Claude Code · Opus"
export const modelLabel = (id: string) => `${providerLabel(splitModel(id).provider)} · ${modelName(id)}`

const NOTES = { opus: 1, sonnet: 1, haiku: 1, default: 1 }
export const modelNote = (model: string) => (has(NOTES, model) ? t(`model.notes.${model}` as MessageKey) : "")

const HINTS = { "claude-cli": 1, "codex-cli": 1, anthropic: 1, openai: 1, openrouter: 1, ollama: 1, lmstudio: 1 }
export const providerHint = (provider: string) => (has(HINTS, provider) ? t(`model.hints.${provider}` as MessageKey) : "")

// Account provider that serves a model provider (multi-account subscriptions).
export const ACCOUNT_OF_MODEL: Record<string, "claude" | "codex"> = { "claude-cli": "claude", "codex-cli": "codex" }
export const MODEL_OF_ACCOUNT = { claude: "claude-cli", codex: "codex-cli" } as const
export const accountProviderOf = (model: string) => ACCOUNT_OF_MODEL[splitModel(model).provider]

// Chats start untitled; the server names them after the first message. "Novo chat" is the legacy
// placeholder stored before i18n.
export const chatTitle = (chat: Pick<Chat, "title">) => (chat.title && chat.title !== "Novo chat" ? chat.title : t("chat.untitled"))

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

export const agentName = (id: string | null, agents: ReadonlyArray<Agent>) => agents.find((a) => a.id === id)?.name ?? t("common.assistant")

export function statusLabel(status: ChatStatus, agents: ReadonlyArray<Agent>): string {
  const agent = agentName(status.agentId, agents)
  if (status.state === "running") return t("status.running", { agent })
  if (status.state === "waiting") return t("status.waiting", { agent })
  if (status.state === "failed") return t("status.failed")
  return ""
}

// @handle from an agent name: "Ana Júlia" → "ana-julia" (what the server matches in mentions).
export const handleOf = (a: Pick<Agent, "name">) =>
  a.name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "")
