// ACP engine (Agent Client Protocol, phase 5): one adapter for every agent CLI that speaks it — Gemini CLI
// (`gemini --acp`), OpenCode (`opencode acp`), and others the same way. Stateless like the CLI fallback: each turn
// starts the agent in ACP mode in the chat's folder, opens a session (with Zero's tool gateway as an HTTP MCP server
// when the agent takes one), sends the layered context and the conversation as one prompt, and turns the agent's
// session/update notifications into text and work steps. JSON-RPC 2.0, one message per line on stdio.
// Permissions: the agent asks before acting; with access "ask" Zero refuses (no approval card in a stateless turn,
// the reply says so), with "workspace" or "full" it allows once. Files and terminals stay the agent's own (Zero
// declares neither capability), and Zero's checkpoints still record what changed.
import type { Access } from "@zero/contracts"
import { Stream } from "effect"
import type { EngineEvent, NativeStep } from "../engines.ts"

export interface AcpTurn {
  readonly bin: string
  readonly args: ReadonlyArray<string>
  readonly model: string // the agent's own model id; "default" keeps the agent's choice
  readonly cwd: string
  readonly prompt: string
  readonly access: Access
  readonly gatewayUrl?: string | undefined
}

type Json = Record<string, any>
const PROTOCOL = 1

// ACP tool kinds to Zero's step kinds.
export const kindOf = (k: unknown): NativeStep["kind"] => (k === "read" ? "read" : k === "edit" || k === "delete" || k === "move" ? "edit" : k === "execute" ? "run" : k === "search" || k === "fetch" ? "search" : "tool")

// The permission answer for an access level: the first "allow once" option, else cancelled.
export function permission(options: ReadonlyArray<{ optionId: string; kind: string }>, access: Access): Json {
  const allow = access !== "ask" && (options.find((o) => o.kind === "allow_once") ?? options.find((o) => o.kind === "allow_always"))
  return allow ? { outcome: { outcome: "selected", optionId: allow.optionId } } : { outcome: { outcome: "cancelled" } }
}

export function acpRun(t: AcpTurn): Stream.Stream<EngineEvent> {
  return Stream.fromAsyncIterable(run(t), (e) => e).pipe(Stream.catch((e) => Stream.make<EngineEvent[]>({ type: "error", message: String(e instanceof Error ? e.message : e), failure: { reason: "unavailable" } })))
}

async function* run(t: AcpTurn): AsyncGenerator<EngineEvent> {
  const path = Bun.which(t.bin)
  if (!path) {
    yield { type: "error", message: `${t.bin} is not installed or not on the PATH.`, failure: { reason: "unavailable" } }
    return
  }
  const proc = Bun.spawn([path, ...t.args], { cwd: t.cwd, stdin: "pipe", stdout: "pipe", stderr: "pipe", env: process.env })
  const queue: EngineEvent[] = []
  let wake: (() => void) | undefined
  const push = (e: EngineEvent) => {
    queue.push(e)
    wake?.()
  }
  const pending = new Map<number, { resolve: (v: Json) => void; reject: (e: Error) => void }>()
  let nextId = 1
  const send = (msg: Json) => proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`)
  const request = (method: string, params: Json) =>
    new Promise<Json>((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      send({ id, method, params })
    })
  const steps = new Map<string, { title: string; kind: NativeStep["kind"] }>()
  let refused = 0

  // The agent's messages: responses to ours, its notifications, and its own requests (permission).
  const onMessage = (m: Json) => {
    if (m.id !== undefined && m.method === undefined) {
      const p = pending.get(m.id)
      pending.delete(m.id)
      if (m.error) p?.reject(new Error(m.error.message ?? JSON.stringify(m.error)))
      else p?.resolve(m.result ?? {})
      return
    }
    if (m.method === "session/request_permission") {
      const answer = permission(m.params?.options ?? [], t.access)
      if (answer.outcome.outcome === "cancelled") refused++
      send({ id: m.id, result: answer })
      return
    }
    if (m.method !== undefined && m.id !== undefined) {
      send({ id: m.id, error: { code: -32601, message: `Zero does not handle ${m.method}` } })
      return
    }
    if (m.method !== "session/update") return
    const u = m.params?.update ?? {}
    if (u.sessionUpdate === "agent_message_chunk" && u.content?.type === "text") push({ type: "text", delta: String(u.content.text ?? "") })
    else if (u.sessionUpdate === "tool_call") {
      const step = { title: String(u.title ?? "Tool"), kind: kindOf(u.kind) }
      steps.set(u.toolCallId, step)
      push({ type: "step", step: { id: u.toolCallId, ...step, files: (u.locations ?? []).map((l: Json) => String(l.path)), status: "running", output: "" } })
    } else if (u.sessionUpdate === "tool_call_update" && (u.status === "completed" || u.status === "failed")) {
      const step = steps.get(u.toolCallId) ?? { title: String(u.title ?? "Tool"), kind: kindOf(u.kind) }
      const text = (u.content ?? []).map((c: Json) => c?.content?.text ?? "").join("\n")
      push({ type: "step", step: { id: u.toolCallId, ...step, files: [], status: u.status === "completed" ? "ok" : "error", output: String(text).slice(0, 2000) } })
    }
  }

  // stdout: one JSON-RPC message per line.
  void (async () => {
    const decoder = new TextDecoder()
    let buf = ""
    for await (const chunk of proc.stdout) {
      buf += decoder.decode(chunk, { stream: true })
      const lines = buf.split("\n")
      buf = lines.pop() ?? ""
      for (const raw of lines) {
        const line = raw.trim()
        if (!line) continue
        try {
          onMessage(JSON.parse(line))
        } catch {
          // not JSON-RPC (a log line): ignore
        }
      }
    }
  })()
  const stderr = new Response(proc.stderr).text()

  const turn = (async () => {
    const init = await request("initialize", { protocolVersion: PROTOCOL, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } })
    const http = init.agentCapabilities?.mcpCapabilities?.http === true
    const mcpServers = t.gatewayUrl && http ? [{ type: "http", name: "zero", url: t.gatewayUrl, headers: [] }] : []
    const session = await request("session/new", { cwd: t.cwd, mcpServers })
    const sessionId = String(session.sessionId)
    if (t.model && t.model !== "default") await request("session/set_model", { sessionId, modelId: t.model }).catch(() => undefined) // not every agent has it
    return request("session/prompt", { sessionId, prompt: [{ type: "text", text: t.prompt }] })
  })()
  let done: { stopReason?: string } | undefined
  let failed: Error | undefined
  void turn.then(
    (r) => {
      done = r
      wake?.()
    },
    (e: Error) => {
      failed = e
      wake?.()
    }
  )
  void proc.exited.then(() => {
    if (!done && !failed) failed = new Error("exited")
    wake?.()
  })

  try {
    while (true) {
      while (queue.length) yield queue.shift()!
      if (done || failed) break
      await new Promise<void>((r) => {
        wake = r
      })
      wake = undefined
    }
    while (queue.length) yield queue.shift()!
    if (failed) {
      const err = (await Promise.race([stderr, Bun.sleep(300).then(() => "")])).trim().split("\n").slice(-3).join("\n")
      yield { type: "error", message: `${t.bin}: ${failed.message}${err ? `\n${err}` : ""}`, failure: { reason: /auth|login|credential/i.test(`${failed.message} ${err}`) ? "auth" : "unavailable" } }
      return
    }
    if (refused) yield { type: "text", delta: `\n\n_(${refused} action${refused > 1 ? "s" : ""} refused: this agent's access is "Ask first", which this engine can't ask for yet.)_` }
    yield { type: "done", usage: { inputTokens: 0, outputTokens: 0 } }
  } finally {
    proc.kill()
  }
}
