// Today (spec 012): the morning brief. What came in from routines since the last day start: what needs the person
// (until opened), what routines found (one line each, newest first), and how many runs found nothing (one line).
// Built on the server from the runs, without a model. Opening an item goes to its reply and marks it read.
import type { RoutineRun } from "@zorel/contracts"
import { formatTime, t } from "@zorel/i18n"
import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import { agentsAtom, mutations, routinesAtom, todayAtom, useInvalidate, useList, useMutation, useReading } from "../client.ts"
import { agentTone } from "../labels.ts"
import { go } from "../state.ts"
import { AgentAvatar, Column, Dot, EmptyState, ListRow, Rows, Screen, Section, Sun } from "@/ui"

export function TodayView() {
  const today = AsyncResult.getOrElse(useAtomValue(todayAtom), () => undefined)
  const routines = useReading(routinesAtom).items
  const agents = useList(agentsAtom)
  const read = useMutation(mutations.readToday)
  const invalidate = useInvalidate()
  const open = (run: RoutineRun) => {
    const r = routines.find((x) => x.id === run.routineId)
    if (!r) return
    if (!run.readAt) void read({ payload: { runIds: [run.id] } }).then(() => invalidate(["today"]))
    // A flow run (spec 013) opens step by step; a spec 012 run opens its reply in the chat.
    go(run.version != null ? { view: "routine-run", id: r.id, runId: run.id } : { view: "chat", id: r.chatId })
  }
  const row = (run: RoutineRun) => {
    const r = routines.find((x) => x.id === run.routineId)
    const agent = agents.find((a) => a.id === r?.agentId)
    return (
      <ListRow
        key={run.id}
        label={`${r?.name ?? ""}: ${run.summary}`}
        icon={agent ? <AgentAvatar id={agent.id} name={agent.name} tone={agentTone(agent, agents)} size={28} /> : undefined}
        title={run.summary || t("routines.runs.outcome.something")}
        hint={[agent?.name, r?.name, formatTime(run.createdAt)].filter(Boolean).join(" · ")}
        aside={run.readAt ? undefined : <Dot tone={run.outcome === "needs" ? "warning" : "muted"} />}
        onPress={() => open(run)}
      />
    )
  }
  const empty = today && !today.needs.length && !today.found.length && !today.quiet
  return (
    <Screen title={t("today.title")} subtitle={today ? t("today.since", { when: formatTime(today.from) }) : t("today.hint")}>
      <Column>
        {empty && <EmptyState scene="calmDay" icon={<Sun />} title={t("today.empty")} hint={t("today.hint")} />}
        {!!today?.needs.length && (
          <Section title={t("today.needs", { count: today.needs.length })} description={t("today.needsHint")}>
            <Rows>{today.needs.map(row)}</Rows>
          </Section>
        )}
        {!!today?.found.length && (
          <Section title={t("today.found", { count: today.found.length })} description={t("today.foundHint")}>
            <Rows>{today.found.map(row)}</Rows>
          </Section>
        )}
        {!!today?.quiet && (
          <Rows>
            <ListRow label={t("today.quiet", { count: today.quiet })} title={t("today.quiet", { count: today.quiet })} onPress={() => go({ view: "routines" })} />
          </Rows>
        )}
      </Column>
    </Screen>
  )
}
