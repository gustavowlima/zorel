// Sidebar: the brand (the title bar in the desktop app), Needs you, then icon tabs (Chats, Projects; names in
// tooltips) that switch the list, and a toolbar at the foot (new chat, knowledge, usage with the fullest limit
// window, settings). Chats lists every chat, whose turn it is first (waiting for you, then working), then the
// latest activity. Projects is the tree: one line per project (a dot or a spinner is all its state), its chats
// under it; projects reorder by drag and drop, chats only inside their own project. A chat row shows who is in it
// and what is happening; the open chat floats as a raised chip. Statuses come from the live stream.
import { type Agent, type Chat, LIMIT_ALERT, type Project } from "@zero/contracts"
import type { ChatStatus } from "@zero/contracts/events"
import { formatAge, formatPercent, t } from "@zero/i18n"
import { type ReactNode, useState } from "react"
import { accountsAtom, agentsAtom, approvalsAtom, chatsAtom, memoriesAtom, mutations, projectsAtom, useList, useMutation, useStatuses } from "../client.ts"
import { agentTone, chatTitle, splitModel, statusLabel, windowLabel } from "../labels.ts"
import { NewProjectButton } from "./project.tsx"
import { go, readSet, type Route, writeSet } from "../state.ts"
import {
  AgentAvatar, BookOpen, ChartColumn, cx, Folder, IconButton, Inbox, Logo, MessageCircle, ModelAvatar, NavItem, NavTree, NavTreeItem, type NavKey, Plus, Settings, Spinner,
  SquarePen, Tooltip, useNavReorder
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
  }

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
        <FootButton label={t("nav.chats")} active={tab === "chats"} onPress={() => pick("chats")}>
          <MessageCircle />
        </FootButton>
        <FootButton label={t("nav.projects")} active={tab === "projects"} onPress={() => pick("projects")}>
          <Folder />
        </FootButton>
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

      {/* Tools at the foot */}
      <div className="mr-2.5 flex shrink-0 items-center gap-0.5 border-t border-subtle pt-2.5">
        <FootButton label={t("nav.newChat")} active={route.view === "home" && !route.projectId} onPress={() => go({ view: "home" })}>
          <SquarePen />
        </FootButton>
        <FootButton label={t("nav.knowledge")} active={route.view === "knowledge"} onPress={() => go({ view: "knowledge" })}>
          <BookOpen />
        </FootButton>
        <UsageButton active={route.view === "usage"} />
        <span className="flex-1" />
        <FootButton label={t("nav.settings")} active={route.view === "settings"} onPress={() => go({ view: "settings", tab: "providers" })}>
          <Settings />
        </FootButton>
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
function FootButton({ label, active, onPress, children }: { label: string; active: boolean; onPress: () => void; children: ReactNode }) {
  return (
    <Tooltip content={label}>
      <IconButton label={label} onPress={onPress} className={cx(active && "bg-hover text-fg")} {...(active && { "aria-current": "page" as const })}>
        {children}
      </IconButton>
    </Tooltip>
  )
}

// Usage, with the fullest limit window next to it; warning from 80%. Its label names the account and window.
function UsageButton({ active }: { active: boolean }) {
  const worst = useList(accountsAtom)
    .filter((a) => a.kind === "subscription")
    .flatMap((a) => (a.usage?.windows ?? []).map((w) => ({ account: a.label, window: windowLabel(w.id), used: w.usedPercent / 100 })))
    .sort((a, b) => b.used - a.used)[0]
  const detail = worst && t("nav.usageAlert", { account: worst.account, window: worst.window, percent: formatPercent(worst.used) })
  const label = detail ? `${t("nav.usage")}: ${detail}` : t("nav.usage")
  return (
    <Tooltip content={label}>
      <IconButton
        label={label}
        onPress={() => go({ view: "usage" })}
        className={cx("h-control-sm w-auto gap-1.5 px-2 text-sm", active && "bg-hover text-fg", worst && worst.used >= LIMIT_ALERT && "text-warning")}
        {...(active && { "aria-current": "page" as const })}
      >
        <ChartColumn />
        {worst && <span className="tabular-nums">{formatPercent(worst.used)}</span>}
      </IconButton>
    </Tooltip>
  )
}
