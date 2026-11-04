// One file's diff, rendered by @pierre/diffs (syntax highlight, line numbers, word-level changes) inside
// the shared worker pool. The surface takes Zorel's tokens: CSS variables cross the viewer's shadow DOM.
// With onComment, selecting lines (click or drag on the line numbers) opens a comment box under them; what is
// written goes to the chat's message box, naming the file and the lines, for the agent to act on.
import { getSingularPatch, type SelectedLineRange } from "@pierre/diffs"
import { type DiffLineAnnotation, FileDiff } from "@pierre/diffs/react"
import { t } from "@zorel/i18n"
import { useMemo, useState } from "react"
import { Button, Textarea } from "@/ui"
import { useResolvedTheme } from "../state.ts"
import { DIFF_THEMES, DiffWorkerPool } from "./diff-pool.tsx"

const SURFACE_CSS = `
[data-diffs-header], [data-diff], [data-file], [data-error-wrapper], [data-virtualizer-buffer] {
  --diffs-font-family: var(--font-mono) !important;
  --diffs-header-font-family: var(--font-sans) !important;
  --diffs-bg: var(--z-bg-code) !important;
  --diffs-light-bg: var(--z-bg-code) !important;
  --diffs-dark-bg: var(--z-bg-code) !important;
  --diffs-token-light-bg: transparent;
  --diffs-token-dark-bg: transparent;
  --diffs-bg-context-override: color-mix(in srgb, var(--z-bg-code) 97%, var(--z-text));
  --diffs-bg-separator-override: var(--z-accent-faint);
  --diffs-bg-buffer-override: color-mix(in srgb, var(--z-bg-code) 92%, var(--z-text));
}
`

export type LineComment = { readonly path: string; readonly start: number; readonly end: number; readonly side: "additions" | "deletions"; readonly text: string }

export default function DiffView({ patch, path, onComment }: { patch: string; path?: string; onComment?: (c: LineComment) => void }) {
  const theme = useResolvedTheme()
  const fileDiff = useMemo(() => getSingularPatch(patch), [patch])
  const [range, setRange] = useState<SelectedLineRange | null>(null)
  // Stable options: the viewer re-renders when their identity changes.
  const options = useMemo(
    () => ({
      diffStyle: "unified" as const,
      overflow: "wrap" as const,
      disableFileHeader: true,
      theme: DIFF_THEMES,
      themeType: theme,
      unsafeCSS: SURFACE_CSS,
      ...(onComment && { enableLineSelection: true, onLineSelectionEnd: (r: SelectedLineRange | null) => setRange(r) })
    }),
    [theme, onComment]
  )
  const side = range?.endSide ?? range?.side ?? "additions"
  const annotations: DiffLineAnnotation<undefined>[] = range ? [{ side, lineNumber: Math.max(range.start, range.end) }] : []
  return (
    <DiffWorkerPool>
      <FileDiff
        fileDiff={fileDiff}
        options={options}
        selectedLines={range}
        lineAnnotations={annotations}
        renderAnnotation={() =>
          range && onComment && path ? (
            <CommentBox
              onCancel={() => setRange(null)}
              onSend={(text) => {
                onComment({ path, start: Math.min(range.start, range.end), end: Math.max(range.start, range.end), side, text })
                setRange(null)
              }}
            />
          ) : null
        }
      />
    </DiffWorkerPool>
  )
}

function CommentBox({ onCancel, onSend }: { onCancel: () => void; onSend: (text: string) => void }) {
  const [text, setText] = useState("")
  return (
    <form
      className="flex flex-col gap-2 border-y border-subtle bg-surface p-2 font-sans"
      onSubmit={(e) => {
        e.preventDefault()
        if (text.trim()) onSend(text)
      }}
    >
      <Textarea
        autoFocus
        aria-label={t("diff.comment")}
        placeholder={t("diff.commentHint")}
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel()
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) onSend(text)
        }}
        className="text-sm"
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onPress={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button size="sm" type="submit" isDisabled={!text.trim()}>
          {t("diff.addComment")}
        </Button>
      </div>
    </form>
  )
}
