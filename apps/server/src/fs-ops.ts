// The Files panel's operations on a chat's folder (as in an editor's explorer): new file, rename, move, delete to
// Zorel's trash (undo puts it back), reveal in the system's file manager, open in the default app. Every path is
// checked to be inside the folder (on Windows too: relative paths, either separator). Windows, macOS and Linux.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"

export class FsError extends Error {}

// The absolute path for `path` (relative to `root`), or an error when it leaves the folder.
export function inside(root: string, path: string): string {
  const abs = resolve(root, path)
  const rel = relative(root, abs)
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new FsError("outside the folder")
  return abs
}

// A move that also works across disks (rename fails with EXDEV there: copy, then remove).
function move(from: string, to: string) {
  mkdirSync(dirname(to), { recursive: true })
  try {
    renameSync(from, to)
  } catch (e) {
    if ((e as { code?: string }).code !== "EXDEV") throw e
    cpSync(from, to, { recursive: true })
    rmSync(from, { recursive: true, force: true })
  }
}

export function createFile(root: string, path: string) {
  const abs = inside(root, path)
  if (existsSync(abs)) throw new FsError("already exists")
  mkdirSync(dirname(abs), { recursive: true }) // "src/new/a.ts" makes the folders, as an editor does
  writeFileSync(abs, "")
}

export function renamePath(root: string, from: string, to: string) {
  const [a, b] = [inside(root, from), inside(root, to)]
  if (!existsSync(a)) throw new FsError("not found")
  if (existsSync(b)) throw new FsError("already exists")
  move(a, b)
}

// The selection without items inside a selected folder (they go with it).
const outermost = (paths: ReadonlyArray<string>) => paths.filter((p) => !paths.some((q) => q !== p && p.startsWith(`${q}/`)))

// Into a folder of the tree ("" is the root). A folder can't go into itself.
export function moveInto(root: string, paths: ReadonlyArray<string>, folder: string) {
  const target = folder ? inside(root, folder) : root
  for (const p of outermost(paths)) {
    const from = inside(root, p)
    const to = join(target, basename(from))
    if (to === from) continue
    if (`${target}${sep}`.startsWith(`${from}${sep}`)) throw new FsError("a folder can't go into itself")
    if (existsSync(to)) throw new FsError(`${basename(from)} already exists there`)
    move(from, to)
  }
}

// Deleted items go to <trash>/<id>/ keeping their paths; `id` undoes it while it's there (a week).
const KEEP_MS = 7 * 86_400_000
export function trash(root: string, paths: ReadonlyArray<string>, trashDir: string): string {
  const id = `${Date.now()}`
  if (existsSync(trashDir)) for (const old of readdirSync(trashDir)) if (Number(old) < Date.now() - KEEP_MS) rmSync(join(trashDir, old), { recursive: true, force: true })
  for (const p of outermost(paths)) {
    const from = inside(root, p)
    if (existsSync(from)) move(from, join(trashDir, id, relative(root, from)))
  }
  return id
}

export function restore(root: string, id: string, trashDir: string) {
  if (!/^\d+$/.test(id)) throw new FsError("unknown")
  const dir = join(trashDir, id)
  if (!existsSync(dir)) throw new FsError("already emptied")
  // Each entry goes back whole where its place is free; into a folder that exists again, entry by entry.
  const back = (from: string) => {
    const to = inside(root, relative(dir, from))
    if (!existsSync(to)) return move(from, to)
    if (statSync(from).isDirectory()) for (const n of readdirSync(from)) back(join(from, n))
  }
  for (const n of readdirSync(dir)) back(join(dir, n))
  rmSync(dir, { recursive: true, force: true })
}

// A file's text for the viewer; null when it's binary (a NUL byte early on) or too big to show.
const MAX_VIEW_BYTES = 1024 * 1024
export function readText(root: string, path: string): { contents: string | null; size: number } {
  const abs = inside(root, path)
  const { size } = statSync(abs)
  if (size > MAX_VIEW_BYTES) return { contents: null, size }
  const bytes = readFileSync(abs)
  return { contents: bytes.subarray(0, 8000).includes(0) ? null : bytes.toString("utf8"), size }
}

// The system's own commands: open in the default app, or show it selected in the file manager.
export function osCommand(action: "open" | "reveal", abs: string, platform = process.platform): string[] {
  if (platform === "darwin") return action === "open" ? ["open", abs] : ["open", "-R", abs]
  // Windows: never through cmd, which would read & | ^ in a file name as commands. FileProtocolHandler takes the rest
  // of its command line as the path.
  if (platform === "win32") return action === "open" ? ["rundll32", "url.dll,FileProtocolHandler", abs] : ["explorer", `/select,${abs}`]
  return ["xdg-open", action === "open" ? abs : dirname(abs)] // Linux file managers don't share a "select" flag
}
