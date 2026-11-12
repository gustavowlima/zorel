// Turn runtime (ARCHITECTURE §5): per-chat queue in the database, one turn at a time, live events per chat.
// The turn doesn't depend on the client: closing the tab stops nothing; reconnect = subscribe again (snapshot + events).
// Chaining: a reply that mentions another member queues that member's turn (up to MAX_DEPTH without a message from you).
import { APPROVAL_MS } from "./engines/session.ts"
import { type Access, type Agent, type Chat, type Effort, type FailoverTarget, type FailureReason, type FileChange, MAX_RUNNING_DEFAULT, type Memory, type Step, type Switch } from "@zorel/contracts"
import { type AgentOverride, type Approval, ApprovalNotFound, type ApprovalOutcome, type ChatEvent, ChatNeedsAgent, ChatNotFound, type ChatStatus, ErrorCode, type ProposalOf, type Turn, type WorkStep } from "@zorel/contracts/events"
import { Cause, Context, Deferred, Duration, Effect, Fiber, Layer, PubSub, Schedule, Stream } from "effect"
import { Accounts } from "./accounts.ts"
import { ask, Busy, consolidate, DataDir, knownNames, mapEarlierFacts, members, NotFound, pinBudget, prepare } from "./chat.ts"
import { parseRoute, ROUTER_MESSAGES, routerModel, routerPrompt } from "./router.ts"
import { activeMembers, teamsIn } from "./agent-teams.ts"
import { grounded, handleOf, mappedOf, MAX_DEPTH, memoryNote, mentioned, mentionedTeams, pinned, readPage, scopesOf, sectionOf, similar, snippet } from "./context.ts"
import { type AccountRow, normalize, Store, type Repository, type TurnRow } from "./db.ts"
import { LOCAL_ACTOR } from "./access.ts"
import { ownedStore } from "./visibility.ts"
import { hasCredential } from "./observability.ts"
import { engineLabel, type EngineFailure, Engines, isImage, type NativeStep, splitModel, transcript, type Turn as EngineTurn, type EngineEvent, type TurnTools } from "./engines.ts"
import type { Approver, EngineSession, NativeApproval } from "#server/engines/session.ts"
import { Pricing } from "./pricing.ts"
import { Actions, Audit, changed } from "./audit.ts"
import { actionNames, BROWSER_TOOLS, type BrowserToolName, BrowserService, profileOf, runBrowserTool } from "./browser.ts"
import { cardText, TOO_LARGE } from "./engines/policy.ts"
import { ASK_TOOL, createInputs, findAgent, effectiveAccess, KNOWLEDGE_TOOLS, listText, MAX_OPEN_TASKS, MAX_TASK_DEPTH, MEMORY_TOOL, narrower, proposalText, readText, READ_RESULT_TOOL, REMEMBER_TOOL, staleWrite, FIND_TOOLS_TOOL, USE_TOOL_TOOL, MCP_DEFER_CHARS, findTools, ROUTINES_TOOL, SKILL_TOOLS, TASK_TOOL, TEAM_TOOLS, withheldTools, updateInput, visibleTo, withOverride } from "./team.ts"
import { createRoutineFor, nextRun } from "./schedule.ts"
import { claudeCommands, commandOf } from "./engines/claude-sdk.ts"
import { Workspace } from "./workspace.ts"
import { projectFor } from "./chat.ts"
import * as Git from "./git.ts"
import * as Ssh from "./ssh.ts"
import { REMOTE_KEY_TOOL, REMOTE_TOOLS } from "./ssh.ts"
import { join } from "node:path"
import { startVectors } from "./vectors.ts"
import { desktopBin, desktopCli } from "./desktop.ts"
import { checkFolder, COMPUTER_TOOL_NAMES, COMPUTER_TOOLS, computersFor, WRITING_COMPUTER_TOOLS } from "./computer.ts"
import { CHANGING_DESKTOP_TOOLS, DESKTOP_TOOL_NAMES, DesktopApps, desktopTools } from "./desktop-apps.ts"
import { freePort, outputTail, PREVIEW_TOOL, previewFolder, previewKey, previewLine, previewUrl, waitForPort } from "./preview.ts"
import { managerOf, scriptsOf, shellAlive, startShell } from "./terminals.ts"
import { compact, exposedName, guarded, type GatewayHandle, NO_TOOLS, readResult, resultText, textResult, Tools, type Session, type ToolDef } from "./tools.ts"
import { asMemory, picked, readSkill } from "./file-skills.ts"
import { accessChange, browserRoute, mcpRoute, permissionsOf, REQUEST_ACCESS_TOOL, withAlways } from "./permissions.ts"

const MAX_MENTIONS = 3
export const MAX_RUNNING_KEY = "maxRunning"
// The preference as stored ("" or absent: the default); never negative.
export const parseMaxRunning = (stored: string | undefined | null): number => {
  const n = stored === undefined || stored === null || stored === "" ? MAX_RUNNING_DEFAULT : Number(stored)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : MAX_RUNNING_DEFAULT
}
// How many of one chat's agents may work at once (Settings › General; 0 = no limit, the default).
export const MAX_PER_CHAT_KEY = "maxPerChat"
export const parseMaxPerChat = (stored: string | undefined | null): number => {
  const n = Number(stored ?? 0)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
}
const WAITING_SLOT = "Waiting for a free slot"
const MAX_SESSIONS = 8 // live engine processes; the least recently used one closes first
// APPROVAL_MS (engines/session.ts): a card expires in 30 min and counts as denial
const SKIP_MS = 10 * 60_000 // §6.1: a route that failed (not a limit) is skipped this long
// An engine that sends nothing for this long, with no approval waiting, is treated as dead (its process may
// have died without the SDK noticing): the turn fails as "unavailable", so failover can take over.
const STALL_MS = 10 * 60_000
const MAX_PENDING_MEMORIES = 20 // as a chat's learning: past it, nothing more waits for review
const QUIET_AFTER = Duration.minutes(10) // a chat this long without a turn learns from its latest messages
const SESSION_IDLE_MS = 55 * 60_000 // the provider's prompt cache lasts an hour: past it, going on costs what starting over does
const SESSION_MAX_CONTEXT = 60_000 // input tokens; past it, the next turn starts a fresh session from the summary
const MEMORY_NOTE_MAX = 2_000 // characters of memory changes carried as a note before the session starts over with them
const SAME_STEP_MAX = 4 // the same step with the same result this many times in a row: a loop
const ERRORS_MAX = 6 // this many failed steps in a row: stuck

// Runaway guard of one turn: it watches finished steps and says why to stop, if it should.
// A step is its kind, title and the start of its output; a different step or a success resets the counts.
// A waiting status whose card is a question (zorel_ask_user): the app says "asks you" instead of "waits for your OK".
// A decision on an approval card, as its waiter gets it.
type Decision = { readonly outcome: ApprovalOutcome; readonly reason: string | null; readonly overrides: ReadonlyArray<AgentOverride> }
const QUESTION_LABEL = "question"

// Background work (learning, the memory map) that must not stop the chat, and must not fail unseen either: an
// expected "already running" or "chat gone" ends quietly; anything else is logged once, masked like every log line.
export const quietly =
  (what: string, chatId?: string) =>
  <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<void, never, R> =>
    self.pipe(
      Effect.asVoid,
      Effect.catchCause((cause) => {
        const e = Cause.squash(cause)
        return e instanceof Busy || e instanceof NotFound ? Effect.void : Effect.logWarning(`${what} failed`, { ...(chatId && { chatId }), cause: Cause.pretty(cause) })
      })
    )

export function runawayGuard() {
  let last = ""
  let same = 0
  let errors = 0
  return (step: { kind: string; title: string; detail?: string; status: string; output: string }): string | undefined => {
    errors = step.status === "error" ? errors + 1 : 0
    // A successful edit (not a refused or failed one) changes the file, and its output is always the same "updated successfully": repeating it
    // is progress, not a loop (four edits to one file in a row stopped a real turn). It also breaks a streak.
    if (step.kind === "edit" && step.status === "ok") {
      last = ""
      same = 0
      return undefined
    }
    // The detail (the command) is part of the identity: two different commands can share one summary.
    const sig = `${step.kind}\u0000${step.title}\u0000${step.detail ?? ""}\u0000${step.output.slice(0, 500)}`
    same = sig === last ? same + 1 : 1
    last = sig
    if (same >= SAME_STEP_MAX) return `Stopped: the agent ran "${step.title}" ${same} times in a row with the same result.`
    if (errors >= ERRORS_MAX) return `Stopped: ${errors} steps in a row failed.`
    return undefined
  }
}

// Times the two things an engine does between its tools: reasoning and writing the answer. They are saved as two
// steps ("thought" first, "reply" last) so a finished reply shows where its time went. For the reader only: they
// are not in the runaway guard (it never sees them) and not in the transcript (only `run` steps go there).
// Neither has an end event: reasoning runs from its first sign to the next text or step; writing, from its first
// text to its last before the next step or reasoning (so a tool's time in between is not the reply's).
export function replyTiming() {
  let thinking = false
  let thoughtMs = 0
  let thinkSince: number | undefined
  let wrote = false
  let writtenMs = 0
  let writeSince: number | undefined
  let lastText = 0
  const closeThought = (now: number) => {
    if (thinkSince !== undefined) thoughtMs += Math.max(0, now - thinkSince)
    thinkSince = undefined
  }
  const closeWriting = () => {
    if (writeSince !== undefined) writtenMs += Math.max(0, lastText - writeSince)
    writeSince = undefined
  }
  return {
    thinking(now: number) {
      closeWriting()
      thinking = true
      thinkSince ??= now
    },
    step(now: number) {
      closeThought(now)
      closeWriting()
    },
    text(now: number) {
      closeThought(now)
      wrote = true
      writeSince ??= now
      lastText = now
    },
    reset() {
      thinking = false
      thoughtMs = 0
      thinkSince = undefined
      wrote = false
      writtenMs = 0
      writeSince = undefined
      lastText = 0
    },
    // The steps as saved: the thought before the tools, the reply after. `engine` is the label both carry.
    steps(native: ReadonlyArray<Step>, engine: string, now: number): Step[] {
      closeThought(now)
      closeWriting()
      const timing = (tool: "thought" | "reply", title: string, ms: number): Step => ({ tool, args: "", status: "ok", result: "", title, detail: engine, ms })
      return [...(thinking ? [timing("thought", "Thought", thoughtMs)] : []), ...native, ...(wrote ? [timing("reply", "Replied", writtenMs)] : [])]
    }
  }
}
const TEXT_BATCH = Duration.millis(100) // batched deltas

interface SendInput {
  readonly chatId: string
  readonly clientId: string
  readonly text: string
  readonly model?: string | undefined
  readonly attachmentIds?: ReadonlyArray<string> | undefined
}

export type FinishedTurn = { readonly turnId: string; readonly chatId: string; readonly clientId: string | null; readonly state: "completed" | "failed" | "interrupted"; readonly messageId: string; readonly error: string | null; readonly cost: number | null }

export interface RuntimeService {
  // opts.outside (spec 011): the text came from outside (a webhook or a watched connector); its turns run at "ask".
  // Server-only: no RPC field sets it.
  readonly send: (input: SendInput, opts?: { readonly outside?: boolean; readonly personId?: string }) => Effect.Effect<{ turnId: string }, ChatNotFound | ChatNeedsAgent>
  // Corrects the agent mid-turn when the engine supports it (Codex); otherwise queues it like `send`.
  readonly steer: (chatId: string, text: string, attachmentIds?: ReadonlyArray<string>) => Effect.Effect<{ readonly joined: boolean }, ChatNotFound>
  readonly interrupt: (chatId: string, turnId?: string) => Effect.Effect<void>
  readonly retry: (chatId: string, messageId: string) => Effect.Effect<void, ChatNotFound>
  // The chat's Run: the person starts the project's server (as zorel_preview does, with no approval: it's theirs).
  readonly preview: (chatId: string, input: { script?: string | undefined; command?: string | undefined; folder?: string | undefined }) => Effect.Effect<{ url: string } | { error: string }, ChatNotFound>
  // Pause everything: running turns stop, new ones wait queued, routines don't fire.
  // "Edit from here": the chat's engine sessions close, so the next turn starts from what the chat keeps.
  readonly forget: (chatId: string) => Effect.Effect<void>
  // Tells the chat what an agent in "auto" memory mode saved on its own (the "remembered" event).
  readonly remembered: (chatId: string, saved: ReadonlyArray<Memory>) => Effect.Effect<void>
  readonly paused: () => boolean
  readonly setPaused: (paused: boolean) => Effect.Effect<void>
  readonly setMaxRunning: (max: number) => Effect.Effect<void>
  readonly setMaxPerChat: (max: number) => Effect.Effect<void>
  readonly decide: (approvalId: string, outcome: Exclude<ApprovalOutcome, "expired">, reason?: string, overrides?: ReadonlyArray<AgentOverride>) => Effect.Effect<void, ApprovalNotFound>
  // Spec 013: a routine flow's step waits for the person (a write, an "Ask me"), with no turn behind it. The card goes
  // to the routine's chat and Needs you like any other; "Always allow" saves the rule on the agent.
  readonly requestApproval: (req: RunStepApproval) => Effect.Effect<{ readonly outcome: ApprovalOutcome; readonly reason: string | null }>
  readonly subscribeChat: (chatId: string) => Stream.Stream<ChatEvent, ChatNotFound>
  readonly subscribeStatus: Stream.Stream<ChatStatus>
  // Every turn that ended, in any chat (spec 012: routine runs read their outcome from it).
  readonly finished: Stream.Stream<FinishedTurn>
  readonly busy: (chatId: string) => boolean // a turn is running in the chat now
  readonly agentBusy: (chatId: string, agentId: string) => boolean // that agent's turn is running in the chat now
  // A chat was deleted (spec 011): its engine sessions close, its open event streams end, and what the server kept
  // live for it goes.
  readonly release: (chatId: string) => Effect.Effect<void>
  // Engine sessions kept open between turns (Claude Code, Codex: a process each), and closing one to free it; the
  // chat's next turn opens a new one from the resume point.
  readonly liveSessions: () => ReadonlyArray<{ key: string; chatId: string; agentId: string | null; provider: string; usedAt: number; pid: number | undefined }>
  readonly closeSession: (key: string) => Effect.Effect<void>
}

export interface RunStepApproval {
  readonly chatId: string
  readonly runStepId: string
  readonly agentId: string | null
  readonly kind: "tool" | "question"
  readonly tool: string
  readonly summary: string
  readonly args: string // the card's text, masked
  readonly alwaysKey: string | null
  readonly expiresMs?: number | undefined
  // Told once the card exists (spec 013: an "Ask me" also goes to Telegram, with its id to answer by).
  readonly notify?: ((approval: Approval) => Effect.Effect<void>) | undefined
}

const STEP_RESULT_CHARS = 4000 // of each step's output kept with the reply (its review after the turn)
const ev = <T extends ChatEvent["_tag"]>(_tag: T, body: Omit<Extract<ChatEvent, { _tag: T }>, "_tag">) => ({ _tag, ...body }) as unknown as ChatEvent

const makeRuntime = Effect.gen(function* () {
  // ponytail: in memory per chat, lost on restart (the agent just reads the page again)
  const pagesReadBy = new Map<string, Map<string, number>>()
  const store = yield* Store
  const accounts = yield* Accounts
  const workspace = yield* Workspace
  const pricing = yield* Pricing
  const audit = yield* Audit
  const engines = yield* Engines
  const dataDir = yield* DataDir
  const desktop = new DesktopApps(desktopCli(dataDir)) // the computer apps' last numbered lists (spec 008)
  const computers = computersFor(dataDir) // agents' own Linux computers (spec 009)
  const { hub, gateway } = yield* Tools
  const browsers = yield* BrowserService
  const services = yield* Effect.context<Store | Engines | DataDir>()

  // ---------- events ----------
  const hubs = new Map<string, PubSub.PubSub<ChatEvent>>()
  const hubOf = (chatId: string) => {
    let h = hubs.get(chatId)
    if (!h) {
      h = Effect.runSync(PubSub.unbounded<ChatEvent>())
      hubs.set(chatId, h)
    }
    return h
  }
  // Chats deleted in the last hour (spec 011): a late event from a turn still ending doesn't bring their hub back.
  // ponytail: in memory, enough since a restart starts with no hubs at all.
  const gone = new Map<string, number>()
  const publish = (chatId: string, e: ChatEvent) => (gone.has(chatId) ? Effect.void : PubSub.publish(hubOf(chatId), e).pipe(Effect.asVoid))
  // An agent in "auto" memory mode saved facts: the chat says what (and Undo forgets one).
  const remembered = (chatId: string, saved: ReadonlyArray<Memory>) =>
    publish(chatId, ev("remembered", { memories: saved.map((m) => ({ id: m.id, scope: m.scope, text: m.text })) }))
  const statusHub = yield* PubSub.unbounded<ChatStatus>()
  const finishedHub = yield* PubSub.unbounded<FinishedTurn>()
  const statuses = new Map<string, ChatStatus>()
  const idle = (chatId: string): ChatStatus => ({ chatId, state: "idle", agentId: null, label: "", unread: false, updatedAt: Date.now() })
  // Who in the chat waits on a teammate: the @mention hand-off still collecting answers here, and the tasks it gave
  // that will report back. Read on every status change, which every hand-off and report goes through.
  // ponytail: a task chat deleted mid-task leaves the wait shown until the chat's next status change.
  const waitsOf = (chatId: string) =>
    Effect.gen(function* () {
      const wrap = wraps.get(chatId)
      const tasks = (yield* store.openTasks()).filter((t) => t.taskOf === chatId && t.taskBy)
      const given = yield* Effect.forEach(tasks, (t) => Effect.map(store.chat(t.id), (c) => ({ agentId: t.taskBy!, on: c?.agentIds.slice(0, 1) ?? [], taskChatId: t.id })))
      return [...(wrap?.waiting.size ? [{ agentId: wrap.askerId, on: [...wrap.waiting], taskChatId: null }] : []), ...given.filter((w) => w.on.length)]
    })
  // Several agents may work in a chat at once (spec 016): each running one keeps its own state and label here, and the
  // chat's status says the one waiting on the person first, else the first at work, with everyone at work in
  // `agentIds`. Idle or failed: the chat's whole state (its turns are over).
  const working = new Map<string, Map<string, { agentId: string | null; state: "running" | "waiting"; label: string }>>()
  const publishStatus = (chatId: string, state: ChatStatus["state"], agentId: string | null, label: string) =>
    Effect.gen(function* () {
      if (gone.has(chatId)) return
      const at = [...(working.get(chatId)?.values() ?? [])]
      const agentIds = at.flatMap((w) => (w.agentId ? [w.agentId] : []))
      const status: ChatStatus = { chatId, state, agentId, label, unread: false, updatedAt: Date.now(), waits: yield* waitsOf(chatId), ...(agentIds.length > 1 && { agentIds }) }
      statuses.set(chatId, status)
      yield* PubSub.publish(statusHub, status)
      yield* publish(chatId, ev("status", { status }))
    })
  const setStatus = (chatId: string, state: ChatStatus["state"], agentId: string | null, label: string) =>
    Effect.suspend(() => {
      if (state === "idle" || state === "failed") {
        working.delete(chatId)
        return publishStatus(chatId, state, agentId, label)
      }
      const at = working.get(chatId) ?? new Map()
      working.set(chatId, at.set(agentId ?? "-", { agentId, state, label }))
      const lead = [...at.values()].find((w) => w.state === "waiting") ?? [...at.values()][0]!
      return publishStatus(chatId, lead.state, lead.agentId, lead.label)
    })
  // An agent's turn ended while others go on: the chat's status is theirs.
  const clearStatus = (chatId: string, agentId: string | null) =>
    Effect.suspend(() => {
      const at = working.get(chatId)
      if (!at?.delete(agentId ?? "-") || !at.size) return Effect.void
      const lead = [...at.values()].find((w) => w.state === "waiting") ?? [...at.values()][0]!
      return publishStatus(chatId, lead.state, lead.agentId, lead.label)
    })

  // ---------- in-memory state (the database is the source; this only holds fibers and waits) ----------
  const workers = new Map<string, { kicked: boolean; signal: Deferred.Deferred<void> }>()

  // ---------- native engine sessions (ARCHITECTURE §6, D6) ----------
  // One per (chat, agent). `seen` is the watermark: the `at` of the last message the session has.
  interface Live {
    readonly session: EngineSession
    readonly provider: string
    readonly stable: string
    readonly memories: ReadonlyMap<string, string> // id → text of the memories it opened with
    seen: number
    used: number
    context: number // input tokens of its last turn: how big it has grown
  }
  const sessions = new Map<string, Live>()
  // ponytail: one gateway URL per (chat, agent), closed only when the server stops; drop on chat delete if it grows.
  const gateways = new Map<string, GatewayHandle>()
  // Per provider too: switching Claude → Codex → Claude keeps the Claude session, which on return only
  // gets what it hasn't seen. The LRU cap bounds the processes.
  const sessionKey = (row: TurnRow) => `${row.chatId}:${row.agentId ?? "-"}:${splitModel(row.model).provider}`
  const gatewayOf = (key: string) => {
    let g = gateways.get(key)
    if (!g) {
      g = gateway.open(NO_TOOLS)
      gateways.set(key, g)
    }
    return g
  }
  const closeSession = (key: string) =>
    Effect.suspend(() => {
      const live = sessions.get(key)
      sessions.delete(key)
      return live ? live.session.close : Effect.void
    })
  yield* Effect.addFinalizer(() =>
    Effect.forEach([...sessions.keys()], closeSession, { discard: true }).pipe(Effect.andThen(
        Effect.sync(() => {
          for (const g of gateways.values()) g.close()
        })
      ))
  )

  // Picks the engine for this turn. With a native session, only the dynamic context and the messages
  // after the watermark are sent; a new session gets the whole checkpoint (summary + recent messages).
  // Running turns whose session can take a correction mid-turn (only while the turn streams).
  // The running turn's way to take a message mid-reply, and whose turn it is (a message goes in only for its own agent).
  // Keyed by chat and agent (several agents may be at work in one chat).
  const steering = new Map<string, { agentId: string | null; steer: (text: string) => Promise<boolean> }>()
  const steerKey = (chatId: string, agentId: string | null) => `${chatId}:${agentId ?? "-"}`
  // Chats whose running turn a "send now" is stopping: the worker waits for the message to be queued before it picks the next turn.
  const holding = new Map<string, Deferred.Deferred<void>>()

  // The approver of the turn each session is running now (a session outlives turns; approvals go to the current one).
  const approvers = new Map<string, Approver>()
  const engineStream = (row: TurnRow, turn: EngineTurn, account: AccountRow | undefined, effort: Effort | null, access: Access, web: boolean, nativeSkills: boolean, onSeen: (set: (at: number) => void) => void) =>
    Effect.gen(function* () {
      const key = sessionKey(row)
      const provider = splitModel(row.model).provider
      // Tool names are part of the stable context: a session lists tools once, so a new set means a new session.
      // The account too: switching accounts opens a new session with the checkpoint (§6.1, no shared native session).
      // So are the folder and the access level: the engine's sandbox is set when the session opens.
      // The memories aren't part of it (turn.frame): they reach a live session as a note (memoryNote).
      const stable = `${turn.frame ?? turn.stable ?? turn.system}\n#tools:${(turn.tools?.defs ?? []).map((d) => d.name).sort().join(",")}\n#account:${account?.id ?? "-"}\n#cwd:${turn.cwd}\n#access:${access}\n#web:${web}\n#skills:${nativeSkills}`
      let live = sessions.get(key)
      const note = live && turn.memories ? memoryNote(live.memories, turn.memories, turn.activeMemoryIds ?? []) : undefined
      // Starting over beats going on when: the prompt cache expired (idle past SESSION_IDLE: resuming costs what a
      // fresh start does), it grew past SESSION_MAX_CONTEXT (tool outputs pile up in it; a fresh start carries the
      // summary and the history within HISTORY_CHARS), or the memory changes outgrew a note.
      const stale = live && (Date.now() - live.used > SESSION_IDLE_MS || live.context > SESSION_MAX_CONTEXT || (note?.length ?? 0) > MEMORY_NOTE_MAX)
      if (live && (!live.session.alive() || live.stable !== stable || stale)) {
        yield* closeSession(key)
        live = undefined
      }
      if (!live) {
        const opened = engines.open?.({
          model: row.model, system: turn.stable ?? turn.system, cwd: turn.cwd, gatewayUrl: gatewayOf(key).url, dataDir, account: account && { id: account.id, home: account.home },
          access, web, nativeSkills, approve: (req) => (approvers.get(key) ?? (async () => false))(req)
        })
        if (opened === undefined) return engines.run({ ...turn, access, web, account: account && { id: account.id, home: account.home }, approve: (req) => (approvers.get(key) ?? (async () => false))(req) })
        if (typeof opened === "string") return Stream.make<EngineEvent[]>({ type: "error", message: opened })
        if (sessions.size >= MAX_SESSIONS) {
          const oldest = [...sessions.entries()].sort((a, b) => a[1].used - b[1].used)[0]
          if (oldest) yield* closeSession(oldest[0])
        }
        live = { session: opened, provider, stable, memories: new Map((turn.memories ?? []).map((m) => [m.id, m.text])), seen: 0, used: Date.now(), context: 0 }
        sessions.set(key, live)
      }
      const current = live
      current.used = Date.now()
      const fresh = turn.messages.filter((m) => (m.at ?? 0) > current.seen)
      // A new message that opens with one of Claude Code's slash commands goes on its own, last, for the CLI to
      // expand; the context and the earlier new messages go before it.
      const last = fresh.at(-1)
      const command =
        provider === "claude-cli" && last?.role === "user" && last.text.trimStart().startsWith("/") && commandOf(last.text, yield* Effect.promise(() => claudeCommands(account?.home ?? undefined, turn.cwd)))
          ? last.text.trim()
          : undefined
      const told = command ? fresh.slice(0, -1) : fresh
      // A session opened just now has the memories in its system prompt; one going on gets what changed since.
      const changes = current.seen > 0 ? note : undefined
      const context = [changes, turn.dynamic].filter(Boolean).join("\n\n")
      const prompt = [context && `<context>\n${context}\n</context>`, told.length ? transcript(told) : command ? "" : "Continue."].filter(Boolean).join("\n\n")
      onSeen((at) => {
        current.seen = at
      })
      const steer = current.session.steer
      const images = fresh.flatMap((m) => (m.files ?? []).filter(isImage))
      return current.session.turn({ model: row.model, prompt, tools: turn.tools, effort, images, command }).pipe(
        Stream.tap((e) =>
          Effect.sync(() => {
            if (e.type === "done") current.context = e.usage.inputTokens
          })
        ),
        Stream.onStart(Effect.sync(() => steer && steering.set(steerKey(row.chatId, row.agentId), { agentId: row.agentId, steer }))),
        Stream.ensuring(Effect.sync(() => steering.delete(steerKey(row.chatId, row.agentId))))
      )
    })
  // The turns at work, by chat: each one's agent and its fiber (Stop interrupts it).
  const running = new Map<string, Map<string, { agentId: string | null; fiber: Fiber.Fiber<unknown, unknown> }>>()
  const runsOf = (chatId: string) => running.get(chatId) ?? running.set(chatId, new Map()).get(chatId)!
  const atWork = () => [...running.values()].reduce((n, m) => n + m.size, 0)
  // approval id → its waiter: the decision comes with the person's words (a question's answer, what to change in a
  // proposal) and, on an agent proposal, what they set before approving.
  const waiting = new Map<string, Deferred.Deferred<Decision>>()
  const previews = new Map<string, { shellId: string; port: number }>() // chat + preview key → its running server
  const tasked = new Map<string, Set<string>>() // turn id → teammates it gave a task to (not chained again by mention)
  // chat id → a hand-off by mention waiting for its teammates' answers, to give the asker a wrap-up turn.
  const wraps = new Map<string, { askerId: string; waiting: Set<string>; covered: boolean; depth: number }>()
  const nameOf = (agent: Agent | undefined) => agent?.name ?? "Assistant"
  // The level this turn works at (spec 011): text from outside (a webhook, a watched connector) and what it hands off
  // run at "ask", the narrowest, whatever the agent's or the chat's level. Only ever narrows.
  const turnAccess = (chat: Chat, agent: Agent | undefined, row: Pick<TurnRow, "outside">): Access => (row.outside ? "ask" : effectiveAccess(chat, agent))
  const run = <A>(e: Effect.Effect<A>) => Effect.runPromise(e)

  // ---------- previews: shared by zorel_preview (an agent) and the chat's Run (the person) ----------
  // Where it runs, the line and a free port; a string is what's wrong.
  // agentId: an agent's call runs in its own worktree when it has one (spec 016); the person's Run, in the chat's folder.
  const planPreview = async (chat: Chat, args: { script?: unknown; command?: unknown; folder?: unknown }, agentId?: string | null) => {
    const root = workspace.cwdOf(chat.id, projectFor(chat, chat.projectId ? await run(store.project(chat.projectId)) : undefined, agentId))
    const where = previewFolder(root, args.folder)
    if (typeof where === "string") return where
    const port = await freePort()
    const built = previewLine(args, scriptsOf(where.dir), managerOf(where.dir), port)
    if (typeof built === "string") return built
    return { dir: where.dir, port, ...built, key: `${chat.id}|${previewKey(chat.projectId ?? chat.id, root, where.dir, built.label)}` }
  }
  type PreviewPlan = Exclude<Awaited<ReturnType<typeof planPreview>>, string>
  // The port of the same server still running in this chat (reused, not started twice).
  const runningPreview = (plan: PreviewPlan) => {
    const known = previews.get(plan.key)
    return known && shellAlive(known.shellId) ? known.port : undefined
  }
  // Starts it in a shell of the chat (the Terminal panel shows it) and waits until it listens.
  const launchPreview = async (chat: Chat, plan: PreviewPlan): Promise<{ port: number } | { error: string; tail: string }> => {
    const shell = startShell(chat.id, plan.dir, plan.label, plan.line, { PORT: String(plan.port) })
    if (!shell) return { error: "Too many terminals are open", tail: "" }
    const at = await waitForPort(shell.pid, plan.port, shell.ended)
    if (at === undefined) return { error: "The server didn't start listening", tail: outputTail(shell.output()) }
    previews.set(plan.key, { shellId: shell.id, port: at })
    return { port: at }
  }

  // Who a turn speaks for (spec 014): whose message started it, else the chat's owner, else the one local owner. Their
  // personal memory is the one it hears and keeps (ownedStore), their browser logins the ones it uses.
  // ponytail: one speaker per chat at a time; two people sending to the same project chat at once may swap a handoff's
  // person. A person per message would need it threaded through every enqueue.
  const speaker = new Map<string, string>()
  const enqueue = (input: Parameters<typeof store.enqueueTurn>[0]) => store.enqueueTurn({ personId: speaker.get(input.chatId) ?? null, ...input })
  const personOfTurn = (chatId: string, row: Pick<TurnRow, "personId">) =>
    Effect.map(store.chatAccess(chatId), (c) => row.personId ?? c?.ownerId ?? LOCAL_ACTOR.id)

  // The reading tools with nothing to read in this chat, for this agent (they come back once there is).
  const idleTools = (chat: Chat, agent: Agent | undefined, mem: Pick<Repository, "activeMemories"> = store) =>
    Effect.gen(function* () {
      const scopes = scopesOf(chat, agent?.id ?? null)
      const who = agent?.id ?? null
      const active = yield* mem.activeMemories(scopes)
      const skills = (yield* mem.activeMemories(scopes, "skill", undefined, who)).length + picked(yield* store.preference("fileSkills"), who).length
      const idle = new Set<string>()
      if (active.length <= pinned(active, pinBudget()).length) idle.add(MEMORY_TOOL.name) // every memory is in the prompt already
      if (!(yield* store.hasPages(scopes))) for (const t of ["zorel_knowledge_search", "zorel_knowledge_read"]) idle.add(t)
      if (!skills) idle.add("zorel_read_skill")
      return idle
    })

  // ---------- turn tools: steps and approvals persisted and published ----------
  // `fixed`: a native session's gateway (one URL for the whole session); without it, one URL per turn.
  // `onWrite`: a tool that writes (or is sensitive) is about to run; the turn has acted, so failover won't repeat it.
  // `keep` saves a finished step on the reply (stamped with where its text stands: tools run while the model waits).
  // `settled` waits for the words the agent wrote before calling a tool to go out first (they sit in the text batch),
  // so the tool's step comes after them, live and in its `at`.
  const openTools = async (chat: Chat, row: TurnRow, agent: Agent | undefined, keep: (s: Step) => void, onWrite: () => void, fixed?: GatewayHandle, onFinished: (s: WorkStep) => void = () => {}, settled: () => Promise<void> = async () => {}) => {
    const routes = new Map<string, { server: string; tool: string; approve: boolean; writes: boolean; alwaysKey: string }>()
    const person = await run(personOfTurn(chat.id, row))
    const mem = ownedStore(store, person) // the memory tools hear and keep this person's facts
    // Whose site logins the agent's browser holds: this person's, or the project's when it shares one (spec 014).
    const shared = chat.projectId ? (await run(store.project(chat.projectId)))?.sharedBrowser : false
    const browserProfile = profileOf(agent?.id, shared ? `p-${chat.projectId}` : person)
    const perms = permissionsOf(agent)
    const askFirst = turnAccess(chat, agent, row) === "ask"
    const defs: ToolDef[] = []
    const mcpDefs: ToolDef[] = [] // the MCP servers' tools: listed, or found on demand when there are many
    const withheld = withheldTools(agent) // by the agent's memory mode and knowledge access
    const step = async (title: string, tool: string, detail = "") => {
      await settled()
      return run(store.addStep({ turnId: row.id, kind: "tool", title, tool, detail, files: [], status: "running" }).pipe(Effect.tap((s) => publish(chat.id, ev("step-started", { step: s })))))
    }
    const finish = (s: WorkStep, status: WorkStep["status"], output = "") =>
      run(store.finishStep(s, { status, output: output.slice(0, 300) }).pipe(Effect.tap((done) => publish(chat.id, ev("step-finished", { step: done }))), Effect.tap((done) => Effect.sync(() => onFinished(done)))))
    for (const s of await run(store.mcpServersFor(chat.projectId))) {
      const listed = await hub.tools(s).catch(async (e: unknown) => {
        const msg = `Didn't connect: ${e instanceof Error ? e.message : e}`
        keep({ tool: s.name, args: "", status: "error", result: msg })
        await finish(await step(`Connect ${s.name}`, s.name), "error", msg)
        return []
      })
      for (const t of listed) {
        const r = mcpRoute(perms, s, t, askFirst)
        if (!r.expose) continue
        const name = exposedName(s.name, t.name)
        routes.set(name, { server: s.id, tool: t.name, approve: r.approve, writes: t.cls !== "read", alwaysKey: r.alwaysKey })
        mcpDefs.push({ name, description: t.description, inputSchema: t.inputSchema })
      }
    }
    // Many MCP tools cost tokens in every request: past MCP_DEFER_CHARS the agent finds them on demand instead.
    const deferred = JSON.stringify(mcpDefs).length > MCP_DEFER_CHARS
    if (deferred) for (const t of [FIND_TOOLS_TOOL, USE_TOOL_TOOL]) defs.push({ name: t.name, description: t.description, inputSchema: t.inputSchema })
    else defs.push(...mcpDefs)
    // The chat's browser: Zorel's own tools, always there. Reading never asks; acting asks when the agent's
    // access is "ask", like any tool that writes.
    if (perms.browser) for (const t of BROWSER_TOOLS) defs.push({ name: t.name, description: t.description, inputSchema: t.inputSchema })
    // Its own Linux computer (spec 009): tools that run there, never on this machine.
    if (perms.computer === "container") defs.push(...COMPUTER_TOOLS)
    // The person's computer apps given to this agent (spec 008), once agent-desktop is installed.
    const apps = desktopBin(dataDir) ? (perms.apps ?? []) : []
    defs.push(...desktopTools(apps))
    // Only tools whose results can be shortened (MCP, browser) need a way to read the rest (tools.ts compact).
    if (defs.length) defs.push({ name: READ_RESULT_TOOL.name, description: READ_RESULT_TOOL.description, inputSchema: READ_RESULT_TOOL.inputSchema })
    // The team (team.ts): reading is free; creating or changing an agent is always a proposal the person approves.
    // Each tool's description costs tokens in every session: the ones that only read something are offered once
    // there is something to read (memories past the prompt's budget, a page, a skill); writing ones stay.
    const useless = await run(idleTools(chat, agent, mem))
    for (const t of [...TEAM_TOOLS, TASK_TOOL, ASK_TOOL, MEMORY_TOOL, REMEMBER_TOOL, ROUTINES_TOOL, PREVIEW_TOOL, ...KNOWLEDGE_TOOLS, ...SKILL_TOOLS, ...(agent ? [REQUEST_ACCESS_TOOL] : []), ...(agent?.builtin === "installer" ? REMOTE_TOOLS : [])])
      if (!withheld.has(t.name) && !useless.has(t.name)) defs.push({ name: t.name, description: t.description, inputSchema: t.inputSchema })
    if (!defs.length) {
      fixed?.update(NO_TOOLS)
      return { tools: undefined as TurnTools | undefined, close: () => {} }
    }

    // zorel_ask_user: a question card; the answer (typed or one of the options) comes back as the tool's result.
    const askCall = async (args: Record<string, unknown>) => {
      const question = typeof args.question === "string" ? args.question.trim().slice(0, 1000) : ""
      if (!question) return textResult("question: what you need to know, in one short question.", true)
      const options = (Array.isArray(args.options) ? args.options : []).flatMap((o) => (typeof o === "string" && o.trim() ? [o.trim().slice(0, 100)] : [])).slice(0, 6)
      const s = await step(question, ASK_TOOL.name)
      const { outcome, reason: answer } = await run(waitFor(chat, row, agent, s, { kind: "question", tool: ASK_TOOL.name, summary: question, args: JSON.stringify({ options }), cwd: null }, null, "answer"))
      if (outcome !== "approved" || !answer) {
        await finish(s, "refused")
        return textResult(outcome === "expired" ? "No answer in 30 minutes. Go on with your best judgment and say what you assumed." : "The user chose not to answer. Go on with your best judgment and say what you assumed.")
      }
      await finish(s, "ok", answer)
      return textResult(`The user answered: ${answer}`)
    }

    // zorel_preview (preview.ts): the project's dev server on a free port, in a shell of the chat, its page in the chat's
    // browser. It runs outside the agent's sandbox, so below full access the person approves the exact command.
    const previewCall = async (args: Record<string, unknown>) => {
      const plan = await planPreview(chat, args, agent?.id)
      if (typeof plan === "string") return textResult(plan, true)
      const show = async (at: number) => {
        const url = previewUrl(at, args.path)
        const opened = await browsers
          .newTab(chat.id, url, browserProfile)
          .then((tab) => (browsers.held(chat.id) ? true : browsers.select(chat.id, tab).then(() => true))) // a person holding it keeps their tab
          .catch(() => false) // no browser on this computer: the URL still works in the person's own
        const look = opened ? ` It's open in this chat's Browser panel${perms.browser ? "; read it with your browser tools" : ""}.` : ""
        return textResult(`Running at ${url} (port ${at}).${look} Its output is in the Terminal panel, tab "${plan.label}".`)
      }
      const known = runningPreview(plan)
      if (known) return show(known)
      const s = await step(`Preview ${plan.label}`, PREVIEW_TOOL.name)
      const alwaysKey = plan.key.slice(plan.key.indexOf("|") + 1)
      // "Always" for this command, chosen on an earlier card, holds from then on.
      if (turnAccess(chat, agent, row) !== "full" && !perms.always.includes(alwaysKey)) {
        const card = { kind: "tool" as const, tool: PREVIEW_TOOL.name, summary: `${nameOf(agent)} wants to run the dev server: ${plan.line}`, args: plan.line, cwd: plan.dir }
        const outcome = await run(askApproval(chat, row, agent, s, card, alwaysKey))
        if (outcome === "denied" || outcome === "expired") {
          await finish(s, "refused")
          return textResult("The user declined to run it. Ask them to start the server, or go on without the preview.", true)
        }
      }
      onWrite()
      const r = await launchPreview(chat, plan)
      if ("error" in r) {
        await finish(s, "error", r.tail.split("\n").at(-1) || r.error)
        return textResult(r.tail ? `${r.error}. Its last output:\n${r.tail}` : `${r.error}; ask the user to close one in the Terminal panel.`, true)
      }
      await finish(s, "ok", previewUrl(r.port, args.path))
      return show(r.port)
    }

    // zorel_start_task: checks, then the teammate's own chat. A teammate with wider access than the caller only
    // works on the person's OK (delegating is not a way around one's own access).
    const taskCall = async (args: Record<string, unknown>) => {
      const target = findAgent(visibleTo(await run(store.agents()), chat.projectId), args.agent)
      if (!target || target.builtin) return textResult(`No agent "${String(args.agent ?? "")}" here. Call zorel_list_agents.`, true)
      if (target.id === agent?.id) return textResult("That's you: do it here.", true)
      const task = typeof args.task === "string" ? args.task.trim() : ""
      if (!task || task.length > 8000) return textResult("task: what to do and the context it needs, up to 8000 characters.", true)
      const open = await run(store.openTasks())
      if (open.filter((t) => t.taskOf === chat.id).length >= MAX_OPEN_TASKS) return textResult(`This chat already waits on ${MAX_OPEN_TASKS} tasks. Continue when their results arrive.`, true)
      let depth = 0
      for (let up = open.find((t) => t.id === chat.id); up?.taskOf; up = open.find((t) => t.id === up!.taskOf)) depth++
      if (depth >= MAX_TASK_DEPTH) return textResult("This is already a task inside a task: do it here, or answer with what you have.", true)
      const s = await step(`Task for ${target.name}`, TASK_TOOL.name)
      const mine = turnAccess(chat, agent, row) // the level this turn gives the caller
      // The level the teammate works at in its task chat (it inherits this chat's): more than the caller's asks first.
      const theirs = effectiveAccess({ access: chat.access }, target)
      if (narrower(theirs, mine) !== theirs) {
        const outcome = await run(askApproval(chat, row, agent, s, { kind: "tool", tool: TASK_TOOL.name, summary: `${nameOf(agent)} wants ${target.name} (more access than ${nameOf(agent)}) to work on a task`, args: task, cwd: null }))
        if (outcome === "denied" || outcome === "expired") {
          await finish(s, "refused")
          return textResult("The user declined. Do what you can yourself, or ask them.", true)
        }
      }
      const reply = args.reply !== false
      const id = await run(startTask(chat, agent, target, task, reply, row.outside))
      tasked.set(row.id, new Set([...(tasked.get(row.id) ?? []), target.id]))
      await finish(s, "ok", `#/chat/${id}`)
      return textResult(reply ? `Started: ${target.name} works on it in its own chat. Its answer comes back here as a message, and you continue then.` : `Handed to ${target.name}, in its own chat.`)
    }

    const teamCall = async (name: string, args: Record<string, unknown>) => {
      const all = await run(store.agents())
      const visible = visibleTo(all, chat.projectId)
      // The Builder (Zorel's own) does no work itself: what it proposes is capped at workspace, not at its own "ask";
      // and never above its own: a chat set wider lets it work there, not hand that level to the agents it creates.
      const caller = { model: agent?.model ?? chat.model, effort: agent?.effort ?? chat.effort, access: agent?.builtin === "builder" ? ("workspace" as const) : narrower(turnAccess(chat, agent, row), agent?.access ?? "workspace") }
      const working = (id: string) => [...statuses.values()].some((st) => st.agentId === id && (st.state === "running" || st.state === "waiting"))
      if (name === "zorel_list_agents") return textResult(listText(visible, working))
      const target = name === "zorel_create_agent" ? undefined : findAgent(visible, args.agent)
      if (name !== "zorel_create_agent" && !target) return textResult(`No agent "${String(args.agent ?? "")}" here. Call zorel_list_agents.`, true)
      if (name === "zorel_read_agent") return textResult(readText(target!))
      // Create or update: check, show the proposal card, write only on the person's OK.
      // `of`: the same proposal as data (the web words its title and fills the Builder's panel from it); `names`: who
      // it's about, as the step's detail.
      let proposal: { title: string; text: string; fields: Record<string, unknown>; of: ProposalOf; names: string; apply: (overrides: ReadonlyArray<AgentOverride>) => Promise<Agent[]> }
      try {
        if (name === "zorel_create_agent") {
          const inputs = createInputs(args, caller, chat.projectId, await run(store.mcpServersFor(chat.projectId)))
          // On the card: the profile, what it may reach, its first task and why (the preview reads these lines).
          const fieldsOf = ({ permissions, notes, ...input }: (typeof inputs)[number]) => ({
            ...input,
            projectId: undefined,
            scope: input.projectId ? "project" : "global",
            web: permissions.web,
            browser: permissions.browser,
            connectors: notes.connectors || undefined,
            reason: notes.reason || undefined
          })
          proposal = {
            title: inputs.length === 1 ? `${nameOf(agent)} proposes a new agent: ${inputs[0]!.name}` : `${nameOf(agent)} proposes a team of ${inputs.length}: ${inputs.map((i) => i.name).join(", ")}`,
            // One card for the whole team: each profile under its name.
            text: inputs.length === 1 ? proposalText(fieldsOf(inputs[0]!)) : inputs.map((i) => `## ${i.name}\n${proposalText({ ...fieldsOf(i), name: undefined })}`).join("\n\n"),
            fields: {},
            of: {
              kind: "create",
              agents: inputs.map((i) => ({ name: i.name, title: i.title, description: i.description, instructions: i.instructions, model: i.model, access: i.access, permissions: i.permissions, scope: i.projectId ? "project" : "global", reason: i.notes.reason }))
            },
            names: inputs.map((i) => i.name).join(", "),
            // What the person set in the builder's panel (its AI, its powers) goes in as each agent is created.
            apply: async (overrides) => {
              const made: Agent[] = []
              for (const [i, proposed] of inputs.entries()) {
                const { notes: _notes, ...input } = withOverride(proposed, overrides[i])
                made.push(await run(store.createAgent(input, nameOf(agent))))
              }
              return made
            }
          }
        } else {
          const changes = updateInput(args, target!, caller.access)
          proposal = {
            title: `${nameOf(agent)} proposes changes to ${target!.name}`,
            text: proposalText(changes),
            fields: changes,
            of: { kind: "update", name: target!.name },
            names: target!.name,
            apply: async () => [(await run(store.updateAgent(target!.id, changes, nameOf(agent))))!]
          }
        }
      } catch (e) {
        return textResult(e instanceof Error ? e.message : String(e), true)
      }
      const card = cardText(proposal.text)
      if (!card) return textResult(TOO_LARGE, true)
      const s = await step(proposal.title, name, proposal.names)
      const { outcome, reason: change, overrides } = await run(waitFor(chat, row, agent, s, { kind: "tool", tool: name, summary: proposal.title, args: card, cwd: null, proposal: proposal.of }, null))
      if (outcome === "denied" || outcome === "expired") {
        keep({ tool: name, args: "", status: "refused", result: "" })
        await finish(s, "refused")
        // Declined with words: a change to make (the builder's "want to change something?"), so propose again.
        if (change) return textResult(`The user wants changes to this proposal: "${change}". Revise it accordingly and propose again with zorel_create_agent (a team if they ask for one). Don't ask first.`, true)
        return textResult("The user declined this proposal. Don't propose the same thing again unless they ask. Ask in one short line what to change (the roles, how many, the access), and don't suggest using an agent they already have instead.", true)
      }
      onWrite()
      const done = await proposal.apply(overrides)
      // Recorded as the agent's change (the person approved it).
      const actor = { type: "agent" as const, id: agent?.id ?? "assistant" }
      for (const d of done)
        await run(
          name === "zorel_create_agent"
            ? audit.record(Actions.agentCreated, { target: d, after: { name: d.name, model: d.model, access: d.access }, actor })
            : audit.record(Actions.agentUpdated, { target: d, ...changed(target!, d, Object.keys(proposal.fields)), actor })
        )
      const out =
        name === "zorel_create_agent"
          ? `Created ${done.map((d) => `${d.name} (@${handleOf(d)}, id ${d.id})`).join(", ")}. Mention them to give them work.`
          : `Updated ${done[0]!.name}.`
      keep({ tool: name, args: "", status: "ok", result: out })
      await finish(s, "ok", out)
      return textResult(out)
    }

    // Another computer over SSH (spec 017): the Installer's only. Nothing runs without the person's OK on the exact
    // command; a host seen for the first time is trusted only after they compare its key. Never from outside text.
    const remoteCall = async (name: string, args: Record<string, unknown>) => {
      if (agent?.builtin !== "installer" || row.outside) return textResult("Not available here.", true)
      const dir = Ssh.sshDir(dataDir)
      if (name === REMOTE_KEY_TOOL.name) return textResult(await Ssh.publicKey(dir))
      const target = Ssh.targetFrom(String(args.target ?? ""))
      const command = String(args.command ?? "").trim()
      if (!target) return textResult("target must be user@host or user@host:port.", true)
      if (!command || command.length > 4000) return textResult("command must be one command of at most 4000 characters.", true)
      await Ssh.publicKey(dir)
      const where = Ssh.targetText(target)
      const actor = { type: "agent" as const, id: agent.id }
      const allowed = (o: string) => o === "approved" || o === "always"
      if (!Ssh.isKnown(dir, target)) {
        const key = await Ssh.scanHost(target).catch(() => undefined)
        if (!key) return textResult(`${target.host} didn't answer on port ${target.port}.`, true)
        const s = await step(`Trust ${target.host}`, name, key.fingerprint)
        const card = `${where} answered with this key:\n\n${key.fingerprint}\n\nOn that computer, \`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub\` shows its own. Trust it only if they match.`
        if (!allowed(await run(askApproval(chat, row, agent, s, { kind: "network", tool: name, summary: `Trust ${target.host}?`, args: card, cwd: null })))) {
          await finish(s, "refused")
          return textResult("The user didn't trust that host's key. Don't connect to it again unless they ask.", true)
        }
        Ssh.trust(dir, key.line)
        await run(audit.record(Actions.sshTrusted, { target: { id: where, name: where }, after: { fingerprint: key.fingerprint }, actor }))
        await finish(s, "ok")
      }
      const s = await step(`On ${target.host}: ${command.replace(/\s+/g, " ").slice(0, 80)}`, name, where)
      if (!allowed(await run(askApproval(chat, row, agent, s, { kind: "command", tool: name, summary: `Run on ${where}`, args: command, cwd: null })))) {
        await finish(s, "refused")
        return textResult("The user declined this command. Don't run it again without asking.", true)
      }
      onWrite()
      const r = await Ssh.runRemote(dir, target, command)
      await run(audit.record(Actions.sshRan, { target: { id: where, name: where }, after: { command: command.slice(0, 500), exit: r.code }, actor }))
      await finish(s, r.code === 0 ? "ok" : "error", r.output)
      return textResult(`exit ${r.code}\n${r.output}`, r.code !== 0)
    }

    const memoryCall = async (args: Record<string, unknown>) => {
      const query = typeof args.query === "string" ? args.query.slice(0, 500) : ""
      const found = await run(mem.searchMemories(scopesOf(chat, agent?.id ?? null), query, [], 10))
      return textResult(found.length ? found.map((m) => `- ${m.text}`).join("\n") : "Nothing found. Try other words.")
    }

    // zorel_remember: a fact the person said, kept now ("undo") or proposed ("review", Preferences.memoryApproval), with the same rules as a chat's
    // learning: the person's words (no name or number only an agent said), no credential, no repeat of one kept or
    // forgotten, a correction waits for review. The chat's note comes from the memory itself (agentId, chatId).
    const rememberCall = async (args: Record<string, unknown>) => {
      const text = typeof args.text === "string" ? args.text.trim().replace(/\s+/g, " ") : ""
      if (!text || text.length > 500) return textResult("text: one short sentence, up to 500 characters.", true)
      const about = args.about === "project" || args.about === "agent" ? args.about : "user"
      const scope = about === "user" ? "user" : about === "project" ? (chat.projectId ? `project:${chat.projectId}` : "") : agent ? `agent:${agent.id}` : ""
      if (!scope) return textResult(about === "project" ? "This chat has no project: use about 'user' or 'agent'." : "Only an agent has its own notes: use about 'user'.", true)
      if (await hasCredential(text)) return textResult("That holds a credential: it can't be kept. Don't try again.", true)
      const recent = (await run(store.messages(chat.id))).slice(-20)
      const person = recent.filter((m) => m.role === "user").slice(-3).map((m) => m.text).join("\n")
      const agentsSaid = recent.filter((m) => m.role === "assistant").map((m) => m.text).join("\n")
      if (!person || !grounded(text, person, agentsSaid)) return textResult("Only what the user said or confirmed can be kept, not details you added.", true)
      const scopes = scopesOf(chat, agent?.id ?? null)
      const active = await run(mem.activeMemories(scopes))
      const wanted = typeof args.replaces === "string" ? normalize(args.replaces) : ""
      const target = wanted ? active.find((m) => normalize(m.text) === wanted) : undefined
      if (!target) {
        const same = active.find((m) => m.scope === scope && similar(m.text, text))
        if (same) {
          await run(store.confirmMemories([same.id]))
          return textResult("Already kept. Go on without mentioning it.")
        }
      }
      if ((await run(mem.pendingCount(scopes))) >= MAX_PENDING_MEMORIES) return textResult("Too many memories already wait for the user's review. Go on without it.", true)
      // A turn that started with outside text never keeps a fact on its own: that text isn't the person (spec 011).
      const kept = (await run(store.preference("memoryApproval"))) === "undo" && !target && !row.outside
      const s = await step(`${kept ? "Remember" : "Propose to remember"}: ${text.slice(0, 60)}`, REMEMBER_TOOL.name)
      const m = await run(mem.addMemory({ scope: target?.scope ?? scope, kind: "fact", text, state: kept ? "active" : "pending", origin: "auto", chatId: chat.id, agentId: agent?.id ?? null, replaces: target?.id ?? null }))
      await finish(s, m ? "ok" : "refused", text)
      if (!m) return textResult("The user already has this, or asked to forget it: don't keep it again or mention it.")
      const topics = Array.isArray(args.topics) ? args.topics.slice(0, 5) : []
      await run(store.linkMemory(m.id, m.scope, mappedOf(topics), await run(knownNames(store, chat))))
      if (kept) await run(remembered(chat.id, [m]))
      return textResult(kept ? "Kept. Go on without mentioning it." : "Proposed: the user reviews it. Go on without mentioning it.")
    }

    // Skills: read one by title; propose a new one or an improvement (pending until the person approves it in
    // Knowledge, where an improvement shows what changes). At most 5 of one chat's proposals wait at a time.
    const skillCall = async (name: string, args: Record<string, unknown>) => {
      const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "")
      const scopes = scopesOf(chat, agent?.id ?? null)
      // Only the skills this agent sees: one limited to other agents isn't found, nor can it be improved from here.
      const who = agent?.id ?? null
      const files = picked(await run(store.preference("fileSkills")), who)
      const skills = [...(await run(mem.activeMemories(scopes, "skill", undefined, who))), ...files.map(asMemory)]
      const byTitle = (v: unknown) => {
        const want = String(v ?? "").trim().toLowerCase()
        return skills.find((m) => m.title.toLowerCase() === want) ?? skills.find((m) => m.title.toLowerCase().includes(want) && want.length > 2)
      }
      if (name === "zorel_read_skill") {
        const m = byTitle(args.skill)
        // A skill from a file is read now (it stays current); Zorel's own are stored.
        const file = m && files.find((f) => `file:${f.path}` === m.id)
        if (file) return textResult(`# ${file.name}\n\n${readSkill(file.path)}`)
        return m ? textResult(`# ${m.title}\n\n${m.text}`) : textResult(`No skill "${String(args.skill ?? "")}". The ones here: ${skills.map((s) => s.title).join(", ") || "(none)"}.`, true)
      }
      const title = str(args.title, 80)
      const steps = typeof args.steps === "string" ? args.steps.trim().slice(0, 4000) : ""
      const reason = str(args.reason, 300)
      if (!title || !steps || !reason) return textResult("title, steps and reason are required.", true)
      const target = args.improves ? byTitle(args.improves) : undefined
      if (target?.id.startsWith("file:")) return textResult(`"${target.title}" is a skill from the user's files; it can't be changed from here. Propose a new skill instead.`, true)
      if (args.improves && !target) return textResult(`No skill "${String(args.improves)}" to improve. Propose it as a new one, or check the title.`, true)
      const want = str(args.scope, 10)
      const scope = target?.scope ?? (want === "user" ? "user" : want === "agent" && agent ? `agent:${agent.id}` : chat.projectId ? `project:${chat.projectId}` : agent ? `agent:${agent.id}` : "user")
      const waiting = (await run(store.memories())).filter((m) => m.state === "pending" && m.kind === "skill" && m.chatId === chat.id)
      if (waiting.length >= 5) return textResult("Five of your skill proposals already wait for the user. Wait for them to review those.", true)
      const s = await step(target ? `Propose a better "${target.title}"` : `Propose skill: ${title}`, name)
      const added = await run(mem.addMemory({ scope, kind: "skill", title, text: steps, state: "pending", origin: "auto", chatId: chat.id, replaces: target?.id ?? null, reason }))
      await finish(s, "ok", title)
      return added ? textResult(`Proposed. The user reviews it in Knowledge${target ? ", seeing what changes" : ""}; it applies once approved.`) : textResult("The same skill is already there.")
    }

    // zorel_routines: list freely; create or cancel only on the person's OK (an approval card with the routine).
    const routinesCall = async (args: Record<string, unknown>) => {
      const all = visibleTo(await run(store.agents()), chat.projectId)
      const mine = (await run(store.routines())).filter((r) => all.some((a) => a.id === r.agentId))
      const who = (id: string) => all.find((a) => a.id === id)?.name ?? "?"
      if (args.action === "list")
        return textResult(
          JSON.stringify(mine.map((r) => ({ id: r.id, name: r.name, agent: who(r.agentId), cron: r.cron, enabled: r.enabled, nextRunAt: r.nextRunAt && new Date(r.nextRunAt).toISOString(), webhook: !!r.token })), null, 2)
        )
      const ask = async (title: string, fields: Record<string, unknown>) => {
        const s = await step(title, ROUTINES_TOOL.name)
        const outcome = await run(askApproval(chat, row, agent, s, { kind: "tool", tool: ROUTINES_TOOL.name, summary: title, args: proposalText(fields), cwd: null })) // prompt ≤ 8000: fits the card
        const ok = outcome === "approved" || outcome === "always"
        await finish(s, ok ? "ok" : "refused")
        return ok
      }
      if (args.action === "cancel") {
        const r = mine.find((x) => x.id === args.routine)
        if (!r) return textResult("No such routine here. Call with action 'list'.", true)
        if (!(await ask(`${nameOf(agent)} proposes removing the routine ${r.name}`, { name: r.name, agent: who(r.agentId), cron: r.cron }))) return textResult("The user declined.", true)
        onWrite()
        await run(store.removeRoutine(r.id))
        return textResult(`Removed the routine ${r.name}.`)
      }
      if (args.action !== "create") return textResult("action must be list, create or cancel.", true)
      const target = args.agent ? findAgent(all, args.agent) : agent
      const name = typeof args.name === "string" ? args.name.trim().slice(0, 80) : ""
      const prompt = typeof args.prompt === "string" ? args.prompt.trim().slice(0, 8000) : ""
      const cron = typeof args.cron === "string" && args.cron.trim() ? args.cron.trim() : null
      if (!target) return textResult("Name the agent that runs it (agent: id or @handle).", true)
      if (!name || !prompt) return textResult("name and prompt are required.", true)
      const next = cron ? nextRun(cron) : { at: null }
      if ("error" in next) return textResult(`Not a cron pattern: ${next.error}`, true)
      const fields = { name, agent: target.name, prompt, cron, firstRun: next.at && new Date(next.at).toLocaleString() }
      // A routine's chat has no level of its own: it runs at the target's. Wider than the proposer's, the card says so.
      const wider = target.id !== agent?.id && narrower(effectiveAccess({ access: null }, target), turnAccess(chat, agent, row)) !== effectiveAccess({ access: null }, target)
      const title = `${nameOf(agent)} proposes a routine: ${name}${wider ? ` (run by ${target.name}, with more access than ${nameOf(agent)})` : ""}`
      if (!(await ask(title, fields))) return textResult("The user declined. Don't propose it again unless they ask.", true)
      onWrite()
      const r = await run(createRoutineFor(store, target, { name, prompt, cron, webhook: false }).pipe(Effect.orDie))
      return textResult(`Created the routine ${r.name} (id ${r.id}); it runs in its own chat${r.nextRunAt ? `, first at ${new Date(r.nextRunAt).toISOString()}` : ""}.`)
    }

    // Knowledge pages: search/read in the chat's scopes; write to project/agent scope as a version, or, about the
    // user, only on the person's OK.
    const pagesRead = pagesReadBy.get(chat.id) ?? new Map<string, number>() // page id → its updatedAt when this chat read it (staleWrite)
    pagesReadBy.set(chat.id, pagesRead)
    const knowledgeCall = async (name: string, args: Record<string, unknown>) => {
      const scopes = scopesOf(chat, agent?.id ?? null)
      const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "")
      if (name === "zorel_knowledge_search") {
        const query = str(args.query, 500)
        const found = await run(store.searchPages(scopes, query, 8))
        // Each hit with the section it's in, so the agent can read just that part.
        const terms = normalize(query).split(" ").filter((w) => w.length > 2)
        const hit = (body: string) => terms.find((w) => normalize(body).includes(w)) ?? terms[0] ?? ""
        return textResult(
          found.length
            ? found.map((p) => { const where = sectionOf(p.body, terms); return `- ${p.title} [${p.id}] (${p.scope})${where ? ` › ${where}` : ""}: ${snippet(p.body, hit(p.body), 80)}` }).join("\n")
            : "No page matches. Try other words; if nothing matches, tell the user you didn't find it instead of guessing."
        )
      }
      if (name === "zorel_knowledge_read") {
        const ref = str(args.page, 200)
        const p = await run(store.pageIn(scopes, ref))
        if (!p) return textResult(`No page "${ref}" here. Search with zorel_knowledge_search.`, true)
        pagesRead.set(p.id, p.updatedAt)
        const r = readPage(p.title, p.body, str(args.section, 200) || undefined)
        return textResult(r.text, r.error)
      }
      const title = str(args.title, 120)
      const body = typeof args.body === "string" ? args.body.slice(0, 100_000) : ""
      if (!title || !body.trim()) return textResult("title and body are required.", true)
      const existing = args.page ? await run(store.pageIn(scopes, str(args.page, 200))) : undefined
      if (args.page && !existing) return textResult("No such page here.", true)
      const stale = existing && staleWrite(pagesRead, existing)
      if (stale) return textResult(stale, true)
      const want = str(args.scope, 10) || "project"
      const scope = existing?.scope ?? (want === "user" ? "user" : want === "agent" ? (agent ? `agent:${agent.id}` : "") : chat.projectId ? `project:${chat.projectId}` : "")
      if (!scope) return textResult(want === "agent" ? "Only an agent has its own pages." : "This chat has no project: use scope 'user' or 'agent'.", true)
      const s = await step(`${existing ? "Update" : "Write"} page: ${title}`, name)
      // A page about the user, or a change to one that exists (someone wrote it; an agent doesn't overwrite it
      // unseen), waits for the user's OK. A new project or agent page goes in at once, as a version.
      if (scope === "user" || existing) {
        const summary = scope === "user" ? `${nameOf(agent)} wants to ${existing ? "update" : "write"} a page about you: ${title}` : `${nameOf(agent)} wants to change the page ${existing!.title}`
        const outcome = await run(askApproval(chat, row, agent, s, { kind: "tool", tool: name, summary, args: `# ${title}\n\n${body}`.slice(0, 12_000), cwd: null }))
        if (outcome !== "approved" && outcome !== "always") {
          await finish(s, "refused")
          return textResult("The user declined this page.", true)
        }
      }
      onWrite()
      const saved = await run(store.savePage({ id: existing?.id, scope, title, body }, nameOf(agent)))
      pagesRead.set(saved.id, saved.updatedAt) // what it wrote is what it has seen
      await finish(s, "ok", saved.title)
      return textResult(`Saved "${saved.title}" [${saved.id}]. The user can see its versions and restore any.`)
    }

    const call: Session["call"] = async (name, args) => {
      if (withheld.has(name)) return textResult(`You don't have ${name}: the user turned it off for you.`, true)
      if (deferred && name === FIND_TOOLS_TOOL.name) {
        const found = findTools(mcpDefs, typeof args.query === "string" ? args.query : "")
        return textResult(found.length ? found.map((t) => `- ${t.name}: ${t.description ?? ""}\n  arguments: ${JSON.stringify(t.inputSchema)}`).join("\n") : "No tool matches. Try other words (the service's name, or the action).")
      }
      if (deferred && name === USE_TOOL_TOOL.name) {
        const inner = typeof args.name === "string" ? args.name : ""
        if (!routes.has(inner)) return textResult(`No tool "${inner}". Find it with zorel_find_tools first.`, true)
        const inputs = args.arguments && typeof args.arguments === "object" && !Array.isArray(args.arguments) ? (args.arguments as Record<string, unknown>) : {}
        return call(inner, inputs) // the same path: routes, approvals, outside-text warning, large results
      }
      if (KNOWLEDGE_TOOLS.some((t) => t.name === name)) return knowledgeCall(name, args)
      if (name === ROUTINES_TOOL.name) return routinesCall(args)
      if (SKILL_TOOLS.some((t) => t.name === name)) return skillCall(name, args)
      if (name === REQUEST_ACCESS_TOOL.name && agent) {
        const servers = await run(store.mcpServersFor(chat.projectId))
        const change = accessChange(permissionsOf(agent), String(args.what ?? ""), typeof args.level === "string" ? args.level : undefined, servers)
        if (typeof change === "string") return textResult(change, true)
        const title = `${nameOf(agent)} asks to ${change.label}`
        const s = await step(title, name)
        const outcome = await run(askApproval(chat, row, agent, s, { kind: "tool", tool: name, summary: title, args: String(args.reason ?? "").slice(0, 2000), cwd: null }))
        if (outcome === "denied" || outcome === "expired") {
          await finish(s, "refused")
          return textResult("The user declined. Work with what you have, or ask them.", true)
        }
        // Applied to the agent as it is now (its permissions may have changed while the card waited).
        const fresh = accessChange(permissionsOf((await run(store.agent(agent.id))) ?? agent), String(args.what ?? ""), typeof args.level === "string" ? args.level : undefined, servers)
        if (typeof fresh !== "string") await run(store.updateAgent(agent.id, { permissions: fresh.next }))
        await finish(s, "ok", change.label)
        // A turn's tools are fixed when it starts (the engine lists them once), so the access lands in a turn of its
        // own: queued now, it starts as soon as this one ends, without the person writing again.
        const next = await run(enqueue({ chatId: chat.id, agentId: agent.id, model: row.model, accountId: row.accountId, clientId: null, depth: row.depth }))
        await run(publish(chat.id, ev("queued", { turn: store.toTurn(next) })))
        await run(ensureWorker(chat.id))
        return textResult(`Granted: ${change.label}. Zorel starts your next turn as soon as this one ends, with the access in place: end this turn now with one short line, then continue the task there.`)
      }
      if (name === READ_RESULT_TOOL.name) return readResult(chat.id, args)
      if (name === MEMORY_TOOL.name) return memoryCall(args)
      if (name === REMEMBER_TOOL.name) return rememberCall(args)
      if (name === TASK_TOOL.name) return taskCall(args)
      if (name === PREVIEW_TOOL.name) return previewCall(args)
      if (name === ASK_TOOL.name) return askCall(args)
      if (TEAM_TOOLS.some((t) => t.name === name)) return teamCall(name, args)
      if (REMOTE_TOOLS.some((t) => t.name === name)) return remoteCall(name, args)
      if (COMPUTER_TOOL_NAMES.has(name) && perms.computer === "container") {
        const s = await step(name === "computer_run" ? String(args.command ?? "").slice(0, 120) : `${name.replace("computer_", "")} ${String(args.path ?? "")}`.trim(), name)
        // The chat's project folder is lent when it may be (inside home, not hidden, not Zorel's): read-only at "ask".
        const project = projectFor(chat, chat.projectId ? await run(store.project(chat.projectId)) : undefined, agent?.id)
        // The folders it may reach: the chat's project folder, and the ones the person lent it on its page (each
        // checked again: a folder can change since it was lent), read-only at "ask".
        const lents = [...new Set([...(project?.path ? [project.path] : []), ...(perms.lent ?? [])])].filter((p) => !checkFolder(p, { dataDir })).map((path) => ({ path, readOnly: askFirst }))
        if (WRITING_COMPUTER_TOOLS.has(name)) onWrite()
        const r = guarded(await computers.call({ agentId: agent?.id ?? "none", projectId: chat.projectId, lents }, name, args), "your computer")
        const out = resultText(r)
        keep({ tool: name, args: JSON.stringify(args).slice(0, 300), status: r.isError ? "error" : "ok", result: out.slice(0, STEP_RESULT_CHARS) })
        await finish(s, r.isError ? "error" : "ok", out)
        return compact(chat.id, r)
      }
      if ((DESKTOP_TOOL_NAMES as ReadonlyArray<string>).includes(name)) {
        const s = await step(`${name.replace("desktop_", "")} ${typeof args.app === "string" ? args.app : ""}`.trim(), name)
        const ask = async (summary: string) => {
          const outcome = await run(askApproval(chat, row, agent, s, { kind: "tool", tool: name, summary: `${nameOf(agent)} wants to ${summary}`, args: JSON.stringify(args, null, 2).slice(0, 4000), cwd: null }))
          return outcome === "approved" || outcome === "always"
        }
        if (CHANGING_DESKTOP_TOOLS.has(name)) onWrite()
        const r = guarded(await desktop.call({ key: `${chat.id}:${agent?.id ?? "-"}`, apps, ask, askAll: askFirst }, name, args), `the app ${typeof args.app === "string" ? args.app : ""}`)
        const out = resultText(r)
        keep({ tool: name, args: JSON.stringify(args).slice(0, 300), status: r.isError ? "error" : "ok", result: out.slice(0, STEP_RESULT_CHARS) })
        await finish(s, r.isError ? "error" : "ok", out)
        return compact(chat.id, r)
      }
      const builtin = BROWSER_TOOLS.find((t) => t.name === name)
      if (builtin) {
        const shown = JSON.stringify(args).slice(0, 300)
        const s = await step(browserStepTitle(name, args), name)
        // Listing tabs only reads; opening, switching or closing one acts.
        const writes = builtin.writes || (name === "browser_tabs" && (args.action ?? "list") !== "list")
        const gate = browserRoute(perms, args, writes, askFirst, await actionNames(browsers, chat.id, name as BrowserToolName, args, browserProfile))
        if (gate.approve) {
          const card = cardText(JSON.stringify(args, null, 2))
          if (!card) return textResult(TOO_LARGE, true)
          const outcome = await run(askApproval(chat, row, agent, s, { kind: "tool", tool: name, summary: `${nameOf(agent)} wants to ${browserStepTitle(name, args).toLowerCase()}`, args: card, cwd: null }, gate.alwaysKey))
          if (outcome === "denied" || outcome === "expired") {
            keep({ tool: name, args: shown, status: "refused", result: "" })
            await finish(s, "refused")
            return textResult("The user declined this action. Don't try it again without asking.", true)
          }
        }
        if (writes) onWrite()
        const root = workspace.cwdOf(chat.id, projectFor(chat, chat.projectId ? await run(store.project(chat.projectId)) : undefined, agent?.id))
        const r = guarded(
          await runBrowserTool(browsers, chat.id, name as BrowserToolName, args, root, browserProfile, agent?.id ?? null).then(
            (text) => textResult(text),
            (e: unknown) => textResult(e instanceof Error ? e.message.split("\n")[0]! : String(e), true)
          ),
          `the browser (${name})`
        ) // the warning, if any, shows in the step too
        const out = resultText(r)
        keep({ tool: name, args: shown, status: r.isError ? "error" : "ok", result: out.slice(0, STEP_RESULT_CHARS) })
        await finish(s, r.isError ? "error" : "ok", out)
        return compact(chat.id, r)
      }
      const route = routes.get(name)
      const server = route && (await run(store.mcpServer(route.server)))
      if (!route || !server) return textResult(`Tool not allowed: ${name}`, true)
      const shown = JSON.stringify(args).slice(0, 300)
      const s = await step(name, name)
      if (route.approve) {
        const card = cardText(JSON.stringify(args, null, 2))
        if (!card) return textResult(TOO_LARGE, true)
        const outcome = await run(askApproval(chat, row, agent, s, { kind: "tool", tool: name, summary: `${nameOf(agent)} wants to use ${name}`, args: card, cwd: null }, agent ? route.alwaysKey : null))
        if (outcome === "denied" || outcome === "expired") {
          keep({ tool: name, args: shown, status: "refused", result: "" })
          await finish(s, "refused")
          return textResult("The user declined this action. Don't try it again without asking.", true)
        }
      }
      if (route.writes) onWrite() // even a failed call may have changed something
      const r = await run(
        Effect.promise(() => hub.call(server, route.tool, args).catch((e: unknown) => textResult(String(e instanceof Error ? e.message : e), true))).pipe(
          Effect.withSpan("tool.call", { attributes: { tool: name, server: server.name, turnId: row.id } })
        )
      )
      const shownResult = guarded(r, `${server.name} (${route.tool})`) // the warning, if any, shows in the step too
      const out = resultText(shownResult)
      keep({ tool: name, args: shown, status: r.isError ? "error" : "ok", result: out.slice(0, STEP_RESULT_CHARS) })
      await finish(s, r.isError ? "error" : "ok", out)
      return compact(chat.id, shownResult)
    }
    if (fixed) {
      fixed.update({ tools: defs, call })
      return { tools: { url: fixed.url, defs, call } as TurnTools, close: () => fixed.update(NO_TOOLS) }
    }
    const session = gateway.open({ tools: defs, call })
    return { tools: { url: session.url, defs, call } as TurnTools, close: () => session.close() }
  }

  // One approval card (MCP tool or native call): persisted, published, waited on; expiry counts as denial.
  // alwaysKey: the rule "Always allow" would save on the agent (null: this call can only be allowed once).
  const askApproval = (chat: Chat, row: TurnRow, agent: Agent | undefined, s: WorkStep | undefined, req: NativeApproval, alwaysKey: string | null = null) =>
    Effect.map(waitFor(chat, row, agent, s, req, alwaysKey), (r) => r.outcome)
  // The card itself (an approval, or a question when `waits` is "answer"): its id and how it ended.
  const waitFor = (chat: Chat, row: TurnRow, agent: Agent | undefined, s: WorkStep | undefined, req: NativeApproval, alwaysKey: string | null, waits: "ok" | "answer" = "ok") =>
    Effect.gen(function* () {
      const now = Date.now()
      const approval = yield* store.addApproval({
        chatId: chat.id, turnId: row.id, stepId: s?.id ?? null, agentId: agent?.id ?? null, kind: req.kind, tool: req.tool,
        summary: req.summary, args: req.args, cwd: req.cwd, alwaysKey: agent ? alwaysKey : null, proposal: req.proposal ?? null, expiresAt: now + APPROVAL_MS
      })
      const d = yield* Deferred.make<Decision>()
      waiting.set(approval.id, d)
      if (s) yield* publish(chat.id, ev("step-finished", { step: { ...s, status: "waiting" } }))
      yield* publish(chat.id, ev("approval", { approval }))
      yield* setStatus(chat.id, "waiting", agent?.id ?? null, waits === "answer" ? QUESTION_LABEL : `${nameOf(agent)} waits for your OK`)
      const decision = yield* Deferred.await(d).pipe(
        Effect.timeoutOption(Duration.millis(APPROVAL_MS)),
        Effect.flatMap((o) => (o._tag === "Some" ? Effect.succeed(o.value) : expire(chat.id, approval.id)))
      )
      waiting.delete(approval.id)
      yield* setStatus(chat.id, "running", agent?.id ?? null, `${nameOf(agent)} is working`)
      return decision
    })

  const expire = (chatId: string, id: string) =>
    store.resolveApproval(id, "expired", null, "expiry").pipe(
      Effect.tap((a) => (a ? publish(chatId, ev("approval-resolved", { approvalId: id, outcome: "expired", reason: null, by: "expiry" })) : Effect.void)),
      Effect.as<Decision>({ outcome: "expired", reason: null, overrides: [] })
    )

  // ---------- failover (ARCHITECTURE §6.1) ----------
  // A route is { model, account }. The turn starts on the first ready one; when it fails before acting
  // and the reason is one failover helps with, it moves to the next. A limit holds the account until its
  // reset (persisted, so the primary comes back by itself); other errors skip the route for 10 min.
  // Kept in the preferences (spec 011) so a restart doesn't try again a route still set aside: the default login at
  // its limit (no account row to hold it) and any route skipped for another failure.
  const skipped = new Map<string, { until: number; reason: FailureReason }>()
  const SET_ASIDE_KEY = "setAsideRoutes"
  const savedRoutes = yield* store.preference(SET_ASIDE_KEY)
  if (savedRoutes) {
    try {
      const now = Date.now()
      for (const [key, v] of Object.entries(JSON.parse(savedRoutes) as Record<string, { until: number; reason: FailureReason }>)) if (typeof v?.until === "number" && v.until > now) skipped.set(key, v)
    } catch {
      yield* Effect.logWarning("set-aside routes unreadable: starting with none")
    }
  }
  const setAside = (key: string, v: { until: number; reason: FailureReason }) =>
    Effect.suspend(() => {
      const now = Date.now()
      skipped.set(key, v)
      for (const [k, x] of skipped) if (x.until <= now) skipped.delete(k)
      return store.setPreference(SET_ASIDE_KEY, JSON.stringify(Object.fromEntries(skipped)))
    })
  const routeKey = (model: string, account: AccountRow | undefined) => (account ? `account:${account.id}` : `provider:${splitModel(model).provider}`)
  // Why this route can't be used now, and until when (undefined: ready).
  const held = (model: string, account: AccountRow | undefined): { until: number; reason: FailureReason } | undefined => {
    const now = Date.now()
    if (account?.limitedUntil && account.limitedUntil > now) return { until: account.limitedUntil, reason: "limit" }
    const key = routeKey(model, account)
    const skip = skipped.get(key)
    if (skip && skip.until <= now) skipped.delete(key) // ready again (the saved copy drops it on the next write or start)
    return skip && skip.until > now ? skip : undefined
  }
  // Routes of this turn: its own model first, then the alternatives (the chat's list for the lead, when set;
  // otherwise the agent's). Each route at most once.
  const routesOf = (row: TurnRow, chat: Chat, agent: Agent | undefined, lead: boolean): FailoverTarget[] => {
    const list = (lead ? (chat.failover ?? agent?.failover) : agent?.failover) ?? []
    const all = [{ model: row.model, accountId: row.accountId }, ...list]
    return all.filter((r, i) => all.findIndex((x) => x.model === r.model && x.accountId === r.accountId) === i)
  }

  // ---------- one turn ----------
  const runTurn = (row: TurnRow) =>
    Effect.gen(function* () {
      const chatId = row.chatId
      const chat = yield* store.chat(chatId)
      if (!chat) return yield* store.finishTurn(row.id, { state: "failed", error: ErrorCode.chatRemoved, messageId: null }).pipe(Effect.as(undefined))
      const team = yield* members(store, chat)
      const agent = team.find((a) => a.id === row.agentId)
      const lead = !agent || agent.id === team[0]?.id
      // The lead follows the chat's effort; other members, their own.
      const effort = lead ? chat.effort : (agent?.effort ?? null)
      const acc = { text: "", error: undefined as string | undefined, usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0 }, steps: [] as Step[], saved: false }
      const route = { model: row.model, accountId: row.accountId }
      const switches: Switch[] = []
      const timing = replyTiming()
      // Workspace (§9.1): the project folder is the agents' cwd; a checkpoint before the turn and one after
      // give its diff and its undo.
      const project = projectFor(chat, chat.projectId ? yield* store.project(chat.projectId) : undefined, row.agentId) // a worktree, when the chat or its agent has one
      const access: Access = turnAccess(chat, agent, row)
      const cwd = workspace.cwdOf(chatId, project)
      const treeBefore = yield* workspace.snapshot(project)
      let markSeen: (at: number) => void = () => {}
      const save = (state: "completed" | "failed" | "interrupted", error: string | null) =>
        Effect.gen(function* () {
          if (acc.saved) return
          acc.saved = true
          const treeAfter = treeBefore ? yield* workspace.snapshot(project) : null
          const changes: FileChange[] = treeBefore && treeAfter && chat.projectId ? yield* workspace.changes(chat.projectId, treeBefore, treeAfter) : []
          const cost = pricing.cost(route.model, acc.usage)
          const message = yield* store.addMessage({
            chatId, role: "assistant", agentId: agent?.id ?? null, text: acc.text, model: route.model, error, steps: timing.steps(acc.steps, engineLabel(route.model), Date.now()), switches,
            turnId: row.id, changes, accountId: route.accountId, cost, inputTokens: acc.usage.inputTokens, outputTokens: acc.usage.outputTokens, outside: row.outside,
            durationMs: started.startedAt ? Date.now() - started.startedAt : null
          })
          markSeen(message.at) // the session has everything up to its own reply
          const trees = treeBefore && treeAfter ? { treeBefore, treeAfter } : undefined
          const turn = yield* store.finishTurn(row.id, { state, error, messageId: message.id, usage: acc.usage, cost, route: { ...route, switches }, ...(trees && { trees }) })
          const tag = state === "completed" ? "turn-completed" : state === "failed" ? "turn-failed" : "interrupted"
          yield* publish(chatId, ev(tag, { turn, message }))
          yield* PubSub.publish(finishedHub, { turnId: row.id, chatId, clientId: row.clientId, state, messageId: message.id, error, cost })
        })
      const started = yield* store.startTurn(row.id)
      yield* publish(chatId, ev("turn-started", { turn: store.toTurn(started) }))
      // Over its month's tokens (UTC month): the agent doesn't start; the reply says so (raise it on its page).
      if (agent?.monthlyTokens) {
        const month = new Date()
        const since = Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1)
        if ((yield* store.agentTokensSince(agent.id, since)) >= agent.monthlyTokens) {
          yield* save("failed", ErrorCode.monthlyLimit)
          return undefined
        }
      }
      yield* setStatus(chatId, "running", agent?.id ?? null, `${nameOf(agent)} is working`)

      // One attempt on one route: tools, context, engine stream. Returns the failure, if any.
      const attempt = (model: string, account: AccountRow | undefined) =>
        Effect.gen(function* () {
          const attemptRow: TurnRow = { ...row, model, accountId: account?.id ?? null }
          const native = engines.hasSession?.(model) ?? false
          let acted = false
          let failure: EngineFailure | undefined
          // Liveness: any engine event or a settled approval counts as activity.
          let lastActivity = Date.now()
          // Text events seen on the engine's stream and those already out (appended and published): a tool's step waits
          // until the second catches up with the first (at most 400 ms). It first gives the stream a moment to be read:
          // an engine queues the words it wrote before the tool call, and the tool can start before they're pulled.
          let textSeen = 0
          let textOut = 0
          const settled = () =>
            new Promise<void>((resolve) => {
              const until = Date.now() + 400
              setTimeout(() => {
                const target = textSeen
                const check = () => (textOut >= target || Date.now() > until ? resolve() : setTimeout(check, 10))
                check()
              }, 10)
            })
          let approvalsWaiting = 0
          const stalled = yield* Deferred.make<void>()
          const runaway = yield* Deferred.make<string>()
          const guard = runawayGuard()
          const watch = (s: { kind: string; title: string; detail?: string; status: string; output: string }) => {
            const why = guard(s)
            if (why) Effect.runSync(Deferred.succeed(runaway, why))
          }
          yield* Effect.forkScoped(
            Effect.repeat(
              Effect.suspend(() => (approvalsWaiting === 0 && Date.now() - lastActivity > STALL_MS ? Deferred.succeed(stalled, undefined) : Effect.void)),
              Schedule.spaced("15 seconds")
            )
          )
          // Native calls that need the person go to the approval card of this turn.
          const key = sessionKey(attemptRow)
          approvers.set(key, async (req) => {
            approvalsWaiting++
            try {
              const outcome = await run(askApproval(chat, attemptRow, agent, undefined, req))
              return outcome === "approved" || outcome === "always"
            } finally {
              approvalsWaiting--
              lastActivity = Date.now()
            }
          })
          yield* Effect.addFinalizer(() => Effect.sync(() => approvers.delete(key)))
          // Native steps (reads, edits, commands): persisted, published, and kept on the reply.
          const stepsById = new Map<string, WorkStep>()
          const startedAt = new Map<string, number>() // where the reply's text stood when each began
          const onStep = (n: NativeStep) =>
            Effect.gen(function* () {
              const started = stepsById.get(n.id)
              if (!started) {
                startedAt.set(n.id, acc.text.length)
                if (n.kind === "edit" || n.kind === "run") acted = true // failover won't repeat a turn that may have changed something
                const s = yield* store.addStep({ turnId: row.id, kind: n.kind, title: n.title, detail: n.detail, tool: null, files: n.files, status: "running" })
                stepsById.set(n.id, s)
                yield* publish(chatId, ev("step-started", { step: s }))
                if (n.status === "running") return
              }
              const s = stepsById.get(n.id)!
              if (n.status === "running") return
              const done = yield* store.finishStep(s, { status: n.status, output: n.output })
              yield* publish(chatId, ev("step-finished", { step: done }))
              watch({ kind: n.kind, title: n.title, detail: n.detail, status: n.status, output: n.output })
              // Every step stays with the reply (reads and searches too), with enough of its output to review later.
              // The transcript keeps the command, not its summary.
              acc.steps.push({ tool: n.kind, args: n.kind === "edit" && n.files.length ? n.files.join(", ") : n.detail || n.title, status: n.status, result: n.output.slice(0, STEP_RESULT_CHARS), title: n.title, detail: n.detail, ...(done.durationMs != null && { ms: done.durationMs }), at: startedAt.get(n.id) ?? acc.text.length })
            })
          const opened = yield* Effect.promise(() =>
            openTools(chat, attemptRow, agent, (s) => void acc.steps.push({ ...s, at: acc.text.length }), () => {
              acted = true
            }, native ? gatewayOf(sessionKey(attemptRow)) : undefined, (done) => watch({ kind: done.kind, title: done.title, detail: done.detail, status: done.status, output: done.output ?? "" }), settled)
          )
          yield* Effect.addFinalizer(() =>
            Effect.gen(function* () {
              opened.close()
              // Turn ended: its open requests become denials.
              for (const a of yield* store.openApprovals(chatId)) if (a.turnId === row.id) yield* expire(chatId, a.id)
            })
          )
          const turn = yield* prepare(ownedStore(store, yield* personOfTurn(chatId, row)), (yield* store.chat(chatId))!, agent, model, dataDir, opened.tools, cwd)
          const nativeSkills = (yield* store.preference("nativeSkills")) === "1"
          const stream = yield* engineStream(attemptRow, turn, account, effort, access, permissionsOf(agent).web, nativeSkills, (set) => {
            markSeen = set
          })
          yield* stream.pipe(
            Stream.tap((e) =>
              Effect.sync(() => {
                lastActivity = Date.now()
                if (e.type === "text") textSeen++
              })
            ),
            Stream.interruptWhen(Deferred.await(stalled)),
            Stream.interruptWhen(Deferred.await(runaway)),
            Stream.withSpan("engine.run", { attributes: { model } }),
            Stream.groupedWithin(512, TEXT_BATCH),
            Stream.runForEach((batch) =>
              Effect.gen(function* () {
                let delta = ""
                let thought = "" // reasoning words in this batch, shown live (not saved: a reply keeps only its timing)
                let thinkingSeen = false
                let texts = 0 // text events in `delta`
                // The batch's text so far goes out before a step, so the step lands after it: in the live view and in
                // the step's `at` (else a step would come before words the agent wrote first).
                const flush = Effect.gen(function* () {
                  if (thinkingSeen) {
                    yield* publish(chatId, ev("reasoning", { turnId: row.id, delta: thought }))
                    thought = ""
                    thinkingSeen = false
                  }
                  if (delta) {
                    if (!acc.text) yield* store.markFirstToken(row.id)
                    acc.text += delta
                    yield* publish(chatId, ev("text", { turnId: row.id, delta }))
                    yield* store.savePartial(row.id, acc.text)
                    delta = ""
                  }
                  textOut += texts
                  texts = 0
                })
                for (const e of batch) {
                  if (e.type === "text") {
                    texts++
                    delta += e.delta
                    if (e.delta) timing.text(Date.now())
                  } else if (e.type === "thinking") {
                    timing.thinking(Date.now())
                    thinkingSeen = true
                    thought += e.delta ?? ""
                  }
                  else if (e.type === "done") acc.usage = { cachedTokens: 0, ...e.usage }
                  else if (e.type === "usage") {
                    // Past the agent's limit for one reply: it stops here, with what it has (Continue goes on).
                    if (agent?.replyTokens && e.usage.inputTokens + e.usage.outputTokens > agent.replyTokens) yield* Deferred.succeed(runaway, ErrorCode.replyLimit)
                  }
                  else if (e.type === "limits") {
                    if (account) yield* accounts.observe(account.id, e.windows)
                  } else if (e.type === "step") {
                    yield* flush
                    timing.step(Date.now())
                    yield* onStep(e.step)
                  }
                  else {
                    acc.error = e.message
                    failure = e.failure
                  }
                }
                yield* flush
              })
            )
          )
          // A loop or a run of failures: the turn ends with why (not a provider failure, so no failover).
          if (yield* Deferred.isDone(runaway)) {
            acc.error = yield* Deferred.await(runaway)
            failure = undefined
            yield* closeSession(key)
          } else if (yield* Deferred.isDone(stalled)) {
            acc.error = "The engine stopped responding."
            failure = { reason: "unavailable" }
            yield* closeSession(key) // its process is gone or stuck: the next turn opens a fresh one
          }
          return { failure, acted }
        }).pipe(Effect.scoped)

      yield* Effect.gen(function* () {
        const routes = routesOf(row, chat, agent, lead)
        const tried: string[] = []
        let actedAny = false
        for (let i = 0; i < routes.length; i++) {
          const r = routes[i]!
          const account = yield* accounts.resolve(r.model, r.accountId)
          const last = i === routes.length - 1
          // Held or recently failed: go straight to the next one (unless nothing else is left).
          const wait = held(r.model, account)
          if (wait && !last) {
            const next = routes[i + 1]!
            const sw: Switch = { fromModel: r.model, fromAccountId: account?.id ?? r.accountId, toModel: next.model, toAccountId: next.accountId, reason: wait.reason, until: wait.until }
            switches.push(sw)
            yield* publish(chatId, ev("failover", { turnId: row.id, switch: sw }))
            tried.push(`${r.model}: ${sw.reason}`)
            continue
          }
          route.model = r.model
          route.accountId = account?.id ?? r.accountId
          acc.error = undefined
          const result = yield* attempt(r.model, account)
          const error = acc.error as string | undefined // set by the attempt's stream
          if (!error) return
          const f = result.failure
          actedAny ||= result.acted
          tried.push(`${r.model}: ${f?.reason ?? "error"} (${error.split("\n")[0]})`)
          if (!f || result.acted || last) break
          // Failed before acting, for a reason another route can avoid: remember it and move on.
          if (f.reason === "limit" && account) yield* accounts.hold(account.id, f.until ?? Date.now() + 60 * 60_000)
          // The default login at its limit is held until the reset, like an account; other failures, SKIP_MS.
          else yield* setAside(routeKey(r.model, account), { until: f.reason === "limit" ? (f.until ?? Date.now() + 60 * 60_000) : Date.now() + SKIP_MS, reason: f.reason })
          const next = routes[i + 1]!
          const sw: Switch = { fromModel: r.model, fromAccountId: route.accountId, toModel: next.model, toAccountId: next.accountId, reason: f.reason, until: f.reason === "limit" ? (f.until ?? null) : null }
          switches.push(sw)
          yield* publish(chatId, ev("failover", { turnId: row.id, switch: sw }))
          yield* Effect.logInfo("failover", { from: r.model, to: next.model, reason: f.reason })
          acc.text = "" // nothing was acted on: the next route starts the reply over
          acc.steps.length = 0
          timing.reset()
          yield* store.savePartial(row.id, "")
        }
        // Several routes tried and all failed: say what happened on each.
        if (acc.error && tried.length > 1) acc.error = `${acc.error}\n\n${tried.join("\n")}`
        // Every route is at its usage limit: the chat continues by itself when the soonest one resets.
        // The routine tick sends the continuation; the chat shows it and can cancel it.
        if (acc.error && !actedAny) {
          const holds = yield* Effect.forEach(routes, (r) => Effect.map(accounts.resolve(r.model, r.accountId), (a) => held(r.model, a)))
          const resets = holds.flatMap((h) => (h?.reason === "limit" ? [h.until] : []))
          if (resets.length === holds.length && resets.length) yield* store.setResumeAt(chatId, Math.min(...resets))
        }
      }).pipe(Effect.onExit((exit) => (exit._tag === "Failure" ? save("interrupted", acc.error ?? ErrorCode.interrupted) : Effect.void)))
      yield* save(acc.error ? "failed" : "completed", acc.error ?? null)
      return acc.error ? undefined : { text: acc.text, agent, team }
    }).pipe(
      Effect.withSpan("turn", { attributes: { chatId: row.chatId, turnId: row.id, agentId: row.agentId ?? "", model: row.model } }),
      Effect.annotateLogs({ chatId: row.chatId, turnId: row.id })
    )

  // Mentions in the reply queue the teammates (chaining, up to MAX_DEPTH consecutive replies). An agent that hands
  // work over by mention gets a wrap-up turn once every teammate it called has answered (their answers read together),
  // unless one of them already called it back. Past the limit the chain stops and the chat says so.
  // routeTeamId: an @team call; the router picks among the team's members in the chat when it starts (a = the first).
  // outside: the turn handing off started with outside text (spec 011); what it hands off runs at "ask" too.
  const enqueueAgent = (chat: Chat, team: ReadonlyArray<Agent>, a: Agent, depth: number, routeTeamId?: string, outside = false) =>
    Effect.gen(function* () {
      const isLead = a.id === team[0]?.id // the lead follows the chat's model; other members, their own
      const t = yield* enqueue({ chatId: chat.id, agentId: a.id, model: isLead ? chat.model : a.model, accountId: isLead ? chat.accountId : a.accountId, clientId: null, depth, outside, ...(routeTeamId && { route: true, routeTeamId }) })
      yield* publish(chat.id, ev("queued", { turn: store.toTurn(t) }))
    })
  // The teams a text calls (spec 010), each as the first of its active members in the chat (none there: no call).
  // from: the agent handing off. A member's own team isn't called back (it would route to itself in a loop): it
  // names the teammate instead.
  const teamCalls = (chat: Chat, team: ReadonlyArray<Agent>, text: string, from?: string) =>
    Effect.gen(function* () {
      const called = mentionedTeams(text, teamsIn(yield* store.teams(), chat.projectId))
      return called.flatMap((t) => {
        const first = from && t.agentIds.includes(from) ? undefined : activeMembers(t, team)[0]
        return first ? [{ first, teamId: t.id }] : []
      })
    })
  const chain = (row: TurnRow, done: { text: string; agent: Agent | undefined; team: Agent[] } | undefined) =>
    Effect.gen(function* () {
      const chat = yield* store.chat(row.chatId)
      if (!chat) return
      const team = done?.team ?? (yield* members(store, chat))
      const wrap = wraps.get(row.chatId)
      const answering = !!wrap && !!row.agentId && wrap.waiting.has(row.agentId)
      if (answering) wrap!.waiting.delete(row.agentId!)
      // A teammate already given this work as a task (zorel_start_task) in this turn isn't called again by a mention
      // of it in the reply ("I've handed it to @tester"): one piece of work, one hand-off.
      const handed = tasked.get(row.id) ?? new Set<string>()
      tasked.delete(row.id)
      const next = done ? mentioned(done.text, team.filter((a) => a.id !== done.agent?.id && !handed.has(a.id))).slice(0, MAX_MENTIONS) : []
      // @team in a hand-off: one routed turn per team, among its members already here.
      const calls = done ? (yield* teamCalls(chat, team, done.text, done.agent?.id)).slice(0, MAX_MENTIONS - next.length) : []
      if (answering && next.some((a) => a.id === wrap!.askerId)) wrap!.covered = true
      if (calls.length && row.depth + 1 >= MAX_DEPTH) yield* Effect.logInfo("team call stopped at the limit", { chatId: row.chatId, depth: row.depth })
      else for (const c of calls) yield* enqueueAgent(chat, team, c.first, row.depth + 1, c.teamId, row.outside)
      if (next.length && row.depth + 1 >= MAX_DEPTH) {
        yield* Effect.logInfo("chaining stopped at the limit", { chatId: row.chatId, depth: row.depth })
        yield* publish(row.chatId, ev("handoff", { turnId: row.id, from: done?.agent?.id ?? null, to: [], via: "limit" }))
      } else if (next.length) {
        yield* publish(row.chatId, ev("handoff", { turnId: row.id, from: done?.agent?.id ?? null, to: next.map((a) => a.id), via: "mention" }))
        for (const a of next) yield* enqueueAgent(chat, team, a, row.depth + 1, undefined, row.outside)
        // A first hand-off (not one made while answering another) waits for its answers to come back.
        if (!answering && done?.agent && !wraps.has(row.chatId)) wraps.set(row.chatId, { askerId: done.agent.id, waiting: new Set(next.map((a) => a.id)), covered: false, depth: row.depth + 1 })
      }
      if (wrap && answering && wrap.waiting.size === 0) {
        wraps.delete(row.chatId)
        const asker = team.find((a) => a.id === wrap.askerId)
        if (asker && !wrap.covered && wrap.depth + 1 < MAX_DEPTH + 1) {
          yield* publish(row.chatId, ev("handoff", { turnId: row.id, from: done?.agent?.id ?? null, to: [asker.id], via: "reply" }))
          yield* enqueueAgent(chat, team, asker, wrap.depth + 1, undefined, row.outside)
        }
      }
    })

  // ---------- tasks between agents (zorel_start_task) ----------
  // outside (spec 011): asked from a turn that started with outside text; the task's turns run at "ask" too.
  const startTask = (origin: Chat, by: Agent | undefined, target: Agent, task: string, reply: boolean, outside = false) =>
    Effect.gen(function* () {
      const c = yield* store.createChat({
        // The asking chat's access level comes along: a chat's level covers the work it hands off, too.
        projectId: origin.projectId, agentIds: [target.id], model: target.model, accountId: target.accountId, effort: target.effort, access: origin.access,
        title: `${target.name}: ${task.replace(/\s+/g, " ").slice(0, 60)}`, taskOf: reply ? origin.id : null, taskBy: by?.id ?? null, parentId: origin.id,
        ownerId: (yield* store.chatAccess(origin.id))?.ownerId ?? null // a task is seen by whoever sees the chat it came from
      })
      const back = reply
        ? `Your final answer goes back to ${nameOf(by)}. Answer in this shape, short: Status: done | partial | blocked. Result: the result itself. Evidence: what you ran or read.`
        : "Nobody waits on the answer; just do the work."
      yield* addUserMessage(c.id, `Task from ${nameOf(by)}, in "${origin.title}":\n\n${task}\n\n${back}`, undefined, outside)
      yield* enqueueFor(c, task, null, outside)
      return c.id
    })

  // A task's queue drained: its last answer goes back to the chat that asked, as a message from the teammate, and
  // the asking agent takes the next turn there (or the chat's lead, if it left). Once per task.
  const reportTask = (chatId: string, done: { text: string; agent: Agent | undefined } | undefined) =>
    Effect.gen(function* () {
      const task = (yield* store.openTasks()).find((t) => t.id === chatId)
      if (!task?.taskOf) return
      yield* store.closeTask(chatId)
      const [origin, self] = [yield* store.chat(task.taskOf), yield* store.chat(chatId)]
      if (!origin || !self) return
      const link = `[Open the task](#/chat/${chatId})`
      const text = done?.text.trim() ? `${done.text.trim()}\n\n${link}` : `The task "${self.title}" ended without an answer. ${link}`
      const outside = yield* store.hasOutside(chatId) // a task started from outside text reports back as such (spec 011)
      const message = yield* store.addMessage({ chatId: origin.id, role: "assistant", agentId: done?.agent?.id ?? self.agentIds[0] ?? null, text, model: null, error: null, steps: [], inputTokens: 0, outputTokens: 0, outside })
      yield* publish(origin.id, ev("message", { message }))
      const team = yield* members(store, origin)
      const asker = team.find((a) => a.id === task.taskBy)
      const isLead = !asker || asker.id === team[0]?.id
      const t = yield* enqueue({
        chatId: origin.id, agentId: asker?.id ?? team[0]?.id ?? null, model: isLead ? origin.model : asker.model, accountId: isLead ? origin.accountId : asker.accountId, clientId: null, depth: 1, outside
      })
      yield* publish(origin.id, ev("queued", { turn: store.toTurn(t) }))
      yield* ensureWorker(origin.id)
    })

  // ---------- routing (router.ts) ----------
  // A turn marked to route: one cheap call picks who answers; the turn goes to that agent (the lead on any failure).
  const routeTurn = (row: TurnRow) =>
    Effect.gen(function* () {
      const chat = yield* store.chat(row.chatId)
      if (!chat) return row
      const members_ = yield* members(store, chat)
      // An @team call routes among that team's members in the chat; a team deleted meanwhile keeps the queued agent.
      const called = row.routeTeamId ? (yield* store.teams()).find((t) => t.id === row.routeTeamId) : undefined
      if (row.routeTeamId && !called) return { ...row, route: false }
      const team = called ? activeMembers(called, members_) : members_
      const recent = (yield* store.messages(chat.id)).slice(-ROUTER_MESSAGES - 1)
      const text = recent.at(-1)?.role === "user" ? recent.at(-1)!.text : ""
      yield* setStatus(chat.id, "running", row.agentId, "")
      const answer = yield* ask(routerModel(chat.model), routerPrompt(team, recent.slice(0, -1), text)).pipe(
        Effect.provide(services),
        Effect.timeoutOption("20 seconds"),
        Effect.map((o) => (o._tag === "Some" ? o.value.text : "")),
        Effect.catchCause(() => Effect.succeed(""))
      )
      const picked = parseRoute(answer, team)
      const agent = picked?.agent ?? team[0]
      if (!agent) return { ...row, route: false }
      const isLead = agent.id === members_[0]?.id // the chat's lead follows the chat's model
      const next = yield* store.retargetTurn(row.id, { agentId: agent.id, model: isLead ? chat.model : agent.model, accountId: isLead ? chat.accountId : agent.accountId })
      const reason = called ? [called.name, picked?.reason].filter(Boolean).join(" · ") : picked?.reason
      yield* publish(chat.id, ev("handoff", { turnId: row.id, from: null, to: [agent.id], via: "route", ...(reason && { reason }) }))
      return next
    })

  // ---------- per-chat worker ----------
  // One per chat with queued turns (spec 016). It starts every queued turn it can, a person's messages before
  // hand-offs, oldest first: at most one per agent (a later turn of a busy agent waits, so each agent's turns keep their
  // order), within the chat's limit (maxPerChat) and the global one (maxRunning, turns at work). Then it waits for a turn
  // to end or for something new (a kick) and looks again. A turn that ends saves its reply and queues its hand-offs
  // (chain) on its own, while the others go on. With one agent per chat this is the old one-turn-at-a-time loop.
  const worker = (chatId: string): Effect.Effect<void> =>
    Effect.gen(function* () {
      const self = workers.get(chatId)!
      const runs = runsOf(chatId)
      let last: { text: string; agent: Agent | undefined } | undefined
      let failed: string | null | undefined // the last turn to end failed: its agent (the chat rests "failed", not idle)
      // A turn's own fiber (Stop interrupts it) under a supervisor that, whatever happened, chains its hand-offs and
      // wakes the worker.
      const start = (row: TurnRow) =>
        Effect.gen(function* () {
          const fiber = yield* Effect.forkDetach(runTurn(row))
          runs.set(row.id, { agentId: row.agentId, fiber })
          yield* Effect.forkDetach(
            Effect.gen(function* () {
              const done = yield* Fiber.join(fiber).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
              runs.delete(row.id)
              writers.delete(row.id)
              last = done
              failed = (yield* store.turnRow(row.id))?.state === "failed" ? (row.agentId ?? null) : undefined
              yield* clearStatus(chatId, row.agentId)
              yield* chain(row, done) // also when it failed: a hand-off waiting on it must not wait forever
            }).pipe(Effect.ensuring(Effect.suspend(() => Effect.andThen(wake(self), freeSlots))))
          )
        })
      while (true) {
        const hold = holding.get(chatId)
        if (hold) yield* Deferred.await(hold) // a "send now" is queueing its message: it goes before whatever is queued
        self.kicked = false
        const signal = self.signal
        const busy = new Set([...runs.values()].map((r) => r.agentId ?? "-"))
        const queued = yield* store.queuedTurns(chatId)
        let blocked = false // a queued turn waits only for the global limit
        for (const turn of queued) {
          if (maxPerChat > 0 && runs.size >= maxPerChat) break
          if (full()) {
            blocked = true
            break
          }
          // Routed turns learn their agent first (one cheap call), so the one-per-agent rule sees the real one.
          const row = turn.route ? yield* routeTurn(turn) : turn
          const key = row.agentId ?? "-"
          if (busy.has(key)) continue
          busy.add(key)
          if (!(yield* placed(row, runs))) continue // waits for a writer in its folder (placed says so)
          yield* start(row)
        }
        if (!runs.size) {
          if (self.kicked) continue
          if (blocked) {
            // Nothing of this chat at work and no place free: it waits in line, as a whole chat did before.
            if (!waitingSlot.includes(chatId)) waitingSlot.push(chatId)
            yield* setStatus(chatId, "running", null, WAITING_SLOT)
            workers.delete(chatId)
            return
          }
          break
        }
        if (!self.kicked) yield* Deferred.await(signal)
        self.signal = yield* Deferred.make<void>()
      }
      yield* reportTask(chatId, last)
      workers.delete(chatId)
      // A failed last turn leaves the chat "failed" (the sidebar says so) until its next turn starts.
      yield* setStatus(chatId, failed === undefined ? "idle" : "failed", failed ?? null, "")
      yield* Effect.forkDetach(consolidate(chatId, "window", (saved) => remembered(chatId, saved)).pipe(Effect.provide(services), quietly("consolidation", chatId)))
      yield* learnWhenQuiet(chatId)
    }).pipe(Effect.ensuring(Effect.suspend(() => {
      if (!running.get(chatId)?.size) running.delete(chatId)
      return freeSlots
    })))
  // Where a turn may work (spec 016). An agent that may edit on its own (Workspace or Full) in a folder another of this
  // chat's turns is editing right now moves to a git worktree of its own (folder + branch), kept for its next turns in
  // this chat until the person merges or discards it; where there's no git, it waits for that turn (false). Asking
  // agents (each edit approved) and readers work alongside. `writers`: running turn → the folder it edits.
  const writers = new Map<string, string>()
  const placed = (row: TurnRow, runs: ReadonlyMap<string, { agentId: string | null }>) =>
    Effect.gen(function* () {
      const chat = yield* store.chat(row.chatId)
      const project = chat?.projectId ? yield* store.project(chat.projectId) : undefined
      if (!chat || !project?.path) return true
      const agent = (yield* members(store, chat)).find((a) => a.id === row.agentId)
      const access = turnAccess(chat, agent, row)
      if (access !== "workspace" && access !== "full") return true
      const folder = projectFor(chat, project, row.agentId)!.path!
      const holder = [...runs.keys()].find((id) => writers.get(id) === folder)
      if (!holder) {
        writers.set(row.id, folder)
        return true
      }
      const other = nameOf((yield* members(store, chat)).find((a) => a.id === runs.get(holder)?.agentId))
      const own = agent && (yield* Effect.promise(() => Git.isRepo(folder)))
        ? yield* Effect.tryPromise(async () => {
            const handle = handleOf(agent)
            const wt = { path: join(dataDir, "worktrees", project.id, `${chat.id}-${handle}`), branch: `zorel/${chat.id.slice(0, 8)}-${handle}` }
            await Git.addWorktree(folder, wt.path, wt.branch)
            return wt
          }).pipe(Effect.tapError((e) => Effect.logWarning("agent worktree not created; the turn waits", { chatId: chat.id, agentId: agent.id, error: String(e) })), Effect.option)
        : undefined
      if (own?._tag === "Some" && agent) {
        yield* store.setAgentWorktree(chat.id, agent.id, own.value)
        writers.set(row.id, own.value.path)
        yield* publish(chat.id, ev("worktree", { agentId: agent.id, worktree: own.value }))
        return true
      }
      yield* setStatus(chat.id, "running", row.agentId, `${nameOf(agent)} waits for ${other} to finish editing`)
      return false
    })
  const wake = (w: { kicked: boolean; signal: Deferred.Deferred<void> }) =>
    Effect.suspend(() => {
      w.kicked = true
      return Deferred.succeed(w.signal, undefined).pipe(Effect.asVoid)
    })

  // A chat that stays quiet for QUIET_AFTER learns from its latest messages (consolidate "quiet"), so a short chat
  // learns without waiting for its window to fill. Any new turn calls it off; the next idle schedules it again.
  // ponytail: in memory, so a restart drops what was scheduled; the next quiet spell covers those messages.
  const quietTimers = new Map<string, Fiber.Fiber<void>>()
  const calmOff = (chatId: string) =>
    Effect.suspend(() => {
      const f = quietTimers.get(chatId)
      quietTimers.delete(chatId)
      return f ? Fiber.interrupt(f).pipe(Effect.asVoid) : Effect.void
    })
  const learnWhenQuiet = (chatId: string) =>
    Effect.gen(function* () {
      yield* calmOff(chatId)
      // A finished one stays in the map until the chat's next turn: interrupting it then is a no-op.
      quietTimers.set(chatId, yield* Effect.forkDetach(Effect.sleep(QUIET_AFTER).pipe(Effect.andThen(consolidate(chatId, "quiet", (saved) => remembered(chatId, saved)).pipe(Effect.provide(services), quietly("quiet consolidation", chatId))))))
    })

  const PAUSED_KEY = "paused"
  let paused = (yield* store.preference(PAUSED_KEY)) === "1"
  // How many agents may be at work at once, across chats (Settings › General; 0 = no limit). A turn over the limit
  // stays queued; a chat with nothing at work waits in line, oldest first, until a turn ends (each agent is a CLI
  // process and spends from the subscription). maxPerChat caps one chat's agents at once (0 = no limit).
  let maxRunning = parseMaxRunning(yield* store.preference(MAX_RUNNING_KEY))
  let maxPerChat = parseMaxPerChat(yield* store.preference(MAX_PER_CHAT_KEY))
  const waitingSlot: string[] = []
  const full = () => maxRunning > 0 && atWork() >= maxRunning
  const ensureWorker = (chatId: string): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (paused) return // the turn stays queued until resume
      const w = workers.get(chatId)
      if (w) return yield* wake(w)
      if (full()) {
        if (waitingSlot.includes(chatId)) return
        waitingSlot.push(chatId)
        return yield* setStatus(chatId, "running", null, WAITING_SLOT)
      }
      const inLine = waitingSlot.indexOf(chatId)
      if (inLine >= 0) waitingSlot.splice(inLine, 1)
      workers.set(chatId, { kicked: false, signal: yield* Deferred.make<void>() })
      yield* calmOff(chatId)
      yield* Effect.forkDetach(worker(chatId))
    })
  // A place freed (a turn ended, or a limit went up): chats waiting in line start, oldest first, and every worker
  // looks again (one may have a turn waiting for a place).
  const freeSlots: Effect.Effect<void> = Effect.gen(function* () {
    if (paused) return
    for (const w of workers.values()) yield* wake(w)
    while (waitingSlot.length && !full()) yield* ensureWorker(waitingSlot[0]!)
  })

  // ---------- boot recovery ----------
  // A `running` turn with no process becomes `interrupted` with the partial text; never repeats an uncertain side effect.
  for (const row of yield* store.turnsIn("running")) {
    const message = yield* store.addMessage({ chatId: row.chatId, role: "assistant", agentId: row.agentId, text: row.partialText, model: row.model, error: ErrorCode.serverRestarted, steps: [], inputTokens: 0, outputTokens: 0 })
    yield* store.finishTurn(row.id, { state: "interrupted", error: ErrorCode.serverRestarted, messageId: message.id })
  }
  for (const a of yield* store.openApprovals()) yield* store.resolveApproval(a.id, "expired", null, "expiry")
  for (const chatId of new Set((yield* store.turnsIn("queued")).map((t) => t.chatId))) yield* ensureWorker(chatId)

  const addUserMessage = (chatId: string, text: string, attachmentIds?: ReadonlyArray<string>, outside = false) =>
    Effect.gen(function* () {
      const message = yield* store.addMessage({ chatId, role: "user", agentId: null, text, model: null, error: null, steps: [], inputTokens: 0, outputTokens: 0, attachmentIds, outside })
      yield* publish(chatId, ev("message", { message }))
    })
  // A message that names no one, right after you spoke to a teammate by name and it answered: it goes on with that
  // teammate (a follow-up), not back to the lead. Your current message is the last one; the one before decides.
  const followUp = (chat: Chat, team: ReadonlyArray<Agent>) =>
    Effect.gen(function* () {
      if (team.length < 2) return undefined
      const recent = (yield* store.messages(chat.id)).slice(-20)
      const mine = recent.flatMap((m, i) => (m.role === "user" ? [i] : []))
      const before = mine.at(-2)
      if (before === undefined) return undefined
      const named = mentioned(recent[before]!.text, team)
      const answered = recent.slice(before + 1, mine.at(-1)).filter((m) => m.role === "assistant").at(-1)
      const who = named.find((a) => a.id === answered?.agentId)
      return who && who.id !== team[0]?.id ? who : undefined
    })
  // Who answers this text: the mentioned members, else the one a follow-up goes to, else the lead (the router picks
  // when a team has no one named: `route`).
  const recipientsOf = (chat: Chat, text: string) =>
    Effect.gen(function* () {
      const team = yield* members(store, chat)
      const lead = team[0]
      const targets: Array<Agent | undefined> = mentioned(text, team).slice(0, MAX_MENTIONS)
      const calls = (yield* teamCalls(chat, team, text)).slice(0, MAX_MENTIONS - targets.length)
      const named = targets.length + calls.length > 0
      const follow = named ? undefined : yield* followUp(chat, team)
      const route = !named && !follow && team.length > 1
      if (!named) targets.push(follow ?? lead)
      return { lead, targets, route, calls }
    })
  // Queues a turn for each recipient, except `joined`: the agents whose running turns already took the message.
  const enqueueRecipients = (chat: Chat, plan: { lead: Agent | undefined; targets: ReadonlyArray<Agent | undefined>; route: boolean; calls: ReadonlyArray<{ first: Agent; teamId: string }> }, clientId: string | null, joined?: ReadonlyArray<string | null>, outside = false) =>
    Effect.gen(function* () {
      let first: string | undefined
      for (const a of plan.targets) {
        if (joined?.includes(a?.id ?? null)) continue
        // The leader uses the chat model (the one you picked); other members use their own.
        const isLead = !a || a.id === plan.lead?.id
        const t = yield* enqueue({
          chatId: chat.id, agentId: a?.id ?? null, model: isLead ? chat.model : a.model, accountId: isLead ? chat.accountId : a.accountId,
          clientId: first === undefined ? clientId : null, depth: 0, route: plan.route, outside
        })
        first ??= t.id
        yield* publish(chat.id, ev("queued", { turn: store.toTurn(t) }))
      }
      // Each @team: one turn the router gives to the member who fits (the first one on any failure).
      for (const c of plan.calls) {
        const isLead = c.first.id === plan.lead?.id
        const t = yield* enqueue({
          chatId: chat.id, agentId: c.first.id, model: isLead ? chat.model : c.first.model, accountId: isLead ? chat.accountId : c.first.accountId,
          clientId: first === undefined ? clientId : null, depth: 0, route: true, routeTeamId: c.teamId, outside
        })
        first ??= t.id
        yield* publish(chat.id, ev("queued", { turn: store.toTurn(t) }))
      }
      yield* ensureWorker(chat.id)
      return first
    })
  // Queues who answers this text: the mentioned members, or the lead.
  const enqueueFor = (chat: Chat, text: string, clientId: string | null, outside = false) =>
    recipientsOf(chat, text).pipe(Effect.flatMap((plan) => enqueueRecipients(chat, plan, clientId, undefined, outside)), Effect.map((id) => id!))

  // ---------- API ----------
  const service: RuntimeService = {
    liveSessions: () =>
      [...sessions.entries()].map(([key, live]) => {
        const [chatId = "", agentId = "-"] = key.split(":")
        return { key, chatId, agentId: agentId === "-" ? null : agentId, provider: live.provider, usedAt: live.used, pid: live.session.pid?.() }
      }),
    closeSession: (key) => (running.get(key.split(":")[0] ?? "")?.size ? Effect.void : closeSession(key)), // never under a running turn
    send: (input, opts) =>
      Effect.gen(function* () {
        const outside = opts?.outside === true
        const existing = yield* store.turnByClientId(input.clientId)
        if (existing) return { turnId: existing.id } // resending the same clientId doesn't duplicate
        let chat = yield* store.chat(input.chatId)
        if (!chat) return yield* new ChatNotFound({ chatId: input.chatId })
        if (!(yield* members(store, chat)).length) return yield* new ChatNeedsAgent({ chatId: chat.id }) // nothing answers anonymously
        if (opts?.personId) speaker.set(chat.id, opts.personId) // the turns this message starts speak for them
        if (input.model && input.model !== chat.model) chat = (yield* store.updateChat(chat.id, { model: input.model }))!
        if (chat.title === "New chat" || chat.title === "Novo chat") chat = (yield* store.updateChat(chat.id, { title: input.text.replace(/\s+/g, " ").slice(0, 60) }))!
        if (chat.resumeAt && !input.clientId.startsWith("resume:")) yield* store.setResumeAt(chat.id, null) // you went on yourself
        yield* addUserMessage(chat.id, input.text, input.attachmentIds, outside)
        return { turnId: yield* enqueueFor(chat, input.text, input.clientId, outside) }
      }),

    // "Send now". The message goes into the running reply only if that reply is the recipient's own (the one named, or
    // the lead when no one is) and the engine takes it; the others named in it are queued. Otherwise the running reply
    // is stopped and the message becomes the recipient's turn, ahead of the queued hand-offs (your messages go first).
    steer: (chatId, text, attachmentIds) =>
      Effect.gen(function* () {
        const chat = yield* store.chat(chatId)
        if (!chat) return yield* new ChatNotFound({ chatId })
        const plan = yield* recipientsOf(chat, text)
        // Only the recipients' replies are touched (spec 016): the other agents at work go on.
        const to = new Set(plan.targets.map((a) => a?.id ?? null))
        // Images can't join a running turn: with attachments the message goes as a turn of its own.
        const lives = attachmentIds?.length ? [] : [...to].flatMap((id) => steering.get(steerKey(chatId, id)) ?? [])
        const joined: Array<string | null> = []
        for (const live of lives) if (yield* Effect.promise(() => live.steer(text))) joined.push(live.agentId)
        if (joined.length) {
          yield* addUserMessage(chatId, text, attachmentIds) // it joins those running turns
          yield* enqueueRecipients(chat, plan, null, joined)
          return { joined: true }
        }
        // Not taken mid-turn: the recipients' running turns are stopped first and waited for, so their partial replies
        // are saved before this message (the history stays in order). The worker is held meanwhile, or it would start
        // the next queued hand-off before this message is queued. A stopped turn's partial text calls no one by mention.
        const fibers = [...(running.get(chatId)?.values() ?? [])].filter((r) => to.has(r.agentId)).map((r) => r.fiber)
        const hold = fibers.length ? yield* Deferred.make<void>() : undefined
        if (hold) holding.set(chatId, hold)
        yield* Effect.gen(function* () {
          for (const fiber of fibers) yield* Fiber.interrupt(fiber)
          yield* addUserMessage(chatId, text, attachmentIds)
          yield* enqueueRecipients(chat, plan, null)
        }).pipe(
          Effect.ensuring(
            Effect.suspend(() => {
              if (!hold) return Effect.void
              holding.delete(chatId)
              return Deferred.succeed(hold, undefined)
            })
          )
        )
        return { joined: false }
      }),

    interrupt: (chatId, turnId) =>
      Effect.gen(function* () {
        // One reply: that turn stops (or, still queued, never starts); the others go on.
        if (turnId) {
          const run = running.get(chatId)?.get(turnId)
          if (run) return yield* Fiber.interrupt(run.fiber)
          const queued = (yield* store.activeTurns(chatId)).find((t) => t.id === turnId && t.state === "queued")
          if (queued) yield* publish(chatId, ev("interrupted", { turn: yield* store.finishTurn(queued.id, { state: "interrupted", error: ErrorCode.cancelled, messageId: null }), message: null }))
          return
        }
        // Stopped while waiting for a free slot: it leaves the line (nothing of it ran).
        const inLine = waitingSlot.indexOf(chatId)
        if (inLine >= 0) {
          waitingSlot.splice(inLine, 1)
          yield* setStatus(chatId, "idle", null, "")
        }
        for (const t of (yield* store.activeTurns(chatId)).filter((t) => t.state === "queued")) {
          const turn = yield* store.finishTurn(t.id, { state: "interrupted", error: ErrorCode.cancelled, messageId: null })
          yield* publish(chatId, ev("interrupted", { turn, message: null }))
        }
        for (const run of [...(running.get(chatId)?.values() ?? [])]) yield* Fiber.interrupt(run.fiber)
      }),

    remembered,
    forget: (chatId) => Effect.forEach([...sessions.keys()].filter((k) => k.startsWith(`${chatId}:`)), closeSession, { discard: true }),
    // A reply that failed, was stopped or passed its limit: the same agent answers again (the chat's lead if it left
    // the chat or was archived), as a turn of its own after what's queued. The conversation is its context.
    preview: (chatId, input) =>
      Effect.gen(function* () {
        const chat = yield* store.chat(chatId)
        if (!chat) return yield* new ChatNotFound({ chatId })
        return yield* Effect.promise(async () => {
          const plan = await planPreview(chat, input)
          if (typeof plan === "string") return { error: plan }
          const known = runningPreview(plan)
          const r = known ? { port: known } : await launchPreview(chat, plan)
          if ("error" in r) return { error: r.tail ? `${r.error}:\n${r.tail}` : r.error }
          return { url: previewUrl(r.port, undefined) }
        })
      }),
    retry: (chatId, messageId) =>
      Effect.gen(function* () {
        const chat = yield* store.chat(chatId)
        if (!chat) return yield* new ChatNotFound({ chatId })
        const m = (yield* store.messages(chatId)).find((x) => x.id === messageId)
        if (!m || m.role !== "assistant" || !m.error) return
        const team = yield* members(store, chat)
        const lead = team[0]
        const who = team.find((a) => a.id === m.agentId) ?? lead
        const isLead = !who || who.id === lead?.id
        const t = yield* enqueue({ chatId, agentId: who?.id ?? null, model: isLead ? chat.model : who.model, accountId: isLead ? chat.accountId : who.accountId, clientId: null, depth: 0 })
        yield* publish(chatId, ev("queued", { turn: store.toTurn(t) }))
        yield* ensureWorker(chatId)
      }),
    paused: () => paused,
    setMaxRunning: (max) =>
      Effect.gen(function* () {
        maxRunning = Math.max(0, Math.floor(max))
        yield* store.setPreference(MAX_RUNNING_KEY, String(maxRunning))
        yield* freeSlots // a higher limit lets the ones in line start now
      }),
    setMaxPerChat: (max) =>
      Effect.gen(function* () {
        maxPerChat = Math.max(0, Math.floor(max))
        yield* store.setPreference(MAX_PER_CHAT_KEY, String(maxPerChat))
        yield* freeSlots // a higher cap lets a chat's waiting agents start now
      }),
    setPaused: (next) =>
      Effect.gen(function* () {
        paused = next
        yield* store.setPreference(PAUSED_KEY, next ? "1" : "0")
        if (next) {
          for (const runs of [...running.values()]) for (const run of [...runs.values()]) yield* Fiber.interrupt(run.fiber)
        } else for (const chatId of new Set((yield* store.turnsIn("queued")).map((t) => t.chatId))) yield* ensureWorker(chatId)
      }),

    decide: (approvalId, outcome, reason, overrides) =>
      Effect.gen(function* () {
        const a = yield* store.resolveApproval(approvalId, outcome, reason ?? null, "user")
        if (!a) return yield* new ApprovalNotFound({ approvalId })
        yield* audit.record(outcome === "denied" ? Actions.approvalDenied : Actions.approvalApproved, {
          target: { id: a.id, name: a.summary },
          after: { tool: a.tool, chatId: a.chatId, agentId: a.agentId },
          ...(reason && { reason })
        })
        // "Always allow": the rule goes on the agent (its Tools tab lists it, with a way to take it back).
        if (outcome === "always" && a.alwaysKey && a.agentId) {
          const target = yield* store.agent(a.agentId)
          if (target) yield* store.updateAgent(target.id, { permissions: withAlways(permissionsOf(target), a.alwaysKey) })
        }
        const d = waiting.get(approvalId)
        if (d) yield* Deferred.succeed(d, { outcome, reason: reason?.trim() || null, overrides: overrides ?? [] })
        yield* publish(a.chatId, ev("approval-resolved", { approvalId, outcome, reason: reason ?? null, by: "user" }))
      }),

    requestApproval: (req) =>
      Effect.gen(function* () {
        const wait = req.expiresMs ?? APPROVAL_MS
        const approval = yield* store.addApproval({
          chatId: req.chatId, turnId: null, runStepId: req.runStepId, stepId: null, agentId: req.agentId, kind: req.kind, tool: req.tool,
          summary: req.summary, args: req.args, cwd: null, alwaysKey: req.agentId ? req.alwaysKey : null, expiresAt: Date.now() + wait
        })
        const d = yield* Deferred.make<Decision>()
        waiting.set(approval.id, d)
        yield* publish(req.chatId, ev("approval", { approval }))
        if (req.notify) yield* req.notify(approval).pipe(Effect.catchCause((c) => Effect.logWarning("approval notice failed", String(c))))
        // The person's words with the decision ("Edit the text first" on an Ask me) come with it.
        const { outcome, reason } = yield* Deferred.await(d).pipe(
          Effect.timeoutOption(Duration.millis(wait)),
          Effect.flatMap((o) => (o._tag === "Some" ? Effect.succeed(o.value) : expire(req.chatId, approval.id))),
          Effect.ensuring(Effect.sync(() => waiting.delete(approval.id)))
        )
        return { outcome, reason }
      }),

    subscribeChat: (chatId) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const chat = yield* store.chat(chatId)
          if (!chat) return yield* new ChatNotFound({ chatId })
          // Subscribe before the snapshot: no event falls in the gap.
          const sub = yield* PubSub.subscribe(hubOf(chatId))
          const turns = yield* store.activeTurns(chatId)
          const runningIds = turns.filter((t) => t.state === "running").map((t) => t.id)
          const partial = []
          for (const id of runningIds) partial.push({ turnId: id, text: (yield* store.turnRow(id))?.partialText ?? "" })
          const snapshot = {
            messages: yield* store.messagesAfter(chatId, chat.summaryUntil),
            turns,
            partial,
            steps: yield* store.stepsOf(runningIds),
            approvals: yield* store.openApprovals(chatId),
            status: { ...(statuses.get(chatId) ?? idle(chatId)), waits: yield* waitsOf(chatId) } // tasks outlive a restart
          }
          return Stream.concat(Stream.make(ev("snapshot", { snapshot })), Stream.fromSubscription(sub))
        })
      ),

    busy: (chatId) => statuses.get(chatId)?.state === "running",
    agentBusy: (chatId, agentId) => [...(running.get(chatId)?.values() ?? [])].some((r) => r.agentId === agentId),

    release: (chatId) =>
      Effect.suspend(() => {
        const now = Date.now()
        for (const [id, at] of gone) if (now - at > 60 * 60_000) gone.delete(id)
        gone.set(chatId, now)
        statuses.delete(chatId)
        const h = hubs.get(chatId)
        hubs.delete(chatId)
        const sessionsGo = Effect.forEach([...sessions.keys()].filter((k) => k.startsWith(`${chatId}:`)), closeSession, { discard: true })
        return h ? Effect.andThen(PubSub.shutdown(h), sessionsGo) : sessionsGo
      }),

    finished: Stream.unwrap(Effect.map(PubSub.subscribe(finishedHub), Stream.fromSubscription)),

    subscribeStatus: Stream.unwrap(
      Effect.gen(function* () {
        const sub = yield* PubSub.subscribe(statusHub)
        return Stream.concat(Stream.fromIterable([...statuses.values()]), Stream.fromSubscription(sub))
      })
    )
  }
  // Facts kept before the memory's map existed are filed on it in the background, a little after start.
  yield* Effect.forkDetach(Effect.sleep("20 seconds").pipe(Effect.andThen(mapEarlierFacts()), Effect.provide(services), quietly("memory map backfill")))
  // Recall by meaning: the local model loads (and downloads once) in the background; turns never wait for it.
  if (process.env.NODE_ENV !== "test") yield* Effect.forkDetach(Effect.promise(() => startVectors(dataDir))) // tests never download it
  // The map sleeps once a day (and a little after start): orphan points go, twins merge. A failed night is logged and
  // the next one still comes (sleepMap dies on a database error, which would otherwise end the repeat).
  const sleep = store.sleepMap().pipe(Effect.catchCause((cause) => Effect.logWarning("memory map sleep failed", { cause: String(cause) })))
  yield* Effect.forkDetach(Effect.sleep("1 minute").pipe(Effect.andThen(Effect.repeat(sleep, Schedule.spaced("1 day"))), Effect.ignore))
  return service
})

export class Runtime extends Context.Service<Runtime, RuntimeService>()("Runtime") {
  static layer = Layer.effect(Runtime, makeRuntime)
}

export type { Turn }
export type { Repository }

// A browser step, in words, for the chat's activity and an approval card.
function browserStepTitle(name: string, args: Record<string, unknown>): string {
  const s = (v: unknown) => (typeof v === "string" ? v : "")
  if (name === "browser_navigate") return `Open ${s(args.url)}`
  if (name === "browser_click") return `Click ${s(args.element) || s(args.ref)}`
  if (name === "browser_type") return `Type into ${s(args.ref)}`
  if (name === "browser_press") return `Press ${s(args.key)}`
  if (name === "browser_snapshot") return "Read the page"
  if (name === "browser_wait") return s(args.text) ? `Wait for "${s(args.text)}"` : "Wait"
  if (name === "browser_back") return "Go back"
  if (name === "browser_hover") return `Hover ${s(args.ref)}`
  if (name === "browser_select") return `Choose an option in ${s(args.ref)}`
  if (name === "browser_scroll") return "Scroll"
  if (name === "browser_upload") return `Upload ${Array.isArray(args.paths) ? args.paths.join(", ") : "files"}`
  if (name === "browser_dialog") return args.accept === true ? "Accept the next dialog" : "Dismiss the next dialog"
  if (name === "browser_run") return `Run ${Array.isArray(args.steps) ? args.steps.length : 0} browser steps`
  return "Browser tabs"
}

