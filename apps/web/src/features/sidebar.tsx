// Sidebar: the brand (the title bar in the desktop app), Needs you, then icon tabs (the selected one shows its
// name): Chats and Projects switch the list below, Knowledge and Settings open their page. At the foot, the
// subscriptions' pace (it opens Usage). Chats lists every chat, whose turn it is first (waiting for
// you, then working), then the latest activity. Projects is the tree: one line per project (a dot or a spinner is
// all its state), its chats under it; projects reorder by drag and drop, chats only inside their own project. A
// chat row shows who is in it and what is happening; the open chat floats as a raised chip.
import { type Agent, type Chat, LIMIT_ALERT, type Project } from "@zero/contracts"
import type { ChatStatus } from "@zero/contracts/events"
import { formatAge, formatPercent, formatTime, locale, t } from "@zero/i18n"
import { type ReactNode, useState } from "react"
import { accountsAtom, agentsAtom, approvalsAtom, chatsAtom, memoriesAtom, mutations, projectsAtom, useList, useMutation, useStatuses } from "../client.ts"
import { agentTone, chatTitle, splitModel, statusLabel, type Pace, paceOf, windowLabel, windowMinutes } from "../labels.ts"
import { NewProjectButton } from "./project.tsx"
import { go, readSet, type Route, writeSet } from "../state.ts"
import {
  AgentAvatar, BookOpen, ChartColumn, cx, Folder, IconButton, Inbox, Logo, MessageCircle, ModelAvatar, NavItem, NavTab, NavTree, NavTreeItem, type NavKey, Plus, ProviderIcon, PaceBar, type PaceTone, Settings, Spinner, Tooltip, useNavReorder
} from "@/ui"

const VISIBLE = 5
const EXPANDED_KEY = "zero.sidebar.expanded"
const TAB_KEY = "zero.sidebar.tab" // holds "projects" when that tab was the last one open
type Tab = "chats" | "projects"
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

  // Chats or Projects; the last one open is remembered on this computer.
  const [tab, setTab] = useState<Tab>(() => (readSet(TAB_KEY).has("projects") ? "projects" : "chats"))
  const pick = (next: Tab) => {
    setTab(next)
    writeSet(TAB_KEY, new Set([next]))
    if (page) go({ view: "home" })
  }
  // Knowledge and Settings are tabs that open a page; while one is open its tab is the selected one.
  const page = route.view === "knowledge" || route.view === "settings" ? route.view : undefined

  const activeChat = route.view === "chat" ? route.id : undefined
  const groupOf = (projectId: string | null) => byTurn(ordered(chats.filter((c) => c.projectId === projectId), statuses), statuses)
  // The Chats tab: every chat, whose turn it is first, then the latest activity.
  const recent = byTurn([...chats].sort((a, b) => lastActivity(b, statuses) - lastActivity(a, statuses)), statuses)

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
      <div className="brand-row electrobun-webkit-app-region-drag mb-4.5 flex h-7 shrink-0 items-center gap-2 px-2.5">
        <Logo className="size-5" />
        <span className="font-semibold">{t("app.name")}</span>
      </div>

      {/* What waits for you comes first, and stays put while the trees scroll. */}
      <div className="mb-4.5 flex shrink-0 flex-col gap-px pr-2.5">
        <NavItem icon={<Inbox />} active={route.view === "inbox"} onPress={() => go({ view: "inbox" })} trailing={needsYou > 0 && <Count n={needsYou} />}>
          {t("nav.needsYou")}
        </NavItem>
      </div>

      {/* Icon tabs (names in tooltips) switch the list below; the action at the end creates in the open one. */}
      <div className="mb-1.5 flex shrink-0 items-center gap-0.5 pr-2.5">
        <NavTab label={t("nav.chats")} icon={<MessageCircle />} active={!page && tab === "chats"} onPress={() => pick("chats")} />
        <NavTab label={t("nav.projects")} icon={<Folder />} active={!page && tab === "projects"} onPress={() => pick("projects")} />
        <NavTab label={t("nav.knowledge")} icon={<BookOpen />} active={page === "knowledge"} onPress={() => go({ view: "knowledge" })} />
        <NavTab label={t("nav.settings")} icon={<Settings />} active={page === "settings"} onPress={() => go({ view: "settings", tab: "providers" })} />
        <span className="flex-1" />
        {tab === "projects" ? (
          <NewProjectButton />
        ) : (
          <Tooltip content={t("nav.newChat")}>
            <IconButton label={t("nav.newChat")} size="sm" onPress={() => go({ view: "home" })}>
              <Plus className="size-3.5" />
            </IconButton>
          </Tooltip>
        )}
      </div>

      <div className="scroll-quiet flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain pr-2.5 pb-2">
        {tab === "chats" ? (
          recent.length ? (
            <NavTree key="chats" label={t("nav.chats")}>{chatItems("recent", recent)}</NavTree>
          ) : (
            <p className="px-2.5 py-2 text-sm text-muted">{t("nav.noChats")}</p>
          )
        ) : (
          <NavTree key="projects" label={t("nav.projects")} expandedKeys={expandedKeys} onExpandedChange={onExpandedChange} dragAndDropHooks={projectDnd}>
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
      </div>

      {/* The subscriptions' pace at the foot; it opens Usage. */}
      <div className="mr-2.5 shrink-0 border-t border-subtle pt-2">
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

// A chat across the sidebar's width: the lead's avatar (or the model's logo), the title and when it last moved,
// then, when more than one agent is in it, every member as a small overlapping avatar (the one acting first),
// and what is happening now (blue when it waits for you) or, when nothing runs, the start of the last message.
function ChatItem({ chat, status, active, agents }: { chat: Chat; status: ChatStatus | undefined; active: boolean; agents: ReadonlyArray<Agent> }) {
  const live = status && status.state !== "idle" ? status : undefined
  const lead = agents.find((a) => a.id === (live?.agentId ?? chat.agentIds[0]))
  const at = Math.max(chat.lastAt ?? chat.createdAt, status?.updatedAt ?? 0)
  const team = chat.agentIds.flatMap((id) => agents.find((a) => a.id === id) ?? [])
  const members = lead ? [lead, ...team.filter((a) => a.id !== lead.id)] : team
  return (
    <NavTreeItem
      id={chatKey(chat.id)}
      textValue={chatTitle(chat)}
      active={active}
      strong={live?.state === "waiting"}
      leading={lead ? <AgentAvatar id={lead.id} name={lead.name} tone={agentTone(lead, agents)} size={32} /> : <ModelAvatar provider={splitModel(chat.model).provider} size={32} />}
      title={chatTitle(chat)}
      trailing={formatAge(at)}
      dragLabel={t("nav.reorder", { name: chatTitle(chat) })}
      onAction={() => go({ view: "chat", id: chat.id })}
      detail={
        <>
          {members.length > 1 && (
            <span role="img" aria-label={members.map((a) => a.name).join(", ")} className="flex shrink-0 items-center pl-1">
              {members.map((a) => (
                <AgentAvatar key={a.id} id={a.id} name={a.name} tone={agentTone(a, agents)} size={16} className={cx("-ml-1 rounded-full ring-2", active ? "ring-surface" : "ring-frame")} />
              ))}
            </span>
          )}
          {live ? (
            <span className={cx("flex min-w-0 items-center gap-1.5", live.state === "waiting" ? "text-accent-text" : live.state === "failed" ? "text-danger" : "text-muted")}>
              {live.state === "running" && <Spinner size={10} className="shrink-0 text-success" />}
              <span className="truncate">{statusLabel(live, agents)}</span>
            </span>
          ) : (
            <span className="truncate">{chat.preview ?? t("nav.noMessages")}</span>
          )}
        </>
      }
    />
  )
}

// An icon button of the foot toolbar; the open screen's stays lit.
// The subscriptions at the foot, one line each (the most at risk first): the logo, the window most at risk, a
// pace bar (fill = used, tick = time gone in the window) and, on the right, the share used or, when the burn so
// far would empty the window before it resets, about when it runs out. Without a reading: Usage, plainly.
const MAX_FOOT_ROWS = 3
function UsageFoot({ active }: { active: boolean }) {
  const rows = useList(accountsAtom)
    .filter((a) => a.kind === "subscription")
    .flatMap((a) => {
      const windows = (a.usage?.windows ?? []).filter((w) => windowMinutes(w.id) !== null).map((w) => ({ w, pace: paceOf(w) }))
      const worst = windows.sort((x, y) => y.pace.risk - x.pace.risk)[0]
      return worst ? [{ account: a, ...worst }] : []
    })
    .sort((x, y) => y.pace.risk - x.pace.risk)
  const sentence = (r: (typeof rows)[number]) => {
    const window = windowLabel(r.w.id)
    return r.pace.runsOutAt
      ? t("nav.usageOut", { account: r.account.label, window, time: formatTime(r.pace.runsOutAt) })
      : t("nav.usageUsed", { account: r.account.label, window, percent: formatPercent(r.pace.used) })
  }
  const label = rows.length ? `${t("nav.usage")}: ${rows.map(sentence).join("; ")}` : t("nav.usage")
  return (
    <NavItem active={active} onPress={() => go({ view: "usage" })} aria-label={label} {...(!rows.length && { icon: <ChartColumn /> })} className={cx(rows.length > 0 && "h-auto py-2")}>
      {rows.length ? (
        <span className="flex min-w-0 flex-1 flex-col gap-2">
          {rows.slice(0, MAX_FOOT_ROWS).map((r) => {
            const tone = toneOf(r.pace)
            return (
              <span key={r.account.id} className="flex min-w-0 items-center gap-2 text-xs">
                <ProviderIcon provider={r.account.provider} size={14} />
                <span className="w-12 shrink-0 truncate text-muted">{windowLabel(r.w.id)}</span>
                <PaceBar used={r.pace.used} elapsed={r.pace.elapsed} tone={tone} className="min-w-0 flex-1" />
                <span className={cx("w-11 shrink-0 text-right tabular-nums", tone === "critical" ? "text-danger" : tone === "warning" ? "text-warning" : "text-secondary")}>
                  {r.pace.runsOutAt ? `~${formatClock(r.pace.runsOutAt)}` : formatPercent(r.pace.used)}
                </span>
              </span>
            )
          })}
        </span>
      ) : (
        t("nav.usage")
      )}
    </NavItem>
  )
}

const toneOf = (p: Pace): PaceTone => (p.used >= 0.95 ? "critical" : p.runsOutAt || p.used >= LIMIT_ALERT ? "warning" : "ok")
// Hours and minutes only (the row is narrow; the label has the full time).
const formatClock = (at: number) => new Intl.DateTimeFormat(locale(), { hour: "numeric", minute: "2-digit" }).format(at)
