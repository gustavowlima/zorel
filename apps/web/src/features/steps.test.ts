import { expect, test } from "bun:test"
import { interleave, summarize, type SummaryStep } from "./steps.ts"

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

test("a reply is laid out as it happened: text, a group of steps, text, another group", () => {
  const text = "Let me look. Found it. Done."
  const pieces = interleave(text, [{ n: "a", at: 12 }, { n: "b", at: 12 }, { n: "c", at: 22 }], (s) => s.at)
  expect(pieces.map((p) => (p.kind === "text" ? p.text : p.steps.map((s) => s.n).join("")))).toEqual(["Let me look.", "ab", " Found it.", "c", " Done."])
})

test("steps that don't know where they began: above the text when none does, after it when some do", () => {
  const none = interleave("Done.", [{ n: "a" }], () => undefined)
  expect(none.map((p) => p.kind)).toEqual(["steps", "text"])
  const some = interleave("Hi. Done.", [{ n: "a", at: 3 }, { n: "b" }], (s: { at?: number }) => s.at)
  expect(some.map((p) => p.kind)).toEqual(["text", "steps", "text", "steps"])
  expect(interleave("", [{ n: "a", at: 0 }], (s) => s.at).map((p) => p.kind)).toEqual(["steps"])
})
