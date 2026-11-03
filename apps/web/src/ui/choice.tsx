// Choice cards (radio group): one option per card with a title and a line of explanation; the chosen one
// sits on the accent's faint tone (prototype: the agent's access level). React Aria handles arrows and focus.
import { Radio, RadioGroup } from "react-aria-components"
import { cn } from "@/lib/utils"

export function ChoiceCards<T extends string>({
  label,
  value,
  onChange,
  options
}: {
  label: string
  value: T
  onChange: (v: T) => void
  options: ReadonlyArray<{ value: T; title: string; description: string }>
}) {
  return (
    <RadioGroup aria-label={label} value={value} onChange={(v) => onChange(v as T)} className="flex flex-col gap-2">
      {options.map((o) => (
        <Radio
          key={o.value}
          value={o.value}
          className={cn(
            "group flex cursor-default items-start gap-3 rounded-card border px-3.5 py-3 outline-none transition-colors duration-120 ease-out data-focus-visible:ring-2 data-focus-visible:ring-accent motion-reduce:transition-none",
            "border-subtle data-hovered:bg-control-hover data-selected:border-accent-line data-selected:bg-accent-faint"
          )}
        >
          <span aria-hidden="true" className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-strong group-data-selected:border-accent">
            <span className="size-2 rounded-full bg-accent opacity-0 group-data-selected:opacity-100" />
          </span>
          <span className="flex flex-col">
            <span className="font-medium">{o.title}</span>
            <span className="text-sm text-muted">{o.description}</span>
          </span>
        </Radio>
      ))}
    </RadioGroup>
  )
}
