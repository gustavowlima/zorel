// Single contract between server and clients: everything crossing the network is typed here.
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup } from "effect/http-api"

const Id = Schema.String
const Name = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(80))
const LongText = (max: number) => Schema.String.check(Schema.isMaxLength(max))
const Short = (max: number) => Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(max))
// "<provider>/<model>", e.g.: "claude-cli/sonnet", "anthropic/claude-sonnet-5-5", "ollama/llama3.3"
export const ModelId = Schema.String.check(Schema.isPattern(/^[a-z-]+\/\S+$/), Schema.isMaxLength(200))

// ---------- entities ----------

// Provider account (ARCHITECTURE §6.1). The CLI login stays in its own folder; Zero only shows identity.
export const AccountProvider = Schema.Literals(["claude", "codex"])
export type AccountProvider = typeof AccountProvider.Type
// Limit windows of a subscription (ARCHITECTURE §10.2), as the harness reports them: Claude's 5-hour and
// weekly windows (rate_limit_event, /usage), Codex's primary and secondary (account/rateLimits).
// id: "five_hour", "seven_day", "seven_day_opus"… or "<minutes>m" for a window known only by its length.
export const AccountWindow = Schema.Struct({ id: Schema.String, usedPercent: Schema.Number, resetsAt: Schema.NullOr(Schema.Number) })
export type AccountWindow = typeof AccountWindow.Type
export const AccountUsage = Schema.Struct({ windows: Schema.Array(AccountWindow), readAt: Schema.Number })
export type AccountUsage = typeof AccountUsage.Type
export const LIMIT_ALERT = 0.8 // a window at 80% or more is flagged before it runs out

export const ProviderAccount = Schema.Struct({
  id: Id,
  label: Schema.String,
  kind: Schema.Literals(["subscription", "api-key"]),
  provider: Schema.String,
  isDefault: Schema.Boolean, // the account used when an agent or chat doesn't pick one
  loggedIn: Schema.Boolean,
  identity: Schema.NullOr(Schema.String), // e-mail or plan reported by the CLI
  loggingIn: Schema.Boolean, // a login flow is open in the browser
  limitedUntil: Schema.NullOr(Schema.Number), // hit its limit: failover skips it until then (epoch ms)
  usage: Schema.NullOr(AccountUsage),
  createdAt: Schema.Number
})
export type ProviderAccount = typeof ProviderAccount.Type
export const NewAccount = Schema.Struct({ provider: AccountProvider, label: Name })
export const AccountPatch = Schema.Struct({ label: Name })
export const LoginStarted = Schema.Struct({ url: Schema.NullOr(Schema.String) }) // url: when the CLI printed one

// Reasoning effort (ARCHITECTURE §6). null = the model's default. "max" maps to each engine's top level.
export const Effort = Schema.Literals(["low", "medium", "high", "max"])
export type Effort = typeof Effort.Type

export const FileChange = Schema.Struct({
  path: Schema.String, // relative to the project folder
  added: Schema.Number,
  removed: Schema.Number,
  status: Schema.Literals(["added", "modified", "deleted"])
})
export type FileChange = typeof FileChange.Type

// Access level of an agent (ARCHITECTURE §9.2), chosen only by you. workspace: reads, edits and runs commands
// inside the project folder, asks for the rest; ask: only reads freely; full: never asks.
export const Access = Schema.Literals(["workspace", "ask", "full"])
export type Access = typeof Access.Type

// Failover (ARCHITECTURE §6.1): ordered alternatives { model, account } tried when the turn fails before
// acting. Empty list: failover off.
export const FailoverTarget = Schema.Struct({ model: ModelId, accountId: Schema.NullOr(Id) })
export type FailoverTarget = typeof FailoverTarget.Type
export const MAX_FAILOVER = 8
export const FailoverList = Schema.Array(FailoverTarget).check(Schema.isMaxLength(MAX_FAILOVER))

// Why a turn moved to another model/account. "limit": the subscription's window ran out (comes back at `until`).
export const FailureReason = Schema.Literals(["limit", "rate_limit", "billing", "unavailable", "auth", "network", "timeout"])
export type FailureReason = typeof FailureReason.Type
export const Switch = Schema.Struct({
  fromModel: Schema.String,
  fromAccountId: Schema.NullOr(Id),
  toModel: Schema.String,
  toAccountId: Schema.NullOr(Id),
  reason: FailureReason,
  until: Schema.NullOr(Schema.Number) // limit: when the account comes back
})
export type Switch = typeof Switch.Type

export const Project = Schema.Struct({
  id: Id,
  name: Schema.String,
  brief: Schema.String, // stable project context, included in every turn's prompt
  path: Schema.NullOr(Schema.String), // workspace folder; null: agents work in an empty Zero folder
  createdAt: Schema.Number
})
export type Project = typeof Project.Type

export const Agent = Schema.Struct({
  id: Id,
  projectId: Schema.NullOr(Id), // null: global agent
  name: Schema.String,
  title: Schema.String, // the role in a few words ("Team lead")
  description: Schema.String, // what it does, one sentence (other agents read it)
  instructions: Schema.String,
  model: Schema.String,
  accountId: Schema.NullOr(Id), // null: default account of the model's provider
  effort: Schema.NullOr(Effort),
  failover: FailoverList,
  access: Access,
  createdAt: Schema.Number
})
export type Agent = typeof Agent.Type

export const Chat = Schema.Struct({
  id: Id,
  projectId: Schema.NullOr(Id), // null: standalone chat
  agentIds: Schema.Array(Id), // members; the first is the leader (replies when no one is mentioned)
  title: Schema.String,
  accountId: Schema.NullOr(Id), // the lead's account; null: default
  effort: Schema.NullOr(Effort), // the lead's reasoning effort; null: the model's default
  model: Schema.String, // leader's model for the next turn; other members use their own model
  summary: Schema.String, // summary of what left the window (consolidation)
  summaryUntil: Schema.Number, // `at` of the last message covered by the summary
  failover: Schema.NullOr(FailoverList), // null: the lead agent's list
  position: Schema.NullOr(Schema.Number), // manual order inside its group; null: by recent activity, above the placed ones
  preview: Schema.NullOr(Schema.String), // start of the last message, one line (sidebar)
  lastAt: Schema.NullOr(Schema.Number), // when the last message was written
  createdAt: Schema.Number
})
export type Chat = typeof Chat.Type
export const PREVIEW_CHARS = 140

// Audit log: one change, who made it and the fields it touched (before → after, secrets redacted).
export const AuditEntry = Schema.Struct({
  id: Schema.String,
  at: Schema.Number,
  action: Schema.String, // "<resource>.<verb>" in the past tense: "agent.updated", "approval.denied"
  actor: Schema.Struct({ type: Schema.Literals(["user", "system", "api", "agent"]), id: Schema.String }),
  target: Schema.Struct({ type: Schema.String, id: Schema.String, name: Schema.String }),
  outcome: Schema.Literals(["success", "failure", "denied"]),
  reason: Schema.NullOr(Schema.String),
  changes: Schema.Array(Schema.Struct({ field: Schema.String, before: Schema.NullOr(Schema.String), after: Schema.NullOr(Schema.String) }))
})
export type AuditEntry = typeof AuditEntry.Type
export const AUDIT_PAGE = 50 // entries per page of the log
// What the log can be narrowed to: a kind of change, words in it, a span of time (ms, inclusive start,
// exclusive end) and a page, newest first.
export const AuditKind = Schema.Literals(["all", "providers", "projects", "tools", "approvals"])
export type AuditKind = typeof AuditKind.Type
export const AuditQuery = {
  kind: Schema.optionalKey(AuditKind),
  q: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(200))),
  from: Schema.optionalKey(Schema.NumberFromString),
  to: Schema.optionalKey(Schema.NumberFromString),
  page: Schema.optionalKey(Schema.NumberFromString)
}
export const AuditPage = Schema.Struct({ entries: Schema.Array(AuditEntry), total: Schema.Number, page: Schema.Number, pageSize: Schema.Number })
export type AuditPage = typeof AuditPage.Type

// Storage: Zero's data folder measured now, where it goes and what can be freed.
export const StorageCategory = Schema.Literals(["workspaces", "attachments", "history", "backups", "runs", "accounts", "other"])
export const StorageCleanup = Schema.Literals(["backups", "orphans"])
export const StorageReport = Schema.Struct({
  measuredAt: Schema.Number,
  total: Schema.Number, // bytes
  free: Schema.NullOr(Schema.Number), // free bytes on that disk; null when the file system doesn't say
  categories: Schema.Array(Schema.Struct({ id: StorageCategory, bytes: Schema.Number })),
  projects: Schema.Array(Schema.Struct({ id: Id, name: Schema.String, bytes: Schema.Number, chats: Schema.Number })),
  chats: Schema.Array(Schema.Struct({ id: Id, title: Schema.String, projectId: Schema.NullOr(Id), bytes: Schema.Number, files: Schema.Number, messages: Schema.Number })),
  cleanup: Schema.Array(Schema.Struct({ id: StorageCleanup, bytes: Schema.Number }))
})
export type StorageReport = typeof StorageReport.Type

// How full the next turn's context is: what Zero puts in it, by part, estimated at ~4 characters a token
// (the engine adds its own tool definitions on top). `windowTokens` null: the model's window isn't known.
// Zero compacts on its own once more than `compactAfter` messages follow the summary.
export const ContextPart = Schema.Literals(["instructions", "memories", "skills", "summary", "messages"])
export const ContextUsage = Schema.Struct({
  model: Schema.String,
  windowTokens: Schema.NullOr(Schema.Number),
  usedTokens: Schema.Number,
  parts: Schema.Array(Schema.Struct({ id: ContextPart, tokens: Schema.Number })),
  messagesSinceSummary: Schema.Number,
  compactAfter: Schema.Number,
  // What the last reply actually read (input tokens as the engine reported them, its own prompt and tools
  // included): the measured counterpart of the estimate. Null before any reply.
  lastInputTokens: Schema.NullOr(Schema.Number)
})
export type ContextUsage = typeof ContextUsage.Type

// A slash command the chat's engine offers (Claude Code's built-in and custom commands). A message that opens
// with "/name" runs it in the CLI.
export const EngineCommand = Schema.Struct({ name: Schema.String, description: Schema.String, argumentHint: Schema.NullOr(Schema.String) })
export type EngineCommand = typeof EngineCommand.Type

// A shell of the chat's Terminal panel (it outlives the panel; see apps/server/src/terminals.ts). busy: something
// runs in it, so closing it asks first.
export const TerminalSession = Schema.Struct({ id: Schema.String, n: Schema.Number, ended: Schema.Boolean, busy: Schema.Boolean })
export type TerminalSession = typeof TerminalSession.Type
// A file to open in the computer's default app, from a path printed in the terminal (relative to the chat's folder).
export const OpenFile = Schema.Struct({ path: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1000)) })

// Manual order in the sidebar: the ids in their new order. Chats only reorder inside their own group.
export const ProjectOrder = Schema.Struct({ ids: Schema.Array(Id) })
export const ChatOrder = Schema.Struct({ projectId: Schema.NullOr(Id), ids: Schema.Array(Id) })

export const Step = Schema.Struct({
  tool: Schema.String,
  args: Schema.String, // abbreviated JSON
  status: Schema.Literals(["ok", "error", "refused"]),
  result: Schema.String // start of the result
})
export type Step = typeof Step.Type

// A file sent with a message (ARCHITECTURE §12). Images go to the engine as images; other files as text
// (small text files) or by name until the workspace phase gives agents file tools.
export const Attachment = Schema.Struct({ id: Id, name: Schema.String, mime: Schema.String, size: Schema.Number })
export type Attachment = typeof Attachment.Type
export const MAX_ATTACHMENTS = 10
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

export const Message = Schema.Struct({
  id: Id,
  chatId: Id,
  role: Schema.Literals(["user", "assistant"]),
  agentId: Schema.NullOr(Id), // which agent replied (assistant)
  text: Schema.String,
  model: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
  steps: Schema.Array(Step), // tools used in the turn
  attachments: Schema.Array(Attachment),
  switches: Schema.Array(Switch), // failover moves before this reply (empty when the first choice answered)
  turnId: Schema.NullOr(Id), // the turn that wrote it: its workspace diff and checkpoint
  changes: Schema.Array(FileChange), // files the turn changed in the workspace
  revertedAt: Schema.NullOr(Schema.Number), // the turn's changes were undone
  accountId: Schema.NullOr(Id), // the account that answered (multi-account, failover)
  cost: Schema.NullOr(Schema.Number), // estimated USD; for subscriptions, the API equivalent
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  at: Schema.Number
})
export type Message = typeof Message.Type

// Scopes: "user" (applies everywhere), "project:<id>", "agent:<id>".
// kind "fact": a durable sentence. kind "skill": a reusable procedure (title + step-by-step).
export const MemoryScope = Schema.String.check(Schema.isPattern(/^(user|project:[\w-]+|agent:[\w-]+)$/))
export const MemoryState = Schema.Literals(["pending", "active", "forgotten"])
export const MemoryKind = Schema.Literals(["fact", "skill"])
export const Memory = Schema.Struct({
  id: Id,
  scope: Schema.String,
  kind: MemoryKind,
  title: Schema.String, // skills only
  text: Schema.String,
  state: MemoryState,
  origin: Schema.Literals(["auto", "manual"]),
  chatId: Schema.NullOr(Id),
  createdAt: Schema.Number,
  confirmedAt: Schema.Number
})
export type Memory = typeof Memory.Type

// How a message names a skill: "$" + its title in lower case, accents dropped, words joined by "-"
// ("Deploy na Vercel" -> $deploy-na-vercel). The turn then carries that skill's full steps.
export const skillHandle = (title: string) =>
  title
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")

// The skills a message names with $handle.
export const namedSkills = <S extends { readonly title: string }>(text: string, skills: ReadonlyArray<S>) => {
  const handles = new Set([...text.matchAll(/(?:^|\s)\$([\p{L}\p{N}][\p{L}\p{N}-]*)/gu)].map((m) => m[1]))
  return skills.filter((s) => handles.has(skillHandle(s.title)))
}

export const ModelInfo = Schema.Struct({
  id: Schema.String,
  provider: Schema.String,
  kind: Schema.Literals(["subscription", "api"]),
  available: Schema.Boolean,
  hint: Schema.String,
  // Subscription CLIs: the name and line they give the model today ("Opus 5.5").
  name: Schema.optional(Schema.String),
  note: Schema.optional(Schema.String)
})
export type ModelInfo = typeof ModelInfo.Type

// Tools: MCP servers. mode "read": read tools only; "approve": all, and the ones that
// write wait for approval; "auto": all without asking (explicit trust).
export const ToolMode = Schema.Literals(["read", "approve", "auto"])
export const McpServer = Schema.Struct({
  id: Id,
  projectId: Schema.NullOr(Id), // null: available in all chats
  name: Schema.String,
  command: Schema.String, // stdio: command; empty when http
  args: Schema.Array(Schema.String),
  url: Schema.String, // http: address; empty when stdio
  envKeys: Schema.Array(Schema.String), // variable names; the values live in the system keychain
  mode: ToolMode,
  enabled: Schema.Boolean,
  createdAt: Schema.Number
})
export type McpServer = typeof McpServer.Type

export const ToolInfo = Schema.Struct({ name: Schema.String, description: Schema.String, cls: Schema.Literals(["read", "write", "sensitive"]) })
export type ToolInfo = typeof ToolInfo.Type

export const KeyInfo = Schema.Struct({ name: Schema.String, set: Schema.Boolean, fromEnv: Schema.Boolean })

// Usage (ARCHITECTURE §10.2): finished turns summed per UTC day, project, agent, model and account.
// The client groups by whichever dimension it shows. Limit windows and cost come in phase 2c.
export const UsageRow = Schema.Struct({
  day: Schema.Number, // start of the UTC day, epoch ms
  projectId: Schema.NullOr(Id),
  agentId: Schema.NullOr(Id),
  model: Schema.String,
  accountId: Schema.NullOr(Id),
  turns: Schema.Number,
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  cachedTokens: Schema.Number,
  durationMs: Schema.Number,
  cost: Schema.NullOr(Schema.Number), // estimated USD (null: no price known for the model)
  billing: Schema.Literals(["api", "subscription", "local"]) // subscription costs are the API equivalent
})
export type UsageRow = typeof UsageRow.Type
export const USAGE_DAYS = 62 // covers this month and the last 30 days

// The most expensive turns of the range, with where they happened.
export const TopTurn = Schema.Struct({
  turnId: Id,
  chatId: Id,
  chatTitle: Schema.String,
  agentId: Schema.NullOr(Id),
  model: Schema.String,
  accountId: Schema.NullOr(Id),
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  cost: Schema.Number,
  billing: Schema.Literals(["api", "subscription", "local"]),
  at: Schema.Number
})
export type TopTurn = typeof TopTurn.Type

// ---------- inputs ----------

const FolderPath = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(1000))
export const NewProject = Schema.Struct({ name: Name, brief: LongText(8000), path: Schema.optional(Schema.NullOr(FolderPath)) })
export const ProjectPatch = Schema.Struct({ name: Schema.optional(Name), brief: Schema.optional(LongText(8000)), path: Schema.optional(Schema.NullOr(FolderPath)) })
const AgentTitle = Schema.String.check(Schema.isTrimmed(), Schema.isMaxLength(60))
const AgentDescription = LongText(300)
export const NewAgent = Schema.Struct({ projectId: Schema.NullOr(Id), name: Name, title: Schema.optional(AgentTitle), description: Schema.optional(AgentDescription), instructions: LongText(8000), model: ModelId, accountId: Schema.optional(Schema.NullOr(Id)), effort: Schema.optional(Schema.NullOr(Effort)), failover: Schema.optional(FailoverList), access: Schema.optional(Access) })
export const AgentPatch = Schema.Struct({ name: Schema.optional(Name), title: Schema.optional(AgentTitle), description: Schema.optional(AgentDescription), instructions: Schema.optional(LongText(8000)), model: Schema.optional(ModelId), accountId: Schema.optional(Schema.NullOr(Id)), effort: Schema.optional(Schema.NullOr(Effort)), failover: Schema.optional(FailoverList), access: Schema.optional(Access) })
export const NewChat = Schema.Struct({ projectId: Schema.NullOr(Id), agentIds: Schema.Array(Id).check(Schema.isMaxLength(8)), model: ModelId, accountId: Schema.optional(Schema.NullOr(Id)), effort: Schema.optional(Schema.NullOr(Effort)) })
export const ChatPatch = Schema.Struct({ title: Schema.optional(Name), model: Schema.optional(ModelId), accountId: Schema.optional(Schema.NullOr(Id)), effort: Schema.optional(Schema.NullOr(Effort)), failover: Schema.optional(Schema.NullOr(FailoverList)), agentIds: Schema.optional(Schema.Array(Id).check(Schema.isMaxLength(8))) })
export const NewMemory = Schema.Struct({ scope: MemoryScope, kind: MemoryKind, title: LongText(80), text: Short(4000) })
export const MemoryPatch = Schema.Struct({ state: Schema.optional(MemoryState), title: Schema.optional(LongText(80)), text: Schema.optional(Short(4000)) })
export const NewMcpServer = Schema.Struct({
  projectId: Schema.NullOr(Id),
  name: Name,
  command: LongText(500),
  args: Schema.Array(LongText(500)).check(Schema.isMaxLength(30)),
  url: LongText(500),
  env: Schema.Record(Schema.String.check(Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_-]*$/)), LongText(4000)), // stdio: environment variables; http: headers
  mode: ToolMode
})
export const McpServerPatch = Schema.Struct({ mode: Schema.optional(ToolMode), enabled: Schema.optional(Schema.Boolean) })
export const KeyInput = Schema.Struct({ value: LongText(500) }) // empty deletes
// One-time choices recorded on the server (the failover terms warning is shown once).
export const Preferences = Schema.Struct({ failoverTermsAcceptedAt: Schema.NullOr(Schema.Number) })

// Turns (send, events, interrupt, approve): see events.ts (RPC over WebSocket at /rpc).
export const ApprovalDecision = Schema.Struct({ approve: Schema.Boolean })

// ---------- workspace (ARCHITECTURE §9.1) ----------

// A folder Zero refuses: missing, not a folder, relative, or a place agents must never own (disk root,
// home, Zero's data folder).
export class WorkspaceInvalid extends Schema.Error<WorkspaceInvalid>("zero/WorkspaceInvalid")(
  { _tag: Schema.tag("WorkspaceInvalid"), reason: Schema.Literals(["relative", "missing", "not_directory", "forbidden"]) },
  { httpApiStatus: 400 }
) {}

export const FileDiff = Schema.Struct({
  path: Schema.String,
  status: Schema.Literals(["added", "modified", "deleted"]),
  added: Schema.Number,
  removed: Schema.Number,
  patch: Schema.String // unified diff of this file (empty for binary files)
})
export type FileDiff = typeof FileDiff.Type
export const TurnDiff = Schema.Struct({ turnId: Id, files: Schema.Array(FileDiff), revertedAt: Schema.NullOr(Schema.Number) })
export type TurnDiff = typeof TurnDiff.Type
// Undo refused: these files changed after the turn (by you or a later turn).
export class UndoConflict extends Schema.Error<UndoConflict>("zero/UndoConflict")(
  { _tag: Schema.tag("UndoConflict"), files: Schema.Array(Schema.String) },
  { httpApiStatus: 409 }
) {}
export const WorkspaceFile = Schema.Struct({ path: Schema.String, status: Schema.NullOr(Schema.Literals(["added", "modified", "deleted"])) })
export type WorkspaceFile = typeof WorkspaceFile.Type
export const MAX_WORKSPACE_FILES = 5000

// ---------- API ----------

const idParam = { id: Id }

export const Api = HttpApi.make("zero")
  .add(
    HttpApiGroup.make("projects")
      .add(HttpApiEndpoint.get("list", "/api/projects", { success: Schema.Array(Project) }))
      .add(HttpApiEndpoint.post("create", "/api/projects", { payload: NewProject, success: Project, error: WorkspaceInvalid }))
      .add(HttpApiEndpoint.patch("update", "/api/projects/:id", { params: idParam, payload: ProjectPatch, success: Project, error: [HttpApiError.NotFound, WorkspaceInvalid] }))
      // Files of the workspace (up to MAX_WORKSPACE_FILES), marked with what changed since the project's first checkpoint in this chat.
      .add(HttpApiEndpoint.get("files", "/api/projects/:id/files", { params: idParam, query: { chatId: Schema.optionalKey(Id) }, success: Schema.Array(WorkspaceFile), error: HttpApiError.NotFound }))
      .add(HttpApiEndpoint.delete("remove", "/api/projects/:id", { params: idParam }))
      .add(HttpApiEndpoint.put("reorder", "/api/projects/order", { payload: ProjectOrder }))
  )
  .add(
    HttpApiGroup.make("agents")
      .add(HttpApiEndpoint.get("list", "/api/agents", { success: Schema.Array(Agent) }))
      .add(HttpApiEndpoint.post("create", "/api/agents", { payload: NewAgent, success: Agent, error: HttpApiError.NotFound }))
      .add(HttpApiEndpoint.patch("update", "/api/agents/:id", { params: idParam, payload: AgentPatch, success: Agent, error: HttpApiError.NotFound }))
      .add(HttpApiEndpoint.delete("remove", "/api/agents/:id", { params: idParam }))
  )
  .add(
    HttpApiGroup.make("chats")
      .add(HttpApiEndpoint.get("list", "/api/chats", { success: Schema.Array(Chat) }))
      .add(HttpApiEndpoint.post("create", "/api/chats", { payload: NewChat, success: Chat, error: HttpApiError.NotFound }))
      .add(HttpApiEndpoint.patch("update", "/api/chats/:id", { params: idParam, payload: ChatPatch, success: Chat, error: HttpApiError.NotFound }))
      .add(HttpApiEndpoint.delete("remove", "/api/chats/:id", { params: idParam }))
      .add(HttpApiEndpoint.put("reorder", "/api/chats/order", { payload: ChatOrder }))
      .add(HttpApiEndpoint.get("messages", "/api/chats/:id/messages", { params: idParam, success: Schema.Array(Message) }))
      .add(HttpApiEndpoint.get("context", "/api/chats/:id/context", { params: idParam, success: ContextUsage, error: HttpApiError.NotFound }))
      .add(HttpApiEndpoint.get("commands", "/api/chats/:id/commands", { params: idParam, success: Schema.Array(EngineCommand), error: HttpApiError.NotFound }))
      .add(HttpApiEndpoint.get("terminals", "/api/chats/:id/terminals", { params: idParam, success: Schema.Array(TerminalSession), error: HttpApiError.NotFound }))
      .add(HttpApiEndpoint.delete("closeTerminal", "/api/chats/:id/terminals/:terminal", { params: Schema.Struct({ id: Schema.String, terminal: Schema.String }) }))
      .add(HttpApiEndpoint.post("openFile", "/api/chats/:id/open", { params: idParam, payload: OpenFile, error: [HttpApiError.NotFound, HttpApiError.BadRequest] }))
      .add(HttpApiEndpoint.post("consolidate", "/api/chats/:id/consolidate", { params: idParam, success: Chat, error: [HttpApiError.NotFound, HttpApiError.Conflict] }))
      // What one turn changed in the workspace, and undoing it (restores the files to the checkpoint before it).
      .add(HttpApiEndpoint.get("diff", "/api/turns/:id/diff", { params: idParam, success: TurnDiff, error: HttpApiError.NotFound }))
      .add(HttpApiEndpoint.post("undo", "/api/turns/:id/undo", { params: idParam, success: TurnDiff, error: [HttpApiError.NotFound, UndoConflict] }))
  )
  .add(
    HttpApiGroup.make("memories")
      .add(HttpApiEndpoint.get("list", "/api/memories", { success: Schema.Array(Memory) }))
      .add(HttpApiEndpoint.post("create", "/api/memories", { payload: NewMemory, success: Memory }))
      .add(HttpApiEndpoint.patch("update", "/api/memories/:id", { params: idParam, payload: MemoryPatch, success: Memory, error: HttpApiError.NotFound }))
  )
  .add(
    HttpApiGroup.make("tools")
      .add(HttpApiEndpoint.get("list", "/api/mcp", { success: Schema.Array(McpServer) }))
      .add(HttpApiEndpoint.post("create", "/api/mcp", { payload: NewMcpServer, success: McpServer, error: HttpApiError.NotFound }))
      .add(HttpApiEndpoint.patch("update", "/api/mcp/:id", { params: idParam, payload: McpServerPatch, success: McpServer, error: HttpApiError.NotFound }))
      .add(HttpApiEndpoint.delete("remove", "/api/mcp/:id", { params: idParam }))
      // Connects and lists the tools, already classified; a connection failure comes in `error`.
      .add(HttpApiEndpoint.get("inspect", "/api/mcp/:id/tools", { params: idParam, success: Schema.Struct({ tools: Schema.Array(ToolInfo), error: Schema.NullOr(Schema.String) }), error: HttpApiError.NotFound }))
      .add(HttpApiEndpoint.post("decide", "/api/approvals/:id", { params: idParam, payload: ApprovalDecision, error: HttpApiError.NotFound }))
  )
  .add(
    HttpApiGroup.make("accounts")
      .add(HttpApiEndpoint.get("list", "/api/accounts", { success: Schema.Array(ProviderAccount) }))
      .add(HttpApiEndpoint.post("create", "/api/accounts", { payload: NewAccount, success: ProviderAccount }))
      .add(HttpApiEndpoint.patch("update", "/api/accounts/:id", { params: idParam, payload: AccountPatch, success: ProviderAccount, error: HttpApiError.NotFound }))
      // Default accounts can't be removed; removing logs out and deletes the account's folder.
      .add(HttpApiEndpoint.delete("remove", "/api/accounts/:id", { params: idParam, error: [HttpApiError.NotFound, HttpApiError.Conflict] }))
      .add(HttpApiEndpoint.post("login", "/api/accounts/:id/login", { params: idParam, success: LoginStarted, error: [HttpApiError.NotFound, HttpApiError.Conflict] }))
      // Reads the account's limit windows now (cached for 4 min; failures back off up to 1 h).
      .add(HttpApiEndpoint.post("limits", "/api/accounts/:id/limits", { params: idParam, success: ProviderAccount, error: HttpApiError.NotFound }))
  )
  .add(
    HttpApiGroup.make("settings")
      .add(HttpApiEndpoint.get("models", "/api/models", { success: Schema.Array(ModelInfo) }))
      .add(HttpApiEndpoint.get("keys", "/api/keys", { success: Schema.Array(KeyInfo) }))
      .add(HttpApiEndpoint.get("audit", "/api/audit", { query: AuditQuery, success: AuditPage })) // one page, newest first
      .add(HttpApiEndpoint.get("storage", "/api/storage", { success: StorageReport }))
      .add(HttpApiEndpoint.post("cleanStorage", "/api/storage/clean/:id", { params: { id: StorageCleanup }, success: StorageReport }))
      .add(HttpApiEndpoint.get("usage", "/api/usage", { success: Schema.Array(UsageRow) })) // last USAGE_DAYS days
      .add(HttpApiEndpoint.get("topTurns", "/api/usage/top", { query: { since: Schema.NumberFromString }, success: Schema.Array(TopTurn) }))
      .add(HttpApiEndpoint.get("preferences", "/api/preferences", { success: Preferences }))
      .add(HttpApiEndpoint.post("acceptFailoverTerms", "/api/preferences/failover-terms", { success: Preferences }))
      .add(HttpApiEndpoint.put("setKey", "/api/keys/:name", { params: { name: Schema.String }, payload: KeyInput, error: HttpApiError.NotFound }))
  )
