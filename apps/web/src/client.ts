// Data layer (D4): atoms derived from the same contract the server implements.
// - CRUD: AtomHttpApi queries keyed by resource; a mutation that passes the same key refetches them, so
//   no screen calls reload() by hand.
// - Turns: AtomRpc over one WebSocket. Each chat is an atom folded from its event stream (snapshot first,
//   then live events); reconnecting subscribes again and the next snapshot replaces the state.
import { type AuditKind, Api, type Attachment, MAX_ATTACHMENT_BYTES, type Message, type Switch } from "@zorel/contracts"
import { type Approval, type ApprovalOutcome, type ChatEvent, type ChatStatus, type Notice, type WorkStep, ZorelRpc } from "@zorel/contracts/events"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { t } from "@zorel/i18n"
import { Effect, Layer, Schedule, Stream } from "effect"
import { FetchHttpClient } from "effect/http"
import { AsyncResult, Atom, AtomHttpApi, AtomRpc, Reactivity } from "effect/reactivity"
import { RpcClient, RpcSerialization } from "effect/rpc"
import { Socket } from "effect/socket"

export class Zorel extends AtomHttpApi.Service<Zorel>()("Zorel", { api: Api, httpClient: FetchHttpClient.layer, baseUrl: location.origin }) {}

export class Live extends AtomRpc.Service<Live>()("Live", {
  group: ZorelRpc,
  protocol: RpcClient.layerProtocolSocket({ retryTransientErrors: true }).pipe(
    Layer.provide(Socket.layerWebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/rpc`)),
    Layer.provide(Socket.layerWebSocketConstructorGlobal),
    Layer.provide(RpcSerialization.layerJson)
  )
}) {}

// ---------- CRUD queries (one key per resource) ----------

export type Key = "projects" | "agents" | "chats" | "memories" | "servers" | "accounts" | "keys" | "models" | "usage" | "approvals" | "preferences" | "workspace" | "audit" | "storage" | "processes" | "context" | "terminals" | "scripts" | "localServers" | "git" | "routines" | "pages" | "fileSkills" | "runs" | "today" | "cli"

export const projectsAtom = Zorel.query("projects", "list", { reactivityKeys: ["projects"] })
export const agentsAtom = Zorel.query("agents", "list", { reactivityKeys: ["agents"] })
// Teams (spec 010) change with their agents (a deleted agent leaves its teams): same key.
export const teamsAtom = Zorel.query("agents", "teams", { reactivityKeys: ["agents"] })
export const chatsAtom = Zorel.query("chats", "list", { reactivityKeys: ["chats"] })
export const memoriesAtom = Zorel.query("memories", "list", { reactivityKeys: ["memories"] })
export const serversAtom = Zorel.query("tools", "list", { reactivityKeys: ["servers"] })
export const signedInAtom = Zorel.query("tools", "signedIn", { reactivityKeys: ["servers"] })
export const accountsAtom = Zorel.query("accounts", "list", { reactivityKeys: ["accounts"] })
export const keysAtom = Zorel.query("settings", "keys", { reactivityKeys: ["keys"] })
export const telegramAtom = Zorel.query("settings", "telegram", { reactivityKeys: ["telegram"] })
export const desktopAtom = Zorel.query("settings", "desktop", { reactivityKeys: ["desktop"] })
export const computerAtom = Zorel.query("settings", "computer", { reactivityKeys: ["computer"] })
export const computerStateAtom = (id: string) => Zorel.query("settings", "computerState", { params: { id }, reactivityKeys: ["computer"] })
export const desktopRunningAtom = Zorel.query("settings", "desktopRunning", { reactivityKeys: ["desktop"] })
export const installedAppsAtom = Zorel.query("settings", "installedApps", { reactivityKeys: ["desktop"] })
export const auditAtom = (query: { kind?: AuditKind; q?: string; from?: number; to?: number; page?: number }) =>
  Zorel.query("settings", "audit", { query, reactivityKeys: ["audit"] })
// The agent CLIs' versions against the latest (the server reads the sources at most every few hours).
export const cliAtom = Zorel.query("settings", "cliStatus", { query: {}, reactivityKeys: ["cli"] })
export const storageAtom = Zorel.query("settings", "storage", { reactivityKeys: ["storage"] })
export const processesAtom = Zorel.query("settings", "processes", { reactivityKeys: ["processes"] })
export const fileSkillsAtom = Zorel.query("settings", "fileSkills", { reactivityKeys: ["fileSkills"] })
// How full the next turn of a chat is (the composer's context meter); read again when the meter opens.
export const commandsAtom = (id: string) => Zorel.query("chats", "commands", { params: { id }, reactivityKeys: ["chats"] })
export const terminalsAtom = (id: string) => Zorel.query("chats", "terminals", { params: { id }, reactivityKeys: ["terminals"] })
export const pagesAtom = Zorel.query("pages", "list", { reactivityKeys: ["pages"] })
export const memoryMapAtom = (scope: string) => Zorel.query("memories", "map", { query: scope ? { scope } : {}, reactivityKeys: ["memories"] })
export const memoryVersionsAtom = (id: string) => Zorel.query("memories", "versions", { params: { id }, reactivityKeys: ["memories"] })
export const pageVersionsAtom = (id: string) => Zorel.query("pages", "versions", { params: { id }, reactivityKeys: ["pages"] })
export const routinesAtom = Zorel.query("routines", "list", { reactivityKeys: ["routines"] })
// Spec 012: a routine's run history, the runs of a week (and the ones planned), and the morning brief.
export const routineHistoryAtom = (id: string) => Zorel.query("routines", "history", { params: { id }, query: {}, reactivityKeys: ["routines", "today"] })
export const routineWeekAtom = (from: number, to: number) => Zorel.query("routines", "week", { query: { from, to }, reactivityKeys: ["routines", "today"] })
export const todayAtom = Zorel.query("routines", "today", { reactivityKeys: ["today", "routines"] })
// Spec 013: a routine's flow (made up for one saved before flows), a run step by step, and a connector's tools for the
// step picker with whether this agent can use each one.
export const routineFlowAtom = (id: string) => Zorel.query("routines", "flow", { params: { id }, reactivityKeys: ["routines"] })
export const flowVersionAtom = (id: string, n: number) => Zorel.query("routines", "flowVersion", { params: { id, n }, reactivityKeys: ["routines"] })
export const runDetailAtom = (id: string, runId: string) => Zorel.query("routines", "runDetail", { params: { id, runId }, reactivityKeys: ["routines", "today"] })
export const uncertainStepsAtom = Zorel.query("routines", "uncertain", { reactivityKeys: ["routines", "today"] })
export const catalogAtom = (serverId: string, agentId: string) => Zorel.query("tools", "catalog", { params: { id: serverId }, query: { agentId }, reactivityKeys: ["servers"] })
export const agentRunsAtom = (id: string) => Zorel.query("agents", "runs", { params: { id }, reactivityKeys: ["runs"] })
export const agentVersionsAtom = (id: string) => Zorel.query("agents", "versions", { params: { id }, reactivityKeys: ["agents"] })
export const gitAtom = (id: string) => Zorel.query("chats", "git", { params: { id }, reactivityKeys: ["git"] })
export const scriptsAtom = (id: string) => Zorel.query("chats", "scripts", { params: { id }, reactivityKeys: ["scripts"] })
export const localServersAtom = (id: string) => Zorel.query("chats", "servers", { params: { id }, reactivityKeys: ["localServers"] })
export const contextAtom = (id: string) => Zorel.query("chats", "context", { params: { id }, reactivityKeys: ["context"] })
export const modelsAtom = Zorel.query("settings", "models", { reactivityKeys: ["models"] })
export const usageAtom = Zorel.query("settings", "usage", { reactivityKeys: ["usage"] })
export const preferencesAtom = Zorel.query("settings", "preferences", { reactivityKeys: ["preferences"] })
export const topTurnsAtom = (since: number) => Zorel.query("settings", "topTurns", { query: { since }, reactivityKeys: ["usage"] })
export const approvalsAtom = Live.query("approvals", undefined, { reactivityKeys: ["approvals"] })

// Workspace (ARCHITECTURE §9.1): one turn's diff, the project's files marked with what this chat changed,
// and the commands the agents ran. All refetch when a turn settles ("workspace" key).
export const diffAtom = (turnId: string) => Zorel.query("chats", "diff", { params: { id: turnId }, reactivityKeys: ["workspace"] })
export const fileTextAtom = (chatId: string, path: string) => Zorel.query("chats", "readFile", { params: { id: chatId }, query: { path }, reactivityKeys: ["workspace"] })
export const filesAtom = (projectId: string, chatId: string) => Zorel.query("projects", "files", { params: { id: projectId }, query: { chatId }, reactivityKeys: ["workspace"] })

// ---------- mutations ----------

export const mutations = {
  createProject: Zorel.mutation("projects", "create"),
  updateProject: Zorel.mutation("projects", "update"),
  removeProject: Zorel.mutation("projects", "remove"),
  createAgent: Zorel.mutation("agents", "create"),
  updateAgent: Zorel.mutation("agents", "update"),
  removeAgent: Zorel.mutation("agents", "remove"),
  createTeam: Zorel.mutation("agents", "createTeam"),
  updateTeam: Zorel.mutation("agents", "updateTeam"),
  removeTeam: Zorel.mutation("agents", "removeTeam"),
  restoreAgent: Zorel.mutation("agents", "restore"),
  builder: Zorel.mutation("agents", "builder"),
  installer: Zorel.mutation("agents", "installer"),
  pause: Zorel.mutation("settings", "pause"),
  rewind: Zorel.mutation("chats", "rewind"),
  createPage: Zorel.mutation("pages", "create"),
  updatePage: Zorel.mutation("pages", "update"),
  removePage: Zorel.mutation("pages", "remove"),
  restorePage: Zorel.mutation("pages", "restore"),
  restoreMemory: Zorel.mutation("memories", "restore"),
  createRoutine: Zorel.mutation("routines", "create"),
  updateRoutine: Zorel.mutation("routines", "update"),
  removeRoutine: Zorel.mutation("routines", "remove"),
  runRoutine: Zorel.mutation("routines", "run"),
  routineHistoryPage: Zorel.mutation("routines", "history"),
  clearRoutineHistory: Zorel.mutation("routines", "clearHistory"),
  saveFlow: Zorel.mutation("routines", "saveFlow"),
  testStep: Zorel.mutation("routines", "testStep"),
  testTrigger: Zorel.mutation("routines", "testTrigger"),
  testNewTrigger: Zorel.mutation("routines", "testNewTrigger"),
  testDelivery: Zorel.mutation("routines", "testDelivery"),
  stepOutput: Zorel.mutation("routines", "stepOutput"),
  resolveStep: Zorel.mutation("routines", "resolveStep"),
  toolOptions: Zorel.mutation("tools", "options"),
  readToday: Zorel.mutation("routines", "todayRead"),
  activity: Zorel.mutation("routines", "activity"),
  setTimeProfile: Zorel.mutation("settings", "timeProfile"),
  createChat: Zorel.mutation("chats", "create"),
  updateChat: Zorel.mutation("chats", "update"),
  reorderChats: Zorel.mutation("chats", "reorder"),
  reorderProjects: Zorel.mutation("projects", "reorder"),
  removeChat: Zorel.mutation("chats", "remove"),
  closeTerminal: Zorel.mutation("chats", "closeTerminal"),
  openFile: Zorel.mutation("chats", "openFile"),
  fs: Zorel.mutation("chats", "fs"),
  stopServer: Zorel.mutation("chats", "stopServer"),
  startPreview: Zorel.mutation("chats", "preview"),
  gitDraft: Zorel.mutation("chats", "gitDraft"),
  gitCommit: Zorel.mutation("chats", "gitCommit"),
  gitPush: Zorel.mutation("chats", "gitPush"),
  gitPr: Zorel.mutation("chats", "gitPr"),
  gitBranch: Zorel.mutation("chats", "gitBranch"),
  enterWorktree: Zorel.mutation("chats", "enterWorktree"),
  leaveWorktree: Zorel.mutation("chats", "leaveWorktree"),
  mergeAgentWorktree: Zorel.mutation("chats", "mergeAgentWorktree"),
  maxPerChat: Zorel.mutation("settings", "maxPerChat"),
  discardAgentWorktree: Zorel.mutation("chats", "discardAgentWorktree"),
  consolidate: Zorel.mutation("chats", "consolidate"),
  createMemory: Zorel.mutation("memories", "create"),
  updateMemory: Zorel.mutation("memories", "update"),
  removeMemory: Zorel.mutation("memories", "remove"),
  connectPoints: Zorel.mutation("memories", "connect"),
  disconnectPoints: Zorel.mutation("memories", "disconnect"),
  createServer: Zorel.mutation("tools", "create"),
  updateServer: Zorel.mutation("tools", "update"),
  removeServer: Zorel.mutation("tools", "remove"),
  inspectServer: Zorel.mutation("tools", "inspect"),
  signInServer: Zorel.mutation("tools", "signIn"),
  createAccount: Zorel.mutation("accounts", "create"),
  removeAccount: Zorel.mutation("accounts", "remove"),
  login: Zorel.mutation("accounts", "login"),
  loginCode: Zorel.mutation("accounts", "loginCode"),
  setKey: Zorel.mutation("settings", "setKey"),
  telegramPair: Zorel.mutation("settings", "telegramPair"),
  installDesktop: Zorel.mutation("settings", "installDesktop"),
  installCli: Zorel.mutation("settings", "installCli"),
  eraseComputer: Zorel.mutation("settings", "eraseComputer"),
  computerStart: Zorel.mutation("settings", "computerStart"),
  computerRestart: Zorel.mutation("settings", "computerRestart"),
  computerOpen: Zorel.mutation("settings", "computerOpen"),
  desktopGuide: Zorel.mutation("settings", "desktopGuide"),
  telegramUnpair: Zorel.mutation("settings", "telegramUnpair"),
  telegramAgent: Zorel.mutation("settings", "telegramAgent"),
  undo: Zorel.mutation("chats", "undo"),
  readLimits: Zorel.mutation("accounts", "limits"),
  checkCli: Zorel.mutation("settings", "cliStatus"), // with fresh: the server reads the sources now
  cleanStorage: Zorel.mutation("settings", "cleanStorage"),
  stopProcess: Zorel.mutation("settings", "stopProcess"),
  closeSession: Zorel.mutation("settings", "closeSession"),
  closeConnection: Zorel.mutation("settings", "closeConnection"),
  pickFileSkill: Zorel.mutation("settings", "pickFileSkill"),
  nativeSkills: Zorel.mutation("settings", "nativeSkills"),
  memoryApproval: Zorel.mutation("settings", "memoryApproval"),
  memoryModel: Zorel.mutation("settings", "memoryModel"),
  maxRunning: Zorel.mutation("settings", "maxRunning"),
  acceptFailoverTerms: Zorel.mutation("settings", "acceptFailoverTerms"),
  send: Live.mutation("send"),
  steer: Live.mutation("steer"),
  interrupt: Live.mutation("interrupt"),
  retry: Live.mutation("retry"),
  decide: Live.mutation("decide")
}

// Refetch resources the server changed on its own (a chat titled after its first message, memories
// proposed by a summary, an account that finished signing in).
const invalidateAtom = Zorel.runtime.fn((keys: ReadonlyArray<Key>) => Reactivity.invalidate(keys))

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

// ---------- live status of every chat (sidebar, "Pending") ----------

const retrying = Schedule.spaced("1 second")

const statusAtom = Atom.keepAlive(
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
// What routines tell the person (spec 012), one at a time: the latest notice (notify.tsx shows it).
const noticeAtom = Atom.keepAlive(
  Live.runtime.atom(
    Stream.unwrap(
      Effect.gen(function* () {
        const client = yield* Live
        return client("notices", undefined)
      })
    ).pipe(Stream.retry(retrying))
  )
)
export const useNotice = (): Notice | undefined => AsyncResult.getOrElse(AsyncResult.map(useAtomValue(noticeAtom), (n): Notice | undefined => n), () => undefined)

export const useStatuses = (): Readonly<Record<string, ChatStatus>> => AsyncResult.getOrElse(useAtomValue(statusAtom), () => ({}))

// ---------- one chat: snapshot + events folded into a view state ----------

export interface LiveTurn {
  readonly turnId: string
  readonly agentId: string | null
  readonly model: string
  readonly text: string
  readonly steps: ReadonlyArray<WorkStep>
  // Where the live text stood when each step began (by step id), so the reply is laid out text, steps, text… as it
  // happens. Steps found in a snapshot (a reload mid-turn) have none: they go after the text.
  readonly stepAt: Readonly<Record<string, number>>
  readonly startedAt: number
}
// Things that happen between messages and aren't stored as messages (this session only).
export type Note =
  | { readonly at: number; readonly kind: "handoff"; readonly from: string | null; readonly to: ReadonlyArray<string>; readonly via: "mention" | "send_message" | "start_task" | "reply" | "limit" | "route"; readonly reason?: string | undefined }
  // What an agent set to "saves on its own" kept after the chat, with the ids to undo it.
  | { readonly at: number; readonly kind: "remembered"; readonly memories: ReadonlyArray<{ readonly id: string; readonly scope: string; readonly text: string }> }
  // A failover move in the running turn; once the reply is saved, the message carries it instead.
  | { readonly at: number; readonly kind: "failover"; readonly turnId: string; readonly switch: Switch }
  // An agent moved to a worktree of its own (spec 016): another agent was editing the folder.
  | { readonly at: number; readonly kind: "worktree"; readonly agentId: string; readonly branch: string }
export interface Receipt {
  readonly approval: Approval
  readonly outcome: ApprovalOutcome
  readonly reason?: string | null // what the person said with it (a change asked of a proposal)
}
export interface ChatState {
  readonly ready: boolean
  readonly messages: ReadonlyArray<Message>
  readonly pending: number // turns queued or running
  readonly lives: ReadonlyArray<LiveTurn> // the replies being written now, in the order they started (spec 016: several)
  readonly approvals: ReadonlyArray<Approval>
  readonly receipts: ReadonlyArray<Receipt>
  readonly notes: ReadonlyArray<Note>
  readonly status: ChatStatus | null
}

const emptyChat: ChatState = { ready: false, messages: [], pending: 0, lives: [], approvals: [], receipts: [], notes: [], status: null }

// One live reply changed (by its turn); the others stay as they are.
const onLive = (s: ChatState, turnId: string, f: (live: LiveTurn) => LiveTurn): ChatState =>
  s.lives.some((l) => l.turnId === turnId) ? { ...s, lives: s.lives.map((l) => (l.turnId === turnId ? f(l) : l)) } : s
const withStep = (live: LiveTurn, step: WorkStep): LiveTurn => ({
  ...live,
  steps: [...live.steps.filter((s) => s.id !== step.id), step],
  stepAt: step.id in live.stepAt ? live.stepAt : { ...live.stepAt, [step.id]: live.text.length }
})

function reduceChat(s: ChatState, e: ChatEvent): ChatState {
  switch (e._tag) {
    case "snapshot": {
      const snap = e.snapshot
      return {
        ready: true,
        messages: snap.messages,
        pending: snap.turns.length,
        lives: snap.turns
          .filter((x) => x.state === "running")
          .map((running) => ({
            turnId: running.id,
            agentId: running.agentId,
            model: running.model,
            text: snap.partial.find((p) => p.turnId === running.id)?.text ?? "",
            steps: snap.steps.filter((x) => x.turnId === running.id),
            stepAt: {},
            startedAt: running.startedAt ?? Date.now()
          })),
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
      return { ...s, lives: [...s.lives.filter((l) => l.turnId !== e.turn.id), { turnId: e.turn.id, agentId: e.turn.agentId, model: e.turn.model, text: "", steps: [], stepAt: {}, startedAt: e.turn.startedAt ?? Date.now() }] }
    case "text":
      return onLive(s, e.turnId, (l) => ({ ...l, text: l.text + e.delta }))
    case "step-started":
    case "step-finished":
      return onLive(s, e.step.turnId, (l) => withStep(l, e.step))
    case "approval":
      return { ...s, approvals: [...s.approvals.filter((a) => a.id !== e.approval.id), e.approval] }
    case "approval-resolved": {
      const approval = s.approvals.find((a) => a.id === e.approvalId)
      return { ...s, approvals: s.approvals.filter((a) => a.id !== e.approvalId), receipts: approval ? [...s.receipts, { approval, outcome: e.outcome, reason: e.reason }] : s.receipts }
    }
    case "handoff":
      return { ...s, notes: [...s.notes, { at: Date.now(), kind: "handoff", from: e.from, to: e.to, via: e.via, reason: e.reason }] }
    case "remembered":
      return { ...s, notes: [...s.notes, { at: Date.now(), kind: "remembered", memories: e.memories }] }
    case "failover":
      // The turn starts over on the next route: drop what the failed one wrote.
      return { ...onLive(s, e.turnId, (l) => ({ ...l, model: e.switch.toModel, text: "", steps: [] })), notes: [...s.notes, { at: Date.now(), kind: "failover", turnId: e.turnId, switch: e.switch }] }
    case "worktree":
      return { ...s, notes: [...s.notes, { at: Date.now(), kind: "worktree", agentId: e.agentId, branch: e.worktree.branch }] }
    case "turn-completed":
    case "turn-failed":
    case "interrupted": {
      const message = e.message
      const messages = message && !s.messages.some((m) => m.id === message.id) ? [...s.messages, message] : s.messages
      const notes = s.notes.filter((n) => n.kind !== "failover" || n.turnId !== e.turn.id) // now on the message
      return { ...s, messages, notes, pending: Math.max(0, s.pending - 1), lives: s.lives.filter((l) => l.turnId !== e.turn.id), receipts: [] }
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
