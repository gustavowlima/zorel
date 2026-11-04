// Database schema (Drizzle). Mirrors the tables the MVP created with hand-written SQL, column by column,
// so the existing database is adopted without copying (see migrate.ts). Changed something here? `bun run db:generate`.
import type { AccountUsage, FailoverTarget, FileChange, Switch } from "@zero/contracts"
import { sql } from "drizzle-orm"
import { check, index, integer, primaryKey, real, sqliteTable, text, unique } from "drizzle-orm/sqlite-core"

// Provider accounts (ARCHITECTURE §6.1). Subscription logins live in `home` (a CLI config folder);
// Zero never reads the token inside it. `identity` is what the CLI reports (e-mail, plan), for display.
export const providerAccounts = sqliteTable("provider_accounts", {
  id: text().primaryKey(),
  label: text().notNull(),
  kind: text({ enum: ["subscription", "api-key"] }).notNull(),
  provider: text().notNull(), // subscription: claude | codex; api-key: anthropic | openai | openrouter…
  home: text(), // null: the CLI's own default login (Claude only; Codex always gets a Zero-owned folder)
  secret: text(), // api-key: keychain entry name; the value never touches the database
  baseUrl: text("base_url"),
  identity: text(),
  // Failover (ARCHITECTURE §6.1): a subscription that hit its limit waits until this time (epoch ms).
  limitedUntil: integer("limited_until"),
  usage: text({ mode: "json" }).$type<AccountUsage>(), // the last limit reading
  createdAt: integer("created_at").notNull()
})

export const projects = sqliteTable("projects", {
  id: text().primaryKey(),
  name: text().notNull(),
  brief: text().notNull().default(""),
  path: text(), // workspace folder on disk (ARCHITECTURE §9.1); null: agents work in an empty Zero folder
  position: integer(), // manual order in the sidebar; null: not placed yet (newest first, above the placed ones)
  createdAt: integer("created_at").notNull()
})

export const agents = sqliteTable("agents", {
  id: text().primaryKey(),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  name: text().notNull(),
  title: text().notNull().default(""), // the role in a few words ("Team lead"), shown by the name
  description: text().notNull().default(""), // what it does, one sentence: other agents read it to hand work over
  instructions: text().notNull().default(""),
  model: text().notNull(),
  accountId: text("account_id"), // null: the default account of the model's provider
  effort: text({ enum: ["low", "medium", "high", "max"] }), // null: the model's default
  failover: text({ mode: "json" }).$type<ReadonlyArray<FailoverTarget>>().notNull().default([]), // alternatives in order (§6.1)
  access: text({ enum: ["workspace", "ask", "full"] }).notNull().default("workspace"), // §9.2, chosen only by you
  createdAt: integer("created_at").notNull()
})

// Every saved state of an agent's profile (phase 4: versions and restore). n counts up per agent; `by` is who
// made the change ("you", or the proposing agent's name). Restoring writes the old profile as a new version.
export const agentVersions = sqliteTable("agent_versions", {
  id: text().primaryKey(),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  n: integer().notNull(),
  profile: text({ mode: "json" }).$type<AgentProfile>().notNull(),
  by: text().notNull(),
  at: integer().notNull()
})
export type AgentProfile = {
  name: string
  title: string
  description: string
  instructions: string
  model: string
  accountId: string | null
  effort: "low" | "medium" | "high" | "max" | null
  failover: ReadonlyArray<FailoverTarget>
  access: "workspace" | "ask" | "full"
}

export const chats = sqliteTable("chats", {
  id: text().primaryKey(),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  title: text().notNull(),
  model: text().notNull(),
  accountId: text("account_id"), // the lead's account; null: the default one
  effort: text({ enum: ["low", "medium", "high", "max"] }), // the lead's; null: the model's default
  summary: text().notNull().default(""),
  summaryUntil: integer("summary_until").notNull().default(0),
  failover: text({ mode: "json" }).$type<ReadonlyArray<FailoverTarget>>(), // null: the lead agent's list
  position: integer(), // manual order inside its group (project or General); null: by recent activity, above the placed ones
  worktree: text(), // a git worktree of the project the chat works in (its own branch); null: the project folder
  resumeAt: integer("resume_at"), // every route hit its usage limit: the chat continues by itself at this time (null: no)
  createdAt: integer("created_at").notNull()
})

export const chatMembers = sqliteTable(
  "chat_members",
  {
    chatId: text("chat_id").notNull().references(() => chats.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    position: integer().notNull()
  },
  (t) => [primaryKey({ columns: [t.chatId, t.agentId] })]
)

export const messages = sqliteTable(
  "messages",
  {
    id: text().primaryKey(),
    chatId: text("chat_id").notNull().references(() => chats.id, { onDelete: "cascade" }),
    role: text({ enum: ["user", "assistant"] }).notNull(),
    agentId: text("agent_id"),
    text: text().notNull(),
    model: text(),
    error: text(),
    steps: text().notNull().default("[]"), // JSON of Step[]
    switches: text({ mode: "json" }).$type<ReadonlyArray<Switch>>().notNull().default([]), // failover moves before this reply
    turnId: text("turn_id"), // the turn that wrote this reply (its workspace changes and checkpoint)
    changes: text({ mode: "json" }).$type<ReadonlyArray<FileChange>>().notNull().default([]), // files the turn changed
    revertedAt: integer("reverted_at"), // the turn's changes were undone
    accountId: text("account_id"), // the account that answered
    cost: real(), // estimated USD (subscriptions: the API equivalent)
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    at: integer().notNull()
  },
  (t) => [index("messages_by_chat").on(t.chatId, t.at), check("messages_role", sql`${t.role} IN ('user', 'assistant')`)]
)

export const memories = sqliteTable(
  "memories",
  {
    id: text().primaryKey(),
    scope: text().notNull(),
    kind: text({ enum: ["fact", "skill"] }).notNull().default("fact"),
    title: text().notNull().default(""),
    text: text().notNull(),
    normalized: text().notNull(),
    state: text({ enum: ["pending", "active", "forgotten"] }).notNull(),
    origin: text({ enum: ["auto", "manual"] }).notNull(),
    chatId: text("chat_id"),
    createdAt: integer("created_at").notNull(),
    confirmedAt: integer("confirmed_at").notNull(),
    // D17 seams for hosting: who owns it and who hears it. Today always the local owner.
    owner: text().notNull().default("local"),
    audience: text({ enum: ["owner", "project", "workspace"] }).notNull().default("project")
  },
  (t) => [unique("memories_scope_normalized").on(t.scope, t.normalized)]
)

export const mcpServers = sqliteTable("mcp_servers", {
  id: text().primaryKey(),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  name: text().notNull(),
  command: text().notNull().default(""),
  args: text().notNull().default("[]"), // JSON of string[]
  url: text().notNull().default(""),
  envKeys: text("env_keys").notNull().default("[]"), // JSON of string[]; the values live in the keychain
  mode: text({ enum: ["read", "approve", "auto"] }).notNull(),
  enabled: integer({ mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull()
})

// ---------- turn runtime (ARCHITECTURE §5) ----------

export const turns = sqliteTable(
  "turns",
  {
    id: text().primaryKey(),
    chatId: text("chat_id").notNull().references(() => chats.id, { onDelete: "cascade" }),
    agentId: text("agent_id"),
    model: text().notNull(),
    accountId: text("account_id"),
    clientId: text("client_id").unique(), // `send` idempotency; chained turns have none
    state: text({ enum: ["queued", "running", "completed", "failed", "interrupted"] }).notNull(),
    depth: integer().notNull().default(0), // consecutive agent replies without a message from you
    createdAt: integer("created_at").notNull(),
    startedAt: integer("started_at"),
    endedAt: integer("ended_at"),
    firstTokenAt: integer("first_token_at"), // latency to first text (per-turn metrics)
    error: text(), // code (ErrorCode) or the engine message
    partialText: text("partial_text").notNull().default(""), // text so far: a kill -9 doesn't lose what already arrived
    messageId: text("message_id"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cachedTokens: integer("cached_tokens").notNull().default(0),
    switches: text({ mode: "json" }).$type<ReadonlyArray<Switch>>().notNull().default([]), // failover moves in this turn (per-turn metrics)
    // Workspace checkpoints (git trees in Zero's shadow repo of the project): before and after the turn.
    cost: real(), // estimated USD at the time (ARCHITECTURE §10.2)
    treeBefore: text("tree_before"),
    treeAfter: text("tree_after")
  },
  (t) => [index("turns_by_chat").on(t.chatId, t.state, t.createdAt)]
)

export const steps = sqliteTable(
  "steps",
  {
    id: text().primaryKey(),
    turnId: text("turn_id").notNull().references(() => turns.id, { onDelete: "cascade" }),
    kind: text({ enum: ["read", "edit", "run", "search", "tool", "delegate"] }).notNull(),
    title: text().notNull(),
    tool: text(),
    files: text().notNull().default("[]"), // JSON of string[]
    status: text({ enum: ["running", "waiting", "ok", "error", "refused"] }).notNull(),
    startedAt: integer("started_at").notNull(),
    durationMs: integer("duration_ms"),
    changes: text().notNull().default("[]"), // JSON of FileChange[]
    output: text().notNull().default("")
  },
  (t) => [index("steps_by_turn").on(t.turnId, t.startedAt)]
)

export const approvals = sqliteTable(
  "approvals",
  {
    id: text().primaryKey(),
    chatId: text("chat_id").notNull().references(() => chats.id, { onDelete: "cascade" }),
    turnId: text("turn_id").notNull().references(() => turns.id, { onDelete: "cascade" }),
    stepId: text("step_id"),
    agentId: text("agent_id"),
    kind: text({ enum: ["command", "edit", "tool", "network"] }).notNull(),
    tool: text().notNull(),
    summary: text().notNull(),
    args: text().notNull(), // JSON with masked secrets
    cwd: text(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    outcome: text({ enum: ["approved", "always", "denied", "expired"] }), // null: open
    reason: text(),
    decidedBy: text("decided_by", { enum: ["user", "rule", "expiry"] }),
    decidedAt: integer("decided_at")
  },
  (t) => [index("approvals_open").on(t.outcome, t.chatId)]
)

// Files sent with messages (ARCHITECTURE §12). Uploaded first (message_id null), linked when sent.
export const attachments = sqliteTable(
  "attachments",
  {
    id: text().primaryKey(),
    chatId: text("chat_id").notNull().references(() => chats.id, { onDelete: "cascade" }),
    messageId: text("message_id"),
    name: text().notNull(),
    mime: text().notNull(),
    size: integer().notNull(),
    path: text().notNull(), // under <dataDir>/attachments/<chat>
    createdAt: integer("created_at").notNull()
  },
  (t) => [index("attachments_by_message").on(t.messageId)]
)

// Small server-side choices the person made once (e.g. accepting the failover terms warning).
export const preferences = sqliteTable("preferences", {
  key: text().primaryKey(),
  value: text().notNull()
})

// Audit log (Settings › Audit log): who changed what, written through evlog's audit helpers (audit.ts).
// Append-only from the app: rows are inserted and read, never updated.
export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text().primaryKey(),
    at: integer().notNull(),
    action: text().notNull(), // "agent.updated"
    actorType: text("actor_type", { enum: ["user", "system", "api", "agent"] }).notNull(),
    actorId: text("actor_id").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    targetName: text("target_name").notNull(),
    outcome: text({ enum: ["success", "failure", "denied"] }).notNull(),
    reason: text(),
    changes: text({ mode: "json" }).$type<ReadonlyArray<{ field: string; before: string | null; after: string | null }>>().notNull().default([])
  },
  (t) => [index("audit_events_at").on(t.at)]
)


// Routines (phase 7): an agent's recurring or triggered work. Each has its own chat; a run is a message in it.
// cron: when it runs by itself (null: only "Run now" or the webhook). token: the secret of its local webhook
// (POST /api/hooks/:token), null when it has none. next_run_at is the next due time (null: not scheduled).
export const routines = sqliteTable("routines", {
  id: text().primaryKey(),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  chatId: text("chat_id").notNull().references(() => chats.id, { onDelete: "cascade" }),
  name: text().notNull(),
  prompt: text().notNull(),
  cron: text(),
  token: text().unique(),
  enabled: integer({ mode: "boolean" }).notNull().default(true),
  nextRunAt: integer("next_run_at"),
  lastRunAt: integer("last_run_at"),
  lastStatus: text("last_status", { enum: ["started", "skipped", "failed"] }),
  createdAt: integer("created_at").notNull()
})
