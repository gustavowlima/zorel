import { expect, test } from "bun:test"
import { paceOf } from "./labels.ts"

const H = 3_600_000
const now = 1_000 * H
const five = (usedPercent: number, resetsInHours: number) => ({ id: "five_hour", usedPercent, resetsAt: now + resetsInHours * H })

test("paceOf: on pace, ahead of the clock, and too early to tell", () => {
  expect(paceOf(five(50, 2.5), now)).toMatchObject({ elapsed: 0.5, runsOutAt: null })
  const ahead = paceOf(five(80, 4), now) // 80% used one hour into five
  expect(ahead.runsOutAt).toBe(now + 0.25 * H)
  expect(ahead.risk).toBeGreaterThan(1)
  expect(paceOf(five(30, 4.8), now).runsOutAt).toBeNull() // twelve minutes in
  expect(paceOf({ id: "model:Fable", usedPercent: 10, resetsAt: now }, now).elapsed).toBeNull()
})
