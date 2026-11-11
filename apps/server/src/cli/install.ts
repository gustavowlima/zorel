// Installing or updating an agent CLI from its source (sources.ts): download, check the published hash, unpack, then
// put it where its official installer would. The new program is copied next to the old one and must answer
// `--version` there before one rename puts it in place (atomic on POSIX; on Windows a running program refuses the
// rename and stays). Claude Code installs itself instead.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { addCliDirsToPath, exe, home } from "./path.ts"
import { type CliId, planFor, SOURCES } from "./sources.ts"
import { cliState, versionAt } from "./versions.ts"

const DOWNLOAD_MS = 300_000
type Installed = { ok: true; version: string } | { ok: false; error: string }

const installing = new Map<CliId, Promise<Installed>>() // a second press waits for the first and gets its answer
export function installCli(id: CliId): Promise<Installed> {
  const running = installing.get(id)
  if (running) return running
  const job = install(id).finally(() => installing.delete(id))
  installing.set(id, job)
  return job
}

// A zip (OpenCode and Codex on Windows, OpenCode on macOS): the system tar (bsdtar) reads it; Bun.Archive reads tar.gz only.
async function unzip(archive: Uint8Array, into: string) {
  const file = join(into, "..", "download.zip")
  await Bun.write(file, archive)
  const p = Bun.spawn(["tar", "-xf", file, "-C", into], { stdout: "ignore", stderr: "pipe" })
  if ((await p.exited) !== 0) throw new Error((await new Response(p.stderr).text()).trim() || "tar couldn't read the zip")
}

// The checked download, unpacked: the program's path inside `work`.
async function fetchChecked(id: CliId, work: string): Promise<{ program: string; version: string } | string> {
  const source = SOURCES[id]
  const plan = await planFor(id)
  if (typeof plan === "string") return plan
  const res = await fetch(plan.url, { signal: AbortSignal.timeout(DOWNLOAD_MS) })
  if (!res.ok) return `Couldn't download ${source.name} (HTTP ${res.status}).`
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (new Bun.CryptoHasher(plan.hash.algo).update(bytes).digest("hex") !== plan.hash.hex) return `The download didn't match ${source.name}'s published checksum, so it wasn't installed.`
  const into = join(work, "out")
  mkdirSync(into)
  const program = join(into, plan.kind === "exe" ? exe(source.bin) : plan.inside)
  if (plan.kind === "exe") await Bun.write(program, bytes)
  else if (plan.kind === "zip") await unzip(bytes, into)
  else await new Bun.Archive(bytes).extract(into)
  if (!existsSync(program)) return `The ${source.name} release didn't hold its program.`
  if (process.platform !== "win32") chmodSync(program, 0o755)
  if (process.platform === "darwin") Bun.spawnSync(["xattr", "-d", "com.apple.quarantine", program], { stderr: "ignore" }) // as the official installers do
  return { program, version: plan.version }
}

// Puts the new program in place: a copy beside the old one (the temp folder may be on another disk, or noexec), checked
// to start, then one rename over it. A copy that doesn't start is dropped and the old one never moved.
export async function swapIn(program: string, dest: string): Promise<boolean> {
  const staged = `${dest}.zorel-new`
  await Bun.write(staged, Bun.file(program))
  if (process.platform !== "win32") chmodSync(staged, 0o755)
  if (!(await versionAt(staged))) {
    rmSync(staged, { force: true })
    return false
  }
  try {
    renameSync(staged, dest)
  } catch (e) {
    rmSync(staged, { force: true })
    throw e
  }
  return true
}

async function install(id: CliId): Promise<Installed> {
  const source = SOURCES[id]
  // Only what Zorel keeps: a copy that comes first on the PATH from elsewhere (Homebrew, npm) is updated where it came
  // from, and one already current has nothing to do (an install there would never run, or would run for nothing).
  const state = await cliState(id)
  if (state.keeper === "you") return { ok: false, error: `${source.name} here comes from somewhere else (${state.version ?? "?"}): update it where you installed it.` }
  if (state.version && state.version !== "?" && !state.behind) return { ok: true, version: state.version }
  const work = mkdtempSync(join(tmpdir(), `zorel-${id}-`))
  try {
    const got = await fetchChecked(id, work)
    if (typeof got === "string") return { ok: false, error: got }
    if (source.selfInstall) {
      // Claude Code puts itself in place (its versions folder and the launcher), as its own installer runs it.
      // stderr read while it runs: a full pipe would stall it.
      const p = Bun.spawn([got.program, "install"], { stdin: "ignore", stdout: "ignore", stderr: "pipe", env: { ...process.env, HOME: home() } })
      const [code, err] = await Promise.all([p.exited, new Response(p.stderr).text()])
      if (code !== 0) return { ok: false, error: `${source.name}'s own install step failed: ${err.trim().split("\n").at(-1) || "no reason given"}` }
    } else {
      const dir = source.dir(home(), process.platform)
      mkdirSync(dir, { recursive: true })
      if (!(await swapIn(got.program, join(dir, exe(source.bin))))) return { ok: false, error: `The new ${source.name} didn't start, so the one you had stays.` }
    }
    addCliDirsToPath()
    return { ok: true, version: got.version }
  } catch (e) {
    const code = (e as { code?: string }).code
    if (code === "EBUSY" || code === "EPERM") return { ok: false, error: `${source.name} is running, so it couldn't be replaced. Let the agents finish, then try again.` }
    return { ok: false, error: `Couldn't install ${source.name}: ${e instanceof Error ? e.message : String(e)}` }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}
