// Sidebar rows (the one sidebar, 2026-11-05, after Zeron's): rows on the frame, a quiet hover wash, section titles in
// sentence case. A project is a subtitle: its tile, its name, and on the right its chat count or its state (how many
// wait for you, a spinner while working); its chats hang from it on a tree, one line each, a second only when one
// needs you or failed. NavItem is a plain React Aria button; the trees are React Aria Trees,
// so they get one Tab stop, arrow keys, type-ahead, aria-level, and drag and drop (pointer, keyboard and
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
import { ChevronRight, GripVertical } from "./icons"
import { Tooltip } from "./tooltip"

const row =
  "flex w-full min-w-0 shrink-0 cursor-default items-center gap-2.5 rounded-control border text-left text-base outline-none transition-colors duration-120 ease-out motion-reduce:transition-none"
const state = (active: boolean | undefined) => (active ? "border-subtle bg-canvas font-medium text-fg" : "border-transparent text-secondary")
// A row's actions (the ⋯, +) sit over what the row shows on the right (the time, the count): they appear on hover,
// focus or touch, and stay while a menu opened from them is open (its popover lives outside the row, so the row
// loses hover and focus). The `peer` class lets that spot hide while they show.
const ACTIONS =
  "peer pointer-events-none absolute inset-y-0 flex items-center opacity-0 transition-opacity duration-120 group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100 group-hover/row:pointer-events-auto group-hover/row:opacity-100 has-aria-expanded:pointer-events-auto has-aria-expanded:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100 motion-reduce:transition-none"
const HIDE_FOR_ACTIONS = "group-focus-within/row:invisible group-hover/row:invisible peer-has-aria-expanded:invisible pointer-coarse:invisible"
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
        "h-control px-2.5 data-focus-visible:ring-2 data-focus-visible:ring-accent",
        state(active),
        !active && "data-hovered:bg-hover data-hovered:text-fg data-pressed:bg-control-active",
        className
      )}
    >
      {icon && <span className={glyphBox}>{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing}
    </Button>
  )
}

// Section title in sentence case with an optional icon in the icon column, a `hint` tooltip on the title and an
// action (e.g. "+"). With `onToggle`, the title is a button that collapses and expands the section; its arrow
// follows the name. While collapsed, `summary` (a count of what needs you) shows before the action.
export function NavLabel({
  children,
  icon,
  hint,
  summary,
  action,
  expanded,
  onToggle
}: {
  children: ReactNode
  icon?: ReactNode
  hint?: string
  summary?: ReactNode
  action?: ReactNode
  expanded?: boolean
  onToggle?: () => void
}) {
  const title = onToggle ? (
    <Button
      onPress={onToggle}
      aria-expanded={!!expanded}
      className="-ml-1 flex h-control-xs min-w-0 cursor-default items-center gap-1 rounded-control px-1 outline-none transition-colors duration-120 ease-out data-hovered:text-fg data-focus-visible:ring-2 data-focus-visible:ring-accent motion-reduce:transition-none"
    >
      <span className="truncate">{children}</span>
      <ChevronRight aria-hidden="true" className={cn("size-3 shrink-0 transition-transform duration-150 ease-out motion-reduce:transition-none", expanded && "rotate-90")} />
    </Button>
  ) : (
    <span className="min-w-0 truncate">{children}</span>
  )
  return (
    <div className="flex h-control-sm shrink-0 items-center gap-2.5 pr-0.5 pl-2.5 text-sm font-medium text-secondary">
      {icon && <span className={cn(glyphBox, "[&_svg]:size-3.5")}>{icon}</span>}
      <span className="flex min-w-0 flex-1">{hint && onToggle ? <Tooltip content={hint}>{title}</Tooltip> : title}</span>
      {!expanded && summary}
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

// One row of the tree. A group (project) shows its icon in the icon column (its tile, which turns into the opening
// arrow on hover or focus) and keeps its state on the right (a count, waiting chats or a spinner); its actions (+, ⋯)
// take that spot on hover or focus, and stay shown on touch. A leaf (chat) is its title and time, 40px tall, with a
// second line (`detail`) only when it has something to say; the actions replace the time on hover, focus or touch, so
// the line never jumps. A group's leaves hang from a tree: a trunk down from the group's icon and a rounded elbow to
// each title, the trunk ending at the `last` one; their hover and the open one's wash fade in from the trunk
// (.tree-wash) instead of starting on it. `quiet` is the "show more" row: 28px, muted, aligned with the titles.
export function NavTreeItem({
  id,
  textValue,
  active,
  leading,
  groupIcon,
  strong,
  quiet,
  title,
  detail,
  trailing,
  actions,
  onAction,
  dragLabel,
  nested = false,
  last = false,
  tooltip,
  children
}: {
  id: Key
  textValue: string
  active?: boolean
  leading?: ReactNode // a leaf's avatar
  groupIcon?: (open: boolean) => ReactNode // a group's icon (the folder)
  strong?: boolean // waiting, unread or open: the title is medium weight
  quiet?: boolean // a "show more" row
  title: ReactNode
  detail?: ReactNode
  trailing?: ReactNode
  actions?: ReactNode
  onAction: () => void
  dragLabel?: string
  nested?: boolean // a row inside a group (a project's chat): on the group's tree, its title past the elbow
  last?: boolean // the group's last row: the trunk ends in its elbow
  tooltip?: string // what the row leaves out (who answers, the model), on hover
  children?: ReactNode
}) {
  return (
    <TreeItem
      id={id}
      textValue={textValue}
      onAction={onAction}
      className="group/row shrink-0 py-px outline-none data-dragging:opacity-50"
    >
      <TreeItemContent>
        {({ hasChildItems, isExpanded, isFocusVisible, isHovered, isPressed, allowsDragging }) => (
          <div
            {...(active && { "aria-current": "page" as const })}
            {...(tooltip && { title: tooltip })}
            className={cn(
              row,
              "relative border-transparent",
              hasChildItems
                ? "h-9 px-2.5 font-medium text-fg"
                : quiet
                  ? cn("h-control-sm pr-2.5", nested ? "pl-10" : "pl-2.5")
                  : cn(detail ? "h-[58px]" : "h-10", nested ? "pr-2.5 pl-10" : "px-2.5"),
              // Under a group the wash fades in from the trunk; elsewhere it's a plain row's.
              !hasChildItems && nested
                ? (active || isHovered || isFocusVisible) && cn("tree-wash", active ? "[--wash:var(--z-bg-control-hover)]" : "[--wash:var(--z-bg-hover)]")
                : active
                  ? "bg-control-hover"
                  : (isHovered || isFocusVisible) && "bg-hover",
              !active && (isHovered || isFocusVisible) && "text-fg",
              !active && isPressed && !nested && "bg-control-active",
              isFocusVisible && "ring-2 ring-accent"
            )}
          >
            {allowsDragging && dragLabel && (
              <Button slot="drag" aria-label={dragLabel} className="sr-only data-focus-visible:not-sr-only">
                <GripVertical className="size-3.5" />
              </Button>
            )}
            {/* The tree: the trunk (x 20, under the group's icon) runs straight through every row but the last, and an
                8px arc branches off it to the middle of the title's line (y 20; 14 on a quiet row); the last row's
                elbow comes down from its top instead, where the trunk ends. Offsets count from inside the row's 1px
                border, so the lines reach 2px past it (that border and the row's 1px gap) to meet the next row's. */}
            {nested && !hasChildItems &&
              (last ? (
                <span aria-hidden="true" className={cn("pointer-events-none absolute -top-0.5 left-5 w-3 rounded-bl-lg border-b border-l border-strong", quiet ? "h-4" : "h-5.5")} />
              ) : (
                <>
                  <span aria-hidden="true" className="pointer-events-none absolute -top-0.5 -bottom-0.5 left-5 border-l border-strong" />
                  <span aria-hidden="true" className={cn("pointer-events-none absolute left-5 h-2 w-3 rounded-bl-lg border-b border-l border-strong", quiet ? "top-1.5" : "top-3")} />
                </>
              ))}
            {/* An open group with rows: the trunk starts under its icon. */}
            {hasChildItems && isExpanded && <span aria-hidden="true" className="pointer-events-none absolute top-7.5 -bottom-0.5 left-5 border-l border-strong" />}
            {hasChildItems && (
              // The icon column: the folder, which gives way to the arrow (it opens and closes the group) on hover or focus.
              <Button slot="chevron" className={cn(glyphBox, "relative rounded-control outline-none data-hovered:text-fg")}>
                <span className="group-focus-within/row:hidden group-hover/row:hidden">{groupIcon?.(!!isExpanded)}</span>
                <ChevronRight className={cn("hidden transition-transform duration-150 ease-out group-focus-within/row:block group-hover/row:block motion-reduce:transition-none", isExpanded && "rotate-90")} />
              </Button>
            )}
            {leading}
            {detail ? (
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex min-w-0 items-center gap-2">
                  <span className={cn("min-w-0 flex-1 truncate text-fg", (strong || active) && "font-medium")}>{title}</span>
                  {(trailing || actions) && (
                    <span className={cn("relative flex h-5 shrink-0 items-center justify-end", actions && "min-w-6")}>
                      {actions && <span className={cn(ACTIONS, "right-0")}>{actions}</span>}
                      {trailing && <span className={cn("text-sm font-normal text-muted tabular-nums", actions && HIDE_FOR_ACTIONS)}>{trailing}</span>}
                    </span>
                  )}
                </span>
                <span className="flex min-w-0 items-center gap-2 text-sm font-normal text-muted">{detail}</span>
              </span>
            ) : (
              <span className={cn("min-w-0 flex-1 truncate", quiet ? "text-sm text-muted" : strong || active ? "font-medium text-fg" : hasChildItems ? undefined : "text-secondary")}>{title}</span>
            )}
            {actions && !detail && <span className={cn(ACTIONS, "right-1.5")}>{actions}</span>}
            {trailing && !detail && (
              <span className={cn("flex shrink-0 items-center text-sm font-normal text-muted tabular-nums", actions && HIDE_FOR_ACTIONS)}>{trailing}</span>
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
