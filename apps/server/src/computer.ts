// An agent's own computer (spec 009): an isolated Linux container where it installs, builds and runs anything
// without asking. Podman first (no daemon, rootless, Apache-2.0), Docker when it's the only engine. One container per
// agent and project; the chat's project folder is lent at /projects/<name>; /work is the agent's own, kept between
// turns. The CLI logins stay on this machine: the container only receives commands through these tools. Folder
// checks, container arguments, output clipping and the per-install name prefix derive from Tucano (Apache-2.0, see
// NOTICE: src/core/computer.ts).
import { existsSync, mkdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join, sep } from "node:path"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { textResult, type ToolDef } from "./tools.ts"

export const IMAGE = "docker.io/library/node:22-bookworm" // the registry spelled out: Podman doesn't guess one
export const PORTS = [3000, 3001, 4173, 5000, 5173, 8000, 8080, 8501, 8888] // dev servers' usual ports
const WORK = "/work"
const PROJECTS = "/projects"
const MAX_OUTPUT = 30_000 // characters of command output handed back to the model
const MAX_FILE = 200_000
const MAX_CLI_OUTPUT = 2_000_000 // what runCli keeps of stdout: a file this long was cut

export type Engine = "podman" | "docker"
export interface EngineStatus {
  readonly engine: Engine | null
  readonly problem: string | null // what the person has to do, when no engine works
}

// ---------- the engine ----------

export type Run = { code: number; stdout: string; stderr: string; late?: boolean }
export type Runner = (bin: string, args: ReadonlyArray<string>, opts?: { stdin?: string; timeoutMs?: number; env?: Record<string, string> }) => Promise<Run>

export const runCli: Runner = async (bin, args, opts = {}) => {
  let proc: ReturnType<typeof Bun.spawn<"pipe", "pipe", "pipe">>
  try {
    proc = Bun.spawn([bin, ...args], { stdin: "pipe", stdout: "pipe", stderr: "pipe", windowsHide: true, ...(opts.env ? { env: { ...process.env, ...opts.env } } : {}) })
  } catch (e) {
    return { code: -1, stdout: "", stderr: e instanceof Error ? `${e.message} (ENOENT)` : "ENOENT" } // not installed
  }
  proc.stdin.write(opts.stdin ?? "")
  proc.stdin.end()
  let late = false
  const timer = opts.timeoutMs
    ? setTimeout(() => {
        late = true
        proc.kill("SIGKILL")
      }, opts.timeoutMs)
    : null
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  if (timer) clearTimeout(timer)
  return { code, stdout: stdout.slice(-MAX_CLI_OUTPUT), stderr: stderr.slice(-200_000), ...(late ? { late } : {}) }
}

// What an engine's failed `info` means for the person, first match wins.
const PROBLEMS: ReadonlyArray<readonly [RegExp, (engine: Engine) => string]> = [
  [/ENOENT|not found|no such file/i, (e) => (e === "podman" ? "Podman isn't installed: get it from podman.io (on a Mac: brew install podman)." : "Docker isn't installed.")],
  [/podman machine|machine.*(not running|stopped)|cannot connect to podman/i, () => "Podman is installed but its machine isn't running: run podman machine init (once), then podman machine start."],
  [/permission denied[^\n]*docker\.sock/i, () => "Your user can't reach Docker: add yourself to the docker group (sudo usermod -aG docker $USER) and log in again."],
  [/daemon|connect to the docker/i, () => "Docker is installed but not running: open Docker Desktop or start the docker service."]
]
export const problemOf = (engine: Engine, stderr: string) => (PROBLEMS.find(([re]) => re.test(stderr))?.[1] ?? (() => `${engine} didn't answer: ${stderr.trim().split("\n").at(-1) ?? ""}`))(engine)

// Podman when it works, else Docker; else the most useful thing to say (Podman's problem when it's installed).
export async function detectEngine(run: Runner = runCli): Promise<EngineStatus> {
  const podman = await run("podman", ["info", "--format", "{{.Host.Arch}}"], { timeoutMs: 20_000 })
  if (podman.code === 0) return { engine: "podman", problem: null }
  const docker = await run("docker", ["info", "--format", "{{.ServerVersion}}"], { timeoutMs: 20_000 })
  if (docker.code === 0) return { engine: "docker", problem: null }
  // The engine that's there but not working says what to do; with neither, install Podman.
  const missing = (r: Run) => /ENOENT|not found/i.test(r.stderr)
  if (!missing(podman)) return { engine: null, problem: problemOf("podman", podman.stderr) }
  if (!missing(docker)) return { engine: null, problem: problemOf("docker", docker.stderr) }
  return { engine: null, problem: problemOf("podman", podman.stderr) }
}

// ---------- the lent folder ----------

// Why a folder can't be lent, or null: only inside the home folder, never the home itself, hidden folders (~/.ssh…),
// the system's settings (Library, AppData) or Zorel's own data.
export function checkFolder(path: string, opts: { home?: string; dataDir: string }): string | null {
  let real: string
  try {
    real = realpathSync(path)
    if (!statSync(real).isDirectory()) return "That isn't a folder."
  } catch {
    return "That folder doesn't exist."
  }
  const home = realpathSync(opts.home ?? homedir())
  if (!real.startsWith(home + sep)) return "Only folders inside the home folder can be lent."
  const top = real.slice(home.length + 1).split(sep)[0]!
  if (top === "Library" || top.toLowerCase() === "appdata" || top.startsWith(".")) return "That folder holds the system's settings and credentials; it can't be lent."
  const data = existsSync(opts.dataDir) ? realpathSync(opts.dataDir) : opts.dataDir
  if (data === real || data.startsWith(real + sep) || real.startsWith(data + sep)) return "That folder holds Zorel's own data; it can't be lent."
  return null
}
export const folderName = (path: string) => basename(path).toLowerCase().normalize("NFD").replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+|-+$/g, "") || "project"

// ---------- the container ----------

export interface Lent {
  readonly path: string
  readonly readOnly: boolean
}
// Two installs (a test one, another data folder) never share or erase each other's computers.
export const installOf = (dataDir: string) => new Bun.CryptoHasher("sha1").update(dataDir).digest("hex").slice(0, 6)
export const containerName = (dataDir: string, agentId: string, projectId: string | null) => `zorel-${installOf(dataDir)}-${agentId.slice(0, 8)}-${(projectId ?? "none").slice(0, 8)}`

// What a container was made with (a label on it): the lent folder and whether it's read-only. A chat at another access
// level or on another folder gets the container made again (its /work stays: it's a folder on this computer).
export const mountOf = (lent: Lent | null) => (lent ? `${lent.path}:${lent.readOnly ? "ro" : "rw"}` : "none")

export function runArgs(o: { engine: Engine; name: string; install: string; agentId: string; work: string; lent: Lent | null; platform?: string }): string[] {
  const keepId = o.engine === "podman" && (o.platform ?? process.platform) === "linux" // rootless: files stay the person's
  const at = o.lent && `${PROJECTS}/${folderName(o.lent.path)}`
  // The repository's .git stays read-only even in a writable folder: Zorel's own git on this computer reads its config
  // and hooks, so a hook or core.fsmonitor written from the container would run here, outside any sandbox.
  const git = o.lent && !o.lent.readOnly && existsSync(join(o.lent.path, ".git")) && statSync(join(o.lent.path, ".git")).isDirectory() ? ["-v", `${join(o.lent.path, ".git")}:${at}/.git:ro`] : []
  const lent = o.lent ? ["-v", `${o.lent.path}:${at}${o.lent.readOnly ? ":ro" : ""}`, ...git] : []
  return [
    "run", "-d", "--name", o.name, "--hostname", "computer",
    "--label", `zorel.install=${o.install}`, "--label", `zorel.agent=${o.agentId}`, "--label", `zorel.mount=${mountOf(o.lent)}`,
    "--init", "--memory", "3g", "--cpus", "2",
    ...(keepId ? ["--userns=keep-id"] : []),
    "-w", WORK, "-v", `${o.work}:${WORK}`, ...lent,
    ...PORTS.flatMap((p) => ["-p", `127.0.0.1::${p}`]),
    IMAGE, "sleep", "infinity"
  ]
}

// Long output keeps its start and, mostly, its end: errors usually come last.
export function clipOutput(text: string, max = MAX_OUTPUT): string {
  if (text.length <= max) return text
  const head = Math.floor(max * 0.2)
  return `${text.slice(0, head)}\n[… ${text.length - max} characters cut …]\n${text.slice(text.length - (max - head))}`
}
export function formatRun(r: Run, timeoutSeconds: number): string {
  const out = Bun.stripANSI(r.stdout).trimEnd() // colors and cursor codes out
  const err = Bun.stripANSI(r.stderr).trimEnd()
  return clipOutput(
    [r.code === 124 ? `Stopped: went past ${timeoutSeconds} s. Start long-running things in the background (nohup … &).` : `exit code ${r.code}`, out && `--- stdout ---\n${out}`, err && `--- stderr ---\n${err}`, !out && !err && "(no output)"]
      .filter(Boolean)
      .join("\n")
  )
}
const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
// A path as the agent writes it: absolute, or relative to /work.
const inside = (p: string) => (p.startsWith("/") ? p : `${WORK}/${p}`)

export const COMPUTER_TOOLS: ReadonlyArray<ToolDef> = [
  {
    name: "computer_run",
    description: `Runs a bash command on your own Linux computer (Debian, Node 22; you may install anything with apt or npm, no approval needed). Starts in ${WORK}, your space kept between turns; the chat's project is at ${PROJECTS}/<name>. timeout_seconds: default 120, max 600; start servers in the background (nohup … &) and see their address with computer_ports.`,
    inputSchema: { type: "object", properties: { command: { type: "string" }, timeout_seconds: { type: "integer", minimum: 1, maximum: 600 } }, required: ["command"] }
  },
  { name: "computer_read", description: `Reads a text file on your computer. path: absolute, or relative to ${WORK}.`, inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
  { name: "computer_write", description: "Writes a whole file on your computer (creating its folders).", inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
  {
    name: "computer_edit",
    description: "Replaces an exact stretch of a file on your computer. old_text must appear once (or pass replace_all).",
    inputSchema: { type: "object", properties: { path: { type: "string" }, old_text: { type: "string" }, new_text: { type: "string" }, replace_all: { type: "boolean" } }, required: ["path", "old_text", "new_text"] }
  },
  { name: "computer_ports", description: "Lists the addresses on this machine where your computer's servers can be opened (port inside → http://127.0.0.1:port).", inputSchema: { type: "object", properties: {} } }
]
export const COMPUTER_TOOL_NAMES: ReadonlySet<string> = new Set(COMPUTER_TOOLS.map((t) => t.name))
export const WRITING_COMPUTER_TOOLS: ReadonlySet<string> = new Set(["computer_run", "computer_write", "computer_edit"])

export interface ComputerCall {
  readonly agentId: string
  readonly projectId: string | null
  readonly lent: Lent | null // the chat's project folder, already checked
}

// One app run's computers. The engine is found once and kept.
export class Computers {
  private engine: Promise<EngineStatus> | undefined
  private starting = new Map<string, Promise<void>>()
  private readonly run: Runner
  constructor(
    private readonly dataDir: string,
    run: Runner = runCli
  ) {
    // Podman reads the person's registry logins (~/.docker/config.json and its credential helpers, which may not even
    // be installed: a pull then fails). The computers only pull public images: Podman gets an empty login file of
    // Zorel's own. Docker keeps its config (Docker Desktop keeps the engine's context there).
    const auth = join(dataDir, "computers", "registry-auth.json")
    this.run = (bin, args, opts = {}) => {
      if (bin !== "podman") return run(bin, args, opts)
      if (!existsSync(auth)) {
        mkdirSync(join(dataDir, "computers"), { recursive: true })
        writeFileSync(auth, "{}")
      }
      return run(bin, args, { ...opts, env: { ...opts.env, REGISTRY_AUTH_FILE: auth } })
    }
  }

  status(fresh = false): Promise<EngineStatus> {
    if (fresh || !this.engine) this.engine = detectEngine(this.run)
    return this.engine
  }
  private work(agentId: string, projectId: string | null) {
    return join(this.dataDir, "computers", agentId, projectId ?? "none", "work")
  }

  // Creates or starts the container. The first time pulls the image (a few minutes).
  private async ensure(engine: Engine, c: ComputerCall): Promise<string> {
    const name = containerName(this.dataDir, c.agentId, c.projectId)
    const current = this.starting.get(name)
    if (current) return current.then(() => name)
    const job = (async () => {
      const state = await this.run(engine, ["inspect", "-f", '{{.State.Running}}|{{index .Config.Labels "zorel.mount"}}', name], { timeoutMs: 15_000 })
      const [running, mount] = state.stdout.trim().split("|")
      if (state.code === 0 && mount !== mountOf(c.lent)) {
        // Made for another folder or access level: made again, so "ask" really is read-only.
        await this.run(engine, ["rm", "-f", name], { timeoutMs: 60_000 })
      } else if (state.code === 0 && running === "true") return
      else if (state.code === 0) {
        const r = await this.run(engine, ["start", name], { timeoutMs: 60_000 })
        if (r.code !== 0) throw new Error(`Couldn't start the computer: ${r.stderr.trim().split("\n").at(-1)}`)
        return
      }
      if ((await this.run(engine, ["image", "inspect", IMAGE], { timeoutMs: 15_000 })).code !== 0) {
        const pull = await this.run(engine, ["pull", IMAGE], { timeoutMs: 30 * 60_000 })
        if (pull.code !== 0) throw new Error(`Couldn't download the computer's system: ${pull.stderr.trim().split("\n").at(-1)}`)
      }
      const work = this.work(c.agentId, c.projectId)
      mkdirSync(work, { recursive: true })
      const r = await this.run(engine, runArgs({ engine, name, install: installOf(this.dataDir), agentId: c.agentId, work, lent: c.lent }), { timeoutMs: 120_000 })
      if (r.code !== 0) throw new Error(`Couldn't set up the computer: ${r.stderr.trim().split("\n").at(-1)}`)
      await this.run(engine, ["exec", name, "git", "config", "--global", "--add", "safe.directory", "*"], { timeoutMs: 15_000 }) // lent repositories are the person's
    })().finally(() => this.starting.delete(name))
    this.starting.set(name, job)
    await job
    return name
  }

  private exec(engine: Engine, name: string, command: string, timeoutSeconds = 120, stdin?: string) {
    const t = Math.min(600, Math.max(1, Math.round(timeoutSeconds)))
    // `timeout` runs inside, so the command stops even if the client is killed.
    return this.run(engine, ["exec", ...(stdin !== undefined ? ["-i"] : []), "-w", WORK, "-e", "TERM=dumb", name, "timeout", "-k", "5", String(t), "bash", "-lc", command], { timeoutMs: (t + 15) * 1000, ...(stdin !== undefined ? { stdin } : {}) })
  }

  // What each tool does on a running computer.
  private readonly handlers: Record<string, (engine: Engine, name: string, args: Record<string, unknown>) => Promise<CallToolResult>> = {
    computer_run: async (engine, name, args) => {
      const t = typeof args.timeout_seconds === "number" ? args.timeout_seconds : 120
      const r = await this.exec(engine, name, String(args.command ?? ""), t)
      return textResult(formatRun(r, t), r.code !== 0)
    },
    computer_read: async (engine, name, args) => {
      const r = await this.exec(engine, name, `cat -- ${q(inside(String(args.path ?? "")))}`, 30)
      if (r.code !== 0) return textResult(r.stderr.trim() || "Couldn't read it.", true)
      return textResult(r.stdout.length > MAX_FILE ? `${r.stdout.slice(0, MAX_FILE)}\n[… file cut at ${MAX_FILE} characters]` : r.stdout || "(empty file)")
    },
    computer_write: async (engine, name, args) => {
      const path = inside(String(args.path ?? ""))
      const r = await this.exec(engine, name, `mkdir -p -- "$(dirname -- ${q(path)})" && cat > ${q(path)}`, 30, String(args.content ?? ""))
      return r.code === 0 ? textResult(`Wrote ${path}.`) : textResult(r.stderr.trim() || "Couldn't write it.", true)
    },
    computer_edit: async (engine, name, args) => {
      const path = inside(String(args.path ?? ""))
      const old = String(args.old_text ?? "")
      if (!old) return textResult("old_text can't be empty. To create or rewrite the file, use computer_write.", true)
      const read = await this.exec(engine, name, `cat -- ${q(path)}`, 30)
      if (read.code !== 0) return textResult(read.stderr.trim() || "Couldn't read it.", true)
      if (read.stdout.length >= MAX_CLI_OUTPUT) return textResult("The file is too large to edit this way (it would be cut). Use computer_run with sed or a script.", true)
      const count = read.stdout.split(old).length - 1
      if (!count) return textResult("The stretch isn't in the file. Read it again and copy it exactly.", true)
      if (count > 1 && args.replace_all !== true) return textResult(`The stretch appears ${count} times. Include more context or pass replace_all.`, true)
      const next = args.replace_all === true ? read.stdout.split(old).join(String(args.new_text ?? "")) : read.stdout.replace(old, () => String(args.new_text ?? "")) // a function: $& and $$ in the new text stay as written
      const w = await this.exec(engine, name, `cat > ${q(path)}`, 30, next)
      return w.code === 0 ? textResult(`Edited ${path} (${args.replace_all === true ? count : 1} replacement${count > 1 && args.replace_all === true ? "s" : ""}).`) : textResult(w.stderr.trim(), true)
    },
    computer_ports: async (engine, name) => {
      const r = await this.run(engine, ["port", name], { timeoutMs: 10_000 })
      const lines = [...r.stdout.matchAll(/^(\d+)\/tcp -> 127\.0\.0\.1:(\d+)$/gm)].map((m) => `- ${m[1]} → http://127.0.0.1:${m[2]}`)
      return textResult(lines.join("\n") || "No ports published.")
    }
  }

  async call(c: ComputerCall, tool: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const { engine, problem } = await this.status()
    if (!engine) return textResult(`Your computer can't start: ${problem} Tell the user.`, true)
    const handler = this.handlers[tool]
    if (!handler) return textResult(`Unknown tool: ${tool}`, true)
    try {
      return await handler(engine, await this.ensure(engine, c), args)
    } catch (e) {
      return textResult(e instanceof Error ? e.message : String(e), true)
    }
  }

  // Everything of this agent goes: its containers (any project) and its folders.
  async erase(agentId: string): Promise<void> {
    if (!/^[A-Za-z0-9_-]+$/.test(agentId)) throw new Error("Not an agent id.") // never a path: it names a folder to delete
    const { engine } = await this.status()
    if (engine) {
      const ids = (await this.run(engine, ["ps", "-aq", "--filter", `label=zorel.install=${installOf(this.dataDir)}`, "--filter", `label=zorel.agent=${agentId}`], { timeoutMs: 15_000 })).stdout.split("\n").filter(Boolean)
      if (ids.length) await this.run(engine, ["rm", "-f", ...ids], { timeoutMs: 60_000 })
    }
    rmSync(join(this.dataDir, "computers", agentId), { recursive: true, force: true })
  }
}

// One per data folder, shared by the runtime and the API (the engine is found once).
const byDataDir = new Map<string, Computers>()
export const computersFor = (dataDir: string) => {
  const known = byDataDir.get(dataDir)
  if (known) return known
  const made = new Computers(dataDir)
  byDataDir.set(dataDir, made)
  return made
}
