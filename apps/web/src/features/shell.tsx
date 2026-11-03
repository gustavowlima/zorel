// A shell tab of the Terminal panel: xterm.js in the browser, a login shell in a pseudo-terminal on the server
// (GET /api/terminals, a WebSocket). Keystrokes go up as {"t":"i"} frames; the panel's size follows the box
// (FitAddon on a ResizeObserver) and goes up as {"t":"r"} frames; the shell's output comes back as bytes.
// The xterm instance lives as long as the tab: switching tabs only hides it.
import "@xterm/xterm/css/xterm.css"
import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import { t } from "@zero/i18n"
import { useEffect, useRef } from "react"

const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

export function Shell({ chatId, visible, onExit }: { chatId: string; visible: boolean; onExit: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const fitRef = useRef<FitAddon>(null)
  const exitRef = useRef(onExit)
  exitRef.current = onExit

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
    const fit = new FitAddon()
    fitRef.current = fit
    term.loadAddon(fit)
    term.open(el)
    fit.fit()

    const url = new URL("/api/terminals", location.href)
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:"
    url.search = new URLSearchParams({ chat: chatId, cols: String(term.cols), rows: String(term.rows) }).toString()
    const ws = new WebSocket(url)
    ws.binaryType = "arraybuffer"
    const send = (frame: object) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(frame))
    ws.onmessage = (e) => term.write(typeof e.data === "string" ? e.data : new Uint8Array(e.data as ArrayBuffer))
    ws.onclose = () => {
      term.write(`\r\n\x1b[2m${t("workspace.shellEnded")}\x1b[0m\r\n`)
      term.options.disableStdin = true
      exitRef.current()
    }
    const input = term.onData((d) => send({ t: "i", d }))
    const resize = term.onResize(({ cols, rows }) => send({ t: "r", c: cols, r: rows }))
    // Fit on every size change of the box (dragging the panel, the window), once per frame.
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => el.offsetParent && fit.fit())
    })
    observer.observe(el)
    term.focus()
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      input.dispose()
      resize.dispose()
      ws.onclose = null
      ws.close()
      term.dispose()
    }
  }, [chatId])

  // Shown again: take the size the box has now.
  useEffect(() => {
    if (visible) requestAnimationFrame(() => fitRef.current?.fit())
  }, [visible])

  return <div ref={box} className="min-h-0 flex-1 overflow-hidden bg-code px-2 py-1.5" />
}
