import { expect, test } from "bun:test"
import { freshItems, newToken, nextRun, runText, watchItems } from "./schedule.ts"

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

test("watchItems: a JSON list, the first list in an object, one value, or lines", () => {
  expect(watchItems('[{"id":1},{"id":2}]')).toHaveLength(2)
  expect(watchItems('{"total":2,"issues":[{"number":7},{"number":8}]}')).toEqual([{ number: 7 }, { number: 8 }])
  expect(watchItems('{"status":"down"}')).toEqual([{ status: "down" }])
  expect(watchItems("mail from ana\n\nmail from bo\n")).toEqual(["mail from ana", "mail from bo"])
})

test("freshItems: the first poll learns, then only unseen items count; an item keeps its key when other fields change", () => {
  const first = freshItems(null, [{ id: 1, comments: 0 }])
  expect(first.fresh).toEqual([])
  const second = freshItems(first.seen, [{ id: 1, comments: 5 }, { id: 2 }])
  expect(second.fresh).toEqual([{ id: 2 }])
  expect(freshItems(second.seen, [{ id: 2 }, { id: 1 }]).fresh).toEqual([])
  expect(freshItems(second.seen, ["down"]).fresh).toEqual(["down"]) // no id: the whole item is the key
  expect(runText("Watch", "Triage", [{ id: 2 }], "New from GitHub (list_issues)")).toContain("New from GitHub (list_issues):")
})
