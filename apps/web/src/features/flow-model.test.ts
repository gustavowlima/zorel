import { describe, expect, test } from "bun:test"
import { type FlowGraph, synthesizeFlow, validateFlow } from "@zorel/contracts"
import { canMove, earlierValues, insertAfter, move, moveTo, orderOf, removeNode } from "./flow-model.ts"

const base = (): FlowGraph => synthesizeFlow({ prompt: "Sum up", cron: null, token: null, onDayStart: false, lookFirst: false, watch: null })
const ids = (g: FlowGraph) => orderOf(g).map((i) => i.node.id)

describe("flow-model", () => {
  test("insertAfter puts the step on the path; what came next follows it", () => {
    const { graph, id } = insertAfter(base(), "trigger", "tool")
    expect(ids(graph)).toEqual(["trigger", id, "agent", "end"])
    expect(validateFlow(graph).ok || (validateFlow(graph) as { field?: string }).field === "serverId").toBe(true)
  })
  test("a split keeps what followed on its yes path; the no path is empty until drawn", () => {
    const { graph, id } = insertAfter(base(), "trigger", "condition")
    expect(graph.edges.find((e) => e.from === id)).toMatchObject({ to: "agent", branch: "yes" })
    const withNo = insertAfter(graph, id, "end", "no")
    expect(orderOf(withNo.graph).find((i) => i.node.id === withNo.id)).toMatchObject({ branch: "no", depth: 1, parent: id })
  })
  test("removeNode joins the step before to the one after, and drops what no path reaches", () => {
    const g = removeNode(base(), "agent")
    expect(ids(g)).toEqual(["trigger", "end"])
    const { graph, id } = insertAfter(base(), "agent", "condition")
    const branched = insertAfter(graph, id, "agent", "no").graph
    expect(ids(removeNode(branched, id))).toEqual(["trigger", "agent"]) // two ways on: both paths go with it
    expect(removeNode(base(), "trigger")).toEqual(base())
  })
  test("move swaps neighbours on a straight path only", () => {
    const g = insertAfter(base(), "agent", "tool").graph // trigger → agent → tool1 → end
    expect(canMove(g, "agent", -1)).toBe(false) // the trigger stays first
    const moved = move(g, "agent", 1)
    expect(ids(moved)).toEqual(["trigger", "tool1", "agent", "end"])
    expect(ids(move(moved, "agent", -1))).toEqual(ids(g))
    const split = insertAfter(base(), "trigger", "condition").graph
    expect(canMove(split, "condition1", 1)).toBe(false)
  })
  test("moveTo drops a step before or after another on its path, and refuses across a split or past the trigger", () => {
    const g = insertAfter(insertAfter(base(), "agent", "tool").graph, "tool1", "check").graph // trigger → agent → tool1 → check1 → end
    expect(ids(moveTo(g, "check1", "agent", "before")!)).toEqual(["trigger", "check1", "agent", "tool1", "end"])
    expect(ids(moveTo(g, "agent", "check1", "after")!)).toEqual(["trigger", "tool1", "check1", "agent", "end"])
    expect(moveTo(g, "agent", "tool1", "before")).toBeUndefined() // already there
    expect(moveTo(g, "agent", "trigger", "before")).toBeUndefined()
    const split = insertAfter(g, "agent", "condition").graph
    expect(moveTo(split, "tool1", "agent", "before")).toBeUndefined() // the split is in the way
  })
  test("earlierValues lists the steps before that give a value", () => {
    const g = insertAfter(base(), "agent", "tool").graph
    expect(earlierValues(g, "tool1").map((n) => n.id)).toEqual(["trigger", "agent"])
    expect(earlierValues(g, "trigger")).toEqual([])
  })
  test("layout gives each level its own row", () => {
    const g = insertAfter(base(), "trigger", "tool").graph
    const ys = orderOf(g).map((i) => i.node.y)
    expect(new Set(ys).size).toBe(ys.length)
  })
})
