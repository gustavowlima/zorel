// A list you reorder by dragging a row's handle (or with the keyboard: focus the handle, Enter, arrows, Enter), as
// React Aria's GridList drag and drop. Rows keep their own controls; the handle is the only drag start.
import { type ReactNode, useRef } from "react"
import { Button as AriaButton, DropIndicator, GridList, GridListItem, useDragAndDrop } from "react-aria-components"
import { cn } from "@/lib/utils"
import { GripVertical } from "./icons"
import { Reflow } from "./motion"

// Where a drop will land: a line that grows in from the left when it's the target (shared with the sidebar's trees).
export const DROP_LINE = "-my-px h-0.5 origin-left scale-x-0 rounded-full bg-accent opacity-0 outline-none transition-[opacity,scale] duration-150 ease-out data-drop-target:scale-x-100 data-drop-target:opacity-100 motion-reduce:transition-none"
// The row being dragged steps back while its copy follows the pointer.
const DRAGGING = "transition-[opacity,scale] duration-150 ease-out data-dragging:scale-[0.98] data-dragging:opacity-40 motion-reduce:transition-none"

export function SortableList<T>({
  items,
  label,
  handleLabel,
  textOf,
  onReorder,
  idOf,
  children,
  className
}: {
  items: ReadonlyArray<T>
  label: string
  handleLabel: (item: T, index: number) => string
  textOf: (item: T) => string // for typeahead and screen readers
  idOf?: (item: T) => string // a stable id, so a moved row glides to its place (else its position)
  onReorder: (next: T[]) => void
  children: (item: T, index: number) => ReactNode
  className?: string
}) {
  const rows = items.map((item, i) => ({ id: idOf ? idOf(item) : String(i), item, index: i }))
  const { dragAndDropHooks } = useDragAndDrop({
    getItems: (keys) => [...keys].map((k) => ({ "text/plain": String(k) })),
    onReorder: (e) => {
      const moving = new Set([...e.keys].map(String))
      const rest = rows.filter((r) => !moving.has(r.id))
      const at = rest.findIndex((r) => r.id === String(e.target.key)) + (e.target.dropPosition === "after" ? 1 : 0)
      const moved = rows.filter((r) => moving.has(r.id))
      onReorder([...rest.slice(0, at), ...moved, ...rest.slice(at)].map((r) => r.item))
    },
    renderDropIndicator: (target) => <DropIndicator target={target} className={DROP_LINE} />
  })
  return (
    <GridList aria-label={label} items={rows} dragAndDropHooks={dragAndDropHooks} className={cn("flex flex-col gap-2 outline-none", className)}>
      {(row) => (
        <GridListItem id={row.id} textValue={textOf(row.item)} className={cn("rounded-control outline-none data-focus-visible:ring-2 data-focus-visible:ring-accent", DRAGGING)}>
          <Reflow className="flex items-center gap-2">
          <AriaButton
            slot="drag"
            aria-label={handleLabel(row.item, row.index)}
            className="flex size-control-xs shrink-0 cursor-grab items-center justify-center rounded-control text-dim outline-none data-focus-visible:ring-2 data-focus-visible:ring-accent data-hovered:text-fg [&_svg]:size-3.5"
          >
            <GripVertical />
          </AriaButton>
          {children(row.item, row.index)}
          </Reflow>
        </GridListItem>
      )}
    </GridList>
  )
}

// A list whose rows move by a handle only where the owner allows it (a flow's steps along a straight path): rows
// that can't move show no handle, and a drop that isn't allowed shows no line. `children` gets the row and its handle
// (or a placeholder of the same width). A row's press is its action (onAction).
export function DragList<T extends { id: string }>({
  items,
  label,
  textOf,
  handleLabel,
  canDrag,
  canDrop,
  onDrop,
  onAction,
  children,
  className
}: {
  items: ReadonlyArray<T>
  label: string
  textOf: (item: T) => string
  handleLabel: (item: T) => string
  canDrag: (item: T) => boolean
  canDrop: (id: string, target: string, position: "before" | "after") => boolean
  onDrop: (id: string, target: string, position: "before" | "after") => void
  onAction: (id: string) => void
  children: (item: T, handle: ReactNode) => ReactNode
  className?: string
}) {
  const dragging = useRef<string>(undefined)
  const { dragAndDropHooks } = useDragAndDrop({
    getItems: (keys) => [...keys].map((k) => ({ "text/plain": String(k) })),
    onDragStart: (e) => {
      dragging.current = String([...e.keys][0])
    },
    onDragEnd: () => {
      dragging.current = undefined
    },
    getDropOperation: (target) => (target.type === "item" && target.dropPosition !== "on" && dragging.current && canDrop(dragging.current, String(target.key), target.dropPosition) ? "move" : "cancel"),
    onReorder: (e) => {
      if (e.target.dropPosition !== "on") onDrop(String([...e.keys][0]), String(e.target.key), e.target.dropPosition)
    },
    renderDropIndicator: (target) => <DropIndicator target={target} className={DROP_LINE} />
  })
  return (
    <GridList aria-label={label} items={items} dragAndDropHooks={dragAndDropHooks} onAction={(key) => onAction(String(key))} className={cn("flex flex-col outline-none", className)}>
      {(item) => (
        <GridListItem id={item.id} textValue={textOf(item)} className={cn("group outline-none", DRAGGING)}>
          <Reflow className="flex flex-col">
          {children(
            item,
            canDrag(item) ? (
              <AriaButton
                slot="drag"
                aria-label={handleLabel(item)}
                className="flex size-control-xs shrink-0 cursor-grab items-center justify-center rounded-control text-dim outline-none data-focus-visible:ring-2 data-focus-visible:ring-accent data-hovered:text-fg [&_svg]:size-4"
              >
                <GripVertical />
              </AriaButton>
            ) : (
              <span aria-hidden="true" className="size-control-xs shrink-0" />
            )
          )}
          </Reflow>
        </GridListItem>
      )}
    </GridList>
  )
}
