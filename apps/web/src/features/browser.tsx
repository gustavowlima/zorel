// The Browser tab of the chat's side panel: the agents' browser (apps/server/src/browser.ts) live, over a WebSocket
// (GET /api/browser): the chat's tabs and whether a person holds it come as JSON, the active tab as JPEG frames.
// Clicking, scrolling or typing on the page, or using the address bar, takes control: while it is held, the
// agents' browser tools are refused; "Hand back" returns it. Positions go up as fractions of the frame.
// While an agent works, its pointer moves over the page to where it acts, and the bar says what it's doing.
import { t } from "@zorel/i18n"
import { type KeyboardEvent, type MouseEvent, useEffect, useRef, useState } from "react"
import { agentsAtom, useList } from "../client.ts"
import { agentName, agentTone } from "../labels.ts"
import { AgentAvatar, AgentPointer, ArrowRight, Button, ChevronRight, cx, Globe, IconButton, Input, Maximize2, Minimize2, Plus, RefreshCw, Spinner, Tooltip, X } from "@/ui"

type Tab = { id: string; title: string; url: string; active: boolean }
type Frame =
  | { t: "click"; x: number; y: number; button?: "left" | "right"; clicks?: number }
  | { t: "wheel"; x: number; y: number; dx: number; dy: number }
  | { t: "key"; key: string }
  | { t: "text"; text: string }
  | { t: "nav"; url: string }
  | { t: "open"; url: string }
  | { t: "back" | "forward" | "reload" | "newtab" | "release" }
  | { t: "tab" | "close"; id: string }

// An agent's action, from the server (BrowserAct): its tool, the element's name and where it is, then done.
type Act = { agentId: string | null; tool: string; target?: string; x?: number; y?: number; done?: boolean; at: number }
const IDLE_MS = 3000 // the pointer and the line stay this long after the agent's last action

// What the bar says for each tool (the element's name follows in quotes).
const DOING: Readonly<Record<string, (name: string) => string>> = {
  browser_navigate: (name) => t("browser.doing.navigate", { name }),
  browser_snapshot: (name) => t("browser.doing.read", { name }),
  browser_click: (name) => t("browser.doing.click", { name }),
  browser_type: (name) => t("browser.doing.type", { name }),
  browser_press: (name) => t("browser.doing.press", { name }),
  browser_hover: (name) => t("browser.doing.hover", { name }),
  browser_select: (name) => t("browser.doing.select", { name }),
  browser_scroll: (name) => t("browser.doing.scroll", { name }),
  browser_wait: (name) => t("browser.doing.wait", { name }),
  browser_tabs: (name) => t("browser.doing.tabs", { name }),
  browser_back: (name) => t("browser.doing.back", { name }),
  browser_upload: (name) => t("browser.doing.upload", { name }),
  browser_dialog: (name) => t("browser.doing.dialog", { name }),
  browser_run: (name) => t("browser.doing.steps", { name })
}
const doingLine = (a: Act, name: string) => `${(DOING[a.tool] ?? DOING.browser_run!)(name)}${a.target ? ` “${a.target}”` : ""}`

// A key event as Playwright names it ("Control+A", "Enter"); printable text without modifiers goes as text.
function keyFrame(e: KeyboardEvent): Frame | undefined {
  if (e.key === "Dead" || e.key === "Unidentified" || ["Shift", "Control", "Alt", "Meta"].includes(e.key)) return undefined
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) return { t: "text", text: e.key }
  const mods = [e.ctrlKey && "Control", e.altKey && "Alt", e.metaKey && "Meta", e.shiftKey && e.key.length > 1 && "Shift"].filter(Boolean)
  return { t: "key", key: [...mods, e.key === " " ? "Space" : e.key].join("+") }
}

export function BrowserPanel({ chatId, openUrl, newTab = 0 }: { chatId: string; openUrl?: { url: string } | undefined; newTab?: number }) {
  const [tabs, setTabs] = useState<ReadonlyArray<Tab>>([])
  const [held, setHeld] = useState(false)
  const [frame, setFrame] = useState<string>()
  const [address, setAddress] = useState("")
  const [error, setError] = useState<string>()
  const [act, setAct] = useState<Act>()
  const [full, setFull] = useState(false) // the browser over the whole window, to drive it at a usable size
  const [idle, setIdle] = useState(true)
  const agents = useList(agentsAtom)
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
        const m = JSON.parse(e.data) as { t: string; tabs?: Tab[]; userControl?: boolean; message?: string } & Partial<Act>
        if (m.t === "state") {
          setTabs(m.tabs ?? [])
          setHeld(!!m.userControl)
        } else if (m.t === "error") setError(m.message)
        else if (m.t === "act") setAct(m as Act)
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
  // The agent's last action shows until IDLE_MS after it's done.
  useEffect(() => {
    setIdle(!act)
    if (!act?.done) return
    const timer = setTimeout(() => setIdle(true), IDLE_MS)
    return () => clearTimeout(timer)
  }, [act])
  const actor = act && agents.find((a) => a.id === act.agentId)
  const actorName = act ? agentName(act.agentId, agents) : ""
  const face = actor ? <AgentAvatar id={actor.id} name={actor.name} tone={agentTone(actor, agents)} size={16} /> : null
  const working = !!act && !idle && !held

  // The address bar follows the active tab unless it is being edited.
  const editing = useRef(false)
  useEffect(() => {
    if (!editing.current) setAddress(active?.url && active.url !== "about:blank" ? active.url : "")
  }, [active?.url])

  const send = (f: Frame) => {
    setError(undefined)
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(f))
    else ws.current?.addEventListener("open", () => ws.current?.send(JSON.stringify(f)), { once: true })
  }
  // Asked to open a URL (a server from the Terminal panel): in a new tab of the chat's browser.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new request opens it
  useEffect(() => {
    if (!openUrl) return
    send({ t: "open", url: openUrl.url }) // opening a page isn't taking the browser from the agents
  }, [openUrl])

  // Browser asked for again from the side panel's +: a new tab.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new request opens one
  useEffect(() => {
    if (newTab) send({ t: "newtab" })
  }, [newTab])

  const at = (e: MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }
  }

  return (
    <section
      aria-label={t("browser.title")}
      className={cx("flex min-h-0 min-w-0 flex-1 flex-col", full && "fixed inset-0 z-50 bg-canvas")}
      // Esc leaves full screen, except on the page itself (there it's the page's key).
      onKeyDown={(e) => {
        if (full && e.key === "Escape" && !(e.target as HTMLElement).closest("[role=application]")) setFull(false)
      }}
    >
      {/* Tabs, then the toolbar: back, forward, reload, the address, who holds it. */}
      <div className="flex items-center gap-1 border-b border-subtle px-2 py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <span key={tab.id} className={cx("group/tab flex h-control-sm max-w-48 min-w-0 items-center gap-1 rounded-full border pl-3", tab.active ? "border-subtle bg-surface text-fg" : "border-transparent text-muted")}>
              <Button variant="ghost" className="h-auto min-w-0 truncate p-0 text-sm font-normal hover:bg-transparent" onPress={() => send({ t: "tab", id: tab.id })}>
                {tab.title || tab.url || t("browser.newTab")}
              </Button>
              <IconButton label={t("browser.closeTab")} size="xs" onPress={() => send({ t: "close", id: tab.id })}>
                <X className="size-3" />
              </IconButton>
            </span>
          ))}
          <Tooltip content={t("browser.newTab")}>
            <IconButton label={t("browser.newTab")} size="xs" onPress={() => send({ t: "newtab" })}>
              <Plus className="size-3.5" />
            </IconButton>
          </Tooltip>
        </div>
        <Tooltip content={full ? t("browser.exitFullScreen") : t("browser.fullScreen")}>
          <IconButton label={full ? t("browser.exitFullScreen") : t("browser.fullScreen")} size="xs" onPress={() => setFull(!full)}>
            {full ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </IconButton>
        </Tooltip>
      </div>
      <form
        className="flex items-center gap-1 border-b border-subtle px-2 py-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          editing.current = false
          if (address.trim()) send({ t: "nav", url: address.trim() })
        }}
      >
        <IconButton label={t("browser.back")} size="xs" onPress={() => send({ t: "back" })} isDisabled={!active}>
          <ChevronRight className="size-3.5 rotate-180" />
        </IconButton>
        <IconButton label={t("browser.forward")} size="xs" onPress={() => send({ t: "forward" })} isDisabled={!active}>
          <ChevronRight className="size-3.5" />
        </IconButton>
        <IconButton label={t("browser.reload")} size="xs" onPress={() => send({ t: "reload" })} isDisabled={!active}>
          <RefreshCw className="size-3.5" />
        </IconButton>
        <Input
          size="sm"
          className="flex-1"
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
        <IconButton label={t("browser.go")} size="xs" type="submit">
          <ArrowRight className="size-3.5" />
        </IconButton>
      </form>
      {/* Who holds the browser: the agents (and what one is doing now), or you (then they wait). */}
      <div aria-live="polite" className={cx("flex items-center gap-2 px-3 py-1.5 text-sm", held ? "bg-accent-soft text-accent-text" : working ? "text-secondary" : "text-muted")}>
        {working && (act.done ? face : <Spinner size={12} />)}
        <span className="min-w-0 flex-1 truncate">{held ? t("browser.youHold") : working ? doingLine(act, actorName) : t("browser.agentsMayUse")}</span>
        {held && (
          <Button size="sm" variant="secondary" onPress={() => send({ t: "release" })}>
            {t("browser.handBack")}
          </Button>
        )}
      </div>
      {error && <p className="px-3 py-1.5 text-sm text-danger">{error}</p>}
      <div className={cx("flex min-h-0 flex-1 justify-center overflow-auto bg-code p-2", full ? "items-center" : "items-start")}>
        {active && frame ? (
          <div
            role="application"
            aria-label={t("browser.page", { title: active.title || active.url })}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: a remote page drawn as frames (role application): it takes focus so keys go to the page
            tabIndex={0}
            className="relative w-full cursor-default overflow-hidden rounded-control border border-subtle outline-none focus-visible:ring-2 focus-visible:ring-accent"
            // Full screen: as large as the window allows at the page's 16:10, so a position on it is a position on the page.
            style={{ aspectRatio: "1280 / 800", ...(full && { width: "min(100%, calc((100vh - 9.5rem) * 1.6))" }) }}
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
            {act?.x !== undefined && act.y !== undefined && !held && (
              <AgentPointer
                x={act.x}
                y={act.y}
                pulse={act.at}
                faded={idle}
                label={
                  <>
                    {face}
                    {actorName}
                  </>
                }
              />
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
            <Globe className="size-5 text-muted" />
            <p className="font-medium">{t("browser.empty")}</p>
            <p className="max-w-sm text-muted">{t("browser.emptyHint")}</p>
          </div>
        )}
      </div>
    </section>
  )
}

