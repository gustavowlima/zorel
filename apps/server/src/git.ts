// Git from the chat (the project's own repository, in the folder the chat's agents work in): where the branch is,
// what changed, and the three steps that ship it — commit, push, open a pull request (GitHub, through the `gh`
// CLI when it is installed and signed in). Messages are written by the person or drafted by the chat's model from
// the diff, in the style of the repository's recent commits. Nothing here runs without the person pressing it.
import type { GitStatus } from "@zorel/contracts"
import { which } from "./cli-install.ts"

const MAX_DIFF = 40_000 // diff text handed to the model for a draft
const OUT_CAP = 2_000 // git's message kept for an error

export class GitFailed extends Error {}

async function run(cwd: string, cmd: string[], allowFail = false): Promise<string> {
  const p = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } })
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
  if (code !== 0 && !allowFail) throw new GitFailed((err.trim() || out.trim() || `${cmd[0]} exited with ${code}`).slice(0, OUT_CAP))
  return code === 0 ? out : ""
}
const git = (cwd: string, args: string[], allowFail = false) => run(cwd, ["git", ...args], allowFail)

const ghPath = which("gh") // the GitHub CLI, if installed (looked up once)
const gh = () => ghPath

// "## main...origin/main [ahead 2, behind 1]" and one " M file" line per change.
export function parsePorcelain(out: string) {
  const [head = "", ...rest] = out.split("\n")
  const m = /^## (?:No commits yet on )?([^.\s]+)(?:\.\.\.(\S+))?(?: \[(?:ahead (\d+))?(?:, )?(?:behind (\d+))?\])?/.exec(head)
  return {
    branch: m?.[1] && m[1] !== "HEAD" ? m[1] : null,
    upstream: m?.[2] ?? null,
    ahead: Number(m?.[3] ?? 0),
    behind: Number(m?.[4] ?? 0),
    files: rest.filter((l) => l.trim()).map(fileOf)
  }
}

// One " M file" line: "??" and A are new, D gone, R renamed ("old -> new": the new name), the rest modified.
const fileOf = (line: string) => {
  const xy = line.slice(0, 2)
  const path = line.slice(3)
  const status = xy === "??" || xy.includes("A") ? "added" : xy.includes("D") ? "deleted" : xy.includes("R") ? "renamed" : "modified"
  return { path: status === "renamed" ? path.slice(path.indexOf(" -> ") + 4) : path, status } as const
}

export async function status(cwd: string): Promise<GitStatus> {
  const inside = (await git(cwd, ["rev-parse", "--is-inside-work-tree"], true)).trim() === "true"
  if (!inside) return { repo: false, branch: null, base: null, upstream: null, ahead: 0, behind: 0, files: [], remote: false, gh: false, pr: null, commits: [] }
  const s = parsePorcelain(await git(cwd, ["status", "--porcelain=v1", "-b", "--untracked-files=all"]))
  const remote = (await git(cwd, ["remote"], true)).trim().length > 0
  let pr: GitStatus["pr"] = null
  if (gh() && remote && s.branch) {
    const out = await run(cwd, [gh()!, "pr", "view", "--json", "number,url,state,title"], true)
    try {
      const v = JSON.parse(out) as { number: number; url: string; state: string; title: string }
      pr = { number: v.number, url: v.url, state: v.state.toLowerCase(), title: v.title }
    } catch {}
  }
  return { repo: true, ...s, base: await baseBranch(cwd), remote, gh: !!gh(), pr, commits: parseLog(await git(cwd, ["log", "-15", "--format=%h%x1f%s%x1f%ct"], true), s.ahead) }
}

// `git log --format=%h%x1f%s%x1f%ct`: the first `ahead` are not on the upstream yet.
const parseLog = (out: string, ahead: number) =>
  out
    .split("\n")
    .filter(Boolean)
    .map((line, i) => {
      const [sha = "", subject = "", at = "0"] = line.split("\x1f")
      return { sha, subject, at: Number(at) * 1000, pushed: i >= ahead }
    })

// Everything in the folder goes into the commit (what the panel shows is what gets committed).
export async function commit(cwd: string, message: string) {
  await git(cwd, ["add", "-A"])
  await git(cwd, ["commit", "-m", message])
  return (await git(cwd, ["rev-parse", "--short", "HEAD"])).trim()
}

// To the branch's upstream, or a new one of the same name on origin.
export async function push(cwd: string) {
  const s = await status(cwd)
  if (!s.branch) throw new GitFailed("Not on a branch.")
  await git(cwd, s.upstream ? ["push"] : ["push", "-u", "origin", s.branch])
}

export async function createPr(cwd: string, title: string, body: string) {
  if (!gh()) throw new GitFailed("The GitHub CLI (gh) is not installed.")
  await push(cwd)
  const out = await run(cwd, [gh()!, "pr", "create", "--title", title, "--body", body])
  return out.trim().split("\n").at(-1) ?? ""
}

// A new branch from where the folder is now (the changes come along).
export async function switchToNewBranch(cwd: string, name: string) {
  await git(cwd, ["check-ref-format", "--branch", name])
  await git(cwd, ["switch", "-c", name])
}

// ---------- drafts: what the model reads to write a message ----------

const clip = (s: string) => (s.length > MAX_DIFF ? `${s.slice(0, MAX_DIFF)}\n[… diff cut at ${MAX_DIFF} characters]` : s)

export async function commitDraftPrompt(cwd: string) {
  // The diff against the last commit, plus new files (read, not staged: the index is left as it is).
  const [tracked, untracked, log] = await Promise.all([
    git(cwd, ["diff", "HEAD"], true),
    git(cwd, ["ls-files", "--others", "--exclude-standard"], true),
    git(cwd, ["log", "-12", "--format=%B%n---"], true)
  ])
  const added = await Promise.all(
    untracked.split("\n").filter(Boolean).slice(0, 50).map(async (f) => `new file ${f}\n${(await Bun.file(`${cwd}/${f}`).text().catch(() => "")).slice(0, 4000)}`)
  )
  const diff = [tracked, ...added].join("\n")
  if (!diff.trim()) throw new GitFailed("Nothing to commit.")
  return [
    "Write the commit message for this diff, in the style of the repository's recent commits below (language, length, prefixes, trailers).",
    "Answer with the message only: a subject line, then a blank line and a short body if it helps. No code fences.",
    `Recent commits:\n${log.trim() || "(none)"}`,
    `Diff:\n${clip(diff)}`
  ].join("\n\n")
}

// The default branch: origin's HEAD when known, else main or master if one exists.
async function baseBranch(cwd: string): Promise<string | null> {
  const head = (await git(cwd, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], true)).trim()
  if (head) return head.replace(/^origin\//, "")
  for (const b of ["main", "master"]) if ((await git(cwd, ["rev-parse", "--verify", "--quiet", b], true)).trim()) return b
  return null
}

export async function prDraftPrompt(cwd: string) {
  const base = `origin/${(await baseBranch(cwd)) ?? "main"}`
  const [log, stat] = await Promise.all([git(cwd, ["log", `${base}..HEAD`, "--format=%B%n---"], true), git(cwd, ["diff", `${base}...HEAD`, "--stat"], true)])
  if (!log.trim()) throw new GitFailed(`No commits ahead of ${base}.`)
  return [
    "Write the pull request for these commits.",
    'Answer with JSON only: {"title": "…", "body": "…"}. The body is short markdown: what changed and why, then how it was tested if the commits say.',
    `Commits:\n${clip(log)}`,
    `Files:\n${stat}`
  ].join("\n\n")
}

// The model's answer to a PR draft (tolerates a fence or text around the JSON).
export function parsePrDraft(text: string): { title: string; body: string } {
  try {
    const v = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { title?: unknown; body?: unknown }
    if (typeof v.title === "string" && v.title.trim()) return { title: v.title.trim().slice(0, 200), body: typeof v.body === "string" ? v.body.trim() : "" }
  } catch {}
  const [title = "", ...rest] = text.trim().split("\n")
  return { title: title.replace(/^#+\s*/, "").slice(0, 200), body: rest.join("\n").trim() }
}

export const cleanMessage = (text: string) => text.trim().replace(/^```\w*\n?|\n?```$/g, "").trim()

// ---------- worktrees: a chat on its own branch, in its own folder ----------

// A worktree of the repository at `repo`: on that branch when it exists (a chat coming back to its branch),
// else on a new branch from the current HEAD.
export async function addWorktree(repo: string, dir: string, branch: string) {
  await git(repo, ["check-ref-format", "--branch", branch])
  const exists = (await git(repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], true)).trim()
  await git(repo, ["worktree", "add", ...(exists ? [dir, branch] : ["-b", branch, dir])])
}

// Removes the worktree when nothing in it is uncommitted (the branch and its commits stay). Returns false and
// leaves it when it has changes, so no work is lost.
export async function removeWorktree(repo: string, dir: string, force = false): Promise<boolean> {
  if (!force && (await git(dir, ["status", "--porcelain"], true)).trim()) return false
  await git(repo, ["worktree", "remove", ...(force ? ["--force"] : []), dir], true)
  await git(repo, ["worktree", "prune"], true)
  return true
}

// A branch name from a chat title: "Add min() to sum.ts" → "zorel/add-min-to-sum-ts".
export const branchFor = (title: string, id: string) =>
  `zorel/${
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/\p{M}/gu, "") // accents off: "ação" → "acao"
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "chat"
  }-${id.slice(0, 4)}`
