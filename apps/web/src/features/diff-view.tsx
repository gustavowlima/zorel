// One file's unified diff: hunk headers, old/new line numbers, added and removed lines on the diff tokens.
// Hand-rolled on purpose (ARCHITECTURE §13, phase 3 note): @pierre/diffs rendered empty in this setup, and a
// plain renderer is light, follows the theme tokens and needs no highlighter.
import { cx } from "@/ui"

type Line = { kind: "hunk" | "add" | "del" | "ctx" | "note"; text: string; old: number | null; new: number | null }

export function parsePatch(patch: string): Line[] {
  const lines: Line[] = []
  let oldNo = 0
  let newNo = 0
  let inHunk = false
  for (const raw of patch.split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(raw)
    if (hunk) {
      oldNo = Number(hunk[1])
      newNo = Number(hunk[2])
      inHunk = true
      lines.push({ kind: "hunk", text: raw, old: null, new: null })
    } else if (!inHunk) continue // file header (diff --git, index, ---, +++)
    else if (raw.startsWith("+")) lines.push({ kind: "add", text: raw.slice(1), old: null, new: newNo++ })
    else if (raw.startsWith("-")) lines.push({ kind: "del", text: raw.slice(1), old: oldNo++, new: null })
    else if (raw.startsWith("\\")) lines.push({ kind: "note", text: raw, old: null, new: null }) // "\ No newline at end of file"
    else if (raw !== "" || lines.at(-1)?.kind !== "hunk") lines.push({ kind: "ctx", text: raw.slice(1), old: oldNo++, new: newNo++ })
  }
  // A trailing empty context line comes from the patch's final newline.
  if (lines.at(-1)?.kind === "ctx" && lines.at(-1)?.text === "") lines.pop()
  return lines
}

export default function DiffView({ patch }: { patch: string }) {
  const lines = parsePatch(patch)
  return (
    <div className="overflow-x-auto bg-code font-mono text-sm leading-relaxed">
      <table className="w-full border-collapse">
        <tbody>
          {lines.map((l, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a patch's lines are positional and never reorder
            <tr key={i} className={cx(l.kind === "add" && "bg-diff-add", l.kind === "del" && "bg-diff-del", l.kind === "hunk" && "bg-accent-faint")}>
              <td className="w-10 select-none px-2 text-right align-top text-dim tabular-nums">{l.old ?? ""}</td>
              <td className="w-10 select-none px-2 text-right align-top text-dim tabular-nums">{l.new ?? ""}</td>
              <td className={cx("w-4 select-none align-top", l.kind === "add" && "text-success", l.kind === "del" && "text-danger")}>{l.kind === "add" ? "+" : l.kind === "del" ? "−" : ""}</td>
              <td className={cx("whitespace-pre-wrap break-all pr-3", l.kind === "hunk" || l.kind === "note" ? "text-muted" : "text-secondary")}>{l.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
