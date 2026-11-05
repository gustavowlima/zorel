import { expect, test } from "bun:test"
import { type Agent, DEFAULT_PERMISSIONS } from "@zorel/contracts"
import { createInput, createInputs, effectiveAccess, findAgent, narrower, updateInput, visibleTo } from "./team.ts"

const agent = (over: Partial<Agent>): Agent => ({
  id: "a1", projectId: null, name: "Code Reviewer", title: "", description: "", instructions: "x", model: "claude-cli/claude-sonnet-5-5",
  accountId: null, effort: null, failover: [], access: "workspace", permissions: DEFAULT_PERMISSIONS, archivedAt: null, monthlyTokens: null, replyTokens: null, createdAt: 0, ...over
})
const caller = { model: "codex-cli/default", effort: "high" as const, access: "workspace" as const }

test("effectiveAccess: the chat's level for every agent in it when set, else the agent's own; the Builder keeps its own", () => {
  expect(effectiveAccess({ access: null }, agent({ access: "ask" }))).toBe("ask")
  expect(effectiveAccess({ access: "full" }, agent({ access: "ask" }))).toBe("full") // the person widened this chat
  expect(effectiveAccess({ access: "ask" }, agent({ access: "full" }))).toBe("ask") // or narrowed it
  expect(effectiveAccess({ access: null }, undefined)).toBe("workspace") // a chat with no agent
  expect(effectiveAccess({ access: "full" }, undefined)).toBe("full")
  expect(effectiveAccess({ access: "full" }, agent({ access: "workspace", builtin: "builder" }))).toBe("workspace")
})

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

test("a proposal carries its powers: web, browser, connectors by name (others none), and the reason", () => {
  const servers = [{ id: "s1", name: "GitHub" }, { id: "s2", name: "Notion" }]
  const caller = { model: "claude-cli/sonnet", effort: null, access: "workspace" as const }
  const input = createInput({ name: "Rev", instructions: "x", web: false, connectors: [{ name: "github", level: "read" }], reason: "PRs pile up" }, caller, null, servers)
  expect(input.permissions).toEqual({ web: false, browser: false, grants: { s1: "read", s2: "none" }, always: [] })
  expect(input.notes).toEqual({ reason: "PRs pile up", connectors: "GitHub (read)" })
  expect(() => createInput({ name: "Rev", instructions: "x", connectors: [{ name: "Jira" }] }, caller, null, servers)).toThrow('No connector "Jira"')
  // Nothing about connectors: it follows each server's own mode.
  expect(createInput({ name: "Rev", instructions: "x" }, caller, null, servers).permissions.grants).toEqual({})
})
