// Builds what a turn sends to the engine. Nothing accumulates in the CLI session: every turn
// the context is rebuilt in layers, from most stable to most volatile (good for prompt caching):
//   base → agent → channel → user memories → project (brief + memories) → agent memories
//   → skills → chat summary → memories retrieved by the current message → latest messages.
// Each layer has a budget; what doesn't fit stays searchable (FTS) and comes back when relevant.
// Parts of the rolling summary + memories + proposed skills model are third-party code, see NOTICE.
import { join } from "node:path"
import { type Agent, type Chat, MENTION_RE, type Memory, type Message, type Project } from "@zorel/contracts"
import { Option, Schema } from "effect"
import { normalize } from "./db.ts"
import type { Turn, TurnMessage, TurnTools } from "./engines.ts"

export const WINDOW = 30 // messages kept verbatim after a consolidation
export const MAX_AFTER = 50 // more than this since the summary triggers a consolidation
export const MEMORY_BUDGET = 8_000 // characters of pinned memories in the prompt
export const RETRIEVED = 5 // memories retrieved by search each turn
export const SKILL_TITLES = 30 // skills listed by title
export const SKILL_BODIES = 2 // skills with the full step-by-step, the most relevant to the message
export const MAX_DEPTH = 3 // consecutive agent-to-agent replies with no human message in between

export const scopesOf = (chat: Pick<Chat, "projectId">, agentId: string | null): string[] => [
  "user",
  ...(chat.projectId ? [`project:${chat.projectId}`] : []),
  ...(agentId ? [`agent:${agentId}`] : [])
]

// "Copywriter Sênior" → "copywriter-senior"
export const handleOf = (a: Pick<Agent, "name">) => normalize(a.name).replace(/ /g, "-")

// Mentioned agents (@handle) in order of appearance; code in backticks doesn't count.
export function mentioned(text: string, agents: ReadonlyArray<Agent>): Agent[] {
  const plain = text.replace(/```[\s\S]*?```|`[^`]*`/g, " ")
  const handles = [...plain.matchAll(MENTION_RE)].map((m) => normalize(m[1]!).replace(/ /g, "-"))
  return [...new Set(handles)].flatMap((h) => agents.filter((a) => handleOf(a) === h))
}

// What goes in the prompt, up to the budget: the essential ones (the person marked them) first, then the most
// recently confirmed of each scope in turn, so a busy scope (the person's) doesn't crowd out the project's and the
// agent's. The rest is left to search.
export function pinned(active: ReadonlyArray<Memory>, budget = MEMORY_BUDGET): Memory[] {
  const recent = [...active].sort((a, b) => b.confirmedAt - a.confirmedAt)
  const queues = new Map<string, Memory[]>()
  for (const m of recent) if (!m.essential) queues.set(m.scope, [...(queues.get(m.scope) ?? []), m])
  const order = recent.filter((m) => m.essential)
  for (let i = 0; [...queues.values()].some((q) => i < q.length); i++) for (const q of queues.values()) if (q[i]) order.push(q[i]!)
  let used = 0
  const out: Memory[] = []
  for (const m of order) {
    used += m.text.length + 3
    if (used > budget) break
    out.push(m)
  }
  return out
}

// Two wordings of the same idea: most of their words shared (Jaccard over words of 3+ letters). Consolidation
// treats a new proposal this close to an existing memory as that memory said again.
export const SAME_IDEA = 0.6
const words = (t: string) => new Set(normalize(t).split(" ").filter((w) => w.length > 2))
export function similar(a: string, b: string): boolean {
  const x = words(a)
  const y = words(b)
  if (!x.size || !y.size) return false
  const shared = [...x].filter((w) => y.has(w)).length
  return shared / (x.size + y.size - shared) >= SAME_IDEA
}

// An agent can't add details of its own to a fact about the person: a name or a number in the memory (Whiskers,
// 16) that an agent said in the stretch and the person didn't makes it theirs, not the person's. What neither said
// (Germany for Berlin) is the model's general knowledge and stays.
const nameOrNumber = (word: string) => /^\p{Lu}/u.test(word) || /\p{N}/u.test(word)
const wordsOf = (text: string) => new Set(normalize(text).split(" ").filter(Boolean))
export function grounded(memory: string, person: string, agents: string): boolean {
  const theirs = wordsOf(person)
  const agentOnly = wordsOf(agents)
  const marked = memory.split(/\s+/).slice(1).filter(nameOrNumber).flatMap((w) => [...wordsOf(w)]) // the first word is capitalized anyway
  return marked.every((w) => theirs.has(w) || !agentOnly.has(w))
}

const section = (title: string, body: string | undefined) => (body?.trim() ? `## ${title}\n${body.trim()}` : undefined)
const bullets = (ms: ReadonlyArray<Memory>) => ms.map((m) => `- ${m.text}`).join("\n")

export interface TurnInput {
  readonly chat: Chat
  readonly model: string
  readonly project: Project | undefined
  readonly agent: Agent | undefined // who replies now
  readonly members: ReadonlyArray<Agent> // all agents in the chat
  readonly pinned: ReadonlyArray<Memory>
  readonly retrieved: ReadonlyArray<Memory>
  readonly skills: { readonly all: ReadonlyArray<Memory>; readonly relevant: ReadonlyArray<Memory> }
  readonly pages?: ReadonlyArray<{ readonly id: string; readonly title: string }> | undefined // pinned knowledge pages (titles only)
  readonly messages: ReadonlyArray<Message> // since the summary, in order; the last is from the user or another agent
  readonly cwd: string
  readonly filesDir?: string | undefined // where this chat's attachments live (<dataDir>/attachments/<chat>)
  readonly tools?: TurnTools | undefined
}

// "[Done in this turn: edited src/a.ts (+2 −1); ran `bun test` (ok)]", or nothing.
export function workNote(m: Message): string {
  const files = m.changes.map((c) => `${c.status === "added" ? "created" : c.status === "deleted" ? "deleted" : "edited"} ${c.path} (+${c.added} −${c.removed})`)
  const runs = m.steps.filter((s) => s.tool === "run").map((s) => `ran \`${s.args.slice(0, 120)}\` (${s.status === "ok" ? "ok" : s.status === "refused" ? "refused" : "failed"})`)
  const all = [...files, ...runs]
  if (!all.length) return ""
  return `\n\n[Done in this turn: ${all.join("; ")}${m.revertedAt ? ". The user undid these changes later." : ""}]`
}

export function buildTurn(i: TurnInput): Turn {
  const of = (scope: string) => i.pinned.filter((m) => m.scope === scope)
  const others = i.members.filter((a) => a.id !== i.agent?.id)
  const name = (id: string | null) => i.members.find((a) => a.id === id)?.name ?? "assistant"
  const channel =
    others.length > 0 &&
    [
      "Other agents in this chat (their messages arrive with their name in brackets):",
      ...others.map((a) => `- @${handleOf(a)} (${[a.name, a.title].filter(Boolean).join(", ")}): ${a.description || a.instructions.split("\n")[0]?.slice(0, 140) || "no description"}`),
      "To pass part of the work to one of them, mention their @handle in your reply: they answer next, here. Mention only when you need to; to just refer to someone, write the name without @. For agents outside this chat use zorel_start_task; for one piece of work use one or the other, never both.",
      "When a teammate hands you work here, answer them in this shape, short: Status: done | partial | blocked. Result: what you did or found. Evidence: what you ran or read. If blocked, say what would unblock it.",
      "When teammates you handed work to have answered, you get the next turn: check what they did and wrap up for the user in a few lines, without repeating them. Hand back to a teammate only if something is missing. Never mention someone just to thank or confirm."
    ].join("\n")

  // Stable: opens the native session (rarely changes; if it does, the session reopens from the resume point).
  const instructions = [
    "You are an assistant in a project workspace. Be direct.",
    "Use the context below when it helps; don't make up facts that aren't in it.",
    i.tools?.defs.length && "You have tools. Use them when the task calls for it; actions that change something may wait for the user's approval.",
    i.tools?.defs.some((d) => d.name === "zorel_start_task") &&
      "Work that belongs to a teammate (see zorel_list_agents) or can run in parallel: hand it over with zorel_start_task. Their answer comes back to this chat by itself and you continue from there; don't wait or ask about it. When it arrives the user already sees it: don't repeat it, add only what follows from it (or nothing, if it was the whole answer).",
    i.agent && section(`You are ${[i.agent.name, i.agent.title].filter(Boolean).join(", ")}`, [i.agent.description, i.agent.instructions].filter(Boolean).join("\n\n")),
    channel && section("Channel", channel)
  ]
  const userMemories = section("What you know about the user", bullets(of("user")))
  const projectParts = [
    i.project && section(`Project: ${i.project.name}`, i.project.brief),
    i.project?.path &&
      section(
        "Workspace",
        `You work in the project folder: ${i.project.path}. Read, edit and run commands in it with your tools; Zorel asks for the user's approval when your access level requires it. Every turn becomes a restore point, and the user can undo what you changed.`
      )
  ]
  const workMemories = [i.project && section("Project memories", bullets(of(`project:${i.project.id}`))), i.agent && section("Your work memories", bullets(of(`agent:${i.agent.id}`)))]
  const skillList = section("Available skills (approved procedures; follow one when the task matches: read its steps with zorel_read_skill; if you find a better way, propose it with zorel_propose_skill and improves)", i.skills.all.slice(0, SKILL_TITLES).map((s) => `- ${s.title}`).join("\n"))
  // Pinned pages: titles only (stable, cheap); the body comes with zorel_knowledge_read when needed.
  const pageList = section("Pinned knowledge pages (read with zorel_knowledge_read; search others with zorel_knowledge_search)", (i.pages ?? []).map((p) => `- ${p.title} [${p.id}]`).join("\n"))
  const stable = [...instructions, userMemories, ...projectParts, ...workMemories, skillList, pageList].filter(Boolean).join("\n\n")
  // Dynamic: depends on the current message; in a native session it goes with the turn's message.
  const skillBodies = i.skills.relevant.map((s) => section(`Skill: ${s.title}`, s.text))
  const summary = section("Summary of what came before in this conversation", i.chat.summary)
  const retrieved = section("Memories that may be relevant to the current message", bullets(i.retrieved))
  const dynamic = [...skillBodies, summary, retrieved].filter(Boolean).join("\n\n")
  const system = [stable, dynamic].filter(Boolean).join("\n\n")
  const size = (xs: ReadonlyArray<unknown>) => xs.reduce<number>((n, x) => n + (typeof x === "string" ? x.length : 0), 0)
  const parts = {
    instructions: size([...instructions, ...projectParts]),
    memories: size([userMemories, ...workMemories, retrieved]),
    skills: size([skillList, ...skillBodies]),
    summary: size([summary])
  }

  const filesOf = (m: Message) => (i.filesDir ? m.attachments.map((a) => ({ name: a.name, mime: a.mime, path: join(i.filesDir!, a.id) })) : [])
  // From the replier's point of view: its own lines are "assistant"; other agents' lines arrive
  // as "user" with the name, so they don't look like its own.
  // Replies carry what their turn did in the workspace, so whoever answers next (another agent, or the
  // same agent after a provider switch) knows the files and commands without reading the old session.
  const messages: TurnMessage[] = i.messages
    .slice(-MAX_AFTER)
    .filter((m) => m.text.trim() || m.changes.length)
    .map((m) => {
      const text = `${m.text}${workNote(m)}`
      return m.role === "assistant" && m.agentId !== (i.agent?.id ?? null)
        ? { role: "user", text: `[${name(m.agentId)}]\n${text}`, at: m.at }
        : { role: m.role, text, at: m.at, files: filesOf(m) }
    })
  return { model: i.model, system, stable, dynamic, messages, cwd: i.cwd, tools: i.tools, parts }
}

// ---------- consolidation (continuous learning) ----------

export const CONSOLIDATION_SYSTEM = [
  "You keep the memory of a chat between a person and AI agents.",
  "You get the current summary, a stretch of messages about to leave the window, and the memories and skills that already exist.",
  "Answer ONLY with JSON, no text around it, in this shape:",
  '{"summary": "...", "memories": [{"scope": "user" | "project" | "agent", "text": "...", "keywords": "...", "evidence": [3], "replaces": "m4"}], "confirm": ["m2"], "skills": [{"scope": "user" | "project" | "agent", "title": "...", "text": "..."}]}',
  '- "summary": the new summary, merging the previous one and the stretch. Up to 400 words. Keep decisions, open items, numbers, names and the state of the work.',
  '- "memories": only durable facts that hold outside this conversation. An empty list is the norm.',
  '  - "user": the person\'s preferences and way of working (holds everywhere).',
  '  - "project": facts and decisions of the project (only when the conversation belongs to a project).',
  '  - "agent": how the agent that replied can do its work better (only when there is an agent).',
  "  - One idea per memory, a short self-contained sentence in the third person. Don't repeat existing memories.",
  '  - "evidence": the numbers (#) of the messages in the stretch that prove the fact. Only the person\'s messages ([user]) count: an agent\'s guess, plan or assumption never becomes a memory, and neither do details only an agent added (a name, a number).',
  '  - "keywords": 5 to 10 other words someone might use when this would help (synonyms, related terms, the other language), separated by spaces. They are only for search.',
  '  - "replaces": when the person corrects or updates an existing memory (they moved, changed a preference), the id (m1, m2…) of the one it replaces. Never leave two memories that contradict each other.',
  '  - Not a memory: anything temporary or time-boxed ("this week", "for now", "today"), and never a password, key, token or other credential, not even in the summary. A message that holds a credential can still hold facts: keep those.',
  '- "confirm": the ids (m1, m2…) of existing memories the stretch confirms again. An empty list is the norm.',
  '- "skills": procedures worth repeating — something solved in several steps, a way out of a dead end, or the user correcting how to do something. An empty list is the norm.',
  '  - "title": a short name for the procedure. "text": concise steps, up to 15 lines. Don\'t repeat existing skills.'
].join("\n")

export function consolidationPrompt(o: {
  summary: string
  chunk: ReadonlyArray<Message>
  existing: ReadonlyArray<Memory>
  skills: ReadonlyArray<Memory>
  forgotten: ReadonlyArray<Memory>
  hasProject: boolean
  hasAgent: boolean
  names: (agentId: string | null) => string
}): string {
  return [
    `Allowed scopes: user${o.hasProject ? ", project" : ""}${o.hasAgent ? ", agent" : ""}.`,
    `Current summary:\n${o.summary || "(empty)"}`,
    `Existing memories:\n${o.existing.map((m, i) => `- [m${i + 1}] ${m.text}`).join("\n") || "(none)"}`,
    `Existing skills:\n${o.skills.map((s) => `- ${s.title}`).join("\n") || "(none)"}`,
    `What the person asked to forget (don't propose it again, not even in other words):\n${o.forgotten.map((m) => `- ${m.title || m.text}`).join("\n") || "(nothing)"}`,
    `Stretch leaving the window:\n${o.chunk.map((m, i) => `#${i + 1} [${m.role === "user" ? "user" : o.names(m.agentId)}] ${m.text}`).join("\n\n")}`
  ].join("\n\n")
}

type Scope = typeof Scope.Type
export interface Consolidation {
  readonly summary: string
  // replaces: index into the existing memories given to the prompt
  readonly memories: ReadonlyArray<{ scope: Scope; text: string; keywords: string; replaces?: number }>
  readonly confirm: ReadonlyArray<number> // indexes into the existing memories given to the prompt
  readonly skills: ReadonlyArray<{ scope: Scope; title: string; text: string }>
}

// The model's answer, item by item: a malformed memory or skill is dropped, not the whole answer.
const Scope = Schema.Literals(["user", "project", "agent"])
const Text = (max: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max))
const Reply = Schema.Struct({
  summary: Text(20_000),
  memories: Schema.optional(Schema.Array(Schema.Unknown)),
  confirm: Schema.optional(Schema.Array(Schema.Unknown)),
  skills: Schema.optional(Schema.Array(Schema.Unknown))
})
const ProposedMemory = Schema.Struct({
  scope: Scope,
  text: Text(500),
  keywords: Schema.optional(Schema.String),
  evidence: Schema.optional(Schema.Array(Schema.Unknown)),
  replaces: Schema.optional(Schema.NullOr(Schema.String))
})
const ProposedSkill = Schema.Struct({ scope: Scope, title: Text(80), text: Text(4000) })
const decodeReply = Schema.decodeUnknownOption(Reply)
const decodeMemory = Schema.decodeUnknownOption(ProposedMemory)
const decodeSkill = Schema.decodeUnknownOption(ProposedSkill)
const KEYWORDS_MAX = 200
// "m3" → 2 (an index into the existing memories given to the prompt).
const ref = (id: unknown) => {
  const n = typeof id === "string" ? Number(id.replace(/^m/, "")) : Number.NaN
  return Number.isInteger(n) && n > 0 ? n - 1 : undefined
}

// Tolerates text around the JSON; drops items outside the allowed scopes, and memories without evidence from the
// person: `said(n)` is message #n of the chunk when it was theirs (an agent's guess never becomes a
// memory), and `agents` is what the agents said (their names and numbers can't slip into a memory). Credentials are
// dropped by the caller (redact is async).
export function parseConsolidation(text: string, allowed: ReadonlyArray<string>, said: (n: number) => string | undefined = () => "", agents = ""): Consolidation | undefined {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start < 0 || end <= start) return undefined
  let json: unknown
  try {
    json = JSON.parse(text.slice(start, end + 1))
  } catch {
    return undefined
  }
  const reply = Option.getOrUndefined(decodeReply(json))
  if (!reply?.summary.trim()) return undefined
  const inScope = <T extends { scope: Scope; text: string }>(x: T) => allowed.includes(x.scope) && x.text.trim() !== ""
  const quoted = (evidence: ReadonlyArray<unknown> = []) => evidence.flatMap((n) => (typeof n === "number" ? [said(n)].filter((t) => t !== undefined) : []))
  return {
    summary: reply.summary.trim(),
    memories: (reply.memories ?? []).flatMap((raw) => Option.toArray(decodeMemory(raw))).flatMap((m) => {
      const proof = quoted(m.evidence)
      if (!inScope(m) || !proof.length || !grounded(m.text, proof.join("\n"), agents)) return []
      const replaces = ref(m.replaces)
      return [{ scope: m.scope, text: m.text.trim(), keywords: (m.keywords ?? "").trim().slice(0, KEYWORDS_MAX), ...(replaces !== undefined && { replaces }) }]
    }),
    confirm: (reply.confirm ?? []).flatMap((id) => [ref(id)].filter((n) => n !== undefined)),
    skills: (reply.skills ?? [])
      .flatMap((raw) => Option.toArray(decodeSkill(raw)))
      .filter((k) => inScope(k) && k.title.trim() !== "")
      .map((k) => ({ scope: k.scope, title: k.title.trim(), text: k.text.trim() }))
  }
}

// The words around the first match, on one line.
export const snippet = (text: string, q: string, around = 60) => {
  const flat = text.replace(/\s+/g, " ")
  const i = flat.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return flat.slice(0, around * 2)
  return `${i > around ? "…" : ""}${flat.slice(Math.max(0, i - around), i + q.length + around)}${i + q.length + around < flat.length ? "…" : ""}`
}
