// Commands on another computer over SSH (spec 017): the system's OpenSSH client (`ssh`, `ssh-keygen`, `ssh-keyscan`,
// present on macOS, Linux and Windows 10+) with Zorel's own key and known-hosts file in <dataDir>/ssh, never the
// person's ~/.ssh. Nothing here asks the person: the caller shows each command (and a new host's fingerprint) first.
// Host keys are pinned on first use only after the person compares the fingerprint; afterwards a changed key fails.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { which } from "./cli/index.ts"

export interface SshTarget {
  readonly user: string
  readonly host: string
  readonly port: number
}
const OUT_CAP = 8_000 // what a command's output keeps (the end, where errors are)
const NAME = /^[A-Za-z0-9._-]+$/ // a user or host: no spaces, no "-" first (it would read as an option)

// "deploy@example.com", "root@10.0.0.5:2222". Undefined for anything else.
export function targetFrom(text: string): SshTarget | undefined {
  const m = /^([^@\s]+)@([^:\s]+)(?::(\d{1,5}))?$/.exec(text.trim())
  if (!m) return undefined
  const [, user, host, portText] = m
  const port = portText ? Number(portText) : 22
  if (!NAME.test(user!) || !NAME.test(host!) || user!.startsWith("-") || host!.startsWith("-") || port < 1 || port > 65535) return undefined
  return { user: user!, host: host!, port }
}
export const targetText = (t: SshTarget) => `${t.user}@${t.host}${t.port === 22 ? "" : `:${t.port}`}`
// How known_hosts names a host: "host", or "[host]:port" off port 22.
const hostEntry = (t: Pick<SshTarget, "host" | "port">) => (t.port === 22 ? t.host : `[${t.host}]:${t.port}`)

export const sshDir = (dataDir: string) => join(dataDir, "ssh")
const keyFile = (dir: string) => join(dir, "id_ed25519")
const knownFile = (dir: string) => join(dir, "known_hosts")

async function exec(cmd: string[], opts: { stdin?: string; timeoutMs?: number } = {}) {
  const bin = which(cmd[0]!)
  if (!bin) throw new Error(`${cmd[0]} isn't installed (the OpenSSH client).`)
  const p = Bun.spawn([bin, ...cmd.slice(1)], { stdin: opts.stdin === undefined ? "ignore" : new Blob([opts.stdin]), stdout: "pipe", stderr: "pipe", timeout: opts.timeoutMs ?? 30_000, killSignal: "SIGKILL", windowsHide: true })
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
  return { code, out, err }
}

// Zorel's key pair, made once; its public line is what the person adds to the other computer's authorized_keys.
export async function publicKey(dir: string): Promise<string> {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  if (!existsSync(keyFile(dir))) {
    const r = await exec(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "zorel", "-f", keyFile(dir)])
    if (r.code !== 0) throw new Error(`ssh-keygen failed: ${r.err.trim()}`)
  }
  return readFileSync(`${keyFile(dir)}.pub`, "utf8").trim()
}

export const isKnown = (dir: string, t: SshTarget) => existsSync(knownFile(dir)) && readFileSync(knownFile(dir), "utf8").split("\n").some((l) => l.split(" ")[0]?.split(",").includes(hostEntry(t)))

// The host's key as it answers now, with its SHA256 fingerprint for the person to compare. Undefined when it doesn't
// answer. Prefers ed25519.
export async function scanHost(t: SshTarget): Promise<{ line: string; fingerprint: string } | undefined> {
  const r = await exec(["ssh-keyscan", "-T", "10", "-p", String(t.port), "-t", "ed25519,ecdsa,rsa", t.host], { timeoutMs: 20_000 })
  const lines = r.out.split("\n").filter((l) => l.trim() && !l.startsWith("#"))
  const line = lines.find((l) => l.includes("ssh-ed25519")) ?? lines[0]
  if (!line) return undefined
  const fp = await exec(["ssh-keygen", "-l", "-f", "-"], { stdin: `${line}\n` })
  const fingerprint = /SHA256:\S+/.exec(fp.out)?.[0]
  return fingerprint ? { line: line.trim(), fingerprint } : undefined
}
// Pins a host key the person compared and accepted.
export function trust(dir: string, line: string) {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  appendFileSync(knownFile(dir), `${line}\n`, { mode: 0o600 })
}

// The ssh command line for one command: Zorel's key only, no prompts (BatchMode), the pinned host key only.
export const sshArgs = (dir: string, t: SshTarget, command: string) => [
  "ssh",
  "-i", keyFile(dir),
  "-o", "IdentitiesOnly=yes",
  "-o", "BatchMode=yes",
  "-o", "StrictHostKeyChecking=yes",
  "-o", `UserKnownHostsFile=${knownFile(dir)}`,
  "-o", "ConnectTimeout=10",
  "-p", String(t.port),
  `${t.user}@${t.host}`,
  "--",
  command
]

// Runs one command (already approved by the person); `stdin` carries a secret the command reads, never an argument.
export async function runRemote(dir: string, t: SshTarget, command: string, opts: { stdin?: string; timeoutMs?: number } = {}) {
  const r = await exec(sshArgs(dir, t, command), { ...opts, timeoutMs: opts.timeoutMs ?? 10 * 60_000 })
  const text = `${r.out}${r.err ? `\n${r.err}` : ""}`.trim()
  return { code: r.code, output: text.length > OUT_CAP ? `…${text.slice(-OUT_CAP)}` : text }
}

// The tools of Zorel's Installer (spec 017), offered to that built-in agent only. Each run is an approval card with
// the exact command; a host seen for the first time asks the person to compare its key first.
export const REMOTE_KEY_TOOL = {
  name: "zorel_ssh_key",
  description: "Zorel's own SSH public key (one line). The person adds it to ~/.ssh/authorized_keys of the account Zorel will use on the other computer, before any command can run there.",
  inputSchema: { properties: {} },
  writes: false
} as const
export const REMOTE_RUN_TOOL = {
  name: "zorel_ssh_run",
  description:
    "Run one shell command on another computer over SSH, as target user@host or user@host:port. The person sees the exact command and approves it before it runs; a host seen for the first time asks them to compare its key first. Returns the exit code and the output (its end, when long). One command per call, with the arguments in it; never put a password or token in the command.",
  inputSchema: { properties: { target: { type: "string", description: "user@host or user@host:port" }, command: { type: "string" } }, required: ["target", "command"] },
  writes: true
} as const
export const REMOTE_TOOLS = [REMOTE_KEY_TOOL, REMOTE_RUN_TOOL] as const

