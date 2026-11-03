// Schema do banco (Drizzle). Espelha as tabelas que o MVP criou com SQL à mão, coluna por coluna,
// para o banco existente ser adotado sem cópia (ver migrate.ts). Mudou algo aqui? `bun run db:generate`.
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
    steps: text().notNull().default("[]"), // JSON de Step[]
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
    // Portas da D17 para hospedar: de quem é e quem ouve. Hoje sempre o dono local.
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
  args: text().notNull().default("[]"), // JSON de string[]
  url: text().notNull().default(""),
  envKeys: text("env_keys").notNull().default("[]"), // JSON de string[]; os valores ficam no chaveiro
  mode: text({ enum: ["read", "approve", "auto"] }).notNull(),
  enabled: integer({ mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull()
})

// ---------- runtime de turnos (ARCHITECTURE §5) ----------

export const turns = sqliteTable(
  "turns",
  {
    id: text().primaryKey(),
    chatId: text("chat_id").notNull().references(() => chats.id, { onDelete: "cascade" }),
    agentId: text("agent_id"),
    model: text().notNull(),
    accountId: text("account_id"),
    clientId: text("client_id").unique(), // idempotência do `send`; turnos encadeados não têm
    state: text({ enum: ["queued", "running", "completed", "failed", "interrupted"] }).notNull(),
    depth: integer().notNull().default(0), // respostas seguidas entre agentes sem mensagem sua
    createdAt: integer("created_at").notNull(),
    startedAt: integer("started_at"),
    endedAt: integer("ended_at"),
    firstTokenAt: integer("first_token_at"), // latência até o primeiro texto (medição por turno)
    error: text(), // código (ErrorCode) ou a mensagem do engine
    partialText: text("partial_text").notNull().default(""), // texto até agora: um kill -9 não perde o que já veio
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
    files: text().notNull().default("[]"), // JSON de string[]
    status: text({ enum: ["running", "waiting", "ok", "error", "refused"] }).notNull(),
    startedAt: integer("started_at").notNull(),
    durationMs: integer("duration_ms"),
    changes: text().notNull().default("[]"), // JSON de FileChange[]
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
    args: text().notNull(), // JSON com segredos mascarados
    cwd: text(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    outcome: text({ enum: ["approved", "always", "denied", "expired"] }), // null: aberta
    reason: text(),
    decidedBy: text("decided_by", { enum: ["user", "rule", "expiry"] }),
    decidedAt: integer("decided_at")
  },
  (t) => [index("approvals_open").on(t.outcome, t.chatId)]
)
