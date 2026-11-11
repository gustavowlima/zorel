// Agents of this chat working in a copy of their own (spec 016): a second agent that edited the same git project at
// the same time got a worktree on its own branch. One quiet row each, above the message box: whose copy and its
// branch, and the two ways out: merge it into the project (a conflict leaves the project as it was), or discard it.
import type { Agent, Chat } from "@zorel/contracts"
import { t } from "@zorel/i18n"
import { useState } from "react"
import { mutations, useMutation } from "../client.ts"
import { agentName } from "../labels.ts"
import { Button, ConfirmButton, GitBranch } from "@/ui"

export function AgentCopies({ chat, agents }: { chat: Chat; agents: ReadonlyArray<Agent> }) {
  const copies = Object.entries(chat.agentWorktrees)
  if (!copies.length) return null
  return (
    <section aria-label={t("copies.title")} className="mb-2 flex flex-col gap-2">
      {copies.map(([agentId, wt]) => (
        <Copy key={agentId} chatId={chat.id} agentId={agentId} name={agentName(agentId, agents)} branch={wt.branch} />
      ))}
    </section>
  )
}

function Copy({ chatId, agentId, name, branch }: { chatId: string; agentId: string; name: string; branch: string }) {
  const merge = useMutation(mutations.mergeAgentWorktree)
  const discard = useMutation(mutations.discardAgentWorktree)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const run = (f: () => Promise<unknown>) => {
    setBusy(true)
    setError(undefined)
    f()
      .catch((e: unknown) => setError((e as { message?: string })?.message || t("copies.failed")))
      .finally(() => setBusy(false))
  }
  const params = { id: chatId, agentId }
  return (
    <div className="flex flex-col gap-1.5 rounded-card bg-surface px-3.5 py-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <GitBranch className="size-4 shrink-0 text-muted" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm">{t("copies.line", { agent: name })}</span>
          <span className="truncate font-mono text-xs text-muted">{branch}</span>
        </span>
        <ConfirmButton
          size="sm"
          variant="ghost"
          shape="pill"
          isDisabled={busy}
          title={t("copies.discardTitle", { agent: name })}
          description={t("copies.discardBody")}
          confirmLabel={t("copies.discard")}
          onConfirm={() => run(() => discard({ params, reactivityKeys: ["chats", "workspace"] }))}
        >
          {t("copies.discard")}
        </ConfirmButton>
        <Button size="sm" variant="default" shape="pill" isPending={busy} isDisabled={busy} onPress={() => run(() => merge({ params, reactivityKeys: ["chats", "workspace"] }))}>
          {t("copies.merge")}
        </Button>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  )
}
