// Shell: the sidebar on the frame and one card for the current screen (DESIGN.md layout). Also watches the
// live statuses: when a chat settles, what the server changed on its own (title, proposed memories,
// usage, open approvals) is refetched.
import type { ChatStatus } from "@zero/contracts/events"
import { useAtomValue } from "@effect/atom-react"
import { t } from "@zero/i18n"
import { AsyncResult } from "effect/reactivity"
import { useEffect, useRef } from "react"
import { agentsAtom, chatsAtom, modelsAtom, mutations, preferencesAtom, projectsAtom, useInvalidate, useList, useMutation, useStatuses } from "./client.ts"
import { AgentView } from "./features/agent.tsx"
import { ChatView } from "./features/chat.tsx"
import { HomeView } from "./features/home.tsx"
import { AgentsView } from "./features/agents.tsx"
import { RoutinesView } from "./features/routines.tsx"
import { InboxView } from "./features/inbox.tsx"
import { KnowledgeView } from "./features/knowledge.tsx"
import { ProjectView } from "./features/project.tsx"
import { SettingsView } from "./features/settings.tsx"
import { Rail, Sidebar } from "./features/sidebar.tsx"
import { UsageView } from "./features/usage.tsx"
import { rememberModels } from "./labels.ts"
import { go, type Route, useRoute, useSidebar } from "./state.ts"
import { Button, CircleAlert, cx, EmptyState, Pause, SlideWidth, Spinner } from "@/ui"
import { useNotifications } from "./features/notify.tsx"
import { Palette } from "./features/palette.tsx"

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
  useNotifications(route)
  const paused = AsyncResult.getOrElse(useAtomValue(preferencesAtom), () => undefined)?.paused ?? false
  const setPause = useMutation(mutations.pause)
  useRefetchOnSettle()
  useRetryWhileOffline(offline)

  return (
    <div className="flex h-full bg-frame">
      <Palette onToggleSidebar={sidebar.toggle} />
      <Rail route={route} sidebar={sidebar} paused={paused} onPause={(p) => void setPause({ payload: { paused: p }, reactivityKeys: ["preferences"] })} />
      <SlideWidth open={!sidebar.hidden} width={248}>
        <Sidebar route={route} activeProjectId={activeProjectId} />
      </SlideWidth>
      {/* The content card: the whole height and the right edge of the window, rounded only toward the sidebar. */}
      <main className={cx("flex min-w-0 flex-1 flex-col", sidebar.hidden && "pl-3")}>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-l-sheet border-l border-subtle bg-canvas">
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
    case "knowledge":
      return <KnowledgeView selected={route.id} />
    case "usage":
      return <UsageView key={route.agentId ?? "all"} agentId={route.agentId} />
    case "settings":
      return <SettingsView tab={route.tab} provider={route.provider} />
    case "new-agent":
      return <AgentView projectId={route.projectId} />
    case "project": {
      const project = projects.find((p) => p.id === route.id)
      return project ? <ProjectView project={project} tab={route.tab} /> : <NotFound />
    }
    case "agent": {
      const agent = agents.find((a) => a.id === route.id)
      return agent ? <AgentView agent={agent} projectId={agent.projectId} /> : <NotFound />
    }
    case "chat": {
      const chat = chats.find((c) => c.id === route.id)
      return chat ? <ChatView key={chat.id} chat={chat} /> : <NotFound />
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
