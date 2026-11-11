// The person's time (spec 012), kept in the preferences: their zone, when their day usually starts (learned from
// the first activity of each day unless set by hand), quiet hours, and the day starts that bound the morning brief.
import type { QuietHours, TimeProfile } from "@zorel/contracts"
import { Effect } from "effect"
import type { Repository } from "./db.ts"
import { type DayStart, dayStartMinutes, learnDayStart, localDate, localMinutes, serverZone, validZone } from "./routine-runs.ts"

const KEY = { zone: "timeZone", quiet: "quietHours", dayStart: "dayStart", activity: "lastActivityDay", brief: "briefAt" } as const
const json = <T>(raw: string | undefined, fallback: T): T => {
  try {
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export type Profile = { zone: string; quiet: QuietHours | null; dayStart: DayStart; start: number }
export const profileOf = (store: Repository) =>
  Effect.map(Effect.all([store.preference(KEY.zone), store.preference(KEY.quiet), store.preference(KEY.dayStart)]), ([z, q, d]): Profile => {
    const zone = z && validZone(z) ? z : serverZone()
    const dayStart = json<DayStart>(d, { set: null, learned: [] })
    return { zone, quiet: json<QuietHours | null>(q, null), dayStart, start: dayStartMinutes(dayStart) }
  })
export const toContract = (p: Profile): TimeProfile => ({ timeZone: p.zone, quietHours: p.quiet, dayStartMinutes: p.start, dayStartSet: p.dayStart.set, learned: p.dayStart.learned.length })

// Saves what the person set. The zone is checked here (the schema only bounds its length). Returns false when invalid.
export const saveProfile = (store: Repository, input: { timeZone: string; quietHours: QuietHours | null; dayStartSet: number | null }) =>
  Effect.gen(function* () {
    if (!validZone(input.timeZone)) return false
    const current = yield* profileOf(store)
    yield* store.setPreference(KEY.zone, input.timeZone)
    yield* store.setPreference(KEY.quiet, JSON.stringify(input.quietHours))
    yield* store.setPreference(KEY.dayStart, JSON.stringify({ ...current.dayStart, set: input.dayStartSet }))
    return true
  })

// The person did something (opened the app, sent a message, wrote on Telegram). The first time on a local day it
// teaches the usual start and moves the brief's bounds. Routine runs and resumes are not activity.
export const noteActivity = (store: Repository, at = Date.now()) =>
  Effect.gen(function* () {
    const p = yield* profileOf(store)
    const today = localDate(at, p.zone)
    if ((yield* store.preference(KEY.activity)) === today) return false
    yield* store.setPreference(KEY.activity, today)
    yield* store.setPreference(KEY.dayStart, JSON.stringify(learnDayStart(p.dayStart, localMinutes(at, p.zone))))
    const brief = json<{ current: number; previous: number } | null>(yield* store.preference(KEY.brief), null)
    yield* store.setPreference(KEY.brief, JSON.stringify({ previous: brief?.current ?? at - 24 * 60 * 60_000, current: at }))
    return true
  })
export const activeOn = (store: Repository, date: string) => Effect.map(store.preference(KEY.activity), (d) => d === date)
// Where Today starts: the previous day start (a whole day back before any).
export const briefFrom = (store: Repository, now = Date.now()) =>
  Effect.map(store.preference(KEY.brief), (raw) => json<{ previous: number } | null>(raw, null)?.previous ?? now - 24 * 60 * 60_000)
