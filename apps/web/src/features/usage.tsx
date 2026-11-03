// Usage (prototype "Usage", first part of ARCHITECTURE §10.2): what the agents used, from Zero's own turn
// records: totals for the range and where it went, by project, agent, model or account. Limit windows
// and cost per account arrive with failover (phase 2c).
import type { UsageRow } from "@zero/contracts"
import { formatCompact, formatDuration, formatNumber, formatPercent, t } from "@zero/i18n"
import { useState } from "react"
import { accountsAtom, agentsAtom, projectsAtom, usageAtom, useList } from "../client.ts"
import { modelLabel, splitModel } from "../labels.ts"
import { go } from "../state.ts"
import { Button, ChartColumn, EmptyState, Meter, ProviderIcon, Screen, Section, Tab, TabList, Tabs } from "@/ui"

type Group = "project" | "agent" | "model" | "account"
const RANGES = [7, 30] as const

export function UsageView() {
  const rows = useList(usageAtom)
  const projects = useList(projectsAtom)
  const agents = useList(agentsAtom)
  const accounts = useList(accountsAtom)
  const [days, setDays] = useState<(typeof RANGES)[number]>(7)
  const [group, setGroup] = useState<Group>("project")

  const since = Date.now() - days * 86_400_000
  const inRange = rows.filter((r) => r.day + 86_400_000 > since)
  const sum = (f: (r: UsageRow) => number) => inRange.reduce((n, r) => n + f(r), 0)
  const turns = sum((r) => r.turns)
  const input = sum((r) => r.inputTokens)
  const output = sum((r) => r.outputTokens)
  const cached = sum((r) => r.cachedTokens)
  const duration = sum((r) => r.durationMs)

  const labelOf = (r: UsageRow): { key: string; label: string; icon?: string } => {
    if (group === "project") return { key: r.projectId ?? "", label: r.projectId ? (projects.find((p) => p.id === r.projectId)?.name ?? t("usage.removed")) : t("usage.looseChats") }
    if (group === "agent") return { key: r.agentId ?? "", label: r.agentId ? (agents.find((a) => a.id === r.agentId)?.name ?? t("usage.removed")) : t("usage.noAgent") }
    if (group === "model") return { key: r.model, label: modelLabel(r.model), icon: splitModel(r.model).provider }
    const account = accounts.find((a) => a.id === r.accountId)
    return { key: r.accountId ?? "", label: account?.label ?? (r.accountId ? t("usage.removed") : t("usage.defaultAccount")), icon: account?.provider ?? splitModel(r.model).provider }
  }
  const groups = [...inRange.reduce((map, r) => {
    const g = labelOf(r)
    const prev = map.get(g.key)
    map.set(g.key, { ...g, tokens: (prev?.tokens ?? 0) + r.inputTokens + r.outputTokens, turns: (prev?.turns ?? 0) + r.turns })
    return map
  }, new Map<string, { key: string; label: string; icon?: string; tokens: number; turns: number }>()).values()].sort((a, b) => b.tokens - a.tokens)
  const total = groups.reduce((n, g) => n + g.tokens, 0)

  return (
    <Screen
      title={t("usage.title")}
      subtitle={t("usage.subtitle")}
      actions={
        <Tabs selectedKey={String(days)} onSelectionChange={(k) => setDays(Number(k) as (typeof RANGES)[number])}>
          <TabList label={t("usage.range")}>
            {RANGES.map((d) => (
              <Tab key={d} id={String(d)}>
                {t("usage.days", { count: d })}
              </Tab>
            ))}
          </TabList>
        </Tabs>
      }
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-7 py-7">
        {turns === 0 ? (
          <EmptyState icon={<ChartColumn />} title={t("usage.empty")} />
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-subtle bg-subtle sm:grid-cols-4">
              <Stat label={t("usage.turns")} value={formatNumber(turns)} />
              <Stat label={t("usage.tokensIn")} value={formatCompact(input)} />
              <Stat label={t("usage.tokensOut")} value={formatCompact(output)} />
              <Stat label={t("usage.cacheHit")} value={input ? formatPercent(cached / input) : "—"} />
            </dl>
            <Section
              title={t("usage.whereItWent")}
              description={`${t("usage.avgTurn")}: ${formatDuration(duration / turns)}`}
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
                    <Meter value={total ? g.tokens / total : 0} label={g.label} className="col-span-5" />
                    <span className="col-span-3 text-right text-sm text-muted tabular-nums">
                      {formatCompact(g.tokens)} · {formatPercent(total ? g.tokens / total : 0)}
                    </span>
                  </div>
                ))}
              </div>
            </Section>
          </>
        )}
        <Section
          title={t("usage.accounts")}
          action={
            <Button size="sm" variant="ghost" onPress={() => go({ view: "settings", tab: "accounts" })}>
              {t("usage.manage")}
            </Button>
          }
        >
          <div className="flex flex-col">
            {accounts.map((a) => (
              <div key={a.id} className="flex items-center gap-3 border-b border-subtle py-3 last:border-0">
                <ProviderIcon provider={a.provider} size={18} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{a.label}</span>
                  <span className="truncate text-sm text-muted">{a.loggedIn ? (a.identity ?? t("accounts.signedIn")) : t("accounts.signedOut")}</span>
                </span>
                <span className="text-sm text-muted tabular-nums">{formatCompact(inRange.filter((r) => r.accountId === a.id || (a.isDefault && !r.accountId && splitModel(r.model).provider.startsWith(a.provider))).reduce((n, r) => n + r.inputTokens + r.outputTokens, 0))}</span>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </Screen>
  )
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="flex flex-col gap-1 bg-canvas px-4 py-3.5">
    <dt className="text-sm text-muted">{label}</dt>
    <dd className="text-lg font-semibold tabular-nums">{value}</dd>
  </div>
)
