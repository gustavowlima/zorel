// Skills already on this computer: the person's own SKILL.md files for Claude Code,
// Codex and other agents, and Claude Code plugins'. Zorel lists them (name, description, where from); the person
// picks which ones Zorel's agents use. A picked skill is read from its file when an agent reads it, so it stays
// current and nothing is copied. Only a path found by this scan can be picked (never an arbitrary file).
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Memory } from "@zorel/contracts"

export interface FileSkill {
  readonly path: string // the SKILL.md (real path)
  readonly name: string
  readonly description: string
  readonly source: "claude" | "codex" | "agents" | "plugin"
  readonly plugin?: string | undefined // a plugin's name, for plugin skills
}

const MAX_BODY = 20_000

// The frontmatter's name and description (one-line values, quoted or not, or a folded/literal block).
export function frontmatter(text: string): { name?: string; description?: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!m) return {}
  const out: Record<string, string> = {}
  const lines = m[1]!.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(lines[i]!)
    if (!kv) continue
    let value = kv[2]!.trim()
    if (value === ">" || value === "|" || value === ">-" || value === "|-") {
      const block: string[] = []
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]!)) block.push(lines[++i]!.trim())
      value = block.join(" ")
    }
    out[kv[1]!] = value.replace(/^(['"])([\s\S]*)\1$/, "$2")
  }
  return { ...(out.name && { name: out.name }), ...(out.description && { description: out.description }) }
}

const dirs = (p: string) => {
  try {
    return readdirSync(p, { withFileTypes: true })
      .filter((d) => d.isDirectory() || d.isSymbolicLink())
      .map((d) => d.name)
  } catch {
    return []
  }
}

// <root>/<skill>/SKILL.md
function inFolder(root: string, source: FileSkill["source"], plugin?: string): FileSkill[] {
  return dirs(root).flatMap((d) => {
    const file = join(root, d, "SKILL.md")
    if (!existsSync(file)) return []
    try {
      const fm = frontmatter(readFileSync(file, "utf8").slice(0, 8000))
      return [{ path: realpathSync(file), name: fm.name ?? d, description: (fm.description ?? "").slice(0, 500), source, ...(plugin && { plugin }) }]
    } catch {
      return []
    }
  })
}

// Claude Code plugins: ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/skills/<skill>/SKILL.md, the newest
// version of each plugin.
function plugins(home: string): FileSkill[] {
  const cache = join(home, ".claude", "plugins", "cache")
  return dirs(cache).flatMap((market) =>
    dirs(join(cache, market)).flatMap((plugin) => {
      const versions = dirs(join(cache, market, plugin))
        .map((v) => ({ v, at: statSync(join(cache, market, plugin, v)).mtimeMs }))
        .sort((a, b) => b.at - a.at)
      const newest = versions.find(({ v }) => existsSync(join(cache, market, plugin, v, "skills")))
      return newest ? inFolder(join(cache, market, plugin, newest.v, "skills"), "plugin", plugin) : []
    })
  )
}

// Every skill found, once each (a folder linked into two places counts once), by source then name.
export function discover(home = homedir()): FileSkill[] {
  const found = [
    ...inFolder(join(home, ".claude", "skills"), "claude"),
    ...inFolder(join(home, ".codex", "skills"), "codex"),
    ...inFolder(join(home, ".agents", "skills"), "agents"),
    ...plugins(home)
  ]
  const seen = new Set<string>()
  return found.filter((s) => (seen.has(s.path) ? false : (seen.add(s.path), true))).sort((a, b) => a.name.localeCompare(b.name))
}

// A picked skill's steps (frontmatter removed), read now.
export function readSkill(path: string): string {
  return readFileSync(path, "utf8").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim().slice(0, MAX_BODY)
}

// The scan, kept for 30 s (a turn and the Settings list don't re-read every folder each time).
let cache: { at: number; list: FileSkill[] } | undefined
export const discovered = (): FileSkill[] => {
  if (!cache || Date.now() - cache.at > 30_000) cache = { at: Date.now(), list: discover() }
  return cache.list
}

// The picked ones: preference "fileSkills", a JSON list where each entry is a path (every agent uses it, the
// first format) or { path, agents } (only those agents do).
export interface Pick {
  readonly path: string
  readonly agents: ReadonlyArray<string> // empty: all
}
export const pickedEntries = (pref: string | undefined): Pick[] => {
  try {
    const v = JSON.parse(pref ?? "[]")
    if (!Array.isArray(v)) return []
    return v.flatMap((e): Pick[] => {
      if (typeof e === "string") return [{ path: e, agents: [] }]
      if (e && typeof e === "object" && typeof e.path === "string")
        return [{ path: e.path, agents: Array.isArray(e.agents) ? e.agents.filter((x: unknown): x is string => typeof x === "string") : [] }]
      return []
    })
  } catch {
    return []
  }
}
export const serializePicks = (entries: ReadonlyArray<Pick>): string => JSON.stringify(entries.map((e) => (e.agents.length ? { path: e.path, agents: e.agents } : e.path)))
type PickedSkill = FileSkill & { readonly agents: ReadonlyArray<string> }
// Among those still on disk. forAgent: the agent that uses them (the ones for other agents stay out; null: no agent,
// only the ones for everyone); undefined: all of them.
export const picked = (pref: string | undefined, forAgent?: string | null): PickedSkill[] => {
  const by = new Map(pickedEntries(pref).map((e) => [e.path, e.agents]))
  if (!by.size) return []
  return discovered()
    .filter((s) => by.has(s.path))
    .map((s) => ({ ...s, agents: by.get(s.path)! }))
    .filter((s) => usedBy(s.agents, forAgent))
}
// Whether an agent uses a skill limited to these agents (none listed: all do; forAgent undefined: no filter, null: no agent).
export const usedBy = (agents: ReadonlyArray<string>, forAgent: string | null | undefined): boolean =>
  forAgent === undefined || !agents.length || (forAgent !== null && agents.includes(forAgent))

// A picked skill in the agents' list of skills: its title and what it's for (the steps are read on demand).
export const asMemory = (s: FileSkill & { readonly agents?: ReadonlyArray<string> }): Memory => ({
  id: `file:${s.path}`, scope: "user", kind: "skill", title: s.name, text: s.description, state: "active", origin: "manual", chatId: null, agents: s.agents ?? [], createdAt: 0, confirmedAt: 0
})
