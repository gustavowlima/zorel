// What changed between two short texts (a skill's steps), line by line: removed lines in red with "−", added in
// green with "+", the rest muted. LCS over lines: fine for recipes of a few dozen lines.
import { cn } from "@/lib/utils"

type DiffLine = { readonly kind: "same" | "add" | "del"; readonly text: string }

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n")
  const b = after.split("\n")
  // ponytail: O(n·m) table; skills are capped at 4000 chars, so a few hundred lines at most.
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push({ kind: "same", text: a[i]! })
      i++
      j++
    } else if (i < a.length && (j >= b.length || lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) out.push({ kind: "del", text: a[i++]! })
    else out.push({ kind: "add", text: b[j++]! }) // removed lines first, then what replaces them
  }
  return out
}

export function LineDiff({ before, after, className }: { before: string; after: string; className?: string }) {
  return (
    <pre className={cn("overflow-x-auto rounded-card border border-subtle bg-code py-2 font-mono text-sm", className)}>
      {diffLines(before, after).map((l, k) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: lines of one fixed diff, never reordered
          key={k}
          className={cn("px-3 whitespace-pre-wrap", l.kind === "add" ? "bg-success-faint text-success" : l.kind === "del" ? "bg-danger-soft/50 text-danger" : "text-muted")}
        >
          {`${l.kind === "add" ? "+ " : l.kind === "del" ? "− " : "  "}${l.text}`}
        </div>
      ))}
    </pre>
  )
}
