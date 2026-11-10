import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { connectionProblem, type FlowGraph, FlowGraph as FlowGraphSchema, type FlowNode, MAX_STEPS, nextNode, synthesizeFlow, validateFlow } from "./flow.ts"

const at = { x: 0, y: 0 }
const trigger: FlowNode = { id: "t", kind: "trigger", ...at, config: { on: "manual" } }
const read: FlowNode = { id: "r", kind: "tool", ...at, config: { serverId: "gh", tool: "list_issues", args: {} } }
const agent: FlowNode = { id: "a", kind: "agent", ...at, config: { prompt: "Sum it up" } }
const cond: FlowNode = { id: "c", kind: "condition", ...at, config: { rule: "hasItems", input: { $from: "r" }, defaultBranch: "yes" } }
const end: FlowNode = { id: "e", kind: "end", ...at, config: {} }
const edge = (from: string, to: string, branch?: "yes" | "no") => ({ id: `${from}-${to}${branch ?? ""}`, from, to, ...(branch && { branch }) })
const flow = (nodes: FlowNode[], edges: FlowGraph["edges"]): FlowGraph => ({ nodes, edges })

describe("connectionProblem", () => {
  test("refuses paths into the trigger, out of an end, and branches in the wrong place", () => {
    expect(connectionProblem("agent", "trigger")).toBeDefined()
    expect(connectionProblem("end", "agent")).toBeDefined()
    expect(connectionProblem("condition", "agent")).toBe("Choose yes or no for this path.")
    expect(connectionProblem("tool", "agent", "yes")).toBeDefined()
    expect(connectionProblem("condition", "tool", "yes")).toBeUndefined()
    expect(connectionProblem("tool", "agent")).toBeUndefined()
  })
})

describe("validateFlow", () => {
  test("a straight flow and a branched one are fine", () => {
    expect(validateFlow(flow([trigger, read, agent], [edge("t", "r"), edge("r", "a")]))).toEqual({ ok: true })
    expect(validateFlow(flow([trigger, read, cond, agent, end], [edge("t", "r"), edge("r", "c"), edge("c", "a", "yes"), edge("c", "e", "no")]))).toEqual({ ok: true })
  })
  test("names the step no path reaches", () => {
    expect(validateFlow(flow([trigger, read, agent], [edge("t", "r")]))).toMatchObject({ ok: false, nodeId: "a" })
  })
  test("refuses a loop", () => {
    expect(validateFlow(flow([trigger, read, agent], [edge("t", "r"), edge("r", "a"), edge("a", "r")]))).toMatchObject({ ok: false })
  })
  test("names the step and the field left empty", () => {
    const blank: FlowNode = { ...agent, config: { prompt: "  " } }
    expect(validateFlow(flow([trigger, blank], [edge("t", "a")]))).toMatchObject({ ok: false, nodeId: "a", field: "prompt" })
  })
  test("refuses a branch drawn twice and two ways out", () => {
    expect(validateFlow(flow([trigger, read, cond, agent, end], [edge("t", "r"), edge("r", "c"), edge("c", "a", "yes"), edge("c", "e", "yes")]))).toMatchObject({ ok: false, nodeId: "c" })
    expect(validateFlow(flow([trigger, read, agent], [edge("t", "r"), edge("t", "a")]))).toMatchObject({ ok: false, nodeId: "t" })
  })
  test("a value comes only from an earlier step that gives one", () => {
    const later: FlowNode = { ...read, id: "r2", config: { serverId: "gh", tool: "post", args: { text: { $from: "a" } } } }
    expect(validateFlow(flow([trigger, agent, later], [edge("t", "a"), edge("a", "r2")]))).toEqual({ ok: true })
    // text has no path to read
    const pathed: FlowNode = { ...later, config: { ...later.config, args: { text: { $from: "a", path: "x" } } } }
    expect(validateFlow(flow([trigger, agent, pathed], [edge("t", "a"), edge("a", "r2")]))).toMatchObject({ ok: false, nodeId: "r2", field: "text" })
    // the agent comes after
    expect(validateFlow(flow([trigger, later, agent], [edge("t", "r2"), edge("r2", "a")]))).toMatchObject({ ok: false, nodeId: "r2", field: "text" })
    // a decision isn't a value
    const fromCond: FlowNode = { ...later, config: { ...later.config, args: { text: { $from: "c" } } } }
    expect(validateFlow(flow([trigger, read, cond, fromCond], [edge("t", "r"), edge("r", "c"), edge("c", "r2", "yes")]))).toMatchObject({ ok: false, field: "text" })
  })
  test("at most 30 steps (the schema refuses more too)", () => {
    const nodes: FlowNode[] = [trigger, ...Array.from({ length: MAX_STEPS + 1 }, (_, i): FlowNode => ({ ...agent, id: `a${i}` }))]
    const edges = nodes.slice(1).map((n, i) => edge(nodes[i]!.id, n.id))
    expect(validateFlow(flow(nodes, edges))).toMatchObject({ ok: false })
    expect(() => Schema.decodeUnknownSync(FlowGraphSchema)(flow(nodes, edges))).toThrow()
  })
})

describe("nextNode and synthesizeFlow", () => {
  test("follows the branch taken", () => {
    const g = flow([trigger, read, cond, agent, end], [edge("t", "r"), edge("r", "c"), edge("c", "a", "yes"), edge("c", "e", "no")])
    expect(nextNode(g, "c", "no")?.id).toBe("e")
    expect(nextNode(g, "t")?.id).toBe("r")
    expect(nextNode(g, "a")).toBeUndefined()
  })
  test("an old routine is its trigger, one agent step and the end", () => {
    const g = synthesizeFlow({ prompt: "Check CI", cron: "0 9 * * 1-5", token: null, onDayStart: false, lookFirst: false, watch: null })
    expect(g.nodes.map((n) => n.kind)).toEqual(["trigger", "agent", "end"])
    expect(g.nodes[0]!.config).toEqual({ on: "schedule", cron: "0 9 * * 1-5" })
    expect(validateFlow(g)).toEqual({ ok: true })
    expect(Schema.decodeUnknownSync(FlowGraphSchema)(g)).toEqual(g)
  })
})
