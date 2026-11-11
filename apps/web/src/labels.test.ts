import { expect, test } from "bun:test"
import type { Approval } from "@zorel/contracts/events"
import { approvalTitle, modelName, paceOf, receiptTitle, stepTitle, windowMinutes } from "./labels.ts"

const H = 3_600_000
const now = 1_000 * H
const five = (usedPercent: number, resetsInHours: number) => ({ id: "five_hour", usedPercent, resetsAt: now + resetsInHours * H })

test("paceOf: on pace, ahead of the clock, and too early to tell", () => {
  expect(paceOf(five(50, 2.5), now)).toMatchObject({ elapsed: 0.5, runsOutAt: null })
  const ahead = paceOf(five(80, 4), now) // 80% used one hour into five
  expect(ahead.runsOutAt).toBe(now + 0.25 * H)
  expect(ahead.risk).toBeGreaterThan(1)
  expect(paceOf(five(30, 4.8), now).runsOutAt).toBeNull() // twelve minutes in
  expect(paceOf({ id: "model:Fable", usedPercent: 10, resetsAt: now }, now).elapsed).toBeNull()
})

test("a full Claude id reads like the picker", () => {
  expect(modelName("claude-cli/claude-sonnet-5-5")).toBe("Sonnet 5.5")
  expect(modelName("anthropic/claude-opus-5-5")).toBe("Opus 5.5")
})

test("a window scoped to a group of models keeps its length", () => {
  expect(windowMinutes("300m:Gemini")).toBe(300)
  expect(windowMinutes("10080m:Claude and GPT")).toBe(10080)
  expect(windowMinutes("model:Fable")).toBeNull()
})

test("a proposal's title is worded from its data, not the server's English summary", () => {
  const base = { id: "a", chatId: "c", turnId: "t", stepId: "s", agentId: null, kind: "tool", args: "", cwd: null, alwaysKey: null, createdAt: 0, expiresAt: 0 } as const
  const agent = { name: "Rex", title: "", description: "", instructions: "", model: "claude-cli/sonnet", access: "workspace", permissions: { web: true, browser: false, grants: {}, always: [] }, scope: "global", reason: "" } as const
  const one: Approval = { ...base, tool: "zorel_create_agent", summary: "Builder proposes a new agent: Rex", proposal: { kind: "create", agents: [agent] } }
  const team: Approval = { ...one, proposal: { kind: "create", agents: [agent, { ...agent, name: "Ana" }] } }
  expect(approvalTitle(one, "Builder")).toBe("Builder proposes a new agent: Rex")
  expect(approvalTitle(team, "Builder")).toBe("Builder proposes a team of 2: Rex, Ana")
  expect(receiptTitle(team)).toBe("New team: Rex, Ana")
  expect(approvalTitle({ ...base, tool: "x", summary: "Run tests" }, "Rex")).toBe("Run tests")
  expect(stepTitle("zorel_update_agent", "Builder proposes changes to Rex", "Rex")).toBe("Changes to Rex")
  expect(stepTitle("bash", "Run tests", "bun test")).toBe("Run tests")
})
