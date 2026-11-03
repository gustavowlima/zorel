// A subscription's limit windows (ARCHITECTURE §10.2): one meter per window with how much is used and when it
// resets; a window at 80% or more turns warning. Shared by Usage and the model picker.
import { LIMIT_ALERT, type ProviderAccount } from "@zero/contracts"
import { formatPercent, formatTime, t } from "@zero/i18n"
import { windowLabel } from "../labels.ts"
import { cx, Meter } from "@/ui"

export function LimitWindows({ account, compact = false }: { account: ProviderAccount; compact?: boolean }) {
  if (account.limitedUntil) return <p className="text-sm text-warning">{t("failover.limitedUntil", { time: formatTime(account.limitedUntil) })}</p>
  const windows = account.usage?.windows ?? []
  if (!windows.length) return compact ? null : <p className="text-sm text-dim">{t("usage.noReading")}</p>
  return (
    <div className={cx("flex flex-col", compact ? "gap-1.5" : "gap-2.5")}>
      {windows.map((w) => {
        const used = w.usedPercent / 100
        return (
          <div key={w.id} className="grid grid-cols-12 items-center gap-3 text-sm">
            <span className="col-span-3 truncate text-secondary">{windowLabel(w.id)}</span>
            <Meter value={used} warnAt={LIMIT_ALERT} label={`${windowLabel(w.id)} ${formatPercent(used)}`} className={compact ? "col-span-7" : "col-span-5"} />
            <span className={cx(compact ? "col-span-2" : "col-span-4", "truncate text-right tabular-nums", used >= LIMIT_ALERT ? "text-warning" : "text-muted")}>
              {formatPercent(used)}
              {w.resetsAt && !compact ? ` · ${t("usage.resets", { time: formatTime(w.resetsAt) })}` : ""}
            </span>
          </div>
        )
      })}
    </div>
  )
}
