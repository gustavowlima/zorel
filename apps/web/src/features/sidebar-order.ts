// The sidebar's list rules, apart from the component so they can be tested: which chat comes first (whose turn it
// is, then manual order and recency) and how many of a group's chats show before "Show more".
import type { Chat } from "@zorel/contracts"
import type { ChatStatus } from "@zorel/contracts/events"

export type Statuses = Readonly<Record<string, ChatStatus>>

export const lastActivity = (c: Chat, statuses: Statuses) => Math.max(c.createdAt, c.lastAt ?? 0, statuses[c.id]?.updatedAt ?? 0)

// A group's chats: the ones never placed by hand first (newest activity on top), then the placed ones in
// their manual order.
export const ordered = (chats: ReadonlyArray<Chat>, statuses: Statuses) => [
  ...chats.filter((c) => c.position === null).sort((a, b) => lastActivity(b, statuses) - lastActivity(a, statuses)),
  ...chats.filter((c) => c.position !== null).sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
]

// Whose turn it is comes first: waiting for you, then working, then the rest (each keeps the order above).
export const rank = (s: ChatStatus | undefined) => (s?.state === "waiting" ? 0 : s?.state === "running" ? 1 : 2)
export const byTurn = (chats: ReadonlyArray<Chat>, statuses: Statuses) => [...chats].sort((a, b) => rank(statuses[a.id]) - rank(statuses[b.id]))

// What a group shows: every chat when open, else the first `limit` plus the open chat (it always stays visible, even
// past the fold). `hidden` is how many "Show more" would reveal.
export function visibleChats(list: ReadonlyArray<Chat>, activeId: string | undefined, limit: number, showAll: boolean) {
  const visible = showAll ? list : list.filter((c, i) => i < limit || c.id === activeId)
  return { visible, hidden: list.length - visible.length }
}
