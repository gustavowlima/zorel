// A limit window as a tiny burn-down. Left edge: the window opens, full; right edge: it resets. The faint dashed
// diagonal is the even pace that lands on empty exactly at the reset. The colored line is what is left so far,
// ending in a dot at now; dashed after it, where this pace leads: under the diagonal is ahead of the clock, and
// when it reaches empty before the right edge a small cross marks when the window runs out.
import { cn } from "@/lib/utils"
import { X } from "./icons"

export type BurnTone = "ok" | "warning" | "critical"
const STROKE = { ok: "stroke-success", warning: "stroke-warning", critical: "stroke-danger" } as const
const FILL = { ok: "fill-success", warning: "fill-warning", critical: "fill-danger" } as const
const BG = { ok: "bg-success", warning: "bg-warning", critical: "bg-danger" } as const

const TOP = 2
const BOTTOM = 18
const yOf = (left: number) => TOP + (1 - Math.max(0, Math.min(1, left))) * (BOTTOM - TOP)

export function BurnDown({ used, elapsed, tone, className }: { used: number; elapsed: number | null; tone: BurnTone; className?: string }) {
  if (elapsed === null) {
    // No clock to compare with: just what is left.
    return (
      <span aria-hidden="true" className={cn("relative block h-1 rounded-full bg-control", className)}>
        <span className={cn("absolute inset-y-0 left-0 rounded-full", BG[tone])} style={{ width: `${Math.min(1, used) * 100}%` }} />
      </span>
    )
  }
  const nowX = elapsed * 100
  const nowY = yOf(1 - used)
  // Where the pace so far leads: empty at `emptyAt` (share of the window), or what is left at the reset.
  const emptyAt = used > 0 ? elapsed / used : Number.POSITIVE_INFINITY
  const end = emptyAt < 1 ? { x: emptyAt * 100, y: BOTTOM } : { x: 100, y: yOf(1 - (used / Math.max(elapsed, 0.001))) }
  const line = { vectorEffect: "non-scaling-stroke" as const }
  return (
    <span aria-hidden="true" className={cn("relative block h-5", className)}>
      <svg aria-hidden="true" viewBox="0 0 100 20" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
        <line x1="0" y1={BOTTOM} x2="100" y2={BOTTOM} className="stroke-current opacity-15" strokeWidth="1" style={line} />
        <line x1="0" y1={TOP} x2="100" y2={BOTTOM} className="stroke-current opacity-30" strokeWidth="1" strokeDasharray="2 3" style={line} />
        <polygon points={`0,${BOTTOM} 0,${TOP} ${nowX},${nowY} ${nowX},${BOTTOM}`} className={cn(FILL[tone], "opacity-15")} />
        {elapsed >= 0.1 && <line x1={nowX} y1={nowY} x2={end.x} y2={end.y} className={STROKE[tone]} strokeWidth="1.5" strokeDasharray="3 3" strokeLinecap="round" style={line} />}
        <line x1="0" y1={TOP} x2={nowX} y2={nowY} className={STROKE[tone]} strokeWidth="1.75" strokeLinecap="round" style={line} />
      </svg>
      <span className={cn("absolute size-1.5 -translate-1/2 rounded-full ring-2 ring-frame", BG[tone])} style={{ left: `${nowX}%`, top: `${(nowY / 20) * 100}%` }} />
      {emptyAt < 1 && elapsed >= 0.1 && (
        <X className="absolute size-2.5 -translate-1/2 text-danger" strokeWidth={3} style={{ left: `${emptyAt * 100}%`, top: `${(BOTTOM / 20) * 100}%` }} />
      )}
    </span>
  )
}
