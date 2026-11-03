// Minimal global state: lists loaded from the server (they're small) and the route in the URL hash.
import type { Agent, Chat, McpServer, Memory, ModelInfo, Project } from "@zero/contracts"
import { Effect } from "effect"
import { createContext, useCallback, useContext, useEffect, useState } from "react"
import { call } from "./api.ts"

export type Route =
  | { view: "home" }
  | { view: "new-project" }
  | { view: "memories" }
  | { view: "settings" }
  | { view: "project"; id: string }
  | { view: "chat"; id: string }

export function parseRoute(hash: string): Route {
  const [, view, id] = hash.replace(/^#/, "").split("/")
  if ((view === "project" || view === "chat") && id) return { view, id }
  if (view === "new-project" || view === "memories" || view === "settings") return { view }
  return { view: "home" }
}

export const go = (r: Route) => {
  location.hash = r.view === "project" || r.view === "chat" ? `/${r.view}/${r.id}` : r.view === "home" ? "" : `/${r.view}`
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash))
  useEffect(() => {
    const on = () => setRoute(parseRoute(location.hash))
    addEventListener("hashchange", on)
    return () => removeEventListener("hashchange", on)
  }, [])
  return route
}

export interface Data {
  projects: ReadonlyArray<Project>
  agents: ReadonlyArray<Agent>
  chats: ReadonlyArray<Chat>
  memories: ReadonlyArray<Memory>
  models: ReadonlyArray<ModelInfo>
  servers: ReadonlyArray<McpServer>
}

const empty: Data = { projects: [], agents: [], chats: [], memories: [], models: [], servers: [] }

export function useData() {
  const [data, setData] = useState<Data>(empty)
  const [error, setError] = useState<string>()
  const reload = useCallback(
    () =>
      call((c) => Effect.all({ projects: c.projects.list(), agents: c.agents.list(), chats: c.chats.list(), memories: c.memories.list(), models: c.settings.models(), servers: c.tools.list() }, { concurrency: "unbounded" }))
        .then((d) => {
          setData(d)
          setError(undefined)
        })
        .catch((e) => setError(`Não consegui falar com o server: ${e}`)),
    []
  )
  useEffect(() => void reload(), [reload])
  return { data, error, reload }
}

export const DataContext = createContext<{ data: Data; reload: () => Promise<void> }>({ data: empty, reload: async () => {} })
export const useApp = () => useContext(DataContext)

// Readable label for a memory scope.
export function scopeLabel(scope: string, data: Data): string {
  if (scope === "user") return "Você"
  const [kind, id] = scope.split(":")
  if (kind === "project") return `Projeto · ${data.projects.find((p) => p.id === id)?.name ?? "?"}`
  return `Agente · ${data.agents.find((a) => a.id === id)?.name ?? "?"}`
}

export const DEFAULT_MODEL = "claude-cli/sonnet"
