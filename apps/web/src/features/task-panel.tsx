// A task a teammate was given from this chat, opened beside it (the chat's drawer) instead of as a page of its own:
// its conversation as it goes, what it waits on you for (approvals), and a way to open it full screen. Loaded with
// the first task opened (it renders the chat's own Timeline).
import type { Chat } from "@zorel/contracts"
import { t } from "@zorel/i18n"
import { agentsAtom, mutations, useChat, useList, useMutation } from "../client.ts"
import { go } from "../state.ts"
import { PendingTray, Timeline } from "./chat.tsx"
import { AuthorAvatar } from "./people.tsx"
import { Button, IconButton, X } from "@/ui"

export default function TaskPanel({ chat, onClose }: { chat: Chat; onClose: () => void }) {
  const state = useChat(chat.id)
  const agents = useList(agentsAtom)
  const interrupt = useMutation(mutations.interrupt)
  const doer = agents.find((a) => a.id === chat.agentIds[0])
  return (
    <aside aria-label={t("task.panel", { title: chat.title })} className="flex w-120 min-w-0 shrink-0 flex-col border-l border-subtle">
      <div className="flex items-center gap-2 border-b border-subtle px-3 py-2">
        <AuthorAvatar agent={doer} model={null} size={20} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{chat.title}</span>
        <Button size="sm" variant="ghost" onPress={() => go({ view: "chat", id: chat.id })}>
          {t("task.openFull")}
        </Button>
        <IconButton label={t("task.close")} size="xs" onPress={onClose}>
          <X className="size-3.5" />
        </IconButton>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <Timeline chat={chat} state={state} agents={agents} onView={() => {}} onEdit={() => {}} onStop={() => void interrupt({ payload: { chatId: chat.id } })} />
      </div>
      {state.approvals.length > 0 && (
        <div className="border-t border-subtle p-3">
          <PendingTray approvals={state.approvals} />
        </div>
      )}
    </aside>
  )
}
