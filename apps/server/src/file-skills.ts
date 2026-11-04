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

// The picked ones (preference "fileSkills": their paths), among those still on disk.
export const pickedPaths = (pref: string | undefined): string[] => {
  try {
    const v = JSON.parse(pref ?? "[]")
    return Array.isArray(v) ? v.filter((p): p is string => typeof p === "string") : []
  } catch {
    return []
  }
}
export const picked = (pref: string | undefined): FileSkill[] => {
  const paths = new Set(pickedPaths(pref))
  return paths.size ? discovered().filter((s) => paths.has(s.path)) : []
}

// A picked skill in the agents' list of skills: its title and what it's for (the steps are read on demand).
export const asMemory = (s: FileSkill): Memory => ({
  id: `file:${s.path}`, scope: "user", kind: "skill", title: s.name, text: s.description, state: "active", origin: "manual", chatId: null, createdAt: 0, confirmedAt: 0
})
