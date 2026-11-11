// A teammate's answer to a task, as it comes back to the asking chat (runtime reportTask): the shape the task asked
// for — "Status: done | partial | blocked. Result: … Evidence: …" — then the link to the task. Read here so the chat
// can show it as a card; anything that doesn't keep the shape stays plain text.
export type TaskStatus = "done" | "partial" | "blocked"
export type TaskReport = { readonly status: TaskStatus; readonly result: string; readonly evidence: string; readonly taskId: string }

const LINK = /\n*\s*\[[^\]]*\]\(#\/chat\/([\w-]+)\)\s*$/
// A label may come bold either way ("**Status:**" or "**Status**:").
const SHAPE = /^\s*\**status\**\s*:\**\s*(done|partial|blocked)\**[\s.;,]*\**result\**\s*:\**\s*([\s\S]*?)(?:[\s.;,]*\**evidence\**\s*:\**\s*([\s\S]*))?$/i

export function parseTaskReport(text: string): TaskReport | undefined {
  const link = LINK.exec(text)
  if (!link) return undefined
  const m = SHAPE.exec(text.slice(0, link.index))
  if (!m) return undefined
  return { status: m[1]!.toLowerCase() as TaskStatus, result: m[2]!.trim(), evidence: (m[3] ?? "").trim(), taskId: link[1]! }
}

// The link to a task a chat carries (#/chat/<id>): its id, else undefined.
export const taskIdOf = (href: string | undefined) => (href?.startsWith("#/chat/") ? href.slice(7) : undefined)
