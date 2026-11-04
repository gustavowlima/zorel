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

// Provider account (ARCHITECTURE §6.1). The CLI login stays in its own folder; Zorel only shows identity.
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
  path: Schema.NullOr(Schema.String), // workspace folder; null: agents work in an empty Zorel folder
  defaultAgentId: Schema.NullOr(Id), // a new chat in the project starts with this agent (null: the assistant)
  createdAt: Schema.Number
})
export type Project = typeof Project.Type

// Per-agent permissions (ideas from Tucano): what an agent may reach besides its folder (`access` covers files and
// the shell). web: search and read pages with the engine's own tools; browser: Zorel's browser tools; grants: per
// MCP server, "none" hides it, "read" exposes only reading tools, "write" all (a server not listed follows the
// server's own mode); always: calls the person allowed for good ("<serverId>:<tool>" or "browser"), skipping the
// card. Destructive tools (delete, send, publish, pay…) always ask unless allowed for good.
export const Grant = Schema.Literals(["none", "read", "write"])
export type Grant = typeof Grant.Type
export const AgentPermissions = Schema.Struct({
  web: Schema.Boolean,
  browser: Schema.Boolean,
  grants: Schema.Record(Schema.String, Grant),
  always: Schema.Array(Schema.String.check(Schema.isMaxLength(200))).check(Schema.isMaxLength(200))
})
export type AgentPermissions = typeof AgentPermissions.Type
export const DEFAULT_PERMISSIONS: AgentPermissions = { web: true, browser: true, grants: {}, always: [] }

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
  permissions: AgentPermissions,
  builtin: Schema.optionalKey(Schema.NullOr(Schema.Literal("builder"))), // Zorel's own agent: kept out of lists and pickers
  createdAt: Schema.Number
})
export type Agent = typeof Agent.Type

// A saved state of an agent's profile (newest first in lists). by: "you" or the agent that proposed it.
export const AgentVersion = Schema.Struct({
  id: Schema.String,
  n: Schema.Number,
  by: Schema.String,
  at: Schema.Number,
  profile: Schema.Struct({
    name: Schema.String, title: Schema.String, description: Schema.String, instructions: Schema.String, model: Schema.String,
    accountId: Schema.NullOr(Schema.String), effort: Schema.NullOr(Effort), failover: FailoverList, access: Access, permissions: Schema.optional(AgentPermissions)
  })
})
export type AgentVersion = typeof AgentVersion.Type

// A routine (phase 7): an agent's recurring or triggered work, run as a message in its own chat. cron: when it
// runs by itself (null: only on demand or by webhook). token: its local webhook (POST /api/hooks/:token).
export const Routine = Schema.Struct({
  id: Id,
  agentId: Id,
  chatId: Id,
  name: Schema.String,
  prompt: Schema.String,
  cron: Schema.NullOr(Schema.String),
  token: Schema.NullOr(Schema.String),
  enabled: Schema.Boolean,
  nextRunAt: Schema.NullOr(Schema.Number),
  lastRunAt: Schema.NullOr(Schema.Number),
  lastStatus: Schema.NullOr(Schema.Literals(["started", "skipped", "failed"])),
  createdAt: Schema.Number
})
export type Routine = typeof Routine.Type
const Cron = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(9), Schema.isMaxLength(100))
export const NewRoutine = Schema.Struct({ agentId: Id, name: Name, prompt: Short(8000), cron: Schema.NullOr(Cron), webhook: Schema.Boolean })
export const RoutinePatch = Schema.Struct({ name: Schema.optional(Name), prompt: Schema.optional(Short(8000)), cron: Schema.optional(Schema.NullOr(Cron)), webhook: Schema.optional(Schema.Boolean), enabled: Schema.optional(Schema.Boolean) })
// A cron pattern Zorel refuses (with croner's reason).
export class CronInvalid extends Schema.Error<CronInvalid>("zorel/CronInvalid")({ _tag: Schema.tag("CronInvalid"), message: Schema.String }, { httpApiStatus: 400 }) {}

// A message that matched a search (Cmd+K): where it is and the words around the match.
export const SearchHit = Schema.Struct({ chatId: Id, messageId: Id, snippet: Schema.String, at: Schema.Number })
export type SearchHit = typeof SearchHit.Type

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
  worktree: Schema.NullOr(Schema.String), // the git worktree the chat works in (its own branch); null: the project folder
  resumeAt: Schema.NullOr(Schema.Number), // all routes hit their limit: it continues by itself then (null: no)
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

// Storage: Zorel's data folder measured now, where it goes and what can be freed.
export const StorageCategory = Schema.Literals(["workspaces", "attachments", "history", "backups", "runs", "accounts", "browser", "other"])
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

// How full the next turn's context is: what Zorel puts in it, by part, estimated at ~4 characters a token
// (the engine adds its own tool definitions on top). `windowTokens` null: the model's window isn't known.
// Zorel compacts on its own once more than `compactAfter` messages follow the summary.
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
export const TerminalSession = Schema.Struct({ id: Schema.String, n: Schema.Number, label: Schema.NullOr(Schema.String), ended: Schema.Boolean, busy: Schema.Boolean })
export type TerminalSession = typeof TerminalSession.Type
// A script of the project's package.json; running it opens a Terminal tab (GET /api/terminals?run=name).
export const ProjectScript = Schema.Struct({ name: Schema.String, command: Schema.String })
export type ProjectScript = typeof ProjectScript.Type
// A process listening on TCP ports whose working folder is the chat's (a dev server an agent or a shell started).
export const LocalServer = Schema.Struct({ pid: Schema.Number, command: Schema.String, ports: Schema.Array(Schema.Number) })
// Settings › Processes: what runs in the background now. servers: programs listening on a port inside a chat's
// folder (an agent's dev server), with the chat whose folder it is; terminals: shells still open; sessions: engine
// processes kept between turns (Claude Code, Codex); connections: MCP servers with a client open. A server lists
// every chat working in its folder (a project's folder is shared by its chats; a worktree is one chat's).
// cpu: percent of one core now (100 = a whole core); memory: bytes. A row counts its process and what it started.
// usage: Zorel as a whole (the app, the server and everything they started), split by part.
const Use = { cpu: Schema.Number, memory: Schema.Number }
export const UsagePart = Schema.Literals(["app", "server", "agents", "terminals", "connections", "other"])
export const ProcessList = Schema.Struct({
  servers: Schema.Array(Schema.Struct({ pid: Schema.Number, command: Schema.String, ports: Schema.Array(Schema.Number), chatIds: Schema.Array(Schema.String), projectId: Schema.NullOr(Schema.String), folder: Schema.String, nested: Schema.Boolean, ...Use })), // nested: runs inside a shell or session listed here (already counted there)
  terminals: Schema.Array(Schema.Struct({ id: Schema.String, chatId: Schema.String, n: Schema.Number, label: Schema.NullOr(Schema.String), busy: Schema.Boolean, ...Use })),
  sessions: Schema.Array(Schema.Struct({ key: Schema.String, chatId: Schema.String, agentId: Schema.NullOr(Schema.String), provider: Schema.String, usedAt: Schema.Number, ...Use })),
  connections: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String, local: Schema.Boolean, ...Use })),
  usage: Schema.Struct({ ...Use, cores: Schema.Number, totalMemory: Schema.Number, parts: Schema.Array(Schema.Struct({ id: UsagePart, ...Use })) })
})
export type ProcessList = typeof ProcessList.Type
export type LocalServer = typeof LocalServer.Type
// A file to open in the computer's default app, from a path printed in the terminal (relative to the chat's folder).
export const OpenFile = Schema.Struct({ path: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1000)) })
// The Files panel's operations on the chat's folder (paths relative to it; checked to stay inside on the server).
// create: path · rename: path → to · move: paths into the folder `to` ("" is the root) · delete: paths (to Zorel's
// trash; the answer's trashId undoes it) · restore: id · open / reveal: path (default app / file manager).
const RelPath = Schema.String.check(Schema.isMaxLength(1000))
export const FsOp = Schema.Struct({
  op: Schema.Literals(["create", "rename", "move", "delete", "restore", "open", "reveal"]),
  path: Schema.optional(RelPath),
  to: Schema.optional(RelPath),
  paths: Schema.optional(Schema.Array(RelPath).check(Schema.isMaxLength(500))),
  id: Schema.optional(Schema.String.check(Schema.isMaxLength(40)))
})

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
  durationMs: Schema.NullOr(Schema.Number), // how long the turn that wrote it took (null: not a reply, or older data)
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
  replaces: Schema.optionalKey(Schema.NullOr(Id)), // a proposed improvement of this active skill
  reason: Schema.optionalKey(Schema.NullOr(Schema.String)), // why it was proposed
  createdAt: Schema.Number,
  confirmedAt: Schema.Number
})
export type Memory = typeof Memory.Type
// A skill already on this computer (a SKILL.md of Claude Code, Codex, other agents or a plugin) and whether
// Zorel's agents use it.
export const FileSkill = Schema.Struct({
  path: Schema.String,
  name: Schema.String,
  description: Schema.String,
  source: Schema.Literals(["claude", "codex", "agents", "plugin"]),
  plugin: Schema.optionalKey(Schema.String),
  enabled: Schema.Boolean
})
export type FileSkill = typeof FileSkill.Type
export const MemoryVersion = Schema.Struct({ id: Id, title: Schema.String, text: Schema.String, by: Schema.String, at: Schema.Number })
export type MemoryVersion = typeof MemoryVersion.Type

// A knowledge page (phase 3b): a longer Markdown note by scope (as memories). pinned: its title goes into every
// turn's context in that scope.
export const Page = Schema.Struct({ id: Id, scope: MemoryScope, title: Schema.String, body: Schema.String, pinned: Schema.Boolean, updatedAt: Schema.Number, createdAt: Schema.Number })
export type Page = typeof Page.Type
export const PageVersion = Schema.Struct({ id: Schema.String, n: Schema.Number, title: Schema.String, body: Schema.String, by: Schema.String, at: Schema.Number })
export type PageVersion = typeof PageVersion.Type
const PageTitle = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(120))
const PageBody = Schema.String.check(Schema.isMaxLength(100_000))
export const NewPage = Schema.Struct({ scope: MemoryScope, title: PageTitle, body: PageBody })
export const PagePatch = Schema.Struct({ title: Schema.optional(PageTitle), body: Schema.optional(PageBody), pinned: Schema.optional(Schema.Boolean) })


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
  auth: Schema.Literals(["none", "oauth"]), // oauth: the person signs in through the browser; tokens in the keychain
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
export const ProjectPatch = Schema.Struct({ name: Schema.optional(Name), brief: Schema.optional(LongText(8000)), path: Schema.optional(Schema.NullOr(FolderPath)), defaultAgentId: Schema.optional(Schema.NullOr(Id)) })
const AgentTitle = Schema.String.check(Schema.isTrimmed(), Schema.isMaxLength(60))
const AgentDescription = LongText(300)
export const NewAgent = Schema.Struct({ projectId: Schema.NullOr(Id), name: Name, title: Schema.optional(AgentTitle), description: Schema.optional(AgentDescription), instructions: LongText(8000), model: ModelId, accountId: Schema.optional(Schema.NullOr(Id)), effort: Schema.optional(Schema.NullOr(Effort)), failover: Schema.optional(FailoverList), access: Schema.optional(Access), permissions: Schema.optional(AgentPermissions) })
export const AgentPatch = Schema.Struct({ name: Schema.optional(Name), title: Schema.optional(AgentTitle), description: Schema.optional(AgentDescription), instructions: Schema.optional(LongText(8000)), model: Schema.optional(ModelId), accountId: Schema.optional(Schema.NullOr(Id)), effort: Schema.optional(Schema.NullOr(Effort)), failover: Schema.optional(FailoverList), access: Schema.optional(Access), permissions: Schema.optional(AgentPermissions) })
export const NewChat = Schema.Struct({ projectId: Schema.NullOr(Id), agentIds: Schema.Array(Id).check(Schema.isMaxLength(8)), model: ModelId, accountId: Schema.optional(Schema.NullOr(Id)), effort: Schema.optional(Schema.NullOr(Effort)) })
export const ChatPatch = Schema.Struct({ resumeAt: Schema.optional(Schema.Null), title: Schema.optional(Name), model: Schema.optional(ModelId), accountId: Schema.optional(Schema.NullOr(Id)), effort: Schema.optional(Schema.NullOr(Effort)), failover: Schema.optional(Schema.NullOr(FailoverList)), agentIds: Schema.optional(Schema.Array(Id).check(Schema.isMaxLength(8))) })
export const NewMemory = Schema.Struct({ scope: MemoryScope, kind: MemoryKind, title: LongText(80), text: Short(4000) })
export const MemoryPatch = Schema.Struct({ state: Schema.optional(MemoryState), title: Schema.optional(LongText(80)), text: Schema.optional(Short(4000)) })
// stdio: environment variables; http: headers. Values go to the system keychain.
const McpEnv = Schema.Record(Schema.String.check(Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_-]*$/)), LongText(4000))
export const NewMcpServer = Schema.Struct({
  projectId: Schema.NullOr(Id),
  name: Name,
  command: LongText(500),
  args: Schema.Array(LongText(500)).check(Schema.isMaxLength(30)),
  url: LongText(500),
  env: McpEnv,
  mode: ToolMode,
  auth: Schema.optional(Schema.Literals(["none", "oauth"]))
})
export const McpServerPatch = Schema.Struct({ mode: Schema.optional(ToolMode), enabled: Schema.optional(Schema.Boolean), env: Schema.optional(McpEnv) }) // env: new secrets (e.g. a fresh token)
export const KeyInput = Schema.Struct({ value: LongText(500) }) // empty deletes
// One-time choices recorded on the server (the failover terms warning is shown once).
// nativeSkills: Claude Code and Codex may use their own skills (the person's ~/.claude/skills, plugins, Codex's).
export const Preferences = Schema.Struct({ failoverTermsAcceptedAt: Schema.NullOr(Schema.Number), paused: Schema.Boolean, nativeSkills: Schema.Boolean })

// Turns (send, events, interrupt, approve): see events.ts (RPC over WebSocket at /rpc).
export const ApprovalDecision = Schema.Struct({ approve: Schema.Boolean })

// ---------- workspace (ARCHITECTURE §9.1) ----------

// A folder Zorel refuses: missing, not a folder, relative, or a place agents must never own (disk root,
// home, Zorel's data folder).
export class WorkspaceInvalid extends Schema.Error<WorkspaceInvalid>("zorel/WorkspaceInvalid")(
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
export class UndoConflict extends Schema.Error<UndoConflict>("zorel/UndoConflict")(
  { _tag: Schema.tag("UndoConflict"), files: Schema.Array(Schema.String) },
  { httpApiStatus: 409 }
) {}
// Git in the chat's folder (apps/server/src/git.ts). files: the changed paths (porcelain), pr: the open pull
// request of the branch when the GitHub CLI finds one.
export const GitStatus = Schema.Struct({
  repo: Schema.Boolean,
  branch: Schema.NullOr(Schema.String),
  base: Schema.NullOr(Schema.String), // the default branch pull requests go into (origin's HEAD, else main/master)
  upstream: Schema.NullOr(Schema.String),
  ahead: Schema.Number,
  behind: Schema.Number,
  files: Schema.Array(Schema.Struct({ path: Schema.String, status: Schema.Literals(["added", "modified", "deleted", "renamed"]) })),
  remote: Schema.Boolean,
  gh: Schema.Boolean,
  pr: Schema.NullOr(Schema.Struct({ number: Schema.Number, url: Schema.String, state: Schema.String, title: Schema.String })),
  commits: Schema.Array(Schema.Struct({ sha: Schema.String, subject: Schema.String, at: Schema.Number, pushed: Schema.Boolean })) // the latest on the branch
})
export type GitStatus = typeof GitStatus.Type
// git or gh refused (its message, shown as is).
export class GitFailed extends Schema.Error<GitFailed>("zorel/GitFailed")({ _tag: Schema.tag("GitFailed"), message: Schema.String }, { httpApiStatus: 400 }) {}
const GitText = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(20_000))
export const GitDraft = Schema.Struct({ title: Schema.String, body: Schema.String })
export type GitDraft = typeof GitDraft.Type
export const WorkspaceFile = Schema.Struct({ path: Schema.String, status: Schema.NullOr(Schema.Literals(["added", "modified", "deleted"])) })
export type WorkspaceFile = typeof WorkspaceFile.Type
export const MAX_WORKSPACE_FILES = 5000

// ---------- API ----------

const idParam = { id: Id }

export const Api = HttpApi.make("zorel")
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
      // A chat with the Builder (created the first time), in a project or General.
      .add(HttpApiEndpoint.post("builder", "/api/agents/builder", { payload: Schema.Struct({ projectId: Schema.NullOr(Id), model: ModelId }), success: Chat, error: HttpApiError.NotFound }))
      .add(HttpApiEndpoint.get("versions", "/api/agents/:id/versions", { params: idParam, success: Schema.Array(AgentVersion), error: HttpApiError.NotFound }))
      .add(HttpApiEndpoint.post("restore", "/api/agents/:id/versions/:n/restore", { params: Schema.Struct({ id: Schema.String, n: Schema.NumberFromString }), success: Agent, error: HttpApiError.NotFound }))
  )
  .add(
    HttpApiGroup.make("pages")
      .add(HttpApiEndpoint.get("list", "/api/pages", { success: Schema.Array(Page) }))
      .add(HttpApiEndpoint.post("create", "/api/pages", { payload: NewPage, success: Page }))
      .add(HttpApiEndpoint.patch("update", "/api/pages/:id", { params: idParam, payload: PagePatch, success: Page, error: HttpApiError.NotFound }))
      .add(HttpApiEndpoint.delete("remove", "/api/pages/:id", { params: idParam }))
      .add(HttpApiEndpoint.get("versions", "/api/pages/:id/versions", { params: idParam, success: Schema.Array(PageVersion), error: HttpApiError.NotFound }))
      .add(HttpApiEndpoint.post("restore", "/api/pages/:id/versions/:n/restore", { params: Schema.Struct({ id: Schema.String, n: Schema.NumberFromString }), success: Page, error: HttpApiError.NotFound }))
  )
  .add(
    HttpApiGroup.make("routines")
      .add(HttpApiEndpoint.get("list", "/api/routines", { success: Schema.Array(Routine) }))
      .add(HttpApiEndpoint.post("create", "/api/routines", { payload: NewRoutine, success: Routine, error: [HttpApiError.NotFound, CronInvalid] }))
      .add(HttpApiEndpoint.patch("update", "/api/routines/:id", { params: idParam, payload: RoutinePatch, success: Routine, error: [HttpApiError.NotFound, CronInvalid] }))
      .add(HttpApiEndpoint.delete("remove", "/api/routines/:id", { params: idParam }))
      .add(HttpApiEndpoint.post("run", "/api/routines/:id/run", { params: idParam, error: HttpApiError.NotFound }))
      // A local script or service starts it; the JSON body (if any) goes into the message.
      .add(HttpApiEndpoint.post("hook", "/api/hooks/:token", { params: Schema.Struct({ token: Schema.String }), payload: Schema.optional(Schema.Unknown), error: HttpApiError.NotFound }))
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
      .add(HttpApiEndpoint.get("git", "/api/chats/:id/git", { params: idParam, success: GitStatus, error: HttpApiError.NotFound }))
      .add(HttpApiEndpoint.post("gitDraft", "/api/chats/:id/git/draft", { params: idParam, payload: Schema.Struct({ kind: Schema.Literals(["commit", "pr"]) }), success: GitDraft, error: [HttpApiError.NotFound, GitFailed] }))
      .add(HttpApiEndpoint.post("gitCommit", "/api/chats/:id/git/commit", { params: idParam, payload: Schema.Struct({ message: GitText }), success: Schema.Struct({ sha: Schema.String }), error: [HttpApiError.NotFound, GitFailed] }))
      .add(HttpApiEndpoint.post("gitPush", "/api/chats/:id/git/push", { params: idParam, error: [HttpApiError.NotFound, GitFailed] }))
      .add(HttpApiEndpoint.post("gitPr", "/api/chats/:id/git/pr", { params: idParam, payload: Schema.Struct({ title: GitText.check(Schema.isMaxLength(200)), body: Schema.String.check(Schema.isMaxLength(20_000)) }), success: Schema.Struct({ url: Schema.String }), error: [HttpApiError.NotFound, GitFailed] }))
      .add(HttpApiEndpoint.post("gitBranch", "/api/chats/:id/git/branch", { params: idParam, payload: Schema.Struct({ name: GitText.check(Schema.isMaxLength(200)) }), error: [HttpApiError.NotFound, GitFailed] }))
      .add(HttpApiEndpoint.post("enterWorktree", "/api/chats/:id/worktree", { params: idParam, payload: Schema.Struct({ branch: Schema.optionalKey(GitText.check(Schema.isMaxLength(200))) }), error: [HttpApiError.NotFound, GitFailed] }))
      .add(HttpApiEndpoint.delete("leaveWorktree", "/api/chats/:id/worktree", { params: idParam, error: [HttpApiError.NotFound, GitFailed] }))
      // "Edit from here": the conversation goes back to before this message of yours (it comes back as text to
      // edit); files: also undo what the later turns changed. Refused while a turn runs.
      .add(HttpApiEndpoint.post("rewind", "/api/chats/:id/rewind", { params: idParam, payload: Schema.Struct({ messageId: Id, files: Schema.Boolean }), success: Schema.Struct({ text: Schema.String }), error: [HttpApiError.NotFound, HttpApiError.Conflict, UndoConflict] }))
      .add(HttpApiEndpoint.get("search", "/api/search", { query: Schema.Struct({ q: Schema.String.check(Schema.isMinLength(2), Schema.isMaxLength(200)) }), success: Schema.Array(SearchHit) }))
      .add(HttpApiEndpoint.get("scripts", "/api/chats/:id/scripts", { params: idParam, success: Schema.Array(ProjectScript), error: HttpApiError.NotFound }))
      .add(HttpApiEndpoint.get("servers", "/api/chats/:id/servers", { params: idParam, success: Schema.Array(LocalServer), error: HttpApiError.NotFound }))
      .add(HttpApiEndpoint.delete("stopServer", "/api/chats/:id/servers/:pid", { params: Schema.Struct({ id: Schema.String, pid: Schema.NumberFromString }), error: HttpApiError.NotFound }))
      .add(HttpApiEndpoint.post("openFile", "/api/chats/:id/open", { params: idParam, payload: OpenFile, error: [HttpApiError.NotFound, HttpApiError.BadRequest] }))
      // A file's text for the viewer: contents null when it's binary or over 1 MB.
      .add(HttpApiEndpoint.get("readFile", "/api/chats/:id/file", { params: idParam, query: { path: RelPath }, success: Schema.Struct({ contents: Schema.NullOr(Schema.String), size: Schema.Number }), error: [HttpApiError.NotFound, HttpApiError.BadRequest] }))
      .add(HttpApiEndpoint.post("fs", "/api/chats/:id/fs", { params: idParam, payload: FsOp, success: Schema.Struct({ trashId: Schema.NullOr(Schema.String) }), error: [HttpApiError.NotFound, HttpApiError.BadRequest] }))
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
      .add(HttpApiEndpoint.get("versions", "/api/memories/:id/versions", { params: idParam, success: Schema.Array(MemoryVersion), error: HttpApiError.NotFound }))
      .add(HttpApiEndpoint.post("restore", "/api/memories/:id/restore", { params: idParam, payload: Schema.Struct({ versionId: Id }), success: Memory, error: HttpApiError.NotFound }))
  )
  .add(
    HttpApiGroup.make("tools")
      .add(HttpApiEndpoint.get("list", "/api/mcp", { success: Schema.Array(McpServer) }))
      .add(HttpApiEndpoint.post("create", "/api/mcp", { payload: NewMcpServer, success: McpServer, error: [HttpApiError.NotFound, HttpApiError.BadRequest] }))
      .add(HttpApiEndpoint.patch("update", "/api/mcp/:id", { params: idParam, payload: McpServerPatch, success: McpServer, error: HttpApiError.NotFound }))
      .add(HttpApiEndpoint.delete("remove", "/api/mcp/:id", { params: idParam }))
      // Sign in (oauth connectors): the URL to open in the browser, or null when already signed in.
      .add(HttpApiEndpoint.post("signIn", "/api/mcp/:id/sign-in", { params: idParam, success: Schema.Struct({ authorizeUrl: Schema.NullOr(Schema.String) }), error: [HttpApiError.NotFound, HttpApiError.BadRequest] }))
      // signedIn: oauth servers holding a token; refused: servers whose credentials were rejected (sign in again).
      .add(HttpApiEndpoint.get("signedIn", "/api/mcp/signed-in", { success: Schema.Struct({ signedIn: Schema.Array(Schema.String), refused: Schema.Array(Schema.String) }) }))
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
      .add(HttpApiEndpoint.get("processes", "/api/processes", { success: ProcessList }))
      .add(HttpApiEndpoint.delete("stopProcess", "/api/processes/servers/:pid", { params: Schema.Struct({ pid: Schema.NumberFromString }), error: HttpApiError.NotFound }))
      .add(HttpApiEndpoint.delete("closeSession", "/api/processes/sessions/:key", { params: Schema.Struct({ key: Schema.String.check(Schema.isMaxLength(200)) }) }))
      .add(HttpApiEndpoint.delete("closeConnection", "/api/processes/connections/:id", { params: idParam }))
      .add(HttpApiEndpoint.post("cleanStorage", "/api/storage/clean/:id", { params: { id: StorageCleanup }, success: StorageReport }))
      .add(HttpApiEndpoint.get("usage", "/api/usage", { success: Schema.Array(UsageRow) })) // last USAGE_DAYS days
      .add(HttpApiEndpoint.get("topTurns", "/api/usage/top", { query: { since: Schema.NumberFromString }, success: Schema.Array(TopTurn) }))
      .add(HttpApiEndpoint.get("preferences", "/api/preferences", { success: Preferences }))
      .add(HttpApiEndpoint.get("fileSkills", "/api/skills/files", { success: Schema.Array(FileSkill) }))
      .add(HttpApiEndpoint.patch("pickFileSkill", "/api/skills/files", { payload: Schema.Struct({ path: Schema.String.check(Schema.isMaxLength(2000)), enabled: Schema.Boolean }), success: Schema.Array(FileSkill), error: HttpApiError.NotFound }))
      // Pause everything: running turns stop, new ones wait queued, routines wait; false resumes.
      .add(HttpApiEndpoint.put("pause", "/api/pause", { payload: Schema.Struct({ paused: Schema.Boolean }) }))
      .add(HttpApiEndpoint.put("nativeSkills", "/api/preferences/native-skills", { payload: Schema.Struct({ enabled: Schema.Boolean }), success: Preferences }))
      .add(HttpApiEndpoint.post("acceptFailoverTerms", "/api/preferences/failover-terms", { success: Preferences }))
      .add(HttpApiEndpoint.put("setKey", "/api/keys/:name", { params: { name: Schema.String }, payload: KeyInput, error: HttpApiError.NotFound }))
  )
