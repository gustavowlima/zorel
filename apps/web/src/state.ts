// Route in the URL hash, and the theme preference. Data lives in atoms (client.ts), not here.
import { useEffect, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { type AccentCheck, accentTokens, checkAccent } from "./theme.ts"

export const SETTINGS_TABS = ["general", "team", "providers", "mcp", "skills", "channels", "processes", "storage", "audit"] as const
export type SettingsTab = (typeof SETTINGS_TABS)[number]
const PROJECT_TABS = ["overview", "agents", "tools"] as const
const AGENT_TABS = ["work", "profile", "tools", "memory", "activity"] as const
export type AgentTab = (typeof AGENT_TABS)[number]
export type ProjectTab = (typeof PROJECT_TABS)[number]

export type Route =
  | { view: "home"; projectId?: string }
  | { view: "inbox" }
  | { view: "agents" }
  | { view: "routines" }
  | { view: "routine-flow"; id: string } // spec 013: a routine's steps, as a list
  | { view: "routine-run"; id: string; runId: string } // one run, step by step
  | { view: "today" } // the morning brief (spec 012)
  | { view: "knowledge"; id: string } // an old link to one item: App sends it to Memory, Pages or Skills
  | { view: "memory"; tab?: string; review?: boolean } // tab: "user", "project:<id>", "agent:<id>" or "forgotten"; none: All
  | { view: "pages"; id?: string }
  | { view: "skills"; id?: string; file?: string } // id: a Zorel skill; file: the path of a skill on this computer
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
      // #/skills/computer: the old "On this computer" tab, now part of the one list.
      return a === "file" && b ? { view, file: decodeURIComponent(b) } : a && a !== "computer" ? { view, id: a } : { view }
    case "settings":
      // Old links: #/settings/accounts and #/settings/keys land on Providers, #/settings/appearance on General.
      if (a === "skills") return { view: "skills" }
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
      return r.file ? `#/skills/file/${encodeURIComponent(r.file)}` : r.id ? `#/skills/${r.id}` : "#/skills"
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
  const shown = useRef(route)
  useEffect(() => {
    // Going to another page crossfades (View Transitions API, where the engine has it); a tab or an id within the
    // same page, reduced motion, or an engine without it: the swap is immediate.
    const on = () => {
      const next = parseRoute(location.hash)
      const animate = next.view !== shown.current.view && "startViewTransition" in document && !matchMedia("(prefers-reduced-motion: reduce)").matches
      shown.current = next
      if (animate) document.startViewTransition(() => flushSync(() => setRoute(next)))
      else setRoute(next)
    }
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
  const v = stored(THEME_KEY)
  return v === "dark" || v === "light" ? v : "system"
}

export function applyTheme() {
  const pref = themePref()
  document.documentElement.dataset.theme = pref === "system" ? (prefersLight.matches ? "light" : "dark") : pref
  applyAccent()
}

// Spec 018: the first agent made from the first run gets a "ready" step. "pending" while the Builder is open from
// there; the agent's id once made (builder.tsx); cleared when the person moves on (first-run.tsx).
export const READY_KEY = "zorel.firstRun.ready"

// ---------- the action colour (spec 018): blue by default, a person's own colour per browser ----------

const ACCENT_KEY = "zorel.accent"
const ACCENT_TOKENS = ["--z-accent", "--z-accent-hover", "--z-accent-text"]

// The stored override, only when it still passes (a value saved by an older build can't break the buttons).
export function accentPref(): string | null {
  const v = stored(ACCENT_KEY)
  const check = v ? checkAccent(v) : null
  return check?.ok ? check.hex : null
}

function applyAccent() {
  const root = document.documentElement.style
  for (const name of ACCENT_TOKENS) root.removeProperty(name)
  const hex = accentPref()
  if (!hex) return
  for (const [name, value] of Object.entries(accentTokens(hex, resolvedTheme()))) root.setProperty(name, value)
}

// Saves and applies a colour, or says why not; null goes back to the default blue.
export function setAccentPref(value: string | null): AccentCheck | null {
  if (value === null) {
    store(ACCENT_KEY, null)
    applyAccent()
    return null
  }
  const check = checkAccent(value)
  if (check.ok) {
    store(ACCENT_KEY, check.hex)
    applyAccent()
  }
  return check
}

export function setThemePref(pref: ThemePref) {
  store(THEME_KEY, pref === "system" ? null : pref)
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

export const liveStepsOpen = () => stored(STEPS_OPEN_KEY) !== "0"
export const setLiveStepsOpen = (open: boolean) => store(STEPS_OPEN_KEY, open ? "1" : "0")

// ---------- per-browser memory: blocked storage (a private window, a policy) reads as empty and keeps nothing ----------

export function stored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
// null removes the key.
export function store(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {}
}
// A value kept as JSON; undefined when absent or unreadable (an old shape), and undefined removes it.
export function storedJson<T>(key: string): T | undefined {
  try {
    const raw = stored(key)
    return raw ? (JSON.parse(raw) as T) : undefined
  } catch {
    return undefined
  }
}
export const storeJson = (key: string, value: unknown) => store(key, value === undefined ? null : JSON.stringify(value))

export const readSet = (key: string) => new Set(storedJson<string[]>(key) ?? [])
export const writeSet = (key: string, set: ReadonlySet<string>) => storeJson(key, [...set])

// ---------- the chats sidebar: shown or folded away (per browser); ⌘B / Ctrl+B toggles it ----------

const SIDEBAR_KEY = "zorel.sidebar.hidden"

// A narrow window (under 900px) folds the sidebar away so the content keeps its room; opening it there is for the
// moment and never overwrites the choice made on a wide window.
const NARROW = "(max-width: 899px)"

export function useSidebar(): { hidden: boolean; toggle: () => void; show: () => void } {
  const [hidden, setHidden] = useState(() => stored(SIDEBAR_KEY) === "1")
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
    store(SIDEBAR_KEY, next ? "1" : "0")
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
