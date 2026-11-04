// The context meter in the message box (like OpenBot's): a ring with how full the next turn's context is, and a
// popover with the parts Zorel puts in it (instructions, memories, skills, summary, messages) against the model's
// window, when Zorel compacts on its own, and two ways out: compact now or start a new chat. The numbers are an
// estimate made by the server from the turn it would send (~4 characters a token).
import type { ContextUsage } from "@zorel/contracts"
import { useAtomValue } from "@effect/atom-react"
import { formatCompact, formatPercent, t } from "@zorel/i18n"
import { AsyncResult } from "effect/reactivity"
import { contextAtom, useInvalidate } from "../client.ts"
import { Button, cx, Minimize2, Popover, SquarePen } from "@/ui"

type Part = ContextUsage["parts"][number]["id"]
// One fixed color per part (chart series tokens), so a part keeps its color whatever else is there.
const COLORS: Record<Part, string> = {
  instructions: "var(--z-series-1)",
  memories: "var(--z-series-3)",
  skills: "var(--z-series-7)",
  summary: "var(--z-series-4)",
  messages: "var(--z-text-secondary)"
}
const ALERT = 0.8

export function ContextMeter({ chatId, onCompact, onNewChat }: { chatId: string; onCompact: () => void; onNewChat: () => void }) {
  const usage = AsyncResult.getOrElse(useAtomValue(contextAtom(chatId)), () => undefined)
  const invalidate = useInvalidate()
  const ratio = usage?.windowTokens ? Math.min(1, usage.usedTokens / usage.windowTokens) : null
  const label = usage
    ? ratio === null
      ? t("context.tokensOnly", { tokens: formatCompact(usage.usedTokens) })
      : t("context.used", { percent: formatPercent(ratio) })
    : t("context.title")
  return (
    <Popover
      label={t("context.title")}
      placement="top end"
      className="w-80"
      onOpenChange={(open) => open && invalidate(["context"])}
      trigger={
        <Button variant="ghost" size="sm" aria-label={`${t("context.title")}: ${label}`} shape="pill" className="size-control px-0">
          <Ring ratio={ratio ?? 0} />
        </Button>
      }
    >
      {(close) =>
        usage ? (
          <Details
            usage={usage}
            ratio={ratio}
            onCompact={() => {
              close()
              onCompact()
            }}
            onNewChat={() => {
              close()
              onNewChat()
            }}
          />
        ) : (
          <p className="p-4 text-muted">{t("context.reading")}</p>
        )
      }
    </Popover>
  )
}

// A 20px ring: the used share of the window; warning from 80%.
function Ring({ ratio }: { ratio: number }) {
  const r = 8
  const length = 2 * Math.PI * r
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" className="-rotate-90">
      <circle cx="10" cy="10" r={r} fill="none" stroke="var(--z-border-strong)" strokeWidth="2.5" />
      <circle
        cx="10"
        cy="10"
        r={r}
        fill="none"
        stroke={ratio >= ALERT ? "var(--z-warning)" : "var(--z-text-muted)"}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={`${Math.max(ratio * length, ratio > 0 ? 2 : 0)} ${length}`}
      />
    </svg>
  )
}

function Details({ usage, ratio, onCompact, onNewChat }: { usage: ContextUsage; ratio: number | null; onCompact: () => void; onNewChat: () => void }) {
  const total = usage.windowTokens ?? usage.usedTokens
  const parts = usage.parts.filter((p) => p.tokens > 0)
  const free = usage.windowTokens ? Math.max(0, usage.windowTokens - usage.usedTokens) : null
  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-semibold">{t("context.title")}</span>
          {ratio !== null && <span className={cx("text-sm", ratio >= ALERT ? "text-warning" : "text-muted")}>{t("context.used", { percent: formatPercent(ratio) })}</span>}
        </div>
        {/* One whole split into its parts, the free space as the track. */}
        <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-control" role="img" aria-label={parts.map((p) => `${t(`context.parts.${p.id}`)} ${formatCompact(p.tokens)}`).join(", ")}>
          {parts.map((p) => (
            <span key={p.id} className="h-full rounded-full" style={{ width: `${(p.tokens / total) * 100}%`, minWidth: 4, background: COLORS[p.id] }} />
          ))}
        </div>
        <span className="text-sm text-muted">
          {usage.windowTokens
            ? t("context.ofWindow", { used: formatCompact(usage.usedTokens), window: formatCompact(usage.windowTokens) })
            : t("context.windowUnknown", { used: formatCompact(usage.usedTokens) })}
        </span>
        <ul className="flex flex-col gap-1.5 text-sm">
          {parts.map((p) => (
            <li key={p.id} className="flex items-center gap-2.5">
              <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: COLORS[p.id] }} />
              <span className="min-w-0 flex-1 truncate text-secondary">{t(`context.parts.${p.id}`)}</span>
              <span className="tabular-nums">{formatCompact(p.tokens)}</span>
            </li>
          ))}
          {free !== null && (
            <li className="flex items-center gap-2.5">
              <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-control" />
              <span className="min-w-0 flex-1 truncate text-secondary">{t("context.free")}</span>
              <span className="tabular-nums">{formatCompact(free)}</span>
            </li>
          )}
        </ul>
        {usage.lastInputTokens !== null && <p className="text-sm text-secondary">{t("context.lastRead", { tokens: formatCompact(usage.lastInputTokens) })}</p>}
        <p className="text-sm text-muted">
          {t("context.autoCompact", { after: usage.compactAfter, now: usage.messagesSinceSummary })} {t("context.estimate")}
        </p>
      </div>
      <div className="flex flex-col border-t border-subtle p-1">
        <Button variant="ghost" className="justify-start gap-2.5 font-normal" onPress={onCompact}>
          <Minimize2 />
          {t("context.compactNow")}
        </Button>
        <Button variant="ghost" className="justify-start gap-2.5 font-normal" onPress={onNewChat}>
          <SquarePen />
          {t("context.newChat")}
        </Button>
      </div>
    </div>
  )
}
