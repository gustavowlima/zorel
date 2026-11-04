import { expect, test } from "bun:test"
import { type Agent, DEFAULT_PERMISSIONS } from "@zero/contracts"
import { createInput, createInputs, findAgent, narrower, updateInput, visibleTo } from "./team.ts"

const agent = (over: Partial<Agent>): Agent => ({
  id: "a1", projectId: null, name: "Code Reviewer", title: "", description: "", instructions: "x", model: "claude-cli/claude-sonnet-5-5",
  accountId: null, effort: null, failover: [], access: "workspace", permissions: DEFAULT_PERMISSIONS, createdAt: 0, ...over
})
const caller = { model: "codex-cli/default", effort: "high" as const, access: "workspace" as const }

test("narrower keeps the smaller access", () => {
  expect(narrower("full", "workspace")).toBe("workspace")
  expect(narrower("ask", "full")).toBe("ask")
})

test("a new agent gets the caller's model and at most its access", () => {
  const a = createInput({ name: " Tester ", instructions: "Write tests", access: "full" }, caller, "p1")
  expect(a).toMatchObject({ name: "Tester", model: "codex-cli/default", effort: "high", access: "workspace", projectId: "p1" })
  expect(createInput({ name: "G", instructions: "i", scope: "global", model: "claude-cli/claude-opus-5-5" }, caller, "p1")).toMatchObject({ projectId: null, effort: null })
  expect(() => createInput({ name: "", instructions: "i" }, caller, null)).toThrow("name")
  expect(() => createInput({ name: "n", instructions: "i", model: "nope/x" }, caller, null)).toThrow("Unknown model")
  expect(() => createInput({ name: "n", instructions: "i", access: "root" }, caller, null)).toThrow("access")
})

test("an update only narrows access and keeps only real changes", () => {
  const t = agent({ access: "workspace" })
  expect(() => updateInput({ access: "full" }, t, "full")).toThrow("Only the user")
  expect(updateInput({ access: "ask", title: "QA" }, t, "workspace")).toEqual({ access: "ask", title: "QA" })
  expect(() => updateInput({ name: "Code Reviewer" }, t, "full")).toThrow("Nothing to change")
})

test("agents are found by id or @handle among the visible ones", () => {
  const all = [agent({}), agent({ id: "a2", name: "Other", projectId: "p2" })]
  expect(visibleTo(all, "p1").map((a) => a.id)).toEqual(["a1"])
  expect(findAgent(all, "@code-reviewer")?.id).toBe("a1")
  expect(findAgent(all, "a2")?.id).toBe("a2")
  expect(findAgent(all, "@missing")).toBeUndefined()
})

test("a team: up to 8 profiles, each checked, names distinct", () => {
  const team = createInputs({ agents: [{ name: "Lead", instructions: "Plan" }, { name: "Dev", instructions: "Build", access: "full" }] }, caller, "p1")
  expect(team.map((a) => [a.name, a.access])).toEqual([["Lead", "workspace"], ["Dev", "workspace"]])
  expect(createInputs({ name: "Solo", instructions: "x" }, caller, null)).toHaveLength(1)
  expect(() => createInputs({ agents: [{ name: "A", instructions: "x" }, { name: "a", instructions: "y" }] }, caller, null)).toThrow("own name")
  expect(() => createInputs({ agents: [{ name: "A", instructions: "x" }, { name: "B" }] }, caller, null)).toThrow("Agent 2")
  expect(() => createInputs({ agents: Array.from({ length: 9 }, (_, i) => ({ name: `A${i}`, instructions: "x" })) }, caller, null)).toThrow("At most 8")
})
