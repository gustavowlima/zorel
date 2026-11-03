// Shells in the browser (the chat's Terminal panel): a WebSocket per tab, each a login shell in a pseudo-terminal
// (Bun's PTY) started in the folder the chat's agents work in. The browser sends JSON frames — input
// {"t":"i","d":"…"} or a size {"t":"r","c":cols,"r":rows} — and gets the shell's output as binary frames.
// Local only, like every route (LocalOnly checks Host and Origin before the upgrade). The shell ends when the
// socket closes, and the socket closes when the shell exits.
import { Effect } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { Socket } from "effect/socket"
import { Store } from "./db.ts"
import { Workspace } from "./workspace.ts"

export const MAX_TERMINALS = 12 // open at once, across chats
const MAX_INPUT = 64 * 1024 // one input frame (a paste)
const size = (n: unknown, max: number) => (typeof n === "number" && Number.isInteger(n) && n >= 2 && n <= max ? n : undefined)

// One frame from the browser, or undefined when it isn't one of ours.
export function parseFrame(raw: string): { t: "i"; d: string } | { t: "r"; c: number; r: number } | undefined {
  try {
    const f = JSON.parse(raw) as { t?: unknown; d?: unknown; c?: unknown; r?: unknown }
    if (f.t === "i" && typeof f.d === "string" && f.d.length <= MAX_INPUT) return { t: "i", d: f.d }
    const c = size(f.c, 1000)
    const r = size(f.r, 500)
    if (f.t === "r" && c && r) return { t: "r", c, r }
  } catch {}
  return undefined
}

let open = 0

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
    if (open >= MAX_TERMINALS) return HttpServerResponse.jsonUnsafe({ error: "too_many_terminals" }, { status: 429 })
    const project = chat.projectId ? yield* store.project(chat.projectId) : undefined
    const cwd = workspace.cwdOf(chat.id, project)

    const socket = yield* req.upgrade
    const { write } = yield* socket.writer
    const reader = yield* socket.reader
    open++
    const shell = process.env.SHELL || "/bin/zsh"
    const proc = Bun.spawn([shell, "-l"], {
      cwd,
      env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
      terminal: {
        cols: size(Number(q.get("cols")), 1000) ?? 80,
        rows: size(Number(q.get("rows")), 500) ?? 24,
        data: (_t, data) => void Effect.runFork(write(new Uint8Array(data)).pipe(Effect.ignore))
      }
    })
    // The shell exited (exit, Ctrl-D): close the socket so the tab can say so.
    void proc.exited.then((code) => Effect.runFork(write(new Socket.CloseEvent(1000, `exit ${code}`)).pipe(Effect.ignore)))

    const decoder = new TextDecoder()
    yield* Effect.forever(
      Effect.flatMap(reader.pull, (chunks) =>
        Effect.sync(() => {
          for (const chunk of chunks) {
            const f = parseFrame(typeof chunk === "string" ? chunk : decoder.decode(chunk))
            if (f?.t === "i") proc.terminal?.write(f.d)
            else if (f?.t === "r") proc.terminal?.resize(f.c, f.r)
          }
        })
      )
    ).pipe(
      Effect.ignore, // the socket closed (or broke): end the shell
      Effect.ensuring(
        Effect.sync(() => {
          open--
          proc.kill()
          proc.terminal?.close()
        })
      )
    )
    return HttpServerResponse.empty()
  }).pipe(
    Effect.scoped,
    Effect.orDie
  )
)
