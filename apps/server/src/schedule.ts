// Routine helpers with no runtime: cron times, webhook tokens, a run's message, and creating a routine with its
// chat (shared by the HTTP API and the agents' zorel_routines tool).
import { Cron } from "croner"
import { Effect } from "effect"
import type { Agent, RoutineWatch } from "@zorel/contracts"
import type { Repository } from "./db.ts"
const MAX_PAYLOAD = 20_000 // characters of a webhook's body that go into the message

// The next time a pattern fires after `from`, or a reason it isn't a pattern.
export function nextRun(cron: string, from = new Date()): { at: number | null } | { error: string } {
  try {
    const next = new Cron(cron, { paused: true }).nextRun(from)
    return { at: next ? next.getTime() : null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

export const newToken = () => Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64url")

// What the agent receives: the routine's prompt, with the webhook's body (or what's new on a connector) when there is one.
export function runText(name: string, prompt: string, payload?: unknown, label = "Webhook payload") {
  const body = payload === undefined || payload === null ? "" : typeof payload === "string" ? payload : JSON.stringify(payload, null, 2)
  const clipped = body.length > MAX_PAYLOAD ? `${body.slice(0, MAX_PAYLOAD)}\n[…cut]` : body
  return [`Routine "${name}":`, prompt.trim(), clipped && `${label}:\n\`\`\`\n${clipped}\n\`\`\``].filter(Boolean).join("\n\n")
}


// A routine and its own chat (the agent as its only member). Fails with the cron's error when it isn't one.
export const createRoutineFor = (store: Repository, agent: Agent, input: { name: string; prompt: string; cron: string | null; webhook: boolean; watch?: RoutineWatch | null | undefined }) =>
  Effect.gen(function* () {
    const next = input.cron === null ? { at: null } : nextRun(input.cron)
    if ("error" in next) return yield* Effect.fail(next.error)
    const chat = yield* store.createChat({ projectId: agent.projectId, agentIds: [agent.id], model: agent.model, accountId: agent.accountId, effort: agent.effort })
    yield* store.updateChat(chat.id, { title: `${input.name} (routine)` })
    return yield* store.createRoutine({ agentId: agent.id, chatId: chat.id, name: input.name, prompt: input.prompt, cron: input.cron, token: input.webhook ? newToken() : null, nextRunAt: next.at, watch: input.watch ?? null })
  })

// ---------- watching a connector ----------

const SEEN_KEPT = 1000 // keys remembered per routine: enough for any list a tool returns at once

// The items in a tool's result: a JSON list (or the first list inside a JSON object, e.g. { issues: [...] }), a
// single JSON value, or else its non-empty lines.
export function watchItems(text: string): unknown[] {
  try {
    const v: unknown = JSON.parse(text)
    if (Array.isArray(v)) return v
    if (v && typeof v === "object") return Object.values(v).find(Array.isArray) ?? [v]
    return [v]
  } catch {
    return text.split("\n").map((l) => l.trim()).filter(Boolean)
  }
}

// An item's key: its id (id, number, key, uid, url) when it has one, else all of it, so an item whose other
// fields change (a comment count, a timestamp) is still the one already seen.
const keyOf = (item: unknown) => {
  const o = item && typeof item === "object" ? (item as Record<string, unknown>) : undefined
  const id = o && ["id", "number", "key", "uid", "url"].map((k) => o[k]).find((x) => typeof x === "string" || typeof x === "number")
  return String(Bun.hash(id !== undefined ? `id:${id}` : JSON.stringify(item)))
}

// What's new since the last poll and the keys to keep. The first poll (seen null) only learns what's there.
export function freshItems(seen: ReadonlyArray<string> | null, items: ReadonlyArray<unknown>): { fresh: unknown[]; seen: string[] } {
  const keys = items.map(keyOf)
  const known = new Set(seen ?? [])
  const fresh = seen === null ? [] : items.filter((_, i) => !known.has(keys[i]!))
  return { fresh, seen: [...new Set([...keys, ...(seen ?? [])])].slice(0, SEEN_KEPT) }
}
