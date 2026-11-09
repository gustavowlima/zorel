// Choice cards (radio group): one option per card with a title and a line of explanation; the chosen one
// sits on the accent's faint tone (prototype: the agent's access level). React Aria handles arrows and focus.
// With an icon (an agent's face) the options become tiles in a grid, the chosen one marked by a check.
import type { ReactNode } from "react"
import { Radio, RadioGroup } from "react-aria-components"
import { cn } from "@/lib/utils"
import { Check } from "./icons.tsx"

export function ChoiceCards<T extends string>({
  label,
  value,
  onChange,
  options,
  grid = false
}: {
  label: string
  value: T
  onChange: (v: T) => void
  options: ReadonlyArray<{ value: T; title: string; description: string; icon?: ReactNode }>
  grid?: boolean
}) {
  return (
    <RadioGroup aria-label={label} value={value} onChange={(v) => onChange(v as T)} className={grid ? "grid grid-cols-1 gap-3 sm:grid-cols-2" : "flex flex-col gap-2"}>
      {options.map((o) => (
        <Radio
          key={o.value}
          value={o.value}
          className={cn(
            "group relative flex cursor-default gap-3 rounded-card border outline-none",
            o.icon ? "items-center p-4 pr-10" : "items-start px-3.5 py-3",
            "transition-colors duration-120 ease-out data-focus-visible:ring-2 data-focus-visible:ring-accent motion-reduce:transition-none",
            "border-subtle data-hovered:not-data-selected:border-strong data-hovered:not-data-selected:bg-control data-selected:border-accent-line data-selected:bg-accent-faint"
          )}
        >
          {o.icon ? (
            <>
              {o.icon}
              <Check aria-hidden="true" className="absolute top-1/2 right-4 size-4 -translate-y-1/2 text-accent-text opacity-0 group-data-selected:opacity-100" />
            </>
          ) : (
            <span aria-hidden="true" className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-strong group-data-selected:border-accent">
              <span className="size-2 rounded-full bg-accent opacity-0 group-data-selected:opacity-100" />
            </span>
          )}
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{o.title}</span>
            <span className={cn("text-sm text-muted", o.icon && "truncate")}>{o.description}</span>
          </span>
        </Radio>
      ))}
    </RadioGroup>
  )
}
