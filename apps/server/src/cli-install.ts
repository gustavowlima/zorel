// In-app install of the agent CLIs that ship one program per platform: Antigravity (agy) and OpenCode. Each comes
// from its official source and is checked before use, as their own installers do, without running a script:
// - agy: Google's release manifest (the one antigravity.google/cli/install.sh reads) gives the build's URL and SHA-512;
// - OpenCode: the latest GitHub release of anomalyco/opencode (the one opencode.ai/install reads), whose assets carry
//   GitHub's SHA-256 digest.
// The program lands where the official installer puts it (so the person's terminal and `agy update` find it), and
// those folders go on the server's PATH (cliDirs). Signing in stays the CLI's own: run it once in a terminal.
// Gemini CLI isn't here: it ships as an npm package that needs Node.js (only unsigned macOS builds otherwise).
import { chmodSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { delimiter, join } from "node:path"

export type CliId = "antigravity" | "opencode"
type Plan = { url: string; hash: { algo: "sha512" | "sha256"; hex: string }; kind: "tar.gz" | "zip" | "exe"; inside: string; version: string }
type Spec = { bin: string; dir: (home: string, platform: string) => string; plan: (platform: string, arch: string, musl: boolean) => Promise<Plan | string> }

const home = () => process.env.ZOREL_CLI_HOME ?? homedir() // tests: a throwaway home
const exe = (name: string, platform: string) => (platform === "win32" ? `${name}.exe` : name)
const ARCH: Readonly<Record<string, string>> = { x64: "amd64", arm64: "arm64" }
const isMusl = () => process.platform === "linux" && (existsSync("/lib/libc.musl-x86_64.so.1") || existsSync("/lib/libc.musl-aarch64.so.1"))

const AGY_MANIFESTS = "https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests"
const AGY_BUILDS = "https://storage.googleapis.com/antigravity-public/"
const OPENCODE_LATEST = "https://api.github.com/repos/anomalyco/opencode/releases/latest"
const OPENCODE_BUILDS = "https://github.com/anomalyco/opencode/releases/download/"

// "darwin_arm64", "linux_amd64_musl", "windows_amd64": the manifest name for this system (undefined: no build).
export function agyPlatform(platform: string, arch: string, musl: boolean): string | undefined {
  const os = ({ darwin: "darwin", linux: "linux", win32: "windows" } as Record<string, string>)[platform]
  const a = ARCH[arch]
  return os && a ? `${os}_${a}${os === "linux" && musl ? "_musl" : ""}` : undefined
}
// "opencode-darwin-arm64.zip", "opencode-linux-x64-musl.tar.gz", "opencode-windows-x64.zip".
export function opencodeAsset(platform: string, arch: string, musl: boolean): string | undefined {
  const os = ({ darwin: "darwin", linux: "linux", win32: "windows" } as Record<string, string>)[platform]
  if (!os || (arch !== "x64" && arch !== "arm64")) return undefined
  return `opencode-${os}-${arch}${os === "linux" && musl ? "-musl" : ""}${os === "linux" ? ".tar.gz" : ".zip"}`
}

const getJson = async (url: string) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { accept: "application/json" } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return (await res.json()) as unknown
}

const SPECS: Readonly<Record<CliId, Spec>> = {
  antigravity: {
    bin: "agy",
    dir: (home, platform) => (platform === "win32" ? join(process.env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "agy", "bin") : join(home, ".local", "bin")),
    plan: async (platform, arch, musl) => {
      const name = agyPlatform(platform, arch, musl)
      if (!name) return `Antigravity isn't available for ${platform} on ${arch}.`
      const m = (await getJson(`${AGY_MANIFESTS}/${name}.json`)) as { version?: unknown; url?: unknown; sha512?: unknown }
      if (typeof m.url !== "string" || typeof m.sha512 !== "string" || !/^[0-9a-f]{128}$/i.test(m.sha512)) return "Antigravity's release manifest couldn't be read."
      if (!m.url.startsWith(AGY_BUILDS)) return "Antigravity's release manifest pointed somewhere unexpected, so nothing was downloaded."
      return { url: m.url, hash: { algo: "sha512", hex: m.sha512.toLowerCase() }, kind: m.url.endsWith(".tar.gz") ? "tar.gz" : "exe", inside: "antigravity", version: String(m.version ?? "") }
    }
  },
  opencode: {
    bin: "opencode",
    dir: (home) => join(home, ".opencode", "bin"),
    plan: async (platform, arch, musl) => {
      const file = opencodeAsset(platform, arch, musl)
      if (!file) return `OpenCode isn't available for ${platform} on ${arch}.`
      const rel = (await getJson(OPENCODE_LATEST)) as { tag_name?: unknown; assets?: ReadonlyArray<{ name?: unknown; browser_download_url?: unknown; digest?: unknown }> }
      const asset = rel.assets?.find((a) => a.name === file)
      const digest = typeof asset?.digest === "string" ? /^sha256:([0-9a-f]{64})$/i.exec(asset.digest)?.[1] : undefined
      const url = asset?.browser_download_url
      if (typeof url !== "string" || !digest) return "OpenCode's latest release has no checked build for this system."
      if (!url.startsWith(OPENCODE_BUILDS)) return "OpenCode's release pointed somewhere unexpected, so nothing was downloaded."
      return { url, hash: { algo: "sha256", hex: digest.toLowerCase() }, kind: file.endsWith(".zip") ? "zip" : "tar.gz", inside: exe("opencode", platform), version: String(rel.tag_name ?? "").replace(/^v/, "") }
    }
  }
}

// Bun.which reads the PATH the process started with, not later changes to process.env.PATH (addCliDirsToPath, an
// install): every lookup of a program goes through this, with today's PATH.
export const which = (bin: string): string | null => Bun.which(bin, { PATH: process.env.PATH ?? "" })

// The folders the official installers use: put on the server's PATH at start, so a CLI installed here (or by its own
// installer, which may not have touched this process's PATH) is found.
export const cliDirs = (base = home(), platform = process.platform) => [...new Set(Object.values(SPECS).map((s) => s.dir(base, platform)))]
export function addCliDirsToPath() {
  const have = (process.env.PATH ?? "").split(delimiter)
  const extra = cliDirs().filter((d) => !have.includes(d))
  if (extra.length) process.env.PATH = [...have, ...extra].filter(Boolean).join(delimiter) // after the person's own
}

// A zip (OpenCode on macOS and Windows): the system tar (bsdtar on both) reads it; Bun.Archive reads tar.gz only.
async function unzip(archive: Uint8Array, into: string) {
  const file = join(into, "..", "download.zip")
  await Bun.write(file, archive)
  const p = Bun.spawn(["tar", "-xf", file, "-C", into], { stdout: "ignore", stderr: "pipe" })
  if ((await p.exited) !== 0) throw new Error((await new Response(p.stderr).text()).trim() || "tar couldn't read the zip")
}

type Installed = { ok: true; version: string } | { ok: false; error: string }
const installing = new Map<CliId, Promise<Installed>>() // a second press waits for the first and gets its answer
export function installCli(id: CliId): Promise<Installed> {
  const running = installing.get(id)
  if (running) return running
  const job = install(id).finally(() => installing.delete(id))
  installing.set(id, job)
  return job
}

async function install(id: CliId): Promise<Installed> {
  const spec = SPECS[id]
  const name = id === "antigravity" ? "Antigravity" : "OpenCode"
  const work = mkdtempSync(join(tmpdir(), `zorel-${id}-`))
  try {
    const plan = await spec.plan(process.platform, process.arch, isMusl())
    if (typeof plan === "string") return { ok: false, error: plan }
    const res = await fetch(plan.url, { signal: AbortSignal.timeout(300_000) })
    if (!res.ok) return { ok: false, error: `Couldn't download ${name} (HTTP ${res.status}).` }
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (new Bun.CryptoHasher(plan.hash.algo).update(bytes).digest("hex") !== plan.hash.hex) return { ok: false, error: `The download didn't match ${name}'s published checksum, so it wasn't installed.` }
    const into = join(work, "out")
    mkdirSync(into)
    const program = join(into, plan.kind === "exe" ? exe(spec.bin, process.platform) : plan.inside)
    if (plan.kind === "exe") await Bun.write(program, bytes)
    else if (plan.kind === "zip") await unzip(bytes, into)
    else await new Bun.Archive(bytes).extract(into)
    if (!existsSync(program)) return { ok: false, error: `The ${name} release didn't hold its program.` }
    if (process.platform !== "win32") chmodSync(program, 0o755)
    if (process.platform === "darwin") Bun.spawnSync(["xattr", "-d", "com.apple.quarantine", program], { stderr: "ignore" }) // as the official installer does
    const dir = spec.dir(home(), process.platform)
    mkdirSync(dir, { recursive: true })
    const dest = join(dir, exe(spec.bin, process.platform))
    // Moved into place in one step (a copy first when the temp folder is on another disk).
    const staged = join(dir, `.${exe(spec.bin, process.platform)}.zorel-new`)
    await Bun.write(staged, Bun.file(program))
    if (process.platform !== "win32") chmodSync(staged, 0o755)
    renameSync(staged, dest)
    addCliDirsToPath()
    return { ok: true, version: plan.version }
  } catch (e) {
    const code = (e as { code?: string }).code
    if (code === "EBUSY" || code === "EPERM") return { ok: false, error: `${name} is running, so it couldn't be replaced. Let the agents finish, then try again.` }
    return { ok: false, error: `Couldn't install ${name}: ${e instanceof Error ? e.message : String(e)}` }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}
