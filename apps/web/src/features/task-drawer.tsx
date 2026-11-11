// Tasks a teammate was given from a chat, opened beside it: which of this chat's tasks a link points at (the "Open
// the task" a teammate's report carries), and the drawer that shows one. The panel itself loads apart (it renders
// chat.tsx's Timeline).
import type { Chat } from "@zorel/contracts"
import { lazy, type MouseEvent, Suspense } from "react"
import { chatsAtom, useList } from "../client.ts"
import { taskIdOf } from "./task-report.ts"
import { Drawer } from "@/ui"

const TaskPanel = lazy(() => import("./task-panel.tsx"))

// A click on a link to one of this chat's tasks opens it (onOpen) instead of leaving the chat; other links go on.
export function useTaskLinks(chat: Chat, onOpen: (taskId: string) => void) {
  const chats = useList(chatsAtom)
  return (e: MouseEvent) => {
    const id = taskIdOf((e.target as HTMLElement).closest("a")?.getAttribute("href") ?? undefined)
    if (!id || !chats.some((c) => c.id === id && c.parentId === chat.id)) return
    e.preventDefault()
    onOpen(id)
  }
}

export function TaskDrawer({ chat, taskId, onClose }: { chat: Chat; taskId: string | undefined; onClose: () => void }) {
  const task = useList(chatsAtom).find((c) => c.id === taskId && c.parentId === chat.id)
  return (
    <Drawer open={!!task}>
      {task && (
        <Suspense fallback={null}>
          <TaskPanel chat={task} onClose={onClose} />
        </Suspense>
      )}
    </Drawer>
  )
}
