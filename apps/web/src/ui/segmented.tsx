// A small set of exclusive choices shown at once (theme: system / dark / light). React Aria's toggle group: one
// Tab stop, arrows between options, the selected one announced. Pills on the canvas, the selected on surface.
import type { ReactNode } from "react"
import { ToggleButton, ToggleButtonGroup } from "react-aria-components"
import { cn } from "@/lib/utils"

export function Segmented<K extends string>({ label, options, value, onChange, className }: { label: string; options: ReadonlyArray<{ id: K; label: ReactNode }>; value: K; onChange: (id: K) => void; className?: string }) {
  return (
    <ToggleButtonGroup
      aria-label={label}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[value]}
      onSelectionChange={(keys) => {
        const next = [...keys][0]
        if (next !== undefined) onChange(String(next) as K)
      }}
      className={cn("inline-flex items-center gap-0.5 rounded-control border border-subtle p-0.5", className)}
    >
      {options.map((o) => (
        <ToggleButton
          key={o.id}
          id={o.id}
          className="flex h-5.5 cursor-default items-center rounded-md px-2.5 text-sm text-muted outline-none transition-colors duration-150 ease-out data-focus-visible:ring-2 data-focus-visible:ring-accent data-hovered:text-fg data-selected:bg-surface data-selected:text-fg motion-reduce:transition-none"
        >
          {o.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  )
}
