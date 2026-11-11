// An agent's own computer (spec 009): an isolated Linux container where it installs, builds and runs anything
// without asking. Podman first (no daemon, rootless, Apache-2.0), Docker when it's the only engine. One container per
// agent and project; the chat's project folder is lent at /projects/<name>; /work is the agent's own, kept between
// turns. The CLI logins stay on this machine: the container only receives commands through these tools. Folder
// checks, container arguments, output clipping and the per-install name prefix derive from third-party code
// (Apache-2.0, see NOTICE).
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
interface EngineStatus {
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
  [/no machine|machine.*does not exist|VM does not exist/i, () => "Podman is installed but has no machine yet: run podman machine init (once); Zorel starts it after that."],
  [/podman machine|machine.*(not running|stopped)|cannot connect to podman|unable to connect to podman/i, () => "Podman is installed but its machine didn't start: run podman machine start and look at what it says."],
  [/permission denied[^\n]*docker\.sock/i, () => "Your user can't reach Docker: add yourself to the docker group (sudo usermod -aG docker $USER) and log in again."],
  [/daemon|connect to the docker/i, () => "Docker is installed but not running: open Docker Desktop or start the docker service."]
]
export const problemOf = (engine: Engine, stderr: string) => (PROBLEMS.find(([re]) => re.test(stderr))?.[1] ?? (() => `${engine} didn't answer: ${stderr.trim().split("\n").at(-1) ?? ""}`))(engine)

// Podman whenever it's installed: on a Mac or Windows its machine (the Linux it runs in) is started when it's stopped.
// Docker only when there's no Podman; else the most useful thing to say (Podman's problem when it's installed).
const MACHINE_OFF = /podman machine|machine.*(not running|stopped)|cannot connect to podman|unable to connect to podman|connection refused/i
export async function detectEngine(run: Runner = runCli, platform: string = process.platform): Promise<EngineStatus> {
  const info = () => run("podman", ["info", "--format", "{{.Host.Arch}}"], { timeoutMs: 20_000 })
  let podman = await info()
  if (podman.code === 0) return { engine: "podman", problem: null }
  if (platform !== "linux" && MACHINE_OFF.test(podman.stderr)) {
    const started = await run("podman", ["machine", "start"], { timeoutMs: 180_000 })
    if (started.code === 0 || /already running/i.test(started.stderr)) podman = await info()
    if (podman.code === 0) return { engine: "podman", problem: null }
    return { engine: null, problem: problemOf("podman", `${started.stderr}\n${podman.stderr}`) } // installed: no Docker in its place
  }
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

interface Lent {
  readonly path: string
  readonly readOnly: boolean
}
// Two installs (a test one, another data folder) never share or erase each other's computers.
const installOf = (dataDir: string) => new Bun.CryptoHasher("sha1").update(dataDir).digest("hex").slice(0, 6)
export const containerName = (dataDir: string, agentId: string, projectId: string | null) => `zorel-${installOf(dataDir)}-${agentId.slice(0, 8)}-${(projectId ?? "none").slice(0, 8)}`

// What a container was made with (a label on it): the lent folders and whether each is read-only. A chat at another
// access level or with other folders gets the container made again (its /work stays: it's a folder on this computer).
export const mountOf = (lents: ReadonlyArray<Lent>) => (lents.length ? lents.map((l) => `${l.path}:${l.readOnly ? "ro" : "rw"}`).sort().join(";") : "none")

// Where each lent folder shows inside, /projects/<name>; two folders with the same name get "-2", "-3"…
export function mountPoints(lents: ReadonlyArray<Lent>): string[] {
  const used = new Map<string, number>()
  return lents.map((l) => {
    const name = folderName(l.path)
    const n = (used.get(name) ?? 0) + 1
    used.set(name, n)
    return `${PROJECTS}/${n === 1 ? name : `${name}-${n}`}`
  })
}

export function runArgs(o: { engine: Engine; name: string; install: string; agentId: string; work: string; lents: ReadonlyArray<Lent>; platform?: string }): string[] {
  const keepId = o.engine === "podman" && (o.platform ?? process.platform) === "linux" // rootless: files stay the person's
  // The repository's .git stays read-only even in a writable folder: Zorel's own git on this computer reads its config
  // and hooks, so a hook or core.fsmonitor written from the container would run here, outside any sandbox.
  // --mount, not -v: a folder with ":" in its name would split -v's value.
  const bind = (src: string, dst: string, readOnly: boolean) => ["--mount", `type=bind,src=${src},dst=${dst}${readOnly ? ",readonly" : ""}`]
  const points = mountPoints(o.lents)
  const lent = o.lents.flatMap((l, i) => {
    const at = points[i]!
    const git = !l.readOnly && existsSync(join(l.path, ".git")) && statSync(join(l.path, ".git")).isDirectory() ? bind(join(l.path, ".git"), `${at}/.git`, true) : []
    return [...bind(l.path, at, l.readOnly), ...git]
  })
  return [
    "run", "-d", "--name", o.name, "--hostname", "computer",
    "--label", `zorel.install=${o.install}`, "--label", `zorel.agent=${o.agentId}`, "--label", `zorel.mount=${mountOf(o.lents)}`,
    "--init", "--memory", "3g", "--cpus", "2",
    // keep-id as root: the person's own user is root inside (apt works) and owns what it writes in lent folders.
    ...(keepId ? ["--userns=keep-id:uid=0,gid=0"] : []),
    "--security-opt", "no-new-privileges", // nothing inside gains privileges through a setuid program
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
  if (r.late && r.code !== 124) r = { ...r, code: 124 } // stopped from outside (the client hung): the same hint
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

interface ComputerCall {
  readonly agentId: string
  readonly projectId: string | null
  readonly lents: ReadonlyArray<Lent> // the chat's project folder and the ones the person lent it, already checked
}

// What the agent's computer is doing, for the person: off (never made), getting its system the first time, being set
// up or started, running, stopped (made, not running), or unavailable (no engine: problem says what to do).
export type ComputerPhase = "off" | "pulling" | "starting" | "running" | "stopped" | "unavailable"
export interface ComputerState {
  readonly state: ComputerPhase
  readonly problem: string | null
}

// One app run's computers. The engine is found once and kept.
export class Computers {
  private engine: Promise<EngineStatus> | undefined
  private starting = new Map<string, Promise<void>>()
  private readonly phase = new Map<string, "pulling" | "starting">() // per container, while ensure() works on it
  private readonly started = new Set<string>() // containers this run started or used: stopped when Zorel exits
  private found: Engine | undefined
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
    if (fresh || !this.engine)
      this.engine = detectEngine(this.run).then((s) => {
        this.found = s.engine ?? undefined // known synchronously when Zorel exits (stopAll)
        return s
      })
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
      this.phase.set(name, "starting")
      if (state.code === 0 && mount !== mountOf(c.lents)) {
        // Made for another folder or access level: made again, so "ask" really is read-only.
        await this.run(engine, ["rm", "-f", name], { timeoutMs: 60_000 })
      } else if (state.code === 0 && running === "true") return
      else if (state.code === 0) {
        const r = await this.run(engine, ["start", name], { timeoutMs: 60_000 })
        if (r.code !== 0) throw new Error(`Couldn't start the computer: ${r.stderr.trim().split("\n").at(-1)}`)
        return
      }
      if ((await this.run(engine, ["image", "inspect", IMAGE], { timeoutMs: 15_000 })).code !== 0) {
        this.phase.set(name, "pulling")
        const pull = await this.run(engine, ["pull", IMAGE], { timeoutMs: 30 * 60_000 })
        if (pull.code !== 0) throw new Error(`Couldn't download the computer's system: ${pull.stderr.trim().split("\n").at(-1)}`)
      }
      const work = this.work(c.agentId, c.projectId)
      mkdirSync(work, { recursive: true })
      this.phase.set(name, "starting")
      const r = await this.run(engine, runArgs({ engine, name, install: installOf(this.dataDir), agentId: c.agentId, work, lents: c.lents }), { timeoutMs: 120_000 })
      if (r.code !== 0) throw new Error(`Couldn't set up the computer: ${r.stderr.trim().split("\n").at(-1)}`)
      await this.run(engine, ["exec", name, "git", "config", "--global", "--add", "safe.directory", "*"], { timeoutMs: 15_000 }) // lent repositories are the person's
    })().finally(() => {
      this.starting.delete(name)
      this.phase.delete(name)
    })
    this.starting.set(name, job)
    await job
    this.started.add(name)
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

  private async containersOf(engine: Engine, agentId: string, all: boolean) {
    const r = await this.run(engine, ["ps", ...(all ? ["-a"] : []), "-q", "--filter", `label=zorel.install=${installOf(this.dataDir)}`, "--filter", `label=zorel.agent=${agentId}`], { timeoutMs: 15_000 })
    return r.stdout.split("\n").filter(Boolean)
  }

  // Everything of this agent goes: its containers (any project) and its folders. An agent that had a computer needs
  // the engine to answer (a stopped Podman machine): else its containers would stay while this says they're gone.
  async erase(agentId: string): Promise<void> {
    if (!/^[A-Za-z0-9_-]+$/.test(agentId)) throw new Error("Not an agent id.") // never a path: it names a folder to delete
    const folder = join(this.dataDir, "computers", agentId)
    const { engine, problem } = await this.status(true)
    if (!engine && existsSync(folder)) throw new Error(`Couldn't reach the engine to remove the computer: ${problem}`)
    if (engine) {
      const ids = await this.containersOf(engine, agentId, true)
      if (ids.length) await this.run(engine, ["rm", "-f", ...ids], { timeoutMs: 60_000 })
    }
    rmSync(folder, { recursive: true, force: true })
  }

  // The agent's computer as the person sees it (any of its project containers): working on one, running, stopped, off.
  async state(agentId: string): Promise<ComputerState> {
    const { engine, problem } = await this.status()
    if (!engine) return { state: "unavailable", problem }
    const prefix = `zorel-${installOf(this.dataDir)}-${agentId.slice(0, 8)}-`
    const busy = [...this.phase].filter(([name]) => name.startsWith(prefix)).map(([, p]) => p)
    if (busy.length) return { state: busy.includes("pulling") ? "pulling" : "starting", problem: null }
    if ((await this.containersOf(engine, agentId, false)).length) return { state: "running", problem: null }
    return { state: (await this.containersOf(engine, agentId, true)).length ? "stopped" : "off", problem: null }
  }

  // Started from the agent's page (its computer outside any project, with the folders lent to it), in the background:
  // state() follows it. A failure shows as the state it leaves (off or stopped) and in the logs.
  start(c: Omit<ComputerCall, "projectId">): void {
    const name = containerName(this.dataDir, c.agentId, null)
    if (!this.starting.has(name)) this.phase.set(name, "starting") // seen at once, before the engine answers
    void this.status()
      .then(({ engine }) => engine && this.ensure(engine, { ...c, projectId: null }))
      .catch((e: unknown) => console.warn("computer start failed", e))
      .finally(() => !this.starting.has(name) && this.phase.delete(name))
  }

  // Stopped and started again (a stuck server, a full disk cleaned up): every container of the agent.
  async restart(agentId: string): Promise<void> {
    const { engine, problem } = await this.status()
    if (!engine) throw new Error(problem ?? "No container engine.")
    const ids = await this.containersOf(engine, agentId, true)
    if (ids.length) await this.run(engine, ["restart", "-t", "3", ...ids], { timeoutMs: 120_000 })
  }

  // The agent's own space (/work inside its computer outside any project), as a folder on this computer.
  workFolder(agentId: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(agentId)) throw new Error("Not an agent id.")
    const work = this.work(agentId, null)
    mkdirSync(work, { recursive: true })
    return work
  }

  // An archived agent's computers stop (they keep their files; a later use starts them again).
  async stopAgent(agentId: string): Promise<void> {
    const engine = this.found
    if (!engine) return
    const ids = await this.containersOf(engine, agentId, false)
    if (ids.length) await this.run(engine, ["stop", "-t", "3", ...ids], { timeoutMs: 60_000 })
  }

  // Zorel is exiting: the containers it used stop in the background (a `sleep infinity` would hold 3 GB otherwise).
  stopAll(): void {
    if (!this.found || !this.started.size) return
    Bun.spawn([this.found, "stop", "-t", "3", ...this.started], { stdin: "ignore", stdout: "ignore", stderr: "ignore", windowsHide: true }).unref()
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
