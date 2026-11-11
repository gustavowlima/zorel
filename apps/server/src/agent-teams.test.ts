import { expect, test } from "bun:test"
import { type Agent, DEFAULT_PERMISSIONS } from "@zorel/contracts"
import { activeMembers, handleClash, invalidMembers, teamHandle, teamsIn } from "./agent-teams.ts"

const agent = (over: Partial<Agent>): Agent => ({
  id: "a1", projectId: null, name: "Tester", title: "", description: "", instructions: "x", model: "claude-cli/sonnet",
  accountId: null, effort: null, failover: [], access: "workspace", permissions: DEFAULT_PERMISSIONS, archivedAt: null, monthlyTokens: null, replyTokens: null, memory: "ask", knowledge: "read", createdAt: 0, ...over
})
const team = (id: string, name: string, projectId: string | null) => ({ id, name, projectId })

test("a team's handle comes from its name, like an agent's", () => {
  expect(teamHandle("Review Crew")).toBe("review-crew")
  expect(teamHandle("Équipe Front")).toBe("equipe-front")
})

test("handleClash: an agent or a team the same chats see already answers to it", () => {
  const reach = { agents: [agent({ id: "g", name: "Frontend" }), agent({ id: "p2", name: "Backend", projectId: "p2" })], teams: [team("t1", "Ops", "p1")] }
  expect(handleClash("frontend", { projectId: "p1" }, reach)).toContain("agent Frontend") // a global agent is seen everywhere
  expect(handleClash("backend", { projectId: "p1" }, reach)).toBeUndefined() // another project's agent isn't
  expect(handleClash("backend", { projectId: null }, reach)).toContain("agent Backend") // a global team meets every project
  expect(handleClash("ops", { projectId: "p1" }, reach)).toContain("team Ops")
  expect(handleClash("ops", { projectId: "p1", id: "t1" }, reach)).toBeUndefined() // renaming itself
  expect(handleClash("ops", { projectId: "p3" }, reach)).toBeUndefined()
  expect(handleClash("", { projectId: null }, reach)).toBeDefined()
  // The Builder is never called by handle, so it takes none.
  expect(handleClash("builder", { projectId: null }, { agents: [agent({ name: "Builder", builtin: "builder" })], teams: [] })).toBeUndefined()
})

test("invalidMembers: a global team holds global agents; a project team its own and global ones; never the Builder", () => {
  const agents = [agent({ id: "g" }), agent({ id: "p1a", projectId: "p1" }), agent({ id: "b", builtin: "builder" })]
  expect(invalidMembers({ projectId: "p1" }, ["g", "p1a"], agents)).toBeUndefined()
  expect(invalidMembers({ projectId: null }, ["p1a"], agents)).toContain("another project")
  expect(invalidMembers({ projectId: "p2" }, ["p1a"], agents)).toContain("another project")
  expect(invalidMembers({ projectId: null }, ["b"], agents)).toContain("can't be in a team")
  expect(invalidMembers({ projectId: null }, ["gone"], agents)).toContain("no longer exists")
  expect(invalidMembers({ projectId: null }, Array.from({ length: 21 }, () => "g"), agents)).toContain("at most 20")
})

test("activeMembers keeps the team's order and skips archived or missing agents", () => {
  const agents = [agent({ id: "a" }), agent({ id: "b", archivedAt: 1 }), agent({ id: "c" })]
  expect(activeMembers({ agentIds: ["c", "b", "gone", "a"] }, agents).map((a) => a.id)).toEqual(["c", "a"])
})

test("teamsIn: the project's teams and the global ones", () => {
  expect(teamsIn([team("1", "A", null), team("2", "B", "p1"), team("3", "C", "p2")], "p1").map((t) => t.id)).toEqual(["1", "2"])
})
