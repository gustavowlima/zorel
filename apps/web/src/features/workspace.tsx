// Workspace in the chat (prototype: right panel Changes/Files, bottom terminal): what each turn changed,
// with its diff and undo; the project's files marked with what this chat changed; the commands the agents
// ran, with their output. Data comes from Zero's checkpoints, the same for every harness.
import type { Agent, Chat, FileChange, Message, Project, WorkspaceFile } from "@zero/contracts"
import type { WorkStep } from "@zero/contracts/events"
import { useAtomValue } from "@effect/atom-react"
import { formatAge, formatDuration, formatTime, t } from "@zero/i18n"
import { AsyncResult } from "effect/reactivity"
import { lazy, type PointerEvent as ReactPointerEvent, Suspense, useMemo, useRef, useState } from "react"
import { diffAtom, filesAtom, mutations, runsAtom, useMutation } from "../client.ts"
import { agentName } from "../labels.ts"
// The diff viewer and its highlighter load with the panel, not with the app.
const DiffView = lazy(() => import("./diff-view.tsx"))
import {
  Button, ChevronDown, ChevronRight, CircleAlert, CircleCheck, CircleX, ConfirmButton, cx, EmptyState, File, Folder, FolderOpen, IconButton, Spinner, Tab, TabList,
  Plus, TabPanel, Tabs, Tooltip, X
} from "@/ui"
import { Shell } from "./shell.tsx"


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

// ---------- right panel ----------

export function WorkspacePanel({
  chat,
  project,
  messages,
  agents,
  tab,
  onTab,
  focus,
  onFocus,
  onClose
}: {
  chat: Chat
  project: Project | undefined
  messages: ReadonlyArray<Message>
  agents: ReadonlyArray<Agent>
  tab: "changes" | "files"
  onTab: (t: "changes" | "files") => void
  focus: Focus | undefined
  onFocus: (f: Focus) => void
  onClose: () => void
}) {
  return (
    <aside aria-label={t("workspace.changes")} className="flex w-lg min-w-0 shrink-0 flex-col border-l border-subtle">
      <Tabs selectedKey={tab} onSelectionChange={(k) => onTab(k as "changes" | "files")} className="min-h-0 flex-1 gap-0">
        <div className="flex items-center gap-2 border-b border-subtle px-4 py-2.5">
          <TabList label={t("workspace.changes")} className="flex-1">
            <Tab id="changes">{t("workspace.changes")}</Tab>
            <Tab id="files">{t("workspace.files")}</Tab>
          </TabList>
          <IconButton label={t("workspace.closePanel")} onPress={onClose}>
            <X />
          </IconButton>
        </div>
        <TabPanel id="changes" className="min-h-0 flex-1 overflow-y-auto">
          <ChangesTab messages={messages} agents={agents} focus={focus} onFocus={onFocus} />
        </TabPanel>
        <TabPanel id="files" className="min-h-0 flex-1 overflow-y-auto">
          {project?.path ? (
            <FilesTab project={project} chat={chat} messages={messages} onFocus={onFocus} />
          ) : (
            <EmptyState icon={<Folder />} title={t("workspace.noFolder")} hint={t("workspace.noFolderHint")} />
          )}
        </TabPanel>
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

// The Terminal panel: a first tab with the commands the agents ran (read only), then shell tabs (Shell, a real
// login shell in the chat's folder); + opens one, each closes on its own. The panel's height follows a drag
// of its top edge (or the arrow keys on it) and is remembered on this computer.
const HEIGHT_KEY = "zero.terminal.height"
const MIN_HEIGHT = 160
const readHeight = () => {
  try {
    return Number(localStorage.getItem(HEIGHT_KEY)) || 288
  } catch {
    return 288
  }
}

export function TerminalPanel({ chatId, onClose }: { chatId: string; onClose: () => void }) {
  const runs = AsyncResult.getOrElse(useAtomValue(runsAtom(chatId)), () => undefined)
  const [height, setHeight] = useState(readHeight)
  const [shells, setShells] = useState<ReadonlyArray<{ id: string; n: number; ended: boolean }>>([])
  const [tab, setTab] = useState("agent")
  const count = useRef(0)
  const max = () => Math.round(window.innerHeight * 0.75)
  const resize = (next: number) => {
    const h = Math.min(max(), Math.max(MIN_HEIGHT, Math.round(next)))
    setHeight(h)
    try {
      localStorage.setItem(HEIGHT_KEY, String(h))
    } catch {
      // storage blocked: the height resets on reload
    }
  }
  const add = () => {
    count.current += 1
    const id = `shell-${count.current}`
    setShells((s) => [...s, { id, n: count.current, ended: false }])
    setTab(id)
  }
  const close = (id: string) => {
    setShells((s) => s.filter((x) => x.id !== id))
    if (tab === id) setTab("agent")
  }
  const drag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const startY = e.clientY
    const startH = height
    e.currentTarget.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => resize(startH + (startY - ev.clientY))
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }

  return (
    <section aria-label={t("workspace.terminal")} className="relative flex shrink-0 flex-col border-t border-subtle" style={{ height }}>
      {/* The top edge: drag it, or focus it and use the arrows, to change the height. */}
      {/* biome-ignore lint/a11y/useSemanticElements: a focusable splitter (ARIA window splitter); <hr> can't take focus or a value */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label={t("workspace.resizeTerminal")}
        aria-valuemin={MIN_HEIGHT}
        aria-valuemax={max()}
        aria-valuenow={height}
        tabIndex={0}
        onPointerDown={drag}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") resize(height + 24)
          else if (e.key === "ArrowDown") resize(height - 24)
          else return
          e.preventDefault()
        }}
        className="absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize touch-none outline-none after:absolute after:inset-x-0 after:top-1 after:h-px after:bg-transparent hover:after:bg-accent focus-visible:after:bg-accent"
      />
      <Tabs selectedKey={tab} onSelectionChange={(k) => setTab(String(k))} className="min-h-0 flex-1 gap-0">
        {/* Delete or Backspace on a focused shell tab closes it (the × in the tab is for the pointer). */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: listens to keys bubbling from the focused tab; no interaction of its own */}
        <div
          className="flex items-center gap-2 px-3 py-1.5"
          onKeyDown={(e) => {
            if ((e.key === "Delete" || e.key === "Backspace") && tab !== "agent" && (e.target as HTMLElement).getAttribute("role") === "tab") close(tab)
          }}
        >
          <TabList label={t("workspace.terminal")} className="min-w-0 flex-1 flex-nowrap overflow-x-auto">
            <Tab id="agent">{t("workspace.agentCommands")}</Tab>
            {shells.map((s) => (
              <Tab key={s.id} id={s.id} onClose={() => close(s.id)} closeLabel={t("workspace.closeShellNamed", { n: s.n })}>
                <span className={cx(s.ended && "text-dim")}>{t("workspace.shell", { n: s.n })}</span>
              </Tab>
            ))}
          </TabList>
          <Tooltip content={t("workspace.newShell")}>
            <IconButton label={t("workspace.newShell")} size="sm" onPress={add}>
              <Plus className="size-3.5" />
            </IconButton>
          </Tooltip>
          <IconButton label={t("workspace.closePanel")} size="sm" onPress={onClose}>
            <X className="size-3.5" />
          </IconButton>
        </div>
        <TabPanel id="agent" className="min-h-0 flex-1 overflow-y-auto bg-code px-4 py-2 font-mono text-sm">
          {runs?.length === 0 && <p className="py-4 font-sans text-muted">{t("workspace.noRuns")}</p>}
          {runs?.map((r) => (
            <RunEntry key={r.id} run={r} />
          ))}
        </TabPanel>
        {shells.map((s) => (
          <TabPanel key={s.id} id={s.id} keepMounted className="flex min-h-0 flex-1 flex-col">
            <Shell chatId={chatId} visible={tab === s.id} onExit={() => setShells((all) => all.map((x) => (x.id === s.id ? { ...x, ended: true } : x)))} />
          </TabPanel>
        ))}
      </Tabs>
    </section>
  )
}

function RunEntry({ run }: { run: WorkStep }) {
  return (
    <div className="flex flex-col gap-1 border-b border-subtle py-2 last:border-0">
      <div className="flex items-center gap-2">
        <RunIcon status={run.status} />
        <span className="text-muted">$</span>
        <span className="min-w-0 flex-1 break-all text-fg">{run.title}</span>
        <span className="shrink-0 font-sans text-xs text-dim">{run.durationMs !== null ? formatDuration(run.durationMs) : formatAge(run.startedAt)}</span>
      </div>
      {run.output && <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-secondary">{run.output}</pre>}
    </div>
  )
}

function RunIcon({ status }: { status: WorkStep["status"] }) {
  if (status === "running") return <Spinner size={12} className="text-success" />
  if (status === "ok") return <CircleCheck className="size-3.5 text-success" />
  if (status === "refused") return <CircleAlert className="size-3.5 text-warning" />
  if (status === "waiting") return <CircleAlert className="size-3.5 text-accent-text" />
  return <CircleX className="size-3.5 text-danger" />
}

