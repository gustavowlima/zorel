// Route in the URL hash, and the theme preference. Data lives in atoms (client.ts), not here.
import { useEffect, useRef, useState } from "react"

export const SETTINGS_TABS = ["general", "providers", "mcp", "skills", "channels", "processes", "storage", "audit"] as const
export type SettingsTab = (typeof SETTINGS_TABS)[number]
export const PROJECT_TABS = ["overview", "agents", "tools"] as const
export const AGENT_TABS = ["work", "profile", "tools", "memory", "activity"] as const
export type AgentTab = (typeof AGENT_TABS)[number]
export type ProjectTab = (typeof PROJECT_TABS)[number]

export type Route =
  | { view: "home"; projectId?: string }
  | { view: "inbox" }
  | { view: "agents" }
  | { view: "routines" }
  | { view: "routine-flow"; id: string } // spec 013: a routine's steps, on a canvas or as a list
  | { view: "routine-run"; id: string; runId: string } // one run, step by step
  | { view: "today" } // the morning brief (spec 012)
  | { view: "knowledge"; id: string } // an old link to one item: App sends it to Memory, Pages or Skills
  | { view: "memory"; tab?: string; review?: boolean } // tab: "user", "project:<id>", "agent:<id>" or "forgotten"; none: All
  | { view: "pages"; id?: string }
  | { view: "skills"; id?: string; computer?: boolean } // computer: the skills already on this computer
  | { view: "usage"; agentId?: string } // agentId: Usage filtered to one agent (from its page)
  | { view: "settings"; tab: SettingsTab; provider?: string } // provider: one provider's page under Providers
  | { view: "project"; id: string; tab: ProjectTab }
  | { view: "chat"; id: string; at?: string } // at: open on that message (a session's reply)
  | { view: "agent"; id: string; tab?: AgentTab } // tab: which one opens (Profile when absent)
  | { view: "new-agent"; projectId: string | null; teamId?: string } // teamId: "New agent in this team"
  | { view: "builder"; projectId: string | null } // Build with AI: a screen of its own, not a chat

const oneOf = <T extends string>(list: ReadonlyArray<T>, v: string | undefined, fallback: T): T => (list.includes(v as T) ? (v as T) : fallback)

export function parseRoute(hash: string): Route {
  const [, view, a, b, c] = hash.replace(/^#/, "").split("/")
  switch (view) {
    case "agents":
    case "routines":
    case "today":
      return { view }
    case "inbox":
    case "usage":
      return a ? { view, agentId: a } : { view }
    case "knowledge":
      // Old links: #/knowledge/in:<scope>[/fact|skill] and #/knowledge/<id> (Knowledge became Memory, Pages and Skills).
      if (a?.startsWith("in:")) return b === "skill" ? { view: "skills" } : { view: "memory", tab: decodeURIComponent(a.slice(3)) }
      return a ? { view, id: a } : { view: "memory" }
    case "memory":
      // #/memory, #/memory/<tab>, #/memory/review
      return a === "review" ? { view, review: true } : a ? { view, tab: decodeURIComponent(a) } : { view }
    case "pages":
      return a ? { view, id: a } : { view }
    case "skills":
      return a === "computer" ? { view, computer: true } : a ? { view, id: a } : { view }
    case "settings":
      // Old links: #/settings/accounts and #/settings/keys land on Providers, #/settings/appearance on General,
      // #/settings/skills on Skills › On this computer.
      if (a === "skills") return { view: "skills", computer: true }
      return { view, tab: a === "appearance" ? "general" : a === "accounts" || a === "keys" ? "providers" : oneOf(SETTINGS_TABS, a, "general"), ...(a === "providers" && b && { provider: b }) }
    case "project":
      return a ? { view, id: a, tab: oneOf(PROJECT_TABS, b, "overview") } : { view: "home" }
    case "chat":
      return a ? { view, id: a, ...(b && { at: b }) } : { view: "home" }
    case "agent":
      if (a === "new") return { view: "new-agent", projectId: b && b !== "global" ? b : null, ...(c && { teamId: decodeURIComponent(c) }) }
      return a ? { view, id: a, ...(b && { tab: oneOf(AGENT_TABS, b, "profile") }) } : { view: "home" }
    case "new":
      return a ? { view: "home", projectId: a } : { view: "home" }
    case "routine":
      // #/routine/<id>/flow, #/routine/<id>/run/<runId>
      return a && b === "run" && c ? { view: "routine-run", id: a, runId: c } : a ? { view: "routine-flow", id: a } : { view: "routines" }
    case "build":
      return { view: "builder", projectId: a && a !== "global" ? a : null } // "global": the same as no project, as for a new agent
    default:
      return { view: "home" }
  }
}

export const hrefOf = (r: Route): string => {
  switch (r.view) {
    case "home":
      return r.projectId ? `#/new/${r.projectId}` : "#/"
    case "knowledge":
      return `#/knowledge/${r.id}`
    case "memory":
      return r.review ? "#/memory/review" : r.tab ? `#/memory/${encodeURIComponent(r.tab)}` : "#/memory"
    case "pages":
      return r.id ? `#/pages/${r.id}` : "#/pages"
    case "skills":
      return r.computer ? "#/skills/computer" : r.id ? `#/skills/${r.id}` : "#/skills"
    case "settings":
      return r.provider ? `#/settings/${r.tab}/${r.provider}` : `#/settings/${r.tab}`
    case "project":
      return r.tab === "overview" ? `#/project/${r.id}` : `#/project/${r.id}/${r.tab}`
    case "chat":
      return r.at ? `#/chat/${r.id}/${r.at}` : `#/chat/${r.id}`
    case "agent":
      return r.tab ? `#/agent/${r.id}/${r.tab}` : `#/agent/${r.id}`
    case "new-agent":
      return `#/agent/new/${r.projectId ?? "global"}${r.teamId ? `/${encodeURIComponent(r.teamId)}` : ""}`
    case "builder":
      return r.projectId ? `#/build/${r.projectId}` : "#/build"
    case "usage":
      return r.agentId ? `#/usage/${r.agentId}` : "#/usage"
    case "routine-flow":
      return `#/routine/${r.id}/flow`
    case "routine-run":
      return `#/routine/${r.id}/run/${r.runId}`
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
const THEME_KEY = "zorel.theme"
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

// ---------- the steps of a reply in progress: open (default) or folded into one line; per browser ----------

const STEPS_OPEN_KEY = "zorel.steps.open"

export function liveStepsOpen(): boolean {
  try {
    return localStorage.getItem(STEPS_OPEN_KEY) !== "0"
  } catch {
    return true // storage blocked: the default
  }
}

export function setLiveStepsOpen(open: boolean) {
  try {
    localStorage.setItem(STEPS_OPEN_KEY, open ? "1" : "0")
  } catch {
    // storage blocked: the choice lasts until the page reloads
  }
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

const SIDEBAR_KEY = "zorel.sidebar.hidden"

// A narrow window (under 900px) folds the sidebar away so the content keeps its room; opening it there is for the
// moment and never overwrites the choice made on a wide window.
const NARROW = "(max-width: 899px)"

export function useSidebar(): { hidden: boolean; toggle: () => void; show: () => void } {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === "1"
    } catch {
      return false
    }
  })
  const [narrow, setNarrow] = useState(() => matchMedia(NARROW).matches)
  const [peek, setPeek] = useState(false) // opened while narrow
  useEffect(() => {
    const mq = matchMedia(NARROW)
    const on = () => {
      setNarrow(mq.matches)
      setPeek(false)
    }
    mq.addEventListener("change", on)
    return () => mq.removeEventListener("change", on)
  }, [])
  const save = (next: boolean) => {
    setHidden(next)
    try {
      localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0")
    } catch {
      // storage blocked: it resets on reload
    }
  }
  const shown = narrow ? peek : !hidden
  const set = (open: boolean) => (narrow ? setPeek(open) : save(!open))
  // The shortcut reads the latest state through a ref (the listener is added once).
  const toggleRef = useRef(() => {})
  toggleRef.current = () => set(!shown)
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault()
        toggleRef.current()
      }
    }
    addEventListener("keydown", on)
    return () => removeEventListener("keydown", on)
  }, [])
  return { hidden: !shown, toggle: () => set(!shown), show: () => set(true) }
}
