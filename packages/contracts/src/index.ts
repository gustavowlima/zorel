// Single contract between server and clients: everything crossing the network is typed here.
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup } from "effect/http-api"
import { FlowGraph, RoutineSchedule, Text, TriggerConfig } from "./flow.ts"

export * from "./flow.ts"

const Id = Schema.String
const Name = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(80))
const Short = (max: number) => Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(max))
// "<provider>/<model>", e.g.: "claude-cli/sonnet", "anthropic/claude-sonnet-5-5", "ollama/llama3.3"
export const ModelId = Schema.String.check(Schema.isPattern(/^[a-z-]+\/\S+$/), Schema.isMaxLength(200))

// ---------- entities ----------

// Provider account (ARCHITECTURE §6.1). The CLI login stays in its own folder; Zorel only shows identity.
export const AccountProvider = Schema.Literals(["claude", "codex", "antigravity"])
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
  installed: Schema.Boolean, // its CLI (claude, codex) is on this computer: without it, Zorel can install it
  loggedIn: Schema.Boolean,
  identity: Schema.NullOr(Schema.String), // e-mail or plan reported by the CLI
  loggingIn: Schema.Boolean, // a login flow is open in the browser
  limitedUntil: Schema.NullOr(Schema.Number), // hit its limit: failover skips it until then (epoch ms)
  usage: Schema.NullOr(AccountUsage),
  createdAt: Schema.Number
})
export type ProviderAccount = typeof ProviderAccount.Type
const NewAccount = Schema.Struct({ provider: AccountProvider, label: Name })
const AccountPatch = Schema.Struct({ label: Name })
// url: when the CLI printed one; output: on a server, what it shows (the link, a device code, a prompt for the code)
const LoginStarted = Schema.Struct({ url: Schema.NullOr(Schema.String), output: Schema.optional(Schema.String) })

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
const FailoverList = Schema.Array(FailoverTarget).check(Schema.isMaxLength(MAX_FAILOVER))

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
  // Who joins a new chat in the project: these agents, then the members of these teams (a chat holds 8). The router
  // then gives each message to the one it fits. Empty: a plain chat.
  agentIds: Schema.Array(Id),
  teamIds: Schema.Array(Id),
  sharedBrowser: Schema.Boolean, // team server: the project's agents keep one set of site logins for all its people
  createdAt: Schema.Number
})
export type Project = typeof Project.Type

// Per-agent permissions: what an agent may reach besides its folder (`access` covers files and
// the shell). web: search and read pages with the engine's own tools; browser: Zorel's browser tools; grants: per
// MCP server, "none" hides it, "read" exposes only reading tools, "write" all (a server not listed follows the
// server's own mode); always: calls the person allowed for good ("<serverId>:<tool>" or "browser"), skipping the
// card. Destructive tools (delete, send, publish, pay…) always ask unless allowed for good.
export const Grant = Schema.Literals(["none", "read", "write"])
export type Grant = typeof Grant.Type
// An app on the person's computer given to an agent (spec 008): read only, or read and use.
export const DesktopApp = Schema.Struct({ name: Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(100)), level: Schema.Literals(["read", "use"]) })
export type DesktopApp = typeof DesktopApp.Type
export const AgentPermissions = Schema.Struct({
  web: Schema.Boolean,
  browser: Schema.Boolean,
  grants: Schema.Record(Schema.String, Grant),
  always: Schema.Array(Schema.String.check(Schema.isMaxLength(200))).check(Schema.isMaxLength(200)),
  apps: Schema.optional(Schema.Array(DesktopApp).check(Schema.isMaxLength(50))), // none when absent
  // Where it runs commands (spec 009): none (this computer, inside its sandbox and access level), its own isolated
  // Linux container, or this computer without a sandbox ("host": full access); none when absent.
  computer: Schema.optional(Schema.Literals(["none", "container", "host"])),
  // Folders on this computer lent to its Linux container, besides the chat's project folder (absolute paths).
  lent: Schema.optional(Schema.Array(Schema.String.check(Schema.isMaxLength(1000))).check(Schema.isMaxLength(10)))
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
  // Archived: out of the lists and pickers, answers no one and runs no routine; its history stays. Restorable.
  archivedAt: Schema.NullOr(Schema.Number),
  // Token limits (input + output): a month's (UTC) total, and one reply's. null: none. Over the month's, it doesn't
  // start; past a reply's, the reply stops and can go on (Continue).
  monthlyTokens: Schema.NullOr(Schema.Number),
  replyTokens: Schema.NullOr(Schema.Number),
  // Whether the agent learns from its chats: "read" learns nothing (it only uses what's kept); "ask" (and the older
  // "auto") learns. Whether what it learns waits for review is one setting for all agents (Preferences.memoryApproval).
  memory: Schema.Literals(["auto", "ask", "read"]),
  // Pages: "write" reads them and writes new ones (a change to an existing page waits for you), "read" only
  // consults them, "none": no pinned pages in its context and no page tools.
  knowledge: Schema.Literals(["write", "read", "none"]),
  createdAt: Schema.Number
})
export type Agent = typeof Agent.Type
const MemoryMode = Schema.Literals(["auto", "ask", "read"])
const KnowledgeAccess = Schema.Literals(["write", "read", "none"])
// The agents that are teammates: not Zorel's own (the Builder), not archived.
export const isTeammate = (a: Pick<Agent, "builtin" | "archivedAt">) => !a.builtin && !a.archivedAt
const TOKEN_LIMIT = Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: 1000, maximum: 1_000_000_000 })))

// A saved state of an agent's profile (newest first in lists). by: "you" or the agent that proposed it.
export const AgentVersion = Schema.Struct({
  id: Schema.String,
  n: Schema.Number,
  by: Schema.String,
  at: Schema.Number,
  profile: Schema.Struct({
    name: Schema.String, title: Schema.String, description: Schema.String, instructions: Schema.String, model: Schema.String,
    accountId: Schema.NullOr(Schema.String), effort: Schema.NullOr(Effort), failover: FailoverList, access: Access, permissions: Schema.optional(AgentPermissions),
    memory: Schema.optional(MemoryMode), knowledge: Schema.optional(KnowledgeAccess) // absent in versions saved before they existed
  })
})
export type AgentVersion = typeof AgentVersion.Type

// What a routine watches: a connector's read-only tool, called every few minutes; the routine runs when its result
// has items it hasn't seen (a new issue, a failing monitor, an email).
// Spec 013: `more` watches other channels with the same tool (each its own inputs); `filter` keeps only items holding
// one of its words; `each` starts one run per new item (a message trigger) instead of one for all.
export const RoutineWatch = Schema.Struct({
  serverId: Id,
  tool: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  args: Schema.Record(Schema.String, Schema.Unknown),
  more: Schema.optional(Schema.Array(Schema.Record(Schema.String, Schema.Unknown)).check(Schema.isMaxLength(9))),
  filter: Schema.optional(Schema.String.check(Schema.isMaxLength(500))),
  each: Schema.optional(Schema.Boolean)
})
export type RoutineWatch = typeof RoutineWatch.Type
// Spec 012. Where a routine's result goes, and when the person is told.
export const RoutineChannel = Schema.Literals(["notify", "telegram", "page"])
export type RoutineChannel = typeof RoutineChannel.Type
// Spec 013: a connector's write tool the result is posted with. textField takes the result; args hold the rest
// (a channel's id). inThread: the reply goes into the triggering message's thread when the tool takes one.
export const ConnectorDestination = Schema.Struct({
  serverId: Id,
  tool: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  args: Schema.Record(Schema.String, Schema.Unknown),
  textField: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  inThread: Schema.optional(Schema.Boolean)
})
export type ConnectorDestination = typeof ConnectorDestination.Type
export const RoutineDelivery = Schema.Struct({ channels: Schema.Array(RoutineChannel).check(Schema.isMaxLength(3)), pageId: Schema.optional(Id), connectors: Schema.optional(Schema.Array(ConnectorDestination).check(Schema.isMaxLength(3))) })
export type RoutineDelivery = typeof RoutineDelivery.Type
export const RoutineTell = Schema.Literals(["every", "something", "brief"]) // every run, when there's something, only in the brief
export type RoutineTell = typeof RoutineTell.Type
export const RoutineOutcome = Schema.Literals(["nothing", "something", "needs"])
export type RoutineOutcome = typeof RoutineOutcome.Type
const RoutineTrigger = Schema.Literals(["schedule", "day_start", "now", "webhook", "watch"])
// One run: when, what started it, how it ended, and what the person was told. `report` only on the routine's history.
export const RoutineRun = Schema.Struct({
  id: Id,
  routineId: Id,
  trigger: RoutineTrigger,
  label: Schema.NullOr(Schema.String),
  state: Schema.Literals(["queued", "running", "done"]),
  outcome: Schema.NullOr(RoutineOutcome),
  summary: Schema.String,
  report: Schema.optional(Schema.String),
  turnId: Schema.NullOr(Schema.String),
  messageId: Schema.NullOr(Schema.String),
  triageTokens: Schema.Number,
  cost: Schema.NullOr(Schema.Number),
  held: Schema.Boolean,
  deliveredAt: Schema.NullOr(Schema.Number),
  deliveryNote: Schema.NullOr(Schema.String),
  readAt: Schema.NullOr(Schema.Number),
  createdAt: Schema.Number,
  startedAt: Schema.NullOr(Schema.Number),
  endedAt: Schema.NullOr(Schema.Number),
  version: Schema.optional(Schema.NullOr(Schema.Number)) // spec 013: the flow version it ran on; null: a spec 012 run
})
export type RoutineRun = typeof RoutineRun.Type
// Spec 013: one step of a flow run. uncertain: a write that may have gone out when the server stopped (the person
// decides: send again, skip or stop).
const RunStepState = Schema.Literals(["running", "done", "failed", "skipped", "waiting", "uncertain"])
export const RunStep = Schema.Struct({
  id: Id,
  runId: Id,
  nodeId: Schema.String,
  attempt: Schema.Number,
  state: RunStepState,
  branch: Schema.NullOr(Schema.String),
  input: Schema.String, // previews, masked, ≤ 4000 characters
  output: Schema.String,
  full: Schema.Boolean, // the whole output is kept apart (GET …/steps/:stepId/output)
  error: Schema.NullOr(Schema.String),
  startedAt: Schema.Number,
  endedAt: Schema.NullOr(Schema.Number)
})
export type RunStep = typeof RunStep.Type
const RunDetail = Schema.Struct({ run: RoutineRun, steps: Schema.Array(RunStep) })
const RoutineFlow = Schema.Struct({ version: Schema.NullOr(Schema.Number), graph: FlowGraph })
// A flow the server won't save, naming the step and the field.
export class FlowInvalid extends Schema.Error<FlowInvalid>("zorel/FlowInvalid")({ _tag: Schema.tag("FlowInvalid"), message: Schema.String, nodeId: Schema.optional(Schema.String), field: Schema.optional(Schema.String) }, { httpApiStatus: 400 }) {}
// Saved on top of a version that isn't the current one (another tab saved first).
export class FlowConflict extends Schema.Error<FlowConflict>("zorel/FlowConflict")({ _tag: Schema.tag("FlowConflict"), message: Schema.String, version: Schema.NullOr(Schema.Number) }, { httpApiStatus: 409 }) {}
// A connector's tool for the step picker (spec 013), with whether this routine's agent can use it now.
export const ToolState = Schema.Literals(["usable", "no-access", "read-only", "off", "signed-out"])
export type ToolState = typeof ToolState.Type
export const CatalogTool = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  cls: Schema.Literals(["read", "write", "sensitive"]),
  inputSchema: Schema.Record(Schema.String, Schema.Unknown),
  outputSchema: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  state: ToolState
})
export type CatalogTool = typeof CatalogTool.Type
export const TriggerTest = Schema.Struct({
  items: Schema.Array(Schema.Struct({ preview: Schema.String, verdict: Schema.Literals(["runs", "seen", "filtered", "checked-out"]) })),
  times: Schema.Array(Schema.Number), // a schedule's next times
  note: Schema.NullOr(Schema.String), // why the check let nothing through, or why the test couldn't run
  first: Schema.Boolean // a watch never checked yet: what's there now counts as seen
})
export type TriggerTest = typeof TriggerTest.Type
const StepTest = Schema.Struct({ output: Schema.String, dry: Schema.Boolean, error: Schema.NullOr(Schema.String) })
// What came in since the last brief (the Today page), built from the runs without a model.
export const Today = Schema.Struct({ from: Schema.Number, needs: Schema.Array(RoutineRun), found: Schema.Array(RoutineRun), quiet: Schema.Number })
export type Today = typeof Today.Type
export const RoutineWeek = Schema.Struct({ runs: Schema.Array(RoutineRun), planned: Schema.Array(Schema.Struct({ routineId: Id, at: Schema.Number })) })
export type RoutineWeek = typeof RoutineWeek.Type
const HourMinute = Schema.String.check(Schema.isPattern(/^([01]\d|2[0-3]):[0-5]\d$/))
export const QuietHours = Schema.Struct({ from: HourMinute, to: HourMinute })
export type QuietHours = typeof QuietHours.Type
// The person's time (spec 012): their zone, when their day usually starts (learned from the first activity of the
// day unless set), and quiet hours that hold pings for the morning brief.
export const TimeProfile = Schema.Struct({
  timeZone: Schema.String,
  quietHours: Schema.NullOr(QuietHours),
  dayStartMinutes: Schema.Number, // the start in use, minutes after local midnight
  dayStartSet: Schema.NullOr(Schema.Number), // set by hand; null: learned
  learned: Schema.Number // how many days it was learned from
})
export type TimeProfile = typeof TimeProfile.Type
const TimeProfileInput = Schema.Struct({
  timeZone: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  quietHours: Schema.NullOr(QuietHours),
  dayStartSet: Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1439 })))
})
// A routine (phase 7): an agent's recurring or triggered work, run as a message in its own chat. cron: when it
// runs by itself (null: only on demand or by webhook). token: its local webhook (POST /api/hooks/:token).
// watch: a connector it polls, running on what's new.
export const Routine = Schema.Struct({
  id: Id,
  agentId: Id,
  chatId: Id,
  name: Schema.String,
  prompt: Schema.String,
  cron: Schema.NullOr(Schema.String),
  token: Schema.NullOr(Schema.String),
  watch: Schema.NullOr(RoutineWatch),
  enabled: Schema.Boolean,
  nextRunAt: Schema.NullOr(Schema.Number),
  lastRunAt: Schema.NullOr(Schema.Number),
  lastStatus: Schema.NullOr(Schema.Literals(["started", "skipped", "failed"])),
  createdAt: Schema.Number,
  onDayStart: Schema.Boolean,
  dayRanOn: Schema.NullOr(Schema.String), // local date of the last day-start run
  lookFirst: Schema.Boolean,
  delivery: RoutineDelivery,
  tell: RoutineTell,
  urgent: Schema.Boolean,
  version: Schema.optional(Schema.NullOr(Schema.Number)), // spec 013: its flow's current version; null: a spec 012 routine
  schedule: Schema.optional(Schema.NullOr(RoutineSchedule)), // spec 013: once or monthly (cron stays for weekly)
  watchEvery: Schema.optional(Schema.Number) // minutes between a watch's checks (1, 5, 15 or 60)
})
export type Routine = typeof Routine.Type
const Cron = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(9), Schema.isMaxLength(100))
const RoutineExtras = {
  onDayStart: Schema.optional(Schema.Boolean), lookFirst: Schema.optional(Schema.Boolean), delivery: Schema.optional(RoutineDelivery),
  tell: Schema.optional(RoutineTell), urgent: Schema.optional(Schema.Boolean)
}
export const NewRoutine = Schema.Struct({ agentId: Id, name: Name, prompt: Short(8000), cron: Schema.NullOr(Cron), webhook: Schema.Boolean, watch: Schema.optional(Schema.NullOr(RoutineWatch)), ...RoutineExtras })
const RoutinePatch = Schema.Struct({ name: Schema.optional(Name), prompt: Schema.optional(Short(8000)), cron: Schema.optional(Schema.NullOr(Cron)), webhook: Schema.optional(Schema.Boolean), enabled: Schema.optional(Schema.Boolean), ...RoutineExtras })
// A cron pattern Zorel refuses (with croner's reason).
// A routine's settings that don't fit together (spec 012), e.g. "look first" without a watched connector.
export class RoutineInvalid extends Schema.Error<RoutineInvalid>("zorel/RoutineInvalid")({ _tag: Schema.tag("RoutineInvalid"), message: Schema.String }, { httpApiStatus: 400 }) {}
// A webhook for a routine with 20 events already waiting (spec 012): refused, not queued.
export class RoutineQueueFull extends Schema.Error<RoutineQueueFull>("zorel/RoutineQueueFull")({ _tag: Schema.tag("RoutineQueueFull"), message: Schema.String }, { httpApiStatus: 429 }) {}
export class CronInvalid extends Schema.Error<CronInvalid>("zorel/CronInvalid")({ _tag: Schema.tag("CronInvalid"), message: Schema.String }, { httpApiStatus: 400 }) {}

// A message that matched a search (Cmd+K): where it is and the words around the match.
export const SearchHit = Schema.Struct({ chatId: Id, messageId: Id, snippet: Schema.String, at: Schema.Number })
export type SearchHit = typeof SearchHit.Type

// An agent's own copy of the project in a chat (spec 016): a git worktree on its own branch.
export const AgentWorktree = Schema.Struct({ path: Schema.String, branch: Schema.String })
export type AgentWorktree = typeof AgentWorktree.Type

export const Chat = Schema.Struct({
  id: Id,
  projectId: Schema.NullOr(Id), // null: standalone chat
  agentIds: Schema.Array(Id), // members; the first is the leader (replies when no one is mentioned)
  title: Schema.String,
  parentId: Schema.NullOr(Id), // a task a teammate was given from another chat: it lives in that chat's drawer, not the list
  accountId: Schema.NullOr(Id), // the lead's account; null: default
  effort: Schema.NullOr(Effort), // the lead's reasoning effort; null: the model's default
  access: Schema.NullOr(Access), // this chat's level for every agent in it; null: each agent's own
  model: Schema.String, // leader's model for the next turn; other members use their own model
  summary: Schema.String, // summary of what left the window (consolidation)
  summaryUntil: Schema.Number, // `at` of the last message covered by the summary
  learnedUntil: Schema.Number, // `at` of the last message memories were learned from (≥ summaryUntil once a quiet chat learned)
  failover: Schema.NullOr(FailoverList), // null: the lead agent's list
  position: Schema.NullOr(Schema.Number), // manual order inside its group; null: by recent activity, above the placed ones
  worktree: Schema.NullOr(Schema.String), // the git worktree the chat works in (its own branch); null: the project folder
  agentWorktrees: Schema.Record(Schema.String, AgentWorktree), // agents working in a copy of their own (spec 016), by agent id
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
const AuditQuery = {
  kind: Schema.optionalKey(AuditKind),
  q: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(200))),
  from: Schema.optionalKey(Schema.NumberFromString),
  to: Schema.optionalKey(Schema.NumberFromString),
  page: Schema.optionalKey(Schema.NumberFromString)
}
export const AuditPage = Schema.Struct({ entries: Schema.Array(AuditEntry), total: Schema.Number, page: Schema.Number, pageSize: Schema.Number })
export type AuditPage = typeof AuditPage.Type

// Storage: Zorel's data folder measured now, where it goes and what can be freed.
const StorageCategory = Schema.Literals(["workspaces", "attachments", "history", "backups", "runs", "accounts", "browser", "other"])
const StorageCleanup = Schema.Literals(["backups", "orphans"])
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
const ContextPart = Schema.Literals(["instructions", "memories", "skills", "summary", "messages"])
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
const TerminalSession = Schema.Struct({ id: Schema.String, n: Schema.Number, label: Schema.NullOr(Schema.String), ended: Schema.Boolean, busy: Schema.Boolean })
// A script of the project's package.json; running it opens a Terminal tab (GET /api/terminals?run=name).
const ProjectScript = Schema.Struct({ name: Schema.String, command: Schema.String })
// A process listening on TCP ports whose working folder is the chat's (a dev server an agent or a shell started).
export const LocalServer = Schema.Struct({ pid: Schema.Number, command: Schema.String, ports: Schema.Array(Schema.Number) })
// Settings › Processes: what runs in the background now. servers: programs listening on a port inside a chat's
// folder (an agent's dev server), with the chat whose folder it is; terminals: shells still open; sessions: engine
// processes kept between turns (Claude Code, Codex); connections: MCP servers with a client open. A server lists
// every chat working in its folder (a project's folder is shared by its chats; a worktree is one chat's).
// cpu: percent of one core now (100 = a whole core); memory: bytes. A row counts its process and what it started.
// usage: Zorel as a whole (the app, the server and everything they started), split by part.
const Use = { cpu: Schema.Number, memory: Schema.Number }
const UsagePart = Schema.Literals(["app", "server", "agents", "terminals", "connections", "other"])
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
const OpenFile = Schema.Struct({ path: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1000)) })
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
const ProjectOrder = Schema.Struct({ ids: Schema.Array(Id) })
const ChatOrder = Schema.Struct({ projectId: Schema.NullOr(Id), ids: Schema.Array(Id) })

// `tool` is the native kind ("read", "edit", "run", "search", "tool"), an MCP tool name, or one of the two timing
// steps Zorel adds: "thought" (time spent reasoning, when the engine shows it) and "reply" (time writing the answer).
// Those two are for the reader only: they never reach the model or the runaway guard.
export const Step = Schema.Struct({
  tool: Schema.String,
  args: Schema.String, // abbreviated JSON; for a native step, the command or the files (what the transcript keeps)
  status: Schema.Literals(["ok", "error", "refused"]),
  result: Schema.String, // start of the result
  // Native steps only (reads, edits, commands): a short summary and what it stands for, as the live list showed them.
  // Absent on MCP steps and on messages saved before they existed: read a missing one as "".
  title: Schema.optional(Schema.String),
  detail: Schema.optional(Schema.String),
  ms: Schema.optional(Schema.Number), // how long it took; absent on MCP steps and on messages saved before it existed
  // Where in the reply's text it began (characters): the chat lays the reply out as text, steps, text… in that order.
  // Absent on Zorel's timing rows and on messages saved before it existed (their steps go above the text).
  at: Schema.optional(Schema.Number)
})
export type Step = typeof Step.Type
// The steps that did work: not Thought or Replied (counted and shown as work, they'd put a pill on every answer).
export const workSteps = <S extends Pick<Step, "tool">>(steps: ReadonlyArray<S>) => steps.filter((s) => s.tool !== "thought" && s.tool !== "reply")
// One run of an agent (a turn): the chat it was in (so its project), when, how it ended, its tokens and steps.
// messageId: its reply in the chat (null when it wrote none, e.g. stopped before any text).
export const AgentRun = Schema.Struct({
  turnId: Id,
  chatId: Id,
  messageId: Schema.NullOr(Id),
  state: Schema.Literals(["queued", "running", "completed", "failed", "interrupted"]),
  startedAt: Schema.NullOr(Schema.Number),
  endedAt: Schema.NullOr(Schema.Number),
  error: Schema.NullOr(Schema.String),
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  preview: Schema.String, // its reply's first words
  steps: Schema.Array(Step)
})
export type AgentRun = typeof AgentRun.Type

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
const MemoryScope = Schema.String.check(Schema.isPattern(/^(user|project:[\w-]+|agent:[\w-]+)$/))
const MemoryState = Schema.Literals(["pending", "active", "forgotten"])
const MemoryKind = Schema.Literals(["fact", "skill"])
export const Memory = Schema.Struct({
  id: Id,
  scope: Schema.String,
  kind: MemoryKind,
  title: Schema.String, // skills only
  text: Schema.String,
  state: MemoryState,
  origin: Schema.Literals(["auto", "manual"]),
  chatId: Schema.NullOr(Id),
  agentId: Schema.optionalKey(Schema.NullOr(Id)), // the agent that kept it; null or absent: learned from the chat
  replaces: Schema.optionalKey(Schema.NullOr(Id)), // a proposed improvement of this active skill
  reason: Schema.optionalKey(Schema.NullOr(Schema.String)), // why it was proposed
  essential: Schema.optionalKey(Schema.Boolean), // always in the prompt (the person marks it)
  // Skills only: the agents that see it (prompt, search, $handle, zorel_read_skill). Absent or empty: all of them.
  agents: Schema.optionalKey(Schema.Array(Id)),
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
  enabled: Schema.Boolean,
  agents: Schema.optionalKey(Schema.Array(Id)) // the agents that use it; absent or empty: all of them
})
export type FileSkill = typeof FileSkill.Type
// The memory's map in some scopes: its points (what facts are about; facts: how many living facts mention it,
// pending: how many of those wait for review) and its links (a relation a fact states, or two points one fact names).
export const MapPoint = Schema.Struct({ id: Id, scope: Schema.String, name: Schema.String, type: Schema.Literals(["project", "agent", "concept", "subject"]), weight: Schema.Number, facts: Schema.Number, pending: Schema.Number, memoryIds: Schema.Array(Id) })
export type MapPoint = typeof MapPoint.Type
// rel "": named together in a fact. bridge: a link the person made between two projects' maps.
const MapLink = Schema.Struct({ a: Id, b: Id, rel: Schema.String, bridge: Schema.optionalKey(Schema.Boolean) })
export const MemoryMap = Schema.Struct({ points: Schema.Array(MapPoint), links: Schema.Array(MapLink) })
export type MemoryMap = typeof MemoryMap.Type
const MemoryVersion = Schema.Struct({ id: Id, title: Schema.String, text: Schema.String, by: Schema.String, at: Schema.Number })

// A knowledge page (phase 3b): a longer Markdown note by scope (as memories). pinned: its title goes into every
// turn's context in that scope.
// file: its Markdown file inside the knowledge folder ("projects/zorel/Deploy.md"); null until written.
// The container engine for agents' own computers (spec 009): podman, docker, or null with what to do.
// One agent's computer now: off, getting its system (first time), starting, running, stopped, or unavailable (problem).
const ComputerState = Schema.Struct({ state: Schema.Literals(["off", "pulling", "starting", "running", "stopped", "unavailable"]), problem: Schema.NullOr(Schema.String) })
const ComputerStatus = Schema.Struct({ engine: Schema.NullOr(Schema.Literals(["podman", "docker"])), problem: Schema.NullOr(Schema.String) })
// agent-desktop on this computer (spec 008). accessibility: macOS's permission (granted, denied, unknown).
export const DesktopStatus = Schema.Struct({ supported: Schema.Boolean, installed: Schema.Boolean, version: Schema.String, accessibility: Schema.NullOr(Schema.String), suggestion: Schema.NullOr(Schema.String) })
export type DesktopStatus = typeof DesktopStatus.Type
// An agent CLI here (spec 014 follow-up): the version that runs, the latest its official source offers, and who keeps
// it up to date ("self": it updates itself; "zorel": Zorel can; "you": the person's own copy, Homebrew or npm).
const CliIdSchema = Schema.Literals(["claude", "codex", "antigravity", "opencode"])
export const CliState = Schema.Struct({ id: CliIdSchema, name: Schema.String, version: Schema.NullOr(Schema.String), latest: Schema.NullOr(Schema.String), keeper: Schema.Literals(["self", "zorel", "you"]), behind: Schema.Boolean, update: Schema.Boolean })
export type CliState = typeof CliState.Type
export class CliInstallFailed extends Schema.Error<CliInstallFailed>("zorel/CliInstallFailed")({ _tag: Schema.tag("CliInstallFailed"), message: Schema.String }, { httpApiStatus: 400 }) {}
// A team's handle (from its name) is taken by an agent or another team the same chats can see; or an agent's name
// would take a team's handle.
export class TeamHandleTaken extends Schema.Error<TeamHandleTaken>("zorel/TeamHandleTaken")({ _tag: Schema.tag("TeamHandleTaken"), message: Schema.String }, { httpApiStatus: 409 }) {}
// A member the team can't hold: outside its reach (a global team holds global agents only), or Zorel's own agent.
// Every chat has an agent (spec 015): a chat with none is refused, and the person's last agent can't be archived or deleted.
export class ChatNeedsAgentError extends Schema.Error<ChatNeedsAgentError>("zorel/ChatNeedsAgent")({ _tag: Schema.tag("ChatNeedsAgentError") }, { httpApiStatus: 400 }) {}
export class LastAgent extends Schema.Error<LastAgent>("zorel/LastAgent")({ _tag: Schema.tag("LastAgent") }, { httpApiStatus: 409 }) {}
export class TeamInvalid extends Schema.Error<TeamInvalid>("zorel/TeamInvalid")({ _tag: Schema.tag("TeamInvalid"), message: Schema.String }, { httpApiStatus: 400 }) {}
export class DesktopInstallFailed extends Schema.Error<DesktopInstallFailed>("zorel/DesktopInstallFailed")({ _tag: Schema.tag("DesktopInstallFailed"), message: Schema.String }, { httpApiStatus: 400 }) {}
// An app on this computer: its name, and where the desktop app draws its icon from (a bundle, a shortcut, an icon file).
export const InstalledApp = Schema.Struct({ name: Schema.String, path: Schema.NullOr(Schema.String) })
export type InstalledApp = typeof InstalledApp.Type
// Telegram channel: whether the bot token is set, how many accounts are paired, and the open pairing code.
// agentId: who answers Telegram now (the chosen agent, else the one used last); null with no agents.
const TelegramStatus = Schema.Struct({ tokenSet: Schema.Boolean, fromEnv: Schema.Boolean, users: Schema.Number, agentId: Schema.NullOr(Id), chosen: Schema.Boolean, pairing: Schema.NullOr(Schema.Struct({ code: Schema.String, until: Schema.Number })) })
export const Page = Schema.Struct({ id: Id, scope: MemoryScope, title: Schema.String, body: Schema.String, pinned: Schema.Boolean, file: Schema.optionalKey(Schema.NullOr(Schema.String)), updatedAt: Schema.Number, createdAt: Schema.Number })
export type Page = typeof Page.Type
const PageVersion = Schema.Struct({ id: Schema.String, n: Schema.Number, title: Schema.String, body: Schema.String, by: Schema.String, at: Schema.Number })
const PageTitle = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(120))
const PageBody = Schema.String.check(Schema.isMaxLength(100_000))
export const NewPage = Schema.Struct({ scope: MemoryScope, title: PageTitle, body: PageBody })
const PagePatch = Schema.Struct({ title: Schema.optional(PageTitle), body: Schema.optional(PageBody), pinned: Schema.optional(Schema.Boolean) })


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

// How a message names a teammate: "@handle". The one rule for the server (who is called) and the screen (who gets a
// chip). The "@" must not be glued to a letter, digit, "_", "." or "-", so an e-mail ("foo@tester.com") calls no one,
// while "(@tester)" and "—@tester" do. Capture 1 is the token. Read it with `matchAll` (which copies the regex), never
// `exec` or `test` on this shared object: the `g` flag keeps state between uses.
export const MENTION_RE = /(?<![\p{L}\p{N}_.-])@([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu

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
const ToolMode = Schema.Literals(["read", "approve", "auto"])
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
const TopTurn = Schema.Struct({
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

// ---------- inputs ----------

const FolderPath = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(1000))
const NewProject = Schema.Struct({ name: Name, brief: Text(8000), path: Schema.optional(Schema.NullOr(FolderPath)) })
const ProjectPatch = Schema.Struct({ name: Schema.optional(Name), brief: Schema.optional(Text(8000)), path: Schema.optional(Schema.NullOr(FolderPath)), agentIds: Schema.optional(Schema.Array(Id).check(Schema.isMaxLength(8))), teamIds: Schema.optional(Schema.Array(Id).check(Schema.isMaxLength(8))), sharedBrowser: Schema.optional(Schema.Boolean) })
const AgentTitle = Schema.String.check(Schema.isTrimmed(), Schema.isMaxLength(60))
const AgentDescription = Text(300)
const NewAgent = Schema.Struct({ projectId: Schema.NullOr(Id), name: Name, title: Schema.optional(AgentTitle), description: Schema.optional(AgentDescription), instructions: Text(8000), model: ModelId, accountId: Schema.optional(Schema.NullOr(Id)), effort: Schema.optional(Schema.NullOr(Effort)), failover: Schema.optional(FailoverList), access: Schema.optional(Access), permissions: Schema.optional(AgentPermissions), memory: Schema.optional(MemoryMode), knowledge: Schema.optional(KnowledgeAccess) , teamIds: Schema.optional(Schema.Array(Id).check(Schema.isMaxLength(50))) })
export const AgentPatch = Schema.Struct({ name: Schema.optional(Name), title: Schema.optional(AgentTitle), description: Schema.optional(AgentDescription), instructions: Schema.optional(Text(8000)), model: Schema.optional(ModelId), accountId: Schema.optional(Schema.NullOr(Id)), effort: Schema.optional(Schema.NullOr(Effort)), failover: Schema.optional(FailoverList), access: Schema.optional(Access), permissions: Schema.optional(AgentPermissions), archived: Schema.optional(Schema.Boolean), monthlyTokens: Schema.optional(TOKEN_LIMIT), replyTokens: Schema.optional(TOKEN_LIMIT), memory: Schema.optional(MemoryMode), knowledge: Schema.optional(KnowledgeAccess) , teamIds: Schema.optional(Schema.Array(Id).check(Schema.isMaxLength(50))) })
// Teams (spec 010): a named, ordered group of agents. Organisation only: adding a team to a chat copies its members
// (later changes to the team don't touch the chat); `@handle` routes to the member who fits (router.ts), the first
// when none clearly does. handle: from the name, as an agent's; unique with the agents' in reach.
export const TEAM_MAX = 20
export const AgentTeam = Schema.Struct({ id: Id, projectId: Schema.NullOr(Id), name: Schema.String, handle: Schema.String, agentIds: Schema.Array(Id), createdAt: Schema.Number, updatedAt: Schema.Number })
export type AgentTeam = typeof AgentTeam.Type
const TeamAgentIds = Schema.Array(Id).check(Schema.isMaxLength(TEAM_MAX))
const NewAgentTeam = Schema.Struct({ projectId: Schema.NullOr(Id), name: Name, agentIds: TeamAgentIds })
const AgentTeamPatch = Schema.Struct({ name: Schema.optional(Name), agentIds: Schema.optional(TeamAgentIds) }) // agentIds replaces the list
export const NewChat = Schema.Struct({ projectId: Schema.NullOr(Id), agentIds: Schema.Array(Id).check(Schema.isMaxLength(8)), model: ModelId, accountId: Schema.optional(Schema.NullOr(Id)), effort: Schema.optional(Schema.NullOr(Effort)), access: Schema.optional(Schema.NullOr(Access)) })
export const ChatPatch = Schema.Struct({ resumeAt: Schema.optional(Schema.Null), title: Schema.optional(Name), model: Schema.optional(ModelId), accountId: Schema.optional(Schema.NullOr(Id)), effort: Schema.optional(Schema.NullOr(Effort)), access: Schema.optional(Schema.NullOr(Access)), failover: Schema.optional(Schema.NullOr(FailoverList)), agentIds: Schema.optional(Schema.Array(Id).check(Schema.isMaxLength(8))) })
export const NewMemory = Schema.Struct({ scope: MemoryScope, kind: MemoryKind, title: Text(80), text: Short(4000), agents: Schema.optional(Schema.Array(Id).check(Schema.isMaxLength(50))) })
const MemoryPatch = Schema.Struct({ scope: Schema.optional(MemoryScope), state: Schema.optional(MemoryState), title: Schema.optional(Text(80)), text: Schema.optional(Short(4000)), essential: Schema.optional(Schema.Boolean), agents: Schema.optional(Schema.Array(Id).check(Schema.isMaxLength(50))) })
// stdio: environment variables; http: headers. Values go to the system keychain.
const McpEnv = Schema.Record(Schema.String.check(Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_-]*$/)), Text(4000))
const NewMcpServer = Schema.Struct({
  projectId: Schema.NullOr(Id),
  name: Name,
  command: Text(500),
  args: Schema.Array(Text(500)).check(Schema.isMaxLength(30)),
  url: Text(500),
  env: McpEnv,
  mode: ToolMode,
  auth: Schema.optional(Schema.Literals(["none", "oauth"]))
})
const McpServerPatch = Schema.Struct({ mode: Schema.optional(ToolMode), enabled: Schema.optional(Schema.Boolean), env: Schema.optional(McpEnv) }) // env: new secrets (e.g. a fresh token)
const KeyInput = Schema.Struct({ value: Text(500) }) // empty deletes
// One-time choices recorded on the server (the failover terms warning is shown once).
// nativeSkills: Claude Code and Codex may use their own skills (the person's ~/.claude/skills, plugins, Codex's).
// maxRunning: how many agents may be at work at once, across chats (the rest wait for a free slot); 0 = no limit.
// maxPerChat: how many of one chat's agents may work at once; 0 = no limit (the default).
export const MAX_RUNNING_DEFAULT = 4
export const MAX_RUNNING_CHOICES = [0, 1, 2, 3, 4, 6, 8, 12] as const
// memoryApproval: what a new fact learned from a chat becomes. "review" (the default): it waits for the person;
// "undo": it's kept at once, with a note in the chat and Undo. Corrections and skills always wait.
export const MemoryApproval = Schema.Literals(["review", "undo"])
export type MemoryApproval = typeof MemoryApproval.Type
// memoryModel: the model that learns from chats (summary, memories, the map); "": automatic, each chat's provider's
// small model (ZOREL_MEMORY_MODEL overrides the automatic one).
export const Preferences = Schema.Struct({ failoverTermsAcceptedAt: Schema.NullOr(Schema.Number), paused: Schema.Boolean, nativeSkills: Schema.Boolean, maxRunning: Schema.Number, maxPerChat: Schema.Number, memoryApproval: MemoryApproval, memoryModel: Schema.String, timeProfile: TimeProfile })

// Turns (send, events, interrupt, approve): see events.ts (RPC over WebSocket at /rpc).
const ApprovalDecision = Schema.Struct({ approve: Schema.Boolean })

// ---------- workspace (ARCHITECTURE §9.1) ----------

// A folder Zorel refuses: missing, not a folder, relative, or a place agents must never own (disk root,
// home, Zorel's data folder).
export class WorkspaceInvalid extends Schema.Error<WorkspaceInvalid>("zorel/WorkspaceInvalid")(
  { _tag: Schema.tag("WorkspaceInvalid"), reason: Schema.Literals(["relative", "missing", "not_directory", "forbidden"]) },
  { httpApiStatus: 400 }
) {}

// Picking a project's folder (the New project dialog): the subfolders of one folder, absolute paths, and which of
// them are git repositories. `~` and nothing both mean the home folder.
export const MAX_FOLDERS = 500
export const Folder = Schema.Struct({ name: Schema.String, path: Schema.String, git: Schema.Boolean })
export type Folder = typeof Folder.Type
export const FolderListing = Schema.Struct({
  dir: Schema.String, // the folder listed, absolute and real
  home: Schema.String, // shown as ~
  parent: Schema.NullOr(Schema.String),
  folders: Schema.Array(Folder)
})
export type FolderListing = typeof FolderListing.Type

export const FileDiff = Schema.Struct({
  path: Schema.String,
  status: Schema.Literals(["added", "modified", "deleted"]),
  added: Schema.Number,
  removed: Schema.Number,
  patch: Schema.String // unified diff of this file (empty for binary files)
})
export type FileDiff = typeof FileDiff.Type
const TurnDiff = Schema.Struct({ turnId: Id, files: Schema.Array(FileDiff), revertedAt: Schema.NullOr(Schema.Number) })
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
// What the chat's Run starts: a package.json script, or a command for any stack, in the project or a folder of it.
const PreviewRequest = Schema.Struct({ script: Schema.optional(Text(100)), command: Schema.optional(Text(1000)), folder: Schema.optional(Text(500)) })
// Why it didn't come up (the problem, or the server's last output).
export class PreviewFailed extends Schema.Error<PreviewFailed>("zorel/PreviewFailed")({ _tag: Schema.tag("PreviewFailed"), message: Schema.String }, { httpApiStatus: 400 }) {}
export class GitFailed extends Schema.Error<GitFailed>("zorel/GitFailed")({ _tag: Schema.tag("GitFailed"), message: Schema.String }, { httpApiStatus: 400 }) {}
const GitText = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(20_000))
const GitDraft = Schema.Struct({ title: Schema.String, body: Schema.String })
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
      .add(HttpApiEndpoint.get("folders", "/api/folders", { query: { dir: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(1024))) }, success: FolderListing, error: WorkspaceInvalid }))
      .add(HttpApiEndpoint.patch("update", "/api/projects/:id", { params: idParam, payload: ProjectPatch, success: Project, error: [HttpApiError.NotFound, WorkspaceInvalid] }))
      // Files of the workspace (up to MAX_WORKSPACE_FILES), marked with what changed since the project's first checkpoint in this chat.
      .add(HttpApiEndpoint.get("files", "/api/projects/:id/files", { params: idParam, query: { chatId: Schema.optionalKey(Id) }, success: Schema.Array(WorkspaceFile), error: HttpApiError.NotFound }))
      .add(HttpApiEndpoint.delete("remove", "/api/projects/:id", { params: idParam }))
      .add(HttpApiEndpoint.put("reorder", "/api/projects/order", { payload: ProjectOrder }))
  )
  .add(
    HttpApiGroup.make("agents")
      .add(HttpApiEndpoint.get("list", "/api/agents", { success: Schema.Array(Agent) }))
      .add(HttpApiEndpoint.post("create", "/api/agents", { payload: NewAgent, success: Agent, error: [HttpApiError.NotFound, TeamHandleTaken, TeamInvalid] }))
      .add(HttpApiEndpoint.patch("update", "/api/agents/:id", { params: idParam, payload: AgentPatch, success: Agent, error: [HttpApiError.NotFound, TeamHandleTaken, TeamInvalid, LastAgent] }))
      .add(HttpApiEndpoint.get("teams", "/api/teams", { success: Schema.Array(AgentTeam) }))
      .add(HttpApiEndpoint.post("createTeam", "/api/teams", { payload: NewAgentTeam, success: AgentTeam, error: [HttpApiError.NotFound, TeamHandleTaken, TeamInvalid] }))
      .add(HttpApiEndpoint.patch("updateTeam", "/api/teams/:id", { params: idParam, payload: AgentTeamPatch, success: AgentTeam, error: [HttpApiError.NotFound, TeamHandleTaken, TeamInvalid] }))
      .add(HttpApiEndpoint.delete("removeTeam", "/api/teams/:id", { params: idParam }))
      .add(HttpApiEndpoint.delete("remove", "/api/agents/:id", { params: idParam, error: LastAgent }))
      // A chat with the Builder (created the first time), in a project or General.
      .add(HttpApiEndpoint.post("builder", "/api/agents/builder", { payload: Schema.Struct({ projectId: Schema.NullOr(Id), model: ModelId }), success: Chat, error: HttpApiError.NotFound }))
      // Its sessions' runs, newest first: each time it worked, in which chat, how long, its steps and tokens.
      .add(HttpApiEndpoint.get("runs", "/api/agents/:id/runs", { params: idParam, success: Schema.Array(AgentRun), error: HttpApiError.NotFound }))
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
      .add(HttpApiEndpoint.post("create", "/api/routines", { payload: NewRoutine, success: Routine, error: [HttpApiError.NotFound, CronInvalid, RoutineInvalid] }))
      .add(HttpApiEndpoint.patch("update", "/api/routines/:id", { params: idParam, payload: RoutinePatch, success: Routine, error: [HttpApiError.NotFound, CronInvalid, RoutineInvalid] }))
      .add(HttpApiEndpoint.delete("remove", "/api/routines/:id", { params: idParam }))
      .add(HttpApiEndpoint.post("run", "/api/routines/:id/run", { params: idParam, error: HttpApiError.NotFound }))
      // A local script or service starts it; the JSON body (if any) goes into the message.
      .add(HttpApiEndpoint.post("hook", "/api/hooks/:token", { params: Schema.Struct({ token: Schema.String }), payload: Schema.optional(Schema.Unknown), error: [HttpApiError.NotFound, RoutineQueueFull] }))
      // Spec 012: a routine's history (newest first, 50 a page) and clearing it; the runs of a range (the week).
      .add(HttpApiEndpoint.get("history", "/api/routines/:id/runs", { params: idParam, query: { before: Schema.optionalKey(Schema.NumberFromString) }, success: Schema.Array(RoutineRun), error: HttpApiError.NotFound }))
      .add(HttpApiEndpoint.delete("clearHistory", "/api/routines/:id/runs", { params: idParam, error: HttpApiError.NotFound }))
      .add(HttpApiEndpoint.get("week", "/api/routine-runs", { query: { from: Schema.NumberFromString, to: Schema.NumberFromString }, success: RoutineWeek, error: HttpApiError.BadRequest }))
      .add(HttpApiEndpoint.get("today", "/api/today", { success: Today }))
      .add(HttpApiEndpoint.post("todayRead", "/api/today/read", { payload: Schema.Struct({ runIds: Schema.Array(Id).check(Schema.isMaxLength(100)) }) }))
      .add(HttpApiEndpoint.post("activity", "/api/activity"))
      // Spec 013: a routine's flow (synthesized for one saved before flows), saving a new version, an old version.
      .add(HttpApiEndpoint.get("flow", "/api/routines/:id/flow", { params: idParam, success: RoutineFlow, error: HttpApiError.NotFound }))
      .add(HttpApiEndpoint.put("saveFlow", "/api/routines/:id/flow", { params: idParam, payload: Schema.Struct({ graph: FlowGraph, baseVersion: Schema.NullOr(Schema.Number) }), success: Schema.Struct({ version: Schema.Number }), error: [HttpApiError.NotFound, FlowInvalid, FlowConflict] }))
      .add(HttpApiEndpoint.get("flowVersion", "/api/routines/:id/flow/versions/:n", { params: Schema.Struct({ id: Schema.String, n: Schema.NumberFromString }), success: RoutineFlow, error: HttpApiError.NotFound }))
      // Runs one tool step alone; a write tool is never called (dry: the arguments it would send).
      .add(HttpApiEndpoint.post("testStep", "/api/routines/:id/flow/test-step", { params: idParam, payload: Schema.Struct({ graph: FlowGraph, nodeId: Schema.String }), success: StepTest, error: [HttpApiError.NotFound, FlowInvalid] }))
      // Test now for a trigger: what it would find now (a watch's new items and what the check would let through, or a
      // schedule's next times). Nothing runs and nothing is marked seen.
      // The same for a routine not created yet (the New routine dialog): nothing is seen before, so a watch only learns.
      .add(HttpApiEndpoint.post("testNewTrigger", "/api/routines/test-trigger", { payload: Schema.Struct({ agentId: Id, prompt: Schema.String.check(Schema.isMaxLength(8000)), trigger: TriggerConfig }), success: TriggerTest, error: HttpApiError.NotFound }))
      .add(HttpApiEndpoint.post("testTrigger", "/api/routines/:id/flow/test-trigger", { params: idParam, payload: Schema.Struct({ graph: FlowGraph }), success: TriggerTest, error: [HttpApiError.NotFound, FlowInvalid] }))
      // A destination tested without sending: what it would post, with the last result as the text.
      .add(HttpApiEndpoint.post("testDelivery", "/api/routines/:id/delivery/test", { params: idParam, payload: ConnectorDestination, success: StepTest, error: [HttpApiError.NotFound, RoutineInvalid] }))
      .add(HttpApiEndpoint.get("runDetail", "/api/routines/:id/runs/:runId", { params: Schema.Struct({ id: Schema.String, runId: Schema.String }), success: RunDetail, error: HttpApiError.NotFound }))
      .add(HttpApiEndpoint.get("stepOutput", "/api/routines/:id/runs/:runId/steps/:stepId/output", { params: Schema.Struct({ id: Schema.String, runId: Schema.String, stepId: Schema.String }), success: Schema.Struct({ text: Schema.String }), error: HttpApiError.NotFound }))
      // Every write that may have gone out when Zorel stopped, across routines (Needs you lists them).
      .add(HttpApiEndpoint.get("uncertain", "/api/routine-steps/uncertain", { success: Schema.Array(Schema.Struct({ routineId: Id, runId: Id, stepId: Id, nodeId: Schema.String, at: Schema.Number })) }))
      // A write that may have gone out: send it again, skip it, or stop the run.
      .add(HttpApiEndpoint.post("resolveStep", "/api/routines/:id/runs/:runId/resolve", { params: Schema.Struct({ id: Schema.String, runId: Schema.String }), payload: Schema.Struct({ stepId: Id, choice: Schema.Literals(["again", "skip", "stop"]) }), error: [HttpApiError.NotFound, HttpApiError.BadRequest] }))
  )
  .add(
    HttpApiGroup.make("chats")
      .add(HttpApiEndpoint.get("list", "/api/chats", { success: Schema.Array(Chat) }))
      .add(HttpApiEndpoint.post("create", "/api/chats", { payload: NewChat, success: Chat, error: [HttpApiError.NotFound, ChatNeedsAgentError] }))
      .add(HttpApiEndpoint.patch("update", "/api/chats/:id", { params: idParam, payload: ChatPatch, success: Chat, error: [HttpApiError.NotFound, ChatNeedsAgentError] }))
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
      // An agent's own worktree in the chat (spec 016): merged into the chat's folder, or thrown away with its branch.
      .add(HttpApiEndpoint.post("mergeAgentWorktree", "/api/chats/:id/agents/:agentId/worktree/merge", { params: { id: Id, agentId: Id }, error: [HttpApiError.NotFound, GitFailed] }))
      .add(HttpApiEndpoint.delete("discardAgentWorktree", "/api/chats/:id/agents/:agentId/worktree", { params: { id: Id, agentId: Id }, error: [HttpApiError.NotFound, GitFailed] }))
      // "Edit from here": the conversation goes back to before this message of yours (it comes back as text to
      // edit); files: also undo what the later turns changed. Refused while a turn runs.
      .add(HttpApiEndpoint.post("rewind", "/api/chats/:id/rewind", { params: idParam, payload: Schema.Struct({ messageId: Id, files: Schema.Boolean }), success: Schema.Struct({ text: Schema.String }), error: [HttpApiError.NotFound, HttpApiError.Conflict, UndoConflict] }))
      .add(HttpApiEndpoint.get("search", "/api/search", { query: Schema.Struct({ q: Schema.String.check(Schema.isMinLength(2), Schema.isMaxLength(200)) }), success: Schema.Array(SearchHit) }))
      .add(HttpApiEndpoint.get("scripts", "/api/chats/:id/scripts", { params: idParam, success: Schema.Array(ProjectScript), error: HttpApiError.NotFound }))
      // Run: the person starts the project's server on a free port (a script, or a command with {port}); the URL to open.
      .add(HttpApiEndpoint.post("preview", "/api/chats/:id/preview", { params: idParam, payload: PreviewRequest, success: Schema.Struct({ url: Schema.String }), error: [HttpApiError.NotFound, PreviewFailed] }))
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
      .add(HttpApiEndpoint.get("map", "/api/memories/map", { query: Schema.Struct({ scope: Schema.optional(Schema.String) }), success: MemoryMap }))
      // A bridge between two maps ("related to"): recall in either crosses it, to that point and its own facts only.
      .add(HttpApiEndpoint.post("connect", "/api/memories/map/links", { payload: Schema.Struct({ a: Id, b: Id }), error: [HttpApiError.NotFound, HttpApiError.BadRequest] }))
      .add(HttpApiEndpoint.post("disconnect", "/api/memories/map/links/remove", { payload: Schema.Struct({ a: Id, b: Id }) }))
      .add(HttpApiEndpoint.post("create", "/api/memories", { payload: NewMemory, success: Memory, error: HttpApiError.BadRequest }))
      .add(HttpApiEndpoint.patch("update", "/api/memories/:id", { params: idParam, payload: MemoryPatch, success: Memory, error: [HttpApiError.NotFound, HttpApiError.BadRequest, HttpApiError.Conflict] }))
      // Delete for good: only a forgotten one (the record that kept it from being learned again goes too).
      .add(HttpApiEndpoint.delete("remove", "/api/memories/:id", { params: idParam, error: [HttpApiError.NotFound, HttpApiError.Conflict] }))
      .add(HttpApiEndpoint.get("versions", "/api/memories/:id/versions", { params: idParam, success: Schema.Array(MemoryVersion), error: HttpApiError.NotFound }))
      .add(HttpApiEndpoint.post("restore", "/api/memories/:id/restore", { params: idParam, payload: Schema.Struct({ versionId: Id }), success: Memory, error: [HttpApiError.NotFound, HttpApiError.Conflict] }))
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
      // Spec 013: a connector's tools for the step picker, with each one's state for this agent; and the items a read
      // tool lists, to pick an id by name.
      .add(HttpApiEndpoint.get("catalog", "/api/mcp/:id/catalog", { params: idParam, query: { agentId: Schema.String }, success: Schema.Struct({ tools: Schema.Array(CatalogTool), error: Schema.NullOr(Schema.String) }), error: HttpApiError.NotFound }))
      .add(HttpApiEndpoint.post("options", "/api/mcp/:id/options", { params: idParam, payload: Schema.Struct({ tool: Schema.String, args: Schema.Record(Schema.String, Schema.Unknown) }), success: Schema.Array(Schema.Struct({ id: Schema.String, label: Schema.String })), error: [HttpApiError.NotFound, HttpApiError.BadRequest] }))
  )
  .add(
    HttpApiGroup.make("accounts")
      .add(HttpApiEndpoint.get("list", "/api/accounts", { success: Schema.Array(ProviderAccount) }))
      .add(HttpApiEndpoint.post("create", "/api/accounts", { payload: NewAccount, success: ProviderAccount }))
      .add(HttpApiEndpoint.patch("update", "/api/accounts/:id", { params: idParam, payload: AccountPatch, success: ProviderAccount, error: HttpApiError.NotFound }))
      // Default accounts can't be removed; removing logs out and deletes the account's folder.
      .add(HttpApiEndpoint.delete("remove", "/api/accounts/:id", { params: idParam, error: [HttpApiError.NotFound, HttpApiError.Conflict] }))
      .add(HttpApiEndpoint.post("login", "/api/accounts/:id/login", { params: idParam, success: LoginStarted, error: [HttpApiError.NotFound, HttpApiError.Conflict] }))
      // On a server: the code the provider's page showed, typed into the waiting CLI.
      .add(HttpApiEndpoint.post("loginCode", "/api/accounts/:id/login/code", { params: idParam, payload: Schema.Struct({ code: Schema.String.check(Schema.isMaxLength(2000)) }), error: HttpApiError.NotFound }))
      // Reads the account's limit windows now (cached for 4 min, unless `fresh`; failures back off up to 1 h).
      .add(HttpApiEndpoint.post("limits", "/api/accounts/:id/limits", { params: idParam, query: { fresh: Schema.optionalKey(Schema.Literals(["1"])) }, success: ProviderAccount, error: HttpApiError.NotFound }))
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
      .add(HttpApiEndpoint.patch("pickFileSkill", "/api/skills/files", { payload: Schema.Struct({ path: Schema.String.check(Schema.isMaxLength(2000)), enabled: Schema.Boolean, agents: Schema.optional(Schema.Array(Id).check(Schema.isMaxLength(50))) }), success: Schema.Array(FileSkill), error: [HttpApiError.NotFound, HttpApiError.BadRequest] }))
      // Pause everything: running turns stop, new ones wait queued, routines wait; false resumes.
      .add(HttpApiEndpoint.put("pause", "/api/pause", { payload: Schema.Struct({ paused: Schema.Boolean }) }))
      .add(HttpApiEndpoint.put("nativeSkills", "/api/preferences/native-skills", { payload: Schema.Struct({ enabled: Schema.Boolean }), success: Preferences }))
      .add(HttpApiEndpoint.put("memoryApproval", "/api/preferences/memory-approval", { payload: Schema.Struct({ approval: MemoryApproval }), success: Preferences }))
      .add(HttpApiEndpoint.put("timeProfile", "/api/preferences/time", { payload: TimeProfileInput, success: Preferences, error: HttpApiError.BadRequest }))
      .add(HttpApiEndpoint.put("memoryModel", "/api/preferences/memory-model", { payload: Schema.Struct({ model: Schema.Union([ModelId, Schema.Literal("")]) }), success: Preferences }))
      .add(HttpApiEndpoint.put("maxRunning", "/api/preferences/max-running", { payload: Schema.Struct({ value: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 32 })) }), success: Preferences }))
      // How many of one chat's agents may work at once; 0 = no limit.
      .add(HttpApiEndpoint.put("maxPerChat", "/api/preferences/max-per-chat", { payload: Schema.Struct({ value: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 8 })) }), success: Preferences }))
      .add(HttpApiEndpoint.post("acceptFailoverTerms", "/api/preferences/failover-terms", { success: Preferences }))
      .add(HttpApiEndpoint.put("setKey", "/api/keys/:name", { params: { name: Schema.String }, payload: KeyInput, error: HttpApiError.NotFound }))
      // An agent's own computer (spec 009): the container engine found, and erasing an agent's computers.
      .add(HttpApiEndpoint.get("computer", "/api/computer", { success: ComputerStatus }))
      .add(HttpApiEndpoint.post("eraseComputer", "/api/computer/erase/:id", { params: idParam }))
      // An agent's computer from its page: what it's doing now, start it, restart it, open its own folder here.
      .add(HttpApiEndpoint.get("computerState", "/api/computer/:id/state", { params: idParam, success: ComputerState, error: HttpApiError.NotFound }))
      .add(HttpApiEndpoint.post("computerStart", "/api/computer/:id/start", { params: idParam, success: ComputerState, error: HttpApiError.NotFound }))
      .add(HttpApiEndpoint.post("computerRestart", "/api/computer/:id/restart", { params: idParam, success: ComputerState, error: HttpApiError.NotFound }))
      .add(HttpApiEndpoint.post("computerOpen", "/api/computer/:id/open", { params: idParam, error: HttpApiError.NotFound }))
      // Computer apps (spec 008): agent-desktop's state, its in-app install, the macOS permission guide, open apps.
      .add(HttpApiEndpoint.get("desktop", "/api/desktop", { success: DesktopStatus }))
      .add(HttpApiEndpoint.post("installDesktop", "/api/desktop/install", { success: DesktopStatus, error: DesktopInstallFailed }))
      // An agent CLI with a single-program build (Antigravity, OpenCode): downloaded from its official source and checked.
      .add(HttpApiEndpoint.post("installCli", "/api/cli/:id/install", { params: { id: CliIdSchema }, error: CliInstallFailed }))
      // The CLIs' versions against the latest (read at most every few hours; `fresh` reads the sources now).
      .add(HttpApiEndpoint.get("cliStatus", "/api/cli", { query: { fresh: Schema.optionalKey(Schema.Literals(["1"])) }, success: Schema.Array(CliState) }))
      .add(HttpApiEndpoint.post("desktopGuide", "/api/desktop/guide"))
      .add(HttpApiEndpoint.get("desktopRunning", "/api/desktop/running", { success: Schema.Array(Schema.String) }))
      // The apps installed on this computer (names), for picking which an agent may use.
      .add(HttpApiEndpoint.get("installedApps", "/api/desktop/apps", { success: Schema.Array(InstalledApp) }))
      // Telegram channel (spec 007): the bot token goes through setKey (TELEGRAM_BOT_TOKEN); pairing here.
      .add(HttpApiEndpoint.get("telegram", "/api/channels/telegram", { success: TelegramStatus }))
      .add(HttpApiEndpoint.post("telegramPair", "/api/channels/telegram/pair", { success: TelegramStatus }))
      .add(HttpApiEndpoint.delete("telegramUnpair", "/api/channels/telegram/users", { success: TelegramStatus }))
      .add(HttpApiEndpoint.put("telegramAgent", "/api/channels/telegram/agent", { payload: Schema.Struct({ agentId: Id }), success: TelegramStatus, error: HttpApiError.NotFound }))
  )
