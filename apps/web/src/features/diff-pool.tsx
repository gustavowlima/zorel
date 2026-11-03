// Worker pool for @pierre/diffs (as T3 Code sets it up): syntax highlighting runs in workers, and the
// viewers render through the pool. Required in practice: without it, a viewer remounted by React's
// StrictMode with `disableFileHeader` keeps an empty <pre> (the library treats it as already rendered).
import { WorkerPoolContextProvider } from "@pierre/diffs/react"
import DiffsWorker from "@pierre/diffs/worker/worker.js?worker"
import type { ReactNode } from "react"

export const DIFF_THEMES = { dark: "pierre-dark", light: "pierre-light" } as const

const poolSize = () => Math.max(2, Math.min(4, Math.floor((navigator.hardwareConcurrency || 4) / 2)))

export function DiffWorkerPool({ children }: { children: ReactNode }) {
  return (
    <WorkerPoolContextProvider poolOptions={{ workerFactory: () => new DiffsWorker(), poolSize: poolSize() }} highlighterOptions={{ theme: DIFF_THEMES }}>
      {children}
    </WorkerPoolContextProvider>
  )
}
