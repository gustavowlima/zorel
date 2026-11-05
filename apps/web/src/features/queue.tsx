// The message queue: what you send while a turn runs waits here, above the message box, and
// goes out by itself when the chat is free again, one at a time. While a turn runs, each item can be sent now (into
// the reply in progress when the engine takes it, else by stopping the reply), brought back to the box to edit, or dropped. Kept per chat on this computer, so a reload keeps it.
import { t } from "@zorel/i18n"
import { useEffect, useRef, useState } from "react"
import { Button, CornerDownRight, IconButton, Pencil, Tooltip, Trash2 } from "@/ui"

export interface Queued {
  readonly id: string
  readonly text: string
  readonly attachmentIds: ReadonlyArray<string>
}

const keyOf = (chatId: string) => `zorel.queue.${chatId}`
const load = (chatId: string): Queued[] => {
  try {
    return JSON.parse(localStorage.getItem(keyOf(chatId)) ?? "[]") as Queued[]
  } catch {
    return [] // storage blocked or broken: an empty queue
  }
}
const save = (chatId: string, items: ReadonlyArray<Queued>) => {
  try {
    if (items.length) localStorage.setItem(keyOf(chatId), JSON.stringify(items))
    else localStorage.removeItem(keyOf(chatId))
  } catch {
    // storage blocked: the queue lives until the tab closes
  }
}

// `busy`: a turn is queued or running on the server. `send` starts a turn now.
export function useQueue(chatId: string, busy: boolean, ready: boolean, send: (text: string, attachmentIds: ReadonlyArray<string>) => Promise<unknown>) {
  const [items, setItems] = useState<ReadonlyArray<Queued>>(() => load(chatId))
  // After a send, wait until the server shows that turn as busy before sending the next one.
  const waiting = useRef(false)
  useEffect(() => save(chatId, items), [chatId, items])
  useEffect(() => {
    if (busy) waiting.current = false
    if (busy || !ready || waiting.current || !items.length) return
    const [next, ...rest] = items
    if (!next) return
    waiting.current = true
    setItems(rest)
    send(next.text, next.attachmentIds).catch(() => {
      waiting.current = false
      setItems((x) => [next, ...x]) // it comes back to the front of the queue
    })
    // If the turn ends before the next render sees it busy, let the queue move on anyway.
    const timer = setTimeout(() => {
      waiting.current = false
    }, 3000)
    return () => clearTimeout(timer)
  }, [busy, ready, items, send])
  return {
    items,
    add: (text: string, attachmentIds: ReadonlyArray<string>) => setItems((x) => [...x, { id: crypto.randomUUID(), text, attachmentIds }]),
    remove: (id: string) => setItems((x) => x.filter((i) => i.id !== id))
  }
}

export function QueuePanel({
  items,
  busy,
  joinsTurn,
  onSendNow,
  onEdit,
  onRemove
}: {
  items: ReadonlyArray<Queued>
  busy: boolean // a turn runs: items can be sent now (an idle chat drains the queue by itself)
  joinsTurn: (item: Queued) => boolean // sending it adds it to the running reply (else it stops the reply first)
  onSendNow: (item: Queued) => void
  onEdit: (item: Queued) => void
  onRemove: (item: Queued) => void
}) {
  if (!items.length) return null
  return (
    <ol aria-label={t("queue.label")} className="mx-3 flex flex-col divide-y divide-subtle rounded-t-card border border-b-0 border-subtle bg-surface px-3">
      {items.map((item) => (
        <li key={item.id} className="flex min-h-control items-center gap-2 py-1">
          <CornerDownRight className="size-4 shrink-0 text-muted" />
          <span className="min-w-0 flex-1 truncate text-secondary" title={item.text}>
            {item.text}
          </span>
          {busy && (
            <Tooltip content={joinsTurn(item) ? t("queue.sendNowJoin") : t("queue.sendNowStop")}>
              <Button size="sm" variant="ghost" className="text-muted" onPress={() => onSendNow(item)}>
                <CornerDownRight />
                {t("queue.sendNow")}
              </Button>
            </Tooltip>
          )}
          <IconButton label={t("queue.edit")} size="xs" onPress={() => onEdit(item)}>
            <Pencil className="size-3.5" />
          </IconButton>
          <IconButton label={t("queue.remove")} size="xs" onPress={() => onRemove(item)}>
            <Trash2 className="size-3.5" />
          </IconButton>
        </li>
      ))}
    </ol>
  )
}
