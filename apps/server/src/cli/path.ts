// Where the agent CLIs live and how they're found. The official installers put them in a few user folders, which go
// on the server's PATH at start (after the person's own), so a CLI installed here, or by its own installer that
// didn't touch this process's PATH, is found.
import { homedir } from "node:os"
import { delimiter, join } from "node:path"

export const home = () => process.env.ZOREL_CLI_HOME ?? homedir() // tests: a throwaway home
export const exe = (name: string, platform: string = process.platform) => (platform === "win32" ? `${name}.exe` : name)

// ~/.local/bin: Claude Code's, Codex's (here) and agy's folder; agy on Windows and OpenCode use their own.
const localBin = (base: string) => join(base, ".local", "bin")
export const DIRS = {
  local: (base: string, _platform: string) => localBin(base),
  agy: (base: string, platform: string) => (platform === "win32" ? join(process.env.LOCALAPPDATA ?? join(base, "AppData", "Local"), "agy", "bin") : localBin(base)),
  opencode: (base: string, _platform: string) => join(base, ".opencode", "bin")
} as const

export const cliDirs = (base = home(), platform = process.platform) => [...new Set(Object.values(DIRS).map((dir) => dir(base, platform)))]

// Bun.which reads the PATH the process started with, not later changes to process.env.PATH (addCliDirsToPath, an
// install): every lookup of a program goes through this, with today's PATH.
export const which = (bin: string): string | null => Bun.which(bin, { PATH: process.env.PATH ?? "" })

export function addCliDirsToPath() {
  const have = (process.env.PATH ?? "").split(delimiter)
  const extra = cliDirs().filter((d) => !have.includes(d))
  if (extra.length) process.env.PATH = [...have, ...extra].filter(Boolean).join(delimiter) // after the person's own
}
