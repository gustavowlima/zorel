import { expect, test } from "bun:test"
import type { Agent } from "@zorel/contracts"
import { sees, usedByView, withAgent, withoutAgent } from "./skill-agents.ts"

const agent = (id: string, extra: Partial<Agent> = {}) => ({ id, name: id.toUpperCase(), archivedAt: null, ...extra }) as Agent
const team = [agent("a"), agent("b"), agent("c")]

test("an empty list is every agent", () => {
  expect(sees(undefined, "a")).toBe(true)
  expect(sees([], "a")).toBe(true)
  expect(sees(["b"], "a")).toBe(false)
})

test("stop using on an all-agents skill writes the others, active ones only", () => {
  expect(withoutAgent([], "a", [...team, agent("z", { archivedAt: 1 })])).toEqual(["b", "c"])
})

test("stop using drops an agent and the ones that are gone; nobody left gives null", () => {
  expect(withoutAgent(["a", "b", "gone"], "a", team)).toEqual(["b"])
  expect(withoutAgent(["a", "gone"], "a", team)).toBeNull()
  expect(withoutAgent([], "a", [agent("a")])).toBeNull()
})

test("stop using on a project's skill writes only the agents that work there; past the limit gives null", () => {
  const mixed = [agent("a", { projectId: "p" }), agent("g", { projectId: null }), agent("x", { projectId: "q" })]
  expect(withoutAgent([], "a", mixed, "project:p")).toEqual(["g"])
  expect(withoutAgent([], "a", Array.from({ length: 52 }, (_, i) => agent(`n${i}`)))).toBeNull()
})

test("use it adds the agent and never writes an id that is gone", () => {
  expect(withAgent(["b", "gone"], "a", team)).toEqual(["b", "a"])
  expect(withAgent(["gone"], "a", team)).toEqual(["a"])
})

test("the list reads as all, none left, or these agents", () => {
  expect(usedByView([], team)).toEqual({ kind: "all" })
  expect(usedByView(["gone"], team)).toEqual({ kind: "none" })
  expect(usedByView(["b", "gone"], team)).toEqual({ kind: "some", names: ["B"] })
})
