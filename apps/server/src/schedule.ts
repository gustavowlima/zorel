// Routine helpers with no runtime: cron times, webhook tokens, a run's message, and creating a routine with its
// chat (shared by the HTTP API and the agents' zero_routines tool).
import { Cron } from "croner"
import { Effect } from "effect"
import type { Agent } from "@zero/contracts"
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

// What the agent receives: the routine's prompt, with the webhook's body when there is one.
export function runText(name: string, prompt: string, payload?: unknown) {
  const body = payload === undefined || payload === null ? "" : typeof payload === "string" ? payload : JSON.stringify(payload, null, 2)
  const clipped = body.length > MAX_PAYLOAD ? `${body.slice(0, MAX_PAYLOAD)}\n[…cut]` : body
  return [`Routine "${name}":`, prompt.trim(), clipped && `Webhook payload:\n\`\`\`\n${clipped}\n\`\`\``].filter(Boolean).join("\n\n")
}


// A routine and its own chat (the agent as its only member). Fails with the cron's error when it isn't one.
export const createRoutineFor = (store: Repository, agent: Agent, input: { name: string; prompt: string; cron: string | null; webhook: boolean }) =>
  Effect.gen(function* () {
    const next = input.cron === null ? { at: null } : nextRun(input.cron)
    if ("error" in next) return yield* Effect.fail(next.error)
    const chat = yield* store.createChat({ projectId: agent.projectId, agentIds: [agent.id], model: agent.model, accountId: agent.accountId, effort: agent.effort })
    yield* store.updateChat(chat.id, { title: `${input.name} (routine)` })
    return yield* store.createRoutine({ agentId: agent.id, chatId: chat.id, name: input.name, prompt: input.prompt, cron: input.cron, token: input.webhook ? newToken() : null, nextRunAt: next.at })
  })
