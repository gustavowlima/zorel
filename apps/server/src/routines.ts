// Routines (ARCHITECTURE §13, phase 7): an agent's recurring or triggered work. A routine owns a chat; each run
// is a message in it, sent through the runtime like yours, so the agent answers with its tools, approvals and
// memory as usual. Runs come from the schedule (a cron pattern, checked every 30 s, catching up once after the
// computer slept), from "Run now", or from the routine's local webhook. A run is idempotent per due time (the
// message's clientId), and a run that finds the chat still busy is skipped, not queued behind it.
import { Effect, Layer, Schedule } from "effect"
import { Store } from "./db.ts"
import { Runtime } from "./runtime.ts"
import { nextRun, runText } from "./schedule.ts"

export const TICK = "30 seconds"

// One run: the message goes to the routine's chat unless a turn is running there. `key` makes it idempotent.
export const runRoutine = (id: string, key: string, payload?: unknown) =>
  Effect.gen(function* () {
    const store = yield* Store
    const runtime = yield* Runtime
    const r = yield* store.routine(id)
    if (!r) return "missing" as const
    const at = Date.now()
    if (runtime.busy(r.chatId)) {
      yield* store.updateRoutine(r.id, { lastRunAt: at, lastStatus: "skipped" })
      return "skipped" as const
    }
    const ok = yield* runtime.send({ chatId: r.chatId, clientId: `routine:${r.id}:${key}`.slice(0, 64), text: runText(r.name, r.prompt, payload) }).pipe(
      Effect.as(true),
      Effect.catchCause(() => Effect.succeed(false))
    )
    yield* store.updateRoutine(r.id, { lastRunAt: at, lastStatus: ok ? "started" : "failed" })
    return ok ? ("started" as const) : ("failed" as const)
  })

// Every tick: each due routine runs once (a missed slot while asleep runs once, not once per slot), then gets
// its next time.
const tick = Effect.gen(function* () {
  const store = yield* Store
  if ((yield* Runtime).paused()) return // paused: due routines run after resume (they stay due)
  const now = Date.now()
  for (const r of yield* store.dueRoutines(now)) {
    yield* runRoutine(r.id, String(r.nextRunAt)).pipe(Effect.catchCause((c) => Effect.logWarning("routine run failed", { routineId: r.id, cause: String(c) })))
    const next = r.cron ? nextRun(r.cron, new Date(now)) : { at: null }
    yield* store.updateRoutine(r.id, { nextRunAt: "at" in next ? next.at : null })
  }
})

export const RoutineScheduler = Layer.effectDiscard(
  Effect.forkScoped(tick.pipe(Effect.catchCause((c) => Effect.logWarning("routine tick failed", String(c))), Effect.repeat(Schedule.spaced(TICK))))
)
