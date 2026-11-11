// Turn context (layers) and consolidation (continuous learning). The turn itself runs in runtime.ts.
import { asMemory, picked } from "./file-skills.ts"
import { type Agent, type Chat, type Memory, namedSkills, type Project } from "@zorel/contracts"
import { Context, Data, Effect, Layer, Stream } from "effect"
import { join } from "node:path"
import {
  buildTurn, CONSOLIDATION_SYSTEM, LEAN_MEMORY_BUDGET, MEMORY_BUDGET, consolidationPrompt, type Mapped, mappedOf, namedPoints, spread, HISTORY_CHARS, KEEP_CHARS, MAX_AFTER, parseConsolidation, pinned, reviewed, scopesOf, similar, WINDOW, withinBudget
} from "./context.ts"
import { hasCredential, redact } from "./observability.ts"
import { normalize, Store, type Repository } from "./db.ts"
import { LOCAL_ACTOR } from "./access.ts"
import { ownedStore } from "./visibility.ts"
import { nearest, vectorsReady } from "./vectors.ts"

// How much of the memory rides along pinned: the full budget until the local model is ready (without it, paraphrased
// questions only reach unpinned facts by the map and words), half once it is.
export const pinBudget = () => (vectorsReady() ? LEAN_MEMORY_BUDGET : MEMORY_BUDGET)
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

// The model that learns from a chat: the one chosen in Settings, else ZOREL_MEMORY_MODEL, else the chat's provider's
// small model (consolidate falls back to the chat's own model when that one fails).
const memoryModelFor = (store: Repository, chatModel: string) =>
  Effect.map(store.preference("memoryModel"), (chosen) => chosen || process.env.ZOREL_MEMORY_MODEL || cheapModel(chatModel))

const STREAM = 10 // candidates each recall source (map, facts by words, past messages) brings to the fusion
const EXCERPTS = 5 // past-message excerpts at most per turn
const MEANING_MIN = 0.25 // cosine below this isn't "about the same thing" for all-MiniLM-L6-v2
const RECALL_CHARS = 2_000 // the most the recalled facts take in a turn

// A bounded piece of a past message around the words that matched, with who said it and where.
interface Excerpt {
  readonly id: string
  readonly chatId: string
  readonly chatTitle: string
  readonly author: string // "user" or the agent's name
  readonly at: number
  readonly text: string
}
// What recall found: facts and excerpts within the budget, best first (for the prompt), and the whole ranked list
// before the budget (for the benchmarks).
export interface Recalled {
  readonly facts: ReadonlyArray<Memory>
  readonly excerpts: ReadonlyArray<Excerpt>
  readonly ranked: ReadonlyArray<{ readonly kind: "fact" | "message"; readonly id: string; readonly chatId: string | null }>
}

// What a turn recalls beyond the pinned memories: facts by association first (the points the person's messages name,
// spread along the map: "deploy" brings Vercel and the Friday rule though neither word was said), then facts by their
// words (FTS), without repeats, within RECALL_CHARS. No model call; a project's map in milliseconds.
// `messages`: also search past messages of the chat's project (or of chats without one), leaving out the chat's own
// messages after `after` (they are in the window).
export const recall = (store: Repository, scopes: ReadonlyArray<string>, query: string, exclude: ReadonlyArray<string>, messages?: { projectId: string | null; chatId: string; after: number }) =>
  Effect.gen(function* () {
    const byWords = yield* store.searchMemories(scopes, query, exclude, STREAM)
    const points = yield* store.entityNames(scopes)
    const seeds = namedPoints(query, points)
    let byAssociation: Memory[] = []
    if (seeds.length) {
      const own = points.map((p) => p.id)
      // A bridge the person made carries activation to the other project's point, and to its own facts only.
      const bridges = yield* store.bridgesOf(own)
      const activation = spread([...own, ...bridges.others.map((o) => o.id)], [...(yield* store.linksAmong(own)), ...bridges.links], seeds)
      const near = [...activation].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([id]) => id)
      const across = bridges.others.filter((o) => near.includes(o.id))
      const score = new Map<string, { memory: Memory; score: number }>()
      const found = [
        ...(yield* store.factsAbout(near.filter((id) => !across.some((o) => o.id === id)), scopes)),
        ...(across.length ? yield* store.factsAbout(across.map((o) => o.id), [...new Set(across.map((o) => o.scope))]) : [])
      ]
      for (const { memory, entityId } of found) {
        if (exclude.includes(memory.id)) continue
        const s = score.get(memory.id) ?? { memory, score: 0 }
        s.score += activation.get(entityId) ?? 0
        score.set(memory.id, s)
      }
      byAssociation = [...score.values()].sort((a, b) => b.score - a.score || b.memory.confirmedAt - a.memory.confirmedAt).slice(0, STREAM).map((s) => s.memory)
    }
    // By meaning (vectors.ts): only once the local model is ready; facts not processed yet are queued, not awaited.
    const facts = vectorsReady() ? (yield* store.activeMemories(scopes)).filter((m) => !exclude.includes(m.id)) : []
    const byMeaning = facts.length ? yield* Effect.promise(() => nearest(query, facts, STREAM, MEANING_MIN)) : []
    const excerpts = messages ? yield* pastMessages(store, scopes, query, messages, [...byAssociation, ...byWords, ...byMeaning]) : []
    // Reciprocal rank fusion (k = 60): an item found by several sources outranks one found by one at the same place.
    type Item = { kind: "fact"; memory: Memory } | { kind: "message"; excerpt: Excerpt }
    const fused = new Map<string, { item: Item; score: number }>()
    const vote = (id: string, item: Item, rank: number) => {
      const f = fused.get(id) ?? { item, score: 0 }
      f.score += 1 / (60 + rank + 1)
      fused.set(id, f)
    }
    for (const [r, m] of byAssociation.entries()) vote(m.id, { kind: "fact", memory: m }, r)
    for (const [r, m] of byWords.entries()) vote(m.id, { kind: "fact", memory: m }, r)
    for (const [r, m] of byMeaning.entries()) vote(m.id, { kind: "fact", memory: m }, r)
    for (const [r, e] of excerpts.entries()) vote(e.id, { kind: "message", excerpt: e }, r)
    const at = (i: Item) => (i.kind === "fact" ? i.memory.confirmedAt : i.excerpt.at)
    const order = [...fused.values()].sort((x, y) => y.score - x.score || (x.item.kind === "fact" ? 0 : 1) - (y.item.kind === "fact" ? 0 : 1) || at(y.item) - at(x.item)).map((f) => f.item)
    let used = 0
    let shown = 0
    const within = order.filter((i) => {
      if (i.kind === "message" && ++shown > EXCERPTS) return false
      used += i.kind === "fact" ? i.memory.text.length + 3 : i.excerpt.text.length + i.excerpt.chatTitle.length + i.excerpt.author.length + 24
      return used <= RECALL_CHARS
    })
    const recalled: Recalled = {
      facts: within.flatMap((i) => (i.kind === "fact" ? [i.memory] : [])),
      excerpts: within.flatMap((i) => (i.kind === "message" ? [i.excerpt] : [])),
      ranked: order.map((i) => (i.kind === "fact" ? { kind: "fact", id: i.memory.id, chatId: null } : { kind: "message", id: i.excerpt.id, chatId: i.excerpt.chatId }))
    }
    return recalled
  })

// Past messages that matched, as excerpts: never one holding a credential, a forgotten fact's text, or what a recalled
// fact already says. Up to STREAM candidates; the turn shows at most EXCERPTS.
const pastMessages = (store: Repository, scopes: ReadonlyArray<string>, query: string, where: { projectId: string | null; chatId: string; after: number }, facts: ReadonlyArray<Memory>) =>
  Effect.gen(function* () {
    const rows = yield* store.recallMessages(where.projectId, query, { chatId: where.chatId, after: where.after }, STREAM)
    if (!rows.length) return []
    const forgotten = (yield* store.forgottenMemories(scopes)).map((m) => normalize(m.text)).filter(Boolean)
    const names = new Map<string, string>()
    const kept: Excerpt[] = []
    for (const r of rows) {
      const plain = normalize(r.text)
      if (forgotten.some((f) => plain.includes(f)) || facts.some((f) => similar(f.text, r.text))) continue
      if (yield* Effect.promise(() => hasCredential(r.text))) continue
      if (r.agentId && !names.has(r.agentId)) names.set(r.agentId, (yield* store.agent(r.agentId))?.name ?? "agent")
      kept.push({ id: r.id, chatId: r.chatId, chatTitle: r.chatTitle, author: r.role === "user" ? "user" : (names.get(r.agentId ?? "") ?? "agent"), at: r.at, text: r.text })
    }
    return kept
  })

// The names on a chat's map that stand for its project and its agents (so "Zorel" is the project's point, not a concept).
export const knownNames = (store: Repository, chat: Pick<Chat, "projectId" | "agentIds">) =>
  Effect.gen(function* () {
    const project = chat.projectId ? yield* store.project(chat.projectId) : undefined
    const agents = yield* members(store, chat as Chat)
    return [...(project ? [{ id: project.id, name: project.name, type: "project" as const }] : []), ...agents.map((a) => ({ id: a.id, name: a.name, type: "agent" as const }))]
  })

// ---------- context ----------

// `cwd`: where the agent works (the project folder, or the chat's empty Zorel folder; see Workspace).
export const prepare = (store: Repository, chat: Chat, agent: Agent | undefined, model: string, dataDir: string, tools: TurnTools | undefined, cwd = join(dataDir, "runs", chat.id)) =>
  Effect.gen(function* () {
    const scopes = scopesOf(chat, agent?.id ?? null)
    const who = agent?.id ?? null // the skills restricted to other agents stay out of its prompt
    const active = yield* store.activeMemories(scopes)
    const fixed = pinned(active, pinBudget())
    const messages = yield* store.messagesAfter(chat.id, chat.summaryUntil)
    const last = messages.at(-1)?.text ?? ""
    const query = messages.filter((m) => m.role === "user").slice(-QUERY_MESSAGES).map((m) => m.text).join("\n")
    // Zorel's skills, then the ones picked from this computer's files (title and purpose; read on demand).
    const all = [...(yield* store.activeMemories(scopes, "skill", undefined, who)), ...picked(yield* store.preference("fileSkills"), who).map(asMemory)]
    // Only skills named with $handle come with their steps; the rest are listed and read on demand (a search match
    // on every message sent up to two whole recipes each turn, mostly unused).
    const named = namedSkills(last, all)
    // Facts and what was said in the project's other chats (this chat's window is already in the turn).
    const recalled = yield* recall(store, scopes, query, fixed.map((m) => m.id), { projectId: chat.projectId, chatId: chat.id, after: chat.summaryUntil })
    return buildTurn({
      chat,
      model,
      project: projectFor(chat, chat.projectId ? yield* store.project(chat.projectId) : undefined), // its worktree's folder, if any
      agent,
      members: yield* members(store, chat),
      pinned: fixed,
      activeIds: active.map((m) => m.id),
      retrieved: recalled.facts,
      excerpts: recalled.excerpts,
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

// The reply's text, its error and what it used (spec 012: a routine's cheap check counts toward the agent's month).
const COLLECT: Partial<Record<EngineEvent["type"], (acc: Collected, ev: never) => Collected>> = {
  text: (acc, ev: Extract<EngineEvent, { type: "text" }>) => ({ ...acc, text: acc.text + ev.delta }),
  error: (acc, ev: Extract<EngineEvent, { type: "error" }>) => ({ ...acc, error: ev.message }),
  done: (acc, ev: Extract<EngineEvent, { type: "done" }>) => ({ ...acc, tokens: ev.usage.inputTokens + ev.usage.outputTokens })
}
type Collected = { text: string; error: string | undefined; tokens: number }
const collect = (events: Stream.Stream<EngineEvent>) =>
  Stream.runFold(events, (): Collected => ({ text: "", error: undefined, tokens: 0 }), (acc, ev) => COLLECT[ev.type]?.(acc, ev as never) ?? acc)

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
  const base = yield* Store
  const engines = yield* Engines
  const dataDir = yield* DataDir
  const chat = yield* base.chat(chatId)
  if (!chat) return yield* new NotFound()
  // Whose facts these are (spec 014): the chat's owner. In a team's project chat several people talk, so nothing is
  // kept about "the user" there: one person's facts would land with another.
  const owner = (yield* base.chatAccess(chatId))?.ownerId ?? LOCAL_ACTOR.id
  const store = ownedStore(base, owner)
  const shared = !!chat.projectId && owner !== LOCAL_ACTOR.id
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
    const small = (yield* memoryModelFor(store, chat.model))
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
    const facts: Array<{ scope: string; kind: "fact"; title: string; text: string; keywords: string; replaces: string | null; reason: string | null; agentId: string | null; mapped: Mapped }> = []
    for (const m of parsed.memories) {
      const credited = m.scope === "agent" ? creditedAgent(m.evidence) : null
      const scope = m.scope === "agent" ? `agent:${credited}` : scopeOf[m.scope]
      if (shared && scope === "user") continue
      const target = m.replaces !== undefined ? shown[m.replaces] : undefined
      if (!target) {
        const same = existing.find((e) => e.scope === scope && similar(e.text, m.text))
        if (same) {
          yield* store.confirmMemories([same.id])
          continue
        }
        if (pending.some((p) => p.scope === scope && similar(p.text, m.text))) continue
      }
      facts.push({ scope: target?.scope ?? scope, kind: "fact", title: "", text: m.text, keywords: m.keywords, replaces: target?.id ?? null, reason: null, agentId: credited, mapped: { entities: m.entities, relations: m.relations } })
    }
    // Each fact kept or proposed goes on the map of its scope (what it's about, how those relate).
    const known = yield* knownNames(store, chat)
    const map = (m: Memory | undefined, mapped: Mapped) => (m ? store.linkMemory(m.id, m.scope, mapped, known).pipe(Effect.asVoid) : Effect.void)
    // Text from outside (a webhook, a watched connector) in the stretch isn't the person: what it yields waits for
    // review even when new facts are kept at once (spec 011).
    const outside = yield* store.hasOutside(chat.id, stretch[0]!.at - 1, stretch.at(-1)!.at)
    const onItsOwn = !outside && (yield* store.preference("memoryApproval")) === "undo" ? facts.filter((f) => !f.replaces) : []
    const saved: Memory[] = []
    for (const { mapped, ...f } of onItsOwn.slice(0, MAX_AUTO)) {
      const m = yield* store.addMemory({ ...f, state: "active", origin: "auto", chatId: chat.id })
      yield* map(m, mapped)
      if (m) saved.push(m)
    }
    if (onItsOwn.length > MAX_AUTO) yield* Effect.logInfo("facts over the automatic cap; the extra ones were dropped", { cap: MAX_AUTO, proposed: onItsOwn.length })
    if (saved.length) yield* onRemembered(saved)
    // Pending cap: human review is the bottleneck; above it, new proposals are dropped.
    const proposals = [...facts.filter((f) => !onItsOwn.includes(f)), ...parsed.skills.map((s) => ({ scope: scopeOf[s.scope], kind: "skill" as const, title: s.title, text: s.text }))]
    const room = Math.max(0, MAX_PENDING - (yield* store.pendingCount(scopes)))
    if (proposals.length > room) yield* Effect.logInfo("proposals over the pending cap; the extra ones were dropped", { room, proposed: proposals.length })
    for (const p of proposals.slice(0, room)) {
      const { mapped, ...rest } = { mapped: undefined as Mapped | undefined, ...p }
      const m = yield* store.addMemory({ ...rest, state: "pending", origin: "auto", chatId: chat.id })
      if (mapped) yield* map(m, mapped)
    }
    return (yield* store.chat(chat.id))!
  }).pipe(Effect.ensuring(Effect.sync(() => consolidating.delete(chatId))))
})

// ---------- the map of facts kept before it existed (one-time backfill) ----------

const MAP_SINCE = "memoryMapSince" // when the map began: facts older than this are the backfill's
const MAP_CURSOR = "memoryMapCursor" // createdAt of the last fact it read
const MAP_BATCH = 30 // facts per call
export const MAP_SYSTEM = [
  "You file facts on a map of what they are about. For each numbered fact, list:",
  '- "entities": the things it is about, 1 to 5, each named as it would be anywhere ("Vercel", not "vercel deploys"): "concept" for a concrete thing (a tool, a service, a file, a day), "subject" for a theme or a decision ("Deploy", "Authentication"). Use a project\'s or an agent\'s own name when the fact is about it.',
  '  Give each entity "aliases": up to 3 everyday words someone would use for it in a question without knowing its name (synonyms, the plain word, the other language: "money back" for Refund, "laptop" for a MacBook, "dog" for a pet\'s name), and a "category": what kind of thing it is, one or two plain words ("Hosting" for Vercel, "Programming language" for Rust).',
  '- "relations": how those entities relate, as [from, relation, to] with a short relation ("goes to", "uses"). Only what the fact says.',
  'Answer ONLY with JSON: {"items": [{"n": 1, "entities": [{"name": "...", "type": "concept" | "subject", "aliases": ["..."], "category": "..."}], "relations": [["...", "...", "..."]]}]}'
].join("\n")

// Reads the facts kept before the map in batches on the small model and files them. Stops at a failed call (the next
// start goes on from the cursor). Returns how many facts it read.
export const mapEarlierFacts = Effect.fn("mapEarlierFacts")(function* () {
  const store = yield* Store
  const engines = yield* Engines
  const dataDir = yield* DataDir
  let since = Number(yield* store.preference(MAP_SINCE))
  if (!since) {
    // Just after the newest fact kept so far (the store's clock, not the wall's: it can run ahead of it).
    since = Math.max(0, ...(yield* store.memories()).map((m) => m.createdAt)) + 1
    yield* store.setPreference(MAP_SINCE, String(since))
  }
  const latest = (yield* store.chats())[0]
  const model = latest ? yield* memoryModelFor(store, latest.model) : (yield* store.preference("memoryModel")) || process.env.ZOREL_MEMORY_MODEL || ""
  if (!model) return 0
  const projects = yield* store.projects()
  const agents = (yield* store.agents()).filter((a) => !a.builtin)
  const known = [...projects.map((p) => ({ id: p.id, name: p.name, type: "project" as const })), ...agents.map((a) => ({ id: a.id, name: a.name, type: "agent" as const }))]
  let read = 0
  while (true) {
    const after = Number(yield* store.preference(MAP_CURSOR)) || 0
    const facts = yield* store.unmappedMemories(MAP_BATCH, after, since)
    if (!facts.length) return read
    const text = facts.map((f, i) => `#${i + 1} ${f.text}`).join("\n")
    const result = yield* collect(engines.run({ model, system: MAP_SYSTEM, messages: [{ role: "user", text }], cwd: join(dataDir, "runs", "_memory") }))
    if (result.error) {
      yield* Effect.logWarning("memory map backfill stopped", result.error)
      return read
    }
    const items = parseMapItems(result.text)
    for (const [i, f] of facts.entries()) {
      const item = items.find((x) => x.n === i + 1)
      yield* store.linkMemory(f.id, f.scope, mappedOf(item?.entities, item?.relations), known)
    }
    yield* store.setPreference(MAP_CURSOR, String(facts.at(-1)!.createdAt))
    read += facts.length
  }
})

// {"items": [{"n", "entities", "relations"}]} with text around it; anything unreadable is no item.
export function parseMapItems(text: string): Array<{ n: number; entities: unknown[]; relations: unknown[] }> {
  try {
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { items?: unknown }
    return (Array.isArray(json.items) ? json.items : []).flatMap((x) => {
      const o = (x ?? {}) as { n?: unknown; entities?: unknown; relations?: unknown }
      return typeof o.n === "number" ? [{ n: o.n, entities: Array.isArray(o.entities) ? o.entities : [], relations: Array.isArray(o.relations) ? o.relations : [] }] : []
    })
  } catch {
    return []
  }
}
