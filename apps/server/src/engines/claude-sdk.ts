// Native Claude session (ARCHITECTURE §6, adapter `claude-sdk`): one live Claude Code process per
// (chat, agent), reused across turns through the Agent SDK's streaming input. The second turn in the
// same chat does not spawn a process; model switches use setModel. The gateway URL is fixed for the
// session (the runtime swaps the tools behind it). Built-in tools stay off: only Zero's gateway (D8).
// The SDK runs the user's installed `claude` (pathToClaudeCodeExecutable): its bundled binary is never
// used and never shipped, and Zero never reads the CLI login (CLAUDE_CONFIG_DIR only picks the account).
import { query, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"
import { Effect, Queue, Stream } from "effect"
import { mkdirSync } from "node:fs"
import { claudeParser, type EngineEvent, splitModel } from "#server/engines.ts"
import type { EngineSession } from "#server/engines/session.ts"

const GATEWAY = "zero"
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

const userMessage = (text: string): SDKUserMessage => ({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null })

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
      tools: [], // no shell or file tools of its own
      allowedTools: [`mcp__${GATEWAY}`], // the gateway applies policy and approvals
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
          emit([{ type: "error", message: ended }])
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
        listener = (m) => {
          if (!m) {
            emit(parser.end(null, ended ?? ""))
            return finish()
          }
          emit(parser.line(JSON.stringify(m))) // SDK messages are the CLI's stream-json lines
          if (m.type === "result") finish()
        }
        box.push(userMessage(input.prompt))
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
