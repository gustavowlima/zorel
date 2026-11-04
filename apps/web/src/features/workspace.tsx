// Workspace in the chat (prototype: right panel Changes/Files, bottom terminal): what each turn changed,
// with its diff and undo; the project's files marked with what this chat changed; the commands the agents
// ran, with their output. Data comes from Zero's checkpoints, the same for every harness.
import type { Agent, Chat, FileChange, Message, Project, WorkspaceFile } from "@zero/contracts"
import { useAtomValue } from "@effect/atom-react"
import { formatTime, t } from "@zero/i18n"
import { AsyncResult } from "effect/reactivity"
import { lazy, type PointerEvent as ReactPointerEvent, Suspense, useEffect, useMemo, useRef, useState } from "react"
import { diffAtom, filesAtom, localServersAtom, mutations, scriptsAtom, terminalsAtom, useInvalidate, useMutation, useReading } from "../client.ts"
import { agentName } from "../labels.ts"
// The diff viewer and its highlighter load with the panel, not with the app.
const DiffView = lazy(() => import("./diff-view.tsx"))
import {
  Button, ChevronDown, ChevronRight, ConfirmButton, cx, EmptyState, File, Folder, FolderOpen, IconButton, Spinner, Tab, TabList,
  Columns2, ConfirmDialog, ContextMenu, Globe, Menu, MenuItem, PanelRight, Pin, PinOff, Play, Plus, Popover, Rows2, Server, Square, SquareTerminal, TabPanel, Tabs, Tooltip, X
} from "@/ui"
import { Shell } from "./shell.tsx"
import { BrowserPanel } from "./browser.tsx"


export type Focus = { readonly turnId: string; readonly path: string | null }

const sumOf = (changes: ReadonlyArray<FileChange>) => changes.reduce((s, c) => ({ added: s.added + c.added, removed: s.removed + c.removed }), { added: 0, removed: 0 })

export const Delta = ({ added, removed }: { added: number; removed: number }) => (
  <span className="font-mono text-sm tabular-nums">
    <span className="text-success">{`+${added}`}</span> <span className="text-danger">{`−${removed}`}</span>
  </span>
)

// The total this chat changed (header button), counting only what wasn't undone.
export function chatDelta(messages: ReadonlyArray<Message>) {
  return sumOf(messages.filter((m) => !m.revertedAt).flatMap((m) => m.changes))
}

// Under a reply: "3 files +130 −33 · View · Undo" (or "Undone").
export function TurnChanges({ message, onView }: { message: Message; onView: (f: Focus) => void }) {
  const undo = useMutation(mutations.undo)
  const [error, setError] = useState<string>()
  if (!message.changes.length || !message.turnId) return null
  const turnId = message.turnId
  const total = sumOf(message.changes)
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2 self-start rounded-card border border-subtle px-3 py-1.5 text-sm">
        <File className="size-3.5 text-muted" />
        <span className="text-secondary">{t("workspace.filesChanged", { count: message.changes.length })}</span>
        <Delta {...total} />
        {message.revertedAt ? (
          <span className="text-muted">{`· ${t("workspace.undone")}`}</span>
        ) : (
          <>
            <Button size="sm" variant="ghost" className="h-6 px-2" onPress={() => onView({ turnId, path: null })}>
              {t("workspace.viewDiff")}
            </Button>
            <ConfirmButton
              size="sm"
              variant="ghost"
              className="h-6 px-2"
              title={t("workspace.undoTitle")}
              description={t("workspace.undoBody")}
              confirmLabel={t("workspace.undo")}
              onConfirm={() => {
                setError(undefined)
                undo({ params: { id: turnId }, reactivityKeys: ["workspace", "chats"] }).catch((e: unknown) => {
                  const files = (e as { files?: ReadonlyArray<string> })?.files
                  setError(t("workspace.undoConflict", { files: files?.join(", ") ?? "" }))
                })
              }}
            >
              {t("workspace.undo")}
            </ConfirmButton>
          </>
        )}
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  )
}

// ---------- side panel (T3 Code's pattern: one panel, its surfaces as tabs) ----------

export type SideTab = "changes" | "files" | "browser" | "terminal"

// ---------- pins: a side-panel tab or a shell, put up in the chat's title row as a shortcut ----------
// Side tabs are pinned for every chat (this computer); shells, for their chat (a shell lives in one chat).
export type ShellPin = { readonly session: string; readonly label: string }
const SIDE_PINS_KEY = "zero.pins.side"
const SHELL_PINS_KEY = (chatId: string) => `zero.pins.shell.${chatId}`
const readJson = <A,>(key: string, fallback: A): A => {
  try {
    return (JSON.parse(store.get(key) ?? "null") as A) ?? fallback
  } catch {
    return fallback
  }
}

export function usePins(chatId: string) {
  const [side, setSide] = useState<ReadonlyArray<SideTab>>(() => readJson(SIDE_PINS_KEY, []))
  const [shells, setShells] = useState<ReadonlyArray<ShellPin>>(() => readJson(SHELL_PINS_KEY(chatId), []))
  useEffect(() => setShells(readJson(SHELL_PINS_KEY(chatId), [])), [chatId])
  const saveSide = (next: ReadonlyArray<SideTab>) => {
    setSide(next)
    store.set(SIDE_PINS_KEY, JSON.stringify(next))
  }
  const saveShells = (next: ReadonlyArray<ShellPin>) => {
    setShells(next)
    store.set(SHELL_PINS_KEY(chatId), JSON.stringify(next))
  }
  return {
    side,
    shells,
    toggleSide: (tab: SideTab) => saveSide(side.includes(tab) ? side.filter((x) => x !== tab) : [...side, tab]),
    toggleShell: (pin: ShellPin) => saveShells(shells.some((x) => x.session === pin.session) ? shells.filter((x) => x.session !== pin.session) : [...shells, pin]),
    dropShell: (session: string) => shells.some((x) => x.session === session) && saveShells(shells.filter((x) => x.session !== session))
  }
}
export type Pins = ReturnType<typeof usePins>

export const SIDE_ICON: Record<SideTab, typeof PanelRight> = { changes: PanelRight, files: Folder, browser: Globe, terminal: SquareTerminal }
export const sideLabel = (tab: SideTab) => (tab === "browser" ? t("browser.title") : t(`workspace.${tab}`))

// The pin/unpin item of a right-click menu.
export const PinItem = ({ pinned, onAction }: { pinned: boolean; onAction: () => void }) => (
  <MenuItem icon={pinned ? <PinOff /> : <Pin />} onAction={onAction}>
    {pinned ? t("workspace.unpin") : t("workspace.pin")}
  </MenuItem>
)
const WIDTH_KEY = "zero.side.width"
const MIN_WIDTH = 360

// The panel to the right of the chat: Changes, Files, Browser and Terminal as tabs (Files and Terminal only with a
// project folder). Its left edge drags (or takes the arrow keys) to change the width, remembered on this computer.
// The browser and the terminal stay mounted once opened, so switching tabs keeps them live.
export function SidePanel({
  chat,
  project,
  messages,
  agents,
  tab,
  onTab,
  focus,
  onFocus,
  onClose,
  browserUrl,
  onOpenUrl,
  onAddToChat,
  pins,
  shellFocus
}: {
  chat: Chat
  project: Project | undefined
  messages: ReadonlyArray<Message>
  agents: ReadonlyArray<Agent>
  tab: SideTab
  onTab: (t: SideTab) => void
  focus: Focus | undefined
  onFocus: (f: Focus) => void
  onClose: () => void
  browserUrl: { url: string } | undefined
  onOpenUrl: (url: string) => void
  onAddToChat: (text: string) => void
  pins: Pins
  shellFocus: { session: string } | undefined // a pinned shell was pressed: show it
}) {
  const [width, setWidth] = useState(() => Number(store.get(WIDTH_KEY)) || 560)
  const [opened, setOpened] = useState<ReadonlySet<SideTab>>(() => new Set([tab]))
  const [shellKey, setShellKey] = useState(0) // the last shell closed: a fresh terminal next time
  useEffect(() => setOpened((s) => (s.has(tab) ? s : new Set([...s, tab]))), [tab])
  const folder = !!project?.path
  const delta = chatDelta(messages)
  const max = () => Math.round(window.innerWidth * 0.7)
  const resize = (next: number) => {
    const w = Math.min(max(), Math.max(MIN_WIDTH, Math.round(next)))
    setWidth(w)
    store.set(WIDTH_KEY, String(w))
  }
  const drag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const startX = e.clientX
    const startW = width
    e.currentTarget.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => resize(startW + (startX - ev.clientX))
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }

  return (
    <aside aria-label={t("workspace.panel")} className="relative flex min-w-0 shrink-0 flex-col border-l border-subtle" style={{ width }}>
      {/* biome-ignore lint/a11y/useSemanticElements: a focusable splitter (ARIA window splitter); <hr> can't take focus or a value */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("workspace.resizePanel")}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={max()}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={drag}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") resize(width + 32)
          else if (e.key === "ArrowRight") resize(width - 32)
          else return
          e.preventDefault()
        }}
        className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:left-1 after:w-px after:bg-transparent hover:after:bg-accent focus-visible:after:bg-accent"
      />
      <Tabs selectedKey={tab} onSelectionChange={(k) => onTab(k as SideTab)} className="min-h-0 flex-1 gap-0">
        <div className="flex items-center gap-2 border-b border-subtle px-3 py-2">
          {/* Right-click a tab: pin it to the chat's title row. */}
          <ContextMenu
            label={t("workspace.panel")}
            className="min-w-0 flex-1"
            menuFor={(el) => {
              const id = el.closest('[role="tab"]')?.querySelector<HTMLElement>("[data-side-tab]")?.dataset.sideTab as SideTab | undefined
              return id && <PinItem pinned={pins.side.includes(id)} onAction={() => pins.toggleSide(id)} />
            }}
          >
            <TabList label={t("workspace.panel")} className="min-w-0 flex-nowrap overflow-x-auto">
              {(["changes", "files", "browser", "terminal"] as const)
                .filter((id) => folder || (id !== "files" && id !== "terminal"))
                .map((id) => {
                  const Icon = SIDE_ICON[id]
                  return (
                    <Tab key={id} id={id}>
                      <span data-side-tab={id} className="flex items-center gap-1.5 whitespace-nowrap">
                        <Icon className="size-3.5" />
                        {sideLabel(id)}
                        {id === "changes" && delta.added + delta.removed > 0 && <Delta {...delta} />}
                        {pins.side.includes(id) && <Pin className="size-3 text-dim" aria-label={t("workspace.pinned")} />}
                      </span>
                    </Tab>
                  )
                })}
            </TabList>
          </ContextMenu>
          <IconButton label={t("workspace.closePanel")} size="sm" onPress={onClose}>
            <X className="size-3.5" />
          </IconButton>
        </div>
        <TabPanel id="changes" className="min-h-0 flex-1 overflow-y-auto">
          <ChangesTab messages={messages} agents={agents} focus={focus} onFocus={onFocus} />
        </TabPanel>
        {folder && project && (
          <TabPanel id="files" className="min-h-0 flex-1 overflow-y-auto">
            <FilesTab project={project} chat={chat} messages={messages} onFocus={onFocus} />
          </TabPanel>
        )}
        <TabPanel id="browser" keepMounted={opened.has("browser")} className="flex min-h-0 flex-1 flex-col">
          {opened.has("browser") && <BrowserPanel chatId={chat.id} openUrl={browserUrl} />}
        </TabPanel>
        {folder && (
          <TabPanel id="terminal" keepMounted={opened.has("terminal")} className="flex min-h-0 flex-1 flex-col">
            {opened.has("terminal") && (
              <TerminalPanel
                key={shellKey}
                chatId={chat.id}
                visible={tab === "terminal"}
                onClose={() => setShellKey((k) => k + 1)}
                onAddToChat={onAddToChat}
                onOpenUrl={onOpenUrl}
                pins={pins}
                focus={shellFocus}
              />
            )}
          </TabPanel>
        )}
      </Tabs>
    </aside>
  )
}

function ChangesTab({ messages, agents, focus, onFocus }: { messages: ReadonlyArray<Message>; agents: ReadonlyArray<Agent>; focus: Focus | undefined; onFocus: (f: Focus) => void }) {
  const turns = messages.filter((m) => m.changes.length && m.turnId).reverse()
  if (!turns.length) return <EmptyState icon={<File />} title={t("workspace.noChanges")} hint={t("workspace.noChangesHint")} />
  const current = focus ?? { turnId: turns[0]!.turnId!, path: null }
  return (
    <div className="flex flex-col">
      {turns.map((m) => {
        const open = m.turnId === current.turnId
        return (
          <section key={m.id} className="border-b border-subtle">
            <Button variant="ghost" className="h-auto w-full justify-start gap-2 rounded-none px-4 py-2.5 font-normal" onPress={() => onFocus({ turnId: m.turnId!, path: null })}>
              {open ? <ChevronDown className="text-muted" /> : <ChevronRight className="text-muted" />}
              <span className="min-w-0 flex-1 truncate text-left text-secondary">{t("workspace.turnBy", { agent: agentName(m.agentId, agents), time: formatTime(m.at) })}</span>
              {m.revertedAt ? <span className="text-sm text-muted">{t("workspace.undone")}</span> : <Delta {...sumOf(m.changes)} />}
            </Button>
            {open && <TurnFiles message={m} path={current.path} onPath={(path) => onFocus({ turnId: m.turnId!, path })} />}
          </section>
        )
      })}
    </div>
  )
}

function TurnFiles({ message, path, onPath }: { message: Message; path: string | null; onPath: (p: string | null) => void }) {
  const result = useAtomValue(diffAtom(message.turnId!))
  const diff = AsyncResult.getOrElse(result, () => undefined)
  return (
    <div className="flex flex-col gap-2 px-3 pb-3">
      <ul className="flex flex-col">
        {message.changes.map((c) => (
          <li key={c.path}>
            <Button variant="ghost" className={cx("h-8 w-full justify-start gap-2 px-2 font-normal", path === c.path && "bg-surface")} onPress={() => onPath(path === c.path ? null : c.path)}>
              <StatusMark status={c.status} />
              <span className="min-w-0 flex-1 truncate text-left font-mono text-sm text-secondary">{c.path}</span>
              <Delta added={c.added} removed={c.removed} />
            </Button>
          </li>
        ))}
      </ul>
      {!diff && (
        <p className="flex items-center gap-2 px-2 text-sm text-muted">
          <Spinner size={12} /> {t("workspace.loadingDiff")}
        </p>
      )}
      {diff?.files
        .filter((f) => path === null || f.path === path)
        .map((f) => (
          <div key={f.path} className="overflow-hidden rounded-card border border-subtle">
            <div className="flex items-center gap-2 border-b border-subtle bg-surface px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate font-mono text-sm">{f.path}</span>
              <Delta added={f.added} removed={f.removed} />
            </div>
            {f.patch ? (
              <Suspense fallback={<p className="px-3 py-2 text-sm text-muted">{t("workspace.loadingDiff")}</p>}>
                <DiffView patch={f.patch} />
              </Suspense>
            ) : (
              <p className="px-3 py-2 text-sm text-muted">{t("workspace.binary")}</p>
            )}
          </div>
        ))}
    </div>
  )
}

const StatusMark = ({ status }: { status: FileChange["status"] | null }) =>
  status ? (
    <span
      role="img"
      aria-label={t(`workspace.${status}`)}
      className={cx("w-3 shrink-0 text-center font-mono text-xs font-semibold", status === "added" && "text-success", status === "deleted" && "text-danger", status === "modified" && "text-warning")}
    >
      {status === "added" ? "A" : status === "deleted" ? "D" : "M"}
    </span>
  ) : (
    <span className="w-3 shrink-0" />
  )

// ---------- files tree ----------

type Node = { name: string; path: string; status: WorkspaceFile["status"]; children: Map<string, Node> }

function treeOf(files: ReadonlyArray<WorkspaceFile>): Node {
  const root: Node = { name: "", path: "", status: null, children: new Map() }
  for (const f of files) {
    let node = root
    const parts = f.path.split("/")
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join("/")
      let next = node.children.get(part)
      if (!next) {
        next = { name: part, path, status: null, children: new Map() }
        node.children.set(part, next)
      }
      if (i === parts.length - 1) next.status = f.status
      else if (f.status && !next.status) next.status = "modified" // a folder shows it holds changes
      node = next
    })
  }
  return root
}

function FilesTab({ project, chat, messages, onFocus }: { project: Project; chat: Chat; messages: ReadonlyArray<Message>; onFocus: (f: Focus) => void }) {
  const files = AsyncResult.getOrElse(useAtomValue(filesAtom(project.id, chat.id)), () => undefined)
  const root = useMemo(() => (files ? treeOf(files) : undefined), [files])
  // A changed file opens the diff of the last turn that touched it.
  const lastTurnOf = (path: string) => [...messages].reverse().find((m) => m.turnId && m.changes.some((c) => c.path === path))?.turnId
  if (!root)
    return (
      <div className="flex justify-center py-10 text-muted">
        <Spinner />
      </div>
    )
  return (
    <ul aria-label={t("workspace.files")} className="flex flex-col px-2 py-2">
      {[...root.children.values()].sort(byFolderThenName).map((n) => (
        <TreeNode key={n.path} node={n} depth={0} onOpen={(path) => {
          const turnId = lastTurnOf(path)
          if (turnId) onFocus({ turnId, path })
        }} />
      ))}
    </ul>
  )
}

const byFolderThenName = (a: Node, b: Node) => Number(b.children.size > 0) - Number(a.children.size > 0) || a.name.localeCompare(b.name)

function TreeNode({ node, depth, onOpen }: { node: Node; depth: number; onOpen: (path: string) => void }) {
  const folder = node.children.size > 0
  const [open, setOpen] = useState(depth === 0 && node.status !== null)
  return (
    <li>
      <Button
        variant="ghost"
        {...(folder && { "aria-expanded": open })}
        className="h-7 w-full justify-start gap-1.5 px-1.5 font-normal"
        onPress={() => (folder ? setOpen(!open) : node.status && onOpen(node.path))}
      >
        <span className="shrink-0" style={{ width: depth * 14 }} />
        {folder ? open ? <FolderOpen className="text-muted" /> : <Folder className="text-muted" /> : <File className="text-dim" />}
        <span className={cx("min-w-0 flex-1 truncate text-left text-sm", node.status ? "text-fg" : "text-secondary")}>{node.name}</span>
        <StatusMark status={folder ? null : node.status} />
      </Button>
      {folder && open && (
        <ul>
          {[...node.children.values()].sort(byFolderThenName).map((c) => (
            <TreeNode key={c.path} node={c} depth={depth + 1} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </li>
  )
}

// ---------- terminal (read-only: the commands the agents ran) ----------

// The Terminal panel: shell tabs (the commands the agents ran show in the chat, in each reply's steps). A tab holds
// one to four panes (split side by side or stacked), each a shell that lives on the server: closing the panel or
// reloading only detaches, and the tabs come back from the server's list (the layout is remembered per chat).
// Closing a pane or a tab ends its shells, asking first when something still runs in one. It fills the side
// panel's Terminal tab.
const LAYOUT_KEY = (chatId: string) => `zero.terminal.layout.${chatId}`
const MAX_PANES = 4
type Pane = { readonly key: string; readonly session: string | undefined; readonly ended: boolean; readonly run?: string | undefined }
// label: the project script the tab runs ("dev"); a plain shell is "Shell n".
type ShellTab = { readonly key: string; readonly dir: "row" | "col"; readonly panes: ReadonlyArray<Pane>; readonly label?: string | null | undefined }
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v)
    } catch {
      // storage blocked: resets on reload
    }
  }
}
let paneCount = 0
const newPane = (session?: string, run?: string): Pane => ({ key: `pane-${++paneCount}`, session, ended: false, run })

export function TerminalPanel({
  chatId,
  visible,
  onClose,
  onAddToChat,
  onOpenUrl,
  pins,
  focus
}: {
  chatId: string
  pins: Pins
  focus: { session: string } | undefined // show the tab holding this shell (a pinned shell was pressed)
  visible: boolean // its tab in the side panel is the one shown
  onClose: () => void // the last shell closed
  onAddToChat: (text: string) => void
  onOpenUrl: (url: string) => void
}) {
  const sessionsResult = useAtomValue(terminalsAtom(chatId))
  const scripts = useReading(scriptsAtom(chatId)).items
  const closeTerminal = useMutation(mutations.closeTerminal)
  const openFile = useMutation(mutations.openFile)
  const [tabs, setTabs] = useState<ReadonlyArray<ShellTab>>([])
  const [tab, setTab] = useState("")
  const [confirm, setConfirm] = useState<{ keys: ReadonlyArray<string>; tabKey?: string }>()
  const restored = useRef(false)

  // Back from the server: the shells this chat still has, in the remembered layout (others get a tab each).
  useEffect(() => {
    if (restored.current || !AsyncResult.isSuccess(sessionsResult)) return
    restored.current = true
    const alive = new Set(sessionsResult.value.map((x) => x.id))
    const labelOf = (id: string | undefined) => sessionsResult.value.find((x) => x.id === id)?.label
    const saved = JSON.parse(store.get(LAYOUT_KEY(chatId)) ?? "[]") as Array<{ dir: "row" | "col"; sessions: string[] }>
    const placed = new Set<string>()
    const next: ShellTab[] = []
    for (const t of saved) {
      const ids = t.sessions.filter((id) => alive.has(id) && !placed.has(id))
      for (const id of ids) placed.add(id)
      const panes = ids.map((id) => newPane(id))
      if (panes.length) next.push({ key: `tab-${panes[0]!.key}`, dir: t.dir, panes, label: labelOf(ids[0]) })
    }
    for (const x of sessionsResult.value) if (!placed.has(x.id)) next.push({ key: `tab-${x.id}`, dir: "row", panes: [newPane(x.id)], label: x.label })
    // Opening the panel opens a shell: the chat's own when it has some, a new one otherwise.
    if (!next.length) {
      const pane = newPane()
      next.push({ key: `tab-${pane.key}`, dir: "row", panes: [pane] })
    }
    setTabs(next)
    setTab(next[0]!.key)
  }, [sessionsResult, chatId])
  // Remember the layout (which sessions share a tab, and how).
  useEffect(() => {
    if (restored.current) store.set(LAYOUT_KEY(chatId), JSON.stringify(tabs.map((t) => ({ dir: t.dir, sessions: t.panes.flatMap((p) => (p.session ? [p.session] : [])) }))))
  }, [tabs, chatId])

  // A new tab: a plain shell, or one running a project script.
  const add = (run?: string) => {
    const pane = newPane(undefined, run)
    const key = `tab-${pane.key}`
    setTabs((all) => [...all, { key, dir: "row", panes: [pane], label: run }])
    setTab(key)
  }
  const split = (dir: "row" | "col") =>
    setTabs((all) => all.map((t) => (t.key === tab && t.panes.length < MAX_PANES ? { ...t, dir, panes: [...t.panes, newPane()] } : t)))
  const patchPane = (paneKey: string, patch: Partial<Pane>) => setTabs((all) => all.map((t) => ({ ...t, panes: t.panes.map((p) => (p.key === paneKey ? { ...p, ...patch } : p)) })))
  // End these panes' shells and drop them (a tab goes when its last pane does).
  const drop = (keys: ReadonlyArray<string>) => {
    const gone = tabs.flatMap((t) => t.panes).filter((p) => keys.includes(p.key))
    for (const p of gone) {
      if (!p.session) continue
      void closeTerminal({ params: { id: chatId, terminal: p.session }, reactivityKeys: ["terminals"] })
      pins.dropShell(p.session) // its pin goes with it
    }
    const next = tabs.map((t) => ({ ...t, panes: t.panes.filter((p) => !keys.includes(p.key)) })).filter((t) => t.panes.length)
    setTabs(next)
    if (!next.length) onClose() // the last shell closed: the tab starts over with a fresh one
    else if (!next.some((t) => t.key === tab)) setTab(next.at(-1)!.key)
  }
  // Ask first when a shell among them is running something.
  const close = (keys: ReadonlyArray<string>) => {
    const ids = tabs.flatMap((t) => t.panes).filter((p) => keys.includes(p.key) && p.session && !p.ended).map((p) => p.session)
    if (!ids.length) return drop(keys)
    void fetch(`/api/chats/${chatId}/terminals`)
      .then((r) => r.json() as Promise<ReadonlyArray<{ id: string; busy: boolean }>>)
      .then((list) => (list.some((x) => ids.includes(x.id) && x.busy) ? setConfirm({ keys }) : drop(keys)))
      .catch(() => drop(keys))
  }
  const current = tabs.find((t) => t.key === tab)
  // A pinned shell pressed in the title row: its tab comes to the front.
  useEffect(() => {
    const holder = focus && tabs.find((x) => x.panes.some((p) => p.session === focus.session))
    if (holder) setTab(holder.key)
  }, [focus, tabs])
  const nameOf = (s: ShellTab) => s.label || t("workspace.shell", { n: tabs.indexOf(s) + 1 })

  return (
    <section aria-label={t("workspace.terminal")} className="flex min-h-0 flex-1 flex-col">
      <Tabs selectedKey={tab} onSelectionChange={(k) => setTab(String(k))} className="min-h-0 flex-1 gap-0">
        {/* Delete or Backspace on a focused shell tab closes it (the × in the tab is for the pointer). */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: listens to keys bubbling from the focused tab; no interaction of its own */}
        <div
          className="flex items-center gap-1 px-3 py-1.5"
          onKeyDown={(e) => {
            if ((e.key === "Delete" || e.key === "Backspace") && current && (e.target as HTMLElement).getAttribute("role") === "tab") close(current.panes.map((p) => p.key))
          }}
        >
          {/* Right-click a shell tab: pin it to the chat's title row, or close it. */}
          <ContextMenu
            label={t("workspace.terminal")}
            className="min-w-0 flex-1"
            menuFor={(el) => {
              const key = el.closest('[role="tab"]')?.querySelector<HTMLElement>("[data-shell-tab]")?.dataset.shellTab
              const s = tabs.find((x) => x.key === key)
              const session = s?.panes[0]?.session
              if (!s || !session) return undefined
              return (
                <>
                  <PinItem pinned={pins.shells.some((x) => x.session === session)} onAction={() => pins.toggleShell({ session, label: nameOf(s) })} />
                  <MenuItem icon={<X />} onAction={() => close(s.panes.map((p) => p.key))}>
                    {t("workspace.closeShellNamed", { name: nameOf(s) })}
                  </MenuItem>
                </>
              )
            }}
          >
            <TabList label={t("workspace.terminal")} className="min-w-0 flex-nowrap overflow-x-auto">
              {tabs.map((s) => (
                <Tab key={s.key} id={s.key} onClose={() => close(s.panes.map((p) => p.key))} closeLabel={t("workspace.closeShellNamed", { name: nameOf(s) })}>
                  <span data-shell-tab={s.key} className={cx("flex items-center gap-1.5 whitespace-nowrap", s.panes.every((p) => p.ended) && "text-dim")}>
                    {s.label && <Play className="size-3" />}
                    {nameOf(s)}
                    {s.panes.length > 1 && <span className="text-dim">{` · ${s.panes.length}`}</span>}
                    {pins.shells.some((x) => s.panes.some((p) => p.session === x.session)) && <Pin className="size-3 text-dim" aria-label={t("workspace.pinned")} />}
                  </span>
                </Tab>
              ))}
            </TabList>
          </ContextMenu>
          {current && current.panes.length < MAX_PANES && (
            <>
              <Tooltip content={t("workspace.splitRight")}>
                <IconButton label={t("workspace.splitRight")} size="sm" onPress={() => split("row")}>
                  <Columns2 className="size-3.5" />
                </IconButton>
              </Tooltip>
              <Tooltip content={t("workspace.splitDown")}>
                <IconButton label={t("workspace.splitDown")} size="sm" onPress={() => split("col")}>
                  <Rows2 className="size-3.5" />
                </IconButton>
              </Tooltip>
            </>
          )}
          {scripts.length > 0 && (
            <Menu
              label={t("workspace.runScript")}
              trigger={
                <IconButton label={t("workspace.runScript")} size="sm">
                  <Play className="size-3.5" />
                </IconButton>
              }
            >
              {scripts.map((x) => (
                <MenuItem key={x.name} onAction={() => add(x.name)}>
                  <span className="flex min-w-0 items-baseline gap-3">
                    <span className="shrink-0 text-fg">{x.name}</span>
                    <span className="max-w-64 truncate font-mono text-sm text-muted">{x.command}</span>
                  </span>
                </MenuItem>
              ))}
            </Menu>
          )}
          <LocalServers chatId={chatId} onOpenUrl={onOpenUrl} />
          <Tooltip content={t("workspace.newShell")}>
            <IconButton label={t("workspace.newShell")} size="sm" onPress={() => add()}>
              <Plus className="size-3.5" />
            </IconButton>
          </Tooltip>
        </div>
        {tabs.map((s) => (
          <TabPanel key={s.key} id={s.key} keepMounted className={cx("flex min-h-0 flex-1 gap-px bg-subtle", s.dir === "row" ? "flex-row" : "flex-col")}>
            {s.panes.map((p, i) => (
              <div key={p.key} className="group/pane relative flex min-h-0 min-w-0 flex-1">
                <Shell
                  chatId={chatId}
                  sessionId={p.session}
                  run={p.run}
                  visible={visible && tab === s.key}
                  onSession={(id) => patchPane(p.key, { session: id })}
                  onEnded={() => patchPane(p.key, { ended: true })}
                  onAddToChat={onAddToChat}
                  onOpenFile={(path) => void openFile({ params: { id: chatId }, payload: { path } }).catch(() => undefined)}
                />
                {s.panes.length > 1 && (
                  <span className="absolute right-1.5 bottom-1.5 opacity-0 transition-opacity group-hover/pane:opacity-100 focus-within:opacity-100">
                    <IconButton label={t("workspace.closePane", { n: i + 1 })} size="sm" onPress={() => close([p.key])}>
                      <X className="size-3.5" />
                    </IconButton>
                  </span>
                )}
              </div>
            ))}
          </TabPanel>
        ))}
      </Tabs>
      <ConfirmDialog
        isOpen={!!confirm}
        onOpenChange={(open) => !open && setConfirm(undefined)}
        title={t("workspace.closeBusyTitle")}
        description={t("workspace.closeBusyBody")}
        confirmLabel={t("workspace.closeBusyAction")}
        onConfirm={() => confirm && drop(confirm.keys)}
      />
    </section>
  )
}



// The servers running from the chat's folder (a dev server an agent or a shell started): open one in the chat's
// browser, or stop it. Read again each time the list opens.
function LocalServers({ chatId, onOpenUrl }: { chatId: string; onOpenUrl: (url: string) => void }) {
  const invalidate = useInvalidate()
  return (
    <Popover
      label={t("workspace.servers")}
      placement="top end"
      onOpenChange={(open) => open && invalidate(["localServers"])}
      trigger={
        <Tooltip content={t("workspace.servers")}>
          <IconButton label={t("workspace.servers")} size="sm">
            <Server className="size-3.5" />
          </IconButton>
        </Tooltip>
      }
    >
      {(close) => (
        <ServerList
          chatId={chatId}
          onOpenUrl={(url) => {
            onOpenUrl(url)
            close()
          }}
        />
      )}
    </Popover>
  )
}

function ServerList({ chatId, onOpenUrl }: { chatId: string; onOpenUrl: (url: string) => void }) {
  const { items, loading, failed } = useReading(localServersAtom(chatId))
  const stop = useMutation(mutations.stopServer)
  return (
    <div className="flex w-80 flex-col gap-1 p-2">
      <p className="px-2 py-1 text-sm font-medium">{t("workspace.servers")}</p>
      {loading ? (
        <p className="px-2 py-1.5 text-sm text-muted">{t("common.checking")}</p>
      ) : failed ? (
        <p className="px-2 py-1.5 text-sm text-warning">{t("common.loadFailed")}</p>
      ) : !items.length ? (
        <p className="px-2 py-1.5 text-sm text-muted">{t("workspace.noServers")}</p>
      ) : (
        items.map((s) => (
          <div key={s.pid} className="flex items-center gap-2 rounded-control px-2 py-1">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm text-fg">{s.command}</span>
              <span className="flex flex-wrap gap-x-2">
                {s.ports.map((port) => (
                  <Button key={port} variant="ghost" size="sm" className="h-auto gap-1 p-0 font-mono text-sm text-accent-text data-hovered:bg-transparent data-hovered:underline" onPress={() => onOpenUrl(`http://localhost:${port}`)}>
                    <Globe className="size-3" />
                    {`localhost:${port}`}
                  </Button>
                ))}
              </span>
            </span>
            <Tooltip content={t("workspace.stopServer")}>
              <IconButton label={t("workspace.stopServer")} size="sm" onPress={() => void stop({ params: { id: chatId, pid: s.pid }, reactivityKeys: ["localServers"] }).catch(() => undefined)}>
                <Square className="size-3" />
              </IconButton>
            </Tooltip>
          </div>
        ))
      )}
    </div>
  )
}
