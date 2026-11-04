// A whole file, read only, in the same viewer as the diffs (@pierre/diffs: syntax highlight by the name, line
// numbers, the shared worker pool and Zorel's surface tokens). Loads with the Files panel, not with the app.
import { File } from "@pierre/diffs/react"
import { useMemo } from "react"
import { useResolvedTheme } from "../state.ts"
import { SURFACE_CSS } from "./diff-view.tsx"
import { DIFF_THEMES, DiffWorkerPool } from "./diff-pool.tsx"

export default function FileView({ name, contents }: { name: string; contents: string }) {
  const theme = useResolvedTheme()
  const file = useMemo(() => ({ name, contents }), [name, contents])
  const options = useMemo(() => ({ overflow: "scroll" as const, disableFileHeader: true, theme: DIFF_THEMES, themeType: theme, unsafeCSS: SURFACE_CSS }), [theme])
  return (
    <DiffWorkerPool>
      <File file={file} options={options} />
    </DiffWorkerPool>
  )
}
