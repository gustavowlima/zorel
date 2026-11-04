// Storage (Settings › Storage): how much of the disk Zorel's data folder takes, where it goes and what can be
// freed. Measured on demand by walking the folder; nothing is cached. Cleanups only touch what no live chat or
// project uses: old database backups (the newest stays) and the folders left by deleted chats and projects.
// Workspace snapshots are never compacted: their trees have no refs, so `git gc` would delete the history
// diff and undo read.
import type { StorageReport } from "@zorel/contracts"
import { existsSync, readdirSync, rmSync, statfsSync } from "node:fs"
import { lstat, readdir } from "node:fs/promises"
import { join } from "node:path"
import { BACKUP } from "./migrate.ts"

// Bytes under a path (files and folders, symlinks not followed); 0 when it doesn't exist.
export async function sizeOf(path: string): Promise<{ bytes: number; files: number }> {
  const info = await lstat(path).catch(() => undefined)
  if (!info) return { bytes: 0, files: 0 }
  if (!info.isDirectory()) return { bytes: info.size, files: 1 }
  const entries = await readdir(path).catch(() => [] as string[])
  const parts = await Promise.all(entries.map((e) => sizeOf(join(path, e))))
  return parts.reduce((a, p) => ({ bytes: a.bytes + p.bytes, files: a.files + p.files }), { bytes: 0, files: 0 })
}

const list = (dir: string) => (existsSync(dir) ? readdirSync(dir) : [])
const backups = (dataDir: string) =>
  list(join(dataDir, "backups"))
    .filter((f) => BACKUP.test(f))
    .sort() // ISO date in the name: alphabetical = chronological
    .map((f) => join(dataDir, "backups", f))

// Folders of chats and projects that no longer exist.
function orphans(dataDir: string, chatIds: ReadonlySet<string>, projectIds: ReadonlySet<string>) {
  const chatDirs = ["attachments", "runs"].flatMap((d) => list(join(dataDir, d)).filter((id) => !id.startsWith("_") && !chatIds.has(id)).map((id) => join(dataDir, d, id)))
  const workspaces = list(join(dataDir, "workspaces"))
    .filter((f) => f.endsWith(".git") && !projectIds.has(f.slice(0, -4)))
    .map((f) => join(dataDir, "workspaces", f))
  return [...chatDirs, ...workspaces]
}

const sum = async (paths: ReadonlyArray<string>) => (await Promise.all(paths.map(sizeOf))).reduce((n, s) => n + s.bytes, 0)

export async function measure(
  dataDir: string,
  data: {
    projects: ReadonlyArray<{ id: string; name: string }>
    chats: ReadonlyArray<{ id: string; title: string; projectId: string | null }>
    messages: ReadonlyMap<string, number>
  }
): Promise<StorageReport> {
  const db = await sum(["zorel.db", "zorel.db-wal", "zorel.db-shm", "zero.db", "zero.db-wal", "zero.db-shm"].map((f) => join(dataDir, f)))
  const categories = {
    workspaces: (await sizeOf(join(dataDir, "workspaces"))).bytes,
    attachments: (await sizeOf(join(dataDir, "attachments"))).bytes,
    history: db,
    backups: (await sizeOf(join(dataDir, "backups"))).bytes,
    runs: (await sizeOf(join(dataDir, "runs"))).bytes,
    accounts: (await sizeOf(join(dataDir, "accounts"))).bytes,
    browser: (await sizeOf(join(dataDir, "browser"))).bytes // the agents' browser profile (logins, cache)
  }
  const total = (await sizeOf(dataDir)).bytes
  const known = Object.values(categories).reduce((n, b) => n + b, 0)

  const chats = await Promise.all(
    data.chats.map(async (c) => {
      const files = await sizeOf(join(dataDir, "attachments", c.id))
      const run = await sizeOf(join(dataDir, "runs", c.id))
      return { id: c.id, title: c.title, projectId: c.projectId, bytes: files.bytes + run.bytes, files: files.files, messages: data.messages.get(c.id) ?? 0 }
    })
  )
  const projects = await Promise.all(
    data.projects.map(async (p) => {
      const mine = chats.filter((c) => c.projectId === p.id)
      const snapshots = (await sizeOf(join(dataDir, "workspaces", `${p.id}.git`))).bytes
      return { id: p.id, name: p.name, bytes: snapshots + mine.reduce((n, c) => n + c.bytes, 0), chats: mine.length }
    })
  )
  let free: number | null = null
  try {
    const fs = statfsSync(dataDir)
    free = fs.bavail * fs.bsize
  } catch {
    free = null // not every file system reports it
  }
  return {
    measuredAt: Date.now(),
    total,
    free,
    categories: [...Object.entries(categories).map(([id, bytes]) => ({ id: id as keyof typeof categories, bytes })), { id: "other" as const, bytes: Math.max(0, total - known) }],
    projects: projects.sort((a, b) => b.bytes - a.bytes),
    chats: chats.filter((c) => c.bytes > 0).sort((a, b) => b.bytes - a.bytes).slice(0, 8),
    cleanup: [
      { id: "backups" as const, bytes: await sum(backups(dataDir).slice(0, -1)) },
      { id: "orphans" as const, bytes: await sum(orphans(dataDir, new Set(data.chats.map((c) => c.id)), new Set(data.projects.map((p) => p.id)))) }
    ]
  }
}

// Frees one cleanup item; returns what it removed.
export function clean(dataDir: string, id: "backups" | "orphans", chatIds: ReadonlySet<string>, projectIds: ReadonlySet<string>) {
  const paths = id === "backups" ? backups(dataDir).slice(0, -1) : orphans(dataDir, chatIds, projectIds)
  for (const p of paths) rmSync(p, { recursive: true, force: true })
  return paths.length
}
