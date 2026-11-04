// Settings › Storage (inspired by a reference app's): how much Zero's data folder takes on this computer, split by what
// it holds (a segmented bar with its legend), by project, the largest chats, and what can be cleaned up safely.
// Measured on open and on demand; cleanups are confirmed and go to the audit log.
import { useAtomValue } from "@effect/atom-react"
import type { StorageReport } from "@zero/contracts"
import { formatAge, formatBytes, formatPercent, t } from "@zero/i18n"
import { AsyncResult } from "effect/reactivity"
import { mutations, projectsAtom, storageAtom, useInvalidate, useList, useMutation } from "../client.ts"
import { chatTitle } from "../labels.ts"
import { go } from "../state.ts"
import { Button, ChevronRight, ConfirmButton, Meter, RefreshCw, Rows, Section, ListRow} from "@/ui"
import { ReadingState } from "./reading.tsx"
import { useEffect, useState } from "react"

type Category = StorageReport["categories"][number]["id"]
type Cleanup = StorageReport["cleanup"][number]["id"]
// Fixed order and color per category (the chart series tokens); "other" stays neutral.
const COLORS: Record<Category, string> = {
  workspaces: "var(--z-series-1)",
  attachments: "var(--z-series-2)",
  history: "var(--z-series-3)",
  backups: "var(--z-series-4)",
  runs: "var(--z-series-5)",
  accounts: "var(--z-series-7)",
  browser: "var(--z-series-6)",
  other: "var(--z-text-dim)"
}

export function StorageSection() {
  const result = useAtomValue(storageAtom)
  const report = AsyncResult.getOrElse(result, () => undefined)
  const invalidate = useInvalidate()
  const measure = () => invalidate(["storage"])
  // Measured fresh every time the section opens.
  useEffect(() => invalidate(["storage"]), [invalidate])
  if (!report)
    return (
      <Section title={t("storage.onThisComputer")}>
        <ReadingState loading={!AsyncResult.isFailure(result)} failed={AsyncResult.isFailure(result)} onRetry={measure} />
      </Section>
    )
  return (
    <>
      <Overview report={report} measuring={result.waiting} onMeasure={measure} />
      <Projects report={report} />
      <LargestChats report={report} />
      <Cleanups report={report} />
    </>
  )
}

function Overview({ report, measuring, onMeasure }: { report: StorageReport; measuring: boolean; onMeasure: () => void }) {
  const parts = report.categories.filter((c) => c.bytes > 0)
  return (
    <section className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-muted">{t("storage.onThisComputer")}</span>
          <span className="text-5xl font-semibold tracking-tight">{formatBytes(report.total)}</span>
          <span className="text-sm text-muted">
            {[measuring ? t("storage.measuring") : t("storage.measured", { age: formatAge(report.measuredAt) }), report.free !== null && t("storage.free", { size: formatBytes(report.free) })].filter(Boolean).join(" · ")}
          </span>
        </div>
        <Button size="sm" variant="secondary" isPending={measuring} onPress={onMeasure}>
          <RefreshCw />
          {t("storage.measure")}
        </Button>
      </div>
      {/* One whole split into parts: widths by size, a 2px gap between them, no text inside; the legend names them. */}
      <div className="flex h-2 gap-0.5" role="img" aria-label={parts.map((c) => `${t(`storage.categories.${c.id}`)} ${formatBytes(c.bytes)}`).join(", ")}>
        {parts.map((c) => (
          <span key={c.id} className="h-full rounded-full" style={{ flexGrow: c.bytes, background: COLORS[c.id] }} title={`${t(`storage.categories.${c.id}`)} · ${formatBytes(c.bytes)}`} />
        ))}
      </div>
      <ul className="grid gap-x-10 gap-y-3 sm:grid-cols-2">
        {parts.map((c) => (
          <li key={c.id} className="flex min-w-0 items-center gap-2 text-sm">
            <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: COLORS[c.id] }} />
            <span className="min-w-0 flex-1 truncate text-secondary">{t(`storage.categories.${c.id}`)}</span>
            <span className="tabular-nums">{formatBytes(c.bytes)}</span>
            <span className="w-9 text-right text-muted tabular-nums">{formatPercent(report.total ? c.bytes / report.total : 0)}</span>
          </li>
        ))}
      </ul>
      <p className="text-sm text-dim">{t("storage.otherHint")}</p>
    </section>
  )
}

function Projects({ report }: { report: StorageReport }) {
  if (!report.projects.length) return null
  // The meter is the project's share of everything Zero keeps, the same number written beside it.
  const share = (bytes: number) => (report.total ? bytes / report.total : 0)
  return (
    <Section title={t("storage.projects")}>
      <Rows>
        {report.projects.map((p) => (
          <div key={p.id} className="grid grid-cols-12 items-center gap-4 py-3.5">
            <span className="col-span-5 flex min-w-0 flex-col">
              <span className="truncate font-medium">{p.name}</span>
              <span className="text-sm text-muted">{t("storage.chatsIn", { count: p.chats })}</span>
            </span>
            <Meter value={share(p.bytes)} label={p.name} className="col-span-4" />
            <span className="col-span-3 flex flex-col text-right tabular-nums">
              <span>{formatBytes(p.bytes)}</span>
              <span className="text-sm text-muted">{formatPercent(share(p.bytes))}</span>
            </span>
          </div>
        ))}
      </Rows>
    </Section>
  )
}

function LargestChats({ report }: { report: StorageReport }) {
  const projects = useList(projectsAtom)
  if (!report.chats.length) return null
  return (
    <Section title={t("storage.largestChats")}>
      <Rows>
        {report.chats.map((c) => (
          <ListRow
            key={c.id}
            label={chatTitle(c)}
            title={chatTitle(c)}
            hint={[projects.find((p) => p.id === c.projectId)?.name ?? t("storage.noProject"), t("storage.files", { count: c.files }), t("storage.messages", { count: c.messages })].join(" · ")}
            aside={formatBytes(c.bytes)}
            onPress={() => go({ view: "chat", id: c.id })}
          />
        ))}
      </Rows>
    </Section>
  )
}

function Cleanups({ report }: { report: StorageReport }) {
  const clean = useMutation(mutations.cleanStorage)
  const freeable = report.cleanup.reduce((n, c) => n + c.bytes, 0)
  const name = (id: Cleanup) => t(`storage.cleanups.${id}`)
  const [failed, setFailed] = useState<string>()
  return (
    <Section title={t("storage.cleanUp")} action={<span className="text-sm text-muted">{freeable ? t("storage.canFree", { size: formatBytes(freeable) }) : t("storage.nothing")}</span>}>
      <Rows>
        {report.cleanup.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-4 py-3.5">
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="font-medium">{name(c.id)}</span>
              <span className="text-sm text-muted">{t(`storage.cleanups.${c.id}Hint`)}</span>
            </span>
            <span className="tabular-nums">{formatBytes(c.bytes)}</span>
            <ConfirmButton
              size="sm"
              variant="secondary"
              isDisabled={!c.bytes}
              title={t("storage.confirmTitle", { name: name(c.id).toLowerCase() })}
              description={t("storage.confirmBody", { size: formatBytes(c.bytes) })}
              confirmLabel={t("storage.clean")}
              onConfirm={() => {
                setFailed(undefined)
                clean({ params: { id: c.id }, reactivityKeys: ["storage", "audit"] }).catch(() => setFailed(t("storage.cleanFailed", { name: name(c.id).toLowerCase() })))
              }}
            >
              {t("storage.clean")}
            </ConfirmButton>
          </div>
        ))}
      </Rows>
      {failed && <p className="text-sm text-danger">{failed}</p>}
    </Section>
  )
}
