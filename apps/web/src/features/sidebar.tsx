// Sidebar (prototype "Sidebar"): Needs you / Knowledge / Usage, then projects as a tree with their chats
// (live status under the title), General for chats without a project, the agents of the open project,
// and Settings at the bottom. Like a desktop sidebar, the brand, the top rows and Settings stay put and only
// the tree scrolls, with no visible bar: a hairline marks an edge while content is hidden past it.
// Statuses come from the live stream; everything else from the atoms.
import { type Agent, type Chat, LIMIT_ALERT, type Project } from "@zero/contracts"
import type { ChatStatus } from "@zero/contracts/events"
import { formatAge, formatPercent, t } from "@zero/i18n"
import { type ReactNode, type UIEvent, useLayoutEffect, useRef, useState } from "react"
import { accountsAtom, agentsAtom, approvalsAtom, chatsAtom, memoriesAtom, projectsAtom, useList, useStatuses } from "../client.ts"
import { agentTone, chatTitle, modelName, statusLabel, windowLabel } from "../labels.ts"
import { NewProjectButton } from "./project.tsx"
import { go, readSet, type Route, writeSet } from "../state.ts"
import {
  AgentAvatar, BookOpen, ChartColumn, ChatStatusIcon, ChevronDown, ChevronRight, cx, Folder, FolderOpen, GroupRow, IconButton, Inbox, MessageCircle, NavItem, NavLabel, Plus,
  Settings, SquarePen, TreeItem
} from "@/ui"

const VISIBLE = 5
const EXPANDED_KEY = "zero.sidebar.expanded"

export function Sidebar({ route, activeProjectId }: { route: Route; activeProjectId: string | null }) {
  const projects = useList(projectsAtom)
  const chats = useList(chatsAtom)
  const agents = useList(agentsAtom)
  const memories = useList(memoriesAtom)
  const approvals = useList(approvalsAtom)
  const statuses = useStatuses()
  const needsYou = approvals.length + memories.filter((m) => m.state === "pending").length

  const [expanded, setExpanded] = useState(() => readSet(EXPANDED_KEY))
  const toggle = (id: string) => {
    const next = new Set(expanded)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setExpanded(next)
    writeSet(EXPANDED_KEY, next)
  }
  const isOpen = (id: string) => expanded.has(id) || id === activeProjectId

  const byNewest = [...chats].sort((a, b) => lastActivity(b, statuses) - lastActivity(a, statuses))
  const general = byNewest.filter((c) => !c.projectId)
  const activeChat = route.view === "chat" ? route.id : undefined
  const teamProject = projects.find((p) => p.id === activeProjectId)
  const team = agents.filter((a) => a.projectId === (teamProject?.id ?? null))
  const { tree, edges, onScroll } = useScrollEdges()

  return (
    <nav aria-label={t("nav.label")} className="flex w-62 shrink-0 flex-col overflow-hidden pt-4 pb-3">
      <div className="mb-3 flex h-control shrink-0 items-center gap-2.5 px-5">
        <span aria-hidden="true" className="flex size-6 items-center justify-center rounded-control bg-fg text-sm font-semibold text-frame">
          Z
        </span>
        <span className="flex-1 text-lg font-semibold">{t("app.name")}</span>
        <IconButton label={t("nav.newChat")} onPress={() => go({ view: "home" })}>
          <SquarePen />
        </IconButton>
      </div>

      <div className={cx("flex shrink-0 flex-col gap-0.5 border-b px-3 pb-1 transition-colors duration-120", edges.top ? "border-subtle" : "border-transparent")}>
        <NavItem icon={<Inbox />} active={route.view === "inbox"} onPress={() => go({ view: "inbox" })} trailing={needsYou > 0 && <Count n={needsYou} />}>
          {t("nav.needsYou")}
        </NavItem>
        <NavItem icon={<BookOpen />} active={route.view === "knowledge"} onPress={() => go({ view: "knowledge" })}>
          {t("nav.knowledge")}
        </NavItem>
        <UsageItem active={route.view === "usage"} />
      </div>

      <div ref={tree} onScroll={onScroll} className="scroll-quiet flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-2">
        <NavLabel
          action={
            <NewProjectButton />
          }
        >
          {t("nav.projects")}
        </NavLabel>
        {projects.map((p) => (
          <ProjectGroup
            key={p.id}
            project={p}
            chats={byNewest.filter((c) => c.projectId === p.id)}
            open={isOpen(p.id)}
            onToggle={() => toggle(p.id)}
            active={(route.view === "project" && route.id === p.id) || (route.view === "home" && route.projectId === p.id)}
            activeChat={activeChat}
            statuses={statuses}
            agents={agents}
          />
        ))}
        <Group
          icon={<MessageCircle />}
          name={t("common.general")}
          open={isOpen("general")}
          onToggle={() => toggle("general")}
          onNewChat={() => go({ view: "home" })}
          newChatLabel={t("nav.newChat")}
          chats={general}
          activeChat={activeChat}
          statuses={statuses}
          agents={agents}
        />

        {team.length > 0 && (
          <>
            <NavLabel
              action={
                <IconButton label={t("nav.newAgent")} size="sm" onPress={() => go({ view: "new-agent", projectId: teamProject?.id ?? null })}>
                  <Plus className="size-3.5" />
                </IconButton>
              }
            >
              {teamProject ? t("nav.agentsOf", { name: teamProject.name }) : t("nav.agents")}
            </NavLabel>
            {team.map((a) => (
              <NavItem
                key={a.id}
                active={route.view === "agent" && route.id === a.id}
                icon={<AgentAvatar id={a.id} name={a.name} tone={agentTone(a, agents)} size={20} />}
                trailing={<span className="shrink-0 text-sm text-muted">{modelName(a.model)}</span>}
                onPress={() => go({ view: "agent", id: a.id })}
              >
                {a.name}
              </NavItem>
            ))}
          </>
        )}
      </div>
      <div className={cx("shrink-0 border-t px-3 pt-1 transition-colors duration-120", edges.bottom ? "border-subtle" : "border-transparent")}>
        <NavItem icon={<Settings />} active={route.view === "settings"} onPress={() => go({ view: "settings", tab: "accounts" })}>
          {t("nav.settings")}
        </NavItem>
      </div>
    </nav>
  )
}

const lastActivity = (c: Chat, statuses: Readonly<Record<string, ChatStatus>>) => Math.max(c.createdAt, statuses[c.id]?.updatedAt ?? 0)

const Count = ({ n }: { n: number }) => (
  <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-semibold text-on-accent tabular-nums">{n}</span>
)

function ProjectGroup({
  project,
  chats,
  open,
  onToggle,
  active,
  activeChat,
  statuses,
  agents
}: {
  project: Project
  chats: ReadonlyArray<Chat>
  open: boolean
  onToggle: () => void
  active: boolean
  activeChat: string | undefined
  statuses: Readonly<Record<string, ChatStatus>>
  agents: ReadonlyArray<Agent>
}) {
  return (
    <Group
      icon={open ? <FolderOpen /> : <Folder />}
      name={project.name}
      open={open}
      onToggle={onToggle}
      active={active}
      onSettings={() => go({ view: "project", id: project.id, tab: "overview" })}
      onNewChat={() => go({ view: "home", projectId: project.id })}
      newChatLabel={t("nav.newChatIn", { name: project.name })}
      chats={chats}
      activeChat={activeChat}
      statuses={statuses}
      agents={agents}
    />
  )
}

function Group({
  icon,
  name,
  open,
  onToggle,
  active,
  onSettings,
  onNewChat,
  newChatLabel,
  chats,
  activeChat,
  statuses,
  agents
}: {
  icon: ReactNode
  name: string
  open: boolean
  onToggle: () => void
  active?: boolean
  onSettings?: () => void
  onNewChat: () => void
  newChatLabel: string
  chats: ReadonlyArray<Chat>
  activeChat: string | undefined
  statuses: Readonly<Record<string, ChatStatus>>
  agents: ReadonlyArray<Agent>
}) {
  const [all, setAll] = useState(false)
  const running = chats.filter((c) => statuses[c.id]?.state === "running").length
  const waiting = chats.filter((c) => statuses[c.id]?.state === "waiting").length
  // The open chat always stays visible, even past the fold.
  const visible = all ? chats : chats.filter((c, i) => i < VISIBLE || c.id === activeChat)
  const hidden = chats.length - visible.length

  return (
    <div className="flex flex-col gap-0.5">
      <GroupRow
        icon={icon}
        name={name}
        expanded={open}
        active={!!active}
        onToggle={onToggle}
        actions={
          <>
            {onSettings && (
              <IconButton label={t("nav.projectSettings", { name })} size="sm" onPress={onSettings}>
                <Settings className="size-3.5" />
              </IconButton>
            )}
            <IconButton label={newChatLabel} size="sm" onPress={onNewChat}>
              <Plus className="size-3.5" />
            </IconButton>
          </>
        }
        trailing={
          <span className="flex shrink-0 items-center gap-1.5 pr-1.5 text-sm text-muted">
            {!open && waiting > 0 && <ChatStatusIcon state="waiting" />}
            {!open && running > 0 && waiting === 0 && <ChatStatusIcon state="running" />}
            {!open && chats.length > 0 && <span className="tabular-nums">{chats.length}</span>}
            {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </span>
        }
      />
      {open && chats.length > 0 && (
        <div className="ml-4.5 flex flex-col gap-0.5 border-l border-strong pl-1.5">
          {visible.map((c) => (
            <ChatRow key={c.id} chat={c} status={statuses[c.id]} active={c.id === activeChat} agents={agents} />
          ))}
          {(hidden > 0 || all) && chats.length > VISIBLE && (
            <TreeItem title={<span className="text-muted">{all ? t("nav.showLess") : t("nav.showMore", { count: hidden })}</span>} onPress={() => setAll(!all)} />
          )}
        </div>
      )}
    </div>
  )
}

function ChatRow({ chat, status, active, agents }: { chat: Chat; status: ChatStatus | undefined; active: boolean; agents: ReadonlyArray<Agent> }) {
  const live = status && status.state !== "idle" ? status : undefined
  return (
    <TreeItem
      active={active}
      title={chatTitle(chat)}
      onPress={() => go({ view: "chat", id: chat.id })}
      detail={
        live && (
          <span className={cx("flex min-w-0 items-center gap-1.5", live.state === "waiting" && "text-accent-text", live.state === "failed" && "text-danger")}>
            <ChatStatusIcon state={live.state === "idle" ? "running" : live.state} />
            <span className="truncate">{statusLabel(live, agents)}</span>
          </span>
        )
      }
      trailing={!live && <span className="shrink-0 text-sm font-normal text-muted">{formatAge(Math.max(chat.createdAt, status?.updatedAt ?? 0))}</span>}
    />
  )
}


// Usage, with the fullest limit window once it reaches 80%: below that a number next to the row is noise.
// The row's label names the account and window, so the percentage never stands alone.
function UsageItem({ active }: { active: boolean }) {
  const accounts = useList(accountsAtom).filter((a) => a.kind === "subscription")
  const worst = accounts
    .flatMap((a) => (a.usage?.windows ?? []).map((w) => ({ account: a.label, window: windowLabel(w.id), used: w.usedPercent / 100 })))
    .sort((a, b) => b.used - a.used)[0]
  const alert = worst && worst.used >= LIMIT_ALERT ? worst : undefined
  const detail = alert && t("nav.usageAlert", { account: alert.account, window: alert.window, percent: formatPercent(alert.used) })
  return (
    <NavItem
      icon={<ChartColumn />}
      active={active}
      onPress={() => go({ view: "usage" })}
      {...(detail && { "aria-label": `${t("nav.usage")}, ${detail}` })}
      trailing={
        alert && (
          <span title={detail} className="shrink-0 text-sm text-warning tabular-nums">
            {formatPercent(alert.used)}
          </span>
        )
      }
    >
      {t("nav.usage")}
    </NavItem>
  )
}

// Which edges of a scroll area have content past them, to draw the hairlines.
function useScrollEdges() {
  const tree = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ top: false, bottom: false })
  const measure = (el: HTMLElement) => {
    const top = el.scrollTop > 0
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1
    setEdges((e) => (e.top === top && e.bottom === bottom ? e : { top, bottom }))
  }
  useLayoutEffect(() => {
    const el = tree.current
    if (!el) return
    measure(el)
    const observer = new ResizeObserver(() => measure(el))
    observer.observe(el)
    for (const child of el.children) observer.observe(child)
    return () => observer.disconnect()
  })
  return { tree, edges, onScroll: (e: UIEvent<HTMLElement>) => measure(e.currentTarget) }
}
