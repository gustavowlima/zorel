// Shell: the sidebar on the frame and one card for the current screen (DESIGN.md layout). Also watches the
// live statuses: when a chat settles, what the server changed on its own (title, proposed memories,
// usage, open approvals) is refetched.
import type { ChatStatus } from "@zero/contracts/events"
import { useAtomValue } from "@effect/atom-react"
import { t } from "@zero/i18n"
import { AsyncResult } from "effect/reactivity"
import { useEffect, useRef } from "react"
import { agentsAtom, chatsAtom, projectsAtom, useInvalidate, useList, useStatuses } from "./client.ts"
import { AgentView } from "./features/agent.tsx"
import { ChatView } from "./features/chat.tsx"
import { HomeView } from "./features/home.tsx"
import { InboxView } from "./features/inbox.tsx"
import { KnowledgeView } from "./features/knowledge.tsx"
import { ProjectView } from "./features/project.tsx"
import { SettingsView } from "./features/settings.tsx"
import { Sidebar } from "./features/sidebar.tsx"
import { UsageView } from "./features/usage.tsx"
import { go, type Route, useRoute } from "./state.ts"
import { Button, CircleAlert, EmptyState, Spinner } from "@/ui"

export function App() {
  const route = useRoute()
  const projectsResult = useAtomValue(projectsAtom)
  const chats = useList(chatsAtom)
  const agents = useList(agentsAtom)
  const chat = route.view === "chat" ? chats.find((c) => c.id === route.id) : undefined
  const agent = route.view === "agent" ? agents.find((a) => a.id === route.id) : undefined
  const activeProjectId =
    route.view === "project" ? route.id : route.view === "home" ? (route.projectId ?? null) : route.view === "new-agent" ? route.projectId : (chat?.projectId ?? agent?.projectId ?? null)
  const offline = AsyncResult.isFailure(projectsResult)
  const loading = AsyncResult.isInitial(projectsResult)

  useRefetchOnSettle()

  return (
    <div className="flex h-full bg-frame">
      <Sidebar route={route} activeProjectId={activeProjectId} />
      <main className="flex min-w-0 flex-1 flex-col py-3 pr-3">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-sheet border border-subtle bg-canvas">
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
    case "knowledge":
      return <KnowledgeView selected={route.id} />
    case "usage":
      return <UsageView />
    case "settings":
      return <SettingsView tab={route.tab} />
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
    if (changed.some((s) => s.state === "idle" || s.state === "failed")) invalidate(["chats", "memories", "usage", "approvals"])
    else if (changed.some((s) => s.state === "waiting")) invalidate(["approvals"])
  }, [statuses, invalidate])
}
