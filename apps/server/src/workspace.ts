// Workspace (ARCHITECTURE §9.1, D17 port): where a project's agents work, and the checkpoints of each turn.
// The project's own git repository is never touched. Zorel keeps a shadow repository per project in its data
// folder (GIT_DIR there, GIT_WORK_TREE = the project folder) and records a git tree before and after every
// turn. The diff of a turn and its undo come from those two trees, the same for every harness.
// Ignored files (the project's .gitignore, plus node_modules) are outside the checkpoints.
import { type FileChange, type FileDiff, type Project, WorkspaceInvalid, type WorkspaceFile, MAX_WORKSPACE_FILES } from "@zorel/contracts"
import { Context, Effect, Layer, Semaphore } from "effect"
import { existsSync, mkdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, join, resolve, sep } from "node:path"
import { DataDir } from "./chat.ts"
import { which } from "./cli-install.ts"

const EXCLUDE = ["node_modules/", ".DS_Store"].join("\n")
type Status = FileChange["status"]
const STATUS: Record<string, Status> = { A: "added", M: "modified", D: "deleted", T: "modified" }

interface WorkspaceService {
  // The folder as stored: absolute, real, an existing directory, and not one agents must never own.
  readonly validate: (path: string) => Effect.Effect<string, WorkspaceInvalid>
  // Where a chat's agents work: the project folder, or an empty Zorel folder for the chat.
  readonly cwdOf: (chatId: string, project: Project | undefined) => string
  // Checkpoint of the project folder (a git tree id); null when there's no folder or no git.
  readonly snapshot: (project: Project | undefined) => Effect.Effect<string | null>
  readonly changes: (projectId: string, before: string, after: string) => Effect.Effect<FileChange[]>
  readonly diff: (projectId: string, before: string, after: string) => Effect.Effect<FileDiff[]>
  // Puts the files the turn changed back as they were before it. Refuses (returns the files) when any of
  // them changed after the turn, so nobody's later work is lost.
  readonly restore: (project: Project, before: string, after: string) => Effect.Effect<{ readonly conflicts: ReadonlyArray<string> }>
  readonly files: (project: Project, since: string | null) => Effect.Effect<WorkspaceFile[]>
}

export class Workspace extends Context.Service<Workspace, WorkspaceService>()("Workspace") {
  static layer = Layer.effect(
    Workspace,
    Effect.gen(function* () {
      const dataDir = resolve(yield* DataDir)
      const gitBin = which("git")
      const locks = new Map<string, Semaphore.Semaphore>()
      const lockOf = (id: string) => {
        let l = locks.get(id)
        if (!l) {
          l = Semaphore.makeUnsafe(1)
          locks.set(id, l)
        }
        return l
      }
      const gitDir = (projectId: string) => join(dataDir, "workspaces", `${projectId}.git`)

      // Runs git on the shadow repository of a project. Throws with git's message on failure.
      const git = async (projectId: string, workTree: string, args: string[], allowFail = false) => {
        const env: Record<string, string> = {}
        for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
        Object.assign(env, { GIT_DIR: gitDir(projectId), GIT_WORK_TREE: workTree, GIT_AUTHOR_NAME: "Zorel", GIT_AUTHOR_EMAIL: "zorel@localhost", GIT_COMMITTER_NAME: "Zorel", GIT_COMMITTER_EMAIL: "zorel@localhost" })
        const proc = Bun.spawn([gitBin!, "-c", "core.quotepath=false", "-c", "core.autocrlf=false", ...args], { cwd: workTree, env, stdout: "pipe", stderr: "pipe" })
        const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
        if (code !== 0 && !allowFail) throw new Error(`git ${args[0]}: ${err.trim() || `exit ${code}`}`)
        return out
      }
      const ensure = async (project: Project & { path: string }) => {
        const dir = gitDir(project.id)
        if (existsSync(join(dir, "HEAD"))) return
        mkdirSync(dir, { recursive: true })
        await git(project.id, project.path, ["init", "--quiet"])
        mkdirSync(join(dir, "info"), { recursive: true })
        writeFileSync(join(dir, "info", "exclude"), `${EXCLUDE}\n`)
      }
      const treeNow = async (project: Project & { path: string }) => {
        await ensure(project)
        await git(project.id, project.path, ["add", "--all", "--", "."])
        return (await git(project.id, project.path, ["write-tree"])).trim()
      }
      const withPath = (p: Project | undefined): (Project & { path: string }) | undefined => (p?.path && gitBin && existsSync(p.path) ? (p as Project & { path: string }) : undefined)

      const nameStatus = async (projectId: string, workTree: string, a: string, b: string) => {
        const out = await git(projectId, workTree, ["diff", "--no-renames", "--name-status", "-z", a, b])
        const parts = out.split("\0").filter(Boolean)
        const map = new Map<string, Status>()
        for (let i = 0; i + 1 < parts.length; i += 2) map.set(parts[i + 1]!, STATUS[parts[i]![0]!] ?? "modified")
        return map
      }
      // Tree-to-tree diffs don't read the work tree; any folder works as one.
      const changesOf = async (projectId: string, before: string, after: string): Promise<FileChange[]> => {
        if (before === after || !gitBin) return []
        const status = await nameStatus(projectId, dataDir, before, after)
        const numstat = await git(projectId, dataDir, ["diff", "--no-renames", "--numstat", "-z", before, after])
        return numstat
          .split("\0")
          .filter(Boolean)
          .map((line) => {
            const [added, removed, path] = line.split("\t") as [string, string, string]
            return { path, added: Number(added) || 0, removed: Number(removed) || 0, status: status.get(path) ?? "modified" }
          })
      }

      const service: WorkspaceService = {
        validate: (raw) =>
          Effect.suspend(() => {
            if (!isAbsolute(raw)) return Effect.fail(new WorkspaceInvalid({ reason: "relative" }))
            if (!existsSync(raw)) return Effect.fail(new WorkspaceInvalid({ reason: "missing" }))
            const real = realpathSync(raw)
            if (!statSync(real).isDirectory()) return Effect.fail(new WorkspaceInvalid({ reason: "not_directory" }))
            const home = realpathSync(homedir())
            const data = existsSync(dataDir) ? realpathSync(dataDir) : dataDir
            if (real === sep || real === home || real === data || real.startsWith(data + sep)) return Effect.fail(new WorkspaceInvalid({ reason: "forbidden" }))
            return Effect.succeed(real)
          }),
        cwdOf: (chatId, project) => withPath(project)?.path ?? join(dataDir, "runs", chatId),
        snapshot: (project) => {
          const p = withPath(project)
          if (!p) return Effect.succeed(null)
          return lockOf(p.id).withPermits(1)(
            Effect.tryPromise(() => treeNow(p)).pipe(
              Effect.tapError((e) => Effect.logWarning("workspace checkpoint failed", { projectId: p.id, error: String(e) })),
              Effect.orElseSucceed(() => null)
            )
          )
        },
        changes: (projectId, before, after) => Effect.promise(() => changesOf(projectId, before, after)),
        diff: (projectId, before, after) =>
          Effect.promise(async () => {
            const changes = await changesOf(projectId, before, after)
            if (!changes.length) return []
            const patch = await git(projectId, dataDir, ["diff", "--no-renames", "--no-color", before, after])
            const byPath = new Map<string, string>()
            for (const chunk of patch.split(/^(?=diff --git )/m)) {
              const m = /^diff --git a\/(.+?) b\/(.+)$/m.exec(chunk)
              if (m) byPath.set(m[2]!, chunk)
            }
            return changes.map((c) => ({ ...c, patch: byPath.get(c.path) ?? "" }))
          }),
        restore: (project, before, after) => {
          const p = withPath(project)
          if (!p) return Effect.succeed({ conflicts: [] })
          return lockOf(p.id).withPermits(1)(
            Effect.promise(async () => {
              const touched = await nameStatus(p.id, p.path, before, after)
              const now = await treeNow(p)
              const later = await nameStatus(p.id, p.path, after, now)
              const conflicts = [...touched.keys()].filter((f) => later.has(f))
              if (conflicts.length) return { conflicts }
              for (const [file, status] of touched) {
                if (status === "added") rmSync(join(p.path, file), { force: true })
                else await git(p.id, p.path, ["checkout", before, "--", file])
              }
              return { conflicts: [] }
            })
          )
        },
        files: (project, since) => {
          const p = withPath(project)
          if (!p) return Effect.succeed([])
          return lockOf(p.id).withPermits(1)(
            Effect.promise(async () => {
              const now = await treeNow(p)
              const listed = (await git(p.id, p.path, ["ls-tree", "-r", "--name-only", "-z", now])).split("\0").filter(Boolean)
              const marks = since ? await nameStatus(p.id, p.path, since, now) : new Map<string, Status>()
              const deleted = [...marks].filter(([, s]) => s === "deleted").map(([f]) => f)
              return [...listed, ...deleted].slice(0, MAX_WORKSPACE_FILES).map((path) => ({ path, status: marks.get(path) ?? null }))
            })
          )
        }
      }
      return service
    })
  )
}
