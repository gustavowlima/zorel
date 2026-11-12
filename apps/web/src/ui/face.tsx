// The agent's face (spec 018): a circle in its hue with two white pill eyes; its state lives on it. Working = a flat
// ring in the hue with one dot travelling round it; waiting for the person = a breathing amber dot; done / failed =
// a green / red dot. Alive faces (working or waiting) glance and blink. Every motion is transform/opacity and stops
// under reduced motion (styles.css › Face). People are rounded squares (PersonAvatar), never in an agent hue.
import { Check, Compass, FileText, Gauge, MessageCircle, Moon, NotebookPen, Plug, Search, Sun, Timer, Unplug, Users } from "lucide-react"
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
  color: override,
  className
}: {
  tone: number
  color?: string | undefined
  eyes?: "open" | "happy" | "asleep" | "aside" | "up" | undefined
  size?: number | undefined
  state?: FaceState | undefined
  alive?: boolean | undefined
  solid?: boolean | undefined
  className?: string | undefined
}) {
  const color = override ?? hue(tone)
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

// Scenes (spec 018 illustrations): a quiet card holding the moment's icon, a second card behind it, and one agent in
// the action blue docked on its corner whose eyes tell the mood. Neutrals plus the accent only; the face floats 3px,
// still under reduced motion. The face's cut-out follows the background via --z-scene-cut (canvas by default).
export type SceneKind = "allClear" | "resting" | "calmDay" | "clock" | "team" | "notebook" | "pages" | "connect" | "search" | "offline" | "lost" | "meter" | "chat"
type Eyes = "open" | "happy" | "asleep" | "aside" | "up"

const SCENES: Record<SceneKind, { icon: ReactNode; eyes: Eyes }> = {
  allClear: { icon: <Check />, eyes: "happy" },
  resting: { icon: <Moon />, eyes: "asleep" },
  calmDay: { icon: <Sun />, eyes: "happy" },
  clock: { icon: <Timer />, eyes: "asleep" },
  team: { icon: <Users />, eyes: "open" },
  notebook: { icon: <NotebookPen />, eyes: "up" },
  pages: { icon: <FileText />, eyes: "aside" },
  connect: { icon: <Plug />, eyes: "open" },
  search: { icon: <Search />, eyes: "aside" },
  offline: { icon: <Unplug />, eyes: "asleep" },
  lost: { icon: <Compass />, eyes: "up" },
  meter: { icon: <Gauge />, eyes: "happy" },
  chat: { icon: <MessageCircle />, eyes: "open" }
}

const SIZE = {
  sm: { box: "size-12", back: "rounded-control-sm", card: "rounded-row [&_svg]:size-4.5", face: 16 },
  lg: { box: "size-20", back: "rounded-row", card: "rounded-card [&_svg]:size-7", face: 24 }
} as const

export function Scene({ kind, large = false, className }: { kind: SceneKind; large?: boolean; className?: string | undefined }) {
  const { icon, eyes } = SCENES[kind]
  const z = SIZE[large ? "lg" : "sm"]
  return (
    <span aria-hidden="true" className={cn("relative inline-block shrink-0", z.box, className)}>
      <span className={cn("absolute inset-x-[18%] top-0 h-1/2 bg-surface ring-1 ring-subtle ring-inset", z.back)} />
      <span className={cn("absolute inset-x-0 top-[14%] bottom-0 flex items-center justify-center bg-raised text-secondary ring-1 ring-strong ring-inset", z.card)}>{icon}</span>
      <AgentFace
        tone={0}
        color="var(--z-accent)"
        size={z.face}
        eyes={eyes}
        solid
        className="z-float absolute! -right-1.5 -bottom-1.5 ring-[3px] ring-[var(--z-scene-cut,var(--z-bg-canvas))]"
      />
    </span>
  )
}
