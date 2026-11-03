// A subscription's limit windows as concentric rings: the outer ring is the longest window, the inner the shortest;
// each arc is the share used, in its tone (success; warning on pace to run out or from 80%; danger from 95%). The
// provider's logo sits in the middle. An image: the text beside it says the same in words.
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export type RingTone = "ok" | "warning" | "critical"
const TONE = { ok: "stroke-success", warning: "stroke-warning", critical: "stroke-danger" } as const

export function LimitRing({ windows, size = 44, children, className }: { windows: ReadonlyArray<{ used: number; tone: RingTone }>; size?: number; children?: ReactNode; className?: string }) {
  const stroke = Math.max(3, size * 0.075)
  const gap = stroke + 2.5
  const center = size / 2
  return (
    <span aria-hidden="true" className={cn("relative inline-flex shrink-0 items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="absolute inset-0 -rotate-90">
        {windows.map((w, i) => {
          const r = (size - stroke) / 2 - i * gap
          if (r <= stroke) return null
          const length = 2 * Math.PI * r
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: a ring is its place, outer to inner
            <g key={i} fill="none" strokeWidth={stroke}>
              <circle cx={center} cy={center} r={r} className="stroke-control" />
              <circle
                cx={center}
                cy={center}
                r={r}
                strokeLinecap="round"
                strokeDasharray={length}
                strokeDashoffset={length * (1 - Math.max(0.015, Math.min(1, w.used)))}
                className={cn(TONE[w.tone], "transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none")}
              />
            </g>
          )
        })}
      </svg>
      {children}
    </span>
  )
}
