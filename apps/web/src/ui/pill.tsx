// Activity pill (prototype): a rounded summary of what an agent did ("Used 3 tools · 14s") that opens the
// detail below it. The leading slot carries the state: a dot when done, a spinner while working.
import { ChevronDown } from "lucide-react"
import type { ReactNode } from "react"
import { Button } from "react-aria-components"
import { cn } from "@/lib/utils"

export function DisclosurePill({ expanded, onToggle, leading, children, controls }: { expanded: boolean; onToggle: () => void; leading?: ReactNode; children: ReactNode; controls?: string }) {
  return (
    <Button
      onPress={onToggle}
      aria-expanded={expanded}
      {...(controls && { "aria-controls": controls })}
      className="inline-flex h-control-xs max-w-full cursor-default items-center gap-1.5 self-start rounded-full px-2 text-sm text-muted outline-none transition-colors duration-120 ease-out data-hovered:bg-hover data-hovered:text-fg data-focus-visible:ring-2 data-focus-visible:ring-accent motion-reduce:transition-none"
    >
      {leading}
      <span className="truncate">{children}</span>
      <ChevronDown aria-hidden="true" className={cn("size-3.5 shrink-0 text-muted transition-transform duration-150 ease-out motion-reduce:transition-none", expanded && "rotate-180")} />
    </Button>
  )
}

// The small state dot that leads a finished pill.
export const Dot = ({ tone }: { tone: "success" | "warning" | "danger" | "accent" }) => (
  <span
    aria-hidden="true"
    className={cn("size-1.5 shrink-0 rounded-full", tone === "success" && "bg-success", tone === "warning" && "bg-warning", tone === "danger" && "bg-danger", tone === "accent" && "bg-accent-text")}
  />
)

// A fact about something, as a quiet chip (an agent's model, access, reach); `hint` explains it on hover.
export const Tag = ({ hint, children }: { hint?: string; children: ReactNode }) => (
  <span title={hint} className="rounded-control bg-control px-2 py-0.5 text-sm text-secondary">
    {children}
  </span>
)
