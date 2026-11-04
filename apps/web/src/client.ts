// Data layer (D4): atoms derived from the same contract the server implements.
// - CRUD: AtomHttpApi queries keyed by resource; a mutation that passes the same key refetches them, so
//   no screen calls reload() by hand.
// - Turns: AtomRpc over one WebSocket. Each chat is an atom folded from its event stream (snapshot first,
//   then live events); reconnecting subscribes again and the next snapshot replaces the state.
import { type AuditKind, Api, type Attachment, MAX_ATTACHMENT_BYTES, type Message, type Switch } from "@zero/contracts"
import { type Approval, type ApprovalOutcome, type ChatEvent, type ChatStatus, type WorkStep, ZeroRpc } from "@zero/contracts/events"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { t } from "@zero/i18n"
import { Effect, Layer, Schedule, Stream } from "effect"
import { FetchHttpClient } from "effect/http"
import { AsyncResult, Atom, AtomHttpApi, AtomRpc, Reactivity } from "effect/reactivity"
import { RpcClient, RpcSerialization } from "effect/rpc"
import { Socket } from "effect/socket"

export class Zero extends AtomHttpApi.Service<Zero>()("Zero", { api: Api, httpClient: FetchHttpClient.layer, baseUrl: location.origin }) {}

export class Live extends AtomRpc.Service<Live>()("Live", {
  group: ZeroRpc,
  protocol: RpcClient.layerProtocolSocket({ retryTransientErrors: true }).pipe(
    Layer.provide(Socket.layerWebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/rpc`)),
    Layer.provide(Socket.layerWebSocketConstructorGlobal),
    Layer.provide(RpcSerialization.layerJson)
  )
}) {}

// ---------- CRUD queries (one key per resource) ----------

export type Key = "projects" | "agents" | "chats" | "memories" | "servers" | "accounts" | "keys" | "models" | "usage" | "approvals" | "preferences" | "workspace" | "audit" | "storage" | "context" | "terminals" | "scripts" | "localServers" | "git" | "routines" | "pages" | "fileSkills"

export const projectsAtom = Zero.query("projects", "list", { reactivityKeys: ["projects"] })
export const agentsAtom = Zero.query("agents", "list", { reactivityKeys: ["agents"] })
export const chatsAtom = Zero.query("chats", "list", { reactivityKeys: ["chats"] })
export const memoriesAtom = Zero.query("memories", "list", { reactivityKeys: ["memories"] })
export const serversAtom = Zero.query("tools", "list", { reactivityKeys: ["servers"] })
export const accountsAtom = Zero.query("accounts", "list", { reactivityKeys: ["accounts"] })
export const keysAtom = Zero.query("settings", "keys", { reactivityKeys: ["keys"] })
export const auditAtom = (query: { kind?: AuditKind; q?: string; from?: number; to?: number; page?: number }) =>
  Zero.query("settings", "audit", { query, reactivityKeys: ["audit"] })
export const storageAtom = Zero.query("settings", "storage", { reactivityKeys: ["storage"] })
export const fileSkillsAtom = Zero.query("settings", "fileSkills", { reactivityKeys: ["fileSkills"] })
// How full the next turn of a chat is (the composer's context meter); read again when the meter opens.
export const commandsAtom = (id: string) => Zero.query("chats", "commands", { params: { id }, reactivityKeys: ["chats"] })
export const terminalsAtom = (id: string) => Zero.query("chats", "terminals", { params: { id }, reactivityKeys: ["terminals"] })
export const pagesAtom = Zero.query("pages", "list", { reactivityKeys: ["pages"] })
export const memoryVersionsAtom = (id: string) => Zero.query("memories", "versions", { params: { id }, reactivityKeys: ["memories"] })
export const pageVersionsAtom = (id: string) => Zero.query("pages", "versions", { params: { id }, reactivityKeys: ["pages"] })
export const routinesAtom = Zero.query("routines", "list", { reactivityKeys: ["routines"] })
export const agentVersionsAtom = (id: string) => Zero.query("agents", "versions", { params: { id }, reactivityKeys: ["agents"] })
export const gitAtom = (id: string) => Zero.query("chats", "git", { params: { id }, reactivityKeys: ["git"] })
export const scriptsAtom = (id: string) => Zero.query("chats", "scripts", { params: { id }, reactivityKeys: ["scripts"] })
export const localServersAtom = (id: string) => Zero.query("chats", "servers", { params: { id }, reactivityKeys: ["localServers"] })
export const contextAtom = (id: string) => Zero.query("chats", "context", { params: { id }, reactivityKeys: ["context"] })
export const modelsAtom = Zero.query("settings", "models", { reactivityKeys: ["models"] })
export const usageAtom = Zero.query("settings", "usage", { reactivityKeys: ["usage"] })
export const preferencesAtom = Zero.query("settings", "preferences", { reactivityKeys: ["preferences"] })
export const topTurnsAtom = (since: number) => Zero.query("settings", "topTurns", { query: { since }, reactivityKeys: ["usage"] })
export const approvalsAtom = Live.query("approvals", undefined, { reactivityKeys: ["approvals"] })

// Workspace (ARCHITECTURE §9.1): one turn's diff, the project's files marked with what this chat changed,
// and the commands the agents ran. All refetch when a turn settles ("workspace" key).
export const diffAtom = (turnId: string) => Zero.query("chats", "diff", { params: { id: turnId }, reactivityKeys: ["workspace"] })
export const filesAtom = (projectId: string, chatId: string) => Zero.query("projects", "files", { params: { id: projectId }, query: { chatId }, reactivityKeys: ["workspace"] })

// ---------- mutations ----------

export const mutations = {
  createProject: Zero.mutation("projects", "create"),
  updateProject: Zero.mutation("projects", "update"),
  removeProject: Zero.mutation("projects", "remove"),
  createAgent: Zero.mutation("agents", "create"),
  updateAgent: Zero.mutation("agents", "update"),
  removeAgent: Zero.mutation("agents", "remove"),
  restoreAgent: Zero.mutation("agents", "restore"),
  builder: Zero.mutation("agents", "builder"),
  pause: Zero.mutation("settings", "pause"),
  rewind: Zero.mutation("chats", "rewind"),
  createPage: Zero.mutation("pages", "create"),
  updatePage: Zero.mutation("pages", "update"),
  removePage: Zero.mutation("pages", "remove"),
  restorePage: Zero.mutation("pages", "restore"),
  restoreMemory: Zero.mutation("memories", "restore"),
  createRoutine: Zero.mutation("routines", "create"),
  updateRoutine: Zero.mutation("routines", "update"),
  removeRoutine: Zero.mutation("routines", "remove"),
  runRoutine: Zero.mutation("routines", "run"),
  createChat: Zero.mutation("chats", "create"),
  updateChat: Zero.mutation("chats", "update"),
  reorderChats: Zero.mutation("chats", "reorder"),
  reorderProjects: Zero.mutation("projects", "reorder"),
  removeChat: Zero.mutation("chats", "remove"),
  closeTerminal: Zero.mutation("chats", "closeTerminal"),
  openFile: Zero.mutation("chats", "openFile"),
  stopServer: Zero.mutation("chats", "stopServer"),
  gitDraft: Zero.mutation("chats", "gitDraft"),
  gitCommit: Zero.mutation("chats", "gitCommit"),
  gitPush: Zero.mutation("chats", "gitPush"),
  gitPr: Zero.mutation("chats", "gitPr"),
  gitBranch: Zero.mutation("chats", "gitBranch"),
  enterWorktree: Zero.mutation("chats", "enterWorktree"),
  leaveWorktree: Zero.mutation("chats", "leaveWorktree"),
  consolidate: Zero.mutation("chats", "consolidate"),
  createMemory: Zero.mutation("memories", "create"),
  updateMemory: Zero.mutation("memories", "update"),
  createServer: Zero.mutation("tools", "create"),
  updateServer: Zero.mutation("tools", "update"),
  removeServer: Zero.mutation("tools", "remove"),
  inspectServer: Zero.mutation("tools", "inspect"),
  createAccount: Zero.mutation("accounts", "create"),
  removeAccount: Zero.mutation("accounts", "remove"),
  login: Zero.mutation("accounts", "login"),
  setKey: Zero.mutation("settings", "setKey"),
  undo: Zero.mutation("chats", "undo"),
  readLimits: Zero.mutation("accounts", "limits"),
  cleanStorage: Zero.mutation("settings", "cleanStorage"),
  pickFileSkill: Zero.mutation("settings", "pickFileSkill"),
  nativeSkills: Zero.mutation("settings", "nativeSkills"),
  acceptFailoverTerms: Zero.mutation("settings", "acceptFailoverTerms"),
  send: Live.mutation("send"),
  steer: Live.mutation("steer"),
  interrupt: Live.mutation("interrupt"),
  decide: Live.mutation("decide")
}

// Refetch resources the server changed on its own (a chat titled after its first message, memories
// proposed by a summary, an account that finished signing in).
export const invalidateAtom = Zero.runtime.fn((keys: ReadonlyArray<Key>) => Reactivity.invalidate(keys))

// ---------- hooks ----------

const EMPTY: ReadonlyArray<never> = []

// A list query as a plain array: empty while the first load runs, the last value while it refetches.
export function useList<A>(atom: Atom.Atom<AsyncResult.AsyncResult<ReadonlyArray<A>, unknown>>): ReadonlyArray<A> {
  return AsyncResult.getOrElse(useAtomValue(atom), () => EMPTY)
}

// A list query with its state, for screens that must not read "empty" before the first answer or after a failure.
export function useReading<A>(atom: Atom.Atom<AsyncResult.AsyncResult<ReadonlyArray<A>, unknown>>) {
  const result = useAtomValue(atom)
  return { items: AsyncResult.getOrElse(result, () => EMPTY as ReadonlyArray<A>), loading: AsyncResult.isInitial(result), failed: AsyncResult.isFailure(result) }
}

// Promise-returning mutation: `await create({ payload, reactivityKeys: ["projects"] })`.
export const useMutation = <W, A>(atom: Atom.Writable<AsyncResult.AsyncResult<A, unknown>, W>) => useAtomSet(atom, { mode: "promise" })

export const useInvalidate = () => useAtomSet(invalidateAtom)

// ---------- live status of every chat (sidebar, "Needs you") ----------

const retrying = Schedule.spaced("1 second")

export const statusAtom = Atom.keepAlive(
  Live.runtime.atom(
    Stream.unwrap(
      Effect.gen(function* () {
        const client = yield* Live
        return client("subscribeStatus", undefined)
      })
    ).pipe(
      Stream.retry(retrying),
      Stream.scan((): Readonly<Record<string, ChatStatus>> => ({}), (all, s) => ({ ...all, [s.chatId]: s }))
    )
  )
)
export const useStatuses = (): Readonly<Record<string, ChatStatus>> => AsyncResult.getOrElse(useAtomValue(statusAtom), () => ({}))

// ---------- one chat: snapshot + events folded into a view state ----------

export interface LiveTurn {
  readonly turnId: string
  readonly agentId: string | null
  readonly model: string
  readonly text: string
  readonly steps: ReadonlyArray<WorkStep>
  readonly startedAt: number
}
// Things that happen between messages and aren't stored as messages (this session only).
export type Note =
  | { readonly at: number; readonly kind: "handoff"; readonly from: string | null; readonly to: ReadonlyArray<string> }
  // A failover move in the running turn; once the reply is saved, the message carries it instead.
  | { readonly at: number; readonly kind: "failover"; readonly turnId: string; readonly switch: Switch }
export interface Receipt {
  readonly approval: Approval
  readonly outcome: ApprovalOutcome
}
export interface ChatState {
  readonly ready: boolean
  readonly messages: ReadonlyArray<Message>
  readonly pending: number // turns queued or running
  readonly live: LiveTurn | undefined
  readonly approvals: ReadonlyArray<Approval>
  readonly receipts: ReadonlyArray<Receipt>
  readonly notes: ReadonlyArray<Note>
  readonly status: ChatStatus | null
}

const emptyChat: ChatState = { ready: false, messages: [], pending: 0, live: undefined, approvals: [], receipts: [], notes: [], status: null }

const withStep = (live: LiveTurn | undefined, step: WorkStep): LiveTurn | undefined =>
  live?.turnId === step.turnId ? { ...live, steps: [...live.steps.filter((s) => s.id !== step.id), step] } : live

export function reduceChat(s: ChatState, e: ChatEvent): ChatState {
  switch (e._tag) {
    case "snapshot": {
      const snap = e.snapshot
      const running = snap.turns.find((x) => x.state === "running")
      return {
        ready: true,
        messages: snap.messages,
        pending: snap.turns.length,
        live: running && {
          turnId: running.id,
          agentId: running.agentId,
          model: running.model,
          text: snap.partial.find((p) => p.turnId === running.id)?.text ?? "",
          steps: snap.steps.filter((x) => x.turnId === running.id),
          startedAt: running.startedAt ?? Date.now()
        },
        approvals: snap.approvals,
        receipts: [],
        notes: [],
        status: snap.status
      }
    }
    case "message":
      return s.messages.some((m) => m.id === e.message.id) ? s : { ...s, messages: [...s.messages, e.message] }
    case "queued":
      return { ...s, pending: s.pending + 1 }
    case "turn-started":
      return { ...s, live: { turnId: e.turn.id, agentId: e.turn.agentId, model: e.turn.model, text: "", steps: [], startedAt: e.turn.startedAt ?? Date.now() } }
    case "text":
      return s.live?.turnId === e.turnId ? { ...s, live: { ...s.live, text: s.live.text + e.delta } } : s
    case "step-started":
    case "step-finished":
      return { ...s, live: withStep(s.live, e.step) }
    case "approval":
      return { ...s, approvals: [...s.approvals.filter((a) => a.id !== e.approval.id), e.approval] }
    case "approval-resolved": {
      const approval = s.approvals.find((a) => a.id === e.approvalId)
      return { ...s, approvals: s.approvals.filter((a) => a.id !== e.approvalId), receipts: approval ? [...s.receipts, { approval, outcome: e.outcome }] : s.receipts }
    }
    case "handoff":
      return { ...s, notes: [...s.notes, { at: Date.now(), kind: "handoff", from: e.from, to: e.to }] }
    case "failover":
      // The turn starts over on the next route: drop what the failed one wrote.
      return {
        ...s,
        live: s.live?.turnId === e.turnId ? { ...s.live, model: e.switch.toModel, text: "", steps: [] } : s.live,
        notes: [...s.notes, { at: Date.now(), kind: "failover", turnId: e.turnId, switch: e.switch }]
      }
    case "turn-completed":
    case "turn-failed":
    case "interrupted": {
      const message = e.message
      const messages = message && !s.messages.some((m) => m.id === message.id) ? [...s.messages, message] : s.messages
      const notes = s.notes.filter((n) => n.kind !== "failover" || n.turnId !== e.turn.id) // now on the message
      return { ...s, messages, notes, pending: Math.max(0, s.pending - 1), live: s.live?.turnId === e.turn.id ? undefined : s.live, receipts: [] }
    }
    case "status":
      return { ...s, status: e.status, pending: e.status.state === "idle" ? 0 : s.pending }
    default:
      return s
  }
}

export const chatAtom = Atom.family((chatId: string) =>
  Live.runtime.atom(
    Stream.unwrap(
      Effect.gen(function* () {
        const client = yield* Live
        return client("subscribeChat", { chatId })
      })
    ).pipe(
      Stream.retry(retrying),
      Stream.scan(() => emptyChat, reduceChat)
    )
  )
)
export const useChat = (chatId: string): ChatState => AsyncResult.getOrElse(useAtomValue(chatAtom(chatId)), () => emptyChat)

// ---------- attachments (raw upload, outside HttpApi) ----------

export async function uploadAttachment(chatId: string, file: File): Promise<Attachment> {
  if (file.size > MAX_ATTACHMENT_BYTES) throw new Error(t("composer.tooBig", { name: file.name }))
  const r = await fetch(`/api/chats/${chatId}/attachments`, {
    method: "POST",
    headers: { "content-type": file.type || "application/octet-stream", "x-file-name": encodeURIComponent(file.name) },
    body: file
  })
  if (!r.ok) throw new Error(t("composer.uploadFailed", { name: file.name }))
  return r.json()
}
export const attachmentUrl = (id: string) => `/api/attachments/${id}`
