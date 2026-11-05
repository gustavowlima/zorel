// A few named levels on one track (the reasoning level), built on React Aria's Slider. It moves like a physical
// control: while dragged the thumb follows the pointer freely (the level under it is picked live), on release it
// settles into the nearest stop; a press on the track or a key glides it there. Arrows, PageUp/Down, Home and End
// step one level at a time. A dot marks each stop and lights once the thumb has passed it.
import { type KeyboardEvent, useEffect, useRef, useState } from "react"
import { Slider, SliderThumb, SliderTrack } from "react-aria-components"
import { cn } from "@/lib/utils"

// The slider runs on a fine scale so a drag is continuous; levels are whole numbers on it.
const FINE = 0.001

// Keys step a whole level (React Aria would step the fine scale); undefined: not a slider key.
function keyStep(key: string, at: number, last: number): number | undefined {
  if (key === "ArrowRight" || key === "ArrowUp" || key === "PageUp") return at + 1
  if (key === "ArrowLeft" || key === "ArrowDown" || key === "PageDown") return at - 1
  if (key === "Home") return 0
  if (key === "End") return last
  return undefined
}

export function StepSlider<K extends string>({
  label,
  steps,
  value,
  onChange,
  className
}: {
  label: string
  steps: ReadonlyArray<{ id: K; label: string }>
  value: K
  onChange: (id: K) => void
  className?: string
}) {
  const index = Math.max(0, steps.findIndex((s) => s.id === value))
  const last = Math.max(1, steps.length - 1)
  const [pos, setPos] = useState(index) // where the thumb is, between stops while dragged
  const [dragging, setDragging] = useState(false)
  // A level chosen from outside (another chat, the agent's default) moves the thumb when it is not in a hand.
  useEffect(() => {
    if (!dragging) setPos(index)
  }, [index, dragging])

  const pick = (i: number) => {
    const s = steps[Math.min(last, Math.max(0, i))]
    if (s && s.id !== value) onChange(s.id)
  }
  const move = (v: number) => {
    setDragging(true)
    setPos(v)
    pick(Math.round(v)) // the level under the thumb, live
  }
  const settle = (v: number) => {
    setDragging(false)
    setPos(Math.round(v)) // into the nearest stop, animated by the thumb's transition
    pick(Math.round(v))
  }
  const onKey = (e: KeyboardEvent) => {
    const to = keyStep(e.key, Math.round(pos), last)
    if (to === undefined) return
    e.preventDefault()
    e.stopPropagation()
    const next = Math.min(last, Math.max(0, to))
    setPos(next)
    pick(next)
  }

  const input = useRef<HTMLInputElement>(null)
  // HACK: React Aria announces a slider's value as a number ("3"); a level is read by its name ("High"). It sets
  // aria-valuetext on every render, so the name is written after it commits.
  const name = steps[Math.round(pos)]?.label ?? ""
  useEffect(() => input.current?.setAttribute("aria-valuetext", name))

  return (
    // Catches the keys of the slider's own input inside (a whole level per key).
    <div onKeyDownCapture={onKey} className={cn("w-full", className)}>
      <Slider aria-label={label} minValue={0} maxValue={last} step={FINE} value={pos} onChange={(v) => move(v as number)} onChangeEnd={(v) => settle(v as number)}>
        {/* The pill (28px) and the thumb (20px) leave 4px around it on every side: the track inside is inset by half
            the thumb's width plus those 4px (React Aria keeps the track relative: the inset is a margin). */}
        <div className="h-7 rounded-full bg-control">
          <SliderTrack className="mx-5.5 h-full cursor-default">
            {steps.map((s, i) => (
              <span
                key={s.id}
                aria-hidden="true"
                className={cn("absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors duration-200 ease-out motion-reduce:transition-none", i <= pos + 0.01 ? "bg-secondary" : "bg-dim")}
                style={{ left: `${(i / last) * 100}%` }}
              />
            ))}
            {/* Glides (left) between stops and squeezes a little while dragged (scale is its own property, so React
                Aria's inline translate stays intact). While dragged it follows the pointer with no lag: only the
                squeeze animates. The drag is this component's own state: React Aria marks a drag that starts on the
                thumb, not one that starts on the track. */}
            <SliderThumb
              inputRef={input}
              className={cn(
                "top-1/2 h-5 w-9 cursor-default rounded-full bg-fg outline-none data-focus-visible:ring-2 data-focus-visible:ring-accent",
                "transition-[left,scale] duration-200 ease-out motion-reduce:transition-none",
                dragging && "scale-95 transition-[scale] motion-reduce:scale-100"
              )}
            />
          </SliderTrack>
        </div>
      </Slider>
    </div>
  )
}
