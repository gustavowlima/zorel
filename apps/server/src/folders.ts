// The subfolders of one folder, for picking a project's folder (the New project dialog). Only names and paths of
// folders, never file contents; `~` and nothing both mean the home folder.
import { type FolderListing, MAX_FOLDERS, WorkspaceInvalid } from "@zorel/contracts"
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, isAbsolute, join } from "node:path"

const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory() // follows links: a link to a folder counts
  } catch {
    return false
  }
}

export function listFolders(dir: string | undefined, home = homedir()): FolderListing {
  const raw = !dir || dir === "~" ? home : dir.startsWith("~/") ? join(home, dir.slice(2)) : dir
  if (!isAbsolute(raw)) throw new WorkspaceInvalid({ reason: "relative" })
  if (!existsSync(raw)) throw new WorkspaceInvalid({ reason: "missing" })
  const real = realpathSync(raw)
  if (!isDir(real)) throw new WorkspaceInvalid({ reason: "not_directory" })
  let names: string[]
  try {
    names = readdirSync(real)
  } catch {
    throw new WorkspaceInvalid({ reason: "forbidden" }) // no permission to read it
  }
  // Visible folders first, then hidden ones (.config…); each group alphabetical.
  const folders = names
    .filter((n) => isDir(join(real, n)))
    .sort((a, b) => Number(a.startsWith(".")) - Number(b.startsWith(".")) || a.localeCompare(b, undefined, { sensitivity: "base" }))
    .slice(0, MAX_FOLDERS)
    .map((name) => ({ name, path: join(real, name), git: existsSync(join(real, name, ".git")) }))
  const parent = dirname(real)
  return { dir: real, home: realpathSync(home), parent: parent === real ? null : parent, folders }
}
