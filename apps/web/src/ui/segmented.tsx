// A small set of exclusive choices shown at once (theme: system / dark / light). React Aria's toggle group: one
// Tab stop, arrows between options, the selected one announced. Pills on the canvas, the selected on surface.
import type { ReactNode } from "react"
import { ToggleButton, ToggleButtonGroup } from "react-aria-components"
import { cn } from "@/lib/utils"

export function Segmented<K extends string>({ label, options, value, onChange, className, fill }: { label: string; options: ReadonlyArray<{ id: K; label: ReactNode }>; value: K; onChange: (id: K) => void; className?: string; fill?: boolean }) {
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
      className={cn("items-center gap-0.5 rounded-control border border-subtle p-0.5", fill ? "flex w-full" : "inline-flex", className)}
    >
      {options.map((o) => (
        <ToggleButton
          key={o.id}
          id={o.id}
          // 22px drawn (the 28px control row), 24px to press: the ::after reaches a pixel past each edge.
          className={cn("relative flex h-5.5 cursor-default items-center rounded-md px-2.5 after:absolute after:inset-x-0 after:-inset-y-px after:content-[''] text-sm text-muted outline-none transition-colors duration-150 ease-out data-focus-visible:ring-2 data-focus-visible:ring-accent data-hovered:text-fg data-selected:bg-surface data-selected:text-fg motion-reduce:transition-none", fill && "flex-1 justify-center")}
        >
          {o.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  )
}
