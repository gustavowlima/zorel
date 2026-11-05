// Git of the chat's folder: the branch button in the chat header (opens the side panel's Git tab) and that tab —
// what changed and the latest commits, and the steps that ship it: commit
// (message written or drafted by the chat's model), push, open a pull request (or see the one already open), or
// move the work to a new branch, or give the chat its own worktree (a folder on its own branch, so its agents
// don't touch the project folder). Shown only when the folder is a git repository. Errors are git's own words.
import type { Chat } from "@zorel/contracts"
import { formatAge, formatTime, t } from "@zorel/i18n"
import { AsyncResult } from "effect/reactivity"
import { useAtomValue } from "@effect/atom-react"
import { type ReactNode, useEffect, useState } from "react"
import { gitAtom, mutations, useInvalidate, useMutation } from "../client.ts"
import { ArrowUp, ArrowUpRight, Badge, BareTextarea, Button, Check, CircleCheck, cx, FileIcon, FolderOpen, GitBranch, GitPullRequest, IconTile, Input, Sparkles, Spinner, StatusMark, Textarea } from "@/ui"

const errorOf = (e: unknown) => (e as { message?: string })?.message || t("git.failed")

export function GitControl({ chat, open, onOpen }: { chat: Chat; open: boolean; onOpen: () => void }) {
  const result = useAtomValue(gitAtom(chat.id))
  if (!AsyncResult.isSuccess(result) || !result.value.repo) return null
  const s = result.value
  return (
    <Button
      size="sm"
      variant={open ? "secondary" : "ghost"}
      aria-pressed={open}
      shape="pill" className="max-w-56"
      aria-label={t("git.button", { branch: s.branch ?? t("git.detached"), count: s.files.length })}
      onPress={onOpen}
    >
      {chat.worktree ? <FolderOpen /> : <GitBranch />}
      <span className="truncate">{s.branch ?? t("git.detached")}</span>
      {s.files.length > 0 && <span className="font-mono text-sm text-warning tabular-nums">{s.files.length}</span>}
      {s.ahead > 0 && <span className="font-mono text-sm text-accent-text tabular-nums">{`↑${s.ahead}`}</span>}
    </Button>
  )
}

// Whether the chat's folder is a git repository (the side panel shows its Git tab only then).
export function useIsRepo(chatId: string) {
  const result = useAtomValue(gitAtom(chatId))
  return AsyncResult.isSuccess(result) && result.value.repo
}

type Step = "commit" | "push" | "pr" | "branch" | "draft" | "worktree"

export function GitPanel({ chatId, worktree }: { chatId: string; worktree: string | null }) {
  const result = useAtomValue(gitAtom(chatId))
  const invalidate = useInvalidate()
  // Fresh each time the tab is shown (a shell or an agent may have committed meanwhile).
  useEffect(() => invalidate(["git"]), [invalidate])
  const draft = useMutation(mutations.gitDraft)
  const commit = useMutation(mutations.gitCommit)
  const push = useMutation(mutations.gitPush)
  const pr = useMutation(mutations.gitPr)
  const branch = useMutation(mutations.gitBranch)
  const enterWorktree = useMutation(mutations.enterWorktree)
  const leaveWorktree = useMutation(mutations.leaveWorktree)
  const [message, setMessage] = useState("")
  const [prForm, setPrForm] = useState<{ title: string; body: string }>()
  const [newBranch, setNewBranch] = useState<{ name: string; worktree: boolean }>()
  const [busy, setBusy] = useState<Step>()
  const [error, setError] = useState<string>()
  const [done, setDone] = useState<string>()
  if (!AsyncResult.isSuccess(result)) return <p className="p-4 text-sm text-muted">{t("common.checking")}</p>
  const s = result.value

  const act = (step: Step, f: () => Promise<unknown>, ok?: string) => {
    setBusy(step)
    setError(undefined)
    setDone(undefined)
    f()
      .then(() => ok && setDone(ok))
      .catch((e: unknown) => setError(errorOf(e)))
      .finally(() => setBusy(undefined))
  }
  const keys = { reactivityKeys: ["git", "workspace"] as const }
  const canPush = s.remote && !!s.branch && (s.ahead > 0 || !s.upstream)
  const canPr = s.gh && s.remote && !!s.branch && s.branch !== s.base

  const sync = [s.ahead > 0 && { tone: "accent" as const, text: `↑${s.ahead}`, label: t("git.ahead", { count: s.ahead }) }, s.behind > 0 && { tone: "warning" as const, text: `↓${s.behind}`, label: t("git.behind", { count: s.behind }) }].filter(
    (x) => !!x
  )

  return (
    <div className="flex flex-col">
      {/* The branch, where it syncs to and where its pull request goes. */}
      <header className="flex items-center gap-3 px-4 py-3">
        <IconTile className="text-muted">{worktree ? <FolderOpen /> : <GitBranch />}</IconTile>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-mono text-sm font-medium text-fg" title={s.branch ?? undefined}>
            {s.branch ?? t("git.detached")}
          </span>
          <span className="truncate text-sm text-muted">
            {[s.upstream ?? (s.remote ? t("git.unpublished") : t("git.noRemote")), s.base && s.branch !== s.base && t("git.into", { base: s.base })].filter(Boolean).join(" · ")}
          </span>
        </span>
        {sync.map((x) => (
          <span key={x.text} role="img" aria-label={x.label} title={x.label}>
            <Badge tone={x.tone}>{x.text}</Badge>
          </span>
        ))}
      </header>

      <Part title={t("git.changes")} count={s.files.length || undefined}>
        {s.files.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted">
            <CircleCheck className="size-4 text-success" />
            {t("git.clean")}
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-1 rounded-card border border-subtle bg-surface pt-2 transition-colors duration-120 focus-within:border-strong motion-reduce:transition-none">
              <BareTextarea aria-label={t("git.message")} placeholder={t("git.messageHint")} rows={3} value={message} onChange={(e) => setMessage(e.target.value)} className="px-3 font-mono text-sm" />
              <div className="flex items-center gap-2 p-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  isDisabled={!!busy}
                  onPress={() => act("draft", () => draft({ params: { id: chatId }, payload: { kind: "commit" } }).then((d) => setMessage(d.body ? `${d.title}\n\n${d.body}` : d.title)))}
                >
                  {busy === "draft" ? <Spinner size={12} /> : <Sparkles />}
                  {busy === "draft" ? t("git.writing") : t("git.write")}
                </Button>
                <span className="flex-1" />
                <Button
                  size="sm"
                  variant="default"
                  isDisabled={!message.trim() || !!busy}
                  onPress={() => act("commit", () => commit({ params: { id: chatId }, payload: { message: message.trim() }, ...keys }).then(() => setMessage("")), t("git.committed"))}
                >
                  {busy === "commit" ? <Spinner size={12} /> : <Check />}
                  {t("git.commit", { count: s.files.length })}
                </Button>
              </div>
            </div>
            <ul className="-mx-2 flex max-h-72 flex-col overflow-y-auto">
              {s.files.map((f) => {
                const cut = f.path.lastIndexOf("/")
                return (
                  <li key={f.path} className="flex h-control-sm items-center gap-2 rounded-control px-2 text-sm hover:bg-hover" title={f.path}>
                    <FileIcon name={f.path.slice(cut + 1)} />
                    <span className={cx("shrink-0 truncate", f.status === "deleted" ? "text-muted line-through" : "text-fg")}>{f.path.slice(cut + 1)}</span>
                    <span className="min-w-0 flex-1 truncate text-dim">{cut > 0 ? f.path.slice(0, cut) : ""}</span>
                    <StatusMark status={f.status} />
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </Part>

      {(canPush || s.pr || canPr) && (
        <Part title={t("git.ship")}>
          {s.pr && (
            <a
              href={s.pr.url}
              target="_blank"
              rel="noopener"
              className="group flex items-center gap-2.5 rounded-card border border-subtle px-3 py-2.5 text-sm transition-colors duration-120 hover:border-strong hover:bg-hover motion-reduce:transition-none"
            >
              <GitPullRequest className={cx("size-4 shrink-0", s.pr.state === "open" ? "text-success" : s.pr.state === "merged" ? "text-accent-text" : "text-muted")} />
              <span className="min-w-0 flex-1 truncate text-fg">{s.pr.title}</span>
              <span className="shrink-0 font-mono text-muted">{`#${s.pr.number}`}</span>
              <Badge tone={s.pr.state === "open" ? "success" : s.pr.state === "merged" ? "accent" : "neutral"}>{s.pr.state}</Badge>
              <ArrowUpRight className="size-3.5 shrink-0 text-muted group-hover:text-fg" />
            </a>
          )}
          {(canPush || (canPr && !s.pr && !prForm)) && (
            <div className="flex flex-wrap items-center gap-2">
              {canPush && (
                <Button size="sm" variant="secondary" isDisabled={!!busy} onPress={() => act("push", () => push({ params: { id: chatId }, ...keys }), t("git.pushed"))}>
                  {busy === "push" ? <Spinner size={12} /> : <ArrowUp />}
                  {s.upstream ? t("git.push", { count: s.ahead }) : t("git.publish")}
                </Button>
              )}
              {canPr && !s.pr && !prForm && (
                <Button size="sm" variant="ghost" isDisabled={!!busy} onPress={() => act("draft", () => draft({ params: { id: chatId }, payload: { kind: "pr" } }).then(setPrForm))}>
                  {busy === "draft" ? <Spinner size={12} /> : <GitPullRequest />}
                  {busy === "draft" ? t("git.writing") : t("git.createPr")}
                </Button>
              )}
            </div>
          )}
          {prForm && !s.pr && (
            <div className="flex flex-col gap-2">
              <Input aria-label={t("git.prTitle")} value={prForm.title} onChange={(e) => setPrForm({ ...prForm, title: e.target.value })} />
              <Textarea aria-label={t("git.prBody")} rows={6} value={prForm.body} onChange={(e) => setPrForm({ ...prForm, body: e.target.value })} className="text-sm" />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onPress={() => setPrForm(undefined)}>
                  {t("common.cancel")}
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  isDisabled={!prForm.title.trim() || !!busy}
                  onPress={() => act("pr", () => pr({ params: { id: chatId }, payload: { title: prForm.title.trim(), body: prForm.body }, ...keys }).then(() => setPrForm(undefined)), t("git.prCreated"))}
                >
                  {busy === "pr" && <Spinner size={12} />}
                  {t("git.openPr")}
                </Button>
              </div>
            </div>
          )}
        </Part>
      )}

      {s.commits.length > 0 && (
        <Part title={t("git.commits")}>
          {/* A timeline: commits not pushed yet are the accent dots at the top. */}
          <ol className="relative flex flex-col">
            <span aria-hidden="true" className="absolute inset-y-2 left-1 w-px bg-subtle" />
            {s.commits.map((c) => (
              <li key={c.sha} className="relative flex items-center gap-3 py-1.5 text-sm">
                <span
                  role="img"
                  aria-label={c.pushed ? t("git.pushedCommit") : t("git.notPushed")}
                  className={cx("relative size-2 shrink-0 rounded-full ring-4 ring-canvas", c.pushed ? "border border-strong bg-canvas" : "bg-accent")}
                />
                <span className="min-w-0 flex-1 truncate text-secondary" title={c.subject}>
                  {c.subject}
                </span>
                <span className="shrink-0 font-mono text-xs text-dim">{c.sha}</span>
                <span className="w-12 shrink-0 text-right text-xs text-dim tabular-nums" title={formatTime(c.at)}>
                  {formatAge(c.at)}
                </span>
              </li>
            ))}
          </ol>
        </Part>
      )}

      <Part>
        {worktree && (
          <div className="flex items-center gap-2 rounded-card border border-subtle px-3 py-2">
            <FolderOpen className="size-4 shrink-0 text-muted" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm text-fg">{t("git.inWorktree")}</span>
              <span className="truncate font-mono text-xs text-muted" title={worktree}>
                {worktree}
              </span>
            </span>
            <Button size="sm" variant="ghost" isDisabled={!!busy} onPress={() => act("worktree", () => leaveWorktree({ params: { id: chatId }, reactivityKeys: ["git", "chats", "workspace"] }), t("git.leftWorktree"))}>
              {busy === "worktree" && <Spinner size={12} />}
              {t("git.leaveWorktree")}
            </Button>
          </div>
        )}
        {newBranch === undefined ? (
          <div className="-mx-2.5 flex flex-wrap items-center gap-1">
            <Button size="sm" variant="ghost" onPress={() => setNewBranch({ name: "", worktree: false })}>
              <GitBranch />
              {t("git.newBranch")}
            </Button>
            {!worktree && (
              <Button size="sm" variant="ghost" onPress={() => setNewBranch({ name: "", worktree: true })}>
                <FolderOpen />
                {t("git.newWorktree")}
              </Button>
            )}
          </div>
        ) : (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const name = newBranch.name.trim()
              if (newBranch.worktree)
                act(
                  "worktree",
                  () => enterWorktree({ params: { id: chatId }, payload: name ? { branch: name } : {}, reactivityKeys: ["git", "chats", "workspace", "terminals"] }).then(() => setNewBranch(undefined)),
                  t("git.inWorktreeNow")
                )
              else if (name) act("branch", () => branch({ params: { id: chatId }, payload: { name }, ...keys }).then(() => setNewBranch(undefined)))
            }}
          >
            {newBranch.worktree && <p className="text-sm text-muted">{t("git.worktreeHint")}</p>}
            <Input
              autoFocus
              aria-label={t("git.branchName")}
              placeholder={newBranch.worktree ? t("git.branchAuto") : t("git.branchHint")}
              value={newBranch.name}
              onChange={(e) => setNewBranch({ ...newBranch, name: e.target.value })}
              className="h-control-sm font-mono text-sm"
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onPress={() => setNewBranch(undefined)}>
                {t("common.cancel")}
              </Button>
              <Button size="sm" variant="default" type="submit" isDisabled={(!newBranch.worktree && !newBranch.name.trim()) || !!busy}>
                {(busy === "branch" || busy === "worktree") && <Spinner size={12} />}
                {newBranch.worktree ? t("git.createWorktree") : t("git.switch")}
              </Button>
            </div>
          </form>
        )}
      </Part>

      {(error || done) && (
        <p role="status" className={cx("mx-4 mb-4 rounded-control px-3 py-2 text-sm", error ? "max-h-32 overflow-auto bg-danger-soft font-mono whitespace-pre-wrap text-danger" : "bg-success-faint text-success")}>
          {error ?? done}
        </p>
      )}
    </div>
  )
}

// A part of the panel: a hairline above, its title (and a count) over what it holds.
function Part({ title, count, children }: { title?: string; count?: number | undefined; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2.5 border-t border-subtle px-4 py-3">
      {title && (
        <h3 className="flex items-center gap-2 text-sm font-medium text-fg">
          {title}
          {count !== undefined && <span className="rounded-full bg-control px-1.5 text-xs text-muted tabular-nums">{count}</span>}
        </h3>
      )}
      {children}
    </section>
  )
}
