// Sidebar rows (the prototype's tree): one 28px height (DESIGN.md Scale Rule), one radius, the active row sits
// on the canvas tone with a hairline. NavItem is a plain React Aria button; the project tree is a React Aria
// Tree, so it gets one Tab stop, arrow keys, type-ahead, aria-level, and drag and drop (pointer, keyboard and
// screen reader) from the library instead of hand-written handlers.
import { type ReactNode, useRef } from "react"
import {
  Button,
  type DragAndDropHooks,
  type DragAndDropOptions,
  DropIndicator,
  type DropTarget,
  type Key,
  Tree,
  TreeItem,
  TreeItemContent,
  useDragAndDrop
} from "react-aria-components"
import { cn } from "@/lib/utils"
import { ChevronDown, ChevronRight, GripVertical } from "./icons"

const row =
  "flex w-full min-w-0 shrink-0 cursor-default items-center gap-2.5 rounded-control border text-left text-base outline-none transition-colors duration-120 ease-out motion-reduce:transition-none"
const state = (active: boolean | undefined) => (active ? "border-subtle bg-canvas font-medium text-fg" : "border-transparent text-secondary")
const glyphBox = "flex size-5 shrink-0 items-center justify-center text-muted [&_svg]:size-4"

export function NavItem({
  active,
  icon,
  trailing,
  onPress,
  children,
  className,
  "aria-label": ariaLabel
}: {
  active?: boolean
  icon?: ReactNode
  trailing?: ReactNode
  onPress: () => void
  children: ReactNode
  className?: string
  "aria-label"?: string
}) {
  return (
    <Button
      onPress={onPress}
      {...(active && { "aria-current": "page" as const })}
      {...(ariaLabel && { "aria-label": ariaLabel })}
      className={cn(
        row,
        "h-control-sm px-2 data-focus-visible:ring-2 data-focus-visible:ring-accent",
        state(active),
        !active && "data-hovered:bg-control-hover data-hovered:text-fg data-pressed:bg-control-active",
        className
      )}
    >
      {icon && <span className={glyphBox}>{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing}
    </Button>
  )
}

// Uppercase group label with an optional action (e.g. "+" next to Projects).
export function NavLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mt-4 flex h-control-sm shrink-0 items-center pr-1 pl-2 text-xs font-medium uppercase tracking-wide text-muted">
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {action}
    </div>
  )
}

// The tree of a sidebar section. Reordering comes in through `dragAndDropHooks` (useDragAndDrop).
export function NavTree({
  label,
  expandedKeys,
  onExpandedChange,
  dragAndDropHooks,
  children
}: {
  label: string
  expandedKeys?: Iterable<Key>
  onExpandedChange?: (keys: Set<Key>) => void
  dragAndDropHooks?: DragAndDropHooks
  children: ReactNode
}) {
  return (
    <Tree
      aria-label={label}
      keyboardNavigationBehavior="tab"
      {...(expandedKeys && { expandedKeys })}
      {...(onExpandedChange && { onExpandedChange })}
      {...(dragAndDropHooks && { dragAndDropHooks })}
      className="flex shrink-0 flex-col outline-none"
    >
      {children}
    </Tree>
  )
}

export type NavKey = Key

// Where a dragged row will land: an accent hairline between rows.
const navDropIndicator = (target: DropTarget) => (
  <DropIndicator target={target} className="relative z-10 -my-px h-0.5 rounded-full outline-none data-drop-target:bg-accent" />
)

// One row of the tree. A group (project) has children and a chevron; a leaf (chat) can carry a second line.
// Actions (new chat, settings) show on hover or focus in place of the trailing count, never over the chevron,
// and take no clicks while hidden.
export function NavTreeItem({
  id,
  textValue,
  active,
  glyph,
  title,
  detail,
  trailing,
  actions,
  onAction,
  dragLabel,
  children
}: {
  id: Key
  textValue: string
  active?: boolean
  glyph?: ReactNode
  title: ReactNode
  detail?: ReactNode
  trailing?: ReactNode
  actions?: ReactNode
  onAction: () => void
  dragLabel?: string
  children?: ReactNode
}) {
  return (
    <TreeItem
      id={id}
      textValue={textValue}
      onAction={onAction}
      className={({ level }) => cn("group/row shrink-0 py-px outline-none data-dragging:opacity-50", level > 1 && "ml-4 border-l border-strong pl-1.5")}
    >
      <TreeItemContent>
        {({ hasChildItems, isExpanded, isFocusVisible, isHovered, isPressed, allowsDragging }) => (
          <div
            {...(active && { "aria-current": "page" as const })}
            className={cn(
              row,
              "relative px-2",
              detail ? "min-h-control-sm py-1" : "h-control-sm",
              state(active),
              !active && (isHovered || isFocusVisible) && "bg-control-hover text-fg",
              !active && isPressed && "bg-control-active",
              isFocusVisible && "ring-2 ring-accent"
            )}
          >
            {allowsDragging && dragLabel && (
              <Button slot="drag" aria-label={dragLabel} className="sr-only data-focus-visible:not-sr-only">
                <GripVertical className="size-3.5" />
              </Button>
            )}
            {glyph && <span className={glyphBox}>{glyph}</span>}
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{title}</span>
              {detail && <span className="flex min-w-0 items-center gap-1.5 text-sm font-normal text-muted [&_svg]:size-3">{detail}</span>}
            </span>
            {trailing && (
              <span className={cn("flex shrink-0 items-center text-sm font-normal text-muted tabular-nums", actions && "group-focus-within/row:invisible group-hover/row:invisible")}>
                {trailing}
              </span>
            )}
            {actions && (
              <span
                className={cn(
                  "pointer-events-none absolute inset-y-0 flex items-center bg-inherit opacity-0 transition-opacity duration-120 group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100 group-hover/row:pointer-events-auto group-hover/row:opacity-100 motion-reduce:transition-none",
                  hasChildItems ? "right-7" : "right-1"
                )}
              >
                {actions}
              </span>
            )}
            {hasChildItems && (
              <Button slot="chevron" className="flex size-5 shrink-0 items-center justify-center rounded-inline text-muted outline-none data-hovered:text-fg">
                {isExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              </Button>
            )}
          </div>
        )}
      </TreeItemContent>
      {children}
    </TreeItem>
  )
}

// Drag and drop that only reorders inside one group: a row drops before or after a row of its own group,
// never on a row and never into another group. The group's new order is saved as a whole.
export function useNavReorder({
  groupOf,
  orderOf,
  save
}: {
  groupOf: (key: string) => string | null | undefined // undefined: not draggable (a "show more" row)
  orderOf: (group: string | null) => ReadonlyArray<string>
  save: (group: string | null, keys: ReadonlyArray<string>) => Promise<unknown>
}) {
  const dragged = useRef<ReadonlyArray<string>>([])
  const groupOfDragged = () => {
    const groups = new Set(dragged.current.map(groupOf))
    const [group] = groups
    return groups.size === 1 ? group : undefined
  }
  const options: DragAndDropOptions = {
    getItems: (keys) => [...keys].map((k) => ({ "text/plain": String(k) })),
    onDragStart: (e) => {
      dragged.current = [...e.keys].map(String)
    },
    getDropOperation: (target) => {
      const group = groupOfDragged()
      const ok = group !== undefined && target.type === "item" && target.dropPosition !== "on" && groupOf(String(target.key)) === group
      return ok ? "move" : "cancel"
    },
    onReorder: (e) => {
      const group = groupOfDragged()
      const target = String(e.target.key)
      if (group === undefined || groupOf(target) !== group) return
      const keys = [...e.keys].map(String)
      const rest = orderOf(group).filter((k) => !keys.includes(k))
      const at = rest.indexOf(target) + (e.target.dropPosition === "after" ? 1 : 0)
      save(group, [...rest.slice(0, at), ...keys, ...rest.slice(at)]).catch(() => undefined) // the list refetches either way
    },
    renderDropIndicator: navDropIndicator
  }
  return useDragAndDrop(options).dragAndDropHooks
}
