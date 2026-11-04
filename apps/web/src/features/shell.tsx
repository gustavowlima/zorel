// One shell pane of the Terminal panel: xterm.js on a session that lives on the server (GET /api/terminals, a
// WebSocket; see apps/server/src/terminals.ts). A new pane opens a session and learns its id from the first
// frame; a pane with an id reattaches to it and gets the last output back. Keystrokes go up as {"t":"i"} frames,
// the size follows the box (FitAddon on a ResizeObserver) as {"t":"r"}; the output comes back as bytes. A
// dropped connection retries a few times; close code 4000 means the shell ended.
// URLs are links (web-links addon); file paths are links that open the file (inside the chat's folder) in the
// computer's default app. Selected text can go to the chat's message box.
import "@xterm/xterm/css/xterm.css"
import { FitAddon } from "@xterm/addon-fit"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { type ILink, Terminal } from "@xterm/xterm"
import { t } from "@zero/i18n"
import { useEffect, useRef, useState } from "react"
import { Button, MessageCircle } from "@/ui"

const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()
// A path printed by a tool: "src/a.ts", "./x.md:12", "/abs/file.json:3:4" (needs a slash or an extension).
const PATH = /(?<![\w@./-])((?:\.{1,2}\/|\/)?(?:[\w@.-]+\/)*[\w@-][\w@.-]*\.[A-Za-z0-9]{1,8})(?::\d+(?::\d+)?)?(?![\w/])/g
const RETRIES = 5

export function Shell({
  chatId,
  sessionId,
  run,
  visible,
  onSession,
  onEnded,
  onAddToChat,
  onOpenFile
}: {
  chatId: string
  sessionId: string | undefined
  run?: string | undefined // a new session runs this project script
  visible: boolean
  onSession: (id: string) => void
  onEnded: () => void
  onAddToChat: (text: string) => void
  onOpenFile: (path: string) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const fitRef = useRef<FitAddon>(null)
  const termRef = useRef<Terminal>(null)
  const [selection, setSelection] = useState("")
  const handlers = useRef({ onSession, onEnded, onOpenFile })
  handlers.current = { onSession, onEnded, onOpenFile }
  // The session this pane is on: known up front when reattaching, learned from the first frame when new.
  const session = useRef(sessionId)
  const script = useRef(run) // read once: only the session's first connection runs it

  useEffect(() => {
    const el = box.current
    if (!el) return
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: token("--font-mono") || "monospace",
      fontSize: 12,
      scrollback: 5000,
      theme: { background: token("--z-bg-code"), foreground: token("--z-text-secondary"), cursor: token("--z-text"), selectionBackground: token("--z-accent-soft") }
    })
    termRef.current = term
    const fit = new FitAddon()
    fitRef.current = fit
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon((_e, uri) => window.open(uri, "_blank", "noopener")))
    const paths = term.registerLinkProvider({
      provideLinks(y, done) {
        const line = term.buffer.active.getLine(y - 1)?.translateToString(true) ?? ""
        const links: ILink[] = []
        for (const m of line.matchAll(PATH)) {
          if (/^https?:/.test(line.slice(Math.max(0, (m.index ?? 0) - 8), m.index))) continue // part of a URL
          const start = (m.index ?? 0) + 1
          links.push({ range: { start: { x: start, y }, end: { x: start + m[0].length - 1, y } }, text: m[1] ?? m[0], activate: (_e, text) => handlers.current.onOpenFile(text) })
        }
        done(links)
      }
    })
    term.open(el)
    fit.fit()
    const selected = term.onSelectionChange(() => setSelection(term.getSelection()))

    let ws: WebSocket | undefined
    let tries = 0
    let retry: ReturnType<typeof setTimeout> | undefined
    let disposed = false
    const send = (frame: object) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(frame))
    const connect = () => {
      const url = new URL("/api/terminals", location.href)
      url.protocol = location.protocol === "https:" ? "wss:" : "ws:"
      url.search = new URLSearchParams({ chat: chatId, cols: String(term.cols), rows: String(term.rows), ...(session.current ? { session: session.current } : script.current ? { run: script.current } : {}) }).toString()
      const socket = new WebSocket(url)
      ws = socket
      socket.binaryType = "arraybuffer"
      let attached = false
      socket.onmessage = (e) => {
        if (typeof e.data === "string") {
          const f = JSON.parse(e.data) as { t?: string; id?: string }
          if (f.t === "s" && f.id) {
            attached = true
            tries = 0
            if (session.current !== f.id) {
              session.current = f.id
              handlers.current.onSession(f.id)
            }
            term.reset() // the replay that follows is the whole recent screen
            send({ t: "r", c: term.cols, r: term.rows })
          }
          return
        }
        term.write(new Uint8Array(e.data as ArrayBuffer))
      }
      socket.onclose = (e) => {
        if (disposed) return
        // Ended (4000), or the session is gone (never attached to a known id): stop here.
        if (e.code === 4000 || (!attached && session.current && tries >= 1)) {
          term.write(`\r\n\x1b[2m${t("workspace.shellEnded")}\x1b[0m\r\n`)
          term.options.disableStdin = true
          handlers.current.onEnded()
          return
        }
        if (tries++ < RETRIES) retry = setTimeout(connect, 500 * tries)
      }
    }
    connect()
    const input = term.onData((d) => send({ t: "i", d }))
    const resize = term.onResize(({ cols, rows }) => send({ t: "r", c: cols, r: rows }))
    // Fit on every size change of the box (dragging the panel, a split, the window), once per frame.
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => el.offsetParent && fit.fit())
    })
    observer.observe(el)
    term.focus()
    return () => {
      // Unmounting only detaches: the session goes on on the server.
      disposed = true
      clearTimeout(retry)
      observer.disconnect()
      cancelAnimationFrame(frame)
      input.dispose()
      resize.dispose()
      selected.dispose()
      paths.dispose()
      // Unmounted before the server named the session (React's dev double mount, or a quick close): that
      // shell would run on unseen, so end it as soon as its id comes.
      if (!session.current && ws?.readyState === WebSocket.CONNECTING) {
        const orphan = ws
        orphan.onclose = null
        orphan.onmessage = (e) => {
          if (typeof e.data === "string" && (JSON.parse(e.data) as { t?: string }).t === "s") orphan.send(JSON.stringify({ t: "k" }))
        }
      } else ws?.close()
      term.dispose()
    }
  }, [chatId])

  // Shown again: take the size the box has now.
  useEffect(() => {
    if (visible) requestAnimationFrame(() => fitRef.current?.fit())
  }, [visible])

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <div ref={box} className="min-h-0 flex-1 overflow-hidden bg-code px-2 py-1.5" />
      {selection.trim() && (
        <div className="absolute top-2 right-3">
          <Button
            size="sm"
            variant="secondary"
            onPress={() => {
              onAddToChat(selection)
              termRef.current?.clearSelection()
            }}
          >
            <MessageCircle />
            {t("workspace.addToChat")}
          </Button>
        </div>
      )}
    </div>
  )
}
