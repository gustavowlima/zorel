// A subscription's limits as concentric rings: the outer ring is the longest window, the inner the shortest;
// each arc is how much of that window is left, in its tone (success, warning from 80% used, danger from 95%).
// The provider's logo sits in the middle. An image: the control holding it carries the label.
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export type RingTone = "ok" | "warning" | "critical"
const TONE = { ok: "stroke-success", warning: "stroke-warning", critical: "stroke-danger" } as const

export function LimitRing({ windows, size = 30, children, className }: { windows: ReadonlyArray<{ left: number; tone: RingTone }>; size?: number; children?: ReactNode; className?: string }) {
  const stroke = size * 0.07
  const gap = size * 0.13
  const center = size / 2
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="absolute inset-0 -rotate-90">
        {windows.map((w, i) => {
          const r = (size - stroke) / 2 - i * gap
          const length = 2 * Math.PI * r
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: a ring is its place, outer to inner
            <g key={i} fill="none" strokeWidth={stroke}>
              <circle cx={center} cy={center} r={r} className="stroke-current opacity-15" />
              <circle
                cx={center}
                cy={center}
                r={r}
                strokeLinecap="round"
                strokeDasharray={length}
                strokeDashoffset={length * (1 - Math.max(0, Math.min(1, w.left)))}
                className={cn(TONE[w.tone], "transition-[stroke-dashoffset] duration-600 ease-out motion-reduce:transition-none")}
              />
            </g>
          )
        })}
      </svg>
      {children}
    </span>
  )
}
