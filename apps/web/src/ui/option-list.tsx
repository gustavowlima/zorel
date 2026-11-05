// Options whose keyboard lives in a text field beside them: the composer's / @ $ # list and the folder browser.
// The field keeps the focus (arrows move the selection there); the pointer selects a row on press without taking
// that focus, and a double click opens the row when it has something to open.
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export function OptionList({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div role="listbox" aria-label={label} className={cn("flex flex-col gap-px overflow-y-auto p-1", className)}>
      {children}
    </div>
  )
}

export function OptionRow({
  selected,
  icon,
  trailing,
  onPick,
  onHover,
  onOpen,
  className,
  children
}: {
  selected: boolean
  icon?: ReactNode
  trailing?: ReactNode
  onPick: () => void
  onHover?: () => void
  onOpen?: () => void
  className?: string
  children: ReactNode
}) {
  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      onMouseEnter={onHover}
      onMouseDown={(e) => {
        e.preventDefault() // keep the field's focus
        onPick()
      }}
      onDoubleClick={onOpen}
      className={cn("group flex shrink-0 cursor-default items-center gap-2.5 rounded-md px-2.5", selected ? "bg-accent-soft text-fg" : "text-secondary hover:bg-control-hover", className)}
    >
      {icon && <span className={cn("flex size-5 shrink-0 items-center justify-center [&_svg]:size-4", selected ? "text-accent-text" : "text-muted")}>{icon}</span>}
      {children}
      {trailing}
    </div>
  )
}
