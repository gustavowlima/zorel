// The agent's face (spec 018): a circle in its hue with two white pill eyes; its state lives on it. Working = a flat
// ring in the hue with one dot travelling round it; waiting for the person = a breathing amber dot; done / failed =
// a green / red dot. Alive faces (working or waiting) glance and blink. Every motion is transform/opacity and stops
// under reduced motion (styles.css › Face). People are rounded squares (PersonAvatar), never in an agent hue.
import type { CSSProperties } from "react"
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
  className
}: {
  tone: number
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
    <span aria-hidden="true" className={cn("z-face", className)} data-alive={moving || undefined} style={style}>
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
