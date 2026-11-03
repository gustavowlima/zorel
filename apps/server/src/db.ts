// Local database: SQLite via Drizzle over Effect's SqliteClient (D9). Every method returns an Effect;
// a database error is a defect (orDie): the caller can do nothing but fail the request.
import { SqliteClient } from "@effect/sql-sqlite-bun"
import type { Access, Agent, AccountUsage, Attachment, Chat, Effort, FailoverTarget, FileChange, McpServer, Memory, Message, Project, Switch } from "@zero/contracts"
import type { Approval, ApprovalOutcome, Turn, WorkStep } from "@zero/contracts/events"
import { and, asc, desc, eq, gt, inArray, isNull, notInArray, or, sql } from "drizzle-orm"
import * as Drizzle from "drizzle-orm/effect-sqlite-bun"
import { migrate } from "drizzle-orm/effect-sqlite-bun/migrator"
import { Context, Effect, Layer } from "effect"
import { migrationsDir, prepare } from "./migrate.ts"
import { agents, approvals, attachments, chatMembers, chats, mcpServers, memories, messages, preferences, projects, providerAccounts, steps, turns } from "./schema.ts"

// "Prefere PRs pequenos." and "prefere prs pequenos" are the same memory.
export const normalize = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()

// Monotonic clock: two messages in the same ms still stay ordered (the summary cuts by `at`).
let last = 0
const now = () => (last = Math.max(Date.now(), last + 1))

type Row = Record<string, any>
const toMessage = (r: typeof messages.$inferSelect, files: ReadonlyArray<Attachment> = []): Message => ({ ...r, steps: JSON.parse(r.steps), attachments: files })
export type AttachmentRow = typeof attachments.$inferSelect
const toMcpServer = (r: typeof mcpServers.$inferSelect): McpServer => ({ ...r, args: JSON.parse(r.args), envKeys: JSON.parse(r.envKeys) })
const toMemory = (r: typeof memories.$inferSelect): Memory => {
  const { normalized: _, owner: _o, audience: _a, ...m } = r
  return m
}
// Raw row (hand-written SQL, snake_case columns) from the FTS search.
const memoryRow = (r: Row): Memory => ({
  id: r.id, scope: r.scope, kind: r.kind, title: r.title, text: r.text, state: r.state, origin: r.origin, chatId: r.chat_id,
  createdAt: r.created_at, confirmedAt: r.confirmed_at
})
const toTurn = (r: typeof turns.$inferSelect): Turn => ({
  id: r.id, chatId: r.chatId, agentId: r.agentId, model: r.model, accountId: r.accountId, clientId: r.clientId, state: r.state,
  startedAt: r.startedAt, endedAt: r.endedAt, firstTokenAt: r.firstTokenAt, error: r.error,
  usage: { inputTokens: r.inputTokens, outputTokens: r.outputTokens, cachedTokens: r.cachedTokens }
})
const toStep = (r: typeof steps.$inferSelect): WorkStep => ({ ...r, files: JSON.parse(r.files), changes: JSON.parse(r.changes) })
const toApproval = (r: typeof approvals.$inferSelect): Approval => ({
  id: r.id, chatId: r.chatId, turnId: r.turnId, stepId: r.stepId, agentId: r.agentId, kind: r.kind, tool: r.tool,
  summary: r.summary, args: r.args, cwd: r.cwd, createdAt: r.createdAt, expiresAt: r.expiresAt
})
export type TurnRow = typeof turns.$inferSelect
export type AccountRow = typeof providerAccounts.$inferSelect
const defined = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>

const makeDb = Drizzle.makeWithDefaults()
type Db = Effect.Success<typeof makeDb>

export const repository = (db: Db) => {
  const orDie = <A, E>(e: Effect.Effect<A, E>) => Effect.orDie(e)
  const first = <A>(rows: ReadonlyArray<A>) => rows[0]

  // Members in order: the first is the leader.
  const withMembers = (rows: ReadonlyArray<typeof chats.$inferSelect>) =>
    Effect.gen(function* () {
      if (!rows.length) return [] as Chat[]
      const ms = yield* db.select().from(chatMembers).where(inArray(chatMembers.chatId, rows.map((c) => c.id))).orderBy(asc(chatMembers.position))
      return rows.map((c): Chat => ({ ...c, agentIds: ms.filter((m) => m.chatId === c.id).map((m) => m.agentId) }))
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

  return {
    // ---------- projects ----------
    projects: (): Effect.Effect<Project[]> => orDie(db.select().from(projects).orderBy(desc(projects.createdAt))),
    project,
    createProject: (input: { name: string; brief: string; path?: string | null | undefined }) =>
      Effect.gen(function* () {
        const p: Project = { id: crypto.randomUUID(), ...input, path: input.path ?? null, createdAt: now() }
        yield* db.insert(projects).values(p)
        return p
      }).pipe(orDie),
    updateProject: (id: string, input: { name?: string | undefined; brief?: string | undefined; path?: string | null | undefined }) =>
      Effect.gen(function* () {
        const set = defined(input)
        if (Object.keys(set).length) yield* db.update(projects).set(set).where(eq(projects.id, id))
        return yield* project(id)
      }).pipe(orDie),
    removeProject: (id: string) =>
      orDie(
        db.transaction((tx) =>
          Effect.gen(function* () {
            const own = yield* tx.select({ id: agents.id }).from(agents).where(eq(agents.projectId, id))
            yield* tx.delete(memories).where(inArray(memories.scope, [`project:${id}`, ...own.map((a) => `agent:${a.id}`)]))
            yield* tx.delete(projects).where(eq(projects.id, id)) // agents, chats and MCP servers cascade
          })
        )
      ),

    // ---------- agents ----------
    agents: (): Effect.Effect<Agent[]> => orDie(db.select().from(agents).orderBy(asc(agents.createdAt))),
    agent,
    createAgent: (input: { projectId: string | null; name: string; instructions: string; model: string; accountId?: string | null | undefined; effort?: Effort | null | undefined; failover?: ReadonlyArray<FailoverTarget> | undefined; access?: Access | undefined }) =>
      Effect.gen(function* () {
        const a: Agent = { id: crypto.randomUUID(), ...input, accountId: input.accountId ?? null, effort: input.effort ?? null, failover: input.failover ?? [], access: input.access ?? "workspace", createdAt: now() }
        yield* db.insert(agents).values(a)
        return a
      }).pipe(orDie),
    updateAgent: (id: string, input: { name?: string | undefined; instructions?: string | undefined; model?: string | undefined; accountId?: string | null | undefined; effort?: Effort | null | undefined; failover?: ReadonlyArray<FailoverTarget> | undefined; access?: Access | undefined }) =>
      Effect.gen(function* () {
        const set = defined(input)
        if (Object.keys(set).length) yield* db.update(agents).set(set).where(eq(agents.id, id))
        return yield* agent(id)
      }).pipe(orDie),
    removeAgent: (id: string) =>
      orDie(
        db.transaction((tx) =>
          Effect.gen(function* () {
            yield* tx.delete(memories).where(eq(memories.scope, `agent:${id}`))
            yield* tx.delete(agents).where(eq(agents.id, id))
          })
        )
      ),

    // ---------- chats and messages ----------
    chats: () => orDie(db.select().from(chats).orderBy(desc(chats.createdAt)).pipe(Effect.flatMap(withMembers))),
    chat,
    createChat: (input: { projectId: string | null; agentIds: ReadonlyArray<string>; model: string; accountId?: string | null | undefined; effort?: Effort | null | undefined }) =>
      Effect.gen(function* () {
        const id = crypto.randomUUID()
        yield* db.transaction((tx) =>
          Effect.gen(function* () {
            yield* tx.insert(chats).values({ id, projectId: input.projectId, title: "Novo chat", model: input.model, accountId: input.accountId ?? null, effort: input.effort ?? null, createdAt: now() })
            yield* setMembers(tx, id, input.agentIds)
          })
        )
        return (yield* chat(id))!
      }).pipe(orDie),
    updateChat: (id: string, input: { title?: string | undefined; model?: string | undefined; accountId?: string | null | undefined; effort?: Effort | null | undefined; failover?: ReadonlyArray<FailoverTarget> | null | undefined; agentIds?: ReadonlyArray<string> | undefined }) =>
      Effect.gen(function* () {
        yield* db.transaction((tx) =>
          Effect.gen(function* () {
            const set = defined({ title: input.title, model: input.model, accountId: input.accountId, effort: input.effort, failover: input.failover })
            if (Object.keys(set).length) yield* tx.update(chats).set(set).where(eq(chats.id, id))
            if (input.agentIds) yield* setMembers(tx, id, input.agentIds)
          })
        )
        return yield* chat(id)
      }).pipe(orDie),
    setSummary: (id: string, summary: string, until: number) => orDie(db.update(chats).set({ summary, summaryUntil: until }).where(eq(chats.id, id)).pipe(Effect.asVoid)),
    removeChat: (id: string) => orDie(db.delete(chats).where(eq(chats.id, id)).pipe(Effect.asVoid)),
    messages: (chatId: string) => withFiles(db.select().from(messages).where(eq(messages.chatId, chatId)).orderBy(asc(messages.at))),
    messagesAfter: (chatId: string, at: number) =>
      withFiles(db.select().from(messages).where(and(eq(messages.chatId, chatId), gt(messages.at, at))).orderBy(asc(messages.at))),
    // attachmentIds: files uploaded to this chat beforehand; linked to the message here.
    addMessage: (
      input: Omit<Message, "id" | "at" | "attachments" | "switches" | "turnId" | "changes" | "revertedAt"> & {
        attachmentIds?: ReadonlyArray<string> | undefined
        switches?: ReadonlyArray<Switch> | undefined
        turnId?: string | null | undefined
        changes?: ReadonlyArray<FileChange> | undefined
      }
    ) =>
      Effect.gen(function* () {
        const { attachmentIds = [], switches = [], turnId = null, changes = [], ...rest } = input
        const base = { id: crypto.randomUUID(), ...rest, switches, turnId, changes, revertedAt: null, at: now() }
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
    forgottenMemories: (scopes: ReadonlyArray<string>, limit = 50) =>
      orDie(
        db
          .select()
          .from(memories)
          .where(and(eq(memories.state, "forgotten"), inArray(memories.scope, [...scopes])))
          .orderBy(desc(memories.confirmedAt))
          .limit(limit)
          .pipe(Effect.map((r) => r.map(toMemory)))
      ),
    pendingCount: (scopes: ReadonlyArray<string>) =>
      orDie(db.$count(memories, and(eq(memories.state, "pending"), inArray(memories.scope, [...scopes])))),
    memory,
    activeMemories: (scopes: ReadonlyArray<string>, kind: Memory["kind"] = "fact") =>
      orDie(
        db
          .select()
          .from(memories)
          .where(and(eq(memories.state, "active"), eq(memories.kind, kind), inArray(memories.scope, [...scopes])))
          .orderBy(desc(memories.confirmedAt))
          .pipe(Effect.map((r) => r.map(toMemory)))
      ),
    // Already exists (same normalized text in scope): returns undefined and doesn't duplicate or revive a forgotten one.
    // owner: the Actor who created it (or the chat owner, in consolidation). About the person (user scope): only the owner hears.
    addMemory: (input: { scope: string; kind?: Memory["kind"]; title?: string; text: string; state: Memory["state"]; origin: Memory["origin"]; chatId: string | null; owner?: string }) =>
      Effect.gen(function* () {
        const at = now()
        const { owner = "local", ...rest } = input
        const m: Memory = { id: crypto.randomUUID(), kind: "fact", title: "", ...rest, createdAt: at, confirmedAt: at }
        const audience = m.scope === "user" ? "owner" : "project"
        const inserted = yield* db.insert(memories).values({ ...m, owner, audience, normalized: normalize(m.text) }).onConflictDoNothing().returning({ id: memories.id })
        return inserted.length ? m : undefined
      }).pipe(orDie),
    updateMemory: (id: string, input: { state?: Memory["state"] | undefined; title?: string | undefined; text?: string | undefined }) =>
      Effect.gen(function* () {
        const set = defined({ ...input, normalized: input.text && normalize(input.text), confirmedAt: now() })
        yield* db.update(memories).set(set).where(eq(memories.id, id))
        return yield* memory(id)
      }).pipe(orDie),
    // BM25 (FTS5) among active ones in the scopes, excluding those already in the prompt. Skills also match by title.
    searchMemories: (scopes: ReadonlyArray<string>, query: string, exclude: ReadonlyArray<string>, limit: number, kind: Memory["kind"] = "fact") => {
      const terms = normalize(query).split(" ").filter((t) => t.length > 2).map((t) => `"${t}"*`)
      if (!terms.length) return Effect.succeed([] as Memory[])
      return orDie(
        db
          .all<Row>(
            sql`SELECT memories.* FROM memory_index JOIN memories ON memories.id = memory_index.id
                WHERE memory_index MATCH ${terms.join(" OR ")} AND ${eq(memories.state, "active")} AND ${eq(memories.kind, kind)}
                  AND ${inArray(memories.scope, [...scopes])} AND ${notInArray(memories.id, [...exclude])}
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
    updateMcpServer: (id: string, input: { mode?: McpServer["mode"] | undefined; enabled?: boolean | undefined }) =>
      Effect.gen(function* () {
        const set = defined(input)
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
    enqueueTurn: (input: { chatId: string; agentId: string | null; model: string; accountId?: string | null; clientId: string | null; depth: number }) =>
      orDie(db.insert(turns).values({ id: crypto.randomUUID(), ...input, state: "queued", createdAt: now() }).returning().pipe(Effect.map((r) => r[0]!))),
    nextQueued: (chatId: string) =>
      orDie(db.select().from(turns).where(and(eq(turns.chatId, chatId), eq(turns.state, "queued"))).orderBy(asc(turns.createdAt)).limit(1).pipe(Effect.map(first))),
    turnsIn: (state: TurnRow["state"]) => orDie(db.select().from(turns).where(eq(turns.state, state)).orderBy(asc(turns.createdAt))),
    activeTurns: (chatId: string) =>
      orDie(db.select().from(turns).where(and(eq(turns.chatId, chatId), inArray(turns.state, ["queued", "running"]))).orderBy(asc(turns.createdAt)).pipe(Effect.map((r) => r.map(toTurn)))),
    startTurn: (id: string) =>
      orDie(db.update(turns).set({ state: "running", startedAt: now() }).where(eq(turns.id, id)).returning().pipe(Effect.map((r) => r[0]!))),
    markFirstToken: (id: string) => orDie(db.update(turns).set({ firstTokenAt: now() }).where(and(eq(turns.id, id), isNull(turns.firstTokenAt))).pipe(Effect.asVoid)),
    savePartial: (id: string, partialText: string) => orDie(db.update(turns).set({ partialText }).where(eq(turns.id, id)).pipe(Effect.asVoid)),
    finishTurn: (id: string, end: { state: "completed" | "failed" | "interrupted"; error: string | null; messageId: string | null; usage?: { inputTokens: number; outputTokens: number; cachedTokens?: number }; route?: { model: string; accountId: string | null; switches: ReadonlyArray<Switch> }; trees?: { treeBefore: string; treeAfter: string } }) =>
      orDie(
        db
          .update(turns)
          .set({ state: end.state, error: end.error, messageId: end.messageId, endedAt: now(), ...(end.route && end.route), ...(end.trees && end.trees), ...(end.usage && { inputTokens: end.usage.inputTokens, outputTokens: end.usage.outputTokens, cachedTokens: end.usage.cachedTokens ?? 0 }) })
          .where(eq(turns.id, id))
          .returning()
          .pipe(Effect.map((r) => toTurn(r[0]!)))
      ),
    toTurn: (r: TurnRow) => toTurn(r),

    // ---------- steps ----------
    addStep: (input: Omit<WorkStep, "id" | "startedAt" | "durationMs" | "changes" | "output"> & { changes?: ReadonlyArray<FileChange> }) =>
      Effect.gen(function* () {
        const step: WorkStep = { id: crypto.randomUUID(), startedAt: now(), durationMs: null, output: "", ...input, changes: input.changes ?? [] }
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
            durationMs: sql<number>`coalesce(sum(${turns.endedAt} - ${turns.startedAt}), 0)`
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
  static layer = (path: string) =>
    Layer.effect(Store, Effect.map(Effect.orDie(openDb), repository)).pipe(
      Layer.provide(Layer.orDie(Layer.suspend(() => {
        prepare(path) // MVP database: backup and adoption before SqliteClient opens the file
        return SqliteClient.layer({ filename: path })
      })))
    )
}
