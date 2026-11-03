// Contrato único entre server e clientes: tudo que cruza a rede é tipado aqui.
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup } from "effect/http-api"

const Id = Schema.String
const Name = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(80))
const LongText = (max: number) => Schema.String.check(Schema.isMaxLength(max))
const Short = (max: number) => Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(max))
// "<provider>/<modelo>", ex.: "claude-cli/sonnet", "anthropic/claude-sonnet-5-5", "ollama/llama3.3"
export const ModelId = Schema.String.check(Schema.isPattern(/^[a-z-]+\/\S+$/), Schema.isMaxLength(200))

// ---------- entidades ----------

export const Project = Schema.Struct({
  id: Id,
  name: Schema.String,
  brief: Schema.String, // contexto estável do projeto, entra no prompt de todo turno
  createdAt: Schema.Number
})
export type Project = typeof Project.Type

export const Agent = Schema.Struct({
  id: Id,
  projectId: Schema.NullOr(Id), // null: agente global
  name: Schema.String,
  instructions: Schema.String,
  model: Schema.String,
  createdAt: Schema.Number
})
export type Agent = typeof Agent.Type

export const Chat = Schema.Struct({
  id: Id,
  projectId: Schema.NullOr(Id), // null: chat avulso
  agentIds: Schema.Array(Id), // membros; o primeiro é o líder (responde quando ninguém é mencionado)
  title: Schema.String,
  model: Schema.String, // modelo do líder no próximo turno; os outros membros usam o modelo deles
  summary: Schema.String, // resumo do que saiu da janela (consolidação)
  summaryUntil: Schema.Number, // `at` da última mensagem coberta pelo resumo
  createdAt: Schema.Number
})
export type Chat = typeof Chat.Type

export const Step = Schema.Struct({
  tool: Schema.String,
  args: Schema.String, // JSON resumido
  status: Schema.Literals(["ok", "error", "refused"]),
  result: Schema.String // início do resultado
})
export type Step = typeof Step.Type

export const Message = Schema.Struct({
  id: Id,
  chatId: Id,
  role: Schema.Literals(["user", "assistant"]),
  agentId: Schema.NullOr(Id), // qual agente respondeu (assistant)
  text: Schema.String,
  model: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
  steps: Schema.Array(Step), // ferramentas usadas no turno
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  at: Schema.Number
})
export type Message = typeof Message.Type

// Escopos: "user" (vale em tudo), "project:<id>", "agent:<id>".
// kind "fact": uma frase durável. kind "skill": um procedimento (título + passo a passo) reaproveitável.
export const MemoryScope = Schema.String.check(Schema.isPattern(/^(user|project:[\w-]+|agent:[\w-]+)$/))
export const MemoryState = Schema.Literals(["pending", "active", "forgotten"])
export const MemoryKind = Schema.Literals(["fact", "skill"])
export const Memory = Schema.Struct({
  id: Id,
  scope: Schema.String,
  kind: MemoryKind,
  title: Schema.String, // só skills
  text: Schema.String,
  state: MemoryState,
  origin: Schema.Literals(["auto", "manual"]),
  chatId: Schema.NullOr(Id),
  createdAt: Schema.Number,
  confirmedAt: Schema.Number
})
export type Memory = typeof Memory.Type

export const ModelInfo = Schema.Struct({
  id: Schema.String,
  provider: Schema.String,
  kind: Schema.Literals(["subscription", "api"]),
  available: Schema.Boolean,
  hint: Schema.String
})
export type ModelInfo = typeof ModelInfo.Type

// Ferramentas: servidores MCP. mode "read": só ferramentas de leitura; "approve": todas, e as que
// escrevem esperam aprovação; "auto": todas sem perguntar (confiança explícita).
export const ToolMode = Schema.Literals(["read", "approve", "auto"])
export const McpServer = Schema.Struct({
  id: Id,
  projectId: Schema.NullOr(Id), // null: disponível em todos os chats
  name: Schema.String,
  command: Schema.String, // stdio: comando; vazio quando é http
  args: Schema.Array(Schema.String),
  url: Schema.String, // http: endereço; vazio quando é stdio
  envKeys: Schema.Array(Schema.String), // nomes das variáveis; os valores ficam no chaveiro do sistema
  mode: ToolMode,
  enabled: Schema.Boolean,
  createdAt: Schema.Number
})
export type McpServer = typeof McpServer.Type

export const ToolInfo = Schema.Struct({ name: Schema.String, description: Schema.String, cls: Schema.Literals(["read", "write", "sensitive"]) })
export type ToolInfo = typeof ToolInfo.Type

export const KeyInfo = Schema.Struct({ name: Schema.String, set: Schema.Boolean, fromEnv: Schema.Boolean })

// ---------- entradas ----------

export const NewProject = Schema.Struct({ name: Name, brief: LongText(8000) })
export const ProjectPatch = Schema.Struct({ name: Schema.optional(Name), brief: Schema.optional(LongText(8000)) })
export const NewAgent = Schema.Struct({ projectId: Schema.NullOr(Id), name: Name, instructions: LongText(8000), model: ModelId })
export const AgentPatch = Schema.Struct({ name: Schema.optional(Name), instructions: Schema.optional(LongText(8000)), model: Schema.optional(ModelId) })
export const NewChat = Schema.Struct({ projectId: Schema.NullOr(Id), agentIds: Schema.Array(Id).check(Schema.isMaxLength(8)), model: ModelId })
export const ChatPatch = Schema.Struct({ title: Schema.optional(Name), model: Schema.optional(ModelId), agentIds: Schema.optional(Schema.Array(Id).check(Schema.isMaxLength(8))) })
export const NewMemory = Schema.Struct({ scope: MemoryScope, kind: MemoryKind, title: LongText(80), text: Short(4000) })
export const MemoryPatch = Schema.Struct({ state: Schema.optional(MemoryState), title: Schema.optional(LongText(80)), text: Schema.optional(Short(4000)) })
export const NewMcpServer = Schema.Struct({
  projectId: Schema.NullOr(Id),
  name: Name,
  command: LongText(500),
  args: Schema.Array(LongText(500)).check(Schema.isMaxLength(30)),
  url: LongText(500),
  env: Schema.Record(Schema.String.check(Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_-]*$/)), LongText(4000)), // stdio: variáveis de ambiente; http: cabeçalhos
  mode: ToolMode
})
export const McpServerPatch = Schema.Struct({ mode: Schema.optional(ToolMode), enabled: Schema.optional(Schema.Boolean) })
export const KeyInput = Schema.Struct({ value: LongText(500) }) // vazio apaga

// Turnos (envio, eventos, interromper, aprovar): ver events.ts (RPC sobre WebSocket em /rpc).
export const ApprovalDecision = Schema.Struct({ approve: Schema.Boolean })

// ---------- API ----------

const idParam = { id: Id }

export const Api = HttpApi.make("zero")
  .add(
    HttpApiGroup.make("projects")
      .add(HttpApiEndpoint.get("list", "/api/projects", { success: Schema.Array(Project) }))
      .add(HttpApiEndpoint.post("create", "/api/projects", { payload: NewProject, success: Project }))
      .add(HttpApiEndpoint.patch("update", "/api/projects/:id", { params: idParam, payload: ProjectPatch, success: Project, error: HttpApiError.NotFound }))
      .add(HttpApiEndpoint.delete("remove", "/api/projects/:id", { params: idParam }))
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
      .add(HttpApiEndpoint.get("messages", "/api/chats/:id/messages", { params: idParam, success: Schema.Array(Message) }))
      .add(HttpApiEndpoint.post("consolidate", "/api/chats/:id/consolidate", { params: idParam, success: Chat, error: [HttpApiError.NotFound, HttpApiError.Conflict] }))
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
      // Conecta e lista as ferramentas, já classificadas; falha de conexão vem em `error`.
      .add(HttpApiEndpoint.get("inspect", "/api/mcp/:id/tools", { params: idParam, success: Schema.Struct({ tools: Schema.Array(ToolInfo), error: Schema.NullOr(Schema.String) }), error: HttpApiError.NotFound }))
      .add(HttpApiEndpoint.post("decide", "/api/approvals/:id", { params: idParam, payload: ApprovalDecision, error: HttpApiError.NotFound }))
  )
  .add(
    HttpApiGroup.make("settings")
      .add(HttpApiEndpoint.get("models", "/api/models", { success: Schema.Array(ModelInfo) }))
      .add(HttpApiEndpoint.get("keys", "/api/keys", { success: Schema.Array(KeyInfo) }))
      .add(HttpApiEndpoint.put("setKey", "/api/keys/:name", { params: { name: Schema.String }, payload: KeyInput, error: HttpApiError.NotFound }))
  )
