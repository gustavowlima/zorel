// Database schema (Drizzle). Mirrors the tables the MVP created with hand-written SQL, column by column,
// so the existing database is adopted without copying (see migrate.ts). Changed something here? `bun run db:generate`.
import { sql } from "drizzle-orm"
import { check, index, integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core"

export const projects = sqliteTable("projects", {
  id: text().primaryKey(),
  name: text().notNull(),
  brief: text().notNull().default(""),
  createdAt: integer("created_at").notNull()
})

export const agents = sqliteTable("agents", {
  id: text().primaryKey(),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  name: text().notNull(),
  instructions: text().notNull().default(""),
  model: text().notNull(),
  createdAt: integer("created_at").notNull()
})

export const chats = sqliteTable("chats", {
  id: text().primaryKey(),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  title: text().notNull(),
  model: text().notNull(),
  summary: text().notNull().default(""),
  summaryUntil: integer("summary_until").notNull().default(0),
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
    cachedTokens: integer("cached_tokens").notNull().default(0)
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
