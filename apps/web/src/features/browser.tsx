// The chat's Browser panel: the agents' browser (apps/server/src/browser.ts) live, over a WebSocket
// (GET /api/browser): the chat's tabs and whether a person holds it come as JSON, the active tab as JPEG frames.
// Clicking, scrolling or typing on the page, or using the address bar, takes control: while it is held, the
// agents' browser tools are refused; "Hand back" returns it. Positions go up as fractions of the frame.
import { t } from "@zero/i18n"
import { type KeyboardEvent, type MouseEvent, useEffect, useRef, useState } from "react"
import { ArrowRight, Button, ChevronRight, cx, Globe, IconButton, Input, Plus, RefreshCw, Tooltip, X } from "@/ui"

type Tab = { id: string; title: string; url: string; active: boolean }
type Frame =
  | { t: "click"; x: number; y: number; button?: "left" | "right"; clicks?: number }
  | { t: "wheel"; x: number; y: number; dx: number; dy: number }
  | { t: "key"; key: string }
  | { t: "text"; text: string }
  | { t: "nav"; url: string }
  | { t: "back" | "forward" | "reload" | "newtab" | "release" }
  | { t: "tab" | "close"; id: string }

// A key event as Playwright names it ("Control+A", "Enter"); printable text without modifiers goes as text.
function keyFrame(e: KeyboardEvent): Frame | undefined {
  if (e.key === "Dead" || e.key === "Unidentified" || ["Shift", "Control", "Alt", "Meta"].includes(e.key)) return undefined
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) return { t: "text", text: e.key }
  const mods = [e.ctrlKey && "Control", e.altKey && "Alt", e.metaKey && "Meta", e.shiftKey && e.key.length > 1 && "Shift"].filter(Boolean)
  return { t: "key", key: [...mods, e.key === " " ? "Space" : e.key].join("+") }
}

export function BrowserPanel({ chatId, onClose }: { chatId: string; onClose: () => void }) {
  const [tabs, setTabs] = useState<ReadonlyArray<Tab>>([])
  const [held, setHeld] = useState(false)
  const [frame, setFrame] = useState<string>()
  const [address, setAddress] = useState("")
  const [error, setError] = useState<string>()
  const ws = useRef<WebSocket>(null)
  const active = tabs.find((x) => x.active)

  useEffect(() => {
    const url = new URL("/api/browser", location.href)
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:"
    url.search = new URLSearchParams({ chat: chatId }).toString()
    const socket = new WebSocket(url)
    socket.binaryType = "blob"
    ws.current = socket
    let last: string | undefined
    socket.onmessage = (e) => {
      if (typeof e.data === "string") {
        const m = JSON.parse(e.data) as { t: string; tabs?: Tab[]; userControl?: boolean; message?: string }
        if (m.t === "state") {
          setTabs(m.tabs ?? [])
          setHeld(!!m.userControl)
        } else if (m.t === "error") setError(m.message)
        return
      }
      // The newest frame replaces the last one (its object URL is released).
      const next = URL.createObjectURL(e.data as Blob)
      setFrame(next)
      if (last) URL.revokeObjectURL(last)
      last = next
    }
    return () => {
      socket.close()
      if (last) URL.revokeObjectURL(last)
    }
  }, [chatId])
  // The address bar follows the active tab unless it is being edited.
  const editing = useRef(false)
  useEffect(() => {
    if (!editing.current) setAddress(active?.url && active.url !== "about:blank" ? active.url : "")
  }, [active?.url])

  const send = (f: Frame) => {
    setError(undefined)
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(f))
  }
  const at = (e: MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }
  }

  return (
    <aside aria-label={t("browser.title")} className="flex w-2xl min-w-0 shrink-0 flex-col border-l border-subtle">
      {/* Tabs, then the toolbar: back, forward, reload, the address, who holds it. */}
      <div className="flex items-center gap-1 border-b border-subtle px-2 py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <span key={tab.id} className={cx("group/tab flex h-control-sm max-w-48 min-w-0 items-center gap-1 rounded-full border pl-3", tab.active ? "border-subtle bg-surface text-fg" : "border-transparent text-muted")}>
              <Button variant="ghost" className="h-auto min-w-0 truncate p-0 text-sm font-normal hover:bg-transparent" onPress={() => send({ t: "tab", id: tab.id })}>
                {tab.title || tab.url || t("browser.newTab")}
              </Button>
              <IconButton label={t("browser.closeTab")} size="sm" onPress={() => send({ t: "close", id: tab.id })}>
                <X className="size-3" />
              </IconButton>
            </span>
          ))}
          <Tooltip content={t("browser.newTab")}>
            <IconButton label={t("browser.newTab")} size="sm" onPress={() => send({ t: "newtab" })}>
              <Plus className="size-3.5" />
            </IconButton>
          </Tooltip>
        </div>
        <IconButton label={t("workspace.closePanel")} size="sm" onPress={onClose}>
          <X className="size-3.5" />
        </IconButton>
      </div>
      <form
        className="flex items-center gap-1 border-b border-subtle px-2 py-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          editing.current = false
          if (address.trim()) send({ t: "nav", url: address.trim() })
        }}
      >
        <IconButton label={t("browser.back")} size="sm" onPress={() => send({ t: "back" })} isDisabled={!active}>
          <ChevronRight className="size-3.5 rotate-180" />
        </IconButton>
        <IconButton label={t("browser.forward")} size="sm" onPress={() => send({ t: "forward" })} isDisabled={!active}>
          <ChevronRight className="size-3.5" />
        </IconButton>
        <IconButton label={t("browser.reload")} size="sm" onPress={() => send({ t: "reload" })} isDisabled={!active}>
          <RefreshCw className="size-3.5" />
        </IconButton>
        <Input
          className="h-control-sm flex-1 text-sm"
          aria-label={t("browser.address")}
          placeholder={t("browser.addressHint")}
          value={address}
          onFocus={() => {
            editing.current = true
          }}
          onBlur={() => {
            editing.current = false
          }}
          onChange={(e) => setAddress(e.target.value)}
        />
        <IconButton label={t("browser.go")} size="sm" type="submit">
          <ArrowRight className="size-3.5" />
        </IconButton>
      </form>
      {/* Who holds the browser: the agents, or you (then they wait). */}
      <div className={cx("flex items-center gap-2 px-3 py-1.5 text-sm", held ? "bg-accent-soft text-accent-text" : "text-muted")}>
        <span className="min-w-0 flex-1 truncate">{held ? t("browser.youHold") : t("browser.agentsMayUse")}</span>
        {held && (
          <Button size="sm" variant="secondary" onPress={() => send({ t: "release" })}>
            {t("browser.handBack")}
          </Button>
        )}
      </div>
      {error && <p className="px-3 py-1.5 text-sm text-danger">{error}</p>}
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto bg-code p-2">
        {active && frame ? (
          <div
            role="application"
            aria-label={t("browser.page", { title: active.title || active.url })}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: a remote page drawn as frames (role application): it takes focus so keys go to the page
            tabIndex={0}
            className="w-full cursor-default overflow-hidden rounded-control border border-subtle outline-none focus-visible:ring-2 focus-visible:ring-accent"
            style={{ aspectRatio: "1280 / 800" }}
            onMouseDown={(e) => {
              e.currentTarget.focus()
              send({ t: "click", ...at(e), button: e.button === 2 ? "right" : "left", clicks: e.detail === 2 ? 2 : 1 })
            }}
            onWheel={(e) => send({ t: "wheel", ...at(e), dx: e.deltaX, dy: e.deltaY })}
            onKeyDown={(e) => {
              const f = keyFrame(e)
              if (!f) return
              e.preventDefault()
              send(f)
            }}
            onPaste={(e) => {
              e.preventDefault()
              send({ t: "text", text: e.clipboardData.getData("text") })
            }}
          >
            <img src={frame} alt="" draggable={false} className="pointer-events-none size-full select-none object-contain" />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
            <Globe className="size-5 text-muted" />
            <p className="font-medium">{t("browser.empty")}</p>
            <p className="max-w-sm text-muted">{t("browser.emptyHint")}</p>
          </div>
        )}
      </div>
    </aside>
  )
}
