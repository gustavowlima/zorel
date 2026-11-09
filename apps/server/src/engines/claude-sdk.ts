// Native Claude session (ARCHITECTURE §6, adapter `claude-sdk`): one live Claude Code process per
// (chat, agent), reused across turns through the Agent SDK's streaming input. The second turn in the
// same chat does not spawn a process; model switches use setModel. The gateway URL is fixed for the
// session (the runtime swaps the tools behind it). Built-in tools: files and shell in the workspace only
// (ARCHITECTURE §9.2); `canUseTool` applies the agent's access level and asks the person through Zorel.
// The SDK runs the user's installed `claude` (pathToClaudeCodeExecutable): its bundled binary is never
// used and never shipped, and Zorel never reads the CLI login (CLAUDE_CONFIG_DIR only picks the account).
import { type CanUseTool, type Query, query, type SDKMessage, type SDKUserMessage, type SpawnedProcess } from "@anthropic-ai/claude-agent-sdk"
import type { Access, AccountWindow } from "@zorel/contracts"
import { Effect, Queue, Stream } from "effect"
import { spawn } from "node:child_process"
import { existsSync, mkdirSync } from "node:fs"
import { basename, relative } from "node:path"
import { type CliModel, claudeParser, classifyMessage, type EngineEvent, type NativeStep, splitModel, STEP_DETAIL_MAX, STEP_TITLE_MAX, type TurnFile } from "#server/engines.ts"
import { approvalFor, decideCommand, decideEdit, decideRead } from "#server/engines/policy.ts"
import { type Approver, type EngineSession, GATEWAY_TOOL_TIMEOUT_MS, type NativeApproval, withoutAppEnv } from "#server/engines/session.ts"

const GATEWAY = "zorel"
// Claude Code's own tools Zorel turns on: files and shell, plus web search and fetch when the agent may use the web.
// No subagents, no notebooks.
const NATIVE_TOOLS = ["Read", "Glob", "Grep", "Edit", "Write", "Bash"]
const WEB_TOOLS = ["WebSearch", "WebFetch"]
const DENIED = "The user denied this. Don't try it again without asking."

const kindOf = (tool: string): NativeStep["kind"] =>
  tool === "Read" ? "read" : tool === "Glob" || tool === "Grep" ? "search" : tool === "Edit" || tool === "Write" ? "edit" : tool === "Bash" ? "run" : "tool"

// A path as the step shows it: relative to the folder the agent works in.
const relTo = (cwd: string, p: unknown) => (typeof p === "string" ? relative(cwd, p) || p : "")

// A URL without its query and fragment (signed links and `?token=` stay out of the saved step); an unparsable one is
// cut at its first `?` or `#` and at 80 characters.
function bareUrl(raw: string): string {
  try {
    const u = new URL(raw)
    return u.origin + u.pathname
  } catch {
    return raw.slice(0, 80).split(/[?#]/)[0]!
  }
}

// A tool call as a summary plus what it stands for. Bash carries its own `description` ("Check git status"), so the
// title is that and the command is the detail; the others are built from their input.
export function describeTool(name: string, input: Record<string, any>, cwd: string): Pick<NativeStep, "title" | "detail"> {
  const rel = (p: unknown) => relTo(cwd, p)
  const text = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "")
  const one = (title: string, detail = "") => ({ title: title.slice(0, STEP_TITLE_MAX), detail: detail.slice(0, STEP_DETAIL_MAX) })
  switch (name) {
    case "Bash":
      return one(text(input.description) || "Run a command", String(input.command ?? ""))
    case "Read":
    case "Edit":
    case "Write": {
      const file = rel(input.file_path)
      return one(file ? `${name} ${basename(file)}` : name, file)
    }
    case "Grep":
      return one(`Search for ${text(input.pattern)}`, rel(input.path))
    case "Glob":
      return one(`Find ${text(input.pattern)}`, rel(input.path))
    case "WebFetch":
      return one("Read a page", bareUrl(text(input.url)))
    case "WebSearch":
      return one("Search the web", text(input.query))
    case "Task":
      return one(text(input.description) || name)
    default:
      return one(name)
  }
}

// Native tool calls as steps: `tool_use` in an assistant message starts one, its `tool_result` ends it.
function stepTracker(cwd: string) {
  const open = new Map<string, NativeStep>()
  const rel = (p: unknown) => relTo(cwd, p)
  return (m: SDKMessage): EngineEvent[] => {
    const content = (m.type === "assistant" || m.type === "user") && Array.isArray((m as any).message?.content) ? ((m as any).message.content as any[]) : []
    const out: EngineEvent[] = []
    for (const block of content) {
      if (block.type === "tool_use" && !String(block.name).startsWith("mcp__")) {
        const step: NativeStep = { id: block.id, kind: kindOf(block.name), ...describeTool(block.name, block.input ?? {}, cwd), files: block.input?.file_path ? [rel(block.input.file_path)] : [], status: "running", output: "" }
        open.set(block.id, step)
        out.push({ type: "step", step })
      } else if (block.type === "tool_result" && open.has(block.tool_use_id)) {
        const started = open.get(block.tool_use_id)!
        open.delete(block.tool_use_id)
        const text = typeof block.content === "string" ? block.content : Array.isArray(block.content) ? block.content.map((c: any) => c.text ?? "").join("") : ""
        const refused = block.is_error === true && text.includes(DENIED.slice(0, 20))
        out.push({ type: "step", step: { ...started, status: refused ? "refused" : block.is_error ? "error" : "ok", output: text.slice(0, 4000) } })
      }
    }
    return out
  }
}

// canUseTool: the access level decides; what needs the person goes to Zorel's approval card.
export function permissions(access: Access, cwd: string, approve: Approver, web = false, skills = false, confined = false): CanUseTool {
  return async (tool, input, { blockedPath }) => {
    const allow = { behavior: "allow" as const, updatedInput: input }
    const deny = { behavior: "deny" as const, message: DENIED }
    if (tool.startsWith("mcp__")) return allow // the gateway applies the server's mode and its approvals
    if (WEB_TOOLS.includes(tool)) return web ? allow : deny // the agent's web permission
    if (tool === "Skill") return skills ? allow : deny // reading a skill; what it then does goes through the rules above
    const path = typeof input.file_path === "string" ? input.file_path : (blockedPath ?? undefined)
    let decision: "allow" | "ask"
    let request: NativeApproval
    if (tool === "Bash") {
      const command = String(input.command ?? "")
      decision = decideCommand(access, command, cwd, confined)
      request = approvalFor("command", "Bash", `Run ${command.slice(0, 200)}`, command, cwd)
    } else if (tool === "Edit" || tool === "Write") {
      decision = decideEdit(access, cwd, path ?? "")
      request = approvalFor("edit", tool, `${tool === "Write" ? "Write" : "Edit"} ${path ? relative(cwd, path) || path : "a file"}`, input, cwd)
    } else if (tool === "Read" || tool === "Glob" || tool === "Grep") {
      decision = decideRead(access, cwd, path)
      request = approvalFor("tool", tool, `Read ${path ?? "outside the project"}`, input, cwd)
    } else return deny // not a tool Zorel turned on
    if (decision === "allow") return allow
    return (await approve(request)) ? allow : deny
  }
}
const INTERRUPT_GRACE_MS = 5_000

// Async iterable the SDK reads user messages from for the whole session.
function inbox() {
  const pending: SDKUserMessage[] = []
  let wake: (() => void) | undefined
  let closed = false
  return {
    push(m: SDKUserMessage) {
      pending.push(m)
      wake?.()
    },
    close() {
      closed = true
      wake?.()
    },
    async *[Symbol.asyncIterator](): AsyncGenerator<SDKUserMessage> {
      while (true) {
        const next = pending.shift()
        if (next) {
          yield next
          continue
        }
        if (closed) return
        await new Promise<void>((resolve) => {
          wake = resolve
        })
        wake = undefined
      }
    }
  }
}

// Below full access the shell runs in Claude Code's OS sandbox where there is one (Seatbelt on macOS; bubblewrap and
// socat on Linux): writes only inside the folder (and temp), no network, and no way for the model to step out of it.
// Without one (Windows) the shell is held by decideCommand's read-only rule instead.
export const canSandbox = (platform = process.platform, which = Bun.which) => platform === "darwin" || (platform === "linux" && !!which("bwrap") && !!which("socat"))
// Two layers, because the SDK filters `managedSettings` to restrictions only (what would widen is dropped without a
// word): the policy tier holds what the user's own settings must never loosen; the flag layer (`sandbox` option)
// carries what is a choice of Zorel's. `allowLocalBinding` (dev servers on localhost, tests that open a port) and
// `autoAllowBashIfSandboxed: false` (every command still goes through canUseTool) are not restrictions the policy tier
// keeps, so they go there. The flag layer outranks the user's, project's and local settings.
export const SANDBOX_POLICY = {
  enabled: true,
  failIfUnavailable: true, // never run unconfined while the rules assume a sandbox
  allowUnsandboxedCommands: false,
  network: { strictAllowlist: true, allowedDomains: [] as string[] }
}
export const SANDBOX_FLAG = {
  autoAllowBashIfSandboxed: false,
  network: { allowLocalBinding: true }
}
// The settings layers a session opens with. Without a sandbox (full access, or Windows) only the policy lock remains.
export const settingsLayers = (confined: boolean) => ({
  managedSettings: { ...SETTINGS.managedSettings, ...(confined && { sandbox: SANDBOX_POLICY }) },
  ...(confined && { sandbox: SANDBOX_FLAG })
})

// If a steered turn stays silent this long after a `result` that was held back, it is closed with what it has. The
// uuid rule decides everything on the normal path; this only keeps a message the CLI dropped from freezing the turn.
const STEER_LIMIT_MS = 30_000

// Mid-turn steering: a message pushed to the CLI while it answers. Claude Code folds it into the running turn at the
// next tool boundary, or, when that boundary has passed, answers it in a turn of its own right after this one's
// `result`. Every message carries a uuid, and the CLI stamps the frames of a turn with the uuids it has consumed
// (`user_message_uuids`), so what a frame or a `result` belongs to is read, not timed:
// - a `result` while a steer is still unconsumed is only a segment; the turn ends at the first `result` with none;
// - a steer left unconsumed by a stop or by the limit would still run in the CLI, out of sight: the session is then
//   closed (the next turn opens a new one), so Stop really stops and nothing an agent does goes unseen. What a closing
//   CLI still sends is an orphan's: skipped until a frame shows the next turn's own uuid;
// - steering is only accepted once the CLI has been seen stamping a uuid of ours, so a CLI that ignores uuids
//   never gets a steer it could not account for (the runtime stops the turn and sends the message instead).
export function steerGate(opts: { limitMs?: number; onLimit?: () => void } = {}) {
  const limitMs = opts.limitMs ?? STEER_LIMIT_MS
  let live = false
  let own = ""
  let stamps = false
  let orphanTurn = false // frames of an orphan's turn are coming; its `result` ends the skipping
  let timer: ReturnType<typeof setTimeout> | undefined
  const pending = new Set<string>()
  const orphans = new Set<string>()
  const skipping = () => orphans.size > 0 || orphanTurn
  const stop = () => {
    clearTimeout(timer)
    timer = undefined
  }
  const arm = () => {
    stop()
    timer = setTimeout(() => {
      timer = undefined
      if (skipping()) {
        console.warn("[claude] a stopped steer never showed up: no longer skipping its frames")
        orphans.clear()
        orphanTurn = false
        // A turn that has seen nothing but skipped frames never got its own stamp: its `result` may be among the
        // skipped, so it is closed here instead of waiting for the runtime's stall guard.
        if (live) opts.onLimit?.()
      } else if (pending.size) {
        console.warn("[claude] a steer was never consumed: closing the turn with what it has")
        for (const id of pending) orphans.add(id)
        pending.clear()
        opts.onLimit?.()
      }
    }, limitMs)
  }
  return {
    begin(ownId: string) {
      live = true
      own = ownId
      pending.clear()
      if (skipping()) arm()
    },
    end() {
      stop()
      live = false
      pending.clear()
    },
    // False when no turn is running or the CLI has not shown it stamps our uuids (the caller sends it another way).
    accept(id: string) {
      if (!live || !stamps) return false
      pending.add(id)
      return true
    },
    // The steers the CLI has not taken yet become orphans (a stop or the limit); how many, so the caller can close the
    // session before the CLI runs them as turns of their own.
    abandon() {
      const left = pending.size
      for (const id of pending) orphans.add(id)
      pending.clear()
      return left
    },
    // A frame names the sends the CLI has taken into its turn.
    consumed(ids: ReadonlyArray<string> | undefined) {
      for (const id of ids ?? []) pending.delete(id)
    },
    // What to do with a message: "skip" (an orphan's), "pass", "segment" (a `result` that is not the last) or "finish".
    see(type: string, ids: ReadonlyArray<string> = []): "pass" | "skip" | "segment" | "finish" {
      let theirs = false
      for (const id of ids) {
        if (id === own || pending.has(id)) stamps = true
        pending.delete(id)
        if (orphans.delete(id)) theirs = true
      }
      if (ids.includes(own)) {
        orphans.clear() // an orphan batched with this turn's message is answered here
        orphanTurn = false
      } else if (theirs) orphanTurn = true
      if (skipping()) {
        if (type === "result") orphanTurn = false
        arm()
        return "skip"
      }
      if (type !== "result") {
        if (timer) arm() // still waiting on a steer: any sign of life restarts the clock
        return "pass"
      }
      if (!pending.size) {
        stop()
        return "finish"
      }
      arm()
      return "segment"
    }
  }
}

// One `done` for the whole turn: the last result with the usage of every segment added up.
const USAGE_KEYS = ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"] as const
export function mergeResults(segments: ReadonlyArray<SDKMessage>, last: SDKMessage): SDKMessage {
  if (!segments.length || last.type !== "result") return last
  const usage: Record<string, number> = {}
  for (const r of [...segments, last]) {
    const u = r.type === "result" ? (r.usage as unknown as Record<string, unknown> | undefined) : undefined
    for (const k of USAGE_KEYS) usage[k] = (usage[k] ?? 0) + (typeof u?.[k] === "number" ? (u[k] as number) : 0)
  }
  return { ...last, usage: { ...(last.usage as object), ...usage } } as unknown as SDKMessage
}

// The cost is not summed: `total_cost_usd` is cumulative for the session (each result carries the running total), and
// Zorel prices a turn from its tokens anyway. `usage` is per turn, so the segments' usage is added.
// A segment that failed is not folded into the usage: it goes to the turn as the error it is.
const failedResult = (m: SDKMessage) => m.type === "result" && (m.is_error === true || m.subtype !== "success")
const consumedBy = (m: SDKMessage): string[] => {
  const f = m as { user_message_uuids?: string[]; user_message_uuid?: string }
  return f.user_message_uuids ?? (f.user_message_uuid ? [f.user_message_uuid] : [])
}

// Claude Code's own settings: the user's, the project's and the local ones load, so the
// CLI's slash commands, skills and CLAUDE.md files are there. Two locks keep Zorel in charge: only the policy
// tier's permission rules count (none: every tool call goes through Zorel's canUseTool and access level, a
// file's allow list or a bypass default mode never applies) and no hook runs. MCP stays strict (the gateway).
const SETTINGS = {
  settingSources: ["user", "project", "local"] as ["user", "project", "local"],
  permissionMode: "default" as const,
  managedSettings: { allowManagedPermissionRulesOnly: true, disableAllHooks: true }
}

// Text plus images as content blocks (base64, read when the turn is sent). A CLI slash command goes last, as a
// block of its own: Claude Code expands `/name …` only when it opens the message's last text block.
async function userMessage(text: string, images: ReadonlyArray<TurnFile> = [], command?: string): Promise<SDKUserMessage> {
  if (command) return { type: "user", message: { role: "user", content: [...(text ? [{ type: "text" as const, text }] : []), { type: "text" as const, text: command }] }, parent_tool_use_id: null }
  if (!images.length) return { type: "user", message: { role: "user", content: text }, parent_tool_use_id: null }
  const blocks = await Promise.all(
    images.map(async (f) => ({
      type: "image" as const,
      source: { type: "base64" as const, media_type: f.mime as "image/png" | "image/jpeg" | "image/gif" | "image/webp", data: Buffer.from(await Bun.file(f.path).arrayBuffer()).toString("base64") }
    }))
  )
  return { type: "user", message: { role: "user", content: [{ type: "text", text }, ...blocks] }, parent_tool_use_id: null }
}

// The SDK replaces the child env entirely: copy ours, minus undefined values.
// macOS ships bash 3.2 as /bin/bash (it refuses a heredoc inside `$(...)` and more), and the app may start with that
// as $SHELL: Claude Code's commands run in zsh there, unless the person set a shell of their own.
export function childEnv(configDir: string | undefined, platform: NodeJS.Platform = process.platform, base: NodeJS.ProcessEnv = process.env, exists: (path: string) => boolean = existsSync) {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(withoutAppEnv(base))) if (v !== undefined) env[k] = v
  if (platform === "darwin" && !env.CLAUDE_CODE_SHELL && exists("/bin/zsh")) env.CLAUDE_CODE_SHELL = "/bin/zsh"
  if (configDir) env.CLAUDE_CONFIG_DIR = configDir
  // A gateway call may wait on an approval card (up to 30 min): Claude Code's MCP timeout must outlast it.
  env.MCP_TOOL_TIMEOUT = String(GATEWAY_TOOL_TIMEOUT_MS)
  return env
}

export interface ClaudeSessionOptions {
  readonly model: string // "<provider>/<model>"
  readonly system: string // stable part of the context; a change means a new session
  readonly cwd: string
  readonly gatewayUrl: string
  readonly configDir?: string | undefined // account login folder (§6.1); undefined = the CLI's default login
  readonly access: Access
  readonly web: boolean
  readonly nativeSkills: boolean
  readonly approve: Approver
}

export function openClaudeSession(o: ClaudeSessionOptions): EngineSession | string {
  const bin = Bun.which("claude")
  if (!bin) return "claude isn't installed or isn't on the PATH."
  mkdirSync(o.cwd, { recursive: true })
  const box = inbox()
  const confined = o.access !== "full" && canSandbox()
  let model = splitModel(o.model).model
  let effort: string | null = null // the session starts at the model's default
  let listener: ((m: SDKMessage | undefined) => void) | undefined // undefined message: process ended
  let ended: string | undefined
  let pid: number | undefined
  let limit: (() => void) | undefined // closes the running turn when a steer was never consumed (see steerGate)
  // A steer the CLI holds but never answered in this turn: after the turn the session closes, so the CLI can't run it
  // unseen (the runtime opens a new session for the next turn).
  let retire = false
  const closeCli = (why: string) => {
    ended ??= why
    box.close()
    q.close()
  }
  const gate = steerGate({ onLimit: () => limit?.() })
  const q = query({
    prompt: box,
    options: {
      model,
      systemPrompt: o.system,
      cwd: o.cwd,
      pathToClaudeCodeExecutable: bin,
      // The Skill tool only when the person lets Claude Code use its own skills (Settings › Skills).
      tools: [...NATIVE_TOOLS, ...(o.web ? WEB_TOOLS : []), ...(o.nativeSkills ? ["Skill"] : [])],
      allowedTools: [`mcp__${GATEWAY}`], // the gateway applies policy and approvals
      canUseTool: permissions(o.access, o.cwd, o.approve, o.web, o.nativeSkills, confined),
      ...SETTINGS,
      // Policy tier (the user's own settings can't loosen it) plus the flag layer for what the tier would drop.
      ...settingsLayers(confined),
      mcpServers: { [GATEWAY]: { type: "http", url: o.gatewayUrl } },
      strictMcpConfig: true,
      persistSession: false, // Zorel's context is the source of truth; resuming uses the checkpoint
      includePartialMessages: true,
      env: childEnv(o.configDir),
      // The SDK's own spawn (no shell, hidden window on Windows), keeping the pid for Settings › Processes.
      spawnClaudeCodeProcess: (s) => {
        const child = spawn(s.command, s.args, { cwd: s.cwd, env: s.env, signal: s.signal, stdio: ["pipe", "pipe", "ignore"], windowsHide: true })
        pid = child.pid
        return child as unknown as SpawnedProcess // a Node ChildProcess is what the SDK spawns itself
      }
    }
  })

  // Single reader for the whole session; each turn installs a listener until its `result`.
  void (async () => {
    try {
      for await (const m of q) listener?.(m)
      ended = "Claude Code ended the session."
    } catch (e) {
      ended = `Claude Code failed: ${e instanceof Error ? e.message : String(e)}`
    }
    listener?.(undefined)
  })()

  const turn: EngineSession["turn"] = (input) =>
    Stream.callback<EngineEvent>((out) => {
      let finish: () => void = () => {}
      const finished = new Promise<void>((resolve) => {
        finish = resolve
      })
      const emit = (events: ReadonlyArray<EngineEvent>) => {
        for (const e of events) Queue.offerUnsafe(out, e)
      }
      return Effect.gen(function* () {
        if (ended) {
          emit([{ type: "error", message: ended, failure: classifyMessage(ended) ?? { reason: "unavailable" } }])
          return yield* Queue.end(out)
        }
        // Same session, new turn: follow the effort and the model if they changed.
        const nextEffort = input.effort ?? null
        if (nextEffort !== effort) {
          yield* Effect.promise(() => q.applyFlagSettings({ effortLevel: nextEffort }))
          effort = nextEffort
        }
        const next = splitModel(input.model).model
        if (next !== model) {
          yield* Effect.promise(() => q.setModel(next))
          model = next
        }
        const parser = claudeParser()
        const steps = stepTracker(o.cwd)
        // Tokens so far in this turn: each assistant message carries its model call's usage, summed as they come (a
        // reply's token limit reads it; the turn's `done` still reports the CLI's own total).
        const sofar = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 }
        const usageOf = (m: SDKMessage): EngineEvent[] => {
          const u = m.type === "assistant" ? (m.message.usage as unknown as Record<string, unknown> | undefined) : undefined
          if (!u) return []
          const n = (k: string) => (typeof u[k] === "number" ? (u[k] as number) : 0)
          sofar.inputTokens += n("input_tokens") + n("cache_creation_input_tokens") + n("cache_read_input_tokens")
          sofar.outputTokens += n("output_tokens")
          sofar.cachedTokens += n("cache_read_input_tokens")
          return [{ type: "usage", usage: { ...sofar } }]
        }
        const line = (m: SDKMessage) => emit([...steps(m), ...parser.line(JSON.stringify(m)), ...usageOf(m)]) // SDK messages are the CLI's stream-json lines
        const segments: SDKMessage[] = [] // results of the steered turn's earlier segments (see steerGate)
        // After a segment fails its error is already the turn's: the rest is drained, not shown. Text from the steered
        // message arriving after the error would land on a turn the person already sees as failed, and the CLI's
        // remaining `result`s still have to be read so they don't end the next turn early.
        let failed = false
        limit = () => {
          retire = true
          const last = segments.pop()
          if (last && !failed) line(mergeResults(segments, last))
          else if (!failed) emit([{ type: "error", message: "Claude Code stopped answering.", failure: { reason: "unavailable" } }]) // nothing of this turn came through
          finish()
        }
        listener = (m) => {
          if (!m) {
            gate.end()
            emit(parser.end(null, ended ?? ""))
            return finish()
          }
          const next = gate.see(m.type, consumedBy(m))
          if (next === "skip") return
          if (failed) return next === "finish" ? finish() : undefined
          if (m.type !== "result") return line(m)
          if (failedResult(m)) {
            failed = true
            line(m)
          } else if (next === "segment") {
            segments.push(m)
            return
          } else line(mergeResults(segments, m))
          if (next === "finish") finish()
        }
        const own = crypto.randomUUID() // the CLI stamps this turn's frames with it
        gate.begin(own)
        box.push({ ...(yield* Effect.promise(() => userMessage(input.prompt, input.images, input.command))), uuid: own })
        yield* Effect.promise(() => finished)
        gate.end()
        limit = undefined
        listener = undefined
        if (retire) closeCli("a steer was never answered")
        yield* Queue.end(out)
      }).pipe(
        // Stopping mid-turn: interrupt Claude and wait for that turn's `result`, so it can't leak into the next one.
        Effect.onInterrupt(() =>
          Effect.promise(async () => {
            // A steer the CLI hasn't taken yet survives the interrupt and would run as a turn of its own, unseen: the
            // session is closed instead (Stop stops everything); the next turn opens a new one.
            limit = undefined
            listener = (m) => {
              if (m) gate.consumed(consumedBy(m)) // one folded in before the stop is not an orphan
              if (!m || m.type === "result") finish()
            }
            await q.interrupt().catch(() => undefined)
            await Promise.race([finished, Bun.sleep(INTERRUPT_GRACE_MS)])
            const left = gate.abandon()
            gate.end()
            listener = undefined
            if (left) closeCli("stopped with a message still waiting")
          })
        )
      )
    })

  // Real steering: the message goes into the running turn (priority "next": at the next tool boundary), so the
  // CLI answers it as part of that turn. False when no turn is running.
  const steer: NonNullable<EngineSession["steer"]> = async (text) => {
    const uuid = crypto.randomUUID()
    if (ended || !gate.accept(uuid)) return false
    box.push({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null, priority: "next", uuid })
    return true
  }

  return {
    turn,
    steer,
    alive: () => !ended,
    pid: () => pid,
    close: Effect.sync(() => {
      box.close()
      q.close()
    })
  }
}

// Reads the subscription's limit windows on demand (Usage screen), through the SDK's /usage data. The SDK
// marks it experimental: any failure just means "no reading now" (the passive rate_limit_event remains).
const CLAUDE_WINDOWS = ["five_hour", "seven_day", "seven_day_opus", "seven_day_sonnet"] as const
// A Claude Code session that only answers control requests (usage, models); closed afterwards.
async function withControl<A>(configDir: string | undefined, read: (q: Query) => Promise<A>, cwd?: string): Promise<A> {
  const bin = Bun.which("claude")
  if (!bin) throw new Error("claude isn't installed or isn't on the PATH.")
  const box = inbox() // never gets a message
  // With a folder: that project's settings load too (its commands); without, none (limits, models).
  const settings = cwd ? { ...SETTINGS, cwd } : { settingSources: [] }
  const q = query({ prompt: box, options: { pathToClaudeCodeExecutable: bin, tools: [], persistSession: false, env: childEnv(configDir), ...settings } })
  try {
    return await Promise.race([
      read(q),
      Bun.sleep(20_000).then(() => {
        throw new Error("Claude Code didn't answer.")
      })
    ])
  } finally {
    box.close()
    q.close()
  }
}

export const readClaudeLimits = (configDir: string | undefined): Promise<AccountWindow[]> =>
  withControl(configDir, async (q) => {
    const usage = await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })
    const limits = usage.rate_limits
    if (!usage.rate_limits_available || !limits) return []
    const at = (iso: string | null) => (iso ? Date.parse(iso) : null)
    const windows: AccountWindow[] = []
    for (const id of CLAUDE_WINDOWS) {
      const w = limits[id]
      if (w?.utilization !== null && w?.utilization !== undefined) windows.push({ id, usedPercent: w.utilization, resetsAt: at(w.resets_at) })
    }
    for (const w of limits.model_scoped ?? []) if (w.utilization !== null) windows.push({ id: `model:${w.display_name}`, usedPercent: w.utilization, resetsAt: at(w.resets_at) })
    return windows
  })

// The aliases this login offers ("opus" → "Opus 5.5"); "default" is left out, Zorel picks a model explicitly.
export const readClaudeModels = (configDir: string | undefined): Promise<CliModel[]> =>
  withControl(configDir, async (q) =>
    (await q.supportedModels()).filter((m) => m.value !== "default").map((m) => ({ id: m.value, name: m.displayName, note: m.description }))
  )

// The slash commands Claude Code offers in a folder (built-in and the user's, the project's and plugins').
// Commands Zorel does itself are left out: it compacts, switches models and measures context on its own terms.
export interface EngineCommand {
  readonly name: string
  readonly description: string
  readonly argumentHint: string | null
}
const ZOREL_HANDLES = new Set(["compact", "clear", "context", "cost", "model", "resume", "exit", "login", "logout", "config"])
const COMMANDS_TTL_MS = 10 * 60_000
const commandCache = new Map<string, { at: number; list: Promise<EngineCommand[]> }>()

export function claudeCommands(configDir: string | undefined, cwd: string): Promise<EngineCommand[]> {
  const key = `${configDir ?? "-"}|${cwd}`
  const hit = commandCache.get(key)
  if (hit && Date.now() - hit.at < COMMANDS_TTL_MS) return hit.list
  const list = withControl(
    configDir,
    async (q) =>
      (await q.supportedCommands())
        .filter((c) => !ZOREL_HANDLES.has(c.name))
        .map((c) => ({ name: c.name, description: c.description ?? "", argumentHint: c.argumentHint || null })),
    cwd
  ).catch(() => {
    commandCache.delete(key) // not cached: the next look tries again
    return [] as EngineCommand[]
  })
  commandCache.set(key, { at: Date.now(), list })
  return list
}

// The command a message runs, when it opens with one the CLI offers ("/review the auth module" → review).
export const commandOf = (text: string, commands: ReadonlyArray<EngineCommand>) => {
  const name = /^\/([\w:.-]+)(?=\s|$)/.exec(text.trimStart())?.[1]
  return name && commands.some((c) => c.name === name) ? name : undefined
}

