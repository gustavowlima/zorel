// Turn contract: what the engine emits and what the UI draws (ARCHITECTURE §4 and §5).
// The screen prototype is the spec: timed steps, pending/decided approval,
// handoff between agents, model switch, learning, receipt and status of each chat.
import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { FileChange, MAX_ATTACHMENTS, Message, ModelId, Switch } from "./index.ts"

export { FileChange }

const Id = Schema.String
const Millis = Schema.Number // epoch or duration in ms

// ---------- turn ----------

// Server errors as codes: the UI translates (i18n, UI phase). Engine errors stay free text.
export const ErrorCode = {
  interrupted: "interrupted", // you stopped
  cancelled: "cancelled", // was queued when you stopped
  serverRestarted: "server_restarted", // the server went down midway; the partial was saved
  chatRemoved: "chat_removed"
} as const
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]
// Old messages stored "interrompido" as text.
export const isInterruption = (error: string | null) =>
  !!error && (error === ErrorCode.interrupted || error === ErrorCode.cancelled || error === ErrorCode.serverRestarted || error.startsWith("interrompido"))

export const TurnState = Schema.Literals(["queued", "running", "completed", "failed", "interrupted"])
export type TurnState = typeof TurnState.Type

export const Usage = Schema.Struct({
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  cachedTokens: Schema.Number
})
export type Usage = typeof Usage.Type

export const Turn = Schema.Struct({
  id: Id,
  chatId: Id,
  agentId: Schema.NullOr(Id),
  model: Schema.String,
  accountId: Schema.NullOr(Id), // provider account used (multi-account, D14)
  clientId: Schema.NullOr(Id), // `send` idempotency; chained turns have none
  state: TurnState,
  startedAt: Schema.NullOr(Millis),
  endedAt: Schema.NullOr(Millis),
  firstTokenAt: Schema.NullOr(Millis), // latency to first text
  error: Schema.NullOr(Schema.String), // ErrorCode or the engine message
  usage: Usage
})
export type Turn = typeof Turn.Type

// ---------- steps (the activity pill and the expanded detail) ----------

export const StepKind = Schema.Literals(["read", "edit", "run", "search", "tool", "delegate"])
export type StepKind = typeof StepKind.Type


export const WorkStep = Schema.Struct({
  id: Id,
  turnId: Id,
  kind: StepKind,
  title: Schema.String, // short and readable: "Read context.ts", "Run bun test apps/server"
  tool: Schema.NullOr(Schema.String), // MCP or native tool name
  files: Schema.Array(Schema.String),
  status: Schema.Literals(["running", "waiting", "ok", "error", "refused"]), // waiting: approval pending
  startedAt: Millis,
  durationMs: Schema.NullOr(Schema.Number),
  changes: Schema.Array(FileChange), // edits made in this step; the full patch comes from Workspace (phase 3)
  output: Schema.String // start of the result, truncated
})
export type WorkStep = typeof WorkStep.Type

// ---------- approvals (ARCHITECTURE §9.2) ----------

export const ApprovalKind = Schema.Literals(["command", "edit", "tool", "network", "question"]) // question: zorel_ask_user (summary: the question; args: {"options": [...]})
export const Approval = Schema.Struct({
  id: Id,
  chatId: Id,
  turnId: Id,
  stepId: Schema.NullOr(Id),
  agentId: Schema.NullOr(Id),
  kind: ApprovalKind,
  tool: Schema.String,
  summary: Schema.String, // "Run bun test apps/server in the project folder"
  args: Schema.String, // JSON with masked secrets
  cwd: Schema.NullOr(Schema.String),
  alwaysKey: Schema.NullOr(Schema.String), // set when "Always allow" applies: the rule it saves on the agent
  createdAt: Millis,
  expiresAt: Millis
})
export type Approval = typeof Approval.Type

export const ApprovalOutcome = Schema.Literals(["approved", "always", "denied", "expired"])
export type ApprovalOutcome = typeof ApprovalOutcome.Type

// ---------- status of each chat (sidebar) ----------

export const ChatStatus = Schema.Struct({
  chatId: Id,
  state: Schema.Literals(["idle", "running", "waiting", "failed"]), // waiting: needs you
  agentId: Schema.NullOr(Id),
  label: Schema.String, // "Architect is writing migrations", "Coder waits for your OK"
  unread: Schema.Boolean,
  updatedAt: Millis
})
export type ChatStatus = typeof ChatStatus.Type

// ---------- turn context (the "18k context" and the inspector) ----------

export const ContextLayer = Schema.Struct({ id: Schema.String, label: Schema.String, tokens: Schema.Number })
export const ContextUsage = Schema.Struct({ layers: Schema.Array(ContextLayer), total: Schema.Number, limit: Schema.Number })
export type ContextUsage = typeof ContextUsage.Type

// ---------- chat events ----------

export const ChatSnapshot = Schema.Struct({
  messages: Schema.Array(Message), // since the summary
  turns: Schema.Array(Turn), // in progress and queued
  partial: Schema.Array(Schema.Struct({ turnId: Id, text: Schema.String })), // text so far of the running ones
  steps: Schema.Array(WorkStep), // of the turns in progress
  approvals: Schema.Array(Approval), // open
  status: ChatStatus
})
export type ChatSnapshot = typeof ChatSnapshot.Type

export const ChatEvent = Schema.TaggedUnion({
  snapshot: { snapshot: ChatSnapshot }, // always first; reconnect = subscribe again
  message: { message: Message }, // your new message (the agent's arrives in turn-completed)
  queued: { turn: Turn },
  "turn-started": { turn: Turn },
  text: { turnId: Id, delta: Schema.String }, // batched every 100 ms or 8 KiB
  reasoning: { turnId: Id, delta: Schema.String },
  "step-started": { step: WorkStep },
  "step-finished": { step: WorkStep },
  approval: { approval: Approval },
  "approval-resolved": { approvalId: Id, outcome: ApprovalOutcome, reason: Schema.NullOr(Schema.String), by: Schema.Literals(["user", "rule", "expiry"]) },
  handoff: { turnId: Id, from: Schema.NullOr(Id), to: Schema.Array(Id), via: Schema.Literals(["mention", "send_message", "start_task", "reply", "limit"]) }, // reply: back to the agent that handed the work over; limit: the chain stopped
  failover: { turnId: Id, switch: Switch }, // the turn moves to the next alternative; its partial text is dropped
  "model-switched": { turnId: Id, from: Schema.String, to: Schema.String, resentTokens: Schema.Number, fromCheckpoint: Schema.Boolean },
  learned: { pageIds: Schema.Array(Id), summary: Schema.String },
  "context-usage": { turnId: Id, usage: ContextUsage },
  "turn-completed": { turn: Turn, message: Message },
  "turn-failed": { turn: Turn, message: Schema.NullOr(Message) },
  interrupted: { turn: Turn, message: Schema.NullOr(Message) }, // partial text preserved
  status: { status: ChatStatus }
})
export type ChatEvent = typeof ChatEvent.Type

// ---------- RPC over WebSocket at /rpc ----------

export class ChatNotFound extends Schema.TaggedError<ChatNotFound>()("ChatNotFound", { chatId: Id }) {}
export class ApprovalNotFound extends Schema.TaggedError<ApprovalNotFound>()("ApprovalNotFound", { approvalId: Id }) {} // already decided or expired

export const SendPayload = {
  chatId: Id,
  clientId: Schema.String.check(Schema.isMinLength(8), Schema.isMaxLength(64)),
  text: Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(100_000)),
  model: Schema.optional(ModelId),
  attachmentIds: Schema.optional(Schema.Array(Schema.String).check(Schema.isMaxLength(MAX_ATTACHMENTS))) // uploaded first (POST /api/chats/:id/attachments)
}

export const ZorelRpc = RpcGroup.make(
  Rpc.make("send", { payload: SendPayload, success: Schema.Struct({ turnId: Id }), error: ChatNotFound }),
  Rpc.make("steer", {
    payload: { chatId: Id, text: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100_000)), attachmentIds: Schema.optional(Schema.Array(Schema.String).check(Schema.isMaxLength(MAX_ATTACHMENTS))) },
    error: ChatNotFound
  }),
  Rpc.make("interrupt", { payload: { chatId: Id } }),
  Rpc.make("decide", { payload: { approvalId: Id, outcome: Schema.Literals(["approved", "always", "denied"]), reason: Schema.optional(Schema.String.check(Schema.isMaxLength(2000))) }, error: ApprovalNotFound }),
  Rpc.make("subscribeChat", { payload: { chatId: Id }, success: ChatEvent, error: ChatNotFound, stream: true }),
  Rpc.make("subscribeStatus", { success: ChatStatus, stream: true }), // all chats: sidebar and "Needs you"
  Rpc.make("approvals", { success: Schema.Array(Approval) }), // open approvals of every chat ("Needs you")
  Rpc.make("runs", { payload: { chatId: Id }, success: Schema.Array(WorkStep) }) // commands the agents ran in this chat (terminal panel)
)
