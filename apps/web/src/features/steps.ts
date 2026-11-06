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

// A reply laid out as it happened: its text cut where steps began, each run of steps with no words between them one
// group, in order ("Let me look." · [3 steps] · "Found it." · [2 steps] · "Done."). Steps that don't know where they
// began (messages saved before `at`, a reload mid-turn) form one group: above the text when none knows, after it when
// some do.
export type Piece<S> = { kind: "text"; text: string } | { kind: "steps"; key: string; steps: ReadonlyArray<S> }
export function interleave<S>(text: string, steps: ReadonlyArray<S>, atOf: (s: S) => number | undefined): Piece<S>[] {
  if (!steps.length) return text ? [{ kind: "text", text }] : []
  const placed = steps.flatMap((s, i) => {
    const at = atOf(s)
    return at === undefined ? [] : [{ s, i, at: Math.max(0, Math.min(at, text.length)) }]
  })
  const loose = steps.filter((s) => atOf(s) === undefined)
  if (!placed.length) return [{ kind: "steps", key: "g0", steps: loose }, ...(text ? [{ kind: "text" as const, text }] : [])]
  placed.sort((a, b) => a.at - b.at || a.i - b.i)
  const out: Piece<S>[] = []
  let cursor = 0
  let group: S[] | undefined
  for (const p of placed) {
    const between = text.slice(cursor, p.at)
    if (group && !between.trim()) group.push(p.s)
    else {
      if (between.trim()) out.push({ kind: "text", text: between })
      group = [p.s]
      out.push({ kind: "steps", key: `g${out.length}`, steps: group })
    }
    cursor = p.at
  }
  const rest = text.slice(cursor)
  if (rest.trim()) out.push({ kind: "text", text: rest })
  if (loose.length) out.push({ kind: "steps", key: `g${out.length}`, steps: loose })
  return out
}
