// agent-desktop (vercel-labs/agent-desktop, Apache-2.0): reads and operates desktop apps through the OS
// accessibility tree. Optional (spec 008): the person installs it from the app; Zorel downloads the official
// release for this OS and processor, checks it against the release's checksums.txt and keeps it in its data
// folder. No Node.js, no terminal. Pinned: a new version comes with a Zorel update, never unseen.
import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export const AGENT_DESKTOP_VERSION = "1.2.0"
// The release's build for each OS-processor pair.
const TARGETS: Readonly<Record<string, string>> = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "win32-arm64": "aarch64-pc-windows-msvc",
  "win32-x64": "x86_64-pc-windows-msvc",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "linux-x64": "x86_64-unknown-linux-gnu"
}
const releases = () => process.env.ZOREL_AGENT_DESKTOP_RELEASES ?? "https://github.com/vercel-labs/agent-desktop/releases/download" // tests: a fake
const exe = (platform = process.platform) => (platform === "win32" ? "agent-desktop.exe" : "agent-desktop")

export const targetOf = (platform: string = process.platform, arch: string = process.arch) => TARGETS[`${platform}-${arch}`]
export const archiveOf = (target: string, version = AGENT_DESKTOP_VERSION) => `agent-desktop-v${version}-${target}.tar.gz`
export const desktopDir = (dataDir: string) => join(dataDir, "tools", "agent-desktop", AGENT_DESKTOP_VERSION)
export const desktopBin = (dataDir: string): string | undefined => {
  const p = join(desktopDir(dataDir), exe())
  return existsSync(p) ? p : undefined
}

// "<sha256>  <file>" lines (sha256sum format): the hash of one file.
export function checksumOf(listing: string, file: string): string | undefined {
  for (const line of listing.split("\n")) {
    const [hash, name] = line.trim().split(/\s+\*?/)
    if (name === file && /^[0-9a-f]{64}$/i.test(hash ?? "")) return hash!.toLowerCase()
  }
  return undefined
}

const download = async (url: string) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return new Uint8Array(await res.arrayBuffer())
}
const run = (file: string, args: ReadonlyArray<string>, cwd?: string) =>
  new Promise<void>((resolve, reject) => execFile(file, [...args], { cwd, timeout: 60_000, windowsHide: true }, (e) => (e ? reject(e) : resolve())))

// Downloads, checks and unpacks this system's build. Errors are for the person ("isn't available for…").
export async function installDesktop(dataDir: string): Promise<{ ok: true; version: string } | { ok: false; error: string }> {
  const target = targetOf()
  if (!target) return { ok: false, error: `agent-desktop isn't available for ${process.platform} on ${process.arch}.` }
  const file = archiveOf(target)
  const base = `${releases()}/v${AGENT_DESKTOP_VERSION}`
  const work = mkdtempSync(join(dataDir, "tools-"))
  try {
    const [archive, sums] = await Promise.all([download(`${base}/${file}`), download(`${base}/checksums.txt`)])
    const want = checksumOf(new TextDecoder().decode(sums), file)
    const got = createHash("sha256").update(archive).digest("hex")
    if (!want || want !== got) return { ok: false, error: "The download didn't match the release's checksum, so it wasn't installed." }
    writeFileSync(join(work, file), archive)
    const into = join(work, "out")
    mkdirSync(into)
    await run("tar", ["-xzf", join(work, file), "-C", into]) // tar ships with macOS, Linux and Windows 10+
    if (!existsSync(join(into, exe()))) return { ok: false, error: "The release didn't hold the agent-desktop program." }
    if (process.platform !== "win32") chmodSync(join(into, exe()), 0o755)
    const dir = desktopDir(dataDir)
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(join(dir, ".."), { recursive: true })
    renameSync(into, dir) // the binary and its helper stay side by side, as agent-desktop needs
    return { ok: true, version: AGENT_DESKTOP_VERSION }
  } catch (e) {
    return { ok: false, error: `Couldn't install agent-desktop: ${e instanceof Error ? e.message : String(e)}` }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

// agent-desktop prints one JSON envelope per command.
export type Envelope = {
  ok: boolean
  data?: Record<string, unknown>
  error?: { code?: string; message?: string; suggestion?: string; disposition?: { retry?: string }; recovery?: { retry_after_ms?: number } }
}
export type Cli = (args: ReadonlyArray<string>, timeoutMs?: number) => Promise<Envelope>

export const desktopCli =
  (dataDir: string): Cli =>
  (args, timeoutMs = 45_000) =>
    new Promise((resolve) => {
      const bin = desktopBin(dataDir)
      if (!bin) return resolve({ ok: false, error: { code: "NOT_INSTALLED", message: "agent-desktop isn't installed." } })
      execFile(bin, [...args], { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (_e, stdout, stderr) => {
        try {
          resolve(JSON.parse(String(stdout)) as Envelope)
        } catch {
          resolve({ ok: false, error: { code: "BAD_OUTPUT", message: (String(stderr) || String(stdout)).trim().slice(0, 300) || "no answer" } })
        }
      })
    })

export interface DesktopStatus {
  readonly supported: boolean
  readonly installed: boolean
  readonly version: string
  readonly accessibility: string | null // macOS: granted | denied | unknown
  readonly suggestion: string | null
}
export async function desktopStatus(dataDir: string, cli: Cli = desktopCli(dataDir)): Promise<DesktopStatus> {
  const base = { supported: !!targetOf(), version: AGENT_DESKTOP_VERSION, accessibility: null, suggestion: null }
  if (!desktopBin(dataDir)) return { ...base, installed: false }
  const s = await cli(["status"], 15_000)
  const ax = (s.data?.permissions as { accessibility?: { state?: string; suggestion?: string } } | undefined)?.accessibility
  return { ...base, installed: true, accessibility: ax?.state ?? null, suggestion: ax?.state === "granted" ? null : (ax?.suggestion ?? null) }
}
