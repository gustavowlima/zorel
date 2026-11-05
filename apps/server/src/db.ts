// Local database: SQLite via Drizzle over Effect's SqliteClient (D9). Every method returns an Effect;
// a database error is a defect (orDie): the caller can do nothing but fail the request.
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { type Access, type Agent, type AgentPermissions, type AccountUsage, DEFAULT_PERMISSIONS, type Attachment, type Chat, type Effort, type FailoverTarget, type FileChange, type McpServer, type Memory, type Message, PREVIEW_CHARS, type Project, type RoutineWatch, type Step, type Switch } from "@zorel/contracts"
import type { Approval, ApprovalOutcome, Turn, WorkStep } from "@zorel/contracts/events"
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm"
import * as Drizzle from "drizzle-orm/effect-sqlite-bun"
import { LOCAL_ACTOR } from "./access.ts"
import { migrate } from "drizzle-orm/effect-sqlite-bun/migrator"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { Context, Effect, Layer, Semaphore } from "effect"
import { migrationsDir, prepare } from "./migrate.ts"
import { fileTitle, hashOf, markdownFiles, pageText, parsePageText, readText, removeFile, slugOf, titleOfFile, writeAtomic } from "./page-files.ts"
import { type AgentProfile, agents, agentVersions, memoryVersions, pages, pageVersions, routines, approvals, attachments, auditEvents, chatMembers, chats, mcpServers, memories, messages, preferences, projects, providerAccounts, steps, turns } from "./schema.ts"

// The part of an agent a version keeps (everything but its id, project and creation time).
export const profileOf = (a: Agent): AgentProfile => ({
  name: a.name, title: a.title, description: a.description, instructions: a.instructions, model: a.model,
  accountId: a.accountId, effort: a.effort, failover: a.failover, access: a.access, permissions: a.permissions, memory: a.memory, knowledge: a.knowledge
})

// "Prefere PRs pequenos." and "prefere prs pequenos" are the same memory.
export const normalize = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()

// Words too common to find anything (English and Portuguese, after normalize): matching them ranks noise.
const STOPWORDS = new Set(
  "the and you for with that this are was were not but have has had what from can your our they them then than there here will would should could about into just also its ".concat(
    "que para com uma por mais nao isso esse essa este esta ele ela eles elas dos das nos nas foi ser tem como mas seu sua meu minha voce aqui ali pra pelo pela sobre quando onde"
  ).split(" ")
)
// An FTS5 query from free text: each word of 3+ letters that isn't a stopword, as a prefix, any of them.
export const ftsQuery = (text: string) =>
  normalize(text)
    .split(" ")
    .filter((t) => t.length > 2 && !STOPWORDS.has(t))
    .map((t) => `"${t}"*`)
    .join(" OR ")

// Monotonic clock: two messages in the same ms still stay ordered (the summary cuts by `at`).
let last = 0
const now = () => (last = Math.max(Date.now(), last + 1))

type Row = Record<string, any>
const toMessage = (r: typeof messages.$inferSelect, files: ReadonlyArray<Attachment> = []): Message => ({ ...r, steps: JSON.parse(r.steps), attachments: files })
export type AttachmentRow = typeof attachments.$inferSelect
const toMcpServer = (r: typeof mcpServers.$inferSelect): McpServer => ({ ...r, args: JSON.parse(r.args), envKeys: JSON.parse(r.envKeys) })
const toMemory = (r: typeof memories.$inferSelect): Memory => {
  const { normalized: _, owner: _o, audience: _a, keywords: _k, ...m } = r
  return m
}
// A skill an agent sees: its own (agent scope), one for everyone (no agents listed) or one listing it. `forAgent`
// null is no agent at all (a solo chat): only the ones for everyone.
const seenBy = (forAgent: string | null) =>
  forAgent
    ? sql`(${memories.scope} LIKE 'agent:%' OR ${memories.agents} = '[]' OR EXISTS (SELECT 1 FROM json_each(${memories.agents}) WHERE value = ${forAgent}))`
    : sql`(${memories.scope} LIKE 'agent:%' OR ${memories.agents} = '[]')`
// Raw row (hand-written SQL, snake_case columns) from the FTS search.
const memoryRow = (r: Row): Memory => ({
  id: r.id, scope: r.scope, kind: r.kind, title: r.title, text: r.text, state: r.state, origin: r.origin, chatId: r.chat_id,
  essential: !!r.essential, agents: JSON.parse(r.agents ?? "[]"), createdAt: r.created_at, confirmedAt: r.confirmed_at
})
// Memories in these scopes that this owner may hear: about the person (user scope), only their own.
const heard = (scopes: ReadonlyArray<string>, owner: string) =>
  and(inArray(memories.scope, [...scopes]), or(ne(memories.scope, "user"), eq(memories.owner, owner)))
const toTurn = (r: typeof turns.$inferSelect): Turn => ({
  id: r.id, chatId: r.chatId, agentId: r.agentId, model: r.model, accountId: r.accountId, clientId: r.clientId, state: r.state,
  startedAt: r.startedAt, endedAt: r.endedAt, firstTokenAt: r.firstTokenAt, error: r.error,
  usage: { inputTokens: r.inputTokens, outputTokens: r.outputTokens, cachedTokens: r.cachedTokens }
})
const toStep = (r: typeof steps.$inferSelect): WorkStep => ({ ...r, files: JSON.parse(r.files), changes: JSON.parse(r.changes) })
const toApproval = (r: typeof approvals.$inferSelect): Approval => ({
  id: r.id, chatId: r.chatId, turnId: r.turnId, stepId: r.stepId, agentId: r.agentId, kind: r.kind, tool: r.tool,
  summary: r.summary, args: r.args, cwd: r.cwd, alwaysKey: r.alwaysKey, createdAt: r.createdAt, expiresAt: r.expiresAt
})
export type TurnRow = typeof turns.$inferSelect
export type AccountRow = typeof providerAccounts.$inferSelect
const defined = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>

const makeDb = Drizzle.makeWithDefaults()
type Db = Effect.Success<typeof makeDb>

export const repository = (db: Db, pagesDir?: string) => {
  const orDie = <A, E>(e: Effect.Effect<A, E>) => Effect.orDie(e)
  const first = <A>(rows: ReadonlyArray<A>) => rows[0]

  // ---------- knowledge pages as files (page-files.ts) ----------
  // With a folder, every page is also its Markdown file, written through here (the file is the truth; the row
  // indexes it). Without one (tests in memory), only rows.
  type PageRow = typeof pages.$inferSelect
  const pageLock = Semaphore.makeUnsafe(1) // writes and the sync of outside edits, one at a time
  const pathOf = (file: string) => join(pagesDir!, ...file.split("/"))
  const nameOf = (scope: string) =>
    Effect.gen(function* () {
      const [kind, id = ""] = scope.split(":")
      if (kind === "project") return (yield* db.select({ name: projects.name }).from(projects).where(eq(projects.id, id)))[0]?.name
      if (kind === "agent") return (yield* db.select({ name: agents.name }).from(agents).where(eq(agents.id, id)))[0]?.name
      return undefined
    })
  // you/, projects/<name>/, agents/<name>/; a folder another scope already uses gets the id too.
  const folderOf = (scope: string) =>
    Effect.gen(function* () {
      if (scope === "user") return "you"
      const [kind, id = ""] = scope.split(":")
      const base = `${kind === "project" ? "projects" : "agents"}/${slugOf((yield* nameOf(scope)) ?? id)}`
      const taken = yield* db.select({ id: pages.id }).from(pages).where(and(sql`${pages.file} like ${`${base}/%`}`, ne(pages.scope, scope))).limit(1)
      return taken.length ? `${base}-${id.slice(0, 6)}` : base
    })
  const fileTaken = (file: string, id: string) =>
    Effect.map(db.select({ id: pages.id }).from(pages).where(and(eq(pages.file, file), ne(pages.id, id))).limit(1), (r) => r.length > 0 || existsSync(pathOf(file)))
  // Writes the row's file (renamed when the title changed; "Title (2).md" when the name is taken) and records it.
  const writePageFile = (row: PageRow) =>
    Effect.gen(function* () {
      if (!pagesDir) return row
      const folder = row.file ? row.file.slice(0, row.file.lastIndexOf("/")) : yield* folderOf(row.scope)
      const name = fileTitle(row.title)
      let file = `${folder}/${name}.md`
      for (let i = 2; file !== row.file && (yield* fileTaken(file, row.id)); i++) file = `${folder}/${name} (${i}).md`
      const text = pageText({ id: row.id, scope: row.scope, title: row.title, pinned: row.pinned, body: row.body })
      writeAtomic(pathOf(file), text)
      if (row.file && row.file !== file) removeFile(pathOf(row.file))
      const hash = hashOf(text)
      yield* db.update(pages).set({ file, hash }).where(eq(pages.id, row.id))
      return { ...row, file, hash }
    })
  const removePageFiles = (rows: ReadonlyArray<{ file: string | null }>) =>
    Effect.sync(() => {
      if (pagesDir) for (const r of rows) if (r.file) removeFile(pathOf(r.file))
    })
  const addPageVersion = (pageId: string, title: string, body: string, by: string, at: number) =>
    Effect.gen(function* () {
      const [{ n = 0 } = {}] = yield* db.select({ n: sql<number>`coalesce(max(${pageVersions.n}), 0)` }).from(pageVersions).where(eq(pageVersions.pageId, pageId))
      yield* db.insert(pageVersions).values({ id: crypto.randomUUID(), pageId, n: n + 1, title, body, by, at })
    })
  // The scope of a file that came from outside: its front matter's (if it names one that exists), else its folder's.
  const scopeOfFile = (file: string, said: string | undefined, rows: ReadonlyArray<PageRow>) =>
    Effect.gen(function* () {
      const exists = (scope: string) =>
        Effect.gen(function* () {
          if (scope === "user") return true
          const [kind, id = ""] = scope.split(":")
          const table = kind === "project" ? projects : kind === "agent" ? agents : undefined
          return !!table && (yield* db.select({ id: table.id }).from(table).where(eq(table.id, id))).length > 0
        })
      if (said && (yield* exists(said))) return said
      const folder = file.slice(0, file.lastIndexOf("/"))
      if (folder === "you") return "user"
      const sibling = rows.find((r) => r.file?.startsWith(`${folder}/`))
      if (sibling) return sibling.scope
      const [kind, slug] = folder.split("/")
      if (kind === "projects") return (yield* db.select({ id: projects.id, name: projects.name }).from(projects)).filter((p) => slugOf(p.name) === slug).map((p) => `project:${p.id}`)[0]
      if (kind === "agents") return (yield* db.select({ id: agents.id, name: agents.name }).from(agents)).filter((a) => slugOf(a.name) === slug).map((a) => `agent:${a.id}`)[0]
      return undefined
    })

  // Members in order (the first is the leader), and the last message as a one-line preview.
  const withMembers = (rows: ReadonlyArray<typeof chats.$inferSelect>) =>
    Effect.gen(function* () {
      if (!rows.length) return [] as Chat[]
      const ids = rows.map((c) => c.id)
      const ms = yield* db.select().from(chatMembers).where(inArray(chatMembers.chatId, ids)).orderBy(asc(chatMembers.position))
      const last = yield* db
        .select({ chatId: messages.chatId, text: messages.text, at: messages.at })
        .from(messages)
        .where(and(inArray(messages.chatId, ids), sql`${messages.at} = (select max(m2.at) from messages m2 where m2.chat_id = ${messages.chatId})`))
      return rows.map(({ hidden: _hidden, taskOf: _taskOf, taskBy: _taskBy, ...c }): Chat => {
        const l = last.find((m) => m.chatId === c.id)
        return {
          ...c,
          agentIds: ms.filter((m) => m.chatId === c.id).map((m) => m.agentId),
          preview: l ? l.text.replace(/\s+/g, " ").trim().slice(0, PREVIEW_CHARS) || null : null,
          lastAt: l?.at ?? null
        }
      })
    })
  const chat = (id: string) => orDie(db.select().from(chats).where(eq(chats.id, id)).pipe(Effect.flatMap(withMembers), Effect.map(first)))
  const setMembers = (tx: Pick<Db, "delete" | "insert">, chatId: string, agentIds: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      yield* tx.delete(chatMembers).where(eq(chatMembers.chatId, chatId))
      const unique = [...new Set(agentIds)]
      if (unique.length) yield* tx.insert(chatMembers).values(unique.map((agentId, position) => ({ chatId, agentId, position })))
    })
  // Messages with their attachments (one extra query per page of messages).
  const withFiles = <E>(q: Effect.Effect<ReadonlyArray<typeof messages.$inferSelect>, E>) =>
    orDie(
      Effect.gen(function* () {
        const rows = yield* q
        const files = rows.length ? yield* db.select().from(attachments).where(inArray(attachments.messageId, rows.map((r) => r.id))).orderBy(asc(attachments.createdAt)) : []
        return rows.map((r) => toMessage(r, files.filter((f) => f.messageId === r.id).map(({ id, name, mime, size }) => ({ id, name, mime, size }))))
      })
    )
  const memory = (id: string) => orDie(db.select().from(memories).where(eq(memories.id, id)).pipe(Effect.map((r) => (r[0] ? toMemory(r[0]) : undefined))))
  const mcpServer = (id: string) => orDie(db.select().from(mcpServers).where(eq(mcpServers.id, id)).pipe(Effect.map((r) => (r[0] ? toMcpServer(r[0]) : undefined))))
  const project = (id: string) => orDie(db.select().from(projects).where(eq(projects.id, id)).pipe(Effect.map(first)))
  const agent = (id: string) => orDie(db.select().from(agents).where(eq(agents.id, id)).pipe(Effect.map(first)))
  const addVersion = (a: Agent, by: string) =>
    Effect.gen(function* () {
      const [{ n = 0 } = {}] = yield* db.select({ n: sql<number>`coalesce(max(${agentVersions.n}), 0)` }).from(agentVersions).where(eq(agentVersions.agentId, a.id))
      yield* db.insert(agentVersions).values({ id: crypto.randomUUID(), agentId: a.id, n: n + 1, profile: profileOf(a), by, at: now() })
    })

  return {
    // ---------- projects ----------
    // Placed projects in their manual order; new ones (no position yet) first, newest on top.
    projects: (): Effect.Effect<Project[]> =>
      orDie(
        db
          .select({ id: projects.id, name: projects.name, brief: projects.brief, path: projects.path, defaultAgentId: projects.defaultAgentId, createdAt: projects.createdAt })
          .from(projects)
          .orderBy(sql`${projects.position} is not null`, asc(projects.position), desc(projects.createdAt))
      ),
    // Positions follow the given order; ids that aren't projects are ignored.
    reorderProjects: (ids: ReadonlyArray<string>) =>
      orDie(db.transaction((tx) => Effect.forEach(ids, (id, i) => tx.update(projects).set({ position: i }).where(eq(projects.id, id)), { discard: true }))),
    project,
    createProject: (input: { name: string; brief: string; path?: string | null | undefined }) =>
      Effect.gen(function* () {
        const p: Project = { id: crypto.randomUUID(), ...input, path: input.path ?? null, defaultAgentId: null, createdAt: now() }
        yield* db.insert(projects).values(p)
        return p
      }).pipe(orDie),
    updateProject: (id: string, input: { name?: string | undefined; brief?: string | undefined; path?: string | null | undefined; defaultAgentId?: string | null | undefined }) =>
      Effect.gen(function* () {
        const set = defined(input)
        if (Object.keys(set).length) yield* db.update(projects).set(set).where(eq(projects.id, id))
        return yield* project(id)
      }).pipe(orDie),
    removeProject: (id: string) =>
      pageLock.withPermit(
        orDie(
          Effect.gen(function* () {
            const gone = yield* db.transaction((tx) =>
              Effect.gen(function* () {
                const own = yield* tx.select({ id: agents.id }).from(agents).where(eq(agents.projectId, id))
                const scopes = [`project:${id}`, ...own.map((a) => `agent:${a.id}`)]
                const files = yield* tx.select({ file: pages.file }).from(pages).where(inArray(pages.scope, scopes))
                yield* tx.delete(memories).where(inArray(memories.scope, scopes))
                yield* tx.delete(pages).where(inArray(pages.scope, scopes)) // versions cascade
                yield* tx.delete(projects).where(eq(projects.id, id)) // agents, chats and MCP servers cascade
                return files
              })
            )
            yield* removePageFiles(gone)
          })
        )
      ),

    // ---------- agents ----------
    agents: (): Effect.Effect<Agent[]> => orDie(db.select().from(agents).orderBy(asc(agents.createdAt))),
    agent,
    createAgent: (input: { projectId: string | null; name: string; title?: string | undefined; description?: string | undefined; instructions: string; model: string; accountId?: string | null | undefined; effort?: Effort | null | undefined; failover?: ReadonlyArray<FailoverTarget> | undefined; access?: Access | undefined; permissions?: AgentPermissions | undefined; builtin?: "builder" | undefined; memory?: Agent["memory"] | undefined; knowledge?: Agent["knowledge"] | undefined }, by = "you") =>
      Effect.gen(function* () {
        const a: Agent = { id: crypto.randomUUID(), archivedAt: null, monthlyTokens: null, replyTokens: null, ...input, title: input.title ?? "", description: input.description ?? "", accountId: input.accountId ?? null, effort: input.effort ?? null, failover: input.failover ?? [], access: input.access ?? "workspace", permissions: input.permissions ?? DEFAULT_PERMISSIONS, builtin: input.builtin ?? null, memory: input.memory ?? "ask", knowledge: input.knowledge ?? "read", createdAt: now() }
        yield* db.insert(agents).values(a)
        yield* addVersion(a, by)
        return a
      }).pipe(orDie),
    updateAgent: (id: string, input: { name?: string | undefined; title?: string | undefined; description?: string | undefined; instructions?: string | undefined; model?: string | undefined; accountId?: string | null | undefined; effort?: Effort | null | undefined; failover?: ReadonlyArray<FailoverTarget> | undefined; access?: Access | undefined; permissions?: AgentPermissions | undefined; archivedAt?: number | null | undefined; monthlyTokens?: number | null | undefined; replyTokens?: number | null | undefined; memory?: Agent["memory"] | undefined; knowledge?: Agent["knowledge"] | undefined }, by = "you") =>
      Effect.gen(function* () {
        const before = yield* agent(id)
        const set = defined(input)
        if (!before || !Object.keys(set).length) return before
        // An agent from before versions existed: its current profile becomes version 1 first.
        const [{ count = 0 } = {}] = yield* db.select({ count: sql<number>`count(*)` }).from(agentVersions).where(eq(agentVersions.agentId, id))
        if (!count) yield* addVersion(before, "you")
        yield* db.update(agents).set(set).where(eq(agents.id, id))
        const after = (yield* agent(id))!
        if (JSON.stringify(profileOf(after)) !== JSON.stringify(profileOf(before))) yield* addVersion(after, by)
        return after
      }).pipe(orDie),
    // The tokens (input + output) an agent's turns used since a time (its month, for its monthly limit).
    agentTokensSince: (agentId: string, since: number) =>
      orDie(
        db
          .select({ n: sql<number>`coalesce(sum(${turns.inputTokens} + ${turns.outputTokens}), 0)` })
          .from(turns)
          .where(and(eq(turns.agentId, agentId), gte(turns.createdAt, since)))
          .pipe(Effect.map((r) => Number(r[0]?.n ?? 0)))
      ),
    // Newest first.
    // An agent's runs, newest first (the last `limit`): the turn, and its reply's steps and first words.
    agentRuns: (agentId: string, limit = 200) =>
      orDie(
        db
          .select({ t: turns, steps: messages.steps, text: messages.text })
          .from(turns)
          .leftJoin(messages, eq(messages.id, turns.messageId))
          .where(and(eq(turns.agentId, agentId), ne(turns.state, "queued")))
          .orderBy(desc(turns.createdAt))
          .limit(limit)
          .pipe(
            Effect.map((rows) =>
              rows.map(({ t, steps, text }) => ({
                turnId: t.id, chatId: t.chatId, messageId: t.messageId, state: t.state, startedAt: t.startedAt, endedAt: t.endedAt, error: t.error,
                inputTokens: t.inputTokens, outputTokens: t.outputTokens,
                preview: (text ?? t.partialText).replace(/\s+/g, " ").trim().slice(0, PREVIEW_CHARS),
                steps: steps ? (JSON.parse(steps) as Step[]) : []
              }))
            )
          )
      ),
    agentVersions: (agentId: string) => orDie(db.select().from(agentVersions).where(eq(agentVersions.agentId, agentId)).orderBy(desc(agentVersions.n))),
    removeAgent: (id: string) =>
      pageLock.withPermit(
        orDie(
          Effect.gen(function* () {
            const gone = yield* db.transaction((tx) =>
              Effect.gen(function* () {
                const files = yield* tx.select({ file: pages.file }).from(pages).where(eq(pages.scope, `agent:${id}`))
                yield* tx.delete(memories).where(eq(memories.scope, `agent:${id}`))
                yield* tx.delete(pages).where(eq(pages.scope, `agent:${id}`))
                yield* tx.delete(agents).where(eq(agents.id, id))
                return files
              })
            )
            yield* removePageFiles(gone)
          })
        )
      ),

    // ---------- knowledge pages (phase 3b) ----------
    pages: () => orDie(db.select().from(pages).orderBy(desc(pages.updatedAt))),
    page: (id: string) => orDie(db.select().from(pages).where(eq(pages.id, id)).pipe(Effect.map(first))),
    // Every change of title or body is kept as a version (the first one too), with who made it; the file follows.
    savePage: (input: { id?: string | undefined; scope: string; title: string; body: string }, by = "you") =>
      pageLock.withPermit(
        Effect.gen(function* () {
          const at = now()
          const existing = input.id ? (yield* db.select().from(pages).where(eq(pages.id, input.id)))[0] : undefined
          const id = existing?.id ?? crypto.randomUUID()
          if (existing) {
            if (existing.title === input.title && existing.body === input.body) return existing
            yield* db.update(pages).set({ title: input.title, body: input.body, updatedAt: at }).where(eq(pages.id, id))
          } else yield* db.insert(pages).values({ id, scope: input.scope, title: input.title, body: input.body, pinned: false, updatedAt: at, createdAt: at })
          yield* addPageVersion(id, input.title, input.body, by, at)
          return yield* writePageFile((yield* db.select().from(pages).where(eq(pages.id, id)))[0]!)
        }).pipe(orDie)
      ),
    pinPage: (id: string, pinned: boolean) =>
      pageLock.withPermit(
        Effect.gen(function* () {
          yield* db.update(pages).set({ pinned }).where(eq(pages.id, id))
          const row = (yield* db.select().from(pages).where(eq(pages.id, id)))[0]
          if (row) yield* writePageFile(row)
        }).pipe(orDie)
      ),
    removePage: (id: string) =>
      pageLock.withPermit(
        Effect.gen(function* () {
          const gone = yield* db.delete(pages).where(eq(pages.id, id)).returning({ file: pages.file })
          yield* removePageFiles(gone)
        }).pipe(orDie)
      ),
    // Brings the folder and the rows together. A file edited, added or moved outside Zorel updates its page (a
    // version by "outside"); a row without its file gets it written (first run, an imported workspace), unless
    // `deleted` says the folder lost it while Zorel watched it, then the page goes. A file whose scope can't be
    // told (no front matter, a folder nobody owns) is left alone.
    syncPages: (deleted = false) =>
      !pagesDir
        ? Effect.succeed({ imported: 0, updated: 0, written: 0, removed: 0 })
        : pageLock.withPermit(
            Effect.gen(function* () {
              const report = { imported: 0, updated: 0, written: 0, removed: 0 }
              const rows = yield* db.select().from(pages)
              const matched = new Set<string>()
              const disk = markdownFiles(pagesDir)
              for (const file of disk) {
                const text = readText(pathOf(file))
                const hash = hashOf(text)
                const parsed = parsePageText(text)
                const row = rows.find((r) => r.file === file) ?? (parsed.id ? rows.find((r) => r.id === parsed.id && !matched.has(r.id) && !(r.file && disk.includes(r.file))) : undefined) // moved or renamed outside
                if (row) matched.add(row.id)
                if (row && row.file === file && row.hash === hash) continue
                const title = parsed.title ?? titleOfFile(file)
                const at = now()
                if (row) {
                  const changed = row.title !== title || row.body !== parsed.body
                  yield* db.update(pages).set({ title, body: parsed.body, pinned: parsed.pinned ?? row.pinned, file, hash, ...(changed && { updatedAt: at }) }).where(eq(pages.id, row.id))
                  if (changed) yield* addPageVersion(row.id, title, parsed.body, "outside", at)
                  report.updated++
                  continue
                }
                const scope = yield* scopeOfFile(file, parsed.scope, rows)
                if (!scope) continue
                const id = parsed.id && !rows.some((r) => r.id === parsed.id) ? parsed.id : crypto.randomUUID()
                yield* db.insert(pages).values({ id, scope, title, body: parsed.body, pinned: parsed.pinned ?? false, file, hash, updatedAt: at, createdAt: at })
                yield* addPageVersion(id, title, parsed.body, "outside", at)
                matched.add(id)
                report.imported++
                // Its front matter gets the id and scope, so a later rename or move keeps it the same page.
                if (parsed.id !== id || parsed.scope !== scope) yield* writePageFile((yield* db.select().from(pages).where(eq(pages.id, id)))[0]!)
              }
              for (const r of rows) {
                if (matched.has(r.id)) continue
                if (deleted && r.file) {
                  yield* db.delete(pages).where(eq(pages.id, r.id))
                  report.removed++
                } else {
                  yield* writePageFile(r)
                  report.written++
                }
              }
              return report
            }).pipe(orDie)
          ),
    pageVersions: (pageId: string) => orDie(db.select().from(pageVersions).where(eq(pageVersions.pageId, pageId)).orderBy(desc(pageVersions.n))),
    // BM25 over title + body in the scopes; the words around the first match.
    searchPages: (scopes: ReadonlyArray<string>, query: string, limit: number) => {
      const match = ftsQuery(query)
      if (!match || !scopes.length) return Effect.succeed([] as Array<typeof pages.$inferSelect>)
      return orDie(
        db.all<typeof pages.$inferSelect>(
          sql`SELECT pages.* FROM page_index JOIN pages ON pages.id = page_index.id
              WHERE page_index MATCH ${match} AND ${inArray(pages.scope, [...scopes])}
              ORDER BY bm25(page_index) LIMIT ${limit}`
        )
      )
    },
    hasPages: (scopes: ReadonlyArray<string>) =>
      scopes.length ? orDie(db.select({ id: pages.id }).from(pages).where(inArray(pages.scope, [...scopes])).limit(1).pipe(Effect.map((r) => r.length > 0))) : Effect.succeed(false),
    // A page in the scopes by id or exact title (case aside), without loading every page's body.
    pageIn: (scopes: ReadonlyArray<string>, ref: string) =>
      scopes.length
        ? orDie(db.select().from(pages).where(and(inArray(pages.scope, [...scopes]), sql`(${pages.id} = ${ref} OR lower(${pages.title}) = lower(${ref}))`)).limit(1).pipe(Effect.map(first)))
        : Effect.succeed(undefined),
    pinnedPages: (scopes: ReadonlyArray<string>) =>
      scopes.length ? orDie(db.select({ id: pages.id, scope: pages.scope, title: pages.title }).from(pages).where(and(eq(pages.pinned, true), inArray(pages.scope, [...scopes])))) : Effect.succeed([]),

    // ---------- routines (phase 7) ----------
    routines: () => orDie(db.select().from(routines).orderBy(asc(routines.createdAt))),
    routine: (id: string) => orDie(db.select().from(routines).where(eq(routines.id, id)).pipe(Effect.map(first))),
    routineByToken: (token: string) => orDie(db.select().from(routines).where(eq(routines.token, token)).pipe(Effect.map(first))),
    createRoutine: (input: { agentId: string; chatId: string; name: string; prompt: string; cron: string | null; token: string | null; nextRunAt: number | null; watch: RoutineWatch | null }) =>
      Effect.gen(function* () {
        const r = { id: crypto.randomUUID(), ...input, watchSeen: null, watchAt: null, enabled: true, lastRunAt: null, lastStatus: null, createdAt: now() } as const
        yield* db.insert(routines).values(r)
        return r
      }).pipe(orDie),
    updateRoutine: (id: string, input: { [K in "name" | "prompt" | "cron" | "token" | "watch" | "watchSeen" | "watchAt" | "enabled" | "nextRunAt" | "lastRunAt" | "lastStatus"]?: (typeof routines.$inferInsert)[K] | undefined }) =>
      Effect.gen(function* () {
        const set = defined(input)
        if (Object.keys(set).length) yield* db.update(routines).set(set).where(eq(routines.id, id))
        return (yield* db.select().from(routines).where(eq(routines.id, id)))[0]
      }).pipe(orDie),
    removeRoutine: (id: string) => orDie(db.delete(routines).where(eq(routines.id, id)).pipe(Effect.asVoid)),
    // Enabled, scheduled and due by `at`.
    // Enabled and watching a connector.
    watchingRoutines: () => orDie(db.select().from(routines).where(and(eq(routines.enabled, true), isNotNull(routines.watch)))),
    dueRoutines: (at: number) => orDie(db.select().from(routines).where(and(eq(routines.enabled, true), sql`${routines.nextRunAt} <= ${at}`))),

    // ---------- chats and messages ----------
    chats: () => orDie(db.select().from(chats).where(eq(chats.hidden, false)).orderBy(desc(chats.createdAt)).pipe(Effect.flatMap(withMembers))),
    // A screen's own conversations (the Builder's) in a project or General: replaced each time the screen opens.
    // Hidden chats (the Builder's) of a project, created before `before` (ms).
    hiddenChats: (projectId: string | null, before: number) =>
      orDie(db.select({ id: chats.id }).from(chats).where(and(eq(chats.hidden, true), lt(chats.createdAt, before), projectId ? eq(chats.projectId, projectId) : isNull(chats.projectId)))),
    // Only chats already in that group move: a chat never changes project by reordering.
    reorderChats: (projectId: string | null, ids: ReadonlyArray<string>) =>
      orDie(
        db.transaction((tx) =>
          Effect.forEach(
            ids,
            (id, i) => tx.update(chats).set({ position: i }).where(and(eq(chats.id, id), projectId === null ? isNull(chats.projectId) : eq(chats.projectId, projectId))),
            { discard: true }
          )
        )
      ),
    chat,
    createChat: (input: { projectId: string | null; agentIds: ReadonlyArray<string>; model: string; accountId?: string | null | undefined; effort?: Effort | null | undefined; access?: Access | null | undefined; hidden?: boolean | undefined; title?: string | undefined; taskOf?: string | null | undefined; taskBy?: string | null | undefined }) =>
      Effect.gen(function* () {
        const id = crypto.randomUUID()
        yield* db.transaction((tx) =>
          Effect.gen(function* () {
            yield* tx.insert(chats).values({ id, projectId: input.projectId, title: input.title ?? "New chat", model: input.model, accountId: input.accountId ?? null, effort: input.effort ?? null, access: input.access ?? null, hidden: input.hidden ?? false, taskOf: input.taskOf ?? null, taskBy: input.taskBy ?? null, createdAt: now() })
            yield* setMembers(tx, id, input.agentIds)
          })
        )
        return (yield* chat(id))!
      }).pipe(orDie),
    // Tasks still owing a result (zorel_start_task), and closing one once its result went back.
    openTasks: () => orDie(db.select({ id: chats.id, taskOf: chats.taskOf, taskBy: chats.taskBy }).from(chats).where(sql`${chats.taskOf} is not null`)),
    closeTask: (id: string) => orDie(db.update(chats).set({ taskOf: null }).where(eq(chats.id, id)).pipe(Effect.asVoid)),
    updateChat: (id: string, input: { resumeAt?: null | undefined; title?: string | undefined; model?: string | undefined; accountId?: string | null | undefined; effort?: Effort | null | undefined; access?: Access | null | undefined; failover?: ReadonlyArray<FailoverTarget> | null | undefined; agentIds?: ReadonlyArray<string> | undefined }) =>
      Effect.gen(function* () {
        yield* db.transaction((tx) =>
          Effect.gen(function* () {
            const set = defined({ title: input.title, model: input.model, accountId: input.accountId, effort: input.effort, access: input.access, failover: input.failover, resumeAt: input.resumeAt })
            if (Object.keys(set).length) yield* tx.update(chats).set(set).where(eq(chats.id, id))
            if (input.agentIds) yield* setMembers(tx, id, input.agentIds)
          })
        )
        return yield* chat(id)
      }).pipe(orDie),
    setResumeAt: (id: string, resumeAt: number | null) => orDie(db.update(chats).set({ resumeAt }).where(eq(chats.id, id)).pipe(Effect.asVoid)),
    // Chats whose usage-limit pause is over.
    dueResumes: (at: number) => orDie(db.select({ id: chats.id, resumeAt: chats.resumeAt }).from(chats).where(sql`${chats.resumeAt} <= ${at}`)),
    setWorktree: (id: string, worktree: string | null) => orDie(db.update(chats).set({ worktree }).where(eq(chats.id, id)).pipe(Effect.asVoid)),
    setSummary: (id: string, summary: string, until: number) => orDie(db.update(chats).set({ summary, summaryUntil: until, learnedUntil: sql`max(${chats.learnedUntil}, ${until})` }).where(eq(chats.id, id)).pipe(Effect.asVoid)),
    setLearned: (id: string, until: number) => orDie(db.update(chats).set({ learnedUntil: until }).where(eq(chats.id, id)).pipe(Effect.asVoid)),
    // Messages containing the words (newest first). ponytail: LIKE scan; FTS5 like memory_index when chats grow large.
    searchMessages: (q: string, limit = 30) => {
      const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
      return orDie(
        db
          .select({ id: messages.id, chatId: messages.chatId, text: messages.text, at: messages.at })
          .from(messages)
          .where(sql`${messages.text} like ${like} escape '\\'`)
          .orderBy(desc(messages.at))
          .limit(limit)
      )
    },
    // "Edit from here": the message at `at` and everything after it go.
    deleteMessagesFrom: (chatId: string, at: number) => orDie(db.delete(messages).where(and(eq(messages.chatId, chatId), sql`${messages.at} >= ${at}`)).pipe(Effect.asVoid)),
    removeChat: (id: string) => orDie(db.delete(chats).where(eq(chats.id, id)).pipe(Effect.asVoid)),
    messages: (chatId: string) => withFiles(db.select().from(messages).where(eq(messages.chatId, chatId)).orderBy(asc(messages.at))),
    messagesAfter: (chatId: string, at: number) =>
      withFiles(db.select().from(messages).where(and(eq(messages.chatId, chatId), gt(messages.at, at))).orderBy(asc(messages.at))),
    // attachmentIds: files uploaded to this chat beforehand; linked to the message here.
    addMessage: (
      input: Omit<Message, "id" | "at" | "attachments" | "switches" | "turnId" | "changes" | "revertedAt" | "accountId" | "cost" | "durationMs"> & {
        durationMs?: number | null | undefined
        attachmentIds?: ReadonlyArray<string> | undefined
        switches?: ReadonlyArray<Switch> | undefined
        turnId?: string | null | undefined
        changes?: ReadonlyArray<FileChange> | undefined
        accountId?: string | null | undefined
        cost?: number | null | undefined
      }
    ) =>
      Effect.gen(function* () {
        const { attachmentIds = [], switches = [], turnId = null, changes = [], accountId = null, cost = null, durationMs = null, ...rest } = input
        const base = { id: crypto.randomUUID(), ...rest, switches, turnId, changes, accountId, cost, durationMs, revertedAt: null, at: now() }
        yield* db.insert(messages).values({ ...base, steps: JSON.stringify(base.steps) })
        let files: Attachment[] = []
        if (attachmentIds.length) {
          const linked = yield* db
            .update(attachments)
            .set({ messageId: base.id })
            .where(and(inArray(attachments.id, [...attachmentIds]), eq(attachments.chatId, base.chatId), isNull(attachments.messageId)))
            .returning()
          files = linked.map(({ id, name, mime, size }) => ({ id, name, mime, size }))
        }
        return { ...base, attachments: files } satisfies Message
      }).pipe(orDie),

    // ---------- attachments ----------
    addAttachment: (input: Omit<AttachmentRow, "id" | "messageId" | "createdAt"> & { id: string }) =>
      Effect.gen(function* () {
        yield* db.insert(attachments).values({ ...input, messageId: null, createdAt: now() })
        return { id: input.id, name: input.name, mime: input.mime, size: input.size } satisfies Attachment
      }).pipe(orDie),
    attachment: (id: string) => orDie(db.select().from(attachments).where(eq(attachments.id, id)).pipe(Effect.map(first))),
    attachmentsOf: (messageIds: ReadonlyArray<string>) =>
      orDie(db.select().from(attachments).where(inArray(attachments.messageId, [...messageIds])).orderBy(asc(attachments.createdAt))),

    // ---------- memories and skills ----------
    // All, including forgotten ones (the UI offers restore): pending, active, forgotten.
    memories: () =>
      orDie(
        db
          .select()
          .from(memories)
          .orderBy(sql`${memories.state} = 'forgotten'`, sql`${memories.state} = 'active'`, desc(memories.confirmedAt))
          .pipe(Effect.map((r) => r.map(toMemory)))
      ),
    // What the person asked to forget, so consolidation doesn't propose it again (not even paraphrased).
    forgottenMemories: (scopes: ReadonlyArray<string>, limit = 50, owner = LOCAL_ACTOR.id) =>
      orDie(
        db
          .select()
          .from(memories)
          .where(and(eq(memories.state, "forgotten"), heard(scopes, owner)))
          .orderBy(desc(memories.confirmedAt))
          .limit(limit)
          .pipe(Effect.map((r) => r.map(toMemory)))
      ),
    pendingCount: (scopes: ReadonlyArray<string>, owner = LOCAL_ACTOR.id) =>
      orDie(db.$count(memories, and(eq(memories.state, "pending"), heard(scopes, owner)))),
    // Waiting for review in these scopes (consolidation checks new proposals against them).
    pendingMemories: (scopes: ReadonlyArray<string>, owner = LOCAL_ACTOR.id) =>
      orDie(db.select().from(memories).where(and(eq(memories.state, "pending"), heard(scopes, owner))).pipe(Effect.map((r) => r.map(toMemory)))),
    memory,
    // forAgent: the agent reading skills (the ones restricted to other agents stay out); undefined: no filter.
    activeMemories: (scopes: ReadonlyArray<string>, kind: Memory["kind"] = "fact", owner = LOCAL_ACTOR.id, forAgent?: string | null) =>
      orDie(
        db
          .select()
          .from(memories)
          .where(and(eq(memories.state, "active"), eq(memories.kind, kind), heard(scopes, owner), forAgent === undefined ? undefined : seenBy(forAgent)))
          .orderBy(desc(memories.confirmedAt))
          .pipe(Effect.map((r) => r.map(toMemory)))
      ),
    // Already exists (same normalized text in scope): returns undefined and doesn't duplicate or revive a forgotten one.
    // owner: the Actor who created it (or the chat owner, in consolidation). About the person (user scope): only the owner hears.
    // keywords: other words for the same idea, indexed for search only.
    addMemory: (input: { scope: string; kind?: Memory["kind"]; title?: string; text: string; state: Memory["state"]; origin: Memory["origin"]; chatId: string | null; owner?: string; replaces?: string | null; reason?: string | null; keywords?: string; agents?: ReadonlyArray<string> | undefined }) =>
      Effect.gen(function* () {
        const at = now()
        const { owner = LOCAL_ACTOR.id, keywords = "", agents: only = [], ...rest } = input
        // Only a skill can be limited to some agents.
        const m: Memory = { id: crypto.randomUUID(), kind: "fact", title: "", replaces: null, reason: null, ...rest, agents: rest.kind === "skill" ? only : [], createdAt: at, confirmedAt: at }
        const audience = m.scope === "user" ? "owner" : "project"
        const inserted = yield* db.insert(memories).values({ ...m, owner, audience, keywords, normalized: normalize(m.text) }).onConflictDoNothing().returning({ id: memories.id })
        // Said again: the existing active one is confirmed (it ranks first for the prompt's budget).
        if (!inserted.length)
          yield* db.update(memories).set({ confirmedAt: at }).where(and(eq(memories.scope, m.scope), eq(memories.normalized, normalize(m.text)), eq(memories.state, "active")))
        return inserted.length ? m : undefined
      }).pipe(orDie),
    // Still true (consolidation saw it again): ranks first for the prompt's budget.
    confirmMemories: (ids: ReadonlyArray<string>) =>
      ids.length ? orDie(db.update(memories).set({ confirmedAt: now() }).where(and(inArray(memories.id, [...ids]), eq(memories.state, "active"))).pipe(Effect.asVoid)) : Effect.void,
    // Another memory of the scope already says this (the unique key would refuse the edit).
    textTaken: (id: string, scope: string, text: string) =>
      orDie(db.select({ id: memories.id }).from(memories).where(and(eq(memories.scope, scope), eq(memories.normalized, normalize(text)), ne(memories.id, id))).pipe(Effect.map((r) => r.length > 0))),
    // A changed text or title keeps the one before as a version (by: who changed it).
    updateMemory: (id: string, input: { state?: Memory["state"] | undefined; title?: string | undefined; text?: string | undefined; essential?: boolean | undefined; agents?: ReadonlyArray<string> | undefined }, by = "you") =>
      Effect.gen(function* () {
        const before = yield* memory(id)
        if (before && ((input.text !== undefined && input.text !== before.text) || (input.title !== undefined && input.title !== before.title)))
          yield* db.insert(memoryVersions).values({ id: crypto.randomUUID(), memoryId: id, title: before.title, text: before.text, by, at: now() })
        const set = defined({ ...input, normalized: input.text && normalize(input.text), confirmedAt: now() })
        yield* db.update(memories).set(set).where(eq(memories.id, id))
        return yield* memory(id)
      }).pipe(orDie),
    memoryVersions: (memoryId: string) =>
      orDie(db.select({ id: memoryVersions.id, title: memoryVersions.title, text: memoryVersions.text, by: memoryVersions.by, at: memoryVersions.at }).from(memoryVersions).where(eq(memoryVersions.memoryId, memoryId)).orderBy(desc(memoryVersions.at))),
    memoryVersion: (id: string) => orDie(db.select().from(memoryVersions).where(eq(memoryVersions.id, id)).pipe(Effect.map((r) => r[0]))),
    // An approved improvement: its text goes onto the skill it replaces (the old one becomes a version) and the
    // proposal itself goes away. Undefined when the skill it pointed at is gone.
    applyImprovement: (pendingId: string, by: string) =>
      Effect.gen(function* () {
        const p = yield* memory(pendingId)
        const target = p?.replaces ? yield* memory(p.replaces) : undefined
        if (!p || !target || target.state === "forgotten") return undefined
        const [{ keywords = "" } = {}] = yield* db.select({ keywords: memories.keywords }).from(memories).where(eq(memories.id, p.id))
        yield* db.delete(memories).where(eq(memories.id, p.id))
        const before = target
        yield* db.insert(memoryVersions).values({ id: crypto.randomUUID(), memoryId: target.id, title: before.title, text: before.text, by, at: now() })
        yield* db.update(memories).set({ title: p.title, text: p.text, keywords, normalized: normalize(p.text), confirmedAt: now() }).where(eq(memories.id, target.id))
        return yield* memory(target.id)
      }).pipe(orDie),
    // BM25 (FTS5) among active ones in the scopes, excluding those already in the prompt. Skills also match by title.
    searchMemories: (scopes: ReadonlyArray<string>, query: string, exclude: ReadonlyArray<string>, limit: number, kind: Memory["kind"] = "fact", owner = LOCAL_ACTOR.id, forAgent?: string | null) => {
      const match = ftsQuery(query)
      if (!match) return Effect.succeed([] as Memory[])
      return orDie(
        db
          .all<Row>(
            sql`SELECT memories.* FROM memory_index JOIN memories ON memories.id = memory_index.id
                WHERE memory_index MATCH ${match} AND ${eq(memories.state, "active")} AND ${eq(memories.kind, kind)}
                  AND ${heard(scopes, owner)} AND ${notInArray(memories.id, [...exclude])}${forAgent === undefined ? sql`` : sql` AND ${seenBy(forAgent)}`}
                ORDER BY bm25(memory_index) LIMIT ${limit}`
          )
          .pipe(Effect.map((r) => r.map(memoryRow)))
      )
    },

    // ---------- MCP servers ----------
    mcpServers: () => orDie(db.select().from(mcpServers).orderBy(asc(mcpServers.createdAt)).pipe(Effect.map((r) => r.map(toMcpServer)))),
    mcpServer,
    // The enabled ones a chat sees: global + its project's.
    mcpServersFor: (projectId: string | null) =>
      orDie(
        db
          .select()
          .from(mcpServers)
          .where(and(eq(mcpServers.enabled, true), projectId ? or(isNull(mcpServers.projectId), eq(mcpServers.projectId, projectId)) : isNull(mcpServers.projectId)))
          .orderBy(asc(mcpServers.createdAt))
          .pipe(Effect.map((r) => r.map(toMcpServer)))
      ),
    createMcpServer: (input: Omit<McpServer, "id" | "enabled" | "createdAt">) =>
      Effect.gen(function* () {
        const s: McpServer = { id: crypto.randomUUID(), ...input, enabled: true, createdAt: now() }
        yield* db.insert(mcpServers).values({ ...s, args: JSON.stringify(s.args), envKeys: JSON.stringify(s.envKeys) })
        return s
      }).pipe(orDie),
    updateMcpServer: (id: string, input: { mode?: McpServer["mode"] | undefined; enabled?: boolean | undefined; envKeys?: ReadonlyArray<string> | undefined }) =>
      Effect.gen(function* () {
        const { envKeys, ...rest } = defined(input)
        const set = { ...rest, ...(envKeys && { envKeys: JSON.stringify(envKeys) }) }
        if (Object.keys(set).length) yield* db.update(mcpServers).set(set).where(eq(mcpServers.id, id))
        return yield* mcpServer(id)
      }).pipe(orDie),
    removeMcpServer: (id: string) => orDie(db.delete(mcpServers).where(eq(mcpServers.id, id)).pipe(Effect.asVoid)),

    // ---------- provider accounts ----------
    accounts: () => orDie(db.select().from(providerAccounts).orderBy(asc(providerAccounts.createdAt))),
    account: (id: string) => orDie(db.select().from(providerAccounts).where(eq(providerAccounts.id, id)).pipe(Effect.map(first))),
    // Creates it only if missing (default accounts are seeded on every boot).
    ensureAccount: (a: Omit<AccountRow, "createdAt" | "limitedUntil" | "usage">) =>
      orDie(db.insert(providerAccounts).values({ ...a, createdAt: now() }).onConflictDoNothing().pipe(Effect.asVoid)),
    updateAccount: (id: string, set: { label?: string; identity?: string | null; limitedUntil?: number | null; usage?: AccountUsage | null }) =>
      orDie(db.update(providerAccounts).set(defined(set)).where(eq(providerAccounts.id, id)).returning().pipe(Effect.map(first))),
    removeAccount: (id: string) =>
      orDie(
        db.transaction((tx) =>
          Effect.gen(function* () {
            // Agents and chats that used it fall back to the provider's default account.
            yield* tx.update(agents).set({ accountId: null }).where(eq(agents.accountId, id))
            yield* tx.update(chats).set({ accountId: null }).where(eq(chats.accountId, id))
            yield* tx.delete(providerAccounts).where(eq(providerAccounts.id, id))
          })
        )
      ),

    // ---------- turns (per-chat queue) ----------
    turnRow: (id: string) => orDie(db.select().from(turns).where(eq(turns.id, id)).pipe(Effect.map(first))),
    turnByClientId: (clientId: string) => orDie(db.select().from(turns).where(eq(turns.clientId, clientId)).pipe(Effect.map(first))),
    // route: the agent is picked (router.ts) when the turn starts; agentId is the fallback (the lead).
    retargetTurn: (id: string, to: { agentId: string; model: string; accountId: string | null }) =>
      orDie(db.update(turns).set({ ...to, route: false }).where(eq(turns.id, id)).returning().pipe(Effect.map((r) => r[0]!))),
    enqueueTurn: (input: { chatId: string; agentId: string | null; model: string; accountId?: string | null; clientId: string | null; depth: number; route?: boolean }) =>
      orDie(db.insert(turns).values({ id: crypto.randomUUID(), ...input, state: "queued", createdAt: now() }).returning().pipe(Effect.map((r) => r[0]!))),
    // What a chat runs next: your own messages (depth 0) before the replies that agents handed to one another (depth > 0),
    // each group in order of arrival. A message of yours never waits behind a chain it didn't start.
    nextQueued: (chatId: string) =>
      orDie(db.select().from(turns).where(and(eq(turns.chatId, chatId), eq(turns.state, "queued"))).orderBy(asc(sql`${turns.depth} > 0`), asc(turns.createdAt)).limit(1).pipe(Effect.map(first))),
    turnsIn: (state: TurnRow["state"]) => orDie(db.select().from(turns).where(eq(turns.state, state)).orderBy(asc(turns.createdAt))),
    activeTurns: (chatId: string) =>
      orDie(db.select().from(turns).where(and(eq(turns.chatId, chatId), inArray(turns.state, ["queued", "running"]))).orderBy(asc(turns.createdAt)).pipe(Effect.map((r) => r.map(toTurn)))),
    startTurn: (id: string) =>
      orDie(db.update(turns).set({ state: "running", startedAt: now() }).where(eq(turns.id, id)).returning().pipe(Effect.map((r) => r[0]!))),
    markFirstToken: (id: string) => orDie(db.update(turns).set({ firstTokenAt: now() }).where(and(eq(turns.id, id), isNull(turns.firstTokenAt))).pipe(Effect.asVoid)),
    savePartial: (id: string, partialText: string) => orDie(db.update(turns).set({ partialText }).where(eq(turns.id, id)).pipe(Effect.asVoid)),
    finishTurn: (id: string, end: { state: "completed" | "failed" | "interrupted"; error: string | null; messageId: string | null; usage?: { inputTokens: number; outputTokens: number; cachedTokens?: number }; cost?: number | null; route?: { model: string; accountId: string | null; switches: ReadonlyArray<Switch> }; trees?: { treeBefore: string; treeAfter: string } }) =>
      orDie(
        db
          .update(turns)
          .set({ state: end.state, error: end.error, messageId: end.messageId, endedAt: now(), ...(end.route && end.route), ...(end.trees && end.trees), ...(end.cost !== undefined && { cost: end.cost }), ...(end.usage && { inputTokens: end.usage.inputTokens, outputTokens: end.usage.outputTokens, cachedTokens: end.usage.cachedTokens ?? 0 }) })
          .where(eq(turns.id, id))
          .returning()
          .pipe(Effect.map((r) => toTurn(r[0]!)))
      ),
    toTurn: (r: TurnRow) => toTurn(r),

    // ---------- steps ----------
    addStep: (input: Omit<WorkStep, "id" | "startedAt" | "durationMs" | "changes" | "output" | "detail"> & { changes?: ReadonlyArray<FileChange>; detail?: string }) =>
      Effect.gen(function* () {
        const step: WorkStep = { id: crypto.randomUUID(), startedAt: now(), durationMs: null, output: "", ...input, detail: input.detail ?? "", changes: input.changes ?? [] }
        yield* db.insert(steps).values({ ...step, files: JSON.stringify(step.files), changes: JSON.stringify(step.changes) })
        return step
      }).pipe(orDie),
    finishStep: (step: WorkStep, end: { status: WorkStep["status"]; output?: string; changes?: ReadonlyArray<FileChange> }) =>
      Effect.gen(function* () {
        const done: WorkStep = { ...step, status: end.status, output: end.output ?? step.output, changes: end.changes ?? step.changes, durationMs: end.status === "waiting" ? null : now() - step.startedAt }
        yield* db.update(steps).set({ status: done.status, output: done.output, changes: JSON.stringify(done.changes), durationMs: done.durationMs }).where(eq(steps.id, step.id))
        return done
      }).pipe(orDie),
    // Commands the agents ran in a chat (terminal panel), oldest first.
    runsOf: (chatId: string, limit = 200) =>
      orDie(
        db
          .select({ step: steps })
          .from(steps)
          .innerJoin(turns, eq(turns.id, steps.turnId))
          .where(and(eq(turns.chatId, chatId), eq(steps.kind, "run")))
          .orderBy(desc(steps.startedAt))
          .limit(limit)
          .pipe(Effect.map((r) => r.map((x) => toStep(x.step)).reverse()))
      ),
    // The chat's first workspace checkpoint (marks "what this conversation changed" in the file tree).
    firstTree: (chatId: string) =>
      orDie(
        db.select({ tree: turns.treeBefore }).from(turns).where(and(eq(turns.chatId, chatId), sql`${turns.treeBefore} is not null`)).orderBy(asc(turns.createdAt)).limit(1).pipe(Effect.map((r) => r[0]?.tree ?? null))
      ),
    markReverted: (turnId: string) => orDie(db.update(messages).set({ revertedAt: now() }).where(eq(messages.turnId, turnId)).pipe(Effect.asVoid)),
    stepsOf: (turnIds: ReadonlyArray<string>) =>
      orDie(db.select().from(steps).where(inArray(steps.turnId, [...turnIds])).orderBy(asc(steps.startedAt)).pipe(Effect.map((r) => r.map(toStep)))),

    // ---------- approvals ----------
    addApproval: (input: Omit<Approval, "id" | "createdAt">) =>
      Effect.gen(function* () {
        const a: Approval = { id: crypto.randomUUID(), createdAt: now(), ...input }
        yield* db.insert(approvals).values(a)
        return a
      }).pipe(orDie),
    // Only closes an open one: returns undefined if already decided or missing.
    resolveApproval: (id: string, outcome: ApprovalOutcome, reason: string | null, by: "user" | "rule" | "expiry") =>
      orDie(
        db
          .update(approvals)
          .set({ outcome, reason, decidedBy: by, decidedAt: now() })
          .where(and(eq(approvals.id, id), isNull(approvals.outcome)))
          .returning()
          .pipe(Effect.map((r) => (r[0] ? toApproval(r[0]) : undefined)))
      ),
    openApprovals: (chatId?: string) =>
      orDie(
        db
          .select()
          .from(approvals)
          .where(chatId ? and(isNull(approvals.outcome), eq(approvals.chatId, chatId)) : isNull(approvals.outcome))
          .orderBy(asc(approvals.createdAt))
          .pipe(Effect.map((r) => r.map(toApproval)))
      ),

    // The most expensive finished turns since `since`, with their chat.
    topTurns: (since: number, limit = 10) =>
      orDie(
        db
          .select({
            turnId: turns.id, chatId: turns.chatId, chatTitle: chats.title, agentId: turns.agentId, model: turns.model, accountId: turns.accountId,
            inputTokens: turns.inputTokens, outputTokens: turns.outputTokens, cost: turns.cost, at: turns.createdAt
          })
          .from(turns)
          .innerJoin(chats, eq(chats.id, turns.chatId))
          .where(and(gt(turns.createdAt, since), sql`${turns.cost} > 0`))
          .orderBy(desc(turns.cost))
          .limit(limit)
      ),

    // Messages per chat (Storage).
    messageCounts: () =>
      orDie(
        db
          .select({ chatId: messages.chatId, n: sql<number>`count(*)` })
          .from(messages)
          .groupBy(messages.chatId)
          .pipe(Effect.map((rows) => new Map(rows.map((r) => [r.chatId, Number(r.n)]))))
      ),

    // ---------- audit log ----------
    addAudit: (row: typeof auditEvents.$inferInsert) => orDie(db.insert(auditEvents).values(row)),
    // Newest first; within the same millisecond, the last inserted first. Narrowed by action prefixes (a kind of
    // change), words (in the target, the action or the changes) and a span of time; one page plus the total.
    auditLog: (f: { prefixes?: ReadonlyArray<string> | undefined; q?: string | undefined; from?: number | undefined; to?: number | undefined; limit: number; offset: number }) => {
      const like = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
      const where = and(
        f.prefixes?.length ? or(...f.prefixes.map((p) => sql`${auditEvents.action} like ${`${p}.%`}`)) : undefined,
        f.q
          ? or(sql`${auditEvents.targetName} like ${like(f.q)} escape '\\'`, sql`${auditEvents.action} like ${like(f.q)} escape '\\'`, sql`${auditEvents.changes} like ${like(f.q)} escape '\\'`)
          : undefined,
        f.from !== undefined ? sql`${auditEvents.at} >= ${f.from}` : undefined,
        f.to !== undefined ? sql`${auditEvents.at} < ${f.to}` : undefined
      )
      return orDie(
        Effect.all({
          rows: db.select().from(auditEvents).where(where).orderBy(desc(auditEvents.at), sql`rowid desc`).limit(f.limit).offset(f.offset),
          total: db.select({ n: sql<number>`count(*)` }).from(auditEvents).where(where).pipe(Effect.map((r) => Number(r[0]?.n ?? 0)))
        })
      )
    },

    // ---------- preferences ----------
    preference: (key: string) => orDie(db.select().from(preferences).where(eq(preferences.key, key)).pipe(Effect.map((r) => r[0]?.value))),
    setPreference: (key: string, value: string) =>
      orDie(db.insert(preferences).values({ key, value }).onConflictDoUpdate({ target: preferences.key, set: { value } }).pipe(Effect.asVoid)),

    // ---------- usage ----------
    // Finished turns since `since`, summed per UTC day, project, agent, model and account.
    usage: (since: number) => {
      const day = sql<number>`(${turns.createdAt} / 86400000) * 86400000`
      return orDie(
        db
          .select({
            day,
            projectId: chats.projectId,
            agentId: turns.agentId,
            model: turns.model,
            accountId: turns.accountId,
            turns: sql<number>`count(*)`,
            inputTokens: sql<number>`sum(${turns.inputTokens})`,
            outputTokens: sql<number>`sum(${turns.outputTokens})`,
            cachedTokens: sql<number>`sum(${turns.cachedTokens})`,
            durationMs: sql<number>`coalesce(sum(${turns.endedAt} - ${turns.startedAt}), 0)`,
            cost: sql<number | null>`sum(${turns.cost})`
          })
          .from(turns)
          .innerJoin(chats, eq(chats.id, turns.chatId))
          .where(and(gt(turns.createdAt, since), inArray(turns.state, ["completed", "failed", "interrupted"])))
          .groupBy(day, chats.projectId, turns.agentId, turns.model, turns.accountId)
          .orderBy(asc(day))
      )
    }
  }
}

export type Repository = ReturnType<typeof repository>

// Opens the database: adopt/backup (sync), enables foreign keys and applies pending migrations.
export const openDb = Effect.gen(function* () {
  const db = yield* makeDb
  yield* db.run(sql`PRAGMA foreign_keys = ON`)
  yield* migrate(db, { migrationsFolder: migrationsDir() })
  return db
})

export class Store extends Context.Service<Store, Repository>()("Store") {
  // pagesDir: where knowledge pages live as Markdown files (none: rows only, as in the tests).
  static layer = (path: string, pagesDir?: string) =>
    Layer.effect(Store, Effect.map(Effect.orDie(openDb), (db) => repository(db, pagesDir))).pipe(
      Layer.provide(Layer.orDie(Layer.suspend(() => {
        prepare(path) // MVP database: backup and adoption before SqliteClient opens the file
        return SqliteClient.layer({ filename: path })
      })))
    )
}
