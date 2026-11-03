// Contrato dos turnos: o que a engine emite e o que a interface desenha (ARCHITECTURE §4 e §5).
// O protótipo das telas é a especificação: passos com tempo, aprovação pendente/decidida,
// passagem entre agentes, troca de modelo, aprendizado, recibo e status de cada chat.
import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { Message, ModelId } from "./index.ts"

const Id = Schema.String
const Millis = Schema.Number // epoch ou duração em ms

// ---------- turno ----------

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
  accountId: Schema.NullOr(Id), // conta do provider usada (multicontas, D14)
  clientId: Schema.NullOr(Id), // idempotência do `send`; turnos encadeados não têm
  state: TurnState,
  startedAt: Schema.NullOr(Millis),
  endedAt: Schema.NullOr(Millis),
  error: Schema.NullOr(Schema.String),
  usage: Usage
})
export type Turn = typeof Turn.Type

// ---------- passos (a pílula de atividade e o detalhe expandido) ----------

export const StepKind = Schema.Literals(["read", "edit", "run", "search", "tool", "delegate"])
export type StepKind = typeof StepKind.Type

export const FileChange = Schema.Struct({
  path: Schema.String, // relativo à pasta do projeto
  added: Schema.Number,
  removed: Schema.Number,
  status: Schema.Literals(["added", "modified", "deleted"])
})
export type FileChange = typeof FileChange.Type

export const WorkStep = Schema.Struct({
  id: Id,
  turnId: Id,
  kind: StepKind,
  title: Schema.String, // curto e legível: "Read context.ts", "Run bun test apps/server"
  tool: Schema.NullOr(Schema.String), // nome da ferramenta MCP ou nativa
  files: Schema.Array(Schema.String),
  status: Schema.Literals(["running", "waiting", "ok", "error", "refused"]), // waiting: aprovação pendente
  startedAt: Millis,
  durationMs: Schema.NullOr(Schema.Number),
  changes: Schema.Array(FileChange), // edições feitas neste passo; o patch completo vem do Workspace (fase 3)
  output: Schema.String // começo do resultado, truncado
})
export type WorkStep = typeof WorkStep.Type

// ---------- aprovações (ARCHITECTURE §9.2) ----------

export const ApprovalKind = Schema.Literals(["command", "edit", "tool", "network"])
export const Approval = Schema.Struct({
  id: Id,
  chatId: Id,
  turnId: Id,
  stepId: Schema.NullOr(Id),
  agentId: Schema.NullOr(Id),
  kind: ApprovalKind,
  tool: Schema.String,
  summary: Schema.String, // "Run bun test apps/server in the project folder"
  args: Schema.String, // JSON com segredos mascarados
  cwd: Schema.NullOr(Schema.String),
  createdAt: Millis,
  expiresAt: Millis
})
export type Approval = typeof Approval.Type

export const ApprovalOutcome = Schema.Literals(["approved", "always", "denied", "expired"])
export type ApprovalOutcome = typeof ApprovalOutcome.Type

// ---------- status de cada chat (barra lateral) ----------

export const ChatStatus = Schema.Struct({
  chatId: Id,
  state: Schema.Literals(["idle", "running", "waiting", "failed"]), // waiting: precisa de você
  agentId: Schema.NullOr(Id),
  label: Schema.String, // "Architect is writing migrations", "Coder waits for your OK"
  unread: Schema.Boolean,
  updatedAt: Millis
})
export type ChatStatus = typeof ChatStatus.Type

// ---------- contexto do turno (o "18k context" e o inspetor) ----------

export const ContextLayer = Schema.Struct({ id: Schema.String, label: Schema.String, tokens: Schema.Number })
export const ContextUsage = Schema.Struct({ layers: Schema.Array(ContextLayer), total: Schema.Number, limit: Schema.Number })
export type ContextUsage = typeof ContextUsage.Type

// ---------- eventos de um chat ----------

export const ChatSnapshot = Schema.Struct({
  messages: Schema.Array(Message), // desde o resumo
  turns: Schema.Array(Turn), // em andamento e na fila
  partial: Schema.Array(Schema.Struct({ turnId: Id, text: Schema.String })), // texto até agora dos que estão rodando
  steps: Schema.Array(WorkStep), // dos turnos em andamento
  approvals: Schema.Array(Approval), // abertas
  status: ChatStatus
})
export type ChatSnapshot = typeof ChatSnapshot.Type

export const ChatEvent = Schema.TaggedUnion({
  snapshot: { snapshot: ChatSnapshot }, // sempre o primeiro; reconectar = assinar de novo
  message: { message: Message }, // mensagem nova sua (a do agente chega no turn-completed)
  queued: { turn: Turn },
  "turn-started": { turn: Turn },
  text: { turnId: Id, delta: Schema.String }, // agrupado a cada 100 ms ou 8 KiB
  reasoning: { turnId: Id, delta: Schema.String },
  "step-started": { step: WorkStep },
  "step-finished": { step: WorkStep },
  approval: { approval: Approval },
  "approval-resolved": { approvalId: Id, outcome: ApprovalOutcome, reason: Schema.NullOr(Schema.String), by: Schema.Literals(["user", "rule", "expiry"]) },
  handoff: { turnId: Id, from: Schema.NullOr(Id), to: Schema.Array(Id), via: Schema.Literals(["mention", "send_message", "start_task"]) },
  "model-switched": { turnId: Id, from: Schema.String, to: Schema.String, resentTokens: Schema.Number, fromCheckpoint: Schema.Boolean },
  learned: { pageIds: Schema.Array(Id), summary: Schema.String },
  "context-usage": { turnId: Id, usage: ContextUsage },
  "turn-completed": { turn: Turn, message: Message },
  "turn-failed": { turn: Turn, message: Schema.NullOr(Message) },
  interrupted: { turn: Turn, message: Schema.NullOr(Message) }, // texto parcial preservado
  status: { status: ChatStatus }
})
export type ChatEvent = typeof ChatEvent.Type

// ---------- RPC sobre WebSocket em /rpc ----------

export class ChatNotFound extends Schema.TaggedError<ChatNotFound>()("ChatNotFound", { chatId: Id }) {}
export class ApprovalNotFound extends Schema.TaggedError<ApprovalNotFound>()("ApprovalNotFound", { approvalId: Id }) {} // já decidida ou expirada

export const SendPayload = {
  chatId: Id,
  clientId: Schema.String.check(Schema.isMinLength(8), Schema.isMaxLength(64)),
  text: Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(100_000)),
  model: Schema.optional(ModelId)
}

export const ZeroRpc = RpcGroup.make(
  Rpc.make("send", { payload: SendPayload, success: Schema.Struct({ turnId: Id }), error: ChatNotFound }),
  Rpc.make("steer", { payload: { chatId: Id, text: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100_000)) }, error: ChatNotFound }),
  Rpc.make("interrupt", { payload: { chatId: Id } }),
  Rpc.make("decide", { payload: { approvalId: Id, outcome: Schema.Literals(["approved", "always", "denied"]), reason: Schema.optional(Schema.String.check(Schema.isMaxLength(2000))) }, error: ApprovalNotFound }),
  Rpc.make("subscribeChat", { payload: { chatId: Id }, success: ChatEvent, error: ChatNotFound, stream: true }),
  Rpc.make("subscribeStatus", { success: ChatStatus, stream: true }) // todos os chats: barra lateral e "Precisa de você"
)
