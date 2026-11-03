// Native Claude session (ARCHITECTURE §6, adapter `claude-sdk`): one live Claude Code process per
// (chat, agent), reused across turns through the Agent SDK's streaming input. The second turn in the
// same chat does not spawn a process; model switches use setModel. The gateway URL is fixed for the
// session (the runtime swaps the tools behind it). Built-in tools: files and shell in the workspace only
// (ARCHITECTURE §9.2); `canUseTool` applies the agent's access level and asks the person through Zero.
// The SDK runs the user's installed `claude` (pathToClaudeCodeExecutable): its bundled binary is never
// used and never shipped, and Zero never reads the CLI login (CLAUDE_CONFIG_DIR only picks the account).
import { type CanUseTool, type Query, query, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"
import type { Access, AccountWindow } from "@zero/contracts"
import { Effect, Queue, Stream } from "effect"
import { mkdirSync } from "node:fs"
import { relative } from "node:path"
import { type CliModel, claudeParser, classifyMessage, type EngineEvent, type NativeStep, splitModel, type TurnFile } from "#server/engines.ts"
import { approvalFor, decideCommand, decideEdit, decideRead } from "#server/engines/policy.ts"
import type { Approver, EngineSession, NativeApproval } from "#server/engines/session.ts"

const GATEWAY = "zero"
// Claude Code's own tools Zero turns on: files and shell. No web, no subagents, no notebooks.
const NATIVE_TOOLS = ["Read", "Glob", "Grep", "Edit", "Write", "Bash"]
const DENIED = "The user denied this. Don't try it again without asking."

const kindOf = (tool: string): NativeStep["kind"] =>
  tool === "Read" ? "read" : tool === "Glob" || tool === "Grep" ? "search" : tool === "Edit" || tool === "Write" ? "edit" : tool === "Bash" ? "run" : "tool"

// Native tool calls as steps: `tool_use` in an assistant message starts one, its `tool_result` ends it.
function stepTracker(cwd: string) {
  const open = new Map<string, NativeStep>()
  const rel = (p: unknown) => (typeof p === "string" ? relative(cwd, p) || p : "")
  const titleOf = (name: string, input: Record<string, any>) => {
    if (name === "Bash") return String(input.command ?? "")
    if (name === "Grep") return `Search ${input.pattern ?? ""}`
    if (name === "Glob") return `Find ${input.pattern ?? ""}`
    return `${name} ${rel(input.file_path)}`
  }
  return (m: SDKMessage): EngineEvent[] => {
    const content = (m.type === "assistant" || m.type === "user") && Array.isArray((m as any).message?.content) ? ((m as any).message.content as any[]) : []
    const out: EngineEvent[] = []
    for (const block of content) {
      if (block.type === "tool_use" && !String(block.name).startsWith("mcp__")) {
        const step: NativeStep = { id: block.id, kind: kindOf(block.name), title: titleOf(block.name, block.input ?? {}).slice(0, 300), files: block.input?.file_path ? [rel(block.input.file_path)] : [], status: "running", output: "" }
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

// canUseTool: the access level decides; what needs the person goes to Zero's approval card.
export function permissions(access: Access, cwd: string, approve: Approver): CanUseTool {
  return async (tool, input, { blockedPath }) => {
    const allow = { behavior: "allow" as const, updatedInput: input }
    const deny = { behavior: "deny" as const, message: DENIED }
    if (tool.startsWith("mcp__")) return allow // the gateway applies the server's mode and its approvals
    const path = typeof input.file_path === "string" ? input.file_path : (blockedPath ?? undefined)
    let decision: "allow" | "ask"
    let request: NativeApproval
    if (tool === "Bash") {
      const command = String(input.command ?? "")
      decision = decideCommand(access, command)
      request = approvalFor("command", "Bash", `Run ${command.slice(0, 200)}`, command, cwd)
    } else if (tool === "Edit" || tool === "Write") {
      decision = decideEdit(access, cwd, path ?? "")
      request = approvalFor("edit", tool, `${tool === "Write" ? "Write" : "Edit"} ${path ? relative(cwd, path) || path : "a file"}`, input, cwd)
    } else if (tool === "Read" || tool === "Glob" || tool === "Grep") {
      decision = decideRead(access, cwd, path)
      request = approvalFor("tool", tool, `Read ${path ?? "outside the project"}`, input, cwd)
    } else return deny // not a tool Zero turned on
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

// Text plus images as content blocks (base64, read when the turn is sent).
async function userMessage(text: string, images: ReadonlyArray<TurnFile> = []): Promise<SDKUserMessage> {
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
const childEnv = (configDir: string | undefined) => {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  if (configDir) env.CLAUDE_CONFIG_DIR = configDir
  return env
}

export interface ClaudeSessionOptions {
  readonly model: string // "<provider>/<model>"
  readonly system: string // stable part of the context; a change means a new session
  readonly cwd: string
  readonly gatewayUrl: string
  readonly configDir?: string | undefined // account login folder (§6.1); undefined = the CLI's default login
  readonly access: Access
  readonly approve: Approver
}

export function openClaudeSession(o: ClaudeSessionOptions): EngineSession | string {
  const bin = Bun.which("claude")
  if (!bin) return "claude não está instalado ou não está no PATH."
  mkdirSync(o.cwd, { recursive: true })
  const box = inbox()
  let model = splitModel(o.model).model
  let effort: string | null = null // the session starts at the model's default
  let listener: ((m: SDKMessage | undefined) => void) | undefined // undefined message: process ended
  let ended: string | undefined
  const q = query({
    prompt: box,
    options: {
      model,
      systemPrompt: o.system,
      cwd: o.cwd,
      pathToClaudeCodeExecutable: bin,
      tools: NATIVE_TOOLS,
      allowedTools: [`mcp__${GATEWAY}`], // the gateway applies policy and approvals
      canUseTool: permissions(o.access, o.cwd, o.approve),
      settingSources: [], // ignore the user's hooks, plugins and permissions
      mcpServers: { [GATEWAY]: { type: "http", url: o.gatewayUrl } },
      strictMcpConfig: true,
      persistSession: false, // Zero's context is the source of truth; resuming uses the checkpoint
      includePartialMessages: true,
      env: childEnv(o.configDir)
    }
  })

  // Single reader for the whole session; each turn installs a listener until its `result`.
  void (async () => {
    try {
      for await (const m of q) listener?.(m)
      ended = "Claude Code encerrou a sessão."
    } catch (e) {
      ended = `Claude Code falhou: ${e instanceof Error ? e.message : String(e)}`
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
        listener = (m) => {
          if (!m) {
            emit(parser.end(null, ended ?? ""))
            return finish()
          }
          emit([...steps(m), ...parser.line(JSON.stringify(m))]) // SDK messages are the CLI's stream-json lines
          if (m.type === "result") finish()
        }
        box.push(yield* Effect.promise(() => userMessage(input.prompt, input.images)))
        yield* Effect.promise(() => finished)
        listener = undefined
        yield* Queue.end(out)
      }).pipe(
        // Stopping mid-turn: interrupt Claude and wait for that turn's `result`, so it can't leak into the next one.
        Effect.onInterrupt(() =>
          Effect.promise(async () => {
            listener = (m) => {
              if (!m || m.type === "result") finish()
            }
            await q.interrupt().catch(() => undefined)
            await Promise.race([finished, Bun.sleep(INTERRUPT_GRACE_MS)])
            listener = undefined
          })
        )
      )
    })

  return {
    turn,
    alive: () => !ended,
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
async function withControl<A>(configDir: string | undefined, read: (q: Query) => Promise<A>): Promise<A> {
  const bin = Bun.which("claude")
  if (!bin) throw new Error("claude não está instalado ou não está no PATH.")
  const box = inbox() // never gets a message
  const q = query({ prompt: box, options: { pathToClaudeCodeExecutable: bin, tools: [], settingSources: [], persistSession: false, env: childEnv(configDir) } })
  try {
    return await Promise.race([
      read(q),
      Bun.sleep(20_000).then(() => {
        throw new Error("Claude Code não respondeu.")
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

// The aliases this login offers ("opus" → "Opus 5.5"); "default" is left out, Zero picks a model explicitly.
export const readClaudeModels = (configDir: string | undefined): Promise<CliModel[]> =>
  withControl(configDir, async (q) =>
    (await q.supportedModels()).filter((m) => m.value !== "default").map((m) => ({ id: m.value, name: m.displayName, note: m.description }))
  )
