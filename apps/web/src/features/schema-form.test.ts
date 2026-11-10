import { expect, test } from "bun:test"
import { argProblems, fieldProblem } from "./schema-rules.ts"

test("fieldProblem: required, whole numbers, limits; a value from an earlier step is checked when it runs", () => {
  const n = { type: "integer", minimum: 1, maximum: 5 }
  expect(fieldProblem(n, true, undefined)).toBeDefined()
  expect(fieldProblem(n, false, undefined)).toBeUndefined()
  expect(fieldProblem(n, false, 2.5)).toBeDefined()
  expect(fieldProblem(n, false, 9)).toBeDefined()
  expect(fieldProblem(n, false, 3)).toBeUndefined()
  expect(fieldProblem(n, true, { $from: "a" })).toBeUndefined()
})

test("output fields: from a schema or a sample, lists by their first item", async () => {
  const { pathsFromSample, pathsFromSchema } = await import("./schema-rules.ts")
  expect(pathsFromSchema({ type: "object", properties: { items: { type: "array", items: { type: "object", properties: { id: { type: "string" } } } }, total: { type: "number" } } })).toEqual(["items", "items.0", "items.0.id", "total"])
  expect(pathsFromSample({ channels: [{ id: "C1", name: "general" }] })).toEqual(["channels", "channels.0", "channels.0.id", "channels.0.name"])
  expect(pathsFromSample("text")).toEqual([])
})

test("argProblems: the JSON mode's checks, each on its key", () => {
  const schema = { properties: { level: { enum: ["info", "error"] }, all: { type: "boolean" }, n: { type: "integer", minimum: 1 } }, required: ["level"] }
  expect(argProblems(schema, [])).toHaveLength(1) // not an object
  expect(argProblems(schema, {}).map((p) => p.key)).toEqual([undefined]) // level missing
  expect(argProblems(schema, { level: "info", all: false, n: 2 })).toEqual([])
  expect(argProblems(schema, { level: "debug", all: "yes", n: 0, extra: 1 }).map((p) => p.key)).toEqual(["level", "all", "n", "extra"])
  expect(argProblems(schema, { level: { $from: "a" } })).toEqual([])
})
