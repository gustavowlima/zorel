// Shell: the sidebar on the frame and one card for the current screen (DESIGN.md layout). Also watches the
// live statuses: when a chat settles, what the server changed on its own (title, proposed memories,
// usage, open approvals) is refetched.
import type { ChatStatus } from "@zorel/contracts/events"
import { isTeammate } from "@zorel/contracts"
import { useAtomValue } from "@effect/atom-react"
import { t } from "@zorel/i18n"
import { AsyncResult } from "effect/reactivity"
import { useEffect, useRef } from "react"
import { agentsAtom, chatsAtom, memoriesAtom, modelsAtom, mutations, pagesAtom, preferencesAtom, projectsAtom, useInvalidate, useList, useMutation, useReading, useStatuses } from "./client.ts"
import { AgentView } from "./features/agent.tsx"
import { ChatView } from "./features/chat.tsx"
import { HomeView } from "./features/home.tsx"
import { AgentsView } from "./features/agents.tsx"
import { BuilderView } from "./features/builder.tsx"
import { RoutinesView } from "./features/routines.tsx"
import { FlowEditorView } from "./features/flow-editor.tsx"
import { RunTraceView } from "./features/run-trace.tsx"
import { TodayView } from "./features/today.tsx"
import { useActivity } from "./features/your-day.tsx"
import { InboxView } from "./features/inbox.tsx"
import { MemoryView } from "./features/memory.tsx"
import { PagesView } from "./features/pages.tsx"
import { ProjectView } from "./features/project.tsx"
import { SettingsView } from "./features/settings.tsx"
import { SIDEBAR_FOLDED, SIDEBAR_WIDTH, Sidebar, TitleBar } from "./features/sidebar.tsx"
import { UsageView } from "./features/usage.tsx"
import { rememberModels } from "./labels.ts"
import { go, type Route, useRoute, useSidebar } from "./state.ts"
import { cn } from "@/lib/utils"
import { ArrowLeft, Button, CircleAlert, EmptyState, Pause, Spinner, Width } from "@/ui"
import { useNotifications } from "./features/notify.tsx"
import { Palette } from "./features/palette.tsx"
import { FirstRun } from "./features/first-run.tsx"
import { Loading } from "./features/loading.tsx"
import { QuitDialog } from "./features/quit-dialog.tsx"

export function App() {
  const route = useRoute()
  const projectsResult = useAtomValue(projectsAtom)
  const chats = useList(chatsAtom)
  const agents = useList(agentsAtom)
  rememberModels(useList(modelsAtom)) // real model names ("Opus 5.5") for every label below
  const chat = route.view === "chat" ? chats.find((c) => c.id === route.id) : undefined
  const agent = route.view === "agent" ? agents.find((a) => a.id === route.id) : undefined
  const activeProjectId =
    route.view === "project" ? route.id : route.view === "home" ? (route.projectId ?? null) : route.view === "new-agent" ? route.projectId : (chat?.projectId ?? agent?.projectId ?? null)
  const offline = AsyncResult.isFailure(projectsResult)
  const loading = AsyncResult.isInitial(projectsResult)

  const sidebar = useSidebar()
  const desktop = document.documentElement.dataset.shell === "desktop" // the desktop app: a title bar runs above everything
  useNotifications(route)
  useActivity()
  const paused = AsyncResult.getOrElse(useAtomValue(preferencesAtom), () => undefined)?.paused ?? false
  const setPause = useMutation(mutations.pause)
  useRefetchOnSettle()
  useRetryWhileOffline(offline)

  // No agent of the person's own yet (the Builder doesn't count): the first run comes before anything else (spec 015).
  const agentsResult = useAtomValue(agentsAtom)
  // Until the agents are known, nothing: drawing the app first would flash it before the first run takes over.
  if (AsyncResult.isInitial(agentsResult)) return <Loading desktop={desktop} />
  // The agent builder and the new-agent form (where the first run sends you to make the first one) open without it.
  const firstTime = AsyncResult.isSuccess(agentsResult) && !agentsResult.value.some(isTeammate)
  const makingFirst = route.view === "builder" || route.view === "new-agent"
  if (firstTime && !makingFirst)
    return (
      <div className="flex h-full flex-col bg-canvas">
        {desktop && <div className="app-drag h-12 shrink-0" />}
        <FirstRun />
      </div>
    )
  // Making the first agent: that screen alone, no sidebar (nothing else exists yet, and any other place would fall
  // back to the first run). "Back" returns to it; once the agent exists, the whole app shows.
  if (firstTime)
    return (
      <div className="flex h-full flex-col bg-canvas">
        <div className={cn("flex h-12 shrink-0 items-center px-3", desktop && "app-drag pl-20")}>
          <Button size="sm" variant="ghost" onPress={() => go({ view: "home" })}>
            <ArrowLeft />
            {t("firstRun.back")}
          </Button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          <Screen route={route} />
        </div>
      </div>
    )

  return (
    <div className="flex h-full flex-col bg-frame">
      {desktop && <TitleBar sidebarHidden={sidebar.hidden} />}
    <div className="flex min-h-0 flex-1">
      <Palette onToggleSidebar={sidebar.toggle} />
      <QuitDialog />
      {/* One sidebar: open, or folded to its icons (⌘B); the card follows in the same spring. */}
      <Width width={sidebar.hidden ? SIDEBAR_FOLDED : SIDEBAR_WIDTH} className="flex shrink-0 overflow-hidden">
        <Sidebar
          route={route}
          activeProjectId={activeProjectId}
          folded={sidebar.hidden}
          onToggle={sidebar.toggle}
          paused={paused}
          onPause={(p) => void setPause({ payload: { paused: p }, reactivityKeys: ["preferences"] })}
        />
      </Width>
      {/* The content card: the whole height and the right edge of the window, rounded only toward the sidebar. */}
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-l-sheet border-l border-subtle bg-canvas">
          {paused && (
            <div role="status" className="flex items-center gap-3 border-b border-subtle bg-surface px-7 py-2 text-sm text-warning">
              <Pause className="size-4" />
              <span className="flex-1">{t("pause.banner")}</span>
              <Button size="sm" variant="secondary" onPress={() => void setPause({ payload: { paused: false }, reactivityKeys: ["preferences"] })}>
                {t("pause.resume")}
              </Button>
            </div>
          )}
          {offline && (
            <div role="alert" className="flex items-center gap-2 border-b border-subtle bg-danger-soft px-7 py-2 text-sm text-danger">
              <CircleAlert className="size-4" /> {t("app.offline")}
            </div>
          )}
          {loading ? (
            <div className="flex flex-1 items-center justify-center text-muted">
              <Spinner />
            </div>
          ) : (
            <Screen route={route} />
          )}
        </div>
      </main>
    </div>
    </div>
  )
}

function Screen({ route }: { route: Route }) {
  const projects = useList(projectsAtom)
  const chats = useList(chatsAtom)
  const agents = useList(agentsAtom)
  switch (route.view) {
    case "home":
      return <HomeView projectId={route.projectId} />
    case "inbox":
      return <InboxView />
    case "agents":
      return <AgentsView />
    case "routines":
      return <RoutinesView />
    case "routine-flow":
      return <FlowEditorView key={route.id} routineId={route.id} />
    case "routine-run":
      return <RunTraceView key={route.runId} routineId={route.id} runId={route.runId} />
    case "today":
      return <TodayView />
    case "knowledge":
      return <OldKnowledgeLink id={route.id} />
    case "memory":
      return <MemoryView key={route.tab ?? "all"} tab={route.tab} review={route.review} />
    case "pages":
      return <PagesView selected={route.id} />
    case "skills":
      return <SettingsView tab="skills" skill={{ selected: route.id, file: route.file }} />
    case "usage":
      return <UsageView key={route.agentId ?? "all"} agentId={route.agentId} />
    case "settings":
      return <SettingsView tab={route.tab} provider={route.provider} />
    case "builder":
      return <BuilderView key={route.projectId ?? "global"} projectId={route.projectId} />
    case "new-agent":
      // Keyed: each agent (and a new one) is its own form, so nothing of the last one (its tab, its draft) carries over.
      return <AgentView key={`new:${route.projectId ?? "global"}:${route.teamId ?? ""}`} projectId={route.projectId} {...(route.teamId && { teamId: route.teamId })} />
    case "project": {
      const project = projects.find((p) => p.id === route.id)
      return project ? <ProjectView project={project} tab={route.tab} /> : <NotFound />
    }
    case "agent": {
      const agent = agents.find((a) => a.id === route.id)
      return agent ? <AgentView key={agent.id} agent={agent} projectId={agent.projectId} tab={route.tab} /> : <NotFound />
    }
    case "chat": {
      const chat = chats.find((c) => c.id === route.id)
      return chat ? <ChatView key={chat.id} chat={chat} at={route.at} /> : <NotFound />
    }
  }
}

function NotFound() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <EmptyState
        title={t("notFound.title")}
        hint={t("notFound.body")}
        action={
          <Button variant="secondary" onPress={() => go({ view: "home" })}>
            {t("notFound.home")}
          </Button>
        }
      />
    </div>
  )
}

// Queries that failed (server restarting, network) don't retry by themselves: while offline, refetch
// everything every 2s until the server answers again.
const ALL_KEYS = ["projects", "agents", "chats", "memories", "servers", "accounts", "keys", "models", "usage", "approvals", "preferences", "workspace", "audit", "storage"] as const
function useRetryWhileOffline(offline: boolean) {
  const invalidate = useInvalidate()
  useEffect(() => {
    if (!offline) return
    const id = setInterval(() => invalidate(ALL_KEYS), 2000)
    return () => clearInterval(id)
  }, [offline, invalidate])
}

// When a chat leaves "running" (or starts waiting), refetch what the server may have changed meanwhile.
function useRefetchOnSettle() {
  const statuses = useStatuses()
  const invalidate = useInvalidate()
  const previous = useRef<Readonly<Record<string, ChatStatus>>>({})
  useEffect(() => {
    const before = previous.current
    previous.current = statuses
    const changed = Object.values(statuses).filter((s) => before[s.chatId]?.state !== s.state)
    if (!changed.length) return
    if (changed.some((s) => s.state === "idle" || s.state === "failed")) invalidate(["chats", "memories", "usage", "approvals", "workspace"])
    else if (changed.some((s) => s.state === "waiting")) invalidate(["approvals"])
  }, [statuses, invalidate])
}

// A link from before Knowledge split (#/knowledge/<id>): once the lists are in, it goes where the item lives now.
function OldKnowledgeLink({ id }: { id: string }) {
  const memories = useReading(memoriesAtom)
  const pages = useReading(pagesAtom)
  const ready = !memories.loading && !pages.loading
  useEffect(() => {
    if (!ready) return
    const m = memories.items.find((x) => x.id === id)
    if (pages.items.some((p) => p.id === id)) go({ view: "pages", id })
    else if (m?.kind === "skill") go({ view: "skills", id })
    else go(m ? { view: "memory", ...(m.state === "pending" ? { review: true } : { tab: m.scope }) } : { view: "memory" })
  }, [ready, id, memories.items, pages.items])
  return null
}
