// Routines (ARCHITECTURE §13, phase 7): an agent's recurring or triggered work. A routine owns a chat; each run
// is a message in it, sent through the runtime like yours, so the agent answers with its tools, approvals and
// memory as usual. Runs come from the schedule (a cron pattern, checked every 30 s, catching up once after the
// computer slept), from "Run now", from the routine's local webhook, or from a connector it watches (a read-only
// tool polled every few minutes; it runs on the items it hasn't seen). A run is idempotent per due time (the
// message's clientId), and a run that finds the chat still busy is skipped, not queued behind it.
import { Effect, Layer, Schedule } from "effect"
import { Store } from "./db.ts"
import { Runtime } from "./runtime.ts"
import { freshItems, nextRun, runText, watchItems } from "./schedule.ts"
import { resultText, Tools } from "./tools.ts"

export const TICK = "30 seconds"
export const WATCH_EVERY = 5 * 60_000 // a watched connector's poll: often enough for issues and mail, gentle on APIs

// One run: the message goes to the routine's chat unless a turn is running there. `key` makes it idempotent.
export const runRoutine = (id: string, key: string, payload?: unknown, label?: string) =>
  Effect.gen(function* () {
    const store = yield* Store
    const runtime = yield* Runtime
    const r = yield* store.routine(id)
    if (!r) return "missing" as const
    const at = Date.now()
    // An archived agent runs no routine (restoring it brings them back).
    if ((yield* store.agent(r.agentId))?.archivedAt) {
      yield* store.updateRoutine(r.id, { lastRunAt: at, lastStatus: "skipped" })
      return "skipped" as const
    }
    if (runtime.busy(r.chatId)) {
      yield* store.updateRoutine(r.id, { lastRunAt: at, lastStatus: "skipped" })
      return "skipped" as const
    }
    const ok = yield* runtime.send({ chatId: r.chatId, clientId: `routine:${r.id}:${key}`.slice(0, 64), text: runText(r.name, r.prompt, payload, label) }).pipe(
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

// Watched connectors: each one due polls its tool; new items run the routine (with them in the message). Only a
// read tool is called, so polling never changes anything on the other side. A failed poll marks the routine failed
// and tries again next time; the items seen stay.
const watches = Effect.gen(function* () {
  const store = yield* Store
  const { hub } = yield* Tools
  if ((yield* Runtime).paused()) return
  const now = Date.now()
  for (const r of yield* store.watchingRoutines()) {
    if (!r.watch || (r.watchAt && now - r.watchAt < WATCH_EVERY)) continue
    const w = r.watch
    yield* store.updateRoutine(r.id, { watchAt: now })
    const server = yield* store.mcpServer(w.serverId)
    const polled = yield* Effect.promise(async () => {
      if (!server?.enabled) return { error: "connector missing or off" }
      const tool = (await hub.tools(server)).find((t) => t.name === w.tool)
      if (!tool) return { error: `no tool ${w.tool}` }
      if (tool.cls !== "read") return { error: `${w.tool} isn't read-only` }
      const res = await hub.call(server, w.tool, { ...w.args })
      return res.isError ? { error: resultText(res).slice(0, 200) } : { text: resultText(res) }
    }).pipe(Effect.catchCause((c) => Effect.succeed({ error: String(c).slice(0, 200) })))
    if ("error" in polled) {
      yield* Effect.logWarning("routine watch failed", { routineId: r.id, error: polled.error })
      yield* store.updateRoutine(r.id, { lastRunAt: now, lastStatus: "failed" })
      continue
    }
    const { fresh, seen } = freshItems(r.watchSeen, watchItems(polled.text))
    // Seen only once the run started: items found while the chat was busy come again next poll.
    const ran = fresh.length ? yield* runRoutine(r.id, `watch-${now}`, fresh, `New from ${server?.name ?? "the connector"} (${w.tool})`) : "started"
    if (ran === "started") yield* store.updateRoutine(r.id, { watchSeen: seen })
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
export const RESUME_TEXT = "The usage limit has reset. Continue where you left off."

export const RoutineScheduler = Layer.effectDiscard(
  Effect.forkScoped(Effect.andThen(tick, resumes).pipe(Effect.andThen(watches)).pipe(Effect.catchCause((c) => Effect.logWarning("routine tick failed", String(c))), Effect.repeat(Schedule.spaced(TICK))))
)
