import { describe, expect, test } from "bun:test"
import { type DayStart, dayStartDue, dayStartMinutes, inQuiet, learnDayStart, localDate, nextScheduled, localMinutes, outcomeOf, plannedRuns, shouldTell, todayOf, validZone, zonedTime } from "./routine-runs.ts"

test("outcomeOf: reads the last line, removes it, takes the first line as the summary", () => {
  expect(outcomeOf("3 PRs wait for review.\n- #212 is 4 days old\n\nOutcome: something new\n")).toEqual({ outcome: "something", marked: true, text: "3 PRs wait for review.\n- #212 is 4 days old", summary: "3 PRs wait for review." })
  expect(outcomeOf("Nothing changed since yesterday.\n\n**Outcome: nothing new**").outcome).toBe("nothing")
  expect(outcomeOf("I need you to pick one.\n> outcome: Needs You.").outcome).toBe("needs")
  expect(outcomeOf("## Brief\nAll good\n`Outcome:` nothing new").outcome).toBe("nothing") // markdown around it is fine
  // No marker, or one that isn't the last line: "something", and the text stays whole.
  const none = outcomeOf("Here is the report.\nOutcome: nothing new\nOne more line.")
  expect([none.outcome, none.marked, none.text]).toEqual(["something", false, "Here is the report.\nOutcome: nothing new\nOne more line."])
  expect(outcomeOf("").summary).toBe("")
  expect(outcomeOf(`# ${"x".repeat(500)}\nOutcome: something new`).summary).toHaveLength(200)
})

test("shouldTell: nothing never; needs at once unless quiet and not urgent; something unless brief-only or quiet", () => {
  expect(shouldTell("nothing", "every", true, false)).toBe("skip")
  expect(shouldTell("needs", "brief", false, false)).toBe("tell")
  expect(shouldTell("needs", "something", false, true)).toBe("hold")
  expect(shouldTell("needs", "something", true, true)).toBe("tell")
  expect(shouldTell("something", "every", false, false)).toBe("tell")
  expect(shouldTell("something", "brief", false, false)).toBe("hold")
  expect(shouldTell("something", "every", true, true)).toBe("hold")
})

test("local time: zones, quiet hours across midnight, the instant of a local time", () => {
  const at = Date.UTC(2026, 10, 10, 2, 30) // 02:30 UTC = 23:30 the day before in São Paulo (UTC-3)
  expect(localDate(at, "America/Sao_Paulo")).toBe("2026-11-09")
  expect(localMinutes(at, "America/Sao_Paulo")).toBe(23 * 60 + 30)
  expect(localDate(at, "Asia/Tokyo")).toBe("2026-11-10")
  const night = { from: "21:00", to: "07:00" }
  expect(inQuiet(night, at, "America/Sao_Paulo")).toBe(true)
  expect(inQuiet(night, Date.UTC(2026, 10, 10, 10, 0), "America/Sao_Paulo")).toBe(false) // 07:00 local: out
  expect(inQuiet(night, Date.UTC(2026, 10, 10, 0, 0), "America/Sao_Paulo")).toBe(true) // 21:00 local: in
  expect(inQuiet({ from: "13:00", to: "14:00" }, Date.UTC(2026, 10, 10, 16, 30), "America/Sao_Paulo")).toBe(true)
  expect(inQuiet(null, at, "UTC")).toBe(false)
  expect(zonedTime("2026-11-10", 9 * 60, "America/Sao_Paulo")).toBe(Date.UTC(2026, 10, 10, 12, 0))
  expect(zonedTime("2026-07-01", 9 * 60, "Europe/Lisbon")).toBe(Date.UTC(2026, 6, 1, 8, 0)) // summer time
  expect(validZone("America/Sao_Paulo")).toBe(true)
  expect(validZone("Mars/Base")).toBe(false)
})

test("day start: learned median, set by hand, once a day at the first activity or the cut-off", () => {
  expect(dayStartMinutes({ set: null, learned: [] })).toBe(540)
  let d: DayStart = { set: null, learned: [] }
  for (const m of [550, 560, 545, 600, 552]) d = learnDayStart(d, m)
  expect(dayStartMinutes(d)).toBe(552)
  expect(dayStartMinutes({ ...d, set: 480 })).toBe(480)
  for (let i = 0; i < 20; i++) d = learnDayStart(d, 500)
  expect(d.learned).toHaveLength(14)
  const base = { ranOn: "2026-11-09", today: "2026-11-10", activeToday: false, nowMinutes: 600, start: 552 }
  expect(dayStartDue(base)).toBe(false) // not active yet, before the cut-off
  expect(dayStartDue({ ...base, activeToday: true })).toBe(true)
  expect(dayStartDue({ ...base, nowMinutes: 552 + 180 })).toBe(true) // the cut-off
  expect(dayStartDue({ ...base, activeToday: true, ranOn: "2026-11-10" })).toBe(false) // once a day
})

test("todayOf: unread needs, found newest first, nothing folded; before `from` left out", () => {
  const run = (id: string, outcome: "nothing" | "something" | "needs" | null, createdAt: number, readAt: number | null = null) => ({ id, state: "done", outcome, createdAt, readAt })
  const t = todayOf([run("a", "needs", 10), run("b", "something", 11), run("c", "something", 13), run("d", "nothing", 12), run("e", "nothing", 14), run("f", "needs", 15, 16), run("g", "something", 1), run("h", null, 17)], 5)
  expect(t.needs.map((r) => r.id)).toEqual(["a"])
  expect(t.found.map((r) => r.id)).toEqual(["c", "b"])
  expect(t.quiet).toBe(2)
})

test("plannedRuns: a cron in the person's zone, day-start at the usual start, the cap", () => {
  const zone = "America/Sao_Paulo"
  const from = zonedTime("2026-11-09", 0, zone) // Monday
  const to = from + 7 * 24 * 60 * 60_000
  const weekly = plannedRuns([{ id: "fri", enabled: true, cron: "0 17 * * 5", onDayStart: false }], zone, 540, from, to)
  expect(weekly).toEqual([{ routineId: "fri", at: zonedTime("2026-11-13", 17 * 60, zone) }])
  const days = plannedRuns([{ id: "brief", enabled: true, cron: null, onDayStart: true }], zone, 552, from, to)
  expect(days).toHaveLength(7)
  expect(localMinutes(days[0]!.at, zone)).toBe(552)
  expect(plannedRuns([{ id: "off", enabled: false, cron: "* * * * *", onDayStart: true }], zone, 540, from, to)).toEqual([])
  expect(plannedRuns([{ id: "busy", enabled: true, cron: "* * * * *", onDayStart: false }], zone, 540, from, to)).toHaveLength(200)
})

describe("nextScheduled (spec 013)", () => {
  const zone = "America/Sao_Paulo" // UTC-3, no daylight saving
  const at = (iso: string) => Date.parse(iso)
  test("once: that time, then never again", () => {
    expect(nextScheduled({ kind: "once", date: "2026-11-12", time: "09:30" }, zone, at("2026-11-10T12:00:00Z"))).toBe(at("2026-11-12T12:30:00Z"))
    expect(nextScheduled({ kind: "once", date: "2026-11-12", time: "09:30" }, zone, at("2026-11-12T12:30:00Z"))).toBeNull()
  })
  test("monthly: this month if still ahead, else the next; day 31 falls on a shorter month's last day", () => {
    const s = { kind: "monthly" as const, day: 31, time: "08:00" }
    expect(nextScheduled(s, zone, at("2026-11-10T12:00:00Z"))).toBe(at("2026-11-30T11:00:00Z")) // November has 30
    expect(nextScheduled(s, zone, at("2026-11-30T11:00:00Z"))).toBe(at("2026-12-31T11:00:00Z"))
    expect(nextScheduled(s, zone, at("2027-01-31T11:00:00Z"))).toBe(at("2027-02-28T11:00:00Z"))
    expect(nextScheduled({ kind: "monthly", day: 5, time: "08:00" }, "Asia/Tokyo", at("2026-11-10T00:00:00Z"))).toBe(at("2026-12-04T23:00:00Z"))
  })
})
