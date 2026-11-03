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
export const ProviderAccount = Schema.Struct({
  id: Id,
  label: Schema.String,
  kind: Schema.Literals(["subscription", "api-key"]),
  provider: Schema.String,
  isDefault: Schema.Boolean, // the account used when an agent or chat doesn't pick one
  loggedIn: Schema.Boolean,
  identity: Schema.NullOr(Schema.String), // e-mail or plan reported by the CLI
  loggingIn: Schema.Boolean, // a login flow is open in the browser
  createdAt: Schema.Number
})
export type ProviderAccount = typeof ProviderAccount.Type
export const NewAccount = Schema.Struct({ provider: AccountProvider, label: Name })
export const AccountPatch = Schema.Struct({ label: Name })
export const LoginStarted = Schema.Struct({ url: Schema.NullOr(Schema.String) }) // url: when the CLI printed one

// Reasoning effort (ARCHITECTURE §6). null = the model's default. "max" maps to each engine's top level.
export const Effort = Schema.Literals(["low", "medium", "high", "max"])
export type Effort = typeof Effort.Type

export const Project = Schema.Struct({
  id: Id,
  name: Schema.String,
  brief: Schema.String, // stable project context, included in every turn's prompt
  createdAt: Schema.Number
})
export type Project = typeof Project.Type

export const Agent = Schema.Struct({
  id: Id,
  projectId: Schema.NullOr(Id), // null: global agent
  name: Schema.String,
  instructions: Schema.String,
  model: Schema.String,
  accountId: Schema.NullOr(Id), // null: default account of the model's provider
  effort: Schema.NullOr(Effort),
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
  createdAt: Schema.Number
})
export type Chat = typeof Chat.Type

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

export const ModelInfo = Schema.Struct({
  id: Schema.String,
  provider: Schema.String,
  kind: Schema.Literals(["subscription", "api"]),
  available: Schema.Boolean,
  hint: Schema.String
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

// ---------- inputs ----------

export const NewProject = Schema.Struct({ name: Name, brief: LongText(8000) })
export const ProjectPatch = Schema.Struct({ name: Schema.optional(Name), brief: Schema.optional(LongText(8000)) })
export const NewAgent = Schema.Struct({ projectId: Schema.NullOr(Id), name: Name, instructions: LongText(8000), model: ModelId, accountId: Schema.optional(Schema.NullOr(Id)), effort: Schema.optional(Schema.NullOr(Effort)) })
export const AgentPatch = Schema.Struct({ name: Schema.optional(Name), instructions: Schema.optional(LongText(8000)), model: Schema.optional(ModelId), accountId: Schema.optional(Schema.NullOr(Id)), effort: Schema.optional(Schema.NullOr(Effort)) })
export const NewChat = Schema.Struct({ projectId: Schema.NullOr(Id), agentIds: Schema.Array(Id).check(Schema.isMaxLength(8)), model: ModelId, accountId: Schema.optional(Schema.NullOr(Id)), effort: Schema.optional(Schema.NullOr(Effort)) })
export const ChatPatch = Schema.Struct({ title: Schema.optional(Name), model: Schema.optional(ModelId), accountId: Schema.optional(Schema.NullOr(Id)), effort: Schema.optional(Schema.NullOr(Effort)), agentIds: Schema.optional(Schema.Array(Id).check(Schema.isMaxLength(8))) })
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

// Turns (send, events, interrupt, approve): see events.ts (RPC over WebSocket at /rpc).
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
  )
  .add(
    HttpApiGroup.make("settings")
      .add(HttpApiEndpoint.get("models", "/api/models", { success: Schema.Array(ModelInfo) }))
      .add(HttpApiEndpoint.get("keys", "/api/keys", { success: Schema.Array(KeyInfo) }))
      .add(HttpApiEndpoint.put("setKey", "/api/keys/:name", { params: { name: Schema.String }, payload: KeyInput, error: HttpApiError.NotFound }))
  )
