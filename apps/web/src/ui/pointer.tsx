// An agent's pointer over a remote screen (the Browser panel): an arrow at (x, y), fractions of the box it sits in
// (a positioned parent), the agent's face and name beside it, and a ring each time `pulse` changes (it acted there).
// It glides from point to point; with reduced motion it jumps. Light fill, dark edge: legible on any page.
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export function AgentPointer({ x, y, pulse, label, faded = false }: { x: number; y: number; pulse: number; label: ReactNode; faded?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn("pointer-events-none absolute top-0 left-0 z-10 transition-[left,top,opacity] duration-300 ease-out motion-reduce:transition-none", faded && "opacity-0")}
      style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
    >
      <span key={pulse} className="absolute -top-3.5 -left-3.5 size-7 animate-[pointer-ring_600ms_ease-out_forwards] rounded-full border-2 border-accent motion-reduce:hidden" />
      <svg aria-hidden="true" viewBox="0 0 24 24" className="absolute -top-0.5 -left-0.5 size-5 fill-fg stroke-canvas stroke-[1.5]">
        <path d="M4 3 19.5 11 12.5 12.8 9.8 19.6Z" strokeLinejoin="round" />
      </svg>
      <span className="absolute top-4.5 left-3.5 flex items-center gap-1 rounded-full border border-subtle bg-surface py-0.5 pr-2 pl-0.5 text-xs whitespace-nowrap text-fg">{label}</span>
    </span>
  )
}
