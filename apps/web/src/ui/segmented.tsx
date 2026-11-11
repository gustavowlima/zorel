// A small set of exclusive choices shown at once (theme: system / dark / light). React Aria's toggle group: one
// Tab stop, arrows between options, the selected one announced. The selected pill takes the translucent active
// control tone, so it reads on the canvas, a card or a dialog alike (a surface fill vanished on a raised dialog).
// The pill slides from the option it left (Marker), as the tabs' does.
import { type ReactNode, useId } from "react"
import { ToggleButton, ToggleButtonGroup } from "react-aria-components"
import { cn } from "@/lib/utils"
import { Marker } from "./motion"

export function Segmented<K extends string>({ label, options, value, onChange, className, fill }: { label: string; options: ReadonlyArray<{ id: K; label: ReactNode }>; value: K; onChange: (id: K) => void; className?: string; fill?: boolean }) {
  const group = useId()
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
      className={cn("items-center gap-0.5 rounded-control border border-subtle p-0.5", fill ? "flex w-full" : "inline-flex self-start", className)}
    >
      {options.map((o) => (
        <ToggleButton
          key={o.id}
          id={o.id}
          // 22px drawn (the 28px control row), 24px to press: the ::after reaches a pixel past each edge.
          className={cn("relative isolate flex h-5.5 cursor-default items-center rounded-md px-2.5 after:absolute after:inset-x-0 after:-inset-y-px after:content-[''] text-sm text-muted outline-none transition-colors duration-150 ease-out data-focus-visible:ring-2 data-focus-visible:ring-accent data-hovered:text-fg data-selected:text-fg motion-reduce:transition-none", fill && "flex-1 justify-center")}
        >
          {o.id === value && <Marker id={group} className="absolute inset-0 -z-10 rounded-md bg-control-active" />}
          {o.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  )
}

// The same row, several on at once (the days a routine repeats on), selected the same way. Each button says on or off
// to a screen reader.
export function MultiSegmented<K extends string>({ label, options, value, onChange, className }: { label: string; options: ReadonlyArray<{ id: K; label: ReactNode; title?: string }>; value: ReadonlyArray<K>; onChange: (ids: K[]) => void; className?: string }) {
  return (
    <ToggleButtonGroup
      aria-label={label}
      selectionMode="multiple"
      selectedKeys={[...value]}
      onSelectionChange={(keys) => onChange(options.map((o) => o.id).filter((id) => keys.has(id)))}
      className={cn("inline-flex items-center gap-0.5 self-start rounded-control border border-subtle p-0.5", className)}
    >
      {options.map((o) => (
        <ToggleButton
          key={o.id}
          id={o.id}
          {...(o.title && { "aria-label": o.title })}
          className="relative flex h-5.5 min-w-8 cursor-default items-center justify-center rounded-md px-2 after:absolute after:inset-x-0 after:-inset-y-px after:content-[''] text-sm text-muted outline-none transition-colors duration-150 ease-out data-focus-visible:ring-2 data-focus-visible:ring-accent data-hovered:text-fg data-selected:bg-control-active data-selected:text-fg motion-reduce:transition-none"
        >
          {o.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  )
}
