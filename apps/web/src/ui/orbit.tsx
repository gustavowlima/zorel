// The new chat's backdrop, after Zorel's mark (orchestration): barely-there concentric orbits (the border's faintest
// tone, quieter still under the text in the middle), two spokes coming in from
// opposite corners and ending in dots like the logo's arcs, and a few agents (accent dots) slowly circling. Pure SVG
// and CSS, fading out toward the edges; decoration only (aria-hidden, no pointer events); the agents stand still
// under reduced motion.
import { cn } from "@/lib/utils"

const RINGS = [110, 200, 300, 410, 530] as const
// Each agent: its orbit, where on it it starts (degrees), its size, and how long one turn takes (seconds).
const AGENTS = [
  { r: 200, at: 215, size: 5, turn: 140 },
  { r: 300, at: 40, size: 4, turn: 200 },
  { r: 410, at: 160, size: 3.5, turn: 260 },
  { r: 300, at: 290, size: 3, turn: 200 }
] as const

export function OrbitBackdrop({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("pointer-events-none overflow-hidden [mask-image:radial-gradient(ellipse_60%_55%_at_50%_45%,rgba(0,0,0,0.25)_0%,black_35%,transparent_72%)]", className)}>
      <svg viewBox="-600 -600 1200 1200" preserveAspectRatio="xMidYMid slice" aria-hidden="true" className="size-full">
        {RINGS.map((r) => (
          <circle key={r} r={r} fill="none" stroke="var(--z-border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        {/* The two spokes, as the mark's arcs meet its core from opposite corners. */}
        <g stroke="var(--z-border)" strokeWidth="1" vectorEffect="non-scaling-stroke">
          <line x1="-420" y1="-420" x2="-80" y2="-80" />
          <line x1="420" y1="420" x2="80" y2="80" />
        </g>
        <circle cx="-300" cy="-300" r="4" fill="var(--z-accent)" opacity="0.35" />
        <circle cx="300" cy="300" r="4" fill="var(--z-accent)" opacity="0.35" />
        {AGENTS.map((a, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list
          <g key={i} className="origin-center animate-spin motion-reduce:animate-none" style={{ animationDuration: `${a.turn}s`, rotate: `${a.at}deg` }}>
            <circle cx={a.r} cy="0" r={a.size} fill="var(--z-accent)" opacity="0.3" />
          </g>
        ))}
      </svg>
    </div>
  )
}
