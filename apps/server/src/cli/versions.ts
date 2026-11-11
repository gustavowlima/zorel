// Which version of each agent CLI runs here, the latest one its source offers, and who keeps it up to date:
// - "self": the CLI updates itself (Claude Code): Zorel only shows the version;
// - "zorel": it lives where the official installer puts it (cliDirs), so Zorel updates it from the same source;
// - "you": another copy comes first on the PATH (Homebrew, npm): it's the person's, updated where it came from. Zorel
//   never runs another tool's updater.
// The latest versions are read at most every LATEST_TTL_MS (or now, when asked), without downloading anything.
import { dirname } from "node:path"
import { cliDirs, which } from "./path.ts"
import { CLI_IDS, type CliId, planFor, SOURCES } from "./sources.ts"

const LATEST_TTL_MS = 6 * 60 * 60 * 1000
const VERSION_MS = 5000

export type Version = readonly [number, number, number]
// The first x.y.z in a text ("codex-cli 0.167.1", "2.1.322 (Claude Code)", "v1.4.0").
export const versionOf = (text: string): Version | undefined => {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(text)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined
}
export const shown = (v: Version) => v.join(".")
// Whether `a` is newer than `b`.
export const newer = (a: Version, b: Version) => {
  for (let i = 0; i < 3; i++) if (a[i]! !== b[i]!) return a[i]! > b[i]!
  return false
}

// The version a program reports (undefined when it doesn't start, fails or takes over VERSION_MS). Asynchronous:
// a probe never blocks the server.
export async function versionAt(path: string): Promise<Version | undefined> {
  try {
    const p = Bun.spawn([path, "--version"], { stdin: "ignore", stdout: "pipe", stderr: "ignore" })
    const timer = setTimeout(() => p.kill(), VERSION_MS)
    const [out, code] = await Promise.all([new Response(p.stdout).text(), p.exited])
    clearTimeout(timer)
    return code === 0 ? versionOf(out) : undefined
  } catch (e) {
    console.warn(`[cli] ${path} --version failed`, e) // not runnable (permissions, a broken link): shown as "?"
    return undefined
  }
}

// The program the PATH finds, and the version it reports.
export async function running(bin: string): Promise<{ path: string; version: Version | undefined } | undefined> {
  const path = which(bin)
  return path ? { path, version: await versionAt(path) } : undefined
}

// The latest version each source offers, remembered until `until` (LATEST_TTL_MS; a miss only MISS_MS). The read
// itself is shared: checks that come while one is out wait for it.
const MISS_MS = 10 * 60 * 1000
const latestSeen = new Map<CliId, { until: number; version: Promise<Version | undefined> }>()
export function latest(id: CliId, fresh = false): Promise<Version | undefined> {
  const seen = latestSeen.get(id)
  if (seen && (!fresh || seen.until === Number.POSITIVE_INFINITY) && Date.now() < seen.until) return seen.version
  const version = planFor(id)
    .then((plan) => (typeof plan === "string" ? undefined : versionOf(plan.version)))
    .catch((e) => {
      console.warn(`[cli] couldn't read the latest ${id}`, e)
      return undefined
    })
  latestSeen.set(id, { until: Number.POSITIVE_INFINITY, version }) // in flight
  void version.then((v) => latestSeen.set(id, { until: Date.now() + (v ? LATEST_TTL_MS : MISS_MS), version }))
  return version
}

export type CliState = {
  id: CliId
  name: string
  version: string | null // what runs here (null: not installed)
  latest: string | null // what its source offers (null: couldn't be read)
  keeper: "self" | "zorel" | "you"
  behind: boolean // a newer version is out
  update: boolean // and Zorel can bring it there (its keeper is Zorel)
}

export async function cliState(id: CliId, fresh = false): Promise<CliState> {
  const source = SOURCES[id]
  const [now, last] = await Promise.all([running(source.bin), latest(id, fresh)])
  const ours = !!now && cliDirs().includes(dirname(now.path))
  const keeper = source.selfUpdates ? "self" : !now || ours ? "zorel" : "you"
  const behind = !!now?.version && !!last && newer(last, now.version)
  return {
    id,
    name: source.name,
    version: now?.version ? shown(now.version) : now ? "?" : null,
    latest: last ? shown(last) : null,
    keeper,
    behind,
    update: keeper === "zorel" && behind
  }
}

export const cliStates = (fresh = false) => Promise.all(CLI_IDS.map((id) => cliState(id, fresh)))
