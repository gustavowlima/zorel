// Native Codex session (ARCHITECTURE §6, adapter `codex-app-server`): one `codex app-server` process
// per (chat, agent) speaking JSON-RPC over stdio, one thread kept across turns.
// Minimal hand-written client (D16 revised): only the methods and fields Zorel uses; unknown fields are
// ignored, so protocol changes elsewhere don't break us. Robustness:
// per-request timeouts, a dead process fails the turn, a line-size cap.
// Isolation: CODEX_HOME is a Zorel-owned folder, so the user's config.toml (MCP servers, AGENTS.md,
// memories) never reaches Zorel's agents (D8). Zorel never reads the login inside it.
import { Effect, Queue, Stream } from "effect"
import { mkdirSync } from "node:fs"
import type { Access, AccountWindow, FailureReason } from "@zorel/contracts"
import { basename, relative } from "node:path"
import { type CliModel, classifyMessage, CODEX_DISABLED, commandStep, type EngineEvent, type EngineFailure, type NativeStep, splitModel, STEP_DETAIL_MAX, STEP_TITLE_MAX, toMillis, type Usage } from "#server/engines.ts"
import { approvalFor } from "#server/engines/policy.ts"
import { type Approver, type EngineSession, GATEWAY_TOOL_TIMEOUT_MS, type SessionTurnInput, withoutAppEnv } from "#server/engines/session.ts"
import { which } from "../cli/index.ts"

// Access level → Codex sandbox and approval policy (ARCHITECTURE §9.2). The shell is on in the app-server:
// commands run in Codex's sandbox and what leaves it asks through Zorel.
const SANDBOX: Record<Access, string> = { workspace: "workspace-write", ask: "read-only", full: "danger-full-access" }
// "Ask first": untrusted asks before every command that isn't a known read, as the other engines ask for each one.
// On Windows Codex's own sandbox is experimental: below full access it reads only, and each write asks through Zorel.
export const sandboxFor = (access: Access, platform: string = process.platform) => (platform === "win32" && access === "workspace" ? SANDBOX.ask : SANDBOX[access])
const APPROVAL: Record<Access, string> = { workspace: "on-request", ask: "untrusted", full: "never" }
// A function, not a constant: engines.ts imports this module, so CODEX_DISABLED isn't ready at load time.
const appServerDisabled = () => CODEX_DISABLED.filter((f) => f !== "shell_tool" && f !== "unified_exec")

// Codex items as steps: a command or a file change starts with item/started and ends with item/completed.
export function codexStep(item: Json, cwd: string): NativeStep | undefined {
  const done = (s: unknown) => (s === "completed" ? "ok" : s === "declined" ? "refused" : s === "failed" ? "error" : "running") as NativeStep["status"]
  if (item?.type === "commandExecution")
    return { id: String(item.id), kind: "run", ...commandStep(String(item.command ?? "")), files: [], status: done(item.status), output: String(item.aggregatedOutput ?? "").slice(0, 4000) }
  if (item?.type === "fileChange") {
    const files = (item.changes ?? []).map((c: Json) => relative(cwd, String(c.path)) || String(c.path))
    return { id: String(item.id), kind: "edit", title: `Edit ${files.map((f: string) => basename(f)).join(", ")}`.slice(0, STEP_TITLE_MAX), detail: files.join(", ").slice(0, STEP_DETAIL_MAX), files, status: done(item.status), output: "" }
  }
  return undefined
}

const REQUEST_TIMEOUT_MS = 60_000
const INTERRUPT_GRACE_MS = 5_000
const MAX_LINE = 16 * 1024 * 1024

type Json = Record<string, any>

// JSON-RPC over the child's stdio, one JSON object per line.
class Rpc {
  private id = 0
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: Timer }>()
  private stderr = ""
  exited: string | undefined
  onNotification: (method: string, params: Json) => void = () => {}
  // Requests from Codex (approvals). Returns the JSON-RPC result; undefined: not supported.
  onRequest: (method: string, params: Json) => Promise<Json | undefined> = async () => undefined
  onExit: () => void = () => {}

  private constructor(private proc: Bun.Subprocess<"pipe", "pipe", "pipe">) {}

  static start(bin: string, args: string[], cwd: string, env: Record<string, string>) {
    const rpc = new Rpc(Bun.spawn([bin, ...args], { cwd, env, stdin: "pipe", stdout: "pipe", stderr: "pipe" }))
    void rpc.read()
    void new Response(rpc.proc.stderr).text().then((t) => {
      rpc.stderr = t.trim().split("\n").slice(-5).join("\n")
    })
    void rpc.proc.exited.then((code) => rpc.fail(`codex app-server exited (code ${code}).${rpc.stderr ? `\n${rpc.stderr}` : ""}`))
    return rpc
  }

  request(method: string, params: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<any> {
    if (this.exited) return Promise.reject(new Error(this.exited))
    const id = ++this.id
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`codex app-server didn't answer ${method} in ${timeoutMs / 1000}s.`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.write({ id, method, params })
    })
  }

  notify(method: string, params?: unknown) {
    this.write(params === undefined ? { method } : { method, params })
  }

  get pid() {
    return this.proc.pid
  }
  kill() {
    this.proc.kill()
  }

  private write(m: object) {
    if (!this.exited) this.proc.stdin.write(`${JSON.stringify(m)}\n`)
  }

  private fail(reason: string) {
    if (this.exited) return
    this.exited = reason
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(new Error(reason))
    }
    this.pending.clear()
    this.onExit()
  }

  private async read() {
    let buf = ""
    try {
      for await (const chunk of this.proc.stdout.pipeThrough(new TextDecoderStream())) {
        buf += chunk
        if (buf.length > MAX_LINE) return this.fail("codex app-server sent a line that is too long.")
        for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
          const line = buf.slice(0, nl)
          buf = buf.slice(nl + 1)
          if (line.trim()) this.dispatch(line)
        }
      }
    } catch (e) {
      this.fail(`codex app-server: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  private dispatch(line: string) {
    let m: Json
    try {
      m = JSON.parse(line)
    } catch {
      return // not ours to interpret (e.g. a stray log line)
    }
    if (m.id !== undefined && m.method === undefined) {
      const p = this.pending.get(m.id)
      if (!p) return
      this.pending.delete(m.id)
      clearTimeout(p.timer)
      if (m.error) p.reject(new Error(m.error.message ?? "codex app-server error"))
      else p.resolve(m.result)
    } else if (m.id !== undefined) {
      // A request from Codex (approvals, user input): answered when the person decides.
      const id = m.id
      void this.onRequest(m.method, m.params ?? {}).then(
        (result) => this.write(result === undefined ? { id, error: { code: -32601, message: "not supported by Zorel" } } : { id, result }),
        () => this.write({ id, result: { decision: "decline" } })
      )
    } else if (m.method) this.onNotification(m.method, m.params ?? {})
  }
}

// codexErrorInfo (app-server protocol) → failover reason; content and request errors don't switch.
const CODEX_ERRORS: Record<string, FailureReason> = {
  usageLimitExceeded: "limit", rateLimitExceeded: "rate_limit", unauthorized: "auth",
  serverOverloaded: "unavailable", internalServerError: "unavailable", flexUnavailable: "unavailable",
  httpConnectionFailed: "network", responseStreamConnectionFailed: "network", responseStreamDisconnected: "network", responseTooManyFailedAttempts: "network"
}
const errorKey = (info: unknown) => (typeof info === "string" ? info : info && typeof info === "object" ? Object.keys(info)[0] : undefined)

// A window known by its length: Codex's 5-hour and weekly ones get the same ids as Claude's.
const windowId = (minutes: unknown) => (minutes === 300 ? "five_hour" : minutes === 10_080 ? "seven_day" : typeof minutes === "number" ? `${minutes}m` : "window")

// The windows of a rate-limit snapshot (primary, secondary).
export function windowsOf(snapshot: Json | undefined): AccountWindow[] {
  return [snapshot?.primary, snapshot?.secondary]
    .filter((w): w is Json => !!w && typeof w.usedPercent === "number")
    .map((w) => ({ id: windowId(w.windowDurationMins), usedPercent: w.usedPercent, resetsAt: typeof w.resetsAt === "number" ? toMillis(w.resetsAt) : null }))
}

export function codexFailure(error: Json | undefined, windows: ReadonlyArray<AccountWindow>): EngineFailure | undefined {
  const key = errorKey(error?.codexErrorInfo)
  const reason = key ? CODEX_ERRORS[key] : undefined
  // A limit comes back when the fullest window resets.
  const full = [...windows].sort((a, b) => b.usedPercent - a.usedPercent)[0]
  if (reason === "limit") return { reason, until: full?.resetsAt ?? Date.now() + 60 * 60_000 }
  if (reason) return { reason }
  return key ? undefined : classifyMessage(String(error?.message ?? ""))
}

const childEnv = (home: string) => {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(withoutAppEnv(process.env))) if (v !== undefined) env[k] = v
  env.CODEX_HOME = home
  return env
}

interface CodexSessionOptions {
  readonly model: string // "<provider>/<model>"; "default" uses Codex's default
  readonly system: string // stable context → developerInstructions
  readonly cwd: string
  readonly home: string // Zorel-owned CODEX_HOME for the account
  readonly gatewayUrl: string // this session's stable gateway URL (tools change per turn behind it)
  readonly access: Access
  readonly web: boolean
  readonly nativeSkills?: boolean
  readonly approve: Approver
  readonly command?: ReadonlyArray<string> // tests: a fake app-server instead of `codex`
}

const codexLoginHint = (home: string) => `Sign in to Zorel's Codex (once): run \`CODEX_HOME=${home} codex login\` in a terminal.`

export function openCodexSession(o: CodexSessionOptions): EngineSession | string {
  const bin = o.command?.[0] ?? which("codex")
  if (!bin) return "codex isn't installed or isn't on the PATH."
  mkdirSync(o.cwd, { recursive: true })
  mkdirSync(o.home, { recursive: true })
  // Skills on this machine (~/.agents/skills…) are the person's, not Zorel's (D8): host discovery off unless the person lets Codex use its own.
  const args = o.command?.slice(1) ?? [
    "app-server", "-c", "project_doc_max_bytes=0", "-c", `web_search="${o.web ? "live" : "disabled"}"`,
    ...appServerDisabled().flatMap((f) => ["--disable", f]),
    // The person's skills only when they let Codex use its own (Settings › Skills).
    ...(o.nativeSkills ? [] : ["--disable", "skill_search", "--enable", "skip_host_skill_discovery"])
  ]
  const rpc = Rpc.start(bin, args, o.cwd, childEnv(o.home))

  let listener: ((method: string, params: Json) => void) | undefined
  rpc.onNotification = (method, params) => listener?.(method, params)
  rpc.onExit = () => listener?.("zorel/exited", {})
  // File changes waiting for approval: their paths come with item/started, the request only has the item id.
  const pendingFiles = new Map<string, ReadonlyArray<string>>()
  rpc.onRequest = async (method, p) => {
    if (method === "item/commandExecution/requestApproval") {
      const command = String(p.command ?? "")
      const ok = await o.approve(approvalFor(p.networkApprovalContext ? "network" : "command", "shell", `Run ${command.slice(0, 200)}`, command, String(p.cwd ?? o.cwd)))
      return { decision: ok ? "accept" : "decline" }
    }
    if (method === "item/fileChange/requestApproval") {
      const files = pendingFiles.get(String(p.itemId)) ?? []
      const ok = await o.approve(approvalFor("edit", "apply_patch", `Edit ${files.join(", ") || "files"}`, { files, reason: p.reason ?? null }, o.cwd))
      return { decision: ok ? "accept" : "decline" }
    }
    return undefined
  }

  const modelOf = (id: string) => {
    const m = splitModel(id).model
    return m === "default" ? undefined : m
  }
  // Handshake, account check and thread, once; every turn awaits it.
  const thread: Promise<string> = (async () => {
    await rpc.request("initialize", { clientInfo: { name: "zorel", title: "Zorel", version: "0.1.0" }, capabilities: null })
    rpc.notify("initialized")
    const account = await rpc.request("account/read", {})
    if (!account?.account) throw new Error(codexLoginHint(o.home))
    // Codex finds skills on the machine (~/.agents/skills, the repo, its own); they're not Zorel's (D8).
    // Turned off in Zorel's CODEX_HOME config, never in the person's own.
    // With the person's OK (nativeSkills) they're turned back on.
    const listed = await rpc.request("skills/list", { cwds: [o.cwd] }).catch(() => undefined)
    for (const entry of listed?.data ?? [])
      for (const skill of entry.skills ?? [])
        if (skill.enabled !== !!o.nativeSkills) await rpc.request("skills/config/write", { path: skill.path, enabled: !!o.nativeSkills }).catch(() => undefined)
    const model = modelOf(o.model)
    const started = await rpc.request("thread/start", {
      ...(model && { model }),
      cwd: o.cwd,
      approvalPolicy: APPROVAL[o.access],
      sandbox: sandboxFor(o.access),
      ephemeral: true, // Zorel's context is the source of truth; resuming uses the checkpoint
      developerInstructions: o.system,
      config: {
        "mcp_servers.zorel.url": o.gatewayUrl,
        "mcp_servers.zorel.default_tools_approval_mode": "approve", // the gateway decides
        "mcp_servers.zorel.tool_timeout_sec": GATEWAY_TOOL_TIMEOUT_MS / 1000 // outlasts an approval card
      }
    })
    return String(started.thread.id)
  })()
  // Reported by the first turn; a failed start (e.g. no login yet) makes the session dead, so the runtime
  // opens a fresh one next turn instead of repeating a stale failure.
  let startFailed = false
  thread.catch(() => {
    startFailed = true
    rpc.kill()
  })

  // Codex levels: "max" is its top one (xhigh); the others match.
  const effortOf = (e: SessionTurnInput["effort"]) => (e === "max" ? "xhigh" : (e ?? undefined))
  let active: { threadId: string; turnId: string } | undefined // the running turn, for steering

  const turn = (input: SessionTurnInput): Stream.Stream<EngineEvent> =>
    Stream.callback<EngineEvent>((out) => {
      const emit = (e: EngineEvent) => void Queue.offerUnsafe(out, e)
      let threadId = ""
      let turnId: string | undefined
      let finish: () => void = () => {}
      const finished = new Promise<void>((resolve) => {
        finish = resolve
      })
      return Effect.gen(function* () {
        threadId = yield* Effect.tryPromise({ try: () => thread, catch: (e) => (e instanceof Error ? e.message : String(e)) }).pipe(
          Effect.catch((message) => Effect.sync(() => emit({ type: "error", message, failure: classifyMessage(message) ?? { reason: "unavailable" } })).pipe(Effect.as("")))
        )
        if (!threadId) return yield* Queue.end(out)
        let usage: Usage = { inputTokens: 0, outputTokens: 0 }
        let lastItem: string | undefined
        let limits: ReadonlyArray<AccountWindow> = []
        const readLimits = (snapshot: Json | undefined) => {
          const windows = windowsOf(snapshot)
          if (!windows.length) return
          limits = windows
          emit({ type: "limits", windows })
        }
        listener = (method, p) => {
          if (method === "zorel/exited") {
            emit({ type: "error", message: rpc.exited ?? "codex app-server encerrou.", failure: { reason: "unavailable" } })
            return finish()
          }
          if (method === "account/rateLimits/updated") return readLimits(p.rateLimits) // account-wide, no threadId
          if (p.threadId !== threadId) return
          if (method === "item/started" || method === "item/completed") {
            const step = codexStep(p.item, o.cwd)
            if (p.item?.type === "fileChange" && method === "item/started") pendingFiles.set(String(p.item.id), step?.files ?? [])
            if (step) emit({ type: "step", step: method === "item/started" ? { ...step, status: "running" } : step })
            return
          }
          if (method === "item/agentMessage/delta" && typeof p.delta === "string") {
            const sep = lastItem && lastItem !== p.itemId ? "\n\n" : "" // separate messages around tool calls
            lastItem = p.itemId
            emit({ type: "text", delta: sep + p.delta })
          } else if (method === "thread/tokenUsage/updated" && p.tokenUsage?.last) {
            const last = p.tokenUsage.last
            usage = { inputTokens: last.inputTokens ?? 0, outputTokens: last.outputTokens ?? 0, cachedTokens: last.cachedInputTokens ?? 0 }
            emit({ type: "usage", usage }) // so far in this turn (a reply's token limit)
          } else if (method === "turn/completed") {
            const t = p.turn ?? {}
            if (t.status === "completed") emit({ type: "done", usage })
            else emit({ type: "error", message: t.error?.message ?? (t.status === "interrupted" ? "Codex interrupted the turn." : "Codex failed this turn."), failure: t.status === "interrupted" ? undefined : codexFailure(t.error, limits) })
            finish()
          }
        }
        // Current limits of the account, so a refused turn knows when it comes back (best effort).
        yield* Effect.promise(() => rpc.request("account/rateLimits/read", {}, 5_000).then((r) => readLimits(r?.rateLimits), () => undefined))
        const model = modelOf(input.model)
        const effort = effortOf(input.effort)
        const started = yield* Effect.tryPromise({
          try: () =>
            rpc.request("turn/start", {
              threadId,
              input: [{ type: "text", text: input.prompt, text_elements: [] }, ...(input.images ?? []).map((f) => ({ type: "localImage", path: f.path }))],
              ...(model && { model }),
              ...(effort && { effort })
            }),
          catch: (e) => (e instanceof Error ? e.message : String(e))
        }).pipe(
          Effect.catch((message) =>
            Effect.sync(() => {
              emit({ type: "error", message, failure: classifyMessage(message) })
              return undefined
            })
          )
        )
        if (!started) {
          listener = undefined
          return yield* Queue.end(out)
        }
        turnId = started.turn?.id
        if (turnId) active = { threadId, turnId }
        yield* Effect.promise(() => finished)
        active = undefined
        listener = undefined
        yield* Queue.end(out)
      }).pipe(
        // Stopping mid-turn: ask Codex to interrupt and wait for its turn/completed, so it can't leak.
        Effect.onInterrupt(() =>
          Effect.promise(async () => {
            listener = (method, p) => {
              if (method === "zorel/exited" || (method === "turn/completed" && p.threadId === threadId)) finish()
            }
            if (turnId) await rpc.request("turn/interrupt", { threadId, turnId }, INTERRUPT_GRACE_MS).catch(() => undefined)
            await Promise.race([finished, Bun.sleep(INTERRUPT_GRACE_MS)])
            listener = undefined
          })
        )
      )
    })

  // Real steering: adds the text to the running turn (turn/steer checks it is still that turn).
  const steer = async (text: string) => {
    const now = active
    if (!now) return false
    return rpc
      .request("turn/steer", { threadId: now.threadId, input: [{ type: "text", text, text_elements: [] }], expectedTurnId: now.turnId })
      .then(() => true, () => false)
  }

  return {
    turn,
    steer,
    alive: () => !rpc.exited && !startFailed,
    pid: () => rpc.pid,
    close: Effect.sync(() => rpc.kill())
  }
}

// Reads the account's limit windows on demand: a short-lived app-server on the account's CODEX_HOME.
// A short-lived app-server for one read (limits, models); killed afterwards.
async function withAppServer<A>(home: string, command: ReadonlyArray<string> | undefined, read: (rpc: Rpc) => Promise<A>): Promise<A> {
  const bin = command?.[0] ?? which("codex")
  if (!bin) throw new Error("codex isn't installed or isn't on the PATH.")
  mkdirSync(home, { recursive: true })
  const rpc = Rpc.start(bin, command?.slice(1) ?? ["app-server"], home, childEnv(home))
  try {
    await rpc.request("initialize", { clientInfo: { name: "zorel", title: "Zorel", version: "0.1.0" }, capabilities: null }, 15_000)
    rpc.notify("initialized")
    return await read(rpc)
  } finally {
    rpc.kill()
  }
}

export const readCodexLimits = (home: string, command?: ReadonlyArray<string>): Promise<AccountWindow[]> =>
  withAppServer(home, command, async (rpc) => windowsOf((await rpc.request("account/rateLimits/read", {}, 15_000))?.rateLimits))

// The models this Codex login offers, with their display names.
export const readCodexModels = (home: string, command?: ReadonlyArray<string>): Promise<CliModel[]> =>
  withAppServer(home, command, async (rpc) => {
    const r = await rpc.request("model/list", {}, 15_000)
    return ((r?.data ?? []) as Json[])
      .filter((m) => typeof m.model === "string" && !m.hidden)
      .map((m) => ({ id: m.model, name: typeof m.displayName === "string" ? m.displayName : m.model, note: typeof m.description === "string" ? m.description : "" }))
  })
