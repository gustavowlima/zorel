// Route in the URL hash, and the theme preference. Data lives in atoms (client.ts), not here.
import { useEffect, useState } from "react"

export const SETTINGS_TABS = ["general", "providers", "mcp", "skills", "storage", "audit"] as const
export type SettingsTab = (typeof SETTINGS_TABS)[number]
export const PROJECT_TABS = ["overview", "agents", "tools"] as const
export type ProjectTab = (typeof PROJECT_TABS)[number]

export type Route =
  | { view: "home"; projectId?: string }
  | { view: "inbox" }
  | { view: "agents" }
  | { view: "routines" }
  | { view: "knowledge"; id?: string }
  | { view: "usage"; agentId?: string } // agentId: Usage filtered to one agent (from its page)
  | { view: "settings"; tab: SettingsTab; provider?: string } // provider: one provider's page under Providers
  | { view: "project"; id: string; tab: ProjectTab }
  | { view: "chat"; id: string }
  | { view: "agent"; id: string }
  | { view: "new-agent"; projectId: string | null }
  | { view: "builder"; projectId: string | null } // Build with AI: a screen of its own, not a chat

const oneOf = <T extends string>(list: ReadonlyArray<T>, v: string | undefined, fallback: T): T => (list.includes(v as T) ? (v as T) : fallback)

export function parseRoute(hash: string): Route {
  const [, view, a, b] = hash.replace(/^#/, "").split("/")
  switch (view) {
    case "agents":
    case "routines":
      return { view }
    case "inbox":
    case "usage":
      return a ? { view, agentId: a } : { view }
    case "knowledge":
      return a ? { view, id: a } : { view }
    case "settings":
      // Old links: #/settings/accounts and #/settings/keys land on Providers, #/settings/appearance on General.
      return { view, tab: a === "appearance" ? "general" : a === "accounts" || a === "keys" ? "providers" : oneOf(SETTINGS_TABS, a, "general"), ...(a === "providers" && b && { provider: b }) }
    case "project":
      return a ? { view, id: a, tab: oneOf(PROJECT_TABS, b, "overview") } : { view: "home" }
    case "chat":
      return a ? { view, id: a } : { view: "home" }
    case "agent":
      if (a === "new") return { view: "new-agent", projectId: b && b !== "global" ? b : null }
      return a ? { view, id: a } : { view: "home" }
    case "new":
      return a ? { view: "home", projectId: a } : { view: "home" }
    case "build":
      return { view: "builder", projectId: a ?? null }
    default:
      return { view: "home" }
  }
}

export const hrefOf = (r: Route): string => {
  switch (r.view) {
    case "home":
      return r.projectId ? `#/new/${r.projectId}` : "#/"
    case "knowledge":
      return r.id ? `#/knowledge/${r.id}` : "#/knowledge"
    case "settings":
      return r.provider ? `#/settings/${r.tab}/${r.provider}` : `#/settings/${r.tab}`
    case "project":
      return r.tab === "overview" ? `#/project/${r.id}` : `#/project/${r.id}/${r.tab}`
    case "chat":
    case "agent":
      return `#/${r.view}/${r.id}`
    case "new-agent":
      return `#/agent/new/${r.projectId ?? "global"}`
    case "builder":
      return r.projectId ? `#/build/${r.projectId}` : "#/build"
    case "usage":
      return r.agentId ? `#/usage/${r.agentId}` : "#/usage"
    default:
      return `#/${r.view}`
  }
}

export const go = (r: Route) => {
  location.hash = hrefOf(r)
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

// ---------- theme: system (default), dark or light; per browser ----------

export type ThemePref = "system" | "dark" | "light"
const THEME_KEY = "zero.theme"
const prefersLight = matchMedia("(prefers-color-scheme: light)")

export function themePref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === "dark" || v === "light" ? v : "system"
  } catch {
    return "system" // storage blocked: follow the system
  }
}

export function applyTheme() {
  const pref = themePref()
  document.documentElement.dataset.theme = pref === "system" ? (prefersLight.matches ? "light" : "dark") : pref
}

export function setThemePref(pref: ThemePref) {
  try {
    if (pref === "system") localStorage.removeItem(THEME_KEY)
    else localStorage.setItem(THEME_KEY, pref)
  } catch {
    // storage blocked: the choice lasts until the page reloads
  }
  applyTheme()
}

prefersLight.addEventListener("change", applyTheme)

// The theme in effect now (dark or light), following changes to the preference or the system.
const resolvedTheme = (): "dark" | "light" => (document.documentElement.dataset.theme === "light" ? "light" : "dark")

export function useResolvedTheme(): "dark" | "light" {
  const [theme, setTheme] = useState(resolvedTheme)
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(resolvedTheme()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] })
    return () => observer.disconnect()
  }, [])
  return theme
}

// ---------- small per-browser UI memory (expanded projects) ----------

export function readSet(key: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) ?? "[]") as string[])
  } catch {
    return new Set()
  }
}
export function writeSet(key: string, set: ReadonlySet<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...set]))
  } catch {
    // storage blocked: it resets on reload
  }
}

// ---------- the chats sidebar: shown or folded away (per browser); ⌘B / Ctrl+B toggles it ----------

const SIDEBAR_KEY = "zero.sidebar.hidden"

export function useSidebar(): { hidden: boolean; toggle: () => void; show: () => void } {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === "1"
    } catch {
      return false
    }
  })
  const save = (next: boolean) => {
    setHidden(next)
    try {
      localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0")
    } catch {
      // storage blocked: it resets on reload
    }
  }
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault()
        setHidden((h) => {
          try {
            localStorage.setItem(SIDEBAR_KEY, h ? "0" : "1")
          } catch {}
          return !h
        })
      }
    }
    addEventListener("keydown", on)
    return () => removeEventListener("keydown", on)
  }, [])
  return { hidden, toggle: () => save(!hidden), show: () => save(false) }
}
