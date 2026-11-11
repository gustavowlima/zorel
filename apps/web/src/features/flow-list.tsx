// A routine's steps as a flow (spec 013, FR-002): one card per step, in order, joined by a line; a split's paths
// indented, each tagged yes or no. Open a step, add one after it (or on a split's yes or no path), remove it, or drag
// it by its handle along a straight path (React Aria's drag and drop: also by keyboard, focus the handle, Enter,
// arrows, Enter). Only plain steps move: the trigger, a split and what joins two paths keep their place, so they show
// no handle and a drop that would break the flow isn't offered.
import { type FlowGraph, PORTS } from "@zorel/contracts"
import { t } from "@zorel/i18n"
import { serversAtom, useList } from "../client.ts"
import { CircleAlert, cn, DragList, IconButton, Menu, MenuItem, MenuSeparator, Plus, Tag, Trash2 } from "@/ui"
import { KindTile, kindIcon, nodeDetail, nodeTitle } from "./flow-kinds.tsx"
import { ADDABLE, canMove, insertAfter, moveTo, orderOf, removeNode } from "./flow-model.ts"

// The flow's geometry, from two numbers: a path one level deeper shifts its card STEP px right (every card keeps the
// same width), and the line from the step above comes down at ICON_CENTER px into that step's card (its padding, the
// drag handle, the gap and half the kind tile).
const STEP = 24
const ICON_CENTER = 58

// issue: the step that has something to fix, and what: it wears the warning and says it in place of its detail.
export function FlowList({ graph, onGraph, selected, onSelect, issue }: { graph: FlowGraph; onGraph: (g: FlowGraph) => void; selected: string | undefined; onSelect: (id: string) => void; issue?: { nodeId: string; message: string } | undefined }) {
  const servers = useList(serversAtom)
  const add = (from: string, kind: (typeof ADDABLE)[number], branch?: "yes" | "no") => {
    const next = insertAfter(graph, from, kind, branch)
    onGraph(next.graph)
    onSelect(next.id)
  }
  const order = orderOf(graph)
  // Every card the same width: a deeper path shifts its card right by one indent step, it doesn't shrink it.
  const width = `calc(100% - ${Math.max(0, ...order.map((i) => i.depth)) * STEP}px)`
  return (
    <DragList
      label={t("newRoutine.steps")}
      items={order.map((i) => ({ ...i, id: i.node.id }))}
      textOf={(i) => nodeTitle(i.node)}
      handleLabel={(i) => t("flows.list.drag", { step: nodeTitle(i.node) })}
      canDrag={(i) => canMove(graph, i.id, -1) || canMove(graph, i.id, 1)}
      canDrop={(id, target, position) => !!moveTo(graph, id, target, position)}
      onDrop={(id, target, position) => {
        const next = moveTo(graph, id, target, position)
        if (next) onGraph(next)
      }}
      onAction={onSelect}
    >
      {({ node, depth, branch }, handle) => {
        const paths = PORTS[node.kind].splits ? (["yes", "no"] as const) : node.kind === "end" ? [] : ([undefined] as const)
        return (
          <div className="flex flex-col">
            {/* The flow's line from the step above: a path's first step hangs from its split, one level up. */}
            {node.kind !== "trigger" && <span aria-hidden="true" className="h-4 border-l border-strong" style={{ marginLeft: (branch ? depth - 1 : depth) * STEP + ICON_CENTER }} />}
            <div style={{ marginLeft: depth * STEP, width }}>
            <div
              className={cn(
                "flex min-h-14 cursor-default items-center gap-3 rounded-card border bg-surface py-2.5 pr-3 pl-2 transition-colors duration-120 ease-out group-data-focus-visible:ring-2 group-data-focus-visible:ring-accent group-data-hovered:border-strong motion-reduce:transition-none",
                issue?.nodeId === node.id ? "border-warning" : selected === node.id ? "border-accent-line bg-accent-faint" : "border-subtle"
              )}
            >
              {handle}
              <KindTile kind={node.kind} size="sm" />
              <span className="flex min-w-0 flex-1 flex-col">
                {/* A path's first step says which path (after its icon, so every icon sits in the line's column). */}
                <span className="flex min-w-0 items-center gap-2">
                  {branch && <Tag>{t(`flows.branch.${branch}`)}</Tag>}
                  <span className="truncate font-medium">{nodeTitle(node)}</span>
                </span>
                {issue?.nodeId === node.id ? (
                  <span className="flex min-w-0 items-center gap-1.5 text-sm text-warning">
                    <CircleAlert className="size-3.5 shrink-0" />
                    <span className="truncate">{issue.message}</span>
                  </span>
                ) : (
                  <span className="truncate text-sm text-muted">{nodeDetail(node, servers)}</span>
                )}
              </span>
              <span className="flex shrink-0 items-center">
                {paths.length > 0 && (
                  <Menu
                    label={t("flows.list.add")}
                    trigger={
                      <IconButton label={t("flows.list.add")}>
                        <Plus />
                      </IconButton>
                    }
                  >
                    {paths.map((path, i) => [
                      i > 0 && <MenuSeparator key={`sep-${path}`} />,
                      ...ADDABLE.map((kind) => (
                        <MenuItem key={`${path ?? "next"}-${kind}`} icon={kindIcon(kind)} onAction={() => add(node.id, kind, path)}>
                          {path ? t("flows.list.addOn", { kind: t(`flows.kind.${kind}`), path: t(`flows.branch.${path}`) }) : t(`flows.kind.${kind}`)}
                        </MenuItem>
                      ))
                    ])}
                  </Menu>
                )}
                {node.kind !== "trigger" && (
                  <IconButton label={t("flows.list.remove", { step: nodeTitle(node) })} onPress={() => onGraph(removeNode(graph, node.id))}>
                    <Trash2 />
                  </IconButton>
                )}
              </span>
            </div>
            </div>
          </div>
        )
      }}
    </DragList>
  )
}
