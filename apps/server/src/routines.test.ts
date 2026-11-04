import { expect, test } from "bun:test"
import { newToken, nextRun, runText } from "./schedule.ts"

test("nextRun: a pattern's next time, or why it isn't one", () => {
  const from = new Date("2026-11-03T08:59:00")
  const r = nextRun("0 9 * * 1-5", from)
  expect("at" in r && new Date(r.at!).getHours()).toBe(9)
  expect("error" in nextRun("not a cron")).toBe(true)
})

test("runText: the prompt, then the webhook's body (cut when huge)", () => {
  expect(runText("Daily", " Summarize the PRs ")).toBe('Routine "Daily":\n\nSummarize the PRs')
  const t = runText("Hook", "Triage it", { issue: 12 })
  expect(t).toContain('"issue": 12')
  expect(runText("Big", "x", "a".repeat(30_000)).length).toBeLessThan(21_000)
  expect(newToken()).toMatch(/^[\w-]{32}$/)
})
