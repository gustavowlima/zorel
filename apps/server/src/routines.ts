// Routines (ARCHITECTURE §13, phase 7; spec 012): an agent's recurring or triggered work. A routine owns a chat; each
// run is a message in it, sent through the runtime like yours, so the agent answers with its tools, approvals and
// memory as usual, and each run is a row in routine_runs (its trigger, outcome, report, delivery).
// - Runs come from the schedule (cron in the person's zone, checked every 30 s, catching up once after a sleep),
//   "Run now", the person's first activity of the day, the routine's webhook, or a watched connector.
// - Outside events (webhook, connector) wait in a queue (20 at most) while a run is going; a scheduled run that
//   finds the chat busy is skipped, so a catch-up never piles up.
// - A watched connector may be checked first by a small model: no agent turn when nothing needs doing.
// - The agent ends with "Outcome: …" (routine-runs.ts): nothing new stays quiet, something new is told per the
//   routine's settings (or held for the brief in quiet hours), needs you is told at once.
import type { RoutineChannel, RoutineOutcome } from "@zorel/contracts"
import type { Notice } from "@zorel/contracts/events"
import { Effect, Layer, PubSub, Schedule, Stream } from "effect"
import { ask, type DataDir } from "./chat.ts"
import { DELIVER_PREFIX, deliverToConnector, type FlowHooks, onFlowTurn, recoverDeliveries, resumeFlow, runFlow } from "./flows.ts"
import { type RoutineRow, type RunRow, Store } from "./db.ts"
import { cheapModel, type Engines } from "./engines.ts"
import { dayStartDue, inQuiet, localDate, localMinutes, nextScheduled, outcomeOf, REPORT_MAX, shouldTell, todayOf } from "./routine-runs.ts"
import { type FinishedTurn, Runtime } from "./runtime.ts"
import { filterItems, freshItems, nextRun, parseTriage, runText, triageText, watchItems } from "./schedule.ts"
import type { Secrets } from "./secrets.ts"
import { sayToPaired } from "./telegram.ts"
import { activeOn, briefFrom, profileOf } from "./time-profile.ts"
import { resultText, Tools } from "./tools.ts"

const TICK = "30 seconds"
const QUEUE_MAX = 20 // outside events waiting per routine; past it, refused
const TRIAGE_TIMEOUT = "20 seconds"
const KEEP_DAYS = 90 // run history kept (the newest 50 of each routine stay whatever their age)
const RUN_PREFIX = "routine:"

// What routines tell the person; the RPC `notices` stream reads it. ponytail: one process, so one module-level hub.
export const notices = Effect.runSync(PubSub.unbounded<Notice>())

type Env = Store | Runtime | DataDir | Engines | Secrets | Tools
type Started = "started" | "queued" | "skipped" | "failed" | "missing" | "full"
const TRIGGERS: Record<string, RunRow["trigger"]> = { now: "now", hook: "webhook", watch: "watch", day: "day_start" }
const triggerOf = (key: string): RunRow["trigger"] => TRIGGERS[key.split("-")[0]!] ?? "schedule"

// One run. `key` names its trigger and makes a scheduled run idempotent per due time. A payload (a webhook's body, a
// watched connector's new items) makes it an outside run: queued, and working at "ask" (spec 011).
export const runRoutine = (id: string, key: string, payload?: unknown, label?: string) =>
  Effect.gen(function* () {
    const store = yield* Store
    const runtime = yield* Runtime
    const r = yield* store.routine(id)
    if (!r) return "missing" as Started
    const at = Date.now()
    // An archived (or gone) agent runs no routine: nothing answers without an agent (restoring it brings them back).
    const owner = yield* store.agent(r.agentId)
    if (!owner || owner.archivedAt) {
      yield* store.updateRoutine(r.id, { lastRunAt: at, lastStatus: "skipped" })
      return "skipped" as Started
    }
    const trigger = triggerOf(key)
    if (payload !== undefined) {
      if ((yield* store.countQueued(r.id)) >= QUEUE_MAX) {
        yield* store.addRun({ routineId: r.id, trigger, state: "done", label: label ?? null }).pipe(
          Effect.flatMap((run) => store.updateRun(run.id, { summary: `Refused: ${QUEUE_MAX} events were already waiting`, deliveryNote: "refused", endedAt: at }))
        )
        return "full" as Started
      }
      yield* store.addRun({ routineId: r.id, trigger, state: "queued", payload, label: label ?? null })
      yield* dispatch(r.id)
      return "queued" as Started
    }
    if (runtime.busy(r.chatId) || (yield* store.runningRun(r.id))) {
      yield* store.updateRoutine(r.id, { lastRunAt: at, lastStatus: "skipped" })
      return "skipped" as Started
    }
    const run = yield* store.addRun({ routineId: r.id, trigger, state: "running" })
    return yield* start(r, run)
  })

// Starts a run: the cheap check first (a watched connector with "look first"), then the message to the agent with
// the previous run's report.
const start = (r: RoutineRow, run: RunRow) =>
  Effect.gen(function* () {
    const store = yield* Store
    const runtime = yield* Runtime
    const at = Date.now()
    yield* store.updateRun(run.id, { state: "running", startedAt: at })
    if (r.lookFirst && run.payload != null && !(yield* triage(r, run))) return "started" as Started
    // Spec 013: a routine with a flow runs it, on the version current now (kept on the run).
    if (r.version !== null) {
      const pinned = (yield* store.updateRun(run.id, { version: r.version })) ?? run
      yield* store.updateRoutine(r.id, { lastRunAt: at, lastStatus: "started" })
      yield* Effect.forkDetach(runFlow(r, pinned, hooksOf(r, pinned)))
      return "started" as Started
    }
    const previous = yield* store.lastReport(r.id)
    const zone = (yield* profileOf(store)).zone
    const when = previous ? new Date(previous.createdAt).toLocaleString("en-US", { timeZone: zone, dateStyle: "medium", timeStyle: "short" }) : ""
    const text = runText(r.name, r.prompt, run.payload ?? undefined, run.label ?? undefined, previous ? { at: when, report: previous.report } : undefined)
    const sent = yield* runtime.send({ chatId: r.chatId, clientId: `${RUN_PREFIX}${run.id}`, text }, { outside: run.payload != null }).pipe(
      Effect.map((s) => s.turnId),
      Effect.catchCause((c) => Effect.logWarning("routine run failed to start", { routineId: r.id, cause: String(c) }).pipe(Effect.as(undefined)))
    )
    yield* store.updateRoutine(r.id, { lastRunAt: at, lastStatus: sent ? "started" : "failed" })
    if (!sent) {
      yield* finish(r, run, { outcome: "needs", summary: "The run couldn't start", report: "" })
      return "failed" as Started
    }
    yield* store.updateRun(run.id, { turnId: sent })
    return "started" as Started
  })

// The cheap check (R6): true = start the agent. Any failure starts it: an event is never lost to the check.
const triage = (r: RoutineRow, run: RunRow) =>
  Effect.gen(function* () {
    const store = yield* Store
    const agent = yield* store.agent(r.agentId)
    if (!agent) return true
    const result = yield* ask(cheapModel(agent.model), triageText(r.prompt, run.payload)).pipe(
      Effect.timeout(TRIAGE_TIMEOUT),
      Effect.catchCause((c) => Effect.logWarning("routine check failed: the agent runs", { routineId: r.id, cause: String(c) }).pipe(Effect.as(undefined)))
    )
    const verdict = result && !result.error ? parseTriage(result.text) : undefined
    if (result?.tokens) yield* store.updateRun(run.id, { triageTokens: result.tokens })
    if (!verdict || verdict.act) return true
    yield* finish(r, run, { outcome: "nothing", summary: `Checked: ${verdict.why || "nothing to do"}`, report: "" })
    return false
  })

// Ends a run, tells the person (or not) and starts the next one waiting.
const finish = (r: RoutineRow, run: RunRow, end: { outcome: RoutineOutcome; summary: string; report: string; messageId?: string | null; cost?: number | null }) =>
  Effect.gen(function* () {
    const store = yield* Store
    const done = yield* store.updateRun(run.id, { state: "done", outcome: end.outcome, summary: end.summary, report: end.report.slice(0, REPORT_MAX), messageId: end.messageId ?? null, cost: end.cost ?? null, endedAt: Date.now() })
    if (done && !done.deliveredAt && !done.held) yield* deliver(r, done)
    yield* dispatch(r.id)
  })

// How a flow run ends or waits: the same finish and delivery as any run.
const hooksOf = (r: RoutineRow, run: RunRow): FlowHooks => ({
  finish: (end) => finish(r, run, end),
  needs: (summary) =>
    Effect.gen(function* () {
      const marked = yield* (yield* Store).updateRun(run.id, { outcome: "needs", summary })
      if (marked) yield* deliver(r, marked)
    })
})

// A write that may have gone out (spec 013): the person sends it again, skips it (the flow goes on) or stops the run.
export const resolveStep = (runId: string, stepId: string, choice: "again" | "skip" | "stop") =>
  Effect.gen(function* () {
    const store = yield* Store
    const run = yield* store.routineRun(runId)
    const step = yield* store.runStep(stepId)
    const r = run ? yield* store.routine(run.routineId) : undefined
    if (!run || !r || step?.runId !== runId || step.state !== "uncertain") return false
    // A send of the result (deliver:<n>): the run is over; only the send is retried, skipped or dropped.
    if (step.nodeId.startsWith(DELIVER_PREFIX)) {
      if (choice === "again") {
        const again = (yield* store.updateRunStep(step.id, { state: "running", attempt: step.attempt + 1, mayHaveWritten: false, error: null })) ?? step
        yield* Effect.forkDetach(deliverToConnector(r, run, Number(step.nodeId.slice(DELIVER_PREFIX.length)), again))
      } else yield* store.updateRunStep(step.id, { state: choice === "skip" ? "skipped" : "failed", error: choice === "stop" ? "Not sent: you stopped it" : null, endedAt: Date.now() })
      return true
    }
    const hooks = hooksOf(r, run)
    if (choice === "stop") {
      yield* store.updateRunStep(step.id, { state: "failed", error: "Stopped by you", endedAt: Date.now() })
      yield* hooks.finish({ outcome: "nothing", summary: "Stopped by you", report: "" })
      return true
    }
    yield* store.updateRunStep(step.id, choice === "again" ? { state: "running", attempt: step.attempt + 1, mayHaveWritten: false, error: null } : { state: "skipped", endedAt: Date.now() })
    yield* store.updateRun(run.id, { outcome: null })
    yield* Effect.forkDetach(runFlow(r, run, hooks))
    return true
  })

// ---------- telling the person ----------
const notice = (r: RoutineRow, run: RunRow) =>
  PubSub.publish(notices, { id: `${run.id}:${run.outcome}`, kind: "routine" as const, runId: run.id, routineId: r.id, chatId: r.chatId, title: r.name, text: run.summary || run.report.slice(0, 200), outcome: run.outcome ?? "something" })
// Each channel a result can go to; a channel that can't deliver says why (the run keeps the note).
const CHANNELS: Record<RoutineChannel, (r: RoutineRow, run: RunRow) => Effect.Effect<string | undefined, never, Store | Secrets>> = {
  notify: (r, run) => notice(r, run).pipe(Effect.as(undefined)),
  telegram: (r, run) =>
    sayToPaired(`${r.name}: ${run.summary}${run.report && run.report !== run.summary ? `\n\n${run.report}` : ""}`).pipe(
      Effect.flatMap(({ sent }) => (sent ? Effect.succeed(undefined) : notice(r, run).pipe(Effect.as("telegram not paired"))))
    ),
  page: (r, run) =>
    Effect.gen(function* () {
      const store = yield* Store
      if (run.outcome !== "something" || !run.report) return undefined
      const page = r.delivery.pageId ? yield* store.page(r.delivery.pageId) : undefined
      if (!page) return "page missing"
      yield* store.savePage({ id: page.id, scope: page.scope, title: page.title, body: run.report }, "routine")
      return undefined
    })
}
const deliver = (r: RoutineRow, run: RunRow) =>
  Effect.gen(function* () {
    const store = yield* Store
    if (!run.outcome) return
    const profile = yield* profileOf(store)
    const telling = shouldTell(run.outcome, r.tell, r.urgent, inQuiet(profile.quiet, Date.now(), profile.zone))
    if (telling === "skip") return
    if (telling === "hold") return yield* store.updateRun(run.id, { held: true }).pipe(Effect.asVoid)
    const notes: string[] = []
    for (const ch of r.delivery.channels.length ? r.delivery.channels : (["notify"] as const)) {
      const note = yield* CHANNELS[ch](r, run).pipe(Effect.catchCause((c) => Effect.logWarning("routine delivery failed", { routineId: r.id, channel: ch, cause: String(c) }).pipe(Effect.as(`${ch} failed`))))
      if (note) notes.push(note)
    }
    yield* store.updateRun(run.id, { deliveredAt: Date.now(), deliveryNote: notes.join(", ") || null })
    // Connectors (spec 013) on their own: a post may wait for the person's OK, and the run's end doesn't wait for it.
    for (const [i] of (r.delivery.connectors ?? []).entries()) yield* Effect.forkDetach(deliverToConnector(r, run, i))
  })

// ---------- the queue ----------
// ponytail: an in-process guard; one server owns the database.
const dispatching = new Set<string>()
const dispatch = (routineId: string): Effect.Effect<void, never, Env> =>
  Effect.gen(function* () {
    if (dispatching.has(routineId)) return
    const store = yield* Store
    const runtime = yield* Runtime
    const r = yield* store.routine(routineId)
    // One run at a time per routine. A chat busy with the person's turn is fine: the runtime queues this one behind.
    // Off: what waits stays queued until it is turned on again.
    if (!r?.enabled || runtime.paused() || (yield* store.runningRun(r.id))) return
    const next = (yield* store.routineRunsIn("queued")).find((x) => x.routineId === r.id)
    if (!next) return
    dispatching.add(routineId)
    yield* start(r, next).pipe(Effect.ensuring(Effect.sync(() => dispatching.delete(routineId))))
  })

// A run's own turn ended: its outcome from the last line (the line comes off the saved reply), then delivery.
const onFinished = (t: FinishedTurn) =>
  Effect.gen(function* () {
    if (!t.clientId?.startsWith(RUN_PREFIX)) return
    const store = yield* Store
    const run = yield* store.routineRun(t.clientId.slice(RUN_PREFIX.length))
    if (!run || run.state === "done") return
    const r = yield* store.routine(run.routineId)
    if (!r) return
    const reply = (yield* store.messageText(t.messageId)) ?? ""
    const read = outcomeOf(reply)
    if (read.marked) yield* store.setMessageText(t.messageId, read.text)
    const failed = t.state !== "completed"
    yield* finish(r, run, {
      outcome: failed ? "needs" : read.outcome,
      summary: failed ? (t.state === "interrupted" ? "The run was stopped" : `The run failed: ${t.error ?? "unknown error"}`.slice(0, 200)) : read.summary,
      report: read.text,
      messageId: t.messageId,
      cost: t.cost
    })
  })

// A routine's chat waits for the person (an approval, a question): the run needs them now, not when it ends.
const onWaiting = (chatId: string, label: string) =>
  Effect.gen(function* () {
    const store = yield* Store
    const r = (yield* store.routines()).find((x) => x.chatId === chatId)
    const run = r ? yield* store.runningRun(r.id) : undefined
    if (!r || !run || run.outcome === "needs") return
    const marked = yield* store.updateRun(run.id, { outcome: "needs", summary: label || "Waiting for you" })
    if (marked) yield* deliver(r, marked)
  })

// ---------- the clock ----------
// Every tick: each due routine runs once (a missed slot while asleep runs once, not once per slot), then gets
// its next time in the person's zone.
export const tick = Effect.gen(function* () {
  const store = yield* Store
  if ((yield* Runtime).paused()) return // paused: due routines run after resume (they stay due)
  const now = Date.now()
  const zone = (yield* profileOf(store)).zone
  for (const r of yield* store.dueRoutines(now)) {
    yield* runRoutine(r.id, String(r.nextRunAt)).pipe(Effect.catchCause((c) => Effect.logWarning("routine run failed", { routineId: r.id, cause: String(c) })))
    // A one-time schedule (spec 013) is done after its run: the routine turns off.
    if (r.schedule?.kind === "once") {
      yield* store.updateRoutine(r.id, { nextRunAt: null, enabled: false })
      continue
    }
    const next = r.cron ? nextRun(r.cron, new Date(now), zone) : r.schedule ? { at: nextScheduled(r.schedule, zone, now) } : { at: null }
    yield* store.updateRoutine(r.id, { nextRunAt: "at" in next ? next.at : null })
  }
  for (const id of new Set((yield* store.routineRunsIn("queued")).map((x) => x.routineId))) yield* dispatch(id)
})

// "When my day starts" routines: once a local day, at the first activity or the cut-off. With it, the brief goes to
// Telegram when a routine delivers there.
const BRIEF_SENT = "briefSentOn"
const dayStarts = Effect.gen(function* () {
  const store = yield* Store
  if ((yield* Runtime).paused()) return
  const now = Date.now()
  const p = yield* profileOf(store)
  const today = localDate(now, p.zone)
  const activeToday = yield* activeOn(store, today)
  for (const r of yield* store.dayStartRoutines())
    if (dayStartDue({ ranOn: r.dayRanOn, today, activeToday, nowMinutes: localMinutes(now, p.zone), start: p.start })) {
      yield* store.updateRoutine(r.id, { dayRanOn: today })
      yield* runRoutine(r.id, `day-${today}`).pipe(Effect.catchCause((c) => Effect.logWarning("day-start routine failed", { routineId: r.id, cause: String(c) })))
    }
  if (!activeToday || (yield* store.preference(BRIEF_SENT)) === today) return
  yield* store.setPreference(BRIEF_SENT, today)
  const routines = yield* store.routines()
  if (!routines.some((r) => r.delivery.channels.includes("telegram"))) return
  const t = todayOf(yield* store.routineRunsBetween(yield* briefFrom(store, now), now), 0)
  const names = new Map(routines.map((r) => [r.id, r.name]))
  const lines = [...t.needs.map((x) => `• Needs you: ${names.get(x.routineId)}: ${x.summary}`), ...t.found.map((x) => `• ${names.get(x.routineId)}: ${x.summary}`)]
  if (lines.length) yield* sayToPaired([`Good morning. ${t.needs.length} need you, ${t.found.length} new, ${t.quiet} quiet.`, ...lines].join("\n"))
})

// Watched connectors: each one due polls its tool; new items become a queued run (with them in the message). Only a
// read tool is called, so polling never changes anything on the other side. A failed poll marks the routine failed
// and tries again next time; the items seen stay.
export const watches = Effect.gen(function* () {
  const store = yield* Store
  const { hub } = yield* Tools
  if ((yield* Runtime).paused()) return
  const now = Date.now()
  for (const r of yield* store.watchingRoutines()) {
    if (!r.watch || (r.watchAt && now - r.watchAt < Math.max(1, r.watchEvery) * 60_000)) continue
    const w = r.watch
    yield* store.updateRoutine(r.id, { watchAt: now })
    const server = yield* store.mcpServer(w.serverId)
    // Every channel it watches (spec 013: the same tool with other inputs), read in turn.
    const polled = yield* Effect.promise(async () => {
      if (!server?.enabled) return { error: "connector missing or off" }
      const tool = (await hub.tools(server)).find((t) => t.name === w.tool)
      if (!tool) return { error: `no tool ${w.tool}` }
      if (tool.cls !== "read") return { error: `${w.tool} isn't read-only` }
      const items: unknown[] = []
      for (const args of [w.args, ...(w.more ?? [])]) {
        const res = await hub.call(server, w.tool, { ...args })
        if (res.isError) return { error: resultText(res).slice(0, 200) }
        items.push(...watchItems(resultText(res)))
      }
      return { items }
    }).pipe(Effect.catchCause((c) => Effect.succeed({ error: String(c).slice(0, 200) })))
    if ("error" in polled) {
      yield* Effect.logWarning("routine watch failed", { routineId: r.id, error: polled.error })
      yield* store.updateRoutine(r.id, { lastRunAt: now, lastStatus: "failed" })
      continue
    }
    const { fresh, seen } = freshItems(r.watchSeen, polled.items)
    const wanted = filterItems(fresh, w.filter)
    const label = `New from ${server?.name ?? "the connector"} (${w.tool})`
    // Seen once queued (the run row keeps them): a full queue leaves them unseen, for the next poll. A message trigger
    // starts one run per message, one at a time (the queue).
    const batches = w.each ? wanted.map((item) => [item]) : wanted.length ? [wanted] : []
    let took = !batches.length // nothing new (or all filtered out): what's there now is seen
    for (const [i, batch] of batches.entries()) {
      const ran = yield* runRoutine(r.id, `watch-${now}-${i}`, batch, label)
      if (ran === "queued" || ran === "started") took = true
    }
    if (took) yield* store.updateRoutine(r.id, { watchSeen: seen })
  }
})

// Chats paused by usage limits: when the reset comes, they continue (once per reset time).
const resumes = Effect.gen(function* () {
  const store = yield* Store
  const runtime = yield* Runtime
  for (const c of yield* store.dueResumes(Date.now())) {
    yield* store.setResumeAt(c.id, null)
    yield* runtime
      .send({ chatId: c.id, clientId: `resume:${c.id}:${c.resumeAt}`.slice(0, 64), text: RESUME_TEXT })
      .pipe(Effect.catchCause((cause) => Effect.logWarning("resume after limit failed", { chatId: c.id, cause: String(cause) })))
  }
})
const RESUME_TEXT = "The usage limit has reset. Continue where you left off."

// Retention (FR-017), once a day. ponytail: the time is in memory, so a restart prunes again at once (harmless).
let prunedAt = 0
const prune = Effect.gen(function* () {
  if (Date.now() - prunedAt < 24 * 60 * 60_000) return
  prunedAt = Date.now()
  yield* (yield* Store).pruneRoutineRuns(Date.now() - KEEP_DAYS * 24 * 60 * 60_000)
})

// A server stopped mid-run: a run left "running" whose turn didn't end well is done ("needs you"), never repeated.
// A flow run (spec 013) resumes at its step instead (flows.ts resumeFlow).
const recover = Effect.gen(function* () {
  const store = yield* Store
  yield* recoverDeliveries
  for (const run of yield* store.routineRunsIn("running")) {
    if (run.version !== null) {
      const r = yield* store.routine(run.routineId)
      if (r) yield* Effect.forkDetach(resumeFlow(r, run, hooksOf(r, run)))
      continue
    }
    const turn = run.turnId ? yield* store.turnRow(run.turnId) : undefined
    if (turn?.state === "queued" || turn?.state === "running") continue // the runtime picks it up again
    const r = yield* store.routine(run.routineId)
    if (!r) continue
    if (turn?.state === "completed" && turn.messageId)
      yield* onFinished({ turnId: turn.id, chatId: turn.chatId, clientId: turn.clientId, state: "completed", messageId: turn.messageId, error: null, cost: null })
    else yield* finish(r, run, { outcome: "needs", summary: "Stopped by a restart", report: "" })
  }
})

export const RoutineScheduler = Layer.effectDiscard(
  Effect.gen(function* () {
    const runtime = yield* Runtime
    yield* recover.pipe(Effect.catchCause((c) => Effect.logWarning("routine recovery failed", String(c))))
    yield* Effect.forkScoped(
      runtime.finished.pipe(Stream.runForEach((t) => Effect.andThen(onFlowTurn(t), onFinished(t)).pipe(Effect.catchCause((c) => Effect.logWarning("routine run end failed", String(c))))))
    )
    // A routine's chat waiting for the person (an approval, a question): its run needs them now.
    yield* Effect.forkScoped(
      runtime.subscribeStatus.pipe(
        Stream.filter((s) => s.state === "waiting"),
        Stream.runForEach((s) => onWaiting(s.chatId, s.label).pipe(Effect.catchCause((c) => Effect.logWarning("routine wait failed", String(c)))))
      )
    )
    yield* Effect.forkScoped(
      Effect.all([tick, dayStarts, resumes, watches, prune], { discard: true }).pipe(Effect.catchCause((c) => Effect.logWarning("routine tick failed", String(c))), Effect.repeat(Schedule.spaced(TICK)))
    )
  })
)
