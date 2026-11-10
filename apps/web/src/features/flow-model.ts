// Editing a routine's flow (spec 013), without React: the canvas and the List view both change the graph through
// these, so the two views can't drift. Every function returns a new graph; validity is the contract's validateFlow.
import { type FlowEdge, type FlowGraph, type FlowKind, type FlowNode, PORTS } from "@zorel/contracts"

export const ADDABLE: ReadonlyArray<Exclude<FlowKind, "trigger">> = ["tool", "agent", "check", "condition", "approval", "end"]
const ROW = 120 // vertical step between levels on the canvas
const LANE = 300 // horizontal step between the yes and no paths

const DEFAULTS: { [K in FlowKind]: Extract<FlowNode, { kind: K }>["config"] } = {
  trigger: { on: "manual" },
  tool: { serverId: "", tool: "", args: {} },
  agent: { prompt: "" },
  check: { onlyWhen: "" },
  condition: { rule: "hasItems", defaultBranch: "yes" },
  approval: { summary: "" },
  end: {}
}

export function freshId(graph: FlowGraph, kind: FlowKind): string {
  const taken = new Set(graph.nodes.map((n) => n.id))
  for (let i = 1; ; i++) if (!taken.has(`${kind}${i}`)) return `${kind}${i}`
}
const edgeId = (graph: FlowGraph) => {
  const taken = new Set(graph.edges.map((e) => e.id))
  for (let i = 1; ; i++) if (!taken.has(`e${i}`)) return `e${i}`
}
export const newNode = (graph: FlowGraph, kind: FlowKind): FlowNode => ({ id: freshId(graph, kind), kind, x: 0, y: 0, config: DEFAULTS[kind] }) as FlowNode

const outOf = (g: FlowGraph, id: string) => g.edges.filter((e) => e.from === id)
const intoOf = (g: FlowGraph, id: string) => g.edges.filter((e) => e.to === id)
const withEdge = (g: FlowGraph, e: Omit<FlowEdge, "id">): FlowGraph => ({ ...g, edges: [...g.edges, { ...e, id: edgeId(g) } as FlowEdge] })

// A new step right after `fromId` (on its `branch` path): the step that came next now follows the new one (on its
// "yes" path when the new one splits). An end step closes the path, so what followed is dropped from it.
export function insertAfter(graph: FlowGraph, fromId: string, kind: Exclude<FlowKind, "trigger">, branch?: "yes" | "no"): { graph: FlowGraph; id: string } {
  const node = newNode(graph, kind)
  const old = graph.edges.find((e) => e.from === fromId && (e.branch ?? undefined) === branch)
  let g: FlowGraph = { nodes: [...graph.nodes, node], edges: graph.edges.filter((e) => e !== old) }
  g = withEdge(g, { from: fromId, to: node.id, ...(branch && { branch }) })
  if (old && kind !== "end") g = withEdge(g, { from: node.id, to: old.to, ...(PORTS[kind].splits && { branch: "yes" as const }) })
  return { graph: layout(dropUnreached(g)), id: node.id }
}

// Removes a step; the step before it then leads to the one after (when there was exactly one way on).
export function removeNode(graph: FlowGraph, id: string): FlowGraph {
  const node = graph.nodes.find((n) => n.id === id)
  if (!node || node.kind === "trigger") return graph
  const after = outOf(graph, id)
  const next = after.length === 1 ? after[0]!.to : undefined
  let g: FlowGraph = { nodes: graph.nodes.filter((n) => n.id !== id), edges: graph.edges.filter((e) => e.from !== id && e.to !== id) }
  if (next) for (const e of intoOf(graph, id)) g = withEdge(g, { from: e.from, to: next, ...(e.branch && { branch: e.branch }) })
  return layout(dropUnreached(g))
}

// Steps no path reaches any more (the rest of a branch whose start was removed) go with it.
function dropUnreached(g: FlowGraph): FlowGraph {
  const trigger = g.nodes.find((n) => n.kind === "trigger")
  if (!trigger) return g
  const seen = new Set([trigger.id])
  const queue = [trigger.id]
  while (queue.length)
    for (const e of outOf(g, queue.shift()!))
      if (!seen.has(e.to)) {
        seen.add(e.to)
        queue.push(e.to)
      }
  return { nodes: g.nodes.filter((n) => seen.has(n.id)), edges: g.edges.filter((e) => seen.has(e.from) && seen.has(e.to)) }
}

// The List view's order: depth first from the trigger, the "yes" path before the "no" one; a step two paths share
// shows once, at the first.
export type ListItem = { readonly node: FlowNode; readonly depth: number; readonly branch?: "yes" | "no"; readonly parent?: string }
export function orderOf(graph: FlowGraph): ListItem[] {
  const trigger = graph.nodes.find((n) => n.kind === "trigger")
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const out: ListItem[] = []
  const seen = new Set<string>()
  const visit = (id: string, depth: number, branch?: "yes" | "no", parent?: string) => {
    const node = byId.get(id)
    if (!node || seen.has(id)) return
    seen.add(id)
    out.push({ node, depth, ...(branch && { branch }), ...(parent && { parent }) })
    const edges = outOf(graph, id).sort((a, b) => (a.branch === "no" ? 1 : 0) - (b.branch === "no" ? 1 : 0))
    for (const e of edges) visit(e.to, e.branch ? depth + 1 : depth, e.branch, e.branch ? id : undefined)
  }
  if (trigger) visit(trigger.id, 0)
  return out
}

// Swaps a step with the one after it on a straight path (dir 1), or with the one before (dir -1). Only plain steps
// move: the trigger, a split and what joins two paths stay where they are.
export const canMove = (graph: FlowGraph, id: string, dir: 1 | -1): boolean => !!pairOf(graph, id, dir)
function pairOf(graph: FlowGraph, id: string, dir: 1 | -1): [string, string] | undefined {
  const a = dir === 1 ? id : intoOf(graph, id).length === 1 ? intoOf(graph, id)[0]!.from : undefined
  if (!a) return undefined
  const aOut = outOf(graph, a)
  const b = aOut.length === 1 ? aOut[0]!.to : undefined
  const plain = (x: string) => {
    const n = graph.nodes.find((m) => m.id === x)
    return !!n && n.kind !== "trigger" && n.kind !== "end" && !PORTS[n.kind].splits
  }
  if (!b || !plain(a) || !plain(b) || intoOf(graph, b).length !== 1 || outOf(graph, b).length > 1) return undefined
  return [a, b]
}
export function move(graph: FlowGraph, id: string, dir: 1 | -1): FlowGraph {
  const pair = pairOf(graph, id, dir)
  if (!pair) return graph
  const [a, b] = pair
  // X → a → b → next becomes X → b → a → next.
  const edges = graph.edges.map((e) => {
    if (e.from === a && e.to === b) return { ...e, from: b, to: a }
    if (e.to === a) return { ...e, to: b }
    if (e.from === b) return { ...e, from: a }
    return e
  })
  return layout({ ...graph, edges })
}

// Positions on the canvas: one row per level, a split's "no" path one lane to the right.
export function layout(graph: FlowGraph): FlowGraph {
  const at = new Map<string, { x: number; y: number }>()
  for (const item of orderOf(graph)) {
    const parent = item.parent ? at.get(item.parent) : undefined
    const before = [...at.values()].at(-1)
    const x = parent ? parent.x + (item.branch === "no" ? LANE : 0) : (before?.x ?? 0)
    const y = parent ? parent.y + ROW : before ? before.y + ROW : 0
    at.set(item.node.id, { x, y: Math.max(y, ...[...at.values()].filter((p) => p.x === x).map((p) => p.y + ROW)) })
  }
  return { ...graph, nodes: graph.nodes.map((n) => ({ ...n, ...(at.get(n.id) ?? {}) })) }
}

// The steps before a node whose value a field can take (they give text or data, and every path to it passes them).
export function earlierValues(graph: FlowGraph, id: string): FlowNode[] {
  const before = new Set<string>()
  const queue = [id]
  while (queue.length)
    for (const e of intoOf(graph, queue.shift()!))
      if (!before.has(e.from)) {
        before.add(e.from)
        queue.push(e.from)
      }
  return orderOf(graph).map((i) => i.node).filter((n) => before.has(n.id) && (PORTS[n.kind].gives === "text" || PORTS[n.kind].gives === "data"))
}
