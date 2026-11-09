// Moving a workspace to another computer: export is one .tar.gz with a consistent copy of the database
// (VACUUM INTO), the attachments and a manifest; import checks such a file, keeps it as pending and applies it on the
// next start, before the database opens (the running one can't be swapped), keeping the current data as a backup.
// Never in the file: secrets (API keys, connector sign-ins: they live in the keychain), the CLIs' sign-ins (accounts/),
// restore points (workspaces/), browser profiles and backups. On the new computer you sign in again.
import { Database } from "bun:sqlite"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative, resolve, sep } from "node:path"
import { PAGES_DIR } from "./page-files.ts"

export const FORMAT = 1
export const PENDING = "import-pending.tar.gz"
export const MAX_IMPORT_BYTES = 2 * 1024 ** 3

interface Manifest {
  readonly format: number
  readonly app: "zorel"
  readonly exportedAt: number
  readonly dataDir: string // where it came from: attachment paths are rewritten from this
}

// Every file under a folder, as paths relative to it ("/" separators, as in the archive).
function filesUnder(root: string): string[] {
  if (!existsSync(root)) return []
  const out: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile()) out.push(relative(root, p).split(sep).join("/"))
    }
  }
  walk(root)
  return out
}

// ponytail: the whole archive is built in memory; stream it if workspaces with gigabytes of attachments show up.
export async function exportWorkspace(dbPath: string, dataDir: string): Promise<Uint8Array> {
  const tmp = mkdtempSync(join(tmpdir(), "zorel-export-"))
  try {
    const copy = join(tmp, "zorel.db")
    const db = new Database(dbPath) // VACUUM INTO writes nothing from a read-only connection
    try {
      db.run(`VACUUM INTO '${copy.replaceAll("'", "''")}'`)
    } finally {
      db.close()
    }
    const files: Record<string, Uint8Array | string> = {
      "manifest.json": JSON.stringify({ format: FORMAT, app: "zorel", exportedAt: Date.now(), dataDir } satisfies Manifest),
      "zorel.db": await Bun.file(copy).bytes()
    }
    // Read now: Bun.Archive takes a Bun.file() as empty.
    for (const f of filesUnder(join(dataDir, "attachments"))) files[`attachments/${f}`] = await Bun.file(join(dataDir, "attachments", f)).bytes()
    return await new Bun.Archive(files, { compress: "gzip" }).bytes()
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

// Opens a file someone gave us and checks it is a Zorel export: the manifest, and a database with Zorel's tables.
// `base`: where to unpack (inside the data folder when applying, so moving files never crosses disks).
async function open(bytes: Uint8Array, base = tmpdir()): Promise<{ dir: string; manifest: Manifest; counts: { projects: number; chats: number } }> {
  mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, "zorel-import-"))
  try {
    await new Bun.Archive(bytes).extract(dir, { glob: ["manifest.json", "zorel.db", "attachments/**"] })
    const manifest = JSON.parse(await Bun.file(join(dir, "manifest.json")).text()) as Manifest
    if (manifest.app !== "zorel" || manifest.format !== FORMAT) throw new Error("not a Zorel export")
    const db = new Database(join(dir, "zorel.db"), { readonly: true })
    try {
      const count = (table: string) => (db.query(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n
      return { dir, manifest, counts: { projects: count("projects"), chats: count("chats") } }
    } finally {
      db.close()
    }
  } catch (e) {
    rmSync(dir, { recursive: true, force: true })
    throw e instanceof Error && e.message === "not a Zorel export" ? e : new Error("not a Zorel export")
  }
}

// Keeps a checked export as pending; the next start applies it. Returns what it holds, to show before restarting.
export async function stageImport(bytes: Uint8Array, dataDir: string): Promise<{ projects: number; chats: number }> {
  const { dir, counts } = await open(bytes)
  rmSync(dir, { recursive: true, force: true })
  await Bun.write(join(dataDir, PENDING), bytes)
  return counts
}

export const pendingImport = (dataDir: string) => existsSync(join(dataDir, PENDING))
export const cancelImport = (dataDir: string) => rmSync(join(dataDir, PENDING), { force: true })

// At start, before the database opens: the current database and attachments move to backups/before-import-<time>/,
// the imported ones take their place, and attachment paths are rewritten to this computer's data folder.
export async function applyPendingImport(dataDir: string, dbPath: string): Promise<boolean> {
  const pending = join(dataDir, PENDING)
  if (!existsSync(pending)) return false
  const { dir, manifest } = await open(await Bun.file(pending).bytes(), join(dataDir, "tmp")).catch((e: unknown) => {
    rmSync(pending, { force: true }) // unreadable: drop it rather than fail every start
    throw e
  })
  try {
    const keep = join(dataDir, "backups", `before-import-${new Date().toISOString().replace(/[:.]/g, "-")}`)
    mkdirSync(keep, { recursive: true })
    for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) if (existsSync(f)) renameSync(f, join(keep, f.split(sep).pop()!))
    if (existsSync(join(dataDir, "attachments"))) renameSync(join(dataDir, "attachments"), join(keep, "attachments"))
    // The pages' files go with the old database; the imported one writes its own on start (syncPages).
    if (existsSync(join(dataDir, PAGES_DIR))) renameSync(join(dataDir, PAGES_DIR), join(keep, PAGES_DIR))
    renameSync(join(dir, "zorel.db"), dbPath)
    if (existsSync(join(dir, "attachments"))) renameSync(join(dir, "attachments"), join(dataDir, "attachments"))
    const db = new Database(dbPath)
    try {
      const from = join(manifest.dataDir, "attachments")
      const to = join(dataDir, "attachments")
      const root = resolve(to) + sep
      for (const r of db.query("SELECT id, path FROM attachments").all() as Array<{ id: string; path: string }>) {
        // Only files inside this computer's attachments folder: the archive chooses both the paths and dataDir.
        const p = r.path.startsWith(from) ? resolve(to, ...r.path.slice(from.length).split(/[\\/]/).filter(Boolean)) : resolve(r.path)
        if (p.startsWith(root)) db.run("UPDATE attachments SET path = ? WHERE id = ?", [p, r.id])
        else db.run("DELETE FROM attachments WHERE id = ?", [r.id])
      }
      // Whatever runs by itself or with more reach arrives off: the owner turns it back on after a look. The archive
      // may be someone else's.
      db.run("UPDATE routines SET enabled = 0, next_run_at = NULL")
      db.run("UPDATE mcp_servers SET enabled = 0")
      db.run("UPDATE agents SET access = 'ask' WHERE access = 'full'")
    } finally {
      db.close()
    }
    rmSync(pending, { force: true })
    return true
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
