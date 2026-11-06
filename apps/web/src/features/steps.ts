// What a turn's steps add up to, for the one-line summary over its tree ("Read 2 files and ran 3 commands"): each kind
// counted in the order work tends to go, the files an edit touched counted once, and only the failures that still
// stand (a command that failed and later ran again and passed is history, not news). Apart from the component so
// it can be tested.

export type SummaryKind = "search" | "read" | "edit" | "run" | "tool" | "delegate"
export const SUMMARY_ORDER: ReadonlyArray<SummaryKind> = ["search", "read", "edit", "run", "tool", "delegate"]

// A step as both a saved one (`tool`, `args`) and a live one (`kind`, `files`) can describe it.
export type SummaryStep = { kind: string; status: string; title: string; detail: string; files: ReadonlyArray<string> }

// Native kinds keep their name; Zorel's timing rows (thought, reply) aren't work; anything else is a tool (MCP).
export const kindOf = (kind: string): SummaryKind | undefined =>
  kind === "thought" || kind === "reply" ? undefined : (SUMMARY_ORDER as ReadonlyArray<string>).includes(kind) ? (kind as SummaryKind) : "tool"

const keyOf = (s: SummaryStep) => `${s.kind}\u0000${s.detail || s.title}`

export function summarize(steps: ReadonlyArray<SummaryStep>) {
  const counts = new Map<SummaryKind, number>()
  const edited = new Set<string>()
  for (const s of steps) {
    const kind = kindOf(s.kind)
    if (!kind) continue
    if (kind === "edit" && s.files.length) for (const f of s.files) edited.add(f)
    else counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  if (edited.size) counts.set("edit", (counts.get("edit") ?? 0) + edited.size)
  // A failure stands unless the same step (kind and command or path) passed after it.
  const failed = steps.filter((s, i) => s.status === "error" && kindOf(s.kind) && !steps.slice(i + 1).some((later) => later.status === "ok" && keyOf(later) === keyOf(s))).length
  const refused = steps.filter((s) => s.status === "refused").length
  return { parts: SUMMARY_ORDER.flatMap((kind) => (counts.get(kind) ? [{ kind, count: counts.get(kind)! }] : [])), failed, refused }
}
