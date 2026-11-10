import { expect, test } from "bun:test"
import { fieldProblem } from "./schema-rules.ts"

test("fieldProblem: required, whole numbers, limits; a value from an earlier step is checked when it runs", () => {
  const n = { type: "integer", minimum: 1, maximum: 5 }
  expect(fieldProblem(n, true, undefined)).toBeDefined()
  expect(fieldProblem(n, false, undefined)).toBeUndefined()
  expect(fieldProblem(n, false, 2.5)).toBeDefined()
  expect(fieldProblem(n, false, 9)).toBeDefined()
  expect(fieldProblem(n, false, 3)).toBeUndefined()
  expect(fieldProblem(n, true, { $from: "a" })).toBeUndefined()
})
