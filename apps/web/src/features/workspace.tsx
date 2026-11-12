// Workspace in the chat (prototype: right panel Changes/Files, bottom terminal): what each turn changed,
// with its diff and undo; the project's files marked with what this chat changed; the commands the agents
// ran, with their output. Data comes from Zorel's checkpoints, the same for every harness.
import type { Agent, Chat, FileChange, FsOp, Message, Project, WorkspaceFile } from "@zorel/contracts"
import { useAtomValue } from "@effect/atom-react"
import { formatTime, t } from "@zorel/i18n"
import { AsyncResult } from "effect/reactivity"
import { lazy, type PointerEvent as ReactPointerEvent, type ReactNode, Suspense, useEffect, useMemo, useRef, useState } from "react"
import { diffAtom, fileTextAtom, filesAtom, localServersAtom, mutations, scriptsAtom, terminalsAtom, useInvalidate, useMutation, useReading } from "../client.ts"
import { agentName } from "../labels.ts"
import type { LineComment } from "./diff-view.tsx"
// The diff viewer and its highlighter load with the panel, not with the app.
const DiffView = lazy(() => import("./diff-view.tsx"))
const FileView = lazy(() => import("./file-view.tsx"))
// The text a line comment puts in the message box (kept out of the lazy chunk's default export).
const commentText = (c: LineComment) =>
  t("diff.commentRef", { path: c.path, lines: c.start === c.end ? t("diff.line", { n: c.start }) : t("diff.lines", { from: c.start, to: c.end }), side: c.side === "deletions" ? t("diff.old") : t("diff.new"), text: c.text.trim() })
import { Button, parentOf, ChevronDown, ChevronRight, ChevronsDownUp, Columns2, ConfirmButton, ConfirmDialog, ContextMenu, Copy, cn, Dialog, EmptyState, ExternalLink, Field, File, FileIcon, FilePlus, FileTree, Folder, FolderOpen, GitBranch, Globe, GitPullRequest, IconButton, Input, Menu, MenuItem, MenuSeparator, PanelRight, Pencil, Pin, PinOff, Play, Plus, Popover, Rows2, SearchInput, Server, SETTLE, Spinner, Square, SquareTerminal, StatusMark, Tab, TabList, TabPanel, Tabs, Tooltip, Trash2, Undo2, X } from "@/ui"
import { Shell } from "./shell.tsx"
import { type BrowserFocus, BrowserPanel } from "./browser.tsx"
import { GitPanel, useIsRepo } from "./git.tsx"
import { stored, store, storedJson } from "../state.ts"


// turnId null: every turn closed in Changes (pressing the open one closes it).
export type Focus = { readonly turnId: string | null; readonly path: string | null }

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

// ---------- side panel ----------

export type SideTab = "changes" | "git" | "files" | "browser" | "terminal"

// ---------- pins: a side-panel tab or a shell, put up in the chat's title row as a shortcut ----------
// Side tabs are pinned for every chat (this computer); shells, for their chat (a shell lives in one chat).
export type ShellPin = { readonly session: string; readonly label: string }
const SIDE_PINS_KEY = "zorel.pins.side"
const SHELL_PINS_KEY = (chatId: string) => `zorel.pins.shell.${chatId}`
const readJson = <A,>(key: string, fallback: A): A => storedJson<A>(key) ?? fallback

export function usePins(chatId: string) {
  const [side, setSide] = useState<ReadonlyArray<SideTab>>(() => readJson(SIDE_PINS_KEY, []))
  const [shells, setShells] = useState<ReadonlyArray<ShellPin>>(() => readJson(SHELL_PINS_KEY(chatId), []))
  useEffect(() => setShells(readJson(SHELL_PINS_KEY(chatId), [])), [chatId])
  const saveSide = (next: ReadonlyArray<SideTab>) => {
    setSide(next)
    store(SIDE_PINS_KEY, JSON.stringify(next))
  }
  const saveShells = (next: ReadonlyArray<ShellPin>) => {
    setShells(next)
    store(SHELL_PINS_KEY(chatId), JSON.stringify(next))
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

// "git" is the Pull request tab (its id stays: pins saved on this computer name it).
export const SIDE_ICON: Record<SideTab, typeof PanelRight> = { changes: PanelRight, git: GitPullRequest, files: Folder, browser: Globe, terminal: SquareTerminal }
const SIDE_ORDER: ReadonlyArray<SideTab> = ["changes", "git", "files", "browser", "terminal"]
const FOLDER_ONLY: ReadonlySet<SideTab> = new Set(["git", "files", "terminal"]) // need the project's folder
export const sideLabel = (tab: SideTab) => (tab === "browser" ? t("browser.title") : tab === "git" ? t("git.pullRequest") : t(`workspace.${tab}`))

// The pin/unpin item of a right-click menu.
export const PinItem = ({ pinned, onAction }: { pinned: boolean; onAction: () => void }) => (
  <MenuItem icon={pinned ? <PinOff /> : <Pin />} onAction={onAction}>
    {pinned ? t("workspace.unpin") : t("workspace.pin")}
  </MenuItem>
)
const WIDTH_KEY = "zorel.side.width"
const MIN_WIDTH = 360

// The panel to the right of the chat: Overview (where the branch stands and the next step out, Run), Changes, Files,
// Browser and Terminal as tabs (Overview, Files and Terminal only with a project folder). Its left edge drags (or takes the arrow keys) to change the width, remembered on this computer.
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
  browserFocus,
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
  browserFocus?: BrowserFocus | undefined
  onOpenUrl: (url: string) => void
  onAddToChat: (text: string) => void // plain text into the message box
  pins: Pins
  shellFocus: { session: string } | undefined // a pinned shell was pressed: show it
}) {
  const [width, setWidth] = useState(() => Number(stored(WIDTH_KEY)) || 560)
  // Only the tabs the person opened (the panel starts on one); + opens more, × closes one.
  const [open, setOpen] = useState<ReadonlyArray<SideTab>>(() => [tab])
  useEffect(() => setOpen((all) => (all.includes(tab) ? all : [...all, tab])), [tab])
  // Asking again for Browser or Terminal opens a new page or shell in it (the others have one view each).
  const [fresh, setFresh] = useState({ browser: 0, terminal: 0 })
  const folder = !!project?.path
  const kinds = SIDE_ORDER.filter((id) => folder || !FOLDER_ONLY.has(id))
  const shown = open.filter((id) => kinds.includes(id))
  // Changes is a tab only once something changed: before that it's no pill up top, just the panel's middle (what the
  // panel can open); with other tabs open, one of them shows instead.
  const changed = messages.some((m) => m.changes.length && m.turnId)
  const pills = shown.filter((id) => id !== "changes" || changed)
  // An empty Changes asked for shows the first other open tab instead.
  const current = !changed && tab === "changes" ? (pills[0] ?? tab) : tab
  const choose = (id: SideTab) => {
    if ((id === "browser" || id === "terminal") && open.includes(id)) setFresh((f) => ({ ...f, [id]: f[id] + 1 }))
    setOpen((all) => (all.includes(id) ? all : [...all, id]))
    onTab(id)
  }
  const closeTab = (id: SideTab) => {
    const rest = shown.filter((x) => x !== id)
    setOpen((all) => all.filter((x) => x !== id))
    if (!rest.length) onClose()
    else if (id === tab) onTab(rest[Math.max(0, shown.indexOf(id) - 1)] ?? rest[0] ?? "changes")
  }
  const repo = useIsRepo(chat.id)
  const delta = chatDelta(messages)
  const max = () => Math.round(window.innerWidth * 0.7)
  const resize = (next: number) => {
    const w = Math.min(max(), Math.max(MIN_WIDTH, Math.round(next)))
    setWidth(w)
    store(WIDTH_KEY, String(w))
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

  const changesBody = (
    <ChangesTab
      messages={messages}
      agents={agents}
      focus={focus}
      onFocus={onFocus}
      onAddToChat={onAddToChat}
      // Nothing changed yet: what else the panel can show, to open from the middle of it.
      others={
        <div className="flex flex-wrap justify-center gap-2">
          {kinds
            .filter((id) => id !== "changes")
            .map((id) => {
              const Icon = SIDE_ICON[id]
              return (
                <Button key={id} size="sm" variant="secondary" onPress={() => choose(id)}>
                  <Icon />
                  {sideLabel(id)}
                </Button>
              )
            })}
        </div>
      }
    />
  )
  return (
    <aside aria-label={t("workspace.panel")} className="@container relative flex min-w-0 shrink-0 flex-col border-l border-subtle" style={{ width }}>
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
      <Tabs selectedKey={current} onSelectionChange={(k) => onTab(k as SideTab)} className="min-h-0 flex-1 gap-0">
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
              {pills.map((id) => {
                  const Icon = SIDE_ICON[id]
                  return (
                    <Tab key={id} id={id} onClose={() => closeTab(id)} closeLabel={t("workspace.closeTab", { name: sideLabel(id) })}>
                      {/* Narrow panel: icons only (the name stays as the tab's accessible name). */}
                      <span data-side-tab={id} className="flex items-center gap-1.5 whitespace-nowrap" title={sideLabel(id)}>
                        <Icon className="size-3.5" />
                        {/* Each tab names itself once the panel is wide. */}
                        <span className="sr-only @3xl:not-sr-only">{sideLabel(id)}</span>
                        {id === "changes" && delta.added + delta.removed > 0 && <Delta {...delta} />}
                        {pins.side.includes(id) && <Pin className="size-3 text-dim" aria-label={t("workspace.pinned")} />}
                      </span>
                    </Tab>
                  )
                })}
            </TabList>
          </ContextMenu>
          <Menu
            label={t("workspace.openTab")}
            trigger={
              <IconButton label={t("workspace.openTab")} size="xs">
                <Plus className="size-3.5" />
              </IconButton>
            }
          >
            {kinds.map((id) => {
              const Icon = SIDE_ICON[id]
              const again = open.includes(id) && (id === "browser" || id === "terminal")
              return (
                <MenuItem key={id} icon={<Icon />} onAction={() => choose(id)}>
                  {again ? (id === "browser" ? t("browser.newTab") : t("workspace.newShell")) : sideLabel(id)}
                </MenuItem>
              )
            })}
          </Menu>
          <IconButton label={t("workspace.closePanel")} size="xs" onPress={onClose}>
            <X className="size-3.5" />
          </IconButton>
        </div>
        {/* Nothing changed and nothing else open: the panel's middle, no tab. */}
        {!changed && !pills.length && <div className={cn("min-h-0 flex-1 overflow-y-auto", SETTLE)}>{changesBody}</div>}
        {changed && shown.includes("changes") && (
          <TabPanel id="changes" className="min-h-0 flex-1 overflow-y-auto">
            {changesBody}
          </TabPanel>
        )}
        {shown.includes("git") && (
          <TabPanel id="git" className="min-h-0 flex-1 overflow-y-auto">
            {repo ? (
              <GitPanel chatId={chat.id} worktree={chat.worktree} />
            ) : (
              <p className="p-4 text-sm text-muted">{t("git.notRepo")}</p>
            )}
          </TabPanel>
        )}
        {shown.includes("files") && project && (
          <TabPanel id="files" className="flex min-h-0 flex-1 flex-col">
            <FilesTab project={project} chat={chat} messages={messages} onFocus={onFocus} onAddToChat={onAddToChat} />
          </TabPanel>
        )}
        {shown.includes("browser") && (
          <TabPanel id="browser" keepMounted className="flex min-h-0 flex-1 flex-col">
            <BrowserPanel chatId={chat.id} openUrl={browserUrl} focus={browserFocus} newTab={fresh.browser} />
          </TabPanel>
        )}
        {shown.includes("terminal") && (
          <TabPanel id="terminal" keepMounted className="flex min-h-0 flex-1 flex-col">
            <TerminalPanel
              chatId={chat.id}
              newShell={fresh.terminal}
              visible={tab === "terminal"}
              onAddToChat={(text) => onAddToChat(`\`\`\`\n${text.trimEnd()}\n\`\`\``)} // terminal output, as a code block
              onOpenUrl={onOpenUrl}
              pins={pins}
              focus={shellFocus}
            />
          </TabPanel>
        )}
      </Tabs>
    </aside>
  )
}

function ChangesTab({
  messages,
  agents,
  focus,
  onFocus,
  onAddToChat,
  others
}: {
  messages: ReadonlyArray<Message>
  agents: ReadonlyArray<Agent>
  focus: Focus | undefined
  onFocus: (f: Focus) => void
  onAddToChat: (text: string) => void
  others?: ReactNode
}) {
  const turns = messages.filter((m) => m.changes.length && m.turnId).reverse()
  if (!turns.length)
    return (
      <div className="flex min-h-full items-center justify-center">
        <EmptyState scene="allClear" icon={<File />} title={t("workspace.noChanges")} hint={t("workspace.noChangesHint")} action={others} />
      </div>
    )
  const current = focus ?? { turnId: turns[0]!.turnId!, path: null }
  return (
    <div className="flex flex-col">
      {turns.map((m) => {
        const open = m.turnId === current.turnId
        return (
          <section key={m.id} className="border-b border-subtle">
            <Button variant="ghost" className="h-auto w-full justify-start gap-2 rounded-none px-4 py-2.5 font-normal" onPress={() => onFocus({ turnId: open ? null : m.turnId!, path: null })} aria-expanded={open}>
              {open ? <ChevronDown className="text-muted" /> : <ChevronRight className="text-muted" />}
              <span className="min-w-0 flex-1 truncate text-left text-secondary">{t("workspace.turnBy", { agent: agentName(m.agentId, agents), time: formatTime(m.at) })}</span>
              {m.revertedAt ? <span className="text-sm text-muted">{t("workspace.undone")}</span> : <Delta {...sumOf(m.changes)} />}
            </Button>
            {open && <TurnFiles message={m} path={current.path} onPath={(path) => onFocus({ turnId: m.turnId!, path })} onAddToChat={onAddToChat} />}
          </section>
        )
      })}
    </div>
  )
}

function TurnFiles({ message, path, onPath, onAddToChat }: { message: Message; path: string | null; onPath: (p: string | null) => void; onAddToChat: (text: string) => void }) {
  const result = useAtomValue(diffAtom(message.turnId!))
  const diff = AsyncResult.getOrElse(result, () => undefined)
  return (
    <div className="flex flex-col gap-2 px-3 pb-3">
      <ul className="flex flex-col">
        {message.changes.map((c) => (
          <li key={c.path}>
            <Button variant="ghost" className={cn("h-8 w-full justify-start gap-2 px-2 font-normal", path === c.path && "bg-surface")} onPress={() => onPath(path === c.path ? null : c.path)}>
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
                <DiffView patch={f.patch} path={f.path} onComment={(c) => onAddToChat(commentText(c))} />
              </Suspense>
            ) : (
              <p className="px-3 py-2 text-sm text-muted">{t("workspace.binary")}</p>
            )}
          </div>
        ))}
    </div>
  )
}

// ---------- files tree ----------

// The project's files as a tree, folders first; a folder shows it holds changes.
type Node = { name: string; path: string; status: WorkspaceFile["status"]; children: Node[] | null }

function treeOf(files: ReadonlyArray<WorkspaceFile>): Node[] {
  const top: Node[] = []
  const byPath = new Map<string, Node>()
  for (const f of files) {
    const parts = f.path.split("/")
    let siblings = top
    parts.forEach((name, i) => {
      const path = parts.slice(0, i + 1).join("/")
      const leaf = i === parts.length - 1
      let node = byPath.get(path)
      if (!node) {
        node = { name, path, status: leaf ? f.status : null, children: leaf ? null : [] }
        byPath.set(path, node)
        siblings.push(node)
      } else if (!leaf && f.status && !node.status) node.status = "modified"
      siblings = node.children ?? []
    })
  }
  const sort = (ns: Node[]) => {
    ns.sort((a, b) => Number(!!b.children) - Number(!!a.children) || a.name.localeCompare(b.name))
    for (const n of ns) if (n.children) sort(n.children)
    return ns
  }
  return sort(top)
}

const openFiles = new Map<string, { tabs: string[]; tab: string }>()

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)

// The Files tab, as an editor's explorer: select (Shift / Cmd), F2 renames in place, Delete sends to Zorel's trash
// with Undo, drag moves into a folder, double-click opens (a changed file opens its diff), right-click for the rest.
function FilesTab({ project, chat, messages, onFocus, onAddToChat }: { project: Project; chat: Chat; messages: ReadonlyArray<Message>; onFocus: (f: Focus) => void; onAddToChat: (text: string) => void }) {
  const files = AsyncResult.getOrElse(useAtomValue(filesAtom(project.id, chat.id)), () => undefined)
  const nodes = useMemo(() => (files ? treeOf(files) : undefined), [files])
  const fs = useMutation(mutations.fs)
  const invalidate = useInvalidate()
  const [expanded, setExpanded] = useState<Set<string>>()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [creating, setCreating] = useState<string | null>(null) // the folder a new file goes in ("" is the top)
  const [deleted, setDeleted] = useState<{ id: string; count: number }>()
  const [error, setError] = useState<string>()
  const [query, setQuery] = useState("")
  // Open files as tabs after the tree's own ("files", always first); kept per chat while the app runs.
  const [view, setView] = useState(() => openFiles.get(chat.id) ?? { tabs: [] as string[], tab: "files" })
  useEffect(() => {
    openFiles.set(chat.id, view)
  }, [chat.id, view])
  if (!nodes)
    return (
      <div className="flex justify-center py-10 text-muted">
        <Spinner />
      </div>
    )
  const openTab = (path: string) => setView((v) => ({ tabs: v.tabs.includes(path) ? v.tabs : [...v.tabs, path], tab: path }))
  const closeTab = (path: string) =>
    setView((v) => {
      const i = v.tabs.indexOf(path)
      const tabs = v.tabs.filter((p) => p !== path)
      return { tabs, tab: v.tab === path ? (tabs[Math.min(i, tabs.length - 1)] ?? "files") : v.tab }
    })
  // Renamed or deleted on disk: its tabs follow (a folder takes the tabs of what's inside).
  const retab = (from: string, to: string | null) =>
    setView((v) => {
      const map = (p: string) => (p === from || p.startsWith(`${from}/`) ? (to === null ? null : to + p.slice(from.length)) : p)
      const tabs = v.tabs.map(map).filter((p): p is string => p !== null)
      return { tabs, tab: v.tab === "files" ? "files" : (map(v.tab) ?? "files") }
    })
  // Searching: only what matches (and the folders on its way, open); a matching folder keeps all it holds.
  const q = query.trim().toLowerCase()
  const shown = q ? matching(nodes, q) : nodes
  // At first, the top folders holding changes are open.
  const open = q ? foldersIn(shown) : (expanded ?? new Set(nodes.filter((n) => n.children && n.status).map((n) => n.path)))
  const root = chat.worktree ?? project.path ?? ""
  const sep = root.includes("\\") ? "\\" : "/"
  const lastTurnOf = (path: string) => [...messages].reverse().find((m) => m.turnId && m.changes.some((c) => c.path === path))?.turnId
  const run = (payload: typeof FsOp.Type) =>
    fs({ params: { id: chat.id }, payload }).then(
      (r) => {
        setError(undefined)
        invalidate(["workspace"])
        return r
      },
      () => {
        setError(t("explorer.failed"))
        return undefined
      }
    )
  // A row's menu acts on the selection when the row is in it, else on that row alone.
  const targets = (path: string) => (selected.has(path) ? [...selected] : [path])
  const remove = (paths: ReadonlyArray<string>) =>
    paths.length &&
    void run({ op: "delete", paths: [...paths] }).then((r) => {
      if (!r?.trashId) return
      for (const p of paths) retab(p, null)
      setDeleted({ id: r.trashId, count: paths.length })
      setSelected(new Set())
    })
  const rename = (path: string, name: string | null) => {
    setRenaming(null)
    if (!name) return
    const to = parentOf(path) ? `${parentOf(path)}/${name}` : name
    void run({ op: "rename", path, to }).then((r) => {
      if (!r) return
      setSelected(new Set([to]))
      retab(path, to)
    })
  }
  const copy = (paths: ReadonlyArray<string>, absolute: boolean) =>
    void navigator.clipboard.writeText(paths.map((p) => (absolute ? [root, ...p.split("/")].join(sep) : p)).join("\n"))
  const folderOf = (path: string) => (nodes && findNode(nodes, path)?.children ? path : parentOf(path))
  const menuFor = (target: HTMLElement) => {
    const path = target.closest("[role=row]")?.getAttribute("data-key")
    if (!path)
      return (
        <MenuItem icon={<FilePlus />} onAction={() => setCreating("")}>
          {t("explorer.newFile")}
        </MenuItem>
      )
    const node = findNode(nodes, path)
    const paths = targets(path)
    const one = paths.length === 1
    return (
      <>
        {one && !node?.children && (
          <>
            <MenuItem icon={<File />} onAction={() => openTab(path)}>
              {t("explorer.open")}
            </MenuItem>
            <MenuItem icon={<ExternalLink />} onAction={() => void run({ op: "open", path })}>
              {t("explorer.openInApp")}
            </MenuItem>
          </>
        )}
        {one && lastTurnOf(path) && (
          <MenuItem icon={<GitBranch />} onAction={() => onFocus({ turnId: lastTurnOf(path)!, path })}>
            {t("explorer.showChanges")}
          </MenuItem>
        )}
        {one && (
          <MenuItem icon={<FolderOpen />} onAction={() => void run({ op: "reveal", path })}>
            {t("explorer.reveal")}
          </MenuItem>
        )}
        <MenuItem icon={<Plus />} onAction={() => onAddToChat(paths.map((p) => `\`${p}\``).join(" "))}>
          {t("workspace.addToChat")}
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<Copy />} onAction={() => copy(paths, true)}>
          {t("explorer.copyPath")}
        </MenuItem>
        <MenuItem icon={<Copy />} onAction={() => copy(paths, false)}>
          {t("explorer.copyRelative")}
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<FilePlus />} onAction={() => setCreating(folderOf(path))}>
          {t("explorer.newFileHere")}
        </MenuItem>
        {one && (
          <MenuItem icon={<Pencil />} onAction={() => setRenaming(path)}>
            {t("common.rename")}
          </MenuItem>
        )}
        <MenuItem icon={<Trash2 />} tone="danger" onAction={() => remove(paths)}>
          {t("common.delete")}
        </MenuItem>
      </>
    )
  }
  return (
    <div className="flex h-full flex-col">
      <Tabs selectedKey={view.tab} onSelectionChange={(k) => setView((v) => ({ ...v, tab: String(k) }))} className="min-h-0 flex-1 gap-0">
        {/* biome-ignore lint/a11y/noStaticElementInteractions: listens to keys bubbling from the focused tab; no interaction of its own */}
        <div
          className="flex items-center gap-1 px-3 py-1.5"
          onKeyDown={(e) => {
            // Delete or Backspace on a focused file tab closes it, as the terminal's tabs.
            if ((e.key === "Delete" || e.key === "Backspace") && view.tab !== "files" && (e.target as HTMLElement).getAttribute("role") === "tab") closeTab(view.tab)
          }}
        >
          <TabList label={t("workspace.files")} className="min-w-0 flex-1 flex-nowrap overflow-x-auto">
            <Tab id="files">{t("workspace.files")}</Tab>
            {view.tabs.map((path) => {
              const name = path.slice(path.lastIndexOf("/") + 1)
              return (
                <Tab key={path} id={path} onClose={() => closeTab(path)} closeLabel={t("explorer.closeFile", { name })}>
                  <span className="flex items-center gap-1.5 whitespace-nowrap" title={path}>
                    <FileIcon name={name} className="size-3.5" />
                    {name}
                  </span>
                </Tab>
              )
            })}
          </TabList>
          {view.tab === "files" && (
            <>
              <IconButton label={t("explorer.newFile")} size="xs" onPress={() => setCreating(selected.size === 1 ? folderOf([...selected][0]!) : "")}>
                <FilePlus className="size-3.5" />
              </IconButton>
              <IconButton label={t("explorer.collapse")} size="xs" onPress={() => setExpanded(new Set())}>
                <ChevronsDownUp className="size-3.5" />
              </IconButton>
            </>
          )}
        </div>
        <TabPanel id="files" className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 px-3 pb-1.5">
            <SearchInput
              size="sm"
              aria-label={t("explorer.search")}
              placeholder={t("explorer.search")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            />
          </div>
          {q && !shown.length && <p className="px-3 py-6 text-center text-sm text-muted">{t("explorer.noMatch")}</p>}
          <ContextMenu label={t("explorer.label")} menuFor={menuFor} className="min-h-0 flex-1 px-2">
            <FileTree
              label={t("explorer.label")}
              nodes={shown}
              expanded={open}
              onExpandedChange={(keys) => !q && setExpanded(keys)}
              selected={selected}
              onSelectionChange={setSelected}
              renaming={renaming}
              onRenamed={(name) => renaming && rename(renaming, name)}
              onAction={(n) => (n.children ? setExpanded(new Set(open.has(n.path) ? [...open].filter((p) => p !== n.path) : [...open, n.path])) : openTab(n.path))}
              onMove={(paths, folder) => {
                const moving = paths.filter((p) => parentOf(p) !== folder)
                if (moving.length)
                  void run({ op: "move", paths: moving, to: folder }).then((r) => {
                    if (!r) return
                    for (const p of moving) retab(p, folder ? `${folder}/${p.slice(p.lastIndexOf("/") + 1)}` : p.slice(p.lastIndexOf("/") + 1))
                    if (folder) setExpanded(new Set([...open, folder]))
                  })
              }}
              // F2 / Delete everywhere; on macOS also Finder's keys: Enter renames, Backspace (or Cmd+Backspace) deletes.
              onKey={(key, e) => {
                if ((key === "F2" || (MAC && key === "Enter" && !e.metaKey)) && selected.size === 1) setRenaming([...selected][0]!)
                else if ((key === "Delete" || (key === "Backspace" && (MAC || e.metaKey || e.ctrlKey))) && selected.size) remove([...selected])
                else return false
                return true
              }}
              trailing={(n) => <StatusMark status={(n as Node).children ? null : (n as Node).status} />}
              strong={(n) => !!(n as Node).status}
            />
          </ContextMenu>
        </TabPanel>
        {view.tabs.map((path) => (
          <TabPanel key={path} id={path} className="flex min-h-0 flex-1 flex-col">
            <FileTab
              chatId={chat.id}
              path={path}
              onChanges={lastTurnOf(path) ? () => onFocus({ turnId: lastTurnOf(path)!, path }) : undefined}
              onOpen={() => void run({ op: "open", path })}
            />
          </TabPanel>
        ))}
      </Tabs>
      {(deleted || error) && (
        <div role="status" className="sticky bottom-0 flex items-center gap-2 border-t border-subtle bg-canvas px-3 py-2 text-sm">
          <span className={cn("min-w-0 flex-1", error ? "text-danger" : "text-secondary")}>{error ?? t("explorer.deleted", { count: deleted!.count })}</span>
          {deleted && !error && (
            <Button size="sm" variant="ghost" className="h-6 px-2" onPress={() => void run({ op: "restore", id: deleted.id }).then((r) => r && setDeleted(undefined))}>
              <Undo2 className="size-3.5" />
              {t("workspace.undo")}
            </Button>
          )}
          <IconButton label={t("common.close")} size="xs" onPress={() => {
              setDeleted(undefined)
              setError(undefined)
            }}>
            <X className="size-3.5" />
          </IconButton>
        </div>
      )}
      <Dialog title={t("explorer.newFile")} isOpen={creating !== null} onOpenChange={(o) => !o && setCreating(null)}>
        {(close) => (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              const path = String(new FormData(e.currentTarget).get("path") ?? "").trim().replace(/^\/+/, "")
              if (!path || path.endsWith("/")) return
              void run({ op: "create", path }).then((r) => {
                if (!r) return
                close()
                const parents = path.split("/").slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join("/"))
                setExpanded(new Set([...open, ...parents]))
                setSelected(new Set([path]))
              })
            }}
          >
            <Field label={t("explorer.newFile")} hint={t("explorer.newFileHint")}>
              <Input name="path" autoFocus defaultValue={creating ? `${creating}/` : ""} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onPress={close}>
                {t("common.cancel")}
              </Button>
              <Button type="submit">{t("explorer.create")}</Button>
            </div>
          </form>
        )}
      </Dialog>
    </div>
  )
}

// An open file's tab: its code, read only, under its path and the ways out (its diff, its own app).
function FileTab({ chatId, path, onChanges, onOpen }: { chatId: string; path: string; onChanges: (() => void) | undefined; onOpen: () => void }) {
  const result = useAtomValue(fileTextAtom(chatId, path))
  const text = AsyncResult.getOrElse(result, () => undefined)
  const name = path.slice(path.lastIndexOf("/") + 1)
  return (
    <>
      <div className="flex h-control-sm shrink-0 items-center gap-1.5 border-b border-subtle px-3">
        <span className="min-w-0 flex-1 truncate font-mono text-sm text-muted" title={path}>
          {path}
        </span>
        {onChanges && (
          <Button size="sm" variant="ghost" className="h-6 px-2" onPress={onChanges}>
            {t("explorer.showChanges")}
          </Button>
        )}
        <IconButton label={t("explorer.openInApp")} size="xs" onPress={onOpen}>
          <ExternalLink className="size-3.5" />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-code">
        {AsyncResult.isFailure(result) || text?.contents === null ? (
          <p className="px-3 py-6 text-center text-sm text-muted">{t("explorer.cantShow")}</p>
        ) : text ? (
          <Suspense fallback={<Spinner />}>
            <FileView name={name} contents={text.contents} />
          </Suspense>
        ) : (
          <div className="flex justify-center py-6 text-muted">
            <Spinner />
          </div>
        )}
      </div>
    </>
  )
}

function matching(ns: ReadonlyArray<Node>, q: string): Node[] {
  return ns.flatMap((n) => {
    if (n.name.toLowerCase().includes(q)) return [n]
    const inside = n.children ? matching(n.children, q) : []
    return inside.length ? [{ ...n, children: inside }] : []
  })
}
const foldersIn = (ns: ReadonlyArray<Node>, out = new Set<string>()): Set<string> => {
  for (const n of ns)
    if (n.children) {
      out.add(n.path)
      foldersIn(n.children, out)
    }
  return out
}

const findNode = (ns: ReadonlyArray<Node>, path: string): Node | undefined => {
  for (const n of ns) {
    if (n.path === path) return n
    if (n.children && path.startsWith(`${n.path}/`)) return findNode(n.children, path)
  }
  return undefined
}

// ---------- terminal (read-only: the commands the agents ran) ----------

// The Terminal panel: shell tabs (the commands the agents ran show in the chat, in each reply's steps). A tab holds
// one to four panes (split side by side or stacked), each a shell that lives on the server: closing the panel or
// reloading only detaches, and the tabs come back from the server's list (the layout is remembered per chat).
// Closing a pane or a tab ends its shells, asking first when something still runs in one. It fills the side
// panel's Terminal tab.
const LAYOUT_KEY = (chatId: string) => `zorel.terminal.layout.${chatId}`
const MAX_PANES = 4
type Pane = { readonly key: string; readonly session: string | undefined; readonly ended: boolean; readonly run?: string | undefined }
// label: the project script the tab runs ("dev"); a plain shell is "Shell n".
type ShellTab = { readonly key: string; readonly dir: "row" | "col"; readonly panes: ReadonlyArray<Pane>; readonly label?: string | null | undefined }
let paneCount = 0
const newPane = (session?: string, run?: string): Pane => ({ key: `pane-${++paneCount}`, session, ended: false, run })

function TerminalPanel({
  chatId,
  visible,
  onAddToChat,
  onOpenUrl,
  pins,
  focus,
  newShell
}: {
  chatId: string
  newShell: number // bumped when the person asks for Terminal again: a new shell
  pins: Pins
  focus: { session: string } | undefined // show the tab holding this shell (a pinned shell was pressed)
  visible: boolean // its tab in the side panel is the one shown
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
    const saved = storedJson<Array<{ dir: "row" | "col"; sessions: string[] }>>(LAYOUT_KEY(chatId)) ?? []
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
    if (restored.current) store(LAYOUT_KEY(chatId), JSON.stringify(tabs.map((t) => ({ dir: t.dir, sessions: t.panes.flatMap((p) => (p.session ? [p.session] : [])) }))))
  }, [tabs, chatId])

  // A new tab: a plain shell, or one running a project script.
  const add = (run?: string) => {
    const pane = newPane(undefined, run)
    const key = `tab-${pane.key}`
    setTabs((all) => [...all, { key, dir: "row", panes: [pane], label: run }])
    setTab(key)
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new request adds a shell
  useEffect(() => {
    if (newShell) add()
  }, [newShell])
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
    // The last shell can't go (only an ended one, and a fresh shell takes its place).
    if (!next.length) {
      const pane = newPane()
      next.push({ key: `tab-${pane.key}`, dir: "row", panes: [pane] })
    }
    setTabs(next)
    if (!next.some((t) => t.key === tab)) setTab(next.at(-1)!.key)
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
  // The only tab closes only once its shell ended (and a fresh one replaces it): the panel always has a shell.
  const closable = (s: ShellTab) => tabs.length > 1 || s.panes.every((p) => p.ended)

  return (
    <section aria-label={t("workspace.terminal")} className="flex min-h-0 flex-1 flex-col">
      <Tabs selectedKey={tab} onSelectionChange={(k) => setTab(String(k))} className="min-h-0 flex-1 gap-0">
        {/* Delete or Backspace on a focused shell tab closes it (the × in the tab is for the pointer). */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: listens to keys bubbling from the focused tab; no interaction of its own */}
        <div
          className="flex items-center gap-1 px-3 py-1.5"
          onKeyDown={(e) => {
            if ((e.key === "Delete" || e.key === "Backspace") && current && closable(current) && (e.target as HTMLElement).getAttribute("role") === "tab") close(current.panes.map((p) => p.key))
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
                  {closable(s) && (
                    <MenuItem icon={<X />} onAction={() => close(s.panes.map((p) => p.key))}>
                      {t("workspace.closeShellNamed", { name: nameOf(s) })}
                    </MenuItem>
                  )}
                </>
              )
            }}
          >
            <TabList label={t("workspace.terminal")} className="min-w-0 flex-nowrap overflow-x-auto">
              {tabs.map((s) => (
                <Tab
                  key={s.key}
                  id={s.key}
                  {...(closable(s) && { onClose: () => close(s.panes.map((p) => p.key)) })}
                  closeLabel={t("workspace.closeShellNamed", { name: nameOf(s) })}
                >
                  <span data-shell-tab={s.key} className={cn("flex items-center gap-1.5 whitespace-nowrap", s.panes.every((p) => p.ended) && "text-dim")}>
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
                <IconButton label={t("workspace.splitRight")} size="xs" onPress={() => split("row")}>
                  <Columns2 className="size-3.5" />
                </IconButton>
              </Tooltip>
              <Tooltip content={t("workspace.splitDown")}>
                <IconButton label={t("workspace.splitDown")} size="xs" onPress={() => split("col")}>
                  <Rows2 className="size-3.5" />
                </IconButton>
              </Tooltip>
            </>
          )}
          {scripts.length > 0 && (
            <Menu
              label={t("workspace.runScript")}
              trigger={
                <IconButton label={t("workspace.runScript")} size="xs">
                  <Play className="size-3.5" />
                </IconButton>
              }
            >
              {scripts.map((x) => scriptItem(x, () => add(x.name)))}
            </Menu>
          )}
          <LocalServers chatId={chatId} onOpenUrl={onOpenUrl} />
          <Tooltip content={t("workspace.newShell")}>
            <IconButton label={t("workspace.newShell")} size="xs" onPress={() => add()}>
              <Plus className="size-3.5" />
            </IconButton>
          </Tooltip>
        </div>
        {tabs.map((s) => (
          <TabPanel key={s.key} id={s.key} keepMounted className={cn("flex min-h-0 flex-1 gap-px bg-subtle", s.dir === "row" ? "flex-row" : "flex-col")}>
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
                    <IconButton label={t("workspace.closePane", { n: i + 1 })} size="xs" onPress={() => close([p.key])}>
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
          <IconButton label={t("workspace.servers")} size="xs">
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
                  <Button key={port} variant="ghost" size="sm" className="h-auto gap-1 p-0 font-mono text-sm text-secondary data-hovered:bg-transparent data-hovered:text-fg data-hovered:underline" onPress={() => onOpenUrl(`http://localhost:${port}`)}>
                    <Globe className="size-3" />
                    {`localhost:${port}`}
                  </Button>
                ))}
              </span>
            </span>
            <Tooltip content={t("workspace.stopServer")}>
              <IconButton label={t("workspace.stopServer")} size="xs" onPress={() => void stop({ params: { id: chatId, pid: s.pid }, reactivityKeys: ["localServers"] }).catch(() => undefined)}>
                <Square className="size-3" />
              </IconButton>
            </Tooltip>
          </div>
        ))
      )}
    </div>
  )
}

// Run (chat header): the person starts the project's server, as an agent does with zorel_preview: a free port, a
// shell of the chat (the Terminal panel shows its output), and its page in the Browser panel once it listens. A
// package.json script, or any command (with {port} where the port goes) for other stacks.
export function RunControl({ chatId, onOpen }: { chatId: string; onOpen: (url: string) => void }) {
  const scripts = useReading(scriptsAtom(chatId)).items
  const start = useMutation(mutations.startPreview)
  const invalidate = useInvalidate()
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState(false)
  const [command, setCommand] = useState("")
  const [failed, setFailed] = useState<string>()
  const runIt = (payload: { script?: string; command?: string }) => {
    setBusy(true)
    setFailed(undefined)
    start({ params: { id: chatId }, payload })
      .then((r) => onOpen(r.url))
      .catch((e: unknown) => setFailed((e as { message?: string })?.message || t("workspace.runFailed")))
      .finally(() => {
        setBusy(false)
        invalidate(["terminals", "localServers"])
      })
  }
  return (
    <>
      <Menu
        label={t("workspace.run")}
        trigger={
          <Button size="sm" variant="ghost" isPending={busy}>
            <Play />
            {busy ? t("workspace.starting") : t("workspace.run")}
          </Button>
        }
      >
        {scripts.map((x) => scriptItem(x, () => runIt({ script: x.name })))}
        {scripts.length > 0 && <MenuSeparator />}
        <MenuItem icon={<SquareTerminal />} onAction={() => setAsking(true)}>
          {t("workspace.runCommand")}
        </MenuItem>
      </Menu>
      <Dialog title={t("workspace.runCommand")} isOpen={asking} onOpenChange={setAsking}>
        {(close) => (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (!command.trim()) return
              runIt({ command: command.trim() })
              close()
            }}
          >
            <Field label={t("workspace.command")} hint={t("workspace.commandHint")}>
              <Input autoFocus value={command} onChange={(e) => setCommand(e.target.value)} maxLength={1000} className="font-mono" placeholder={t("workspace.commandPlaceholder")} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onPress={close}>
                {t("common.cancel")}
              </Button>
              <Button size="sm" type="submit" isDisabled={!command.trim()}>
                {t("workspace.run")}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
      <Dialog title={t("workspace.runFailedTitle")} isOpen={!!failed} onOpenChange={(o) => !o && setFailed(undefined)}>
        {() => <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-control bg-subtle p-3 font-mono text-sm">{failed}</pre>}
      </Dialog>
    </>
  )
}

// A package.json script in a menu (Terminal's "Run a script", the chat's Run): its name, then its command.
const scriptItem = (x: { name: string; command: string }, onAction: () => void) => (
  <MenuItem key={x.name} onAction={onAction}>
    <span className="flex min-w-0 items-baseline gap-3">
      <span className="shrink-0 text-fg">{x.name}</span>
      <span className="max-w-64 truncate font-mono text-sm text-muted">{x.command}</span>
    </span>
  </MenuItem>
)
