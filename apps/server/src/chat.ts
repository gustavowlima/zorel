// Contexto de um turno (camadas) e consolidação (aprendizado contínuo). O turno em si roda em runtime.ts.
import type { Agent, Chat } from "@zero/contracts"
import { Context, Data, Effect, Layer, Stream } from "effect"
import { join } from "node:path"
import {
  buildTurn, CONSOLIDATION_SYSTEM, consolidationPrompt, MAX_AFTER, parseConsolidation, pinned, RETRIEVED, scopesOf, SKILL_BODIES, WINDOW
} from "./context.ts"
import { Store, type Repository } from "./db.ts"
import { Engines, type EngineEvent, type TurnTools } from "./engines.ts"

export class NotFound extends Data.TaggedError("NotFound")<{}> {}
export class Busy extends Data.TaggedError("Busy")<{}> {}

// Onde as CLIs rodam: diretórios vazios por chat, dentro da pasta de dados.
export class DataDir extends Context.Service<DataDir, string>()("DataDir") {
  static layer = (dir: string) => Layer.succeed(DataDir, dir)
}

const MAX_PENDING = 20 // propostas esperando revisão; acima disso a consolidação só atualiza o resumo
const consolidating = new Set<string>()

export const members = (store: Repository, chat: Chat) =>
  Effect.forEach(chat.agentIds, store.agent).pipe(Effect.map((xs) => xs.filter((a): a is Agent => !!a)))

// ---------- contexto ----------

export const prepare = (store: Repository, chat: Chat, agent: Agent | undefined, model: string, dataDir: string, tools: TurnTools | undefined) =>
  Effect.gen(function* () {
    const scopes = scopesOf(chat, agent?.id ?? null)
    const fixed = pinned(yield* store.activeMemories(scopes))
    const messages = yield* store.messagesAfter(chat.id, chat.summaryUntil)
    const last = messages.at(-1)?.text ?? ""
    return buildTurn({
      chat,
      model,
      project: chat.projectId ? yield* store.project(chat.projectId) : undefined,
      agent,
      members: yield* members(store, chat),
      pinned: fixed,
      retrieved: yield* store.searchMemories(scopes, last, fixed.map((m) => m.id), RETRIEVED),
      skills: { all: yield* store.activeMemories(scopes, "skill"), relevant: yield* store.searchMemories(scopes, last, [], SKILL_BODIES, "skill") },
      messages,
      cwd: join(dataDir, "runs", chat.id),
      tools
    })
  })

// ---------- consolidação (aprendizado contínuo) ----------

const collect = (events: Stream.Stream<EngineEvent>) =>
  Stream.runFold(events, () => ({ text: "", error: undefined as string | undefined }), (acc, ev) =>
    ev.type === "text" ? { ...acc, text: acc.text + ev.delta } : ev.type === "error" ? { ...acc, error: ev.message } : acc
  )

// Dobra o que sai da janela no resumo e propõe memórias e skills (pendentes até o usuário aprovar).
// O escopo "agent" vai para o líder do chat. force: resume tudo até agora ("Compactar").
export const consolidate = Effect.fn("consolidate")(function* (chatId: string, force = false) {
  const store = yield* Store
  const engines = yield* Engines
  const dataDir = yield* DataDir
  const chat = yield* store.chat(chatId)
  if (!chat) return yield* new NotFound()
  if (consolidating.has(chatId)) return yield* new Busy()
  const after = (yield* store.messagesAfter(chat.id, chat.summaryUntil)).filter((m) => m.text.trim())
  const chunk = force ? after : after.length > MAX_AFTER ? after.slice(0, after.length - WINDOW) : []
  if (!chunk.length) return chat

  consolidating.add(chatId)
  return yield* Effect.gen(function* () {
    const lead = chat.agentIds[0] ?? null
    const scopes = scopesOf(chat, lead)
    const agents = yield* members(store, chat)
    const existing = yield* store.activeMemories(scopes)
    const skills = yield* store.activeMemories(scopes, "skill")
    const forgotten = yield* store.forgottenMemories(scopes)
    const result = yield* collect(
      engines.run({
        model: process.env.ZERO_MEMORY_MODEL || chat.model,
        system: CONSOLIDATION_SYSTEM,
        messages: [{
          role: "user",
          text: consolidationPrompt({
            summary: chat.summary, chunk, existing, skills, forgotten,
            hasProject: !!chat.projectId, hasAgent: !!lead, names: (id) => agents.find((a) => a.id === id)?.name ?? "assistente"
          })
        }],
        cwd: join(dataDir, "runs", "_memory")
      })
    )
    const allowed = ["user", ...(chat.projectId ? ["project"] : []), ...(lead ? ["agent"] : [])]
    const parsed = result.error ? undefined : parseConsolidation(result.text, allowed)
    if (!parsed) {
      yield* Effect.logWarning("consolidação falhou", result.error ?? result.text.slice(0, 300))
      return chat
    }
    const scopeOf = { user: "user", project: `project:${chat.projectId}`, agent: `agent:${lead}` }
    yield* store.setSummary(chat.id, parsed.summary, chunk.at(-1)!.at)
    // Teto de pendentes: a revisão humana é o gargalo; acima dele, propostas novas são descartadas.
    const proposals = [
      ...parsed.memories.map((m) => ({ scope: scopeOf[m.scope], kind: "fact" as const, title: "", text: m.text })),
      ...parsed.skills.map((s) => ({ scope: scopeOf[s.scope], kind: "skill" as const, title: s.title, text: s.text }))
    ]
    const room = Math.max(0, MAX_PENDING - (yield* store.pendingCount(scopes)))
    if (proposals.length > room) yield* Effect.logInfo("propostas acima do teto de pendentes; excedentes descartadas", { room, proposed: proposals.length })
    for (const p of proposals.slice(0, room)) yield* store.addMemory({ ...p, state: "pending", origin: "auto", chatId: chat.id })
    return (yield* store.chat(chat.id))!
  }).pipe(Effect.ensuring(Effect.sync(() => consolidating.delete(chatId))))
})
