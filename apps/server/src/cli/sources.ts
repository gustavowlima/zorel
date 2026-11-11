// Where each agent CLI comes from: its official release source, the build for this system, and the hash that source
// publishes for it. A plan is read without downloading anything, so it also answers "what's the latest version".
// - Claude Code: its release bucket (the one claude.ai/install.sh reads): the latest version and the manifest's
//   SHA-256 for this system; the program then installs itself (`claude install`) and keeps itself up to date;
// - Codex: the latest GitHub release of openai/codex, whose assets carry GitHub's SHA-256 digest;
// - Antigravity (agy): Google's release manifest (the one antigravity.google/cli/install.sh reads), with a SHA-512;
// - OpenCode: the latest GitHub release of anomalyco/opencode (the one opencode.ai/install reads), SHA-256 digests.
// Gemini CLI isn't here: it ships as an npm package that needs Node.js (only unsigned macOS builds otherwise).
import { existsSync } from "node:fs"
import { DIRS, exe } from "./path.ts"

export type CliId = "claude" | "codex" | "antigravity" | "opencode"
export const CLI_IDS: ReadonlyArray<CliId> = ["claude", "codex", "antigravity", "opencode"]
export type Plan = { url: string; hash: { algo: "sha512" | "sha256"; hex: string }; kind: "tar.gz" | "zip" | "exe"; inside: string; version: string }
export type Source = {
  name: string
  bin: string
  dir: (home: string, platform: string) => string // where its installer puts it
  selfInstall?: true // the checked program puts itself in place (`<program> install`) instead of Zorel copying it
  selfUpdates?: true // it keeps itself up to date: Zorel only shows the version
  plan: (platform: string, arch: string, musl: boolean) => Promise<Plan | string> // a string: why there's none
}

const AGY_MANIFESTS = "https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests"
const AGY_BUILDS = "https://storage.googleapis.com/antigravity-public/"
const OPENCODE_LATEST = "https://api.github.com/repos/anomalyco/opencode/releases/latest"
const OPENCODE_BUILDS = "https://github.com/anomalyco/opencode/releases/download/"
const CLAUDE_RELEASES = "https://downloads.claude.ai/claude-code-releases"
const CODEX_LATEST = "https://api.github.com/repos/openai/codex/releases/latest"
const CODEX_BUILDS = "https://github.com/openai/codex/releases/download/"
const FETCH_MS = 30_000

export const isMusl = () => process.platform === "linux" && (existsSync("/lib/libc.musl-x86_64.so.1") || existsSync("/lib/libc.musl-aarch64.so.1"))

// ---------- this system's build name, per source ----------
const OS = { darwin: "darwin", linux: "linux", win32: "windows" } as Readonly<Record<string, string>>
const AMD = { x64: "amd64", arm64: "arm64" } as Readonly<Record<string, string>>
// "darwin-arm64", "linux-x64-musl", "win32-x64".
export function claudePlatform(platform: string, arch: string, musl: boolean): string | undefined {
  if (!["darwin", "linux", "win32"].includes(platform) || (arch !== "x64" && arch !== "arm64")) return undefined
  return `${platform}-${arch}${platform === "linux" && musl ? "-musl" : ""}`
}
// "codex-aarch64-apple-darwin.tar.gz", "codex-x86_64-unknown-linux-musl.tar.gz" (static, any Linux), "codex-x86_64-pc-windows-msvc.exe.zip".
export function codexAsset(platform: string, arch: string): string | undefined {
  const cpu = ({ x64: "x86_64", arm64: "aarch64" } as Readonly<Record<string, string>>)[arch]
  const os = ({ darwin: "apple-darwin", linux: "unknown-linux-musl", win32: "pc-windows-msvc" } as Readonly<Record<string, string>>)[platform]
  if (!cpu || !os) return undefined
  return platform === "win32" ? `codex-${cpu}-${os}.exe.zip` : `codex-${cpu}-${os}.tar.gz`
}
// "darwin_arm64", "linux_amd64_musl", "windows_amd64".
export function agyPlatform(platform: string, arch: string, musl: boolean): string | undefined {
  const os = OS[platform]
  const a = AMD[arch]
  return os && a ? `${os}_${a}${os === "linux" && musl ? "_musl" : ""}` : undefined
}
// "opencode-darwin-arm64.zip", "opencode-linux-x64-musl.tar.gz", "opencode-windows-x64.zip".
export function opencodeAsset(platform: string, arch: string, musl: boolean): string | undefined {
  const os = OS[platform]
  if (!os || (arch !== "x64" && arch !== "arm64")) return undefined
  return `opencode-${os}-${arch}${os === "linux" && musl ? "-musl" : ""}${os === "linux" ? ".tar.gz" : ".zip"}`
}

// ---------- reading a source ----------
const getJson = async (url: string) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_MS), headers: { accept: "application/json" } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return (await res.json()) as unknown
}
// One asset of a GitHub release, with the SHA-256 digest GitHub publishes for it.
async function githubAsset(latest: string, builds: string, file: string, name: string) {
  const rel = (await getJson(latest)) as { tag_name?: unknown; assets?: ReadonlyArray<{ name?: unknown; browser_download_url?: unknown; digest?: unknown }> }
  const asset = rel.assets?.find((a) => a.name === file)
  const digest = typeof asset?.digest === "string" ? /^sha256:([0-9a-f]{64})$/i.exec(asset.digest)?.[1] : undefined
  const url = asset?.browser_download_url
  if (typeof url !== "string" || !digest) return `${name}'s latest release has no checked build for this system.`
  if (!url.startsWith(builds)) return `${name}'s release pointed somewhere unexpected, so nothing was downloaded.`
  return { url, digest: digest.toLowerCase(), version: String(rel.tag_name ?? "").replace(/^(rust-)?v/, "") }
}

export const SOURCES: Readonly<Record<CliId, Source>> = {
  claude: {
    name: "Claude Code",
    bin: "claude",
    dir: DIRS.local,
    selfInstall: true,
    selfUpdates: true,
    plan: async (platform, arch, musl) => {
      const name = claudePlatform(platform, arch, musl)
      if (!name) return `Claude Code isn't available for ${platform} on ${arch}.`
      const res = await fetch(`${CLAUDE_RELEASES}/latest`, { signal: AbortSignal.timeout(FETCH_MS) })
      const version = res.ok ? (await res.text()).trim() : ""
      if (!/^\d+\.\d+\.\d+$/.test(version)) return "Claude Code's latest version couldn't be read."
      const m = (await getJson(`${CLAUDE_RELEASES}/${version}/manifest.json`)) as { platforms?: Record<string, { binary?: unknown; checksum?: unknown }> }
      const entry = m.platforms?.[name]
      const binary = entry?.binary === "claude" || entry?.binary === "claude.exe" ? entry.binary : undefined
      if (!binary || typeof entry?.checksum !== "string" || !/^[0-9a-f]{64}$/i.test(entry.checksum)) return "Claude Code's release manifest has no checked build for this system."
      return { url: `${CLAUDE_RELEASES}/${version}/${name}/${binary}`, hash: { algo: "sha256", hex: entry.checksum.toLowerCase() }, kind: "exe", inside: binary, version }
    }
  },
  codex: {
    name: "Codex",
    bin: "codex",
    dir: DIRS.local,
    plan: async (platform, arch) => {
      const file = codexAsset(platform, arch)
      if (!file) return `Codex isn't available for ${platform} on ${arch}.`
      const a = await githubAsset(CODEX_LATEST, CODEX_BUILDS, file, "Codex")
      if (typeof a === "string") return a
      return { url: a.url, hash: { algo: "sha256", hex: a.digest }, kind: platform === "win32" ? "zip" : "tar.gz", inside: file.replace(/\.(tar\.gz|zip)$/, ""), version: a.version }
    }
  },
  antigravity: {
    name: "Antigravity",
    bin: "agy",
    dir: DIRS.agy,
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
    name: "OpenCode",
    bin: "opencode",
    dir: DIRS.opencode,
    plan: async (platform, arch, musl) => {
      const file = opencodeAsset(platform, arch, musl)
      if (!file) return `OpenCode isn't available for ${platform} on ${arch}.`
      const a = await githubAsset(OPENCODE_LATEST, OPENCODE_BUILDS, file, "OpenCode")
      if (typeof a === "string") return a
      return { url: a.url, hash: { algo: "sha256", hex: a.digest }, kind: file.endsWith(".zip") ? "zip" : "tar.gz", inside: exe("opencode", platform), version: a.version }
    }
  }
}

export const planFor = (id: CliId) => SOURCES[id].plan(process.platform, process.arch, isMusl())

export const cliName = (id: CliId) => SOURCES[id].name
