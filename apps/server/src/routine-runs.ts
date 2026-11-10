// Routine runs (spec 012), the pure rules: how a run ended (the agent's last line), whether the person is told now,
// held for the brief or not at all, the person's local time (quiet hours, when their day starts), what Today shows,
// and the runs a week will have. No effects here: routines.ts does the I/O.
import type { QuietHours, RoutineOutcome, RoutineSchedule, RoutineTell } from "@zorel/contracts"
import { Cron } from "croner"

// ---------- the outcome ----------
const OUTCOMES: Record<string, RoutineOutcome> = { "nothing new": "nothing", "something new": "something", "needs you": "needs" }
const MARKER = /^[\s>*_`#-]*outcome\s*[:：]\s*[*_`]*\s*(nothing new|something new|needs you)\s*[*_`.]*\s*$/i
export const SUMMARY_MAX = 200
export const REPORT_MAX = 4000

// The run's reply: its marker line removed, its outcome (none or unreadable: "something", so nothing is dropped)
// and the first line as the summary.
export function outcomeOf(reply: string): { outcome: RoutineOutcome; marked: boolean; text: string; summary: string } {
  const lines = reply.replace(/\s+$/, "").split("\n")
  let i = lines.length - 1
  while (i >= 0 && !lines[i]!.trim()) i--
  const hit = i >= 0 ? MARKER.exec(lines[i]!) : null
  const text = (hit ? lines.slice(0, i).join("\n") : lines.join("\n")).replace(/\s+$/, "")
  const first = text.split("\n").find((l) => l.trim()) ?? ""
  const summary = first.replace(/^[\s>#*-]+/, "").replace(/\*\*|__|`/g, "").trim().slice(0, SUMMARY_MAX)
  return { outcome: hit ? OUTCOMES[hit[1]!.toLowerCase()]! : "something", marked: !!hit, text, summary }
}

// ---------- telling the person ----------
export type Telling = "tell" | "hold" | "skip"
// What a finished (or waiting) run does with the person: tell now, hold for the brief, or nothing at all.
const RULES: Record<RoutineOutcome, (tell: RoutineTell, urgent: boolean, quiet: boolean) => Telling> = {
  nothing: () => "skip",
  needs: (_tell, urgent, quiet) => (quiet && !urgent ? "hold" : "tell"),
  something: (tell, _urgent, quiet) => (tell === "brief" || quiet ? "hold" : "tell")
}
export const shouldTell = (outcome: RoutineOutcome, tell: RoutineTell, urgent: boolean, quiet: boolean): Telling => RULES[outcome](tell, urgent, quiet)

// ---------- the person's local time ----------
const parts = (at: number, zone: string) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(new Date(at))
      .map((x) => [x.type, x.value])
  )
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, min: Number(p.minute) }
}
export const validZone = (zone: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone })
    return true
  } catch {
    return false
  }
}
export const serverZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
export const localDate = (at: number, zone: string) => {
  const p = parts(at, zone)
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`
}
export const localMinutes = (at: number, zone: string) => {
  const p = parts(at, zone)
  return p.h * 60 + p.min
}
const toMinutes = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))
// Quiet hours may cross midnight (21:00 – 07:00). `from` is in, `to` is out.
export function inQuiet(quiet: QuietHours | null, at: number, zone: string): boolean {
  if (!quiet) return false
  const [from, to, now] = [toMinutes(quiet.from), toMinutes(quiet.to), localMinutes(at, zone)]
  if (from === to) return false
  return from < to ? now >= from && now < to : now >= from || now < to
}
// The instant of `minutes` past local midnight on `date` (YYYY-MM-DD) in `zone`, DST included.
export function zonedTime(date: string, minutes: number, zone: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number]
  const wall = Date.UTC(y, m - 1, d, 0, minutes)
  const offset = (at: number) => {
    const p = parts(at, zone)
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - Math.floor(at / 60_000) * 60_000
  }
  const first = wall - offset(wall)
  return wall - offset(first)
}

// ---------- when the day starts ----------
export const DAY_START_DEFAULT = 9 * 60
export const LEARNED_MAX = 14
export const CUTOFF = 3 * 60 // a day-start routine runs anyway this long after the usual start
export type DayStart = { readonly set: number | null; readonly learned: ReadonlyArray<number> }
const median = (xs: ReadonlyArray<number>) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor((s.length - 1) / 2)]! : undefined
}
export const dayStartMinutes = (d: DayStart) => d.set ?? median(d.learned) ?? DAY_START_DEFAULT
export const learnDayStart = (d: DayStart, minutes: number): DayStart => ({ set: d.set, learned: [...d.learned, minutes].slice(-LEARNED_MAX) })
// A day-start routine runs once a local day: at the first activity, or at the usual start + CUTOFF.
export const dayStartDue = (o: { ranOn: string | null; today: string; activeToday: boolean; nowMinutes: number; start: number }) =>
  o.ranOn !== o.today && (o.activeToday || o.nowMinutes >= o.start + CUTOFF)

// ---------- Today ----------
type RunLike = { readonly state: string; readonly outcome: RoutineOutcome | null; readonly readAt: number | null; readonly createdAt: number }
// What came in since `from`: what needs the person (unread), what routines found (newest first), and how many found
// nothing (folded into one line).
export function todayOf<R extends RunLike>(runs: ReadonlyArray<R>, from: number): { needs: R[]; found: R[]; quiet: number } {
  const since = runs.filter((r) => r.createdAt >= from && r.outcome).sort((a, b) => b.createdAt - a.createdAt)
  return {
    needs: since.filter((r) => r.outcome === "needs" && !r.readAt),
    found: since.filter((r) => r.outcome === "something"),
    quiet: since.filter((r) => r.outcome === "nothing").length
  }
}

// ---------- the week ----------
type Planned = { readonly id: string; readonly enabled: boolean; readonly cron: string | null; readonly onDayStart: boolean; readonly schedule?: RoutineSchedule | null }
export const PLANNED_MAX = 200
// The runs coming in [from, to): each cron in the person's zone, and day-start routines at the usual start.
export function plannedRuns(routines: ReadonlyArray<Planned>, zone: string, start: number, from: number, to: number, cap = PLANNED_MAX): Array<{ routineId: string; at: number }> {
  const out: Array<{ routineId: string; at: number }> = []
  for (const r of routines) {
    if (!r.enabled) continue
    if (r.cron) {
      const job = new Cron(r.cron, { paused: true, timezone: zone })
      for (let next = job.nextRun(new Date(from - 1)); next && next.getTime() < to && out.length < cap; next = job.nextRun(next)) out.push({ routineId: r.id, at: next.getTime() })
    }
    if (r.schedule)
      for (let next = nextScheduled(r.schedule, zone, from - 1); next !== null && next < to && out.length < cap; next = nextScheduled(r.schedule, zone, next)) out.push({ routineId: r.id, at: next })
    if (r.onDayStart)
      for (let day = from; day < to && out.length < cap; day += 24 * 60 * 60_000) {
        const at = zonedTime(localDate(day, zone), start, zone)
        if (at >= from && at < to && !out.some((p) => p.routineId === r.id && p.at === at)) out.push({ routineId: r.id, at })
      }
  }
  return out.sort((a, b) => a.at - b.at).slice(0, cap)
}

// ---------- one time, every month (spec 013) ----------
const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
const pad = (n: number) => String(n).padStart(2, "0")
// The next time a schedule fires after `from`, in the person's zone; null: never again (a one-time that passed).
// A monthly day past a month's end falls on its last day (31 → Apr 30, Feb 28 or 29).
export function nextScheduled(s: RoutineSchedule, zone: string, from: number): number | null {
  if (s.kind === "once") {
    const at = zonedTime(s.date, minutesOf(s.time), zone)
    return at > from ? at : null
  }
  const [y, m] = localDate(from, zone).split("-").map(Number) as [number, number]
  for (let i = 0; i < 13; i++) {
    const year = y + Math.floor((m - 1 + i) / 12)
    const month = ((m - 1 + i) % 12) + 1
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
    const at = zonedTime(`${year}-${pad(month)}-${pad(Math.min(s.day, last))}`, minutesOf(s.time), zone)
    if (at > from) return at
  }
  return null
}
