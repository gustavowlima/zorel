import { expect, test } from "bun:test"
import { summarize, type SummaryStep } from "./steps.ts"

const step = (kind: string, title: string, over: Partial<SummaryStep> = {}): SummaryStep => ({ kind, status: "ok", title, detail: "", files: [], ...over })

test("each kind counted in work order; timing rows aren't work; unknown tools are tools", () => {
  const { parts } = summarize([step("thought", "Thought"), step("run", "Run bun"), step("read", "Read a.ts"), step("read", "Read b.ts"), step("github__list_prs", "github__list_prs"), step("reply", "Replied")])
  expect(parts).toEqual([
    { kind: "read", count: 2 },
    { kind: "run", count: 1 },
    { kind: "tool", count: 1 }
  ])
})

test("an edited file counts once, however many edits touched it", () => {
  const { parts } = summarize([step("edit", "Edit db.ts", { files: ["db.ts"] }), step("edit", "Edit db.ts, runtime.ts", { files: ["db.ts", "runtime.ts"] })])
  expect(parts).toEqual([{ kind: "edit", count: 2 }])
})

test("a failure fixed later doesn't stand; one never fixed does; refusals count apart", () => {
  const tests = { detail: "bun test db.test.ts" }
  const fixed = summarize([step("run", "Run the tests", { ...tests, status: "error" }), step("edit", "Edit db.ts", { files: ["db.ts"] }), step("run", "Run the tests again", tests)])
  expect(fixed.failed).toBe(0)
  const standing = summarize([step("run", "Run the tests", { ...tests, status: "error" }), step("run", "Run the linter", { detail: "biome lint" })])
  expect(standing.failed).toBe(1)
  expect(summarize([step("run", "Run rm", { status: "refused" })]).refused).toBe(1)
})
