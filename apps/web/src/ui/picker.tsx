// Pieces of rich pickers (the model picker's account rail and model list) and a field-looking trigger
// for popovers used inside forms.
import { Check, ChevronDown } from "lucide-react"
import type { ReactNode } from "react"
import { Button } from "react-aria-components"
import { cn } from "@/lib/utils"
import { field } from "./input"

const focus = "outline-none data-focus-visible:ring-2 data-focus-visible:ring-accent"

// Square rail button (one per account or provider). The badge tells two accounts of one provider apart.
export function RailButton({ selected, label, badge, dimmed, onPress, children }: { selected: boolean; label: string; badge?: string; dimmed?: boolean; onPress: () => void; children: ReactNode }) {
  return (
    <Button
      onPress={onPress}
      aria-label={label}
      aria-pressed={selected}
      className={cn(
        focus,
        "relative flex size-10 shrink-0 cursor-default items-center justify-center rounded-row border transition-colors duration-120 ease-out motion-reduce:transition-none",
        selected ? "border-strong bg-surface" : "border-transparent data-hovered:bg-control-hover",
        dimmed && !selected && "opacity-50"
      )}
    >
      {children}
      {badge && (
        <span aria-hidden="true" className="absolute right-0 bottom-0 flex h-4 min-w-4 items-center justify-center rounded-full border border-strong bg-raised px-1 text-xs leading-none font-semibold text-secondary">
          {badge}
        </span>
      )}
    </Button>
  )
}

// A two-line option (name + note) with a check when selected.
export function OptionButton({ selected, title, note, trailing, onPress }: { selected: boolean; title: ReactNode; note?: ReactNode; trailing?: ReactNode; onPress: () => void }) {
  return (
    <Button
      onPress={onPress}
      aria-pressed={selected}
      className={cn(
        focus,
        "flex min-h-11 w-full cursor-default items-center gap-2.5 rounded-row px-2.5 py-1.5 text-left transition-colors duration-120 ease-out data-hovered:bg-control-hover motion-reduce:transition-none",
        selected && "bg-surface"
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{title}</span>
        {note && <span className="truncate text-sm text-muted">{note}</span>}
      </span>
      {trailing}
      {selected && <Check className="size-4 shrink-0 text-accent-text" aria-hidden="true" />}
    </Button>
  )
}

// Looks like a Select: opens a Popover that holds a richer picker.
export function FieldButton({ children, className, "aria-label": ariaLabel }: { children: ReactNode; className?: string; "aria-label"?: string }) {
  return (
    <Button {...(ariaLabel && { "aria-label": ariaLabel })} className={cn(field, "flex h-control items-center gap-2 text-left", className)}>
      <span className="flex min-w-0 flex-1 items-center gap-2 truncate">{children}</span>
      <ChevronDown className="size-4 shrink-0 text-muted" aria-hidden="true" />
    </Button>
  )
}
