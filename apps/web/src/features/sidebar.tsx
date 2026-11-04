// Sidebar: the brand (the title bar in the desktop app) with Settings at its end; the pages, fixed (Needs you, Knowledge); then,
// scrolling, the Chats section (chats without a project) and the Projects section (the tree), each with an icon,
// a fold and a +; and at the foot the subscriptions' limits. Every row shares one 20px icon column (x20-40) and
// starts its text at x50. The list fades out at the bottom while more is below, and only then does the foot draw
// its hairline. Chats sort by whose turn it is, then manual order and recency; projects reorder by drag and drop,
// chats only inside their own group.
import { type AccountWindow, type Agent, type Chat, LIMIT_ALERT, type Project, type ProviderAccount } from "@zero/contracts"
import type { ChatStatus } from "@zero/contracts/events"
import { formatAge, formatPercent, formatTime, t } from "@zero/i18n"
import { type ReactNode, useLayoutEffect, useRef, useState } from "react"
import { accountsAtom, agentsAtom, approvalsAtom, chatsAtom, memoriesAtom, mutations, projectsAtom, useList, useMutation, useStatuses } from "../client.ts"
import { agentTone, chatTitle, statusLabel, type Pace, paceOf, windowLabel, windowMinutes } from "../labels.ts"
import { RenameDialog } from "./chat.tsx"
import { NewProjectButton } from "./project.tsx"
import { go, readSet, type Route, writeSet } from "../state.ts"
import {
  ChevronRight, Fold, Marker, Pause, Play, PanelLeftClose, PanelLeftOpen, AgentAvatar, AlarmClock, BookOpen, Bot, Button, ConfirmDialog, ContextMenu, ChartColumn, cx, Folder, IconButton, Inbox, Logo, MenuItem, MenuSeparator, MessageCircle, NavLabel, Pencil, NavTree, NavTreeItem, type NavKey, Plus, ProviderIcon, LimitRing, type RingTone, Settings, Spinner, Tooltip, Trash2, useNavReorder, Width
} from "@/ui"

const VISIBLE = 5
const EXPANDED_KEY = "zero.sidebar.expanded"
const COLLAPSED_KEY = "zero.sidebar.collapsed" // sections closed by hand: "chats", "projects"
type Statuses = Readonly<Record<string, ChatStatus>>

// Tree keys carry their kind: a project, a chat, or a group's "show more" row.
const projectKey = (id: string) => `p:${id}`
const chatKey = (id: string) => `c:${id}`
const moreKey = (group: string) => `m:${group}`
const idOf = (key: NavKey) => String(key).slice(2)

// The icon rail (as in OpenBot): the logo, then the app's places — chats, what waits for you, agents, routines,
// knowledge — and at the foot the subscriptions' rings (usage) and Settings. Each icon has its name as a tooltip;
// the current place is marked. The chats and projects list sits to its right.
export function Rail({
  route,
  sidebar,
  paused,
  onPause
}: {
  route: Route
  sidebar: { hidden: boolean; toggle: () => void; show: () => void }
  paused: boolean
  onPause: (paused: boolean) => void
}) {
  const memories = useList(memoriesAtom)
  const approvals = useList(approvalsAtom)
  const needsYou = approvals.length + memories.filter((m) => m.state === "pending").length
  const places = [
    // Chats again while it is the current place folds or unfolds the chats list.
    {
      key: "chats",
      icon: <MessageCircle />,
      label: t("nav.chats"),
      active: ["home", "chat", "project"].includes(route.view),
      go: () => {
        if (["home", "chat", "project"].includes(route.view)) return sidebar.toggle()
        sidebar.show()
        go({ view: "home" })
      }
    },
    { key: "inbox", icon: <Inbox />, label: t("nav.needsYou"), active: route.view === "inbox", go: () => go({ view: "inbox" }), count: needsYou },
    { key: "agents", icon: <Bot />, label: t("nav.agents"), active: ["agents", "agent", "new-agent"].includes(route.view), go: () => go({ view: "agents" }) },
    { key: "routines", icon: <AlarmClock />, label: t("nav.routines"), active: route.view === "routines", go: () => go({ view: "routines" }) },
    { key: "knowledge", icon: <BookOpen />, label: t("nav.knowledge"), active: route.view === "knowledge", go: () => go({ view: "knowledge" }) }
  ]
  return (
    <nav aria-label={t("nav.label")} className="flex w-15 shrink-0 flex-col items-center gap-1 border-r border-subtle pt-3 pb-3">
      <span className="mb-1 flex size-10 items-center justify-center">
        <Logo className="size-5" />
      </span>
      <RailItem label={sidebar.hidden ? t("nav.showSidebar") : t("nav.hideSidebar")} active={false} onPress={sidebar.toggle}>
        {sidebar.hidden ? <PanelLeftOpen /> : <PanelLeftClose />}
      </RailItem>
      <span aria-hidden="true" className="mb-1 h-px w-6 bg-subtle" />
      {places.map((p) => (
        <RailItem key={p.key} label={p.label} active={p.active} onPress={p.go} count={p.count}>
          {p.icon}
        </RailItem>
      ))}
      <span className="flex-1" />
      <UsageFoot active={route.view === "usage"} />
      {/* Pause everything (running turns stop, new ones and routines wait) or resume. */}
      <RailItem label={paused ? t("pause.resume") : t("pause.all")} active={false} onPress={() => onPause(!paused)}>
        {paused ? <Play className="text-warning" /> : <Pause />}
      </RailItem>
      <RailItem label={t("nav.settings")} active={route.view === "settings"} onPress={() => go({ view: "settings", tab: "general" })}>
        <Settings />
      </RailItem>
    </nav>
  )
}

function RailItem({ label, active, onPress, count, children }: { label: string; active: boolean; onPress: () => void; count?: number | undefined; children: ReactNode }) {
  return (
    <span className="relative">
      {/* The current place's wash slides from the previous one. */}
      {active && <Marker id="rail-current" className="absolute inset-0 rounded-card bg-hover" />}
      <Tooltip content={label} placement="right">
        <IconButton
          label={count ? `${label} (${count})` : label}
          onPress={onPress}
          className={cx("relative size-10 rounded-card [&_svg]:size-5", active ? "text-fg data-hovered:bg-transparent" : "text-muted")}
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

export function Sidebar({ route, activeProjectId }: { route: Route; activeProjectId: string | null }) {
  const projects = useList(projectsAtom)
  const chats = useList(chatsAtom)
  const agents = useList(agentsAtom)
  const statuses = useStatuses()

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
  // More of the list below the fold: the list fades out and the foot draws its hairline (DESIGN.md).
  const listRef = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState(false)
  const measure = () => {
    const el = listRef.current
    if (el) setMore(el.scrollTop + el.clientHeight < el.scrollHeight - 1)
  }
  useLayoutEffect(measure)

  const activeChat = route.view === "chat" ? route.id : undefined
  const groupOf = (projectId: string | null) => byTurn(ordered(chats.filter((c) => c.projectId === projectId), statuses), statuses)
  const loose = groupOf(null) // the chats without a project

  // Right-click menus: a chat (open, rename, delete) or a project (open, new chat in it, delete).
  const removeChat = useMutation(mutations.removeChat)
  const updateChat = useMutation(mutations.updateChat)
  const removeProject = useMutation(mutations.removeProject)
  const [dialog, setDialog] = useState<{ kind: "rename" | "deleteChat"; chat: Chat } | { kind: "deleteProject"; project: Project }>()
  const menuFor = (target: HTMLElement) => {
    const key = target.closest("[role=row]")?.getAttribute("data-key") ?? ""
    const chat = key.startsWith("c:") ? chats.find((c) => c.id === idOf(key)) : undefined
    const project = key.startsWith("p:") ? projects.find((p) => p.id === idOf(key)) : undefined
    if (chat)
      return (
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
    if (project)
      return (
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
    return undefined
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
    // The open chat always stays visible, even past the fold.
    const visible = showAll ? list : list.filter((c, i) => i < VISIBLE || c.id === activeChat)
    const hidden = list.length - visible.length
    const label = showAll ? t("nav.showLess") : t("nav.showMore", { count: hidden })
    return [
      ...visible.map((c) => <ChatItem key={c.id} chat={c} status={statuses[c.id]} active={c.id === activeChat} agents={agents} nested={group !== "loose"} />),
      ...((hidden > 0 || showAll) && list.length > VISIBLE
        ? [<NavTreeItem key="more" id={moreKey(group)} textValue={label} title={<span className="text-muted">{label}</span>} onAction={() => toggleAll(group)} nested={group !== "loose"} />]
        : [])
    ]
  }

  return (
    <nav aria-label={t("nav.chats")} className="flex w-62 shrink-0 flex-col overflow-hidden pt-0 pb-3 pl-2">
      <div className="h-3 shrink-0" />

      {/* Chats (without a project) first, then Projects; each section folds, and the list scrolls under the pages.
          Right-click (or the Menu key) on a chat or a project opens its menu. */}
      <ContextMenu label={t("common.more")} menuFor={menuFor} className="flex min-h-0 flex-1 flex-col">
      <div ref={listRef} onScroll={measure} className={cx("scroll-quiet flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain pr-2.5 pb-2", more && "fade-bottom")}>
        <section className="flex flex-col gap-px">
          <NavLabel
            expanded={!collapsed.has("chats")}
            onToggle={() => flip("chats")}
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
              <p className="py-1 pl-2.5 text-sm text-muted">{t("nav.noChats")}</p>
            )}
          </Fold>
        </section>

        <section className="flex flex-col gap-px">
          <NavLabel expanded={!collapsed.has("projects")} onToggle={() => flip("projects")} action={<NewProjectButton />}>
            {t("nav.projects")}
          </NavLabel>
          <Fold open={!collapsed.has("projects")}>
            <NavTree label={t("nav.projects")} expandedKeys={expandedKeys} onExpandedChange={onExpandedChange} dragAndDropHooks={projectDnd}>
              {projects.map((p) => {
                const list = groupOf(p.id)
                return (
                  <ProjectItem key={p.id} project={p} active={(route.view === "project" && route.id === p.id) || (route.view === "home" && route.projectId === p.id)} chats={list} statuses={statuses} onToggle={() => toggle(p.id)}>
                    {chatItems(p.id, list)}
                  </ProjectItem>
                )
              })}
            </NavTree>
          </Fold>
        </section>
      </div>

      </ContextMenu>

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

const lastActivity = (c: Chat, statuses: Statuses) => Math.max(c.createdAt, c.lastAt ?? 0, statuses[c.id]?.updatedAt ?? 0)

// A group's chats: the ones never placed by hand first (newest activity on top), then the placed ones in
// their manual order.
const ordered = (chats: ReadonlyArray<Chat>, statuses: Statuses) => [
  ...chats.filter((c) => c.position === null).sort((a, b) => lastActivity(b, statuses) - lastActivity(a, statuses)),
  ...chats.filter((c) => c.position !== null).sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
]
// Whose turn it is comes first: waiting for you, then working, then the rest (each keeps the order above).
const rank = (s: ChatStatus | undefined) => (s?.state === "waiting" ? 0 : s?.state === "running" ? 1 : 2)
const byTurn = (chats: ReadonlyArray<Chat>, statuses: Statuses) => [...chats].sort((a, b) => rank(statuses[a.id]) - rank(statuses[b.id]))

const Count = ({ n }: { n: number }) => (
  <span className="flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-semibold text-on-accent tabular-nums">{n}</span>
)

// A project: one line. Waiting for you → a dot; working → a spinner; nothing otherwise.
function ProjectItem({
  project,
  active,
  chats,
  statuses,
  onToggle,
  children
}: {
  project: Project
  active: boolean
  chats: ReadonlyArray<Chat>
  statuses: Statuses
  onToggle: () => void
  children: ReactNode
}) {
  const waiting = chats.some((c) => statuses[c.id]?.state === "waiting")
  const running = !waiting && chats.some((c) => statuses[c.id]?.state === "running")
  return (
    <NavTreeItem
      id={projectKey(project.id)}
      textValue={project.name}
      active={active}
      title={project.name}
      dragLabel={t("nav.reorder", { name: project.name })}
      onAction={onToggle}
      trailing={
        waiting ? (
          <span role="img" aria-label={t("nav.waitingIn", { count: 1 })} className="size-2 rounded-full bg-accent-text" />
        ) : running ? (
          <Spinner size={11} className="text-success" label={t("nav.runningIn", { count: 1 })} />
        ) : chats.length ? (
          // Closed or open, how many chats it holds (quiet).
          <span className="text-dim">{chats.length}</span>
        ) : undefined
      }
      actions={
        <>
          <IconButton label={t("nav.projectSettings", { name: project.name })} size="xs" onPress={() => go({ view: "project", id: project.id, tab: "overview" })}>
            <Settings className="size-3.5" />
          </IconButton>
          <IconButton label={t("nav.newChatIn", { name: project.name })} size="xs" onPress={() => go({ view: "home", projectId: project.id })}>
            <Plus className="size-3.5" />
          </IconButton>
        </>
      }
    >
      {children}
    </NavTreeItem>
  )
}

// A chat on one 32px line: the lead's avatar (or the model's logo) in the icon column, the title, and on the
// right what matters now: a spinner while it runs, a blue dot when it waits for you, a red one when the last
// turn failed, otherwise how long ago it last moved. The status in words is in the row's accessible name.
// A chat: two lines, no icon. The title and when it last moved (or a spinner while it works); under it who is in
// it (small avatars and names) or, while something happens, what (working, waits for you, failed). A chat with no
// agent shows its model instead.
function ChatItem({ chat, status, active, agents, nested = false }: { chat: Chat; status: ChatStatus | undefined; active: boolean; agents: ReadonlyArray<Agent>; nested?: boolean }) {
  const live = status && status.state !== "idle" ? status : undefined
  const members = chat.agentIds.flatMap((id) => agents.filter((a) => a.id === id))
  const at = Math.max(chat.lastAt ?? chat.createdAt, status?.updatedAt ?? 0)
  const said = live ? statusLabel(live, agents) : undefined
  const names = members.length > 2 ? `${members.slice(0, 2).map((a) => a.name).join(", ")} +${members.length - 2}` : members.map((a) => a.name).join(", ")
  return (
    <NavTreeItem
      id={chatKey(chat.id)}
      textValue={[chatTitle(chat), said ?? names].filter(Boolean).join(", ")}
      active={active}
      strong={live?.state === "waiting"}
      title={chatTitle(chat)}
      trailing={
        live?.state === "running" ? (
          <Spinner size={11} className="text-success" label={said ?? ""} />
        ) : !members.length && (live?.state === "waiting" || live?.state === "failed") ? (
          // One line (no agents): the state is a dot by the title.
          <span role="img" aria-label={said} className={cx("size-2 rounded-full", live.state === "waiting" ? "bg-accent-text" : "bg-danger")} />
        ) : (
          formatAge(at)
        )
      }
      // The second line only when agents are in it: who, or what is happening now.
      detail={
        !members.length ? undefined : live ? (
          <span className={cx("truncate", live.state === "waiting" ? "text-accent-text" : live.state === "failed" ? "text-danger" : "text-muted")}>{said}</span>
        ) : (
          <>
            <span className="flex shrink-0 items-center">
              {members.slice(0, 3).map((a, i) => (
                <AgentAvatar key={a.id} id={a.id} name={a.name} tone={agentTone(a, agents)} size={16} className={cx("ring-2 ring-frame", i > 0 && "-ml-1")} />
              ))}
            </span>
            <span className="truncate">{names}</span>
          </>
        )
      }
      nested={nested}
      dragLabel={t("nav.reorder", { name: chatTitle(chat) })}
      onAction={() => go({ view: "chat", id: chat.id })}
    />
  )
}

// The subscriptions at the foot (the most at risk first, up to three side by side): each a ring of its limit windows
// (concentric, around its logo) with its own hover card, opening Usage when pressed. Hovering (or focusing) shows the rest: every window with when it
// resets, the account's windows as rings (ui/limit-ring.tsx) and where the pace so far leads.
const MAX_FOOT_ROWS = 3
const TONE_TEXT = { ok: "text-secondary", warning: "text-warning", critical: "text-danger" } as const
function UsageFoot({ active }: { active: boolean }) {
  const rows = useList(accountsAtom)
    .filter((a) => a.kind === "subscription")
    .flatMap((a) => {
      const windows = (a.usage?.windows ?? []).map((w) => ({ w, pace: paceOf(w) }))
      const worst = windows.filter((x) => windowMinutes(x.w.id) !== null).sort((x, y) => y.pace.risk - x.pace.risk)[0]
      return worst ? [{ account: a, windows, ...worst }] : []
    })
    .sort((x, y) => y.pace.risk - x.pace.risk)
  const sentence = (r: (typeof rows)[number]) => {
    const window = windowLabel(r.w.id)
    return r.pace.runsOutAt
      ? t("nav.usageOut", { account: r.account.label, window, time: formatTime(r.pace.runsOutAt) })
      : t("nav.usageUsed", { account: r.account.label, window, percent: formatPercent(r.pace.used) })
  }
  if (!rows.length)
    return (
      <RailItem label={t("nav.usage")} active={active} onPress={() => go({ view: "usage" })}>
        <ChartColumn />
      </RailItem>
    )
  // One ring per subscription, stacked in the rail: each has its own card on hover or focus and opens Usage.
  return (
    <div className="flex flex-col items-center gap-1">
      {rows.slice(0, MAX_FOOT_ROWS).map((r) => (
        <Tooltip key={r.account.id} content={<UsageDetail rows={[r]} />} placement="right">
          <Button
            variant="ghost"
            shape="pill"
            aria-label={`${t("nav.usage")}: ${sentence(r)}`}
            onPress={() => go({ view: "usage" })}
            className={cx("size-10 p-0 text-fg data-hovered:text-fg", active && "ring-1 ring-strong")}
          >
            <LimitRing
              size={34}
              windows={r.windows
                .filter(({ w }) => windowMinutes(w.id) !== null)
                .sort((x, y) => (windowMinutes(y.w.id) ?? 0) - (windowMinutes(x.w.id) ?? 0))
                .map(({ pace }) => ({ used: pace.used, tone: toneOf(pace) }))}
            >
              <ProviderIcon provider={r.account.provider} size={13} />
            </LimitRing>
          </Button>
        </Tooltip>
      ))}
    </div>
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

// The desktop app's title bar (as in OpenBot): the whole window width above the rail, the sidebar and the card. It
// drags the window, leaves room for the macOS window buttons, holds back/forward and the current page's header.
// The brand stays on the rail.
export function TitleBar({ sidebarHidden }: { sidebarHidden: boolean }) {
  return (
    <header className="app-drag flex h-12 shrink-0 items-center">
      {/* Left: the window buttons and back/forward, as wide as the rail plus the sidebar so the page header starts
          on the card's edge. With the sidebar hidden the window buttons own that corner: the header follows them. */}
      <Width width={sidebarHidden ? "auto" : 308} className="flex shrink-0 items-center gap-0.5 overflow-hidden pl-24">
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
