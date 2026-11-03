// Shells for the chat's Terminal panel. Each is a session: a login shell in a pseudo-terminal (Bun's PTY), started
// in the folder the chat's agents work in, that outlives its socket. Closing the panel or reloading the page only
// detaches it; attaching again replays the last output (a ring of SCROLLBACK bytes) and goes on live. The shell
// ends when the tab closes ({"t":"k"}) or exits by itself (the session then stays, ended, with its output).
//
// GET /api/terminals?chat=…[&session=…]&cols=&rows= upgrades to a WebSocket. Up: JSON frames — input
// {"t":"i","d":"…"}, size {"t":"r","c":cols,"r":rows}, kill {"t":"k"}. Down: first {"t":"s","id":…} (text), then
// the shell's output as bytes; an ended shell closes the socket with code 4000. Local only (LocalOnly checks Host
// and Origin before the upgrade).
import { Effect } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { Socket } from "effect/socket"
import { Store } from "./db.ts"
import { Workspace } from "./workspace.ts"

export const MAX_TERMINALS = 12 // live shells at once, across chats
const MAX_INPUT = 64 * 1024 // one input frame (a paste)
const SCROLLBACK = 256 * 1024 // output kept for a reattach
const size = (n: unknown, max: number) => (typeof n === "number" && Number.isInteger(n) && n >= 2 && n <= max ? n : undefined)

// One frame from the browser, or undefined when it isn't one of ours.
export function parseFrame(raw: string): { t: "i"; d: string } | { t: "r"; c: number; r: number } | { t: "k" } | undefined {
  try {
    const f = JSON.parse(raw) as { t?: unknown; d?: unknown; c?: unknown; r?: unknown }
    if (f.t === "i" && typeof f.d === "string" && f.d.length <= MAX_INPUT) return { t: "i", d: f.d }
    if (f.t === "k") return { t: "k" }
    const c = size(f.c, 1000)
    const r = size(f.r, 500)
    if (f.t === "r" && c && r) return { t: "r", c, r }
  } catch {}
  return undefined
}

// The last `max` bytes written, in order.
export class Ring {
  private chunks: Uint8Array[] = []
  private bytes = 0
  constructor(private readonly max: number) {}
  push(chunk: Uint8Array) {
    this.chunks.push(chunk)
    this.bytes += chunk.length
    while (this.bytes > this.max && this.chunks.length > 1) this.bytes -= this.chunks.shift()!.length
  }
  read(): Uint8Array {
    const out = new Uint8Array(this.bytes)
    let at = 0
    for (const c of this.chunks) {
      out.set(c, at)
      at += c.length
    }
    return out.length > this.max ? out.subarray(out.length - this.max) : out
  }
}

interface Session {
  readonly id: string
  readonly chatId: string
  readonly n: number // "Shell n" in its chat
  readonly proc: Bun.Subprocess
  readonly output: Ring
  ended: boolean
  send?: ((chunk: Uint8Array) => void) | undefined // the attached socket, if any
  close?: (() => void) | undefined
}

const sessions = new Map<string, Session>()
const live = () => [...sessions.values()].filter((s) => !s.ended).length

// Whether the shell has something running in it (a child process), so closing it should ask first.
function busy(s: Session): boolean {
  if (s.ended) return false
  const r = Bun.spawnSync(["pgrep", "-P", String(s.proc.pid)], { stdout: "pipe", stderr: "ignore" })
  return r.exitCode === 0 && r.stdout.toString().trim().length > 0
}

export const terminalsOf = (chatId: string) =>
  [...sessions.values()].filter((s) => s.chatId === chatId).map((s) => ({ id: s.id, n: s.n, ended: s.ended, busy: busy(s) }))

function end(s: Session) {
  if (!s.ended) {
    s.ended = true
    s.proc.kill()
  }
}

// Closing a tab: the shell ends and the session is forgotten.
export function closeTerminal(id: string) {
  const s = sessions.get(id)
  if (!s) return
  end(s)
  s.proc.terminal?.close()
  s.close?.()
  sessions.delete(id)
}

function open(chatId: string, cwd: string, cols: number, rows: number): Session {
  const n = Math.max(0, ...[...sessions.values()].filter((s) => s.chatId === chatId).map((s) => s.n)) + 1
  const output = new Ring(SCROLLBACK)
  let session: Session | undefined
  const proc = Bun.spawn([process.env.SHELL || "/bin/zsh", "-l"], {
    cwd,
    env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
    terminal: {
      cols,
      rows,
      data: (_t, data) => {
        const chunk = new Uint8Array(data)
        output.push(chunk)
        session?.send?.(chunk)
      }
    }
  })
  session = { id: crypto.randomUUID(), chatId, n, proc, output, ended: false }
  const s = session
  void proc.exited.then(() => {
    s.ended = true
    s.close?.()
  })
  sessions.set(s.id, s)
  return s
}

export const TerminalSocket = HttpRouter.add(
  "GET",
  "/api/terminals",
  Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest
    const q = new URL(req.url, "http://x").searchParams
    const store = yield* Store
    const workspace = yield* Workspace
    const chat = yield* store.chat(q.get("chat") ?? "")
    if (!chat) return HttpServerResponse.jsonUnsafe({ error: "chat_not_found" }, { status: 404 })
    const wanted = q.get("session")
    let s = wanted ? sessions.get(wanted) : undefined
    if (wanted && (!s || s.chatId !== chat.id)) return HttpServerResponse.jsonUnsafe({ error: "terminal_not_found" }, { status: 404 })
    if (!s) {
      if (live() >= MAX_TERMINALS) return HttpServerResponse.jsonUnsafe({ error: "too_many_terminals" }, { status: 429 })
      const project = chat.projectId ? yield* store.project(chat.projectId) : undefined
      s = open(chat.id, workspace.cwdOf(chat.id, project), size(Number(q.get("cols")), 1000) ?? 80, size(Number(q.get("rows")), 500) ?? 24)
    }
    const session = s

    const socket = yield* req.upgrade
    const { write } = yield* socket.writer
    const reader = yield* socket.reader
    const run = (e: Effect.Effect<void, unknown>) => void Effect.runFork(Effect.ignore(e))
    // One socket per session: a newer attach takes over from an older one.
    session.close?.()
    const bye = () => run(write(new Socket.CloseEvent(4000, "ended")))
    session.send = (chunk) => run(write(chunk))
    session.close = bye
    yield* write(JSON.stringify({ t: "s", id: session.id, n: session.n }))
    const replay = session.output.read()
    if (replay.length) yield* write(replay)
    if (session.ended) bye()

    const decoder = new TextDecoder()
    yield* Effect.forever(
      Effect.flatMap(reader.pull, (chunks) =>
        Effect.sync(() => {
          for (const chunk of chunks) {
            const f = parseFrame(typeof chunk === "string" ? chunk : decoder.decode(chunk))
            if (f?.t === "i" && !session.ended) session.proc.terminal?.write(f.d)
            else if (f?.t === "r" && !session.ended) session.proc.terminal?.resize(f.c, f.r)
            else if (f?.t === "k") closeTerminal(session.id)
          }
        })
      )
    ).pipe(
      Effect.ignore,
      // The socket went away: detach (the shell goes on) unless a newer socket already took over.
      Effect.ensuring(
        Effect.sync(() => {
          if (session.close === bye) {
            session.send = undefined
            session.close = undefined
          }
        })
      )
    )
    return HttpServerResponse.empty()
  }).pipe(Effect.scoped, Effect.orDie)
)
