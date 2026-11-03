// Sidebar (prototype "Sidebar"): Needs you / Knowledge / Usage, then the projects as a tree with their chats
// (live status under the title), the chats without a project, the agents of the open project, and Settings at
// the bottom. Like a desktop sidebar, the brand (also the window's drag region), the top rows and Settings stay
// put and only the trees scroll, with no visible bar: a hairline marks an edge while content is hidden past it.
// Projects reorder by drag and drop; chats reorder only inside their own group and never change project.
// Statuses come from the live stream; everything else from the atoms.
import { type Agent, type Chat, LIMIT_ALERT, type Project } from "@zero/contracts"
import type { ChatStatus } from "@zero/contracts/events"
import { formatAge, formatPercent, t } from "@zero/i18n"
import { type ReactNode, type UIEvent, useEffect, useLayoutEffect, useRef, useState } from "react"
import { accountsAtom, agentsAtom, approvalsAtom, chatsAtom, memoriesAtom, mutations, projectsAtom, useList, useMutation, useStatuses } from "../client.ts"
import { agentTone, chatTitle, modelName, statusLabel, windowLabel } from "../labels.ts"
import { NewProjectButton } from "./project.tsx"
import { go, readSet, type Route, writeSet } from "../state.ts"
import {
  AgentAvatar, BookOpen, ChartColumn, ChatStatusIcon, cx, Folder, FolderOpen, IconButton, Inbox, NavItem, NavLabel, NavTree, NavTreeItem, type NavKey, Plus,
  Settings, SquarePen, useNavReorder
} from "@/ui"

const VISIBLE = 5
const EXPANDED_KEY = "zero.sidebar.expanded"
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

  const activeChat = route.view === "chat" ? route.id : undefined
  const groupOf = (projectId: string | null) => ordered(chats.filter((c) => c.projectId === projectId), statuses)
  const loose = groupOf(null)
  const teamProject = projects.find((p) => p.id === activeProjectId)
  const team = agents.filter((a) => a.projectId === (teamProject?.id ?? null))
  const { tree, edges, onScroll } = useScrollEdges()

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
    <nav aria-label={t("nav.label")} className="flex w-62 shrink-0 flex-col overflow-hidden pt-4 pb-3">
      {/* The brand row is the window's title bar in the desktop app (the traffic lights sit on its left). */}
      <div className="title-inset electrobun-webkit-app-region-drag mb-3 flex h-control shrink-0 items-center gap-2.5 px-5">
        <span aria-hidden="true" className="flex size-6 items-center justify-center rounded-control bg-fg text-sm font-semibold text-frame">
          Z
        </span>
        <span className="flex-1 text-lg font-semibold">{t("app.name")}</span>
        <span className="electrobun-webkit-app-region-no-drag">
          <IconButton label={t("nav.newChat")} onPress={() => go({ view: "home" })}>
            <SquarePen />
          </IconButton>
        </span>
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

      <div ref={tree} onScroll={onScroll} className="scroll-quiet flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-3 pb-2">
        <NavLabel action={<NewProjectButton />}>{t("nav.projects")}</NavLabel>
        <NavTree label={t("nav.projects")} expandedKeys={expandedKeys} onExpandedChange={onExpandedChange} dragAndDropHooks={projectDnd}>
          {projects.map((p) => {
            const list = groupOf(p.id)
            return (
              <ProjectItem
                key={p.id}
                project={p}
                open={expandedKeys.has(projectKey(p.id))}
                active={(route.view === "project" && route.id === p.id) || (route.view === "home" && route.projectId === p.id)}
                chats={list}
                statuses={statuses}
                onToggle={() => onExpandedChange(new Set([...expandedKeys].filter((k) => k !== projectKey(p.id)).concat(expandedKeys.has(projectKey(p.id)) ? [] : [projectKey(p.id)])))}
              >
                {chatItems(p.id, list)}
              </ProjectItem>
            )
          })}
        </NavTree>

        {loose.length > 0 && (
          <>
            <NavLabel
              action={
                <IconButton label={t("nav.newChatIn", { name: t("nav.chats") })} size="sm" onPress={() => go({ view: "home" })}>
                  <Plus className="size-3.5" />
                </IconButton>
              }
            >
              {t("nav.chats")}
            </NavLabel>
            <NavTree label={t("nav.chats")} dragAndDropHooks={looseDnd}>
              {chatItems("loose", loose)}
            </NavTree>
          </>
        )}

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
        <NavItem icon={<Settings />} active={route.view === "settings"} onPress={() => go({ view: "settings", tab: "providers" })}>
          {t("nav.settings")}
        </NavItem>
      </div>
    </nav>
  )
}

const lastActivity = (c: Chat, statuses: Statuses) => Math.max(c.createdAt, statuses[c.id]?.updatedAt ?? 0)

// A group's chats: the ones never placed by hand first (newest activity on top), then the placed ones in
// their manual order.
const ordered = (chats: ReadonlyArray<Chat>, statuses: Statuses) => [
  ...chats.filter((c) => c.position === null).sort((a, b) => lastActivity(b, statuses) - lastActivity(a, statuses)),
  ...chats.filter((c) => c.position !== null).sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
]

const Count = ({ n }: { n: number }) => (
  <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-semibold text-on-accent tabular-nums">{n}</span>
)

function ProjectItem({
  project,
  open,
  active,
  chats,
  statuses,
  onToggle,
  children
}: {
  project: Project
  open: boolean
  active: boolean
  chats: ReadonlyArray<Chat>
  statuses: Statuses
  onToggle: () => void
  children: ReactNode
}) {
  const running = chats.filter((c) => statuses[c.id]?.state === "running").length
  const waiting = chats.filter((c) => statuses[c.id]?.state === "waiting").length
  return (
    <NavTreeItem
      id={projectKey(project.id)}
      textValue={project.name}
      active={active}
      glyph={open ? <FolderOpen /> : <Folder />}
      title={project.name}
      dragLabel={t("nav.reorder", { name: project.name })}
      onAction={onToggle}
      trailing={
        !open &&
        chats.length > 0 && (
          <span className="flex items-center gap-1.5" role="img" aria-label={t("nav.chatCount", { count: chats.length })}>
            {waiting > 0 ? <ChatStatusIcon state="waiting" /> : running > 0 && <ChatStatusIcon state="running" />}
            {chats.length}
          </span>
        )
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

function ChatItem({ chat, status, active, agents }: { chat: Chat; status: ChatStatus | undefined; active: boolean; agents: ReadonlyArray<Agent> }) {
  const live = status && status.state !== "idle" ? status : undefined
  const age = formatAge(Math.max(chat.createdAt, status?.updatedAt ?? 0))
  return (
    <NavTreeItem
      id={chatKey(chat.id)}
      textValue={chatTitle(chat)}
      active={active}
      title={chatTitle(chat)}
      dragLabel={t("nav.reorder", { name: chatTitle(chat) })}
      onAction={() => go({ view: "chat", id: chat.id })}
      detail={
        live && (
          <span className={cx("flex min-w-0 items-center gap-1.5", live.state === "waiting" && "text-accent-text", live.state === "failed" && "text-danger")}>
            <ChatStatusIcon state={live.state === "idle" ? "running" : live.state} />
            <span className="truncate">{statusLabel(live, agents)}</span>
          </span>
        )
      }
      trailing={!live && age}
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
const edgesOf = (el: HTMLElement) => ({ top: el.scrollTop > 0, bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 1 })
const sameEdges = (a: { top: boolean; bottom: boolean }, b: { top: boolean; bottom: boolean }) => (a.top === b.top && a.bottom === b.bottom ? a : b)

function useScrollEdges() {
  const tree = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ top: false, bottom: false })
  const measure = (el: HTMLElement) => setEdges((e) => sameEdges(e, edgesOf(el)))
  // Content changes re-render the sidebar, so measure after each render; the observer covers window resizes.
  useLayoutEffect(() => {
    if (tree.current) measure(tree.current)
  })
  useEffect(() => {
    const el = tree.current
    if (!el) return
    const observer = new ResizeObserver(() => setEdges((e) => sameEdges(e, edgesOf(el))))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return { tree, edges, onScroll: (e: UIEvent<HTMLElement>) => measure(e.currentTarget) }
}
