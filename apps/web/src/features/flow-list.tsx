// The List view of a flow (spec 013, FR-002): the same graph as the canvas, in order, a split's paths indented.
// Every action the canvas has is here, by keyboard and at phone width: open a step, add one after it (or on a
// split's yes or no path), move it up or down a straight path, remove it.
import { type FlowGraph, PORTS } from "@zorel/contracts"
import { t } from "@zorel/i18n"
import { serversAtom, useList } from "../client.ts"
import { ArrowDown, ArrowUp, cx, IconButton, Menu, MenuItem, MenuSeparator, Plus, RowHit, Rows, Tag, Trash2 } from "@/ui"
import { KindTile, kindIcon, nodeDetail, nodeTitle } from "./flow-kinds.tsx"
import { ADDABLE, canMove, insertAfter, move, orderOf, removeNode } from "./flow-model.ts"

const INDENT = ["", "pl-6", "pl-12", "pl-18", "pl-24"] as const

export function FlowList({ graph, onGraph, selected, onSelect }: { graph: FlowGraph; onGraph: (g: FlowGraph) => void; selected: string | undefined; onSelect: (id: string) => void }) {
  const servers = useList(serversAtom)
  const add = (from: string, kind: (typeof ADDABLE)[number], branch?: "yes" | "no") => {
    const next = insertAfter(graph, from, kind, branch)
    onGraph(next.graph)
    onSelect(next.id)
  }
  return (
    <Rows>
      {orderOf(graph).map(({ node, depth, branch }) => {
        const paths = PORTS[node.kind].splits ? (["yes", "no"] as const) : node.kind === "end" ? [] : ([undefined] as const)
        return (
          <div key={node.id} className={cx("relative flex items-center gap-3 py-3", INDENT[Math.min(depth, INDENT.length - 1)])}>
            <RowHit label={t("flows.list.open", { step: nodeTitle(node) })} onPress={() => onSelect(node.id)} className={cx(selected === node.id && "bg-accent-faint")} />
            {branch && (
              <span className="pointer-events-none relative">
                <Tag>{t(`flows.branch.${branch}`)}</Tag>
              </span>
            )}
            <span className="pointer-events-none relative">
              <KindTile kind={node.kind} size="sm" />
            </span>
            <span className="pointer-events-none relative flex min-w-0 flex-1 flex-col">
              <span className="truncate font-medium">{nodeTitle(node)}</span>
              <span className="truncate text-sm text-muted">{nodeDetail(node, servers)}</span>
            </span>
            <span className="relative flex shrink-0 items-center">
              <IconButton label={t("flows.list.up")} isDisabled={!canMove(graph, node.id, -1)} onPress={() => onGraph(move(graph, node.id, -1))}>
                <ArrowUp />
              </IconButton>
              <IconButton label={t("flows.list.down")} isDisabled={!canMove(graph, node.id, 1)} onPress={() => onGraph(move(graph, node.id, 1))}>
                <ArrowDown />
              </IconButton>
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
        )
      })}
    </Rows>
  )
}
