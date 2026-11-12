// The agent's face (spec 018): a circle in its hue with two white pill eyes; its state lives on it. Working = a flat
// ring in the hue with one dot travelling round it; waiting for the person = a breathing amber dot; done / failed =
// a green / red dot. Alive faces (working or waiting) glance and blink. Every motion is transform/opacity and stops
// under reduced motion (styles.css › Face). People are rounded squares (PersonAvatar), never in an agent hue.
import type { CSSProperties, ReactNode } from "react"
import { cn } from "@/lib/utils"

export type FaceState = "idle" | "working" | "waiting" | "done" | "failed"
const TONES = 6

const hue = (tone: number) => `var(--z-agent-${(((tone % TONES) + TONES) % TONES) + 1})`

export function AgentFace({
  tone,
  size = 20,
  state = "idle",
  alive,
  solid = false,
  eyes = "open",
  className
}: {
  tone: number
  eyes?: "open" | "happy" | "asleep" | undefined
  size?: number | undefined
  state?: FaceState | undefined
  alive?: boolean | undefined
  solid?: boolean | undefined
  className?: string | undefined
}) {
  const color = hue(tone)
  // Faces in lists overlap: the tint is mixed into the raised tone so it stays opaque.
  const style = {
    width: size,
    height: size,
    color,
    background: solid ? color : `color-mix(in oklab, ${color} 26%, var(--z-bg-raised))`
  } as CSSProperties
  const moving = alive ?? (state === "working" || state === "waiting")
  return (
    <span aria-hidden="true" className={cn("z-face", className)} data-alive={moving || undefined} data-eyes={eyes === "open" ? undefined : eyes} style={style}>
      <i className="z-eye" />
      <i className="z-eye" />
      {state === "working" && <Ring size={size} />}
      {state === "waiting" && <span className="z-mark z-mark-wait" style={markStyle(size)} />}
      {state === "done" && <span className="z-mark z-mark-done" style={markStyle(size)} />}
      {state === "failed" && <span className="z-mark z-mark-failed" style={markStyle(size)} />}
    </span>
  )
}

const markStyle = (size: number) => {
  const d = Math.max(6, Math.round(size * 0.28))
  return { width: d, height: d } as CSSProperties
}

// The ring around a face: a little outside it, thinner on small faces.
function Ring({ size }: { size: number }) {
  const gap = size <= 20 ? 3 : 4
  return (
    <span className="z-ring" style={{ inset: -gap } as CSSProperties}>
      <i />
    </span>
  )
}

// The working ring on its own (a step, a status line), in the current colour or an agent's hue.
export function WorkingRing({ size = 14, tone, className }: { size?: number | undefined; tone?: number | undefined; className?: string | undefined }) {
  return (
    <span aria-hidden="true" className={cn("z-orb", className)} style={{ width: size, height: size, ...(tone !== undefined && { color: hue(tone) }) } as CSSProperties}>
      <span className="z-ring" style={{ inset: 0 } as CSSProperties}>
        <i />
      </span>
    </span>
  )
}

// A person: a rounded square with their initial, in the neutral wash.
export function PersonAvatar({ name, size = 24, className }: { name: string; size?: number | undefined; className?: string | undefined }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex shrink-0 items-center justify-center bg-control-active font-semibold text-fg select-none", className)}
      style={{ width: size, height: size, borderRadius: "30%", fontSize: Math.round(size * 0.42) } as CSSProperties}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  )
}

// The empty-state illustration (spec 018): Zorel's signature — the screen's icon in the core, two orbits, three agent
// faces riding the outer one slowly (each turned back so it stays upright), cut out of the ring. Decoration only;
// still under reduced motion.
const SEATS = [
  { left: 54, top: -10 }, // 0°
  { left: 109.43, top: 86 }, // 120°
  { left: -1.43, top: 86 } // 240° (ring radius 64 in a 128 box, faces 20)
]
export function EmptyOrbit({ icon, className }: { icon?: ReactNode; className?: string | undefined }) {
  return (
    <span aria-hidden="true" className={cn("relative block size-32 shrink-0", className)}>
      <span className="absolute inset-0 rounded-full ring-1 ring-strong ring-inset" />
      <span className="absolute inset-6 rounded-full ring-1 ring-subtle ring-inset" />
      <span className="absolute inset-10.5 flex items-center justify-center rounded-full bg-control text-secondary [&_svg]:size-5">{icon}</span>
      <span className="z-orbit-ride absolute inset-0">
        {SEATS.map((seat, i) => (
          <span key={seat.left} className="z-orbit-seat absolute" style={{ left: seat.left, top: seat.top, width: 20, height: 20 } as CSSProperties}>
            <AgentFace tone={i} size={20} solid className="ring-4 ring-canvas" />
          </span>
        ))}
      </span>
    </span>
  )
}

// Small friendly scenes (spec 018 illustrations): agent faces whose eyes tell the moment, plus one simple object.
// Flat, the agents' hues and neutrals, a gentle float; still under reduced motion. Each fits a 56px-high slot.
export type SceneKind = "allClear" | "resting" | "calmDay"
export function Scene({ kind, className }: { kind: SceneKind; className?: string | undefined }) {
  const box = cn("relative inline-flex h-14 w-24 shrink-0 items-end justify-center", className)
  if (kind === "allClear")
    return (
      <span aria-hidden="true" className={box}>
        <AgentFace tone={1} size={30} eyes="happy" solid className="z-float" />
        <AgentFace tone={0} size={30} eyes="happy" solid className="z-float -ml-1 ring-2 ring-surface [animation-delay:400ms]" />
        <span className="absolute top-0 left-1/2 flex size-4.5 -translate-x-1/2 items-center justify-center rounded-full bg-success text-on-agent">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 12 4 4 8-8" />
          </svg>
        </span>
      </span>
    )
  if (kind === "resting")
    return (
      <span aria-hidden="true" className={box}>
        <AgentFace tone={3} size={32} eyes="asleep" solid />
        <span className="absolute top-1 right-4 text-xs font-semibold text-muted">
          z<span className="text-[0.6rem]">z</span>
        </span>
      </span>
    )
  return (
    <span aria-hidden="true" className={cn(box, "overflow-hidden")}>
      <span className="absolute bottom-[-1.5rem] left-1/2 size-16 -translate-x-1/2 rounded-full ring-2 ring-warning/60 ring-inset" />
      <AgentFace tone={5} size={30} eyes="happy" solid className="z-float relative mb-0.5" />
      <span className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-control-active" />
    </span>
  )
}
