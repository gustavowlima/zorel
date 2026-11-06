// Usage (ARCHITECTURE §10.2): one headline number (estimated cost, or tokens),
// the harnesses that make it up (the chart's legend, with their share), a stacked area of the same metric per
// day, the token totals, the subscriptions' limit windows, a breakdown table (model, agent, project, account,
// day: the day view is the chart as a table) and the most expensive turns. Filters (agent, metric, range) sit
// in one row in the header and scope everything below. Subscriptions show the API equivalent, not a charge.
import { LIMIT_ALERT, type ProviderAccount, type UsageRow } from "@zorel/contracts"
import { useAtomValue } from "@effect/atom-react"
import { formatAge, formatCompact, formatDate, formatDuration, formatPercent, t } from "@zorel/i18n"
import { AsyncResult } from "effect/reactivity"
import { type KeyboardEvent, type PointerEvent, useEffect, useMemo, useState } from "react"
import { accountsAtom, agentsAtom, mutations, projectsAtom, topTurnsAtom, usageAtom, useList, useMutation } from "../client.ts"
import { chatTitle, formatCost, fullest, modelLabel, providerLabel, splitModel } from "../labels.ts"
import { go } from "../state.ts"
import { LimitWindows } from "./limits.tsx"
import { Button, ChartColumn, Column, CircleAlert, EmptyState, IconButton, Notice, ProviderIcon, RowHit, Rows, Screen, Section, Select, Tab, TabList, Tabs } from "@/ui"

type Range = "month" | "7" | "30"
type Metric = "cost" | "tokens"
type Group = "model" | "agent" | "project" | "account" | "day"
const DAY = 86_400_000

// Harnesses in a fixed order: the order of the stack and of the series colors. A harness keeps its color
// whatever the filter shows (color follows the entity, never its rank).
const HARNESSES = ["codex-cli", "claude-cli", "anthropic", "openai", "openrouter", "ollama", "lmstudio"] as const
const colorOf = (harness: string) => `var(--z-series-${Math.max(0, HARNESSES.indexOf(harness as (typeof HARNESSES)[number])) + 1})`

const tokensOf = (r: UsageRow) => r.inputTokens + r.outputTokens
const measureOf = (metric: Metric) => (r: UsageRow) => (metric === "cost" ? (r.cost ?? 0) : tokensOf(r))
const formatValue = (metric: Metric, v: number) => (metric === "cost" ? formatCost(v) : formatCompact(v))
// Usage rows are UTC days; a UTC day read at its midday is the same calendar date in any time zone.
const dayLabel = (day: number) => formatDate(day + DAY / 2)

const startOf = (range: Range) => {
  if (range !== "month") return Date.now() - Number(range) * DAY
  const d = new Date()
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) // the month starts on a UTC day too
}

export function UsageView({ agentId }: { agentId?: string | undefined }) {
  const rows = useList(usageAtom)
  const agents = useList(agentsAtom)
  const accounts = useList(accountsAtom)
  const [range, setRange] = useState<Range>("month")
  const [metric, setMetric] = useState<Metric>("cost")
  const [agent, setAgent] = useState(agentId ?? "") // "": all agents
  const since = useMemo(() => startOf(range), [range])
  const subscriptions = accounts.filter((a) => a.kind === "subscription")
  useReadOnOpen(subscriptions)
  const alerts = subscriptions.filter((a) => fullest(a) >= LIMIT_ALERT || a.limitedUntil)

  // A day counts when it ends after the start of the range.
  const inRange = rows.filter((r) => r.day + DAY > since && (!agent || r.agentId === agent))
  const usedAgents = agents.filter((a) => rows.some((r) => r.agentId === a.id && r.day + DAY > since))
  const value = measureOf(metric)
  const total = inRange.reduce((n, r) => n + value(r), 0)
  const turns = inRange.reduce((n, r) => n + r.turns, 0)
  const priced = inRange.some((r) => r.cost !== null) // turns before pricing existed have no cost

  const harnesses = HARNESSES.map((h) => {
    const mine = inRange.filter((r) => splitModel(r.model).provider === h)
    return { id: h, value: mine.reduce((n, r) => n + value(r), 0), tokens: mine.reduce((n, r) => n + tokensOf(r), 0), cost: mine.reduce((n, r) => n + (r.cost ?? 0), 0), rows: mine.length }
  }).filter((h) => h.rows > 0)

  return (
    <Screen
      title={t("usage.title")}
      subtitle={t("usage.subtitle")}
      actions={
        <>
          {usedAgents.length > 0 && (
            <Select
              size="sm"
              className="w-auto max-w-44"
              aria-label={t("usage.byAgent")}
              value={agent}
              onChange={setAgent}
              options={[{ value: "", label: t("usage.allAgents") }, ...usedAgents.map((a) => ({ value: a.id, label: a.name }))]}
            />
          )}
          <Tabs selectedKey={metric} onSelectionChange={(k) => setMetric(k as Metric)}>
            <TabList label={t("usage.metric")}>
              <Tab id="cost">{t("usage.metricCost")}</Tab>
              <Tab id="tokens">{t("usage.metricTokens")}</Tab>
            </TabList>
          </Tabs>
          <Select
            size="sm"
            className="w-auto"
            aria-label={t("usage.range")}
            value={range}
            onChange={(v) => setRange(v as Range)}
            options={[
              { value: "month", label: t("usage.thisMonth") },
              { value: "7", label: t("usage.days", { count: 7 }) },
              { value: "30", label: t("usage.days", { count: 30 }) }
            ]}
          />
        </>
      }
    >
      <Column wide>
        {alerts.length > 0 && (
          <Notice icon={<CircleAlert />}>{t("usage.alert", { count: alerts.length })}</Notice>
        )}

        {turns === 0 ? (
          <EmptyState icon={<ChartColumn />} title={t("usage.empty")} />
        ) : (
          <>
            <div className="grid gap-10 lg:grid-cols-12">
              <div className="flex flex-col gap-8 lg:col-span-5">
                <div className="flex flex-col gap-1.5" title={metric === "cost" ? t("usage.costHint") : undefined}>
                  <p className="text-5xl font-semibold tracking-tight">{metric === "cost" && !priced ? "—" : formatValue(metric, total)}</p>
                  <p className="text-sm text-muted">
                    {[t("usage.turnCount", { count: turns }), metric === "cost" ? t("usage.apiEstimate") : t("usage.tokensInOut")].join(" · ")}
                  </p>
                </div>
                <ul className="flex flex-col gap-5" aria-label={t(metric === "cost" ? "usage.chart.cost" : "usage.chart.tokens")}>
                  {harnesses.map((h) => (
                    <li key={h.id} className="flex flex-col gap-1">
                      <div className="flex items-center gap-2.5">
                        <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: colorOf(h.id) }} />
                        <ProviderIcon provider={h.id} size={16} />
                        <span className="min-w-0 flex-1 truncate">{providerLabel(h.id)}</span>
                        <span className="font-semibold tabular-nums">{metric === "cost" && !h.cost ? "—" : formatValue(metric, h.value)}</span>
                      </div>
                      <p className="pl-4.5 text-sm text-muted">
                        {metric === "cost"
                          ? h.cost
                            ? t("usage.shareOfCost", { share: formatPercent(total ? h.value / total : 0), tokens: formatCompact(h.tokens) })
                            : t("usage.unpricedTokens", { tokens: formatCompact(h.tokens) })
                          : t("usage.shareOfTokens", { share: formatPercent(total ? h.value / total : 0), cost: h.cost ? formatCost(h.cost) : t("usage.unpriced") })}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="min-w-0 lg:col-span-7">
                <AreaChart rows={inRange} since={since} metric={metric} series={harnesses.map((h) => h.id)} unpriced={harnesses.filter((h) => !h.cost).map((h) => h.id)} />
              </div>
            </div>

            <Totals rows={inRange} />
          </>
        )}

        {subscriptions.length > 0 && (
          <Section
            title={t("usage.subscriptions")}
            action={
              <Button size="sm" variant="ghost" onPress={() => go({ view: "settings", tab: "providers" })}>
                {t("usage.manage")}
              </Button>
            }
          >
            <Rows>
              {subscriptions.map((a) => (
                <SubscriptionRow key={a.id} account={a} />
              ))}
            </Rows>
          </Section>
        )}

        {turns > 0 && <Breakdown rows={inRange} metric={metric} total={total} />}
        {turns > 0 && <TopTurns since={since} />}
      </Column>
    </Screen>
  )
}

// Stacked area of the metric per day, one band per harness in the fixed order. A crosshair snaps to the
// nearest day and one readout lists every harness; the arrow keys do the same from the keyboard.
function AreaChart({
  rows,
  since,
  metric,
  series,
  unpriced
}: {
  rows: ReadonlyArray<UsageRow>
  since: number
  metric: Metric
  series: ReadonlyArray<string>
  unpriced: ReadonlyArray<string> // harnesses with no known price: their cost reads "—", not $0
}) {
  const [at, setAt] = useState<number | null>(null)
  const first = Math.floor(since / DAY) * DAY
  const count = Math.max(1, Math.ceil((Date.now() - first) / DAY))
  const days = Array.from({ length: count }, (_, i) => first + i * DAY)
  const value = measureOf(metric)
  const per = days.map((day) => series.map((s) => rows.filter((r) => r.day === day && splitModel(r.model).provider === s).reduce((n, r) => n + value(r), 0)))
  const stacks = per.map((vals) => {
    let sum = 0
    return vals.map((v) => (sum += v))
  })
  const max = niceMax(Math.max(0, ...stacks.map((s) => s.at(-1) ?? 0)))
  const ticks = [0, max / 2, max]

  const W = 600
  const H = 240
  // x of each drawn point; a single day still draws a band across the whole plot.
  const xs = count === 1 ? [0, W] : days.map((_, i) => (i / (count - 1)) * W)
  const dayAt = (k: number) => (count === 1 ? 0 : k)
  const top = (i: number) => xs.map((x, k) => [x, H - ((stacks[dayAt(k)]![i] ?? 0) / max) * H] as const)
  const bottom = (i: number) => (i === 0 ? xs.map((x) => [x, H] as const) : top(i - 1))
  const line = (pts: ReadonlyArray<readonly [number, number]>) => pts.map(([x, y], k) => `${k ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("")
  const band = (i: number) => `${line(top(i))}${line([...bottom(i)].reverse()).replace(/^M/, "L")}Z`

  const pick = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    setAt(Math.round(((e.clientX - box.left) / box.width) * (count - 1)))
  }
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
    e.preventDefault()
    const from = at ?? count - 1
    setAt(Math.min(count - 1, Math.max(0, from + (e.key === "ArrowRight" ? 1 : -1))))
  }
  const left = at === null ? 0 : count === 1 ? 50 : (at / (count - 1)) * 100
  const label = t(metric === "cost" ? "usage.chart.cost" : "usage.chart.tokens")
  const shown = (s: string, v: number) => (metric === "cost" && unpriced.includes(s) ? "—" : formatValue(metric, v))
  const readout = (d: number) => [dayLabel(days[d]!), ...series.map((s, i) => `${providerLabel(s)} ${shown(s, per[d]![i] ?? 0)}`)].join(", ")

  return (
    <figure className="flex flex-col gap-2">
      <div className="flex">
        <div className="flex w-16 shrink-0 flex-col justify-between pr-3 text-right text-xs text-dim tabular-nums" style={{ height: H }} aria-hidden="true">
          {[...ticks].reverse().map((v) => (
            <span key={v} className="-my-1.5 leading-3">
              {formatValue(metric, v)}
            </span>
          ))}
        </div>
        {/* The plot is a slider over the days: the arrow keys move the readout, which is also its value text. */}
        <div
          role="slider"
          tabIndex={0}
          aria-label={`${label}. ${t("usage.chartHint")}`}
          aria-valuemin={0}
          aria-valuemax={count - 1}
          aria-valuenow={at ?? count - 1}
          aria-valuetext={readout(at ?? count - 1)}
          className="relative min-w-0 flex-1 rounded-inline outline-none focus-visible:ring-2 focus-visible:ring-accent"
          style={{ height: H }}
          onPointerMove={pick}
          onPointerLeave={() => setAt(null)}
          onFocus={() => setAt((a) => a ?? count - 1)}
          onBlur={() => setAt(null)}
          onKeyDown={keys}
        >
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden="true">
            {ticks.map((v) => (
              <line key={v} x1={0} x2={W} y1={H - (v / max) * H} y2={H - (v / max) * H} stroke="var(--z-border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
            {series.map((s, i) => (
              <g key={s}>
                <path d={band(i)} fill={colorOf(s)} fillOpacity={0.14} />
                <path d={line(top(i))} fill="none" stroke={colorOf(s)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              </g>
            ))}
          </svg>
          {at !== null && (
            <>
              <span className="pointer-events-none absolute inset-y-0 w-px bg-strong" style={{ left: `${left}%` }} />
              <div
                className="pointer-events-none absolute top-2 z-10 flex min-w-40 flex-col gap-1.5 rounded-control border border-subtle bg-raised px-3 py-2 text-sm"
                style={{ left: `${left}%`, transform: left > 60 ? "translateX(calc(-100% - 12px))" : "translateX(12px)" }}
              >
                <span className="text-muted">{dayLabel(days[at]!)}</span>
                {series.map((s, i) => (
                  <span key={s} className="flex items-center gap-2">
                    <span aria-hidden="true" className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: colorOf(s) }} />
                    <span className="font-semibold tabular-nums">{shown(s, per[at]![i] ?? 0)}</span>
                    <span className="truncate text-muted">{providerLabel(s)}</span>
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <figcaption className="flex justify-between pl-16 text-xs text-dim uppercase">
        <span>{dayLabel(days[0]!)}</span>
        {count > 2 && <span>{dayLabel(days[Math.floor((count - 1) / 2)]!)}</span>}
        <span>{dayLabel(days.at(-1)!)}</span>
      </figcaption>
    </figure>
  )
}

// A round axis top: 1, 2 or 5 times a power of ten, so its half is round too.
function niceMax(v: number) {
  if (v <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  return ([1, 2, 5, 10].find((m) => m * p >= v) ?? 10) * p
}

function Totals({ rows }: { rows: ReadonlyArray<UsageRow> }) {
  const sum = (f: (r: UsageRow) => number) => rows.reduce((n, r) => n + f(r), 0)
  const input = sum((r) => r.inputTokens)
  const output = sum((r) => r.outputTokens)
  const cached = sum((r) => r.cachedTokens)
  const turns = sum((r) => r.turns)
  const items = [
    [t("usage.totalTokens"), formatCompact(input + output)],
    [t("usage.freshInput"), formatCompact(Math.max(0, input - cached))],
    [t("usage.cachedInput"), formatCompact(cached)],
    [t("usage.output"), formatCompact(output)],
    [t("usage.cacheShare"), input ? formatPercent(cached / input) : "—"],
    [t("usage.avgTurn"), turns ? formatDuration(sum((r) => r.durationMs) / turns) : "—"]
  ] as const
  return (
    <Section title={t("usage.totals")}>
      <dl className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-3 lg:grid-cols-6">
        {items.map(([label, v]) => (
          <div key={label} className="flex flex-col gap-1">
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="text-lg">{v}</dd>
          </div>
        ))}
      </dl>
    </Section>
  )
}

// The rows of the range grouped by model, agent, project, account or day; Day is the chart as a table.
function Breakdown({ rows, metric, total }: { rows: ReadonlyArray<UsageRow>; metric: Metric; total: number }) {
  const projects = useList(projectsAtom)
  const agents = useList(agentsAtom)
  const accounts = useList(accountsAtom)
  const [group, setGroup] = useState<Group>("model")
  const keyOf = (r: UsageRow): { key: string; label: string; icon?: string } => {
    if (group === "model") return { key: r.model, label: modelLabel(r.model), icon: splitModel(r.model).provider }
    if (group === "agent") return { key: r.agentId ?? "", label: r.agentId ? (agents.find((a) => a.id === r.agentId)?.name ?? t("usage.removed")) : t("usage.noAgent") }
    if (group === "project") return { key: r.projectId ?? "", label: r.projectId ? (projects.find((p) => p.id === r.projectId)?.name ?? t("usage.removed")) : t("usage.looseChats") }
    if (group === "day") return { key: String(r.day), label: dayLabel(r.day) }
    const account = accounts.find((a) => a.id === r.accountId)
    return { key: r.accountId ?? "", label: account?.label ?? (r.accountId ? t("usage.removed") : t("usage.defaultAccount")), icon: account?.provider ?? splitModel(r.model).provider }
  }
  const value = measureOf(metric)
  const groups = [
    ...rows
      .reduce((map, r) => {
        const g = keyOf(r)
        const prev = map.get(g.key)
        map.set(g.key, { ...g, day: r.day, value: (prev?.value ?? 0) + value(r), cost: (prev?.cost ?? 0) + (r.cost ?? 0), tokens: (prev?.tokens ?? 0) + tokensOf(r) })
        return map
      }, new Map<string, { key: string; label: string; icon?: string; day: number; value: number; cost: number; tokens: number }>())
      .values()
  ].sort((a, b) => (group === "day" ? b.day - a.day : b.value - a.value))
  const heading = { model: t("usage.byModel"), agent: t("usage.byAgent"), project: t("usage.byProject"), account: t("usage.byAccount"), day: t("usage.byDay") }[group]

  return (
    <Section
      title={t("usage.breakdown")}
      action={
        <Tabs selectedKey={group} onSelectionChange={(k) => setGroup(k as Group)}>
          <TabList label={t("usage.groupBy")}>
            <Tab id="model">{t("usage.byModel")}</Tab>
            <Tab id="agent">{t("usage.byAgent")}</Tab>
            <Tab id="project">{t("usage.byProject")}</Tab>
            <Tab id="account">{t("usage.byAccount")}</Tab>
            <Tab id="day">{t("usage.byDay")}</Tab>
          </TabList>
        </Tabs>
      }
    >
      <table className="w-full text-left">
        <thead className="text-sm text-muted">
          <tr className="border-b border-subtle">
            <th className="py-2.5 font-normal">{heading}</th>
            <th className="py-2.5 text-right font-normal">{t("usage.metricCost")}</th>
            <th className="py-2.5 text-right font-normal">{t("usage.share")}</th>
            <th className="py-2.5 text-right font-normal">{t("usage.tokens")}</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {groups.map((g) => (
            <tr key={g.key} className="border-b border-subtle last:border-0">
              <td className="py-3">
                <span className="flex min-w-0 items-center gap-2.5">
                  {g.icon && <ProviderIcon provider={g.icon} size={16} />}
                  <span className="truncate">{g.label}</span>
                </span>
              </td>
              <td className="py-3 text-right">{g.cost ? formatCost(g.cost) : "—"}</td>
              <td className="py-3 text-right text-secondary">{total ? formatPercent(g.value / total) : "—"}</td>
              <td className="py-3 text-right">{formatCompact(g.tokens)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  )
}

// Opening Usage reads every signed-in subscription's limits (the server caches for 4 min). One at a time:
// the mutation atom is shared, so a second call would abort the first.
function useReadOnOpen(subscriptions: ReadonlyArray<ProviderAccount>) {
  const read = useMutation(mutations.readLimits)
  const ids = subscriptions
    .filter((a) => a.loggedIn)
    .map((a) => a.id)
    .join(",")
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
        <ProviderIcon provider={a.provider} size={18} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium">{a.label}</span>
          <span className="truncate text-sm text-muted">{a.usage ? t("usage.readAgo", { age: formatAge(a.usage.readAt) }) : (a.identity ?? "")}</span>
        </span>
        <IconButton label={t("usage.refresh")} isDisabled={reading || !a.loggedIn} onPress={refresh}>
          <ChartColumn />
        </IconButton>
      </div>
      <LimitWindows account={a} />
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
        <Rows>
          {top.map((turn) => (
            <div key={turn.turnId} className="relative flex items-center gap-3 py-2.5">
              <RowHit label={chatTitle({ title: turn.chatTitle })} onPress={() => go({ view: "chat", id: turn.chatId })} />
              <ProviderIcon provider={splitModel(turn.model).provider} size={16} className="pointer-events-none relative" />
              <span className="pointer-events-none relative flex min-w-0 flex-1 flex-col text-left">
                <span className="truncate">{chatTitle({ title: turn.chatTitle })}</span>
                <span className="truncate text-sm text-muted">{`${modelLabel(turn.model)} · ${formatCompact(turn.inputTokens + turn.outputTokens)} · ${formatAge(turn.at)}`}</span>
              </span>
              <span className="pointer-events-none relative shrink-0 text-right tabular-nums">
                {formatCost(turn.cost)}
                {turn.billing === "subscription" && <span className="block text-sm text-dim">{t("usage.apiEquivalent")}</span>}
              </span>
            </div>
          ))}
        </Rows>
      )}
    </Section>
  )
}
