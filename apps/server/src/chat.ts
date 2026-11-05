// Turn context (layers) and consolidation (continuous learning). The turn itself runs in runtime.ts.
import { asMemory, picked } from "./file-skills.ts"
import { type Agent, type Chat, type Memory, namedSkills, type Project } from "@zorel/contracts"
import { Context, Data, Effect, Layer, Stream } from "effect"
import { join } from "node:path"
import {
  buildTurn, CONSOLIDATION_SYSTEM, consolidationPrompt, HISTORY_CHARS, KEEP_CHARS, MAX_AFTER, parseConsolidation, pinned, RETRIEVED, reviewed, scopesOf, similar, WINDOW, withinBudget
} from "./context.ts"
import { hasCredential, redact } from "./observability.ts"
import { Store, type Repository } from "./db.ts"
import { knowledgeOf, learningOf, memoryModeOf } from "./team.ts"
import { cheapModel, Engines, type EngineEvent, type TurnTools } from "./engines.ts"

export class NotFound extends Data.TaggedError("NotFound")<{}> {}
export class Busy extends Data.TaggedError("Busy")<{}> {}

// Where the CLIs run: empty directories per chat, inside the data folder.
export class DataDir extends Context.Service<DataDir, string>()("DataDir") {
  static layer = (dir: string) => Layer.succeed(DataDir, dir)
}
// The database file (exporting the workspace copies it).
export class DbPath extends Context.Service<DbPath, string>()("DbPath") {
  static layer = (path: string) => Layer.succeed(DbPath, path)
}

const MAX_PENDING = 20 // proposals awaiting review; above this, consolidation only updates the summary
const MAX_AUTO = 20 // facts saved on their own by one consolidation (agents in "auto" memory mode)
const QUERY_MESSAGES = 3 // the person's latest messages that make the memory search (one alone is often "ok, do it")
const consolidating = new Set<string>()

// The chat's agents who answer: an archived one stays a member (its history) but answers no one.
export const members = (store: Repository, chat: Chat) =>
  Effect.forEach(chat.agentIds, store.agent).pipe(Effect.map((xs) => xs.filter((a): a is NonNullable<typeof a> => !!a && !a.archivedAt)))

// ---------- context ----------

// `cwd`: where the agent works (the project folder, or the chat's empty Zorel folder; see Workspace).
export const prepare = (store: Repository, chat: Chat, agent: Agent | undefined, model: string, dataDir: string, tools: TurnTools | undefined, cwd = join(dataDir, "runs", chat.id)) =>
  Effect.gen(function* () {
    const scopes = scopesOf(chat, agent?.id ?? null)
    const who = agent?.id ?? null // the skills restricted to other agents stay out of its prompt
    const active = yield* store.activeMemories(scopes)
    const fixed = pinned(active)
    const messages = yield* store.messagesAfter(chat.id, chat.summaryUntil)
    const last = messages.at(-1)?.text ?? ""
    const query = messages.filter((m) => m.role === "user").slice(-QUERY_MESSAGES).map((m) => m.text).join("\n")
    // Zorel's skills, then the ones picked from this computer's files (title and purpose; read on demand).
    const all = [...(yield* store.activeMemories(scopes, "skill", undefined, who)), ...picked(yield* store.preference("fileSkills"), who).map(asMemory)]
    // Only skills named with $handle come with their steps; the rest are listed and read on demand (a search match
    // on every message sent up to two whole recipes each turn, mostly unused).
    const named = namedSkills(last, all)
    return buildTurn({
      chat,
      model,
      project: projectFor(chat, chat.projectId ? yield* store.project(chat.projectId) : undefined), // its worktree's folder, if any
      agent,
      members: yield* members(store, chat),
      pinned: fixed,
      activeIds: active.map((m) => m.id),
      retrieved: yield* store.searchMemories(scopes, query, fixed.map((m) => m.id), RETRIEVED),
      skills: { all, relevant: named },
      pages: knowledgeOf(agent) === "none" ? [] : yield* store.pinnedPages(scopes), // no access: no page in its context
      canPropose: memoryModeOf(agent) !== "read",
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

// How much a consolidation takes. "window": what leaves the window once it's over MAX_AFTER messages or
// HISTORY_CHARS characters (summary + learning);
// "all": everything so far ("Compact"); "quiet": a chat that went quiet learns from what came after it last learned,
// leaving the summary and the window alone (so short chats learn too).
export type Consolidation = "window" | "all" | "quiet"
export const QUIET_MIN = 3 // messages since the last learning before a quiet chat is worth a call
const QUIET_CONTEXT = 6 // earlier messages a quiet learning reads for context (marked learned, never evidence)
const REVIEW_MESSAGE_CHARS = 4_000 // of each message the memory model reads

// The stretch to read: undefined when there's nothing worth a call.
export function stretchOf<M extends { role: string; at: number; text: string }>(after: ReadonlyArray<M>, learnedUntil: number, how: Consolidation): M[] | undefined {
  if (how === "all") return after.length ? [...after] : undefined
  if (how === "window") {
    // Over the count or the characters a turn carries: the oldest go, keeping the newest that fit KEEP_CHARS.
    if (after.length <= MAX_AFTER && after.reduce((n, m) => n + m.text.length, 0) <= HISTORY_CHARS) return undefined
    const stretch = after.slice(0, after.length - withinBudget(after.slice(-WINDOW), KEEP_CHARS).length)
    return stretch.length ? stretch : undefined
  }
  const fresh = after.filter((m) => m.at > learnedUntil)
  if (fresh.length < QUIET_MIN || !fresh.some((m) => m.role === "user")) return undefined
  return [...after.filter((m) => m.at <= learnedUntil).slice(-QUIET_CONTEXT), ...fresh]
}

// Folds what leaves the window into the summary and proposes memories and skills (pending until the user approves).
// The "agent" scope goes to the agent that replied after the proof (the lead when none did). A message already learned from is read for context only: it can't be
// the evidence of a memory twice. It runs on the provider's small model (ZOREL_MEMORY_MODEL overrides), falling
// back to the chat's own when that one fails.
// Whether the chat learns (learningOf: an agent that doesn't learn keeps it from learning) and what becomes of a new
// fact (Preferences.memoryApproval): "review" proposes it; "undo" keeps it at once and tells `onRemembered`. A
// correction of an existing memory and every skill still wait (a skill is instructions for the agent, so it never
// turns on by itself); a chat that doesn't learn only folds the summary.
export const consolidate = Effect.fn("consolidate")(function* (chatId: string, how: Consolidation = "window", onRemembered: (saved: ReadonlyArray<Memory>) => Effect.Effect<void> = () => Effect.void) {
  const store = yield* Store
  const engines = yield* Engines
  const dataDir = yield* DataDir
  const chat = yield* store.chat(chatId)
  if (!chat) return yield* new NotFound()
  if (consolidating.has(chatId)) return yield* new Busy()
  const learnedUntil = Math.max(chat.summaryUntil, chat.learnedUntil)
  const stretch = stretchOf((yield* store.messagesAfter(chat.id, chat.summaryUntil)).filter((m) => m.text.trim()), learnedUntil, how)
  if (!stretch) return chat
  const agents = yield* members(store, chat)
  const mode = learningOf(agents)
  if (how === "quiet" && mode === "read") return chat // nothing to learn and no summary to fold: no call
  // Credentials never reach the memory model (nor, through it, the summary or a memory).
  // Each message cut at REVIEW_MESSAGE_CHARS: a pasted log is no fact about anyone, and the call stays small.
  const chunk = yield* Effect.promise(() => Promise.all(stretch.map(async (m) => ({ ...m, text: await redact(m.text.length > REVIEW_MESSAGE_CHARS ? `${m.text.slice(0, REVIEW_MESSAGE_CHARS)} […]` : m.text) }))))

  consolidating.add(chatId)
  return yield* Effect.gen(function* () {
    const lead = chat.agentIds[0] ?? null
    const scopes = scopesOf(chat, lead)
    const existing = yield* store.activeMemories(scopes)
    // The ones most related to the stretch, within the budget (not every memory ever kept): what it can confirm,
    // correct or repeat. The duplicate check below still sees all of them.
    const shown = reviewed(existing, chunk.map((m) => m.text).join("\n"))
    const skills = yield* store.activeMemories(scopes, "skill")
    const forgotten = yield* store.forgottenMemories(scopes)
    const text = consolidationPrompt({
      summary: chat.summary, chunk, existing: shown, hidden: existing.length - shown.length, skills, forgotten, learnedUntil, summarize: how !== "quiet",
      hasProject: !!chat.projectId, hasAgent: !!lead, names: (id) => agents.find((a) => a.id === id)?.name ?? "assistant"
    })
    const call = (model: string) => collect(engines.run({ model, system: CONSOLIDATION_SYSTEM, messages: [{ role: "user", text }], cwd: join(dataDir, "runs", "_memory") }))
    const small = process.env.ZOREL_MEMORY_MODEL || cheapModel(chat.model)
    const first = yield* call(small)
    const result = first.error && small !== chat.model ? yield* call(chat.model) : first
    const allowed = ["user", ...(chat.projectId ? ["project"] : []), ...(lead ? ["agent"] : [])]
    const agentsSaid = chunk.filter((m) => m.role === "assistant").map((m) => m.text).join("\n")
    const said = (n: number) => {
      const m = chunk[n - 1]
      return m?.role === "user" && m.at > learnedUntil ? m.text : undefined
    }
    const raw = result.error ? undefined : parseConsolidation(result.text, allowed, said, agentsSaid, how !== "quiet")
    // Whatever the model wrote, no credential gets stored: the summary loses it, a memory or skill holding one goes.
    const parsed = raw && (yield* Effect.promise(async () => ({
      ...raw,
      summary: await redact(raw.summary),
      memories: (await Promise.all(raw.memories.map(async (m) => ((await hasCredential(`${m.text} ${m.keywords}`)) ? [] : [m])))).flat(),
      skills: (await Promise.all(raw.skills.map(async (k) => ((await hasCredential(`${k.title} ${k.text}`)) ? [] : [k])))).flat()
    })))
    if (!parsed) {
      yield* Effect.logWarning("consolidation failed", result.error ?? result.text.slice(0, 300))
      return chat
    }
    const scopeOf = { user: "user", project: `project:${chat.projectId}`, agent: `agent:${lead}` }
    // An agent's note goes to the agent the person was talking to: the first one that replied after the message that
    // proves it (in a chat with several agents, not always the lead).
    const creditedAgent = (evidence: ReadonlyArray<number>) => {
      for (const n of evidence) {
        const reply = chunk.slice(n).find((m) => m.role === "assistant" && m.agentId && agents.some((a) => a.id === m.agentId))
        if (reply?.agentId) return reply.agentId
      }
      return lead
    }
    if (how === "quiet") yield* store.setLearned(chat.id, chunk.at(-1)!.at)
    else yield* store.setSummary(chat.id, parsed.summary, chunk.at(-1)!.at)
    if (mode === "read") return (yield* store.chat(chat.id))!
    yield* store.confirmMemories(parsed.confirm.flatMap((i) => (shown[i] ? [shown[i].id] : [])))
    // A proposal that only rewords an active memory confirms it; one that rewords a pending one is dropped. A
    // correction (replaces) waits for review as an update of the memory it replaces.
    const pending = yield* store.pendingMemories(scopes)
    const facts: Array<{ scope: string; kind: "fact"; title: string; text: string; keywords: string; replaces: string | null; reason: string | null; agentId: string | null }> = []
    for (const m of parsed.memories) {
      const credited = m.scope === "agent" ? creditedAgent(m.evidence) : null
      const scope = m.scope === "agent" ? `agent:${credited}` : scopeOf[m.scope]
      const target = m.replaces !== undefined ? shown[m.replaces] : undefined
      if (!target) {
        const same = existing.find((e) => e.scope === scope && similar(e.text, m.text))
        if (same) {
          yield* store.confirmMemories([same.id])
          continue
        }
        if (pending.some((p) => p.scope === scope && similar(p.text, m.text))) continue
      }
      facts.push({ scope: target?.scope ?? scope, kind: "fact", title: "", text: m.text, keywords: m.keywords, replaces: target?.id ?? null, reason: null, agentId: credited })
    }
    const onItsOwn = (yield* store.preference("memoryApproval")) === "undo" ? facts.filter((f) => !f.replaces) : []
    const saved: Memory[] = []
    for (const f of onItsOwn.slice(0, MAX_AUTO)) {
      const m = yield* store.addMemory({ ...f, state: "active", origin: "auto", chatId: chat.id })
      if (m) saved.push(m)
    }
    if (onItsOwn.length > MAX_AUTO) yield* Effect.logInfo("facts over the automatic cap; the extra ones were dropped", { cap: MAX_AUTO, proposed: onItsOwn.length })
    if (saved.length) yield* onRemembered(saved)
    // Pending cap: human review is the bottleneck; above it, new proposals are dropped.
    const proposals = [...facts.filter((f) => !onItsOwn.includes(f)), ...parsed.skills.map((s) => ({ scope: scopeOf[s.scope], kind: "skill" as const, title: s.title, text: s.text }))]
    const room = Math.max(0, MAX_PENDING - (yield* store.pendingCount(scopes)))
    if (proposals.length > room) yield* Effect.logInfo("proposals over the pending cap; the extra ones were dropped", { room, proposed: proposals.length })
    for (const p of proposals.slice(0, room)) yield* store.addMemory({ ...p, state: "pending", origin: "auto", chatId: chat.id })
    return (yield* store.chat(chat.id))!
  }).pipe(Effect.ensuring(Effect.sync(() => consolidating.delete(chatId))))
})
