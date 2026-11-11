// A short list of boxes to tick (the agents that use a skill): React Aria's checkbox group, so Tab reaches each row
// and Space ticks it. A row is the box, a label (a face and a name) and an optional trailing mark; ticked rows sit on
// the accent's faint tone, as ChoiceCards' chosen one does.
import type { ReactNode } from "react"
import { Checkbox, CheckboxGroup } from "react-aria-components"
import { cn } from "@/lib/utils"
import { Check } from "./icons.tsx"

export function CheckList({
  label,
  value,
  onChange,
  options,
  tiles = false,
  className
}: {
  label: string
  value: ReadonlyArray<string>
  onChange: (value: string[]) => void
  options: ReadonlyArray<{ value: string; label: ReactNode; hint?: ReactNode; trailing?: ReactNode; tint?: string }>
  // Soft tiles in two columns instead of rows (picking people: a team's members): the label over its hint, a round
  // tick at the end, and a ticked tile in its own tint.
  tiles?: boolean
  className?: string
}) {
  if (tiles)
    return (
      <CheckboxGroup aria-label={label} value={[...value]} onChange={onChange} className={cn("grid gap-2 sm:grid-cols-2", className)}>
        {options.map((o) => (
          <Checkbox
            key={o.value}
            value={o.value}
            className={cn(
              "group flex min-w-0 cursor-default items-center gap-3 rounded-card border border-transparent bg-control px-3 py-2.5 outline-none transition-colors duration-120 ease-out data-focus-visible:ring-2 data-focus-visible:ring-accent data-hovered:not-data-selected:bg-control-hover motion-reduce:transition-none",
              o.tint ? `${o.tint} data-selected:tinted` : "data-selected:border-accent-line data-selected:bg-accent-faint"
            )}
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex min-w-0 items-center gap-2.5 text-fg">{o.label}</span>
              {o.hint && <span className="truncate text-sm text-muted">{o.hint}</span>}
            </span>
            <span
              aria-hidden="true"
              className={cn("flex size-5 shrink-0 items-center justify-center rounded-full border border-strong", o.tint ? "text-(--tint) group-data-selected:border-(--tint)" : "text-accent-text group-data-selected:border-accent-line group-data-selected:bg-accent-soft")}
            >
              <Check className="size-3 opacity-0 transition-opacity duration-120 group-data-selected:opacity-100 motion-reduce:transition-none" />
            </span>
          </Checkbox>
        ))}
      </CheckboxGroup>
    )
  return (
    <CheckboxGroup aria-label={label} value={[...value]} onChange={onChange} className={cn("flex flex-col gap-1", className)}>
      {options.map((o) => (
        <Checkbox
          key={o.value}
          value={o.value}
          className={cn("group flex cursor-default items-center gap-2.5 rounded-control border border-transparent px-2.5 py-1.5 outline-none transition-colors duration-120 ease-out data-focus-visible:ring-2 data-focus-visible:ring-accent data-hovered:not-data-selected:bg-control motion-reduce:transition-none", o.tint ? `${o.tint} data-selected:tinted` : "data-selected:border-accent-line data-selected:bg-accent-faint")}
        >
          <span
            aria-hidden="true"
            className={cn("flex size-4 shrink-0 items-center justify-center rounded-sm border border-strong", o.tint ? "text-(--tint) group-data-selected:border-(--tint)" : "text-accent-text group-data-selected:border-accent-line group-data-selected:bg-accent-soft")}
          >
            <Check className="size-3 opacity-0 transition-opacity duration-120 group-data-selected:opacity-100 motion-reduce:transition-none" />
          </span>
          <span className="flex min-w-0 flex-1 items-center gap-2 text-fg">{o.label}</span>
          {o.trailing}
        </Checkbox>
      ))}
    </CheckboxGroup>
  )
}

// One box with its label ("Don't ask again"), drawn like a CheckList row's box.
export function Tick({ checked, onChange, children }: { checked: boolean; onChange: (checked: boolean) => void; children: ReactNode }) {
  return (
    <Checkbox isSelected={checked} onChange={onChange} className="group flex cursor-default items-center gap-2.5 rounded-control text-sm text-secondary outline-none data-focus-visible:ring-2 data-focus-visible:ring-accent">
      <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center rounded-sm border border-strong text-accent-text group-data-selected:border-accent-line group-data-selected:bg-accent-soft">
        <Check className="size-3 opacity-0 transition-opacity duration-120 group-data-selected:opacity-100 motion-reduce:transition-none" />
      </span>
      {children}
    </Checkbox>
  )
}
