// Shell: sidebar (projetos com seus chats, chats avulsos, memórias) + card principal sobre o frame.
import type { Chat } from "@zero/contracts"
import { useEffect } from "react"
import { call } from "./api.ts"
import { ChatView } from "./features/chat.tsx"
import { MemoriesView } from "./features/memories.tsx"
import { AgentCard, NewProjectView, ProjectView } from "./features/project.tsx"
import { SettingsView } from "./features/tools.tsx"
import { DataContext, DEFAULT_MODEL, go, useApp, useData, useRoute, type Route } from "./state.ts"
import { Badge, Page, SectionLabel, SidebarItem } from "@/ui"

export function App() {
  const { data, error, reload } = useData()
  const route = useRoute()
  const chat = route.view === "chat" ? data.chats.find((c) => c.id === route.id) : undefined
  const project = route.view === "project" ? data.projects.find((p) => p.id === route.id) : undefined
  // Link para algo criado depois da última carga (outra aba, API): recarrega uma vez.
  const missing = (route.view === "chat" && !chat) || (route.view === "project" && !project) ? route.id : undefined
  useEffect(() => {
    if (missing) void reload()
  }, [missing, reload])

  return (
    <DataContext.Provider value={{ data, reload }}>
      <div className="flex h-full gap-2 p-2">
        <Sidebar route={route} openProjectId={project?.id ?? chat?.projectId ?? null} />
        <main className="flex min-w-0 flex-1 flex-col overflow-auto rounded-sheet border border-subtle bg-canvas">
          {error && <div className="m-4 rounded-card bg-danger-soft p-3 text-sm text-danger">{error}</div>}
          {route.view === "home" && <Home />}
          {route.view === "new-project" && <NewProjectView />}
          {route.view === "memories" && <MemoriesView />}
          {route.view === "settings" && <SettingsView />}
          {project && <ProjectView project={project} />}
          {chat && <ChatView key={chat.id} chat={chat} />}
        </main>
      </div>
    </DataContext.Provider>
  )
}

const newChat = (projectId: string | null, reload: () => Promise<void>) =>
  call((c) => c.chats.create({ payload: { projectId, agentIds: [], model: DEFAULT_MODEL } })).then(async (chat) => {
    await reload()
    go({ view: "chat", id: chat.id })
  })

function Sidebar({ route, openProjectId }: { route: Route; openProjectId: string | null }) {
  const { data, reload } = useApp()
  const pending = data.memories.filter((m) => m.state === "pending").length
  const isChat = (c: Chat) => route.view === "chat" && route.id === c.id

  return (
    <aside className="flex w-60 shrink-0 flex-col overflow-auto px-1">
      <button type="button" onClick={() => go({ view: "home" })} className="flex h-control-lg items-center px-2 text-left text-lg font-semibold">
        Zero
      </button>
      <SidebarItem active={route.view === "memories"} onClick={() => go({ view: "memories" })}>
        Memórias e skills
        {pending > 0 && (
          <span className="ml-auto">
            <Badge tone="accent">{pending}</Badge>
          </span>
        )}
      </SidebarItem>

      <SectionLabel>Projetos</SectionLabel>
      {data.projects.map((p) => (
        <div key={p.id}>
          <SidebarItem active={route.view === "project" && route.id === p.id} onClick={() => go({ view: "project", id: p.id })}>
            <span className="truncate">{p.name}</span>
          </SidebarItem>
          {openProjectId === p.id && (
            <div className="ml-3 border-l border-subtle pl-1">
              {data.chats
                .filter((c) => c.projectId === p.id)
                .map((c) => (
                  <SidebarItem key={c.id} active={isChat(c)} onClick={() => go({ view: "chat", id: c.id })}>
                    <span className="truncate">{c.title}</span>
                  </SidebarItem>
                ))}
              <SidebarItem onClick={() => newChat(p.id, reload)} className="text-dim">
                + Novo chat
              </SidebarItem>
            </div>
          )}
        </div>
      ))}
      <SidebarItem active={route.view === "new-project"} onClick={() => go({ view: "new-project" })} className="text-dim">
        + Novo projeto
      </SidebarItem>

      <SectionLabel>Chats</SectionLabel>
      {data.chats
        .filter((c) => !c.projectId)
        .map((c) => (
          <SidebarItem key={c.id} active={isChat(c)} onClick={() => go({ view: "chat", id: c.id })}>
            <span className="truncate">{c.title}</span>
          </SidebarItem>
        ))}
      <SidebarItem onClick={() => newChat(null, reload)} className="text-dim">
        + Novo chat
      </SidebarItem>
      <div className="mt-auto pt-4">
        <SidebarItem active={route.view === "settings"} onClick={() => go({ view: "settings" })}>
          Configurações
        </SidebarItem>
      </div>
    </aside>
  )
}

function Home() {
  const { data } = useApp()
  const global = data.agents.filter((a) => a.projectId === null)
  const subscriptions = data.models.filter((m) => m.kind === "subscription")
  const apis = [...new Map(data.models.filter((m) => m.kind === "api").map((m) => [m.provider, m])).values()]

  return (
    <Page title="Início">
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Modelos</h2>
        <p className="text-sm text-muted">Assinaturas usam a CLI oficial já logada no seu computador. APIs usam a chave definida no ambiente do server.</p>
        <div className="flex flex-wrap gap-2">
          {[...new Map(subscriptions.map((m) => [m.provider, m])).values(), ...apis].map((m) => (
            <span key={m.provider} title={m.hint}>
              <Badge tone={m.available ? "accent" : "neutral"}>{`${m.provider}${m.available ? "" : " · indisponível"}`}</Badge>
            </span>
          ))}
        </div>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Agentes globais</h2>
        <p className="text-sm text-muted">Disponíveis em qualquer chat, com ou sem projeto.</p>
        {global.map((a) => (
          <AgentCard key={a.id} agent={a} />
        ))}
        <AgentCard />
      </section>
    </Page>
  )
}
