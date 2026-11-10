// The flow on a canvas (spec 013, the Flow board): React Flow, loaded only here (React.lazy from the editor), so no
// other screen carries it. It shows the same graph as the List view and changes it through flow-model.ts. A path the
// steps can't take is refused while it's drawn (connectionProblem, the same rule the server checks on save).
import "@xyflow/react/dist/style.css"
import "./routine-flow.css"
import { Background, BackgroundVariant, BaseEdge, type Connection, type Edge, EdgeLabelRenderer, type EdgeProps, getBezierPath, Handle, type Node, type NodeChange, type NodeProps, Panel, Position, ReactFlow, ReactFlowProvider, useReactFlow } from "@xyflow/react"
import { connectionProblem, type FlowGraph, type FlowNode, PORTS } from "@zorel/contracts"
import { t } from "@zorel/i18n"
import { createContext, memo, useContext, useRef, useState } from "react"
import { serversAtom, useList } from "../client.ts"
import { cx, IconButton, Menu, MenuItem, Plus, Scan, Tag, ZoomIn, ZoomOut } from "@/ui"
import { KindTile, kindIcon, nodeDetail, nodeTitle } from "./flow-kinds.tsx"
import { ADDABLE, insertAfter, removeNode } from "./flow-model.ts"

// open: the paths out of it nothing follows yet ("next" for a plain step), each with a "+" under it.
type Data = { step: FlowNode; detail: string; open: ReadonlyArray<"next" | "yes" | "no"> }
type StepNode = Node<Data, "step">
type StepEdge = Edge<{ branch?: "yes" | "no" }, "step">
type Add = (from: string, kind: (typeof ADDABLE)[number], branch?: "yes" | "no") => void
const Actions = createContext<{ add: Add }>({ add: () => {} })

// Where the yes and no handles sit under a split.
const SPLIT_AT = { yes: "30%", no: "70%" } as const

function AddMenu({ label, onAdd }: { label: string; onAdd: (kind: (typeof ADDABLE)[number]) => void }) {
  return (
    <Menu
      label={label}
      trigger={
        <IconButton size="xs" shape="pill" variant="secondary" label={label} className="nodrag nopan border border-subtle bg-surface">
          <Plus />
        </IconButton>
      }
    >
      {ADDABLE.map((kind) => (
        <MenuItem key={kind} icon={kindIcon(kind)} onAction={() => onAdd(kind)}>
          {t(`flows.kind.${kind}`)}
        </MenuItem>
      ))}
    </Menu>
  )
}

// One step: its tile, name and one line; handles where paths may start and end; a "+" under a step that ends a path.
const StepCard = memo(function StepCard({ id, data, selected }: NodeProps<StepNode>) {
  const { add } = useContext(Actions)
  const { step, detail } = data
  const ports = PORTS[step.kind]
  return (
    <div className={cx("relative flex h-14 w-62 items-center gap-3 rounded-card border bg-surface px-3", selected ? "border-accent ring-2 ring-accent-soft" : "border-strong", step.kind === "end" && "opacity-80")}>
      {ports.takes && <Handle type="target" position={Position.Top} />}
      <KindTile kind={step.kind} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{nodeTitle(step)}</span>
        <span className="truncate text-sm text-muted">{detail}</span>
      </span>
      {ports.splits ? (
        (["yes", "no"] as const).map((b) => <Handle key={b} id={b} type="source" position={Position.Bottom} style={{ left: SPLIT_AT[b] }} />)
      ) : step.kind !== "end" ? (
        <Handle type="source" position={Position.Bottom} />
      ) : null}
      {data.open.map((path) => (
        <div key={path} className="absolute top-full mt-3 -translate-x-1/2" style={{ left: path === "next" ? "50%" : SPLIT_AT[path] }}>
          <AddMenu label={path === "next" ? t("flows.canvas.addEnd") : t("flows.canvas.addOn", { path: t(`flows.branch.${path}`) })} onAdd={(kind) => add(id, kind, path === "next" ? undefined : path)} />
        </div>
      ))}
    </div>
  )
})

// A path: the line, its yes/no tag, and a "+" in the middle to put a step there.
function PathEdge({ id, source, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }: EdgeProps<StepEdge>) {
  const { add } = useContext(Actions)
  const [path, x, y] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  return (
    <>
      <BaseEdge id={id} path={path} className={cx(selected && "stroke-accent-text")} />
      <EdgeLabelRenderer>
        <div className="nodrag nopan pointer-events-auto absolute flex items-center gap-1.5" style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}>
          {data?.branch && <Tag>{t(`flows.branch.${data.branch}`)}</Tag>}
          <AddMenu label={t("flows.canvas.addHere")} onAdd={(kind) => add(source, kind, data?.branch)} />
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

// Module constants: React Flow re-creates every node when these change identity.
const NODE_TYPES = { step: StepCard }
const EDGE_TYPES = { step: PathEdge }

export default function FlowCanvas(props: { graph: FlowGraph; onGraph: (g: FlowGraph) => void; selected: string | undefined; onSelect: (id: string | undefined) => void }) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  )
}

function Canvas({ graph, onGraph, selected, onSelect }: { graph: FlowGraph; onGraph: (g: FlowGraph) => void; selected: string | undefined; onSelect: (id: string | undefined) => void }) {
  const servers = useList(serversAtom)
  const flow = useReactFlow()
  const [problem, setProblem] = useState<string>()
  const lastProblem = useRef<string>(undefined)
  const kindOf = (id: string | null) => graph.nodes.find((n) => n.id === id)?.kind
  const openOf = (n: FlowNode): Data["open"] => {
    if (n.kind === "end") return []
    const out = graph.edges.filter((e) => e.from === n.id)
    return PORTS[n.kind].splits ? (["yes", "no"] as const).filter((b) => !out.some((e) => e.branch === b)) : out.length ? [] : ["next"]
  }
  const nodes: StepNode[] = graph.nodes.map((n) => ({ id: n.id, type: "step", position: { x: n.x, y: n.y }, data: { step: n, detail: nodeDetail(n, servers), open: openOf(n) }, selected: n.id === selected, deletable: n.kind !== "trigger" }))
  const edges: StepEdge[] = graph.edges.map((e) => ({ id: e.id, source: e.from, target: e.to, type: "step", ...(e.branch && { sourceHandle: e.branch }), data: e.branch ? { branch: e.branch } : {} }))
  const add: Add = (from, kind, branch) => {
    const next = insertAfter(graph, from, kind, branch)
    onGraph(next.graph)
    onSelect(next.id)
  }
  const problemOf = (c: Connection | Edge) => {
    const from = kindOf(c.source)
    const to = kindOf(c.target)
    if (!from || !to || c.source === c.target) return t("flows.canvas.noSelf")
    return connectionProblem(from, to, (c.sourceHandle ?? undefined) as "yes" | "no" | undefined)
  }
  const onNodesChange = (changes: NodeChange<StepNode>[]) => {
    let g = graph
    for (const c of changes) {
      if (c.type === "position" && c.position) g = { ...g, nodes: g.nodes.map((n) => (n.id === c.id ? { ...n, x: Math.round(c.position!.x), y: Math.round(c.position!.y) } : n)) }
      if (c.type === "remove") g = removeNode(g, c.id)
      if (c.type === "select" && c.selected) onSelect(c.id)
    }
    if (g !== graph) onGraph(g)
  }
  return (
    <Actions.Provider value={{ add }}>
      <div className="zorel-flow relative min-h-0 min-w-0 flex-1" role="application" aria-label={t("flows.canvas.label")}>
        <ReactFlow<StepNode, StepEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={(changes) => {
            const gone = new Set(changes.flatMap((c) => (c.type === "remove" ? [c.id] : [])))
            if (gone.size) onGraph({ ...graph, edges: graph.edges.filter((e) => !gone.has(e.id)) })
          }}
          isValidConnection={(c) => {
            lastProblem.current = problemOf(c)
            return !lastProblem.current
          }}
          onConnect={(c) => {
            const branch = (c.sourceHandle ?? undefined) as "yes" | "no" | undefined
            // One way out per path: a new line from the same place replaces the old one.
            const kept = graph.edges.filter((e) => !(e.from === c.source && (e.branch ?? undefined) === branch))
            const ids = new Set(graph.edges.map((e) => e.id))
            let n = 1
            while (ids.has(`e${n}`)) n++
            onGraph({ ...graph, edges: [...kept, { id: `e${n}`, from: c.source, to: c.target, ...(branch && { branch }) }] })
            setProblem(undefined)
          }}
          onConnectEnd={(_e, state) => {
            if (!state.isValid && state.toNode && lastProblem.current) setProblem(lastProblem.current)
          }}
          onPaneClick={() => onSelect(undefined)}
          deleteKeyCode={["Backspace", "Delete"]}
          fitView
          fitViewOptions={{ maxZoom: 1 }}
          minZoom={0.3}
          maxZoom={1.5}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
          <Panel position="bottom-left">
            <div className="flex gap-0.5 rounded-card border border-subtle bg-surface p-0.5">
              <IconButton label={t("flows.canvas.zoomOut")} onPress={() => void flow.zoomOut()}>
                <ZoomOut />
              </IconButton>
              <IconButton label={t("flows.canvas.zoomIn")} onPress={() => void flow.zoomIn()}>
                <ZoomIn />
              </IconButton>
              <IconButton label={t("flows.canvas.fit")} onPress={() => void flow.fitView({ maxZoom: 1 })}>
                <Scan />
              </IconButton>
            </div>
          </Panel>
          {problem && (
            <Panel position="top-center">
              <p role="status" className="rounded-card border border-subtle bg-surface px-3 py-2 text-sm text-warning">
                {problem}
              </p>
            </Panel>
          )}
        </ReactFlow>
      </div>
    </Actions.Provider>
  )
}
