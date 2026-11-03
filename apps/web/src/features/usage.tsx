// Usage (ARCHITECTURE §10.2, prototype "Usage"): what the agents used this month (or the last 7/30 days),
// from Zero's own turn records. Totals with the estimated cost, tokens per day, each subscription's limit
// windows with their reset, where it went (by project, agent, model or account), the most expensive turns,
// and a CSV export. Subscriptions show the API equivalent, not a charge.
import { LIMIT_ALERT, type ProviderAccount, type UsageRow } from "@zero/contracts"
import { useAtomValue } from "@effect/atom-react"
import { formatAge, formatCompact, formatDate, formatDuration, formatNumber, formatPercent, t } from "@zero/i18n"
import { AsyncResult } from "effect/reactivity"
import { useEffect, useMemo, useState } from "react"
import { accountsAtom, agentsAtom, mutations, projectsAtom, topTurnsAtom, usageAtom, useList, useMutation } from "../client.ts"
import { chatTitle, formatCost, fullest, modelLabel, splitModel } from "../labels.ts"
import { go } from "../state.ts"
import { LimitWindows } from "./limits.tsx"
import { Button, ChartColumn, CircleAlert, EmptyState, File, IconButton, Meter, ProviderIcon, Screen, Section, Tab, TabList, Tabs, cx } from "@/ui"

type Range = "month" | "7" | "30"
type Group = "project" | "agent" | "model" | "account"
const DAY = 86_400_000

const startOf = (range: Range) => {
  if (range !== "month") return Date.now() - Number(range) * DAY
  // Usage rows are UTC days, so the month starts on a UTC day too.
  const d = new Date()
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
}

export function UsageView() {
  const rows = useList(usageAtom)
  const projects = useList(projectsAtom)
  const agents = useList(agentsAtom)
  const accounts = useList(accountsAtom)
  const [range, setRange] = useState<Range>("month")
  const [group, setGroup] = useState<Group>("project")
  const since = useMemo(() => startOf(range), [range])
  // Rows are per UTC day: a day counts when it ends after the start of the range.
  const inRange = rows.filter((r) => r.day + DAY > since)
  const subscriptions = accounts.filter((a) => a.kind === "subscription")
  useReadOnOpen(subscriptions)
  const alerts = subscriptions.filter((a) => fullest(a) >= LIMIT_ALERT || a.limitedUntil)

  const sum = (f: (r: UsageRow) => number) => inRange.reduce((n, r) => n + f(r), 0)
  const turns = sum((r) => r.turns)
  const input = sum((r) => r.inputTokens)
  const output = sum((r) => r.outputTokens)
  const cached = sum((r) => r.cachedTokens)
  const apiCost = sum((r) => (r.billing === "api" ? (r.cost ?? 0) : 0))
  const equivalent = sum((r) => (r.billing === "subscription" ? (r.cost ?? 0) : 0))
  const priced = inRange.some((r) => r.billing === "api" && r.cost !== null) // turns before pricing have no cost

  const nameOf = (r: UsageRow): { key: string; label: string; icon?: string } => {
    if (group === "project") return { key: r.projectId ?? "", label: r.projectId ? (projects.find((p) => p.id === r.projectId)?.name ?? t("usage.removed")) : t("usage.looseChats") }
    if (group === "agent") return { key: r.agentId ?? "", label: r.agentId ? (agents.find((a) => a.id === r.agentId)?.name ?? t("usage.removed")) : t("usage.noAgent") }
    if (group === "model") return { key: r.model, label: modelLabel(r.model), icon: splitModel(r.model).provider }
    const account = accounts.find((a) => a.id === r.accountId)
    return { key: r.accountId ?? "", label: account?.label ?? (r.accountId ? t("usage.removed") : t("usage.defaultAccount")), icon: account?.provider ?? splitModel(r.model).provider }
  }
  const groups = [
    ...inRange
      .reduce((map, r) => {
        const g = nameOf(r)
        const prev = map.get(g.key)
        map.set(g.key, { ...g, tokens: (prev?.tokens ?? 0) + r.inputTokens + r.outputTokens, cost: (prev?.cost ?? 0) + (r.cost ?? 0) })
        return map
      }, new Map<string, { key: string; label: string; icon?: string; tokens: number; cost: number }>())
      .values()
  ].sort((a, b) => b.tokens - a.tokens)
  const total = groups.reduce((n, g) => n + g.tokens, 0)

  const exportCsv = () => {
    const header = ["day", "project", "agent", "model", "account", "billing", "turns", "input_tokens", "output_tokens", "cached_tokens", "cost_usd"]
    const lines = inRange.map((r) =>
      [
        new Date(r.day).toISOString().slice(0, 10),
        projects.find((p) => p.id === r.projectId)?.name ?? "",
        agents.find((a) => a.id === r.agentId)?.name ?? "",
        r.model,
        accounts.find((a) => a.id === r.accountId)?.label ?? "",
        r.billing,
        r.turns,
        r.inputTokens,
        r.outputTokens,
        r.cachedTokens,
        r.cost?.toFixed(6) ?? ""
      ]
        .map((v) => `"${String(v).replaceAll('"', '""')}"`)
        .join(",")
    )
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `zero-usage-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <Screen
      title={t("usage.title")}
      subtitle={t("usage.subtitle")}
      actions={
        <>
          <Tabs selectedKey={range} onSelectionChange={(k) => setRange(k as Range)}>
            <TabList label={t("usage.range")}>
              <Tab id="month">{t("usage.thisMonth")}</Tab>
              <Tab id="7">{t("usage.days", { count: 7 })}</Tab>
              <Tab id="30">{t("usage.days", { count: 30 })}</Tab>
            </TabList>
          </Tabs>
          <Button size="sm" variant="secondary" isDisabled={!inRange.length} onPress={exportCsv}>
            <File />
            {t("usage.exportCsv")}
          </Button>
        </>
      }
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-7 py-7">
        {alerts.length > 0 && (
          <div role="alert" className="flex items-center gap-2 rounded-card border border-subtle bg-surface px-4 py-3 text-sm text-warning">
            <CircleAlert className="size-4 shrink-0" />
            {t("usage.alert", { count: alerts.length })}
          </div>
        )}
        {turns === 0 ? (
          <EmptyState icon={<ChartColumn />} title={t("usage.empty")} />
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-subtle bg-subtle sm:grid-cols-4">
              <Stat label={t("usage.turns")} value={formatNumber(turns)} />
              <Stat label={t("usage.tokensIn")} value={formatCompact(input)} note={`${t("usage.tokensOut")} ${formatCompact(output)}`} />
              <Stat label={t("usage.cost")} value={priced ? formatCost(apiCost) : "—"} note={equivalent ? `${t("usage.apiEquivalent")} ${formatCost(equivalent)}` : undefined} title={t("usage.costHint")} />
              <Stat label={t("usage.cacheHit")} value={input ? formatPercent(cached / input) : "—"} note={`${t("usage.avgTurn")} ${formatDuration(sum((r) => r.durationMs) / turns)}`} />
            </dl>
            <DailyChart rows={inRange} since={since} />
          </>
        )}
        {subscriptions.length > 0 && (
          <Section
            title={t("usage.subscriptions")}
            action={
              <Button size="sm" variant="ghost" onPress={() => go({ view: "settings", tab: "accounts" })}>
                {t("usage.manage")}
              </Button>
            }
          >
            <div className="flex flex-col divide-y divide-subtle border-y border-subtle">
              {subscriptions.map((a) => (
                <SubscriptionRow key={a.id} account={a} />
              ))}
            </div>
          </Section>
        )}
        {turns > 0 && (
          <Section
            title={t("usage.whereItWent")}
            action={
              <Tabs selectedKey={group} onSelectionChange={(k) => setGroup(k as Group)}>
                <TabList label={t("usage.groupBy")}>
                  <Tab id="project">{t("usage.byProject")}</Tab>
                  <Tab id="agent">{t("usage.byAgent")}</Tab>
                  <Tab id="model">{t("usage.byModel")}</Tab>
                  <Tab id="account">{t("usage.byAccount")}</Tab>
                </TabList>
              </Tabs>
            }
          >
            <div className="flex flex-col">
              {groups.map((g) => (
                <div key={g.key} className="grid grid-cols-12 items-center gap-4 border-b border-subtle py-3 last:border-0">
                  <span className="col-span-4 flex min-w-0 items-center gap-2">
                    {g.icon && <ProviderIcon provider={g.icon} size={14} />}
                    <span className="truncate">{g.label}</span>
                  </span>
                  <Meter value={total ? g.tokens / total : 0} label={g.label} className="col-span-4" />
                  <span className="col-span-2 text-right text-sm text-muted tabular-nums">{formatCompact(g.tokens)}</span>
                  <span className="col-span-2 text-right text-sm text-secondary tabular-nums">{g.cost ? formatCost(g.cost) : "—"}</span>
                </div>
              ))}
            </div>
          </Section>
        )}
        {turns > 0 && <TopTurns since={since} />}
      </div>
    </Screen>
  )
}

// Opening Usage reads every signed-in subscription's limits (the server caches for 4 min). One at a time:
// the mutation atom is shared, so a second call would abort the first.
function useReadOnOpen(subscriptions: ReadonlyArray<ProviderAccount>) {
  const read = useMutation(mutations.readLimits)
  const ids = subscriptions.filter((a) => a.loggedIn).map((a) => a.id).join(",")
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by the joined ids
  useEffect(() => {
    let cancelled = false
    void (async () => {
      for (const id of ids ? ids.split(",") : []) {
        if (cancelled) return
        await read({ params: { id }, reactivityKeys: ["accounts"] }).catch(() => undefined) // the last reading stays
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ids])
}

const Stat = ({ label, value, note, title }: { label: string; value: string; note?: string | undefined; title?: string }) => (
  <div className="flex flex-col gap-1 bg-canvas px-4 py-3.5" {...(title && { title })}>
    <dt className="text-sm text-muted">{label}</dt>
    <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    {note && <dd className="truncate text-sm text-dim">{note}</dd>}
  </div>
)

// A UTC day read at its midday is the same calendar date in any time zone.
const dayLabel = (day: number) => formatDate(day + DAY / 2)

// One bar per day of the range (tokens in + out); empty days stay as a baseline.
function DailyChart({ rows, since }: { rows: ReadonlyArray<UsageRow>; since: number }) {
  const first = Math.floor(since / DAY) * DAY
  const days = Math.max(1, Math.ceil((Date.now() - first) / DAY))
  const totals = Array.from({ length: days }, (_, i) => first + i * DAY).map((day) => ({
    day,
    tokens: rows.filter((r) => r.day === day).reduce((n, r) => n + r.inputTokens + r.outputTokens, 0)
  }))
  const max = Math.max(1, ...totals.map((d) => d.tokens))
  return (
    <Section title={t("usage.perDay")}>
      <div className="flex h-28 items-end justify-between gap-1" role="img" aria-label={t("usage.perDay")}>
        {totals.map((d) => (
          <span
            key={d.day}
            title={t("usage.dayTokens", { day: dayLabel(d.day), tokens: formatCompact(d.tokens) })}
            className={cx("min-h-0.5 max-w-8 flex-1 rounded-sm transition-colors duration-150", d.tokens ? "bg-accent hover:bg-accent-hover" : "bg-control")}
            style={{ height: `${Math.max(2, (d.tokens / max) * 100)}%` }}
          />
        ))}
      </div>
      <div className="flex justify-between text-sm text-dim">
        <span>{dayLabel(totals[0]!.day)}</span>
        <span>{dayLabel(totals.at(-1)!.day)}</span>
      </div>
    </Section>
  )
}

// A subscription with its windows and a button to read them again.
function SubscriptionRow({ account: a }: { account: ProviderAccount }) {
  const read = useMutation(mutations.readLimits)
  const [reading, setReading] = useState(false)
  const refresh = () => {
    setReading(true)
    read({ params: { id: a.id }, reactivityKeys: ["accounts"] })
      .catch(() => undefined) // no reading now; the last one stays
      .finally(() => setReading(false))
  }
  return (
    <div className="flex flex-col gap-3 py-4">
      <div className="flex items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-card bg-surface">
          <ProviderIcon provider={a.provider} size={18} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium">{a.label}</span>
          <span className="truncate text-sm text-muted">{a.loggedIn ? (a.identity ?? t("accounts.signedIn")) : t("accounts.signedOut")}</span>
        </span>
        {a.usage && <span className="text-sm text-dim">{t("usage.readAgo", { age: formatAge(a.usage.readAt) })}</span>}
        <IconButton label={t("usage.refresh")} isDisabled={reading || !a.loggedIn} onPress={refresh}>
          <ChartColumn />
        </IconButton>
      </div>
      <div className="pl-11">
        <LimitWindows account={a} />
      </div>
    </div>
  )
}

function TopTurns({ since }: { since: number }) {
  // Rounded to the hour: one query per range, not one per render.
  const top = AsyncResult.getOrElse(useAtomValue(topTurnsAtom(Math.floor(since / 3_600_000) * 3_600_000)), () => [])
  return (
    <Section title={t("usage.topTurns")}>
      {top.length === 0 ? (
        <p className="text-muted">{t("usage.noTopTurns")}</p>
      ) : (
        <div className="flex flex-col divide-y divide-subtle border-y border-subtle">
          {top.map((turn) => (
            <Button key={turn.turnId} variant="ghost" className="h-auto justify-start gap-3 rounded-none px-1 py-2.5 font-normal text-fg" onPress={() => go({ view: "chat", id: turn.chatId })}>
              <ProviderIcon provider={splitModel(turn.model).provider} size={14} />
              <span className="flex min-w-0 flex-1 flex-col text-left">
                <span className="truncate">{chatTitle({ title: turn.chatTitle })}</span>
                <span className="truncate text-sm text-muted">{`${modelLabel(turn.model)} · ${formatCompact(turn.inputTokens + turn.outputTokens)} · ${formatAge(turn.at)}`}</span>
              </span>
              <span className="shrink-0 text-right tabular-nums">
                {formatCost(turn.cost)}
                {turn.billing === "subscription" && <span className="block text-sm text-dim">{t("usage.subscription")}</span>}
              </span>
            </Button>
          ))}
        </div>
      )}
    </Section>
  )
}
