// Turn context (layers) and consolidation (continuous learning). The turn itself runs in runtime.ts.
import { asMemory, picked } from "./file-skills.ts"
import { type Agent, type Chat, namedSkills, type Project } from "@zorel/contracts"
import { Context, Data, Effect, Layer, Stream } from "effect"
import { join } from "node:path"
import {
  buildTurn, CONSOLIDATION_SYSTEM, consolidationPrompt, MAX_AFTER, parseConsolidation, pinned, RETRIEVED, scopesOf, SKILL_BODIES, WINDOW
} from "./context.ts"
import { Store, type Repository } from "./db.ts"
import { Engines, type EngineEvent, type TurnTools } from "./engines.ts"

export class NotFound extends Data.TaggedError("NotFound")<{}> {}
export class Busy extends Data.TaggedError("Busy")<{}> {}

// Where the CLIs run: empty directories per chat, inside the data folder.
export class DataDir extends Context.Service<DataDir, string>()("DataDir") {
  static layer = (dir: string) => Layer.succeed(DataDir, dir)
}

const MAX_PENDING = 20 // proposals awaiting review; above this, consolidation only updates the summary
const consolidating = new Set<string>()

export const members = (store: Repository, chat: Chat) =>
  Effect.forEach(chat.agentIds, store.agent).pipe(Effect.map((xs) => xs.filter((a): a is NonNullable<typeof a> => !!a)))

// ---------- context ----------

// `cwd`: where the agent works (the project folder, or the chat's empty Zorel folder; see Workspace).
export const prepare = (store: Repository, chat: Chat, agent: Agent | undefined, model: string, dataDir: string, tools: TurnTools | undefined, cwd = join(dataDir, "runs", chat.id)) =>
  Effect.gen(function* () {
    const scopes = scopesOf(chat, agent?.id ?? null)
    const fixed = pinned(yield* store.activeMemories(scopes))
    const messages = yield* store.messagesAfter(chat.id, chat.summaryUntil)
    const last = messages.at(-1)?.text ?? ""
    // Zorel's skills, then the ones picked from this computer's files (title and purpose; read on demand).
    const all = [...(yield* store.activeMemories(scopes, "skill")), ...picked(yield* store.preference("fileSkills")).map(asMemory)]
    // Skills named with $handle in the message come with their steps, ahead of the ones search finds.
    const named = namedSkills(last, all)
    const found = yield* store.searchMemories(scopes, last, named.map((s) => s.id), SKILL_BODIES, "skill")
    return buildTurn({
      chat,
      model,
      project: projectFor(chat, chat.projectId ? yield* store.project(chat.projectId) : undefined), // its worktree's folder, if any
      agent,
      members: yield* members(store, chat),
      pinned: fixed,
      retrieved: yield* store.searchMemories(scopes, last, fixed.map((m) => m.id), RETRIEVED),
      skills: { all, relevant: [...named, ...found].slice(0, Math.max(SKILL_BODIES, named.length)) },
      pages: yield* store.pinnedPages(scopes),
      messages,
      cwd,
      filesDir: join(dataDir, "attachments", chat.id),
      tools
    })
  })

// The project as a chat sees it: a chat in a git worktree works (and is checkpointed) in the worktree's folder.
// The shadow repository is the project's either way; trees are content, so diffs and undo hold across folders.
export const projectFor = (chat: { readonly worktree: string | null }, project: Project | undefined): Project | undefined =>
  project && chat.worktree && project.path ? { ...project, path: chat.worktree } : project

// One question to a model, no tools, no history: its whole answer (git drafts).
export const ask = Effect.fn("ask")(function* (model: string, text: string) {
  const engines = yield* Engines
  const dataDir = yield* DataDir
  return yield* collect(engines.run({ model, system: "", messages: [{ role: "user", text }], cwd: join(dataDir, "runs", "_ask") }))
})

// ---------- consolidation (continuous learning) ----------

const collect = (events: Stream.Stream<EngineEvent>) =>
  Stream.runFold(events, () => ({ text: "", error: undefined as string | undefined }), (acc, ev) =>
    ev.type === "text" ? { ...acc, text: acc.text + ev.delta } : ev.type === "error" ? { ...acc, error: ev.message } : acc
  )

// Folds what leaves the window into the summary and proposes memories and skills (pending until the user approves).
// The "agent" scope goes to the chat leader. force: summarizes everything so far ("Compact").
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
        model: process.env.ZOREL_MEMORY_MODEL || chat.model,
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
    const parsed = result.error ? undefined : parseConsolidation(result.text, allowed, (n) => chunk[n - 1]?.role === "user")
    if (!parsed) {
      yield* Effect.logWarning("consolidation failed", result.error ?? result.text.slice(0, 300))
      return chat
    }
    const scopeOf = { user: "user", project: `project:${chat.projectId}`, agent: `agent:${lead}` }
    yield* store.setSummary(chat.id, parsed.summary, chunk.at(-1)!.at)
    yield* store.confirmMemories(parsed.confirm.flatMap((i) => (existing[i] ? [existing[i].id] : [])))
    // Pending cap: human review is the bottleneck; above it, new proposals are dropped.
    const proposals = [
      ...parsed.memories.map((m) => ({ scope: scopeOf[m.scope], kind: "fact" as const, title: "", text: m.text })),
      ...parsed.skills.map((s) => ({ scope: scopeOf[s.scope], kind: "skill" as const, title: s.title, text: s.text }))
    ]
    const room = Math.max(0, MAX_PENDING - (yield* store.pendingCount(scopes)))
    if (proposals.length > room) yield* Effect.logInfo("proposals over the pending cap; the extra ones were dropped", { room, proposed: proposals.length })
    for (const p of proposals.slice(0, room)) yield* store.addMemory({ ...p, state: "pending", origin: "auto", chatId: chat.id })
    return (yield* store.chat(chat.id))!
  }).pipe(Effect.ensuring(Effect.sync(() => consolidating.delete(chatId))))
})
