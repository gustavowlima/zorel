// Knowledge pages as Markdown files: the folder is the truth, SQLite indexes it (search, versions, pins).
//   <dataDir>/knowledge/you/<Title>.md · projects/<project>/<Title>.md · agents/<agent>/<Title>.md
// The file name is the title (as Obsidian does); a short front matter keeps what the name can't:
//   ---
//   id: 3f9c…
//   scope: project:7a1e…
//   pinned: true
//   ---
// Pure helpers here; the Store writes through them and reads edits made outside Zorel (db.ts syncPages).
import { createHash } from "node:crypto"
import { type Dirent, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, relative, sep } from "node:path"

export const PAGES_DIR = "knowledge" // inside the data folder

export const hashOf = (text: string) => createHash("sha256").update(text).digest("base64url")

// "Zorel App" → "zorel-app": a project's or agent's folder.
export const slugOf = (name: string) =>
  name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "untitled"

// A title as a file name: no path separators or characters Windows refuses, no leading dot, at most 100 characters.
export const fileTitle = (title: string) =>
  title
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what a file name can't hold
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 100) || "Untitled"

interface PageFile {
  readonly id: string
  readonly scope: string
  readonly title: string
  readonly pinned: boolean
  readonly body: string
}

// The file's text. The title goes in the front matter only when the file name can't carry it as it is.
export function pageText(p: PageFile): string {
  const front = [`id: ${p.id}`, `scope: ${p.scope}`, `pinned: ${p.pinned}`, ...(fileTitle(p.title) === p.title ? [] : [`title: ${JSON.stringify(p.title)}`])]
  return `---\n${front.join("\n")}\n---\n${p.body}${p.body.endsWith("\n") ? "" : "\n"}`
}

// A file read back: its front matter (lenient: a broken one is ignored, the whole text is the body) and body.
export function parsePageText(text: string): { id?: string; scope?: string; pinned?: boolean; title?: string; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (!m) return { body: text }
  let front: Record<string, unknown> = {}
  try {
    const parsed = Bun.YAML.parse(m[1]!)
    if (parsed && typeof parsed === "object") front = parsed as Record<string, unknown>
  } catch {
    return { body: text }
  }
  const out: { id?: string; scope?: string; pinned?: boolean; title?: string; body: string } = { body: text.slice(m[0].length).replace(/\n$/, "") }
  for (const k of ["id", "scope", "title"] as const) {
    const v = front[k]
    if (typeof v === "string" && v.trim()) out[k] = v.trim()
  }
  if (typeof front.pinned === "boolean") out.pinned = front.pinned
  return out
}

// Written whole or not at all: a reader (the watcher, an editor) never sees half a page.
export function writeAtomic(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.zorel-tmp`
  writeFileSync(tmp, text)
  renameSync(tmp, path)
}

export const removeFile = (path: string) => rmSync(path, { force: true })

// Every .md under the folder, as paths relative to it with "/" (hidden folders and temporary files left out).
export function markdownFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue
      const full = join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.isFile() && e.name.endsWith(".md")) out.push(relative(root, full).split(sep).join("/"))
    }
  }
  walk(root)
  return out.sort()
}

export const readText = (path: string) => readFileSync(path, "utf8")

// "projects/zorel/Deploy runbook.md" → "Deploy runbook"
export const titleOfFile = (file: string) => file.slice(file.lastIndexOf("/") + 1).replace(/\.md$/, "")
