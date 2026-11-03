// Native Codex session (ARCHITECTURE §6, adapter `codex-app-server`): one `codex app-server` process
// per (chat, agent) speaking JSON-RPC over stdio, one thread kept across turns.
// Minimal hand-written client (D16 revised): only the methods and fields Zero uses; unknown fields are
// ignored, so protocol changes elsewhere don't break us. Robustness ideas from OpenBot (no code):
// per-request timeouts, a dead process fails the turn, a line-size cap.
// Isolation: CODEX_HOME is a Zero-owned folder, so the user's config.toml (MCP servers, AGENTS.md,
// memories) never reaches Zero's agents (D8). Zero never reads the login inside it.
import { Effect, Queue, Stream } from "effect"
import { mkdirSync } from "node:fs"
import { CODEX_DISABLED, type EngineEvent, splitModel, type Usage } from "#server/engines.ts"
import type { EngineSession, SessionTurnInput } from "#server/engines/session.ts"

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
  onExit: () => void = () => {}

  private constructor(private proc: Bun.Subprocess<"pipe", "pipe", "pipe">) {}

  static start(bin: string, args: string[], cwd: string, env: Record<string, string>) {
    const rpc = new Rpc(Bun.spawn([bin, ...args], { cwd, env, stdin: "pipe", stdout: "pipe", stderr: "pipe" }))
    void rpc.read()
    void new Response(rpc.proc.stderr).text().then((t) => {
      rpc.stderr = t.trim().split("\n").slice(-5).join("\n")
    })
    void rpc.proc.exited.then((code) => rpc.fail(`codex app-server saiu (código ${code}).${rpc.stderr ? `\n${rpc.stderr}` : ""}`))
    return rpc
  }

  request(method: string, params: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<any> {
    if (this.exited) return Promise.reject(new Error(this.exited))
    const id = ++this.id
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`codex app-server não respondeu a ${method} em ${timeoutMs / 1000}s.`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.write({ id, method, params })
    })
  }

  notify(method: string, params?: unknown) {
    this.write(params === undefined ? { method } : { method, params })
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
        if (buf.length > MAX_LINE) return this.fail("codex app-server mandou uma linha grande demais.")
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
      if (m.error) p.reject(new Error(m.error.message ?? "erro do codex app-server"))
      else p.resolve(m.result)
    } else if (m.id !== undefined) {
      // A request from Codex (approvals, user input). Sandbox is read-only and shell is off, so Zero
      // declines: actions only happen through the gateway, which has its own approvals.
      const decline = /requestApproval$/.test(m.method) ? { result: { decision: "decline" } } : { error: { code: -32601, message: "não suportado pelo Zero" } }
      this.write({ id: m.id, ...decline })
    } else if (m.method) this.onNotification(m.method, m.params ?? {})
  }
}

const childEnv = (home: string) => {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  env.CODEX_HOME = home
  return env
}

export interface CodexSessionOptions {
  readonly model: string // "<provider>/<model>"; "default" uses Codex's default
  readonly system: string // stable context → developerInstructions
  readonly cwd: string
  readonly home: string // Zero-owned CODEX_HOME for the account
  readonly gatewayUrl: string // this session's stable gateway URL (tools change per turn behind it)
  readonly command?: ReadonlyArray<string> // tests: a fake app-server instead of `codex`
}

export const codexLoginHint = (home: string) => `Entre no Codex do Zero (uma vez): rode no terminal \`CODEX_HOME=${home} codex login\`.`

export function openCodexSession(o: CodexSessionOptions): EngineSession | string {
  const bin = o.command?.[0] ?? Bun.which("codex")
  if (!bin) return "codex não está instalado ou não está no PATH."
  mkdirSync(o.cwd, { recursive: true })
  mkdirSync(o.home, { recursive: true })
  const args = o.command?.slice(1) ?? ["app-server", "-c", "project_doc_max_bytes=0", "-c", 'web_search="disabled"', ...CODEX_DISABLED.flatMap((f) => ["--disable", f])]
  const rpc = Rpc.start(bin, args, o.cwd, childEnv(o.home))

  let listener: ((method: string, params: Json) => void) | undefined
  rpc.onNotification = (method, params) => listener?.(method, params)
  rpc.onExit = () => listener?.("zero/exited", {})

  const modelOf = (id: string) => {
    const m = splitModel(id).model
    return m === "default" ? undefined : m
  }
  // Handshake, account check and thread, once; every turn awaits it.
  const thread: Promise<string> = (async () => {
    await rpc.request("initialize", { clientInfo: { name: "zero", title: "Zero", version: "0.1.0" }, capabilities: null })
    rpc.notify("initialized")
    const account = await rpc.request("account/read", {})
    if (!account?.account) throw new Error(codexLoginHint(o.home))
    const model = modelOf(o.model)
    const started = await rpc.request("thread/start", {
      ...(model && { model }),
      cwd: o.cwd,
      approvalPolicy: "never",
      sandbox: "read-only",
      ephemeral: true, // Zero's context is the source of truth; resuming uses the checkpoint
      developerInstructions: o.system,
      config: {
        "mcp_servers.zero.url": o.gatewayUrl,
        "mcp_servers.zero.default_tools_approval_mode": "approve", // the gateway decides
        "mcp_servers.zero.tool_timeout_sec": 900 // human approval can take a while
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
          Effect.catch((message) => Effect.sync(() => emit({ type: "error", message })).pipe(Effect.as("")))
        )
        if (!threadId) return yield* Queue.end(out)
        let usage: Usage = { inputTokens: 0, outputTokens: 0 }
        let lastItem: string | undefined
        listener = (method, p) => {
          if (method === "zero/exited") {
            emit({ type: "error", message: rpc.exited ?? "codex app-server encerrou." })
            return finish()
          }
          if (p.threadId !== threadId) return
          if (method === "item/agentMessage/delta" && typeof p.delta === "string") {
            const sep = lastItem && lastItem !== p.itemId ? "\n\n" : "" // separate messages around tool calls
            lastItem = p.itemId
            emit({ type: "text", delta: sep + p.delta })
          } else if (method === "thread/tokenUsage/updated" && p.tokenUsage?.last) {
            const last = p.tokenUsage.last
            usage = { inputTokens: last.inputTokens ?? 0, outputTokens: last.outputTokens ?? 0, cachedTokens: last.cachedInputTokens ?? 0 }
          } else if (method === "turn/completed") {
            const t = p.turn ?? {}
            if (t.status === "completed") emit({ type: "done", usage })
            else emit({ type: "error", message: t.error?.message ?? (t.status === "interrupted" ? "O Codex interrompeu o turno." : "O Codex falhou neste turno.") })
            finish()
          }
        }
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
              emit({ type: "error", message })
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
              if (method === "zero/exited" || (method === "turn/completed" && p.threadId === threadId)) finish()
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
    close: Effect.sync(() => rpc.kill())
  }
}
