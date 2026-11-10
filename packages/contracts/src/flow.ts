// Routine flows (spec 013): a routine as a trigger and up to 30 steps. One definition, read by the editor (to refuse a
// connection or point at a missing field as the person works) and by the server (to refuse the same on save), so the
// two can't disagree. Pure: no I/O here.
import { Schema } from "effect"

export const MAX_STEPS = 30 // the trigger isn't counted
const NodeId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,40}$/))
const Text = (max: number) => Schema.String.check(Schema.isMaxLength(max))
const Pos = Schema.Finite

// A field's value: a literal, or what an earlier step gave ({ $from: "n2", path: "items.0.id" }).
export const ValueRef = Schema.Struct({ $from: NodeId, path: Schema.optional(Text(200)) })
export type ValueRef = typeof ValueRef.Type
export const isRef = (v: unknown): v is ValueRef =>
  !!v && typeof v === "object" && !Array.isArray(v) && typeof (v as { $from?: unknown }).$from === "string"

// Spec 013 P2. One time, or a day of every month (29–31 fall back to a shorter month's last day), in the person's zone.
export const LocalDate = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/))
export const LocalTime = Schema.String.check(Schema.isPattern(/^([01]\d|2[0-3]):[0-5]\d$/))
export const RoutineSchedule = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("once"), date: LocalDate, time: LocalTime }),
  Schema.Struct({ kind: Schema.Literal("monthly"), day: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 31 })), time: LocalTime })
])
export type RoutineSchedule = typeof RoutineSchedule.Type
// Minutes between a watched connector's checks, never under one.
export const WATCH_EVERY = [1, 5, 15, 60] as const
export const WatchEvery = Schema.Literals(WATCH_EVERY)

// message: a watch on a connector's channel (the same engine, named for what it watches).
export const TriggerConfig = Schema.Struct({
  on: Schema.Literals(["schedule", "once", "monthly", "dayStart", "watch", "message", "webhook", "manual"]),
  cron: Schema.optional(Text(100)),
  date: Schema.optional(LocalDate),
  time: Schema.optional(LocalTime),
  day: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 31 }))),
  every: Schema.optional(WatchEvery),
  serverId: Schema.optional(Schema.String),
  tool: Schema.optional(Text(200)),
  args: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  lookFirst: Schema.optional(Schema.Boolean)
})
export const ToolConfig = Schema.Struct({
  serverId: Schema.String,
  tool: Text(200),
  args: Schema.Record(Schema.String, Schema.Unknown),
  retries: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 })))
})
export const AgentConfig = Schema.Struct({ prompt: Text(8000) }) // the routine's own agent answers
export const CheckConfig = Schema.Struct({ onlyWhen: Text(2000) })
export const ConditionConfig = Schema.Struct({
  rule: Schema.Literals(["hasItems", "isEmpty", "contains", "equals", "ask"]),
  input: Schema.optional(ValueRef),
  arg: Schema.optional(Text(2000)),
  defaultBranch: Schema.Literals(["yes", "no"])
})
export const ApprovalConfig = Schema.Struct({ summary: Text(500), expiresMinutes: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1440 }))) })

const node = <K extends string, C extends Schema.Top>(kind: K, config: C) =>
  Schema.Struct({ id: NodeId, kind: Schema.Literal(kind), x: Pos, y: Pos, label: Schema.optional(Text(80)), config })
export const FlowNode = Schema.Union([
  node("trigger", TriggerConfig),
  node("tool", ToolConfig),
  node("agent", AgentConfig),
  node("check", CheckConfig),
  node("condition", ConditionConfig),
  node("approval", ApprovalConfig),
  node("end", Schema.Struct({}))
])
export type FlowNode = typeof FlowNode.Type
export type FlowKind = FlowNode["kind"]
export const FlowEdge = Schema.Struct({ id: NodeId, from: NodeId, to: NodeId, branch: Schema.optional(Schema.Literals(["yes", "no"])) })
export type FlowEdge = typeof FlowEdge.Type
export const FlowGraph = Schema.Struct({ nodes: Schema.Array(FlowNode).check(Schema.isMaxLength(MAX_STEPS + 1)), edges: Schema.Array(FlowEdge).check(Schema.isMaxLength(64)) })
export type FlowGraph = typeof FlowGraph.Type

// ---------- ports ----------
// What each kind hands on: text (an agent's reply), data (JSON: a trigger's event, a tool's result), or a decision
// (which way to go: the value before it flows on). `splits`: its paths carry "yes" / "no".
export type PortType = "text" | "data" | "decision"
export const PORTS: Record<FlowKind, { gives: PortType | null; splits: boolean; takes: boolean }> = {
  trigger: { gives: "data", splits: false, takes: false },
  tool: { gives: "data", splits: false, takes: true },
  agent: { gives: "text", splits: false, takes: true },
  check: { gives: "decision", splits: false, takes: true },
  condition: { gives: "decision", splits: true, takes: true },
  approval: { gives: "decision", splits: true, takes: true },
  end: { gives: null, splits: false, takes: true }
}

// Why a path from one kind to another can't be drawn (undefined: it can).
export function connectionProblem(from: FlowKind, to: FlowKind, branch?: "yes" | "no"): string | undefined {
  if (!PORTS[to].takes) return "Nothing can lead into the trigger."
  if (from === "end") return "An end step closes its path."
  if (PORTS[from].splits && !branch) return "Choose yes or no for this path."
  if (!PORTS[from].splits && branch) return "Only a condition or Ask me splits into yes and no."
  return undefined
}

// Why a field's value from an earlier step can't be used (undefined: it can).
export function referenceProblem(source: FlowKind | undefined, ref: ValueRef): string | undefined {
  if (!source) return `No step ${ref.$from}.`
  const gives = PORTS[source].gives
  if (gives === "decision" || gives === null) return "That step gives a decision, not a value."
  if (ref.path && gives !== "data") return "Only data can be read by a path."
  return undefined
}

// ---------- the whole graph ----------
export type FlowProblem = { readonly ok: false; readonly nodeId?: string; readonly field?: string; readonly problem: string }
const fail = (problem: string, nodeId?: string, field?: string): FlowProblem => ({ ok: false, problem, ...(nodeId && { nodeId }), ...(field && { field }) })
const blank = (v: unknown) => typeof v !== "string" || !v.trim()

// The fields a kind can't save without (the trigger's depend on what starts it).
const REQUIRED: Record<FlowKind, (n: FlowNode) => string | undefined> = {
  trigger: (n) => {
    const c = n.config as typeof TriggerConfig.Type
    if (c.on === "schedule" && blank(c.cron)) return "cron"
    if (c.on === "once" && blank(c.date)) return "date"
    if (c.on === "monthly" && !c.day) return "day"
    if ((c.on === "once" || c.on === "monthly") && blank(c.time)) return "time"
    if ((c.on === "watch" || c.on === "message") && blank(c.serverId)) return "serverId"
    if ((c.on === "watch" || c.on === "message") && blank(c.tool)) return "tool"
    return undefined
  },
  tool: (n) => {
    const c = n.config as typeof ToolConfig.Type
    return blank(c.serverId) ? "serverId" : blank(c.tool) ? "tool" : undefined
  },
  agent: (n) => (blank((n.config as typeof AgentConfig.Type).prompt) ? "prompt" : undefined),
  check: (n) => (blank((n.config as typeof CheckConfig.Type).onlyWhen) ? "onlyWhen" : undefined),
  condition: (n) => {
    const c = n.config as typeof ConditionConfig.Type
    if (c.rule !== "ask" && !c.input) return "input"
    if ((c.rule === "contains" || c.rule === "equals" || c.rule === "ask") && blank(c.arg)) return "arg"
    return undefined
  },
  approval: (n) => (blank((n.config as typeof ApprovalConfig.Type).summary) ? "summary" : undefined),
  end: () => undefined
}

// The references a node's settings hold, with the field each one is in.
function refsOf(n: FlowNode): Array<{ field: string; ref: ValueRef }> {
  if (n.kind === "tool") return Object.entries(n.config.args).flatMap(([field, v]) => (isRef(v) ? [{ field, ref: v }] : []))
  if (n.kind === "condition" && n.config.input) return [{ field: "input", ref: n.config.input }]
  return []
}

// Where the flow goes after a node: its one path, or the path of the branch it took.
export function nextNode(graph: FlowGraph, from: string, branch?: string | null): FlowNode | undefined {
  const e = graph.edges.find((x) => x.from === from && (x.branch ?? null) === (branch ?? null))
  return e && graph.nodes.find((n) => n.id === e.to)
}

export function validateFlow(graph: FlowGraph): { readonly ok: true } | FlowProblem {
  const byId = new Map<string, FlowNode>()
  for (const n of graph.nodes) {
    if (byId.has(n.id)) return fail("Two steps share this id.", n.id)
    byId.set(n.id, n)
  }
  const triggers = graph.nodes.filter((n) => n.kind === "trigger")
  if (triggers.length !== 1) return fail("A routine has exactly one trigger.")
  if (graph.nodes.length - 1 > MAX_STEPS) return fail(`A routine has at most ${MAX_STEPS} steps.`)
  const out = new Map<string, FlowEdge[]>()
  for (const e of graph.edges) {
    const from = byId.get(e.from)
    const to = byId.get(e.to)
    if (!from || !to) return fail("A path leads to a step that isn't there.", from ? e.from : e.to)
    const problem = connectionProblem(from.kind, to.kind, e.branch)
    if (problem) return fail(problem, e.to)
    const list = out.get(e.from) ?? []
    // One path at a time: one way out, or one per branch.
    if (list.some((x) => (x.branch ?? null) === (e.branch ?? null))) return fail(e.branch ? `The "${e.branch}" path is drawn twice.` : "A step can lead to only one next step.", e.from)
    out.set(e.from, [...list, e])
  }
  // Reachable from the trigger, and no way back (a loop).
  const trigger = triggers[0]!
  const state = new Map<string, "open" | "done">()
  const ancestors = new Map<string, Set<string>>([[trigger.id, new Set()]])
  const walk = (id: string, before: Set<string>): string | undefined => {
    if (state.get(id) === "open") return id
    const seen = ancestors.get(id) ?? new Set<string>()
    for (const a of before) seen.add(a)
    ancestors.set(id, seen)
    state.set(id, "open")
    for (const e of out.get(id) ?? []) {
      const loop = walk(e.to, new Set([...seen, id]))
      if (loop) return loop
    }
    state.set(id, "done")
    return undefined
  }
  const loop = walk(trigger.id, new Set())
  if (loop) return fail("This path loops back; repeat work by running the routine again.", loop)
  for (const n of graph.nodes) {
    if (!state.has(n.id)) return fail("No path reaches this step.", n.id)
    const field = REQUIRED[n.kind](n)
    if (field) return fail("This field is required.", n.id, field)
    for (const { field, ref } of refsOf(n)) {
      if (!ancestors.get(n.id)?.has(ref.$from)) return fail("A value can only come from a step before this one.", n.id, field)
      const problem = referenceProblem(byId.get(ref.$from)?.kind, ref)
      if (problem) return fail(problem, n.id, field)
    }
  }
  return { ok: true }
}

// A routine saved before flows (spec 012): its trigger, one agent step with its prompt, and the end.
export function synthesizeFlow(r: { prompt: string; cron: string | null; token: string | null; onDayStart: boolean; lookFirst: boolean; watch: { serverId: string; tool: string; args: Record<string, unknown> } | null }): FlowGraph {
  const config: typeof TriggerConfig.Type = r.watch
    ? { on: "watch", serverId: r.watch.serverId, tool: r.watch.tool, args: r.watch.args, lookFirst: r.lookFirst }
    : r.cron
      ? { on: "schedule", cron: r.cron }
      : r.onDayStart
        ? { on: "dayStart" }
        : r.token
          ? { on: "webhook" }
          : { on: "manual" }
  return {
    nodes: [
      { id: "trigger", kind: "trigger", x: 0, y: 0, config },
      { id: "agent", kind: "agent", x: 0, y: 160, config: { prompt: r.prompt } },
      { id: "end", kind: "end", x: 0, y: 320, config: {} }
    ],
    edges: [
      { id: "e1", from: "trigger", to: "agent" },
      { id: "e2", from: "agent", to: "end" }
    ]
  }
}

// ---------- a tool's inputs (the form and the server read them alike) ----------
export type JsonSchema = { readonly type?: unknown; readonly properties?: Readonly<Record<string, JsonSchema & { readonly description?: string; readonly enum?: ReadonlyArray<unknown>; readonly items?: JsonSchema; readonly minimum?: number; readonly maximum?: number; readonly format?: string; readonly title?: string }>>; readonly required?: ReadonlyArray<string> }
const TEXT_FIELDS = new Set(["text", "content", "message", "body"])
// The field of a write tool that takes a message: the one required string named like one.
export function textFieldOf(schema: Record<string, unknown>): string | undefined {
  const s = schema as JsonSchema
  const hits = (s.required ?? []).filter((f) => TEXT_FIELDS.has(f.toLowerCase()) && s.properties?.[f]?.type === "string")
  return hits.length === 1 ? hits[0] : undefined
}

// The read tool of the same connector that lists what a field holds the id of ("channel_id" → "list_channels"), the
// best first: a list, then a search, then a get.
const LIST_VERBS: Record<string, number> = { list: 0, search: 1, get: 2 }
export function listToolFor(field: string, tools: ReadonlyArray<{ readonly name: string; readonly cls: string }>): string | undefined {
  const m = /^(.+?)[_-]?(?:id|Id|ID)$/.exec(field)
  if (!m) return undefined
  const thing = m[1]!.replace(/[_-]/g, "").toLowerCase()
  const forms = new Set([thing, `${thing}s`, `${thing}es`, thing.replace(/y$/, "ies")])
  const ranked = tools
    .filter((t) => t.cls === "read")
    .map((t) => {
      const words = t.name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().split(/[^a-z0-9]+/)
      const verb = words.find((w) => w in LIST_VERBS)
      return { name: t.name, rank: verb !== undefined && words.some((w) => forms.has(w)) ? LIST_VERBS[verb]! : undefined }
    })
    .filter((t): t is { name: string; rank: number } => t.rank !== undefined)
    .sort((a, b) => a.rank - b.rank)
  return ranked[0]?.name
}
