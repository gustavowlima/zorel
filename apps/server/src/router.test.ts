import { expect, test } from "bun:test"
import type { Agent } from "@zorel/contracts"
import { parseRoute, routerPrompt } from "./router.ts"

const agent = (id: string, name: string, title: string): Agent =>
  ({ id, name, title, description: "", instructions: "", projectId: null, model: "x/y", accountId: null, effort: null, failover: [], access: "workspace", builtin: null, createdAt: 0 }) as unknown as Agent
const team = [agent("1", "Tech Lead", "Coordinates"), agent("2", "Tester", "Writes unit tests")]

test("the router prompt lists the team with the lead marked, and the message", () => {
  const p = routerPrompt(team, [], "add tests for sum")
  expect(p).toContain("@tech-lead (lead): Coordinates")
  expect(p).toContain("@tester: Writes unit tests")
  expect(p).toContain("add tests for sum")
})

test("the answer maps to a teammate; anything else is no route", () => {
  expect(parseRoute('Sure: {"handle": "@tester", "reason": "tests"}', team)?.agent.id).toBe("2")
  expect(parseRoute('{"handle": "nobody"}', team)).toBeUndefined()
  expect(parseRoute("I think the tester", team)).toBeUndefined()
})
