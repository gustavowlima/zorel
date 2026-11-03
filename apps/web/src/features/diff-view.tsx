// One file's diff, rendered by @pierre/diffs (syntax highlight, line numbers, word-level changes) inside
// the shared worker pool. The surface takes Zero's tokens: CSS variables cross the viewer's shadow DOM.
import { getSingularPatch } from "@pierre/diffs"
import { FileDiff } from "@pierre/diffs/react"
import { useMemo } from "react"
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

export default function DiffView({ patch }: { patch: string }) {
  const theme = useResolvedTheme()
  const fileDiff = useMemo(() => getSingularPatch(patch), [patch])
  // Stable options: the viewer re-renders when their identity changes.
  const options = useMemo(
    () => ({ diffStyle: "unified" as const, overflow: "wrap" as const, disableFileHeader: true, theme: DIFF_THEMES, themeType: theme, unsafeCSS: SURFACE_CSS }),
    [theme]
  )
  return (
    <DiffWorkerPool>
      <FileDiff fileDiff={fileDiff} options={options} />
    </DiffWorkerPool>
  )
}
