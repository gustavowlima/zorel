// Previews (zorel_preview): an agent runs a project's dev server and shows it, for any project. Zorel picks a free
// port, starts the server in a shell of the chat (the Terminal panel shows it and its output), waits until it
// listens, and opens the page in the chat's browser (the Browser panel shows it live; the agent's browser tools read
// it). It runs outside the agent's sandbox, like "Run a script" in the Terminal panel, so below full access the person
// approves the exact command (always-allowed per project and command).
import { existsSync, statSync } from "node:fs"
import { relative, resolve, sep } from "node:path"
import { listeners, listProcs, subtree } from "./procs.ts"

export const PREVIEW_TOOL = {
  name: "zorel_preview",
  description:
    "Run the project's dev server and show it: the page opens in this chat's Browser panel, where the user sees it live, and in your browser tools; its output shows in the Terminal panel. script: a package.json script (\"dev\"), run with the project's package manager. command: for other stacks, any command, with {port} where the port goes (\"python manage.py runserver {port}\", \"rails server -p {port}\"). Zorel picks a free port: it is in the PORT variable and in {port}, and Vite and Astro scripts get --port too. folder: a subfolder of the project (a monorepo app, \"apps/web\"). path: the page to open (\"/login\"). Calling it again for the same server reuses it. Below full access the user approves the command first.",
  inputSchema: {
    properties: { script: { type: "string" }, command: { type: "string" }, folder: { type: "string" }, path: { type: "string" } },
    required: []
  },
  writes: true
} as const

const SCRIPT_NAME = /^[\w:.@/-]{1,100}$/
const WAIT_MS = 90_000 // a first build can be slow (installing, compiling)

// A port nothing listens on (the OS picks it), so a preview never collides with a server already running.
export const freePort = async (): Promise<number> => {
  const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } })
  const { port } = probe
  probe.stop(true)
  return port
}

// The folder a preview runs in: the project's, or a subfolder of it (never outside it). A string is the problem.
export function previewFolder(root: string, folder: unknown): { dir: string } | string {
  if (folder === undefined || folder === null || folder === "") return { dir: root }
  if (typeof folder !== "string") return "folder: a path inside the project."
  const dir = resolve(root, folder)
  if (dir !== root && !dir.startsWith(root + sep)) return "folder: a path inside the project."
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return `No folder ${folder} in the project.`
  return { dir }
}

// The line typed into the shell. A script runs with the manager the lockfile names; Vite and Astro don't read PORT,
// so they also get --port (npm passes a script's own arguments after "--"; bun, pnpm and yarn pass them as they are).
// A command gets the port where it says {port}. A string is the problem.
export function previewLine(input: { script?: unknown; command?: unknown }, scripts: ReadonlyArray<{ name: string; command: string }>, manager: string, port: number): { line: string; label: string } | string {
  const script = typeof input.script === "string" ? input.script.trim() : ""
  const command = typeof input.command === "string" ? input.command.trim() : ""
  if (script && command) return "Give script or command, not both."
  if (command) {
    if (command.length > 1000 || /[\r\n]/.test(command)) return "command: one line, up to 1000 characters."
    return { line: command.replaceAll("{port}", String(port)), label: command.split(/\s+/).slice(0, 3).join(" ") }
  }
  if (!script) return scripts.length ? `Give script (one of: ${scripts.map((s) => s.name).join(", ")}) or command.` : "No package.json scripts here: give command, with {port} where the port goes."
  const found = scripts.find((s) => s.name === script)
  if (!found || !SCRIPT_NAME.test(script)) return `No script "${script}". This folder has: ${scripts.map((s) => s.name).join(", ") || "none"}.`
  const flags = /\b(vite|astro)\b/.test(found.command) ? `${manager === "npm" ? " --" : ""} --port ${port} --strictPort` : ""
  return { line: `${manager} run ${script}${flags}`, label: script }
}

// The URL of the page to open: localhost on that port, and a path on it.
export function previewUrl(port: number, path: unknown): string {
  const p = typeof path === "string" && path.trim() ? path.trim() : "/"
  return `http://localhost:${port}${p.startsWith("/") ? p : `/${p}`}`
}

// Waits until something started from the shell listens on a TCP port: the one it was given if it took it, else the
// first one it opened (a server that ignores PORT). Undefined when the shell ended first or the time ran out.
export async function waitForPort(shellPid: number, given: number, ended: () => boolean, ms = WAIT_MS): Promise<number | undefined> {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (ended()) return undefined
    const ports = listeners()
    if (ports.size) {
      const mine = new Set(subtree(await listProcs(), shellPid))
      const open = [...ports].filter(([pid]) => mine.has(pid)).flatMap(([, list]) => list)
      if (open.length) return open.includes(given) ? given : open.sort((a, b) => a - b)[0]
    }
    await Bun.sleep(500)
  }
  return undefined
}

// The end of a shell's output, as text without terminal colours: what the agent reads when the server didn't come up.
export function outputTail(bytes: Uint8Array, max = 2000): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escape sequences are what is being removed
  const text = new TextDecoder().decode(bytes).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\r/g, "")
  return text.slice(-max).trim()
}

// How a preview is named for reuse and for "Allow always": the project (or chat), the folder inside it, the command.
export const previewKey = (scope: string, root: string, dir: string, label: string) => `preview:${scope}:${relative(root, dir) || "."}:${label}`
