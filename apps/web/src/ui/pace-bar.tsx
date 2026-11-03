// How a limit window is going: the fill is what is used, the tick is how much of the window has gone by. Fill
// past the tick means the burn is ahead of the clock. Tones: success, warning (on pace to run out, or 80% used),
// danger (95% used). An image: the control holding it carries the label.
import { cn } from "@/lib/utils"

export type PaceTone = "ok" | "warning" | "critical"
const FILL = { ok: "bg-success", warning: "bg-warning", critical: "bg-danger" } as const

export function PaceBar({ used, elapsed, tone, className }: { used: number; elapsed: number | null; tone: PaceTone; className?: string }) {
  const pct = (v: number) => `${Math.max(0, Math.min(1, v)) * 100}%`
  return (
    <span aria-hidden="true" className={cn("relative block h-1 rounded-full bg-control", className)}>
      <span className={cn("absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none", FILL[tone])} style={{ width: pct(used) }} />
      {elapsed !== null && <span className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-fg" style={{ left: pct(elapsed) }} />}
    </span>
  )
}
