// Git in the chat header: the branch of the chat's folder and what changed, and the steps that ship it — commit
// (message written or drafted by the chat's model), push, open a pull request (or see the one already open), or
// move the work to a new branch, or give the chat its own worktree (a folder on its own branch, so its agents
// don't touch the project folder). Shown only when the folder is a git repository. Errors are git's own words.
import type { Chat } from "@zero/contracts"
import { t } from "@zero/i18n"
import { AsyncResult } from "effect/reactivity"
import { useAtomValue } from "@effect/atom-react"
import { useState } from "react"
import { gitAtom, mutations, useInvalidate, useMutation } from "../client.ts"
import { ArrowUpRight, Button, FolderOpen, GitBranch, GitPullRequest, Input, Popover, Sparkles, Spinner, Textarea } from "@/ui"

const errorOf = (e: unknown) => (e as { message?: string })?.message || t("git.failed")

export function GitControl({ chat }: { chat: Chat }) {
  const chatId = chat.id
  const result = useAtomValue(gitAtom(chatId))
  const invalidate = useInvalidate()
  if (!AsyncResult.isSuccess(result) || !result.value.repo) return null
  const s = result.value
  return (
    <Popover
      label={t("git.title")}
      placement="bottom end"
      onOpenChange={(open) => open && invalidate(["git"])}
      trigger={
        <Button size="sm" variant="ghost" className="max-w-56 rounded-full" aria-label={t("git.button", { branch: s.branch ?? t("git.detached"), count: s.files.length })}>
          {chat.worktree ? <FolderOpen /> : <GitBranch />}
          <span className="truncate">{s.branch ?? t("git.detached")}</span>
          {s.files.length > 0 && <span className="font-mono text-sm text-warning tabular-nums">{s.files.length}</span>}
          {s.ahead > 0 && <span className="font-mono text-sm text-accent-text tabular-nums">{`↑${s.ahead}`}</span>}
        </Button>
      }
    >
      <GitPanel chatId={chatId} worktree={chat.worktree} />
    </Popover>
  )
}

type Step = "commit" | "push" | "pr" | "branch" | "draft" | "worktree"

function GitPanel({ chatId, worktree }: { chatId: string; worktree: string | null }) {
  const result = useAtomValue(gitAtom(chatId))
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
  if (!AsyncResult.isSuccess(result)) return <p className="w-96 p-4 text-sm text-muted">{t("common.checking")}</p>
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

  return (
    <div className="flex w-104 flex-col gap-4 p-4">
      <div className="flex flex-col gap-0.5">
        <p className="flex items-center gap-2 font-medium">
          <GitBranch className="size-4 text-muted" />
          <span className="truncate">{s.branch ?? t("git.detached")}</span>
        </p>
        <p className="text-sm text-muted">
          {[
            s.files.length ? t("git.changed", { count: s.files.length }) : t("git.clean"),
            s.ahead > 0 && t("git.ahead", { count: s.ahead }),
            s.behind > 0 && t("git.behind", { count: s.behind }),
            !s.remote && t("git.noRemote")
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      {s.files.length > 0 && (
        <div className="flex flex-col gap-2">
          <Textarea aria-label={t("git.message")} placeholder={t("git.messageHint")} rows={4} value={message} onChange={(e) => setMessage(e.target.value)} className="font-mono text-sm" />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              isDisabled={!!busy}
              onPress={() =>
                act("draft", () => draft({ params: { id: chatId }, payload: { kind: "commit" } }).then((d) => setMessage(d.body ? `${d.title}\n\n${d.body}` : d.title)))
              }
            >
              {busy === "draft" ? <Spinner size={12} /> : <Sparkles />}
              {busy === "draft" ? t("git.writing") : t("git.write")}
            </Button>
            <span className="flex-1" />
            <Button
              size="sm"
              isDisabled={!message.trim() || !!busy}
              onPress={() =>
                act("commit", () => commit({ params: { id: chatId }, payload: { message: message.trim() }, ...keys }).then(() => setMessage("")), t("git.committed"))
              }
            >
              {busy === "commit" && <Spinner size={12} />}
              {t("git.commit", { count: s.files.length })}
            </Button>
          </div>
        </div>
      )}

      {(canPush || s.pr || canPr) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-subtle pt-3">
          {canPush && (
            <Button size="sm" variant="secondary" isDisabled={!!busy} onPress={() => act("push", () => push({ params: { id: chatId }, ...keys }), t("git.pushed"))}>
              {busy === "push" && <Spinner size={12} />}
              {s.upstream ? t("git.push", { count: s.ahead }) : t("git.publish")}
            </Button>
          )}
          {s.pr ? (
            <a href={s.pr.url} target="_blank" rel="noopener" className="flex min-w-0 items-center gap-1.5 text-sm text-accent-text hover:underline">
              <GitPullRequest className="size-3.5 shrink-0" />
              <span className="truncate">{`#${s.pr.number} ${s.pr.title}`}</span>
              <ArrowUpRight className="size-3 shrink-0" />
            </a>
          ) : (
            canPr &&
            !prForm && (
              <Button
                size="sm"
                variant="ghost"
                isDisabled={!!busy}
                onPress={() => act("draft", () => draft({ params: { id: chatId }, payload: { kind: "pr" } }).then(setPrForm))}
              >
                {busy === "draft" ? <Spinner size={12} /> : <GitPullRequest />}
                {busy === "draft" ? t("git.writing") : t("git.createPr")}
              </Button>
            )
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
              isDisabled={!prForm.title.trim() || !!busy}
              onPress={() =>
                act("pr", () => pr({ params: { id: chatId }, payload: { title: prForm.title.trim(), body: prForm.body }, ...keys }).then(() => setPrForm(undefined)), t("git.prCreated"))
              }
            >
              {busy === "pr" && <Spinner size={12} />}
              {t("git.openPr")}
            </Button>
          </div>
        </div>
      )}

      {worktree && (
        <div className="flex items-center gap-2 border-t border-subtle pt-3">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-sm">{t("git.inWorktree")}</span>
            <span className="truncate font-mono text-sm text-muted" title={worktree}>
              {worktree}
            </span>
          </span>
          <Button size="sm" variant="ghost" isDisabled={!!busy} onPress={() => act("worktree", () => leaveWorktree({ params: { id: chatId }, reactivityKeys: ["git", "chats", "workspace"] }), t("git.leftWorktree"))}>
            {busy === "worktree" && <Spinner size={12} />}
            {t("git.leaveWorktree")}
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-subtle pt-3">
        {newBranch === undefined ? (
          <>
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
          </>
        ) : (
          <form
            className="flex flex-1 flex-col gap-2"
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
            <div className="flex items-center gap-2">
              {/* biome-ignore lint/a11y/noAutofocus: the field the person just asked for */}
              <Input
                autoFocus
                aria-label={t("git.branchName")}
                placeholder={newBranch.worktree ? t("git.branchAuto") : t("git.branchHint")}
                value={newBranch.name}
                onChange={(e) => setNewBranch({ ...newBranch, name: e.target.value })}
                className="h-control-sm flex-1 font-mono text-sm"
              />
              <Button size="sm" variant="ghost" onPress={() => setNewBranch(undefined)}>
                {t("common.cancel")}
              </Button>
              <Button size="sm" type="submit" isDisabled={(!newBranch.worktree && !newBranch.name.trim()) || !!busy}>
                {(busy === "branch" || busy === "worktree") && <Spinner size={12} />}
                {newBranch.worktree ? t("git.createWorktree") : t("git.switch")}
              </Button>
            </div>
          </form>
        )}
      </div>

      {error && <p className="max-h-32 overflow-auto font-mono text-sm whitespace-pre-wrap text-danger">{error}</p>}
      {done && <p className="text-sm text-success">{done}</p>}
    </div>
  )
}
