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
import { agentTone, chatTitle, splitModel, statusLabel, type Pace, paceOf, windowLabel, windowMinutes, windowShort } from "../labels.ts"
import { NewProjectButton } from "./project.tsx"
import { go, readSet, type Route, writeSet } from "../state.ts"
import {
  AgentAvatar, BookOpen, ChartColumn, cx, Folder, IconButton, Inbox, Logo, MessageCircle, ModelAvatar, NavItem, NavLabel, NavTree, NavTreeItem, type NavKey, Plus, ProviderIcon, BurnDown, type BurnTone, Settings, Spinner, Tooltip, useNavReorder
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

export function Sidebar({ route, activeProjectId }: { route: Route; activeProjectId: string | null }) {
  const projects = useList(projectsAtom)
  const chats = useList(chatsAtom)
  const agents = useList(agentsAtom)
  const memories = useList(memoriesAtom)
  const approvals = useList(approvalsAtom)
  const statuses = useStatuses()
  const needsYou = approvals.length + memories.filter((m) => m.state === "pending").length

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
      ...visible.map((c) => <ChatItem key={c.id} chat={c} status={statuses[c.id]} active={c.id === activeChat} agents={agents} />),
      ...((hidden > 0 || showAll) && list.length > VISIBLE
        ? [<NavTreeItem key="more" id={moreKey(group)} textValue={label} title={<span className="text-muted">{label}</span>} onAction={() => toggleAll(group)} />]
        : [])
    ]
  }

  return (
    <nav aria-label={t("nav.label")} className="flex w-66 shrink-0 flex-col overflow-hidden pt-3 pb-3 pl-2.5">
      {/* The brand; in the desktop app it is also the title bar (it drags the window, the window buttons sit on its left). */}
      <div className="brand-row electrobun-webkit-app-region-drag mb-3 flex h-7 shrink-0 items-center gap-2.5 pr-2.5 pl-2.5">
        <Logo className="size-5 shrink-0" />
        <span className="flex-1 font-semibold">{t("app.name")}</span>
        {/* Settings sits on the brand row, out of the way of the pages. */}
        <span className="electrobun-webkit-app-region-no-drag">
          <Tooltip content={t("nav.settings")}>
            <IconButton
              label={t("nav.settings")}
              size="sm"
              onPress={() => go({ view: "settings", tab: "general" })}
              className={cx(route.view === "settings" && "bg-hover text-fg")}
              {...(route.view === "settings" && { "aria-current": "page" as const })}
            >
              <Settings className="size-4" />
            </IconButton>
          </Tooltip>
        </span>
      </div>

      {/* The pages, fixed: what waits for you first, then Knowledge. One 20px icon column (x20-40),
          text from x50, shared by every row of the sidebar. */}
      <div className="mb-3 flex shrink-0 flex-col gap-px pr-2.5">
        <NavItem icon={<Inbox />} active={route.view === "inbox"} onPress={() => go({ view: "inbox" })} trailing={needsYou > 0 && <Count n={needsYou} />}>
          {t("nav.needsYou")}
        </NavItem>
        <NavItem icon={<BookOpen />} active={route.view === "knowledge"} onPress={() => go({ view: "knowledge" })}>
          {t("nav.knowledge")}
        </NavItem>
      </div>

      {/* Chats (without a project) first, then Projects; each section folds, and the list scrolls under the pages. */}
      <div ref={listRef} onScroll={measure} className={cx("scroll-quiet flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain pr-2.5 pb-2", more && "fade-bottom")}>
        <section className="flex flex-col gap-px">
          <NavLabel
            icon={<MessageCircle />}
            expanded={!collapsed.has("chats")}
            onToggle={() => flip("chats")}
            action={
              <Tooltip content={t("nav.newChat")}>
                <IconButton label={t("nav.newChat")} size="sm" onPress={() => go({ view: "home" })}>
                  <Plus className="size-3.5" />
                </IconButton>
              </Tooltip>
            }
          >
            {t("nav.chats")}
          </NavLabel>
          {!collapsed.has("chats") &&
            (loose.length ? (
              <NavTree label={t("nav.chats")} dragAndDropHooks={looseDnd}>
                {chatItems("loose", loose)}
              </NavTree>
            ) : (
              <p className="py-1 pl-12.5 text-sm text-muted">{t("nav.noChats")}</p>
            ))}
        </section>

        <section className="flex flex-col gap-px">
          <NavLabel icon={<Folder />} expanded={!collapsed.has("projects")} onToggle={() => flip("projects")} action={<NewProjectButton />}>
            {t("nav.projects")}
          </NavLabel>
          {!collapsed.has("projects") && (
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
          )}
        </section>
      </div>

      {/* The subscriptions' pace at the foot; it opens Usage. */}
      <div className={cx("mr-2.5 shrink-0 border-t pt-2 transition-colors duration-150", more ? "border-subtle" : "border-transparent")}>
        <UsageFoot active={route.view === "usage"} />
      </div>
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
        ) : undefined
      }
      actions={
        <>
          <IconButton label={t("nav.projectSettings", { name: project.name })} size="sm" onPress={() => go({ view: "project", id: project.id, tab: "overview" })}>
            <Settings className="size-3.5" />
          </IconButton>
          <IconButton label={t("nav.newChatIn", { name: project.name })} size="sm" onPress={() => go({ view: "home", projectId: project.id })}>
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
function ChatItem({ chat, status, active, agents }: { chat: Chat; status: ChatStatus | undefined; active: boolean; agents: ReadonlyArray<Agent> }) {
  const live = status && status.state !== "idle" ? status : undefined
  const lead = agents.find((a) => a.id === (live?.agentId ?? chat.agentIds[0]))
  const at = Math.max(chat.lastAt ?? chat.createdAt, status?.updatedAt ?? 0)
  const said = live ? statusLabel(live, agents) : undefined
  return (
    <NavTreeItem
      id={chatKey(chat.id)}
      textValue={said ? `${chatTitle(chat)}, ${said}` : chatTitle(chat)}
      active={active}
      strong={live?.state === "waiting"}
      leading={lead ? <AgentAvatar id={lead.id} name={lead.name} tone={agentTone(lead, agents)} size={20} /> : <ModelAvatar provider={splitModel(chat.model).provider} size={20} />}
      title={chatTitle(chat)}
      trailing={
        live?.state === "running" ? (
          <Spinner size={11} className="text-success" label={said ?? ""} />
        ) : live?.state === "waiting" || live?.state === "failed" ? (
          <span role="img" aria-label={said} className={cx("size-2 rounded-full", live.state === "waiting" ? "bg-accent-text" : "bg-danger")} />
        ) : (
          formatAge(at)
        )
      }
      dragLabel={t("nav.reorder", { name: chatTitle(chat) })}
      onAction={() => go({ view: "chat", id: chat.id })}
    />
  )
}

// The subscriptions at the foot (the most at risk first): one line per limit window, shortest first ("5h", "7d",
// "30d"), each a bar of the share used and that share, grouped by account: the logo in the icon column, centred on its bars. Hovering (or focusing) shows the rest: every window with when it
// resets, and the one at risk as a tiny burn-down (ui/burn-down.tsx) with where the pace so far leads.
const MAX_FOOT_ROWS = 3
const TONE_TEXT = { ok: "text-secondary", warning: "text-warning", critical: "text-danger" } as const
const TONE_BG = { ok: "bg-success", warning: "bg-warning", critical: "bg-danger" } as const
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
  const label = rows.length ? `${t("nav.usage")}: ${rows.map(sentence).join("; ")}` : t("nav.usage")
  if (!rows.length)
    return (
      <NavItem active={active} onPress={() => go({ view: "usage" })} icon={<ChartColumn />}>
        {t("nav.usage")}
      </NavItem>
    )
  return (
    <Tooltip content={<UsageDetail rows={rows} />}>
      <NavItem active={active} onPress={() => go({ view: "usage" })} aria-label={label} className="h-auto py-2">
        <span className="flex min-w-0 flex-1 flex-col gap-3">
          {rows.slice(0, MAX_FOOT_ROWS).map((r) => (
            // One group per account: its logo in the icon column, centred on the bars of its windows.
            <span key={r.account.id} className="flex min-w-0 items-center gap-2.5 text-xs">
              <span className="flex size-5 shrink-0 items-center justify-center">
                <ProviderIcon provider={r.account.provider} size={16} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                {r.windows
                  .filter(({ w }) => windowMinutes(w.id) !== null)
                  .sort((x, y) => (windowMinutes(x.w.id) ?? 0) - (windowMinutes(y.w.id) ?? 0))
                  .map(({ w, pace }) => {
                    const tone = toneOf(pace)
                    return (
                      <span key={w.id} className="flex min-w-0 items-center gap-2.5">
                        <span className="w-7 shrink-0 text-muted tabular-nums">{windowShort(w.id)}</span>
                        <span className="relative h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-control">
                          <span
                            className={cx("absolute inset-0 origin-left rounded-full transition-transform duration-500 ease-out motion-reduce:transition-none", TONE_BG[tone])}
                            style={{ transform: `scaleX(${Math.min(1, pace.used)})` }}
                          />
                        </span>
                        <span className={cx("w-9 shrink-0 text-right tabular-nums", TONE_TEXT[tone])}>{formatPercent(pace.used)}</span>
                      </span>
                    )
                  })}
              </span>
            </span>
          ))}
        </span>
      </NavItem>
    </Tooltip>
  )
}

// The hover card: per account, every window (share used, when it resets) and, for the one at risk, its burn-down
// and where the pace so far leads.
function UsageDetail({ rows }: { rows: ReadonlyArray<{ account: ProviderAccount; windows: ReadonlyArray<{ w: AccountWindow; pace: Pace }>; w: AccountWindow; pace: Pace }> }) {
  return (
    <span className="flex w-64 flex-col gap-3 py-0.5">
      {rows.map((r) => {
        const tone = toneOf(r.pace)
        const leftAtReset = r.pace.elapsed && r.pace.elapsed >= 0.1 ? 1 - r.pace.used / r.pace.elapsed : null
        return (
          <span key={r.account.id} className="flex flex-col gap-1.5">
            <span className="flex items-center gap-2 font-medium text-fg">
              <ProviderIcon provider={r.account.provider} size={14} />
              {r.account.label}
            </span>
            <BurnDown used={r.pace.used} elapsed={r.pace.elapsed} tone={tone} className="text-fg" />
            <span className={cx("text-xs", TONE_TEXT[tone])}>
              {r.pace.runsOutAt
                ? t("nav.usageRunsOut", { window: windowLabel(r.w.id), time: formatTime(r.pace.runsOutAt) })
                : leftAtReset !== null
                  ? t("nav.usageOnPace", { window: windowLabel(r.w.id), percent: formatPercent(leftAtReset) })
                  : t("nav.usageEarly", { window: windowLabel(r.w.id), percent: formatPercent(r.pace.used) })}
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

const toneOf = (p: Pace): BurnTone => (p.used >= 0.95 ? "critical" : p.runsOutAt || p.used >= LIMIT_ALERT ? "warning" : "ok")
