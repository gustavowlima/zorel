// A list you reorder by dragging a row's handle (or with the keyboard: focus the handle, Enter, arrows, Enter), as
// React Aria's GridList drag and drop. Rows keep their own controls; the handle is the only drag start.
import type { ReactNode } from "react"
import { Button as AriaButton, DropIndicator, GridList, GridListItem, useDragAndDrop } from "react-aria-components"
import { cn } from "@/lib/utils"
import { GripVertical } from "./icons"

export function SortableList<T>({
  items,
  label,
  handleLabel,
  textOf,
  onReorder,
  children,
  className
}: {
  items: ReadonlyArray<T>
  label: string
  handleLabel: (item: T, index: number) => string
  textOf: (item: T) => string // for typeahead and screen readers
  onReorder: (next: T[]) => void
  children: (item: T, index: number) => ReactNode
  className?: string
}) {
  const rows = items.map((item, i) => ({ id: String(i), item }))
  const { dragAndDropHooks } = useDragAndDrop({
    getItems: (keys) => [...keys].map((k) => ({ "text/plain": String(k) })),
    onReorder: (e) => {
      const moving = new Set([...e.keys].map(String))
      const rest = rows.filter((r) => !moving.has(r.id))
      const at = rest.findIndex((r) => r.id === String(e.target.key)) + (e.target.dropPosition === "after" ? 1 : 0)
      const moved = rows.filter((r) => moving.has(r.id))
      onReorder([...rest.slice(0, at), ...moved, ...rest.slice(at)].map((r) => r.item))
    },
    renderDropIndicator: (target) => <DropIndicator target={target} className="-my-px h-0.5 rounded-full outline-none data-drop-target:bg-accent" />
  })
  return (
    <GridList aria-label={label} items={rows} dragAndDropHooks={dragAndDropHooks} className={cn("flex flex-col gap-2 outline-none", className)}>
      {(row) => (
        <GridListItem id={row.id} textValue={textOf(row.item)} className="flex items-center gap-2 rounded-control outline-none data-dragging:opacity-50 data-focus-visible:ring-2 data-focus-visible:ring-accent">
          <AriaButton
            slot="drag"
            aria-label={handleLabel(row.item, Number(row.id))}
            className="flex size-control-xs shrink-0 cursor-grab items-center justify-center rounded-control text-dim outline-none data-focus-visible:ring-2 data-focus-visible:ring-accent data-hovered:text-fg [&_svg]:size-3.5"
          >
            <GripVertical />
          </AriaButton>
          {children(row.item, Number(row.id))}
        </GridListItem>
      )}
    </GridList>
  )
}
