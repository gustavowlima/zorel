// One routine run, step by step (spec 013, the RunTrace board): what each step got and gave, how long it took, how
// many tries, and how it ended. A write that may have gone out when Zorel stopped asks here: send again, skip or stop.
import type { FlowGraph, RunStep } from "@zorel/contracts"
import { formatDuration, formatTime, t } from "@zorel/i18n"
import { useAtomRefresh, useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import { useEffect, useState } from "react"
import { flowVersionAtom, mutations, routinesAtom, runDetailAtom, serversAtom, useInvalidate, useList, useMutation, useReading } from "../client.ts"
import { go } from "../state.ts"
import { ArrowLeft, Badge, Button, CodeBlock, Column, Dialog, EmptyState, IconButton, MessageCircle, Notice, Rows, Screen, Section, ShieldAlert, Spinner, Workflow } from "@/ui"
import { KindTile, nodeDetail, nodeTitle } from "./flow-kinds.tsx"

const LIVE_MS = 2000 // a run still going is read again this often
const OUTCOME_TONE = { nothing: "neutral", something: "accent", needs: "warning" } as const

export function RunTraceView({ routineId, runId }: { routineId: string; runId: string }) {
  const detail = AsyncResult.getOrElse(useAtomValue(runDetailAtom(routineId, runId)), () => undefined)
  const refresh = useAtomRefresh(runDetailAtom(routineId, runId))
  const routine = useReading(routinesAtom).items.find((r) => r.id === routineId)
  const live = detail?.run.state !== "done"
  useEffect(() => {
    if (!live) return
    const timer = setInterval(refresh, LIVE_MS)
    return () => clearInterval(timer)
  }, [live, refresh])
  if (!detail || !routine)
    return (
      <Screen title={t("flows.run.title")}>
        <Column>{detail === undefined ? <Spinner /> : <EmptyState title={t("notFound.title")} />}</Column>
      </Screen>
    )
  const { run, steps } = detail
  const took = run.startedAt ? (run.endedAt ?? Date.now()) - run.startedAt : undefined
  return (
    <Screen
      title={
        <span className="flex items-center gap-2">
          <IconButton label={t("flows.run.back")} onPress={() => go({ view: "routines" })}>
            <ArrowLeft />
          </IconButton>
          {routine.name}
        </span>
      }
      subtitle={t("flows.run.of", { at: formatTime(run.createdAt) })}
      actions={
        <>
          {run.outcome && <Badge tone={OUTCOME_TONE[run.outcome]}>{t(`routines.runs.outcome.${run.outcome}`)}</Badge>}
          <Button size="sm" variant="secondary" onPress={() => go({ view: "chat", id: routine.chatId })}>
            <MessageCircle />
            {t("routines.openChat")}
          </Button>
          <Button size="sm" variant="secondary" onPress={() => go({ view: "routine-flow", id: routine.id })}>
            <Workflow />
            {t("flows.edit")}
          </Button>
        </>
      }
    >
      <Column>
        <Rows className="grid grid-cols-2 divide-y-0 py-3 sm:grid-cols-4">
          <Fact label={t("flows.run.started")} value={run.startedAt ? formatTime(run.startedAt) : t("routines.runs.queued")} />
          <Fact label={t("flows.run.took")} value={took !== undefined ? formatDuration(took) : "—"} />
          <Fact label={t("flows.run.cost")} value={run.cost ? `$${run.cost.toFixed(3)}` : "—"} />
          <Fact label={t("flows.run.version")} value={run.version ? `v${run.version}` : "—"} />
        </Rows>
        {run.summary && <p className="text-muted">{run.summary}</p>}
        <Section title={t("flows.run.steps")} description={t("flows.run.stepsHint")}>
          {run.version ? <Steps routineId={routineId} runId={runId} version={run.version} steps={steps} /> : <p className="text-muted">{t("flows.run.noSteps")}</p>}
        </Section>
        {run.version && live && steps.length > 0 && <p className="text-sm text-dim">{t("flows.run.resume", { n: steps.length - 1 })}</p>}
      </Column>
    </Screen>
  )
}

const Fact = ({ label, value }: { label: string; value: string }) => (
  <div className="flex min-w-0 flex-col gap-0.5">
    <span className="text-sm text-dim">{label}</span>
    <span className="truncate tabular-nums">{value}</span>
  </div>
)

function Steps({ routineId, runId, version, steps }: { routineId: string; runId: string; version: number; steps: ReadonlyArray<RunStep> }) {
  const graph = AsyncResult.getOrElse(useAtomValue(flowVersionAtom(routineId, version)), () => undefined)?.graph
  if (!steps.length) return <p className="text-muted">{t("flows.run.notYet")}</p>
  return (
    <Rows className="py-1">
      {steps.map((s, i) => (
        <StepItem key={s.id} routineId={routineId} runId={runId} step={s} graph={graph} n={i} />
      ))}
    </Rows>
  )
}

const STATE_TONE: Record<RunStep["state"], "neutral" | "accent" | "success" | "warning" | "danger"> = {
  running: "accent",
  done: "success",
  failed: "danger",
  skipped: "neutral",
  waiting: "warning",
  uncertain: "warning"
}

function StepItem({ routineId, runId, step, graph, n }: { routineId: string; runId: string; step: RunStep; graph: FlowGraph | undefined; n: number }) {
  const servers = useList(serversAtom)
  const node = graph?.nodes.find((x) => x.id === step.nodeId)
  const took = step.endedAt ? formatDuration(step.endedAt - step.startedAt) : undefined
  const meta = [formatTime(step.startedAt), took, step.attempt > 1 ? t("flows.run.tries", { count: step.attempt }) : undefined, step.branch === "yes" || step.branch === "no" ? t(`flows.branch.${step.branch}`) : undefined].filter(Boolean).join(" · ")
  return (
    <div className="flex gap-3 py-3">
      {node ? <KindTile kind={node.kind} size="sm" /> : <span className="size-6" />}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline gap-x-2.5">
          <span className="font-medium">{[n > 0 && n, node ? nodeTitle(node) : step.nodeId].filter(Boolean).join(" · ")}</span>
          <span className="text-sm text-dim tabular-nums">{meta}</span>
          <span className="ml-auto">
            <Badge tone={STATE_TONE[step.state]}>{t(`flows.state.${step.state}`)}</Badge>
          </span>
        </div>
        {node && <span className="text-sm text-muted">{nodeDetail(node, servers)}</span>}
        {step.error && step.state !== "uncertain" && <p className="text-sm text-danger">{step.error}</p>}
        {step.state === "waiting" && (
          <Button size="sm" variant="ghost" className="self-start" onPress={() => go({ view: "inbox" })}>
            {t("flows.run.waiting")}
          </Button>
        )}
        {step.state === "uncertain" && <Uncertain routineId={routineId} runId={runId} stepId={step.id} />}
        {step.output && <Output routineId={routineId} runId={runId} step={step} />}
      </div>
    </div>
  )
}

const PREVIEW_LINES = 8
function Output({ routineId, runId, step }: { routineId: string; runId: string; step: RunStep }) {
  const fetchAll = useMutation(mutations.stepOutput)
  const [all, setAll] = useState<string>()
  const lines = step.output.split("\n")
  const cut = lines.length > PREVIEW_LINES || step.full
  return (
    <div className="flex flex-col gap-1">
      <CodeBlock code={lines.slice(0, PREVIEW_LINES).join("\n")} />
      {cut && (
        <Button size="sm" variant="ghost" className="self-start" onPress={() => void fetchAll({ params: { id: routineId, runId, stepId: step.id } }).then((r) => setAll(r.text))}>
          {t("flows.run.showAll")}
        </Button>
      )}
      <Dialog title={t("flows.run.output")} size="lg" isOpen={all !== undefined} onOpenChange={(o) => !o && setAll(undefined)}>
        {() => <CodeBlock code={all ?? ""} />}
      </Dialog>
    </div>
  )
}

// A write that may have gone out (FR-012): never sent again without the person's choice.
function Uncertain({ routineId, runId, stepId }: { routineId: string; runId: string; stepId: string }) {
  const resolve = useMutation(mutations.resolveStep)
  const invalidate = useInvalidate()
  const [error, setError] = useState(false)
  const choose = (choice: "again" | "skip" | "stop") =>
    void resolve({ params: { id: routineId, runId }, payload: { stepId, choice }, reactivityKeys: ["routines", "today"] })
      .then(() => invalidate(["routines"]))
      .catch(() => setError(true))
  return (
    <Notice
      icon={<ShieldAlert />}
      title={t("flows.uncertain.title")}
      action={
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" onPress={() => choose("again")}>
            {t("flows.uncertain.again")}
          </Button>
          <Button size="sm" variant="secondary" onPress={() => choose("skip")}>
            {t("flows.uncertain.skip")}
          </Button>
          <Button size="sm" variant="ghost" onPress={() => choose("stop")}>
            {t("flows.uncertain.stop")}
          </Button>
        </div>
      }
    >
      {error ? t("flows.uncertain.failed") : t("flows.uncertain.body")}
    </Notice>
  )
}
