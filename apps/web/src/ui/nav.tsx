// Sidebar rows (the prototype's tree): one height, one radius, the active row sits on the canvas tone with a
// hairline. React Aria buttons, so press feedback, focus ring and touch behave like every other control.
import type { ReactNode } from "react"
import { Button } from "react-aria-components"
import { cn } from "@/lib/utils"

const row =
  "flex w-full min-w-0 shrink-0 cursor-default items-center gap-2.5 rounded-control border text-left text-base outline-none transition-colors duration-120 ease-out data-focus-visible:ring-2 data-focus-visible:ring-accent motion-reduce:transition-none"
const state = (active: boolean | undefined) =>
  active ? "border-subtle bg-canvas font-medium text-fg" : "border-transparent text-secondary data-hovered:bg-control-hover data-hovered:text-fg data-pressed:bg-control-active"

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
      className={cn(row, "h-control px-2.5", state(active), className)}
    >
      {icon && <span className="flex size-5 shrink-0 items-center justify-center text-muted [&_svg]:size-4">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing}
    </Button>
  )
}

// Child row of a project (chat): title, and under it what is happening, when something is.
export function TreeItem({ active, title, detail, trailing, onPress }: { active?: boolean; title: ReactNode; detail?: ReactNode; trailing?: ReactNode; onPress: () => void }) {
  return (
    <Button onPress={onPress} {...(active && { "aria-current": "page" as const })} className={cn(row, "min-h-control px-2 py-1", state(active))}>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{title}</span>
        {detail && <span className="flex min-w-0 items-center gap-1.5 text-sm font-normal text-muted [&_svg]:size-3">{detail}</span>}
      </span>
      {trailing}
    </Button>
  )
}

// Uppercase group label with an optional action (e.g. "+" next to Projects).
export function NavLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mt-4 flex h-control-sm shrink-0 items-center pr-1 pl-2.5 text-xs font-medium uppercase tracking-wide text-muted">
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {action}
    </div>
  )
}

// Header row of a group in the tree (a project, General): the name toggles it open; actions (new chat,
// settings) take the place of the trailing count and chevron on hover or focus, so they never cost the name
// any width.
export function GroupRow({
  icon,
  name,
  expanded,
  active,
  onToggle,
  actions,
  trailing
}: {
  icon: ReactNode
  name: ReactNode
  expanded: boolean
  active?: boolean
  onToggle: () => void
  actions?: ReactNode
  trailing?: ReactNode
}) {
  return (
    <div
      className={cn(
        "group/row relative flex h-control shrink-0 items-center gap-1 rounded-control border pr-1 transition-colors duration-120 ease-out motion-reduce:transition-none",
        active ? "border-subtle bg-canvas" : "border-transparent hover:bg-control-hover"
      )}
    >
      <Button
        onPress={onToggle}
        aria-expanded={expanded}
        className={cn(
          "flex h-full min-w-0 flex-1 cursor-default items-center gap-2.5 rounded-control pl-2.5 text-left text-base outline-none data-focus-visible:ring-2 data-focus-visible:ring-accent",
          active ? "font-medium text-fg" : "text-secondary group-hover/row:text-fg"
        )}
      >
        <span className="flex size-5 shrink-0 items-center justify-center text-muted [&_svg]:size-4">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{name}</span>
      </Button>
      {trailing && (
        <span className={cn("flex shrink-0 items-center", actions && "transition-opacity duration-120 group-focus-within/row:opacity-0 group-hover/row:opacity-0 motion-reduce:transition-none")}>
          {trailing}
        </span>
      )}
      {actions && (
        <span
          className={cn(
            "absolute inset-y-0 right-1 flex items-center opacity-0 transition-opacity duration-120 group-focus-within/row:opacity-100 group-hover/row:opacity-100 motion-reduce:transition-none",
            active ? "bg-canvas" : "bg-control-hover"
          )}
        >
          {actions}
        </span>
      )}
    </div>
  )
}
