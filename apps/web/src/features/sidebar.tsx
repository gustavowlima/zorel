// Sidebar (one column, 2026-11-05, after Zeron's): the brand and its fold on top, then the app's places as rows (New
// chat, Search, Needs you; then Agents, Routines, Memory (with its pages) and Skills, quieter), the scrolling Chats section
// (chats without a project) and Projects section (the tree), and at the foot the usage ring, Pause and Settings.
// Folded (⌘B) it narrows to a column of the places' icons with the foot under them; the chats wait for it to open.
// The list fades out at the bottom while more is below. Chats sort by whose turn it is, then manual order and
// recency; projects reorder by drag and drop, chats only inside their own group. Each row has a ⋯ with the same
// menu as right-click.
import { type AccountWindow, type Agent, type Chat, LIMIT_ALERT, type Project, type ProviderAccount } from "@zorel/contracts"
import type { ChatStatus } from "@zorel/contracts/events"
import { formatAge, formatPercent, formatTime, t } from "@zorel/i18n"
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react"
import { accountsAtom, agentsAtom, approvalsAtom, chatsAtom, memoriesAtom, mutations, projectsAtom, useInvalidate, useList, useMutation, useStatuses } from "../client.ts"
import { chatTitle, modelName, statusLabel, type Pace, paceOf, windowLabel, windowMinutes } from "../labels.ts"
import { RenameDialog } from "./chat.tsx"
import { openPalette } from "./palette.tsx"
import { NewProjectButton } from "./project.tsx"
import { byTurn, ordered, type Statuses, visibleChats } from "./sidebar-order.ts"
import { go, readSet, type Route, writeSet } from "../state.ts"
import {
  ChevronRight, Fold, Marker, Menu, MoreHorizontal, NavItem, Search, Pause, Play, PanelLeftClose, PanelLeftOpen, AlarmClock, Bot, Brain, Button, ConfirmDialog, ContextMenu, ChartColumn, cx, Download, Folder, IconButton, Inbox, Logo, MenuItem, MenuSeparator, MessageCircle, NavLabel, Pencil, NavTree, NavTreeItem, type NavKey, Plus, ProviderIcon, LimitRing, Meter, type RingTone, Settings, Spinner, SquarePen, Tooltip, Trash2, useNavReorder, Width
} from "@/ui"

// Open and folded widths (App animates between them; the desktop title bar lines up with the open one).
export const SIDEBAR_WIDTH = 268
export const SIDEBAR_FOLDED = 56
const VISIBLE = 5
const EXPANDED_KEY = "zorel.sidebar.expanded"
const COLLAPSED_KEY = "zorel.sidebar.collapsed" // sections closed by hand: "chats", "projects"

// Tree keys carry their kind: a project, a chat, or a group's "show more" row.
const projectKey = (id: string) => `p:${id}`
const chatKey = (id: string) => `c:${id}`
const moreKey = (group: string) => `m:${group}`
const emptyKey = (projectId: string) => `e:${projectId}`
const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
const idOf = (key: NavKey) => String(key).slice(2)

type Place = { key: string; icon: ReactNode; label: string; active?: boolean; go: () => void; count?: number }

// The app's places, named: Needs you (with what waits for you), Agents, Routines and Memory (Pages is a view of
// Memory); Skills live in Settings. New chat and Search are icons in the head. Folded, all are icons in a column,
// New chat and Search first. The current one has the open chat's wash.
function Places({ route, folded }: { route: Route; folded: boolean }) {
  const memories = useList(memoriesAtom)
  const approvals = useList(approvalsAtom)
  const needsYou = approvals.length + memories.filter((m) => m.state === "pending").length
  const places: Place[] = [
    { key: "inbox", icon: <Inbox />, label: t("nav.needsYou"), active: route.view === "inbox", go: () => go({ view: "inbox" }), count: needsYou },
    { key: "agents", icon: <Bot />, label: t("nav.agents"), active: ["agents", "agent", "new-agent", "builder"].includes(route.view), go: () => go({ view: "agents" }) },
    { key: "routines", icon: <AlarmClock />, label: t("nav.routines"), active: route.view === "routines", go: () => go({ view: "routines" }) },
    // Pages is a view of Memory (its header's switch): Memory stays current there.
    { key: "memory", icon: <Brain />, label: t("nav.memory"), active: route.view === "memory" || route.view === "pages", go: () => go({ view: "memory" }) }
  ]
  if (folded) {
    const start: Place[] = [
      { key: "new", icon: <SquarePen />, label: t("nav.newChat"), active: route.view === "home" && !route.projectId, go: () => go({ view: "home" }) },
      { key: "search", icon: <Search />, label: t("common.search"), go: openPalette }
    ]
    const rail = (p: Place) => (
      <RailItem key={p.key} label={p.label} active={!!p.active} onPress={p.go} count={p.count}>
        {p.icon}
      </RailItem>
    )
    return (
      <div className="flex shrink-0 flex-col items-start gap-1 pl-2">
        {start.map(rail)}
        <span aria-hidden="true" className="my-1 ml-2 h-px w-6 bg-subtle" />
        {places.map(rail)}
      </div>
    )
  }
  return (
    <div className="flex shrink-0 flex-col gap-0.5 pr-2.5 pl-2">
      {places.map((p) => (
        <NavItem
          key={p.key}
          icon={p.icon}
          active={!!p.active}
          onPress={p.go}
          aria-label={p.count ? `${p.label} (${p.count})` : p.label}
          className={cx("h-9", p.active && "border-transparent bg-control-hover")}
          trailing={p.count ? <Count n={p.count} /> : undefined}
        >
          {p.label}
        </NavItem>
      ))}
    </div>
  )
}

// The top: the brand, New chat and Search (⌘K) as icons, and the fold (⌘B). Folded, only the button that opens it
// again (New chat and Search then sit at the top of the icon column).
function Head({ route, folded, onToggle }: { route: Route; folded: boolean; onToggle: () => void }) {
  const label = folded ? t("nav.showSidebar") : t("nav.hideSidebar")
  const button = (
    <Tooltip content={label} placement={folded ? "right" : "bottom"}>
      <IconButton label={label} onPress={onToggle} className={cx("text-muted", folded && "size-10 rounded-card [&_svg]:size-5")}>
        {folded ? <PanelLeftOpen /> : <PanelLeftClose />}
      </IconButton>
    </Tooltip>
  )
  if (folded) return <div className="flex h-13 shrink-0 items-center pl-2">{button}</div>
  const newChat = route.view === "home" && !route.projectId
  return (
    <div className="flex h-13 shrink-0 items-center gap-1 pr-2.5 pl-4.5">
      <Logo className="mr-1.5 size-5 shrink-0" />
      <span className="min-w-0 flex-1 truncate font-semibold">{t("app.name")}</span>
      <Tooltip content={t("nav.newChat")} placement="bottom">
        <IconButton label={t("nav.newChat")} onPress={() => go({ view: "home" })} className={cx("text-muted", newChat && "bg-control-hover text-fg")}>
          <SquarePen />
        </IconButton>
      </Tooltip>
      <Tooltip content={`${t("common.search")} (${MAC ? "⌘K" : "Ctrl K"})`} placement="bottom">
        <IconButton label={t("common.search")} onPress={openPalette} className="text-muted">
          <Search />
        </IconButton>
      </Tooltip>
      {button}
    </div>
  )
}

// The foot: the usage ring, Pause (running turns stop, new ones and routines wait) and Settings, in a row; folded, in
// a column under the places.
function Foot({ route, folded, paused, onPause }: { route: Route; folded: boolean; paused: boolean; onPause: (paused: boolean) => void }) {
  const side = folded ? "right" : "top"
  return (
    <div className={cx("flex shrink-0 gap-1", folded ? "flex-col items-start pt-2 pl-2" : "items-center pt-2 pr-2 pl-3.25")}>
      {folded && <UpdateItem />}
      <UsageFoot active={route.view === "usage"} placement={side} />
      {!folded && <span className="flex-1" />}
      <RailItem label={paused ? t("pause.resume") : t("pause.all")} active={false} onPress={() => onPause(!paused)} placement={side}>
        {paused ? <Play className="text-warning" /> : <Pause />}
      </RailItem>
      <RailItem label={t("nav.settings")} active={route.view === "settings"} onPress={() => go({ view: "settings", tab: "general" })} placement={side}>
        <Settings />
      </RailItem>
    </div>
  )
}

// The desktop app's update (window.zorelDesktop.update): a card under the chats (the version, the download's
// progress, then Restart) and, for when the chats are hidden, an accent download mark in the rail's corner. Nothing
// in a browser.
type Update = { version: string; ready: boolean; percent?: number; installing?: boolean; error?: string } | null
const desktopUpdate = (window as { zorelDesktop?: { update?: { get: () => Promise<Update>; install: () => Promise<boolean>; on: (cb: (u: Update) => void) => () => void } } }).zorelDesktop?.update
function useUpdate() {
  const [update, setUpdate] = useState<Update>(null)
  useEffect(() => {
    if (!desktopUpdate) return
    void desktopUpdate.get().then(setUpdate)
    return desktopUpdate.on(setUpdate)
  }, [])
  return desktopUpdate ? update : null
}
function UpdateItem() {
  const update = useUpdate()
  if (!update || !desktopUpdate) return null
  const label = update.ready ? t("update.ready", { version: update.version }) : t("update.downloading", { version: update.version })
  return (
    <span className="relative">
      <Tooltip content={label} placement="right">
        <IconButton label={label} isDisabled={!update.ready || !!update.installing} onPress={() => void desktopUpdate.install()} className={cx("relative size-10 rounded-card [&_svg]:size-5", update.ready ? "text-accent-text" : "text-dim")}>
          <Download />
        </IconButton>
      </Tooltip>
      {update.ready && <span aria-hidden="true" className="pointer-events-none absolute top-1.5 right-1.5 size-2 rounded-full bg-accent ring-2 ring-canvas" />}
    </span>
  )
}

function UpdateCard() {
  const update = useUpdate()
  if (!update || !desktopUpdate) return null
  const percent = update.percent ?? 0
  return (
    <section aria-label={t("update.title", { version: update.version })} className="mx-2.5 mt-2 flex flex-col gap-2 rounded-card border border-subtle p-3">
      <div className="flex items-center gap-2">
        <Download className={cx("size-4 shrink-0", update.ready ? "text-accent-text" : "text-muted")} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{t("update.title", { version: update.version })}</span>
      </div>
      {update.installing ? (
        // Restart pressed: Zorel downloads, closes and opens on the new version by itself; no second press.
        <span className="flex items-center gap-2 text-sm text-muted">
          <Spinner size={12} />
          {t("update.installing")}
        </span>
      ) : update.ready ? (
        <>
          {update.error && <p className="text-sm text-warning">{t("update.failed", { reason: update.error })}</p>}
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm text-muted">{update.error ? "" : t("update.readyShort")}</span>
            <Button size="sm" variant="default" onPress={() => void desktopUpdate?.install()}>
              {update.error ? t("update.retry") : t("update.restart")}
            </Button>
          </div>
        </>
      ) : (
        <>
          <Meter role="progressbar" value={percent / 100} label={t("update.downloading", { version: update.version })} />
          <span className="text-sm text-muted tabular-nums">{t("update.progress", { percent })}</span>
        </>
      )}
    </section>
  )
}

// A place or foot control as an icon: its name in a tooltip, the current one's wash sliding from the previous one,
// and its count on the corner. 40px folded, 32px in the open foot.
function RailItem({
  label,
  active,
  onPress,
  count,
  placement = "right",
  children
}: {
  label: string
  active: boolean
  onPress: () => void
  count?: number | undefined
  placement?: "right" | "top"
  children: ReactNode
}) {
  const small = placement === "top"
  return (
    <span className="relative">
      {active && <Marker id="rail-current" className="absolute inset-0 rounded-card bg-accent-faint" />}
      <Tooltip content={label} placement={placement}>
        <IconButton
          label={count ? `${label} (${count})` : label}
          onPress={onPress}
          className={cx("relative rounded-card", small ? "size-8 [&_svg]:size-4" : "size-10 [&_svg]:size-5", active ? "text-accent-text data-hovered:bg-transparent" : "text-muted")}
          {...(active && { "aria-current": "page" as const })}
        >
          {children}
        </IconButton>
      </Tooltip>
      {!!count && (
        <span aria-hidden="true" className="pointer-events-none absolute -top-0.5 -right-0.5">
          <Count n={count} />
        </span>
      )}
    </span>
  )
}

export function Sidebar({
  route,
  activeProjectId,
  folded,
  onToggle,
  paused,
  onPause
}: {
  route: Route
  activeProjectId: string | null
  folded: boolean
  onToggle: () => void
  paused: boolean
  onPause: (paused: boolean) => void
}) {
  const projects = useList(projectsAtom)
  const chats = useList(chatsAtom)
  const agents = useList(agentsAtom)
  const statuses = useStatuses()
  // A chat the server started (a task one agent gave another, a routine's) shows up by its status: read the list
  // again, once per unknown chat (hidden ones, like the Builder's, never join the list).
  const invalidate = useInvalidate()
  const asked = useRef(new Set<string>())
  useEffect(() => {
    const fresh = Object.keys(statuses).filter((id) => !asked.current.has(id) && !chats.some((c) => c.id === id))
    if (!fresh.length) return
    for (const id of fresh) asked.current.add(id)
    invalidate(["chats"])
  }, [statuses, chats, invalidate])

  const [expanded, setExpanded] = useState(() => readSet(EXPANDED_KEY))
  const [all, setAll] = useState<ReadonlySet<string>>(new Set()) // groups showing every chat
  const toggleAll = (group: string) => setAll((s) => (s.has(group) ? new Set([...s].filter((g) => g !== group)) : new Set([...s, group])))
  // The active project stays open.
  const expandedKeys = new Set([...expanded, ...(activeProjectId ? [activeProjectId] : [])].map(projectKey))
  const onExpandedChange = (keys: Set<NavKey>) => {
    const next = new Set([...keys].map(idOf))
    setExpanded(next)
    writeSet(EXPANDED_KEY, next)
  }
  const toggle = (id: string) => {
    const key = projectKey(id)
    onExpandedChange(new Set(expandedKeys.has(key) ? [...expandedKeys].filter((k) => k !== key) : [...expandedKeys, key]))
  }

  // Sections open unless closed by hand; the choice is remembered on this computer.
  const [collapsed, setCollapsed] = useState(() => readSet(COLLAPSED_KEY))
  const flip = (section: string) => {
    const next = new Set(collapsed)
    if (!next.delete(section)) next.add(section)
    setCollapsed(next)
    writeSet(COLLAPSED_KEY, next)
  }
  // More of the list past an edge (below the fold, or scrolled away above): the list fades out over that edge.
  const listRef = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ above: false, below: false })
  const measure = () => {
    const el = listRef.current
    if (!el) return
    const above = el.scrollTop > 1
    const below = el.scrollTop + el.clientHeight < el.scrollHeight - 1
    setEdges((e) => (e.above === above && e.below === below ? e : { above, below }))
  }
  useLayoutEffect(measure)

  const activeChat = route.view === "chat" ? route.id : undefined
  const groupOf = (projectId: string | null) => byTurn(ordered(chats.filter((c) => c.projectId === projectId), statuses), statuses)
  const loose = groupOf(null) // the chats without a project

  // The row menus, shared by right-click (or the Menu key) and the row's ⋯: a chat (open, rename, delete) or a
  // project (open, new chat in it, settings, delete).
  const removeChat = useMutation(mutations.removeChat)
  const updateChat = useMutation(mutations.updateChat)
  const removeProject = useMutation(mutations.removeProject)
  const [dialog, setDialog] = useState<{ kind: "rename" | "deleteChat"; chat: Chat } | { kind: "deleteProject"; project: Project }>()
  const chatMenu = (chat: Chat) => (
    <>
      <MenuItem icon={<MessageCircle />} onAction={() => go({ view: "chat", id: chat.id })}>
        {t("common.open")}
      </MenuItem>
      <MenuItem icon={<Pencil />} onAction={() => setDialog({ kind: "rename", chat })}>
        {t("common.rename")}
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={<Trash2 />} tone="danger" onAction={() => setDialog({ kind: "deleteChat", chat })}>
        {t("common.delete")}
      </MenuItem>
    </>
  )
  const projectMenu = (project: Project) => (
    <>
      <MenuItem icon={<Folder />} onAction={() => go({ view: "project", id: project.id, tab: "overview" })}>
        {t("common.open")}
      </MenuItem>
      <MenuItem icon={<Plus />} onAction={() => go({ view: "home", projectId: project.id })}>
        {t("nav.newChatIn", { name: project.name })}
      </MenuItem>
      <MenuItem icon={<Settings />} onAction={() => go({ view: "project", id: project.id, tab: "overview" })}>
        {t("nav.projectSettings", { name: project.name })}
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={<Trash2 />} tone="danger" onAction={() => setDialog({ kind: "deleteProject", project })}>
        {t("project.deleteAction")}
      </MenuItem>
    </>
  )
  const menuFor = (target: HTMLElement) => {
    const key = target.closest("[role=row]")?.getAttribute("data-key") ?? ""
    const chat = key.startsWith("c:") ? chats.find((c) => c.id === idOf(key)) : undefined
    const project = key.startsWith("p:") ? projects.find((p) => p.id === idOf(key)) : undefined
    return chat ? chatMenu(chat) : project ? projectMenu(project) : undefined
  }

  const reorderProjects = useMutation(mutations.reorderProjects)
  const reorderChats = useMutation(mutations.reorderChats)
  const projectDnd = useNavReorder({
    // Projects move among projects; a chat moves only among the chats of its own project.
    groupOf: (key) => (key.startsWith("p:") ? "projects" : key.startsWith("c:") ? (chats.find((c) => c.id === idOf(key))?.projectId ?? undefined) : undefined),
    orderOf: (group) => (group === "projects" ? projects.map((p) => projectKey(p.id)) : groupOf(group).map((c) => chatKey(c.id))),
    save: (group, keys) =>
      group === "projects"
        ? reorderProjects({ payload: { ids: keys.map(idOf) }, reactivityKeys: ["projects"] })
        : reorderChats({ payload: { projectId: group, ids: keys.map(idOf) }, reactivityKeys: ["chats"] })
  })

  const looseDnd = useNavReorder({
    groupOf: (key) => (key.startsWith("c:") ? "loose" : undefined),
    orderOf: () => loose.map((c) => chatKey(c.id)),
    save: (_, keys) => reorderChats({ payload: { projectId: null, ids: keys.map(idOf) }, reactivityKeys: ["chats"] })
  })

  const chatItems = (group: string, list: ReadonlyArray<Chat>) => {
    const showAll = all.has(group)
    const { visible, hidden } = visibleChats(list, activeChat, VISIBLE, showAll)
    const label = showAll ? t("nav.showLess") : t("nav.showMore", { count: hidden })
    const more = (hidden > 0 || showAll) && list.length > VISIBLE
    const nested = group !== "loose"
    return [
      ...visible.map((c, i) => (
        <ChatItem key={c.id} chat={c} status={statuses[c.id]} active={c.id === activeChat} agents={agents} menu={chatMenu(c)} nested={nested} last={!more && i === visible.length - 1} />
      )),
      ...(more ? [<NavTreeItem key="more" id={moreKey(group)} textValue={label} title={label} quiet onAction={() => toggleAll(group)} nested={nested} last />] : [])
    ]
  }

  return (
    <nav aria-label={t("nav.label")} className={cx("flex shrink-0 flex-col overflow-hidden pb-3", folded ? "w-14" : "w-67")}>
      <Head route={route} folded={folded} onToggle={onToggle} />
      <Places route={route} folded={folded} />

      {/* Chats (without a project) first, then Projects; each section folds, and the list scrolls under the places.
          Right-click (or the Menu key) on a chat or a project opens its menu. Folded, the column holds only icons. */}
      {folded ? (
        <span className="flex-1" />
      ) : (
      <>
      <ContextMenu label={t("common.more")} menuFor={menuFor} className="mt-4 flex min-h-0 flex-1 flex-col pl-2">
      <div ref={listRef} onScroll={measure} className={cx("scroll-quiet flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain pr-2.5 pb-2", edges.above && edges.below ? "fade-y" : edges.above ? "fade-top" : edges.below && "fade-bottom")}>
        <section className="flex flex-col gap-px">
          <NavLabel
            hint={t("nav.chatsHint")}
            expanded={!collapsed.has("chats")}
            onToggle={() => flip("chats")}
            summary={<Pending count={loose.filter((c) => statuses[c.id]?.state === "waiting").length} />}
            action={
              <Tooltip content={t("nav.newChat")}>
                <IconButton label={t("nav.newChat")} size="xs" onPress={() => go({ view: "home" })}>
                  <Plus className="size-3.5" />
                </IconButton>
              </Tooltip>
            }
          >
            {t("nav.chats")}
          </NavLabel>
          <Fold open={!collapsed.has("chats")}>
            {loose.length ? (
              <NavTree label={t("nav.chats")} dragAndDropHooks={looseDnd}>
                {chatItems("loose", loose)}
              </NavTree>
            ) : (
              <div className="flex flex-col items-start gap-2 py-1 pl-2.5">
                <p className="text-sm text-muted">{t("nav.noChats")}</p>
                <Button size="sm" onPress={() => go({ view: "home" })}>
                  {t("nav.newChat")}
                </Button>
              </div>
            )}
          </Fold>
        </section>

        <section className="flex flex-col gap-px">
          <NavLabel
            expanded={!collapsed.has("projects")}
            onToggle={() => flip("projects")}
            summary={<Pending count={projects.reduce((n, p) => n + chats.filter((c) => c.projectId === p.id && statuses[c.id]?.state === "waiting").length, 0)} />}
            action={<NewProjectButton />}
          >
            {t("nav.projects")}
          </NavLabel>
          <Fold open={!collapsed.has("projects")}>
            {projects.length ? (
              <NavTree label={t("nav.projects")} expandedKeys={expandedKeys} onExpandedChange={onExpandedChange} dragAndDropHooks={projectDnd}>
                {projects.map((p) => {
                  const list = groupOf(p.id)
                  return (
                    <ProjectItem key={p.id} project={p} active={(route.view === "project" && route.id === p.id) || (route.view === "home" && route.projectId === p.id)} chats={list} statuses={statuses} menu={projectMenu(p)} onToggle={() => toggle(p.id)}>
                      {list.length ? (
                        chatItems(p.id, list)
                      ) : (
                        // An empty project still opens: one quiet row that starts its first chat.
                        <NavTreeItem id={emptyKey(p.id)} textValue={t("nav.emptyProjectStart")} quiet nested last title={t("nav.emptyProjectStart")} onAction={() => go({ view: "home", projectId: p.id })} />
                      )}
                    </ProjectItem>
                  )
                })}
              </NavTree>
            ) : (
              <div className="flex flex-col items-start gap-2 py-1 pr-2 pl-2.5">
                <p className="text-sm text-muted">{t("nav.emptyProjects")}</p>
                <NewProjectButton label={t("nav.addProject")} />
              </div>
            )}
          </Fold>
        </section>
      </div>

      </ContextMenu>
      <UpdateCard />
      </>
      )}
      <Foot route={route} folded={folded} paused={paused} onPause={onPause} />

      {dialog?.kind === "rename" && (
        <RenameDialog
          isOpen
          onClose={() => setDialog(undefined)}
          title={chatTitle(dialog.chat)}
          onSave={(title) => void updateChat({ params: { id: dialog.chat.id }, payload: { title }, reactivityKeys: ["chats"] })}
        />
      )}
      <ConfirmDialog
        isOpen={dialog?.kind === "deleteChat"}
        onOpenChange={(open) => !open && setDialog(undefined)}
        title={t("chat.deleteTitle")}
        description={t("chat.deleteBody")}
        onConfirm={() => {
          if (dialog?.kind !== "deleteChat") return
          const { chat } = dialog
          void removeChat({ params: { id: chat.id }, reactivityKeys: ["chats"] }).then(() => activeChat === chat.id && go({ view: "home" }))
        }}
      />
      <ConfirmDialog
        isOpen={dialog?.kind === "deleteProject"}
        onOpenChange={(open) => !open && setDialog(undefined)}
        title={dialog?.kind === "deleteProject" ? t("project.deleteTitle", { name: dialog.project.name }) : ""}
        description={t("project.deleteBody")}
        confirmLabel={t("project.deleteAction")}
        onConfirm={() => {
          if (dialog?.kind !== "deleteProject") return
          const { project } = dialog
          void removeProject({ params: { id: project.id }, reactivityKeys: ["projects", "chats", "agents", "memories"] }).then(() => activeProjectId === project.id && go({ view: "home" }))
        }}
      />
    </nav>
  )
}

const Count = ({ n }: { n: number }) => (
  <span className="flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-semibold text-on-accent tabular-nums">{n}</span>
)

// How many chats wait for you, shown on a collapsed section's title (a number with the accent text, never colour alone).
function Pending({ count }: { count: number }) {
  if (!count) return null
  return (
    <span role="img" aria-label={t("nav.waitingIn", { count })} className="shrink-0 px-1 text-sm font-medium text-accent-text tabular-nums">
      {count}
    </span>
  )
}

// The row's ⋯: the same menu as right-click. It replaces the time (or the count) on hover and focus, and is always
// there on touch.
function RowMenu({ name, children }: { name: string; children: ReactNode }) {
  const label = t("nav.moreFor", { name })
  return (
    <Menu
      label={label}
      trigger={
        <IconButton label={label} size="xs">
          <MoreHorizontal className="size-3.5" />
        </IconButton>
      }
    >
      {children}
    </Menu>
  )
}

// A project: one line. Its tile (its initial; an arrow on hover) in the icon column, its name, and on the right how
// many chats it holds, or its state: how many wait for you (the number in the accent), or a spinner while one works.
// On hover: + (new chat in it) and ⋯.
function ProjectItem({
  project,
  active,
  chats,
  statuses,
  menu,
  onToggle,
  children
}: {
  project: Project
  active: boolean
  chats: ReadonlyArray<Chat>
  statuses: Statuses
  menu: ReactNode
  onToggle: () => void
  children: ReactNode
}) {
  const waiting = chats.filter((c) => statuses[c.id]?.state === "waiting").length
  const running = !waiting && chats.some((c) => statuses[c.id]?.state === "running")
  return (
    <NavTreeItem
      id={projectKey(project.id)}
      textValue={project.name}
      active={active}
      groupIcon={() => <ProjectTile name={project.name} />}
      title={project.name}
      dragLabel={t("nav.reorder", { name: project.name })}
      onAction={onToggle}
      trailing={
        waiting ? (
          <Pending count={waiting} />
        ) : running ? (
          <Spinner size={11} className="text-muted" label={t("nav.runningIn", { count: 1 })} />
        ) : chats.length ? (
          <span className="text-dim">{chats.length}</span>
        ) : undefined
      }
      actions={
        <>
          <Tooltip content={t("nav.newChatIn", { name: project.name })}>
            <IconButton label={t("nav.newChatIn", { name: project.name })} size="xs" onPress={() => go({ view: "home", projectId: project.id })}>
              <Plus className="size-3.5" />
            </IconButton>
          </Tooltip>
          <RowMenu name={project.name}>{menu}</RowMenu>
        </>
      }
    >
      {children}
    </NavTreeItem>
  )
}

// A project's tile: its initial on the control tone (agent colours stay in avatars).
const ProjectTile = ({ name }: { name: string }) => (
  <span aria-hidden="true" className="flex size-5 items-center justify-center rounded-md bg-control text-xs font-semibold text-secondary uppercase">
    {[...name.trim()][0] ?? ""}
  </span>
)

// A chat: its title and when it last moved (a spinner while it works); ⋯ takes the time's place on hover or focus.
// Outside a project the chat glyph sits in the icon column (inside one, the tree does), so its words line up at x 49.
// A second line only when there is something to read: it waits for you (accent), it failed (danger), or an agent in
// it waits on a teammate. Who answers and the model are its tooltip; the state is always words, never colour alone.
function ChatItem({
  chat,
  status,
  active,
  agents,
  menu,
  nested = false,
  last = false
}: {
  chat: Chat
  status: ChatStatus | undefined
  active: boolean
  agents: ReadonlyArray<Agent>
  menu: ReactNode
  nested?: boolean
  last?: boolean
}) {
  const live = status && status.state !== "idle" ? status : undefined
  const members = chat.agentIds.flatMap((id) => agents.filter((a) => a.id === id))
  const at = Math.max(chat.lastAt ?? chat.createdAt, status?.updatedAt ?? 0)
  const said = status ? statusLabel(status, agents) || undefined : undefined // idle shows only who waits on a teammate
  const model = modelName(chat.model)
  const who = members.length > 1 ? `${members[0]!.name} +${members.length - 1}` : members[0]?.name
  const detail = who ? t("nav.withModel", { agent: who, model }) : model
  const line = live?.state === "running" ? undefined : said // working is the spinner's to say
  return (
    <NavTreeItem
      id={chatKey(chat.id)}
      textValue={[chatTitle(chat), said ?? detail].filter(Boolean).join(", ")}
      active={active}
      strong={live?.state === "waiting"}
      title={chatTitle(chat)}
      tooltip={detail}
      {...(!nested && {
        leading: (
          <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center text-muted [&_svg]:size-4">
            <MessageCircle />
          </span>
        )
      })}
      trailing={live?.state === "running" ? <Spinner size={11} className="text-muted" label={said ?? ""} /> : formatAge(at)}
      actions={<RowMenu name={chatTitle(chat)}>{menu}</RowMenu>}
      {...(line && { detail: <span className={cx("truncate", live?.state === "waiting" ? "text-accent-text" : live?.state === "failed" ? "text-danger" : undefined)}>{line}</span> })}
      nested={nested}
      last={last}
      dragLabel={t("nav.reorder", { name: chatTitle(chat) })}
      onAction={() => go({ view: "chat", id: chat.id })}
    />
  )
}

// The subscriptions at the foot: one ring, the most at risk one's (its limit windows concentric around its logo),
// opening Usage when pressed. Hovering (or focusing) shows every subscription: each window with when it resets, the
// account's windows as rings (ui/limit-ring.tsx) and where the pace so far leads.
const TONE_TEXT = { ok: "text-secondary", warning: "text-warning", critical: "text-danger" } as const
function UsageFoot({ active, placement }: { active: boolean; placement: "right" | "top" }) {
  const rows = useList(accountsAtom)
    .filter((a) => a.kind === "subscription")
    .flatMap((a) => {
      const windows = (a.usage?.windows ?? []).map((w) => ({ w, pace: paceOf(w) }))
      const worst = windows.filter((x) => windowMinutes(x.w.id) !== null).sort((x, y) => y.pace.risk - x.pace.risk)[0]
      return worst ? [{ account: a, windows, ...worst }] : []
    })
    .sort((x, y) => y.pace.risk - x.pace.risk)
  const first = rows[0]
  if (!first)
    return (
      <RailItem label={t("nav.usage")} active={active} onPress={() => go({ view: "usage" })} placement={placement}>
        <ChartColumn />
      </RailItem>
    )
  const window = windowLabel(first.w.id)
  const sentence = first.pace.runsOutAt
    ? t("nav.usageOut", { account: first.account.label, window, time: formatTime(first.pace.runsOutAt) })
    : t("nav.usageUsed", { account: first.account.label, window, percent: formatPercent(first.pace.used) })
  const small = placement === "top"
  return (
    <Tooltip content={<UsageDetail rows={rows} />} placement={placement}>
      <Button
        variant="ghost"
        shape="pill"
        aria-label={`${t("nav.usage")}: ${sentence}`}
        onPress={() => go({ view: "usage" })}
        className={cx("p-0 text-fg data-hovered:text-fg", small ? "size-8" : "size-10", active && "ring-1 ring-strong")}
      >
        <LimitRing
          size={small ? 28 : 34}
          windows={first.windows
            .filter(({ w }) => windowMinutes(w.id) !== null)
            .sort((x, y) => (windowMinutes(y.w.id) ?? 0) - (windowMinutes(x.w.id) ?? 0))
            .map(({ pace }) => ({ used: pace.used, tone: toneOf(pace) }))}
        >
          <ProviderIcon provider={first.account.provider} size={small ? 11 : 13} />
        </LimitRing>
      </Button>
    </Tooltip>
  )
}

// The hover card: per account, its windows as concentric rings with the logo inside, where the pace so far leads,
// and every window with its share used and when it resets.
function UsageDetail({ rows }: { rows: ReadonlyArray<{ account: ProviderAccount; windows: ReadonlyArray<{ w: AccountWindow; pace: Pace }>; w: AccountWindow; pace: Pace }> }) {
  return (
    <span className="flex w-64 flex-col gap-3 py-0.5">
      {rows.map((r) => {
        const tone = toneOf(r.pace)
        const leftAtReset = r.pace.elapsed && r.pace.elapsed >= 0.1 ? 1 - r.pace.used / r.pace.elapsed : null
        return (
          <span key={r.account.id} className="flex flex-col gap-2">
            <span className="flex items-center gap-3">
              {/* One ring per window (the longest outside), as the rows below in words. */}
              <LimitRing
                windows={r.windows
                  .filter(({ w }) => windowMinutes(w.id) !== null)
                  .sort((x, y) => (windowMinutes(y.w.id) ?? 0) - (windowMinutes(x.w.id) ?? 0))
                  .map(({ pace }) => ({ used: pace.used, tone: toneOf(pace) }))}
              >
                <ProviderIcon provider={r.account.provider} size={16} />
              </LimitRing>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium text-fg">{r.account.label}</span>
                <span className={cx("text-xs", TONE_TEXT[tone])}>
              {r.pace.runsOutAt
                ? t("nav.usageRunsOut", { window: windowLabel(r.w.id), time: formatTime(r.pace.runsOutAt) })
                : leftAtReset !== null
                  ? t("nav.usageOnPace", { window: windowLabel(r.w.id), percent: formatPercent(leftAtReset) })
                  : t("nav.usageEarly", { window: windowLabel(r.w.id), percent: formatPercent(r.pace.used) })}
                </span>
              </span>
            </span>
            {r.windows.map(({ w, pace }) => (
              <span key={w.id} className="flex items-baseline justify-between gap-3 text-xs">
                <span className="truncate text-secondary">{windowLabel(w.id)}</span>
                <span className="shrink-0 text-muted tabular-nums">
                  {formatPercent(pace.used)}
                  {w.resetsAt ? ` · ${t("usage.resets", { time: formatTime(w.resetsAt) })}` : ""}
                </span>
              </span>
            ))}
          </span>
        )
      })}
    </span>
  )
}

const toneOf = (p: Pace): RingTone => (p.used >= 0.95 ? "critical" : p.runsOutAt || p.used >= LIMIT_ALERT ? "warning" : "ok")

// The desktop app's title bar: the whole window width above the sidebar and the card. It drags the window, leaves
// room for the macOS window buttons, holds back/forward and the current page's header. The brand stays on the
// sidebar.
export function TitleBar({ sidebarHidden }: { sidebarHidden: boolean }) {
  return (
    <header className="app-drag flex h-12 shrink-0 items-center">
      {/* Left: the window buttons and back/forward, as wide as the open sidebar so the page header starts on the
          card's edge. With the sidebar folded the window buttons own that corner: the header follows them. */}
      <Width width={sidebarHidden ? "auto" : SIDEBAR_WIDTH} className="flex shrink-0 items-center gap-0.5 overflow-hidden pl-24">
        <Tooltip content={t("nav.back")}>
          <IconButton label={t("nav.back")} size="xs" onPress={() => history.back()}>
            <ChevronRight className="size-4 rotate-180" />
          </IconButton>
        </Tooltip>
        <Tooltip content={t("nav.forward")}>
          <IconButton label={t("nav.forward")} size="xs" onPress={() => history.forward()}>
            <ChevronRight className="size-4" />
          </IconButton>
        </Tooltip>
      </Width>
      {/* The current page's header (PageHeader portals into it). */}
      <div id="titlebar-slot" className="flex h-full min-w-0 flex-1 items-center" />
    </header>
  )
}
