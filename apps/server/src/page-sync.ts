// Keeps the knowledge folder and the pages in step while the server runs: one sync at start (writes the files a
// row lacks, reads edits made while Zorel was closed), then one after each burst of changes in the folder (an
// editor, Obsidian, git). A file deleted while watched takes its page with it; at start a missing file is written
// again (nothing is lost when the folder is new, moved or restored).
import { mkdirSync, watch } from "node:fs"
import { Effect, Layer } from "effect"
import { Store } from "./db.ts"

const SETTLE_MS = 300 // changes this close together make one sync (an editor's save is several events)

export const PageSync = (dir: string) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const store = yield* Store
      mkdirSync(dir, { recursive: true })
      const first = yield* store.syncPages(false)
      if (first.imported + first.updated + first.written) yield* Effect.logInfo("knowledge folder synced", first)
      let timer: ReturnType<typeof setTimeout> | undefined
      const sync = () =>
        Effect.runPromise(store.syncPages(true)).then(
          (r) => r.imported + r.updated + r.removed && console.info("knowledge folder changed outside Zorel", r),
          (e: unknown) => console.error("knowledge folder sync failed:", e)
        )
      const watcher = watch(dir, { recursive: true }, (_, name) => {
        if (name?.endsWith(".zorel-tmp")) return // our own write, mid-rename
        clearTimeout(timer)
        timer = setTimeout(sync, SETTLE_MS)
      })
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          clearTimeout(timer)
          watcher.close()
        })
      )
    })
  )
