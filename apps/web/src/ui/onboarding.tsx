// The first run's set (features/first-run.tsx), after Zorel's mark: the core in the middle and the agents around it.
// The opening draws the mark (the corner dots, the arcs into the core, the core lighting), opens the orbits and puts
// the agents on them, one moment of about three seconds that a click or a key skips. The orbits stay behind every
// step: a suggestion lights its agent, a new agent is born at the core while the Builder works and takes an orbit.
// The mark glides between the opening and the steps (layoutId). Reduced motion: everything is still (MotionConfig).
import { AnimatePresence, type MotionProps, motion, useReducedMotion } from "motion/react"
import { type ReactNode, useEffect, useId } from "react"
import { cn } from "@/lib/utils"
import { Button } from "./button"
import { ArrowLeft } from "./icons"
import { CoreCut, Logo } from "./logo"

const EXPO = [0.16, 1, 0.3, 1] as const
const RINGS = [110, 200, 300, 410, 530] as const
// The agents on the orbits: their tone (--z-agent-N), orbit, where they start and how long a turn takes.
const ORBITERS = [
  { tone: 1, r: 200, at: 215, size: 6, turn: 140 },
  { tone: 3, r: 300, at: 40, size: 5, turn: 200 },
  { tone: 2, r: 410, at: 160, size: 4.5, turn: 260 },
  { tone: 4, r: 300, at: 290, size: 4.5, turn: 200 },
  { tone: 5, r: 530, at: 100, size: 3.5, turn: 320 },
  { tone: 6, r: 410, at: 330, size: 3.5, turn: 260 }
] as const
const tone = (n: number) => `var(--z-agent-${n})`

// The orbits and their agents; dimmed once a step's text sits over it (after the opening).
export function OnboardingSet({ opening }: { opening: boolean }) {
  const delay = (s: number) => (opening ? s : 0)
  return (
    <div aria-hidden="true" className={cn("pointer-events-none absolute inset-0 transition-opacity duration-1000", opening ? "opacity-100" : "opacity-35")}>
      <svg viewBox="-600 -600 1200 1200" preserveAspectRatio="xMidYMid slice" aria-hidden="true" className="size-full">
        {RINGS.map((r, i) => (
          <motion.circle key={r} r={r} fill="none" stroke="var(--z-border-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke" initial={{ opacity: 0, scale: 0.2 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1.3, delay: delay(1.15 + i * 0.07), ease: EXPO }} />
        ))}
        <motion.g stroke="var(--z-border)" strokeWidth="1" vectorEffect="non-scaling-stroke" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.9, delay: delay(1.4) }}>
          <line x1="-430" y1="-430" x2="-90" y2="-90" />
          <line x1="430" y1="430" x2="90" y2="90" />
        </motion.g>
      </svg>
      {/* The agents: HTML dots on layers that turn by transform (the GPU composes them), not SVG groups turning, which
          would repaint the whole drawing every frame. A square as large as the SVG's "slice" (its larger side) keeps
          them on the rings: a radius of r units is r/12 % of it. */}
      <div className="absolute inset-0 [container-type:size]">
        <div className="absolute top-1/2 left-1/2 size-[max(100cqw,100cqh)] -translate-1/2">
          {ORBITERS.map((o, i) => {
            return (
              <div key={o.tone} className="absolute inset-0 animate-spin will-change-transform motion-reduce:animate-none" style={{ animationDuration: `${o.turn}s`, rotate: `${o.at}deg` }}>
                <Dot r={o.r} size={o.size} color={tone(o.tone)} initial={{ opacity: 0, scale: 0 }} animate={{ opacity: o.tone > 4 ? 0.45 : 0.75, scale: 1 }} transition={{ duration: 0.8, delay: opening ? 1.5 + i * 0.07 : 0, ease: EXPO }} />
              </div>
            )
          })}
        </div>
      </div>
      {/* The edges fade into the canvas, so the text over the middle stays the subject. */}
      <div className="absolute inset-0 bg-radial from-transparent from-30% to-canvas to-78%" />
    </div>
  )
}

// One agent on an orbit, `r` units from the center (the set's 1200-unit square), `size` units of radius.
function Dot({ r, size, color, ...motionProps }: { r: number; size: number; color: string } & Pick<MotionProps, "initial" | "animate" | "transition">) {
  return (
    <motion.span
      className="absolute rounded-full"
      style={{ left: `${50 + r / 12}%`, top: "50%", width: `${size / 6}%`, height: `${size / 6}%`, translate: "-50% -50%", background: color }}
      {...motionProps}
    />
  )
}

// The mark drawn for the opening: two corner dots, the arcs from them into the core, the core lighting with a bloom.
function DrawnMark() {
  const cut = useId()
  const arc = (d: string, i: number) => (
    <motion.path key={d} d={d} mask={`url(#${cut})`} stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" fill="none" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.95, delay: 0.25 + i * 0.06, ease: EXPO }} />
  )
  const pop = (cx: number, cy: number, r: number, delay: number) => (
    <motion.circle cx={cx} cy={cy} r={r} fill="currentColor" style={{ transformBox: "fill-box", transformOrigin: "center" }} initial={{ scale: 0 }} animate={{ scale: [0, 1.22, 1] }} transition={{ duration: 0.6, delay, ease: EXPO }} />
  )
  return (
    <svg viewBox="0 0 100 100" fill="none" aria-hidden="true" className="size-full overflow-visible">
      <CoreCut id={cut} />
      <motion.circle cx="50" cy="50" r="13" fill="none" stroke="var(--z-accent-text)" strokeWidth="1.2" style={{ transformBox: "fill-box", transformOrigin: "center" }} initial={{ opacity: 0, scale: 1 }} animate={{ opacity: [0.9, 0], scale: [1, 7] }} transition={{ duration: 1.4, delay: 1.1, ease: EXPO }} />
      {/* Both arcs drawn from their corner toward the core (the second one is the mark's lower arc, reversed). */}
      {arc("M21.7 21.7 A40 40 0 0 1 78.3 21.7 L61.3 38.7", 0)}
      {arc("M78.3 78.3 A40 40 0 0 1 21.7 78.3 L38.7 61.3", 1)}
      {pop(50, 50, 13, 1.05)}
      {pop(21.7, 21.7, 8, 0.05)}
      {pop(78.3, 78.3, 8, 0.13)}
    </svg>
  )
}

const MARK_ID = "zorel-mark"
const OPENING_MS = 3600

// The opening: the mark drawn in the middle, then the name and a line; done after OPENING_MS or at once when skipped.
export function MarkOpening({ title, line, skip, onDone }: { title: string; line: string; skip: string; onDone: () => void }) {
  const still = useReducedMotion()
  useEffect(() => {
    const timer = setTimeout(onDone, still ? 300 : OPENING_MS)
    const key = (e: KeyboardEvent) => ["Enter", "Escape", " "].includes(e.key) && onDone()
    addEventListener("keydown", key)
    return () => {
      clearTimeout(timer)
      removeEventListener("keydown", key)
    }
  }, [onDone, still])
  // The name sharpens in (a short word: a small blur is cheap); the line only rises.
  const rise = (delay: number, blur = false) => ({ initial: { opacity: 0, y: 10, ...(blur && { filter: "blur(6px)" }) }, animate: { opacity: 1, y: 0, ...(blur && { filter: "blur(0px)" }) }, transition: { duration: 0.9, delay, ease: EXPO } })
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: keys skip it too (the listener above)
    // biome-ignore lint/a11y/noStaticElementInteractions: a click anywhere skips the opening; the button below is the accessible way
    <div className="absolute inset-0 flex cursor-pointer items-center justify-center px-4" onClick={onDone}>
      {/* The mark's core sits on the orbits' center (the set is centered on this same box), the words just under it. */}
      <motion.div layoutId={MARK_ID} className="size-32" transition={{ duration: 1, ease: EXPO }}>
        <DrawnMark />
      </motion.div>
      <div className="absolute inset-x-4 top-[calc(50%+92px)] flex flex-col items-center gap-2.5 text-center">
        <motion.h1 className="text-5xl font-semibold tracking-tight" {...rise(1.5, true)}>
          {title}
        </motion.h1>
        <motion.p className="max-w-sm text-base text-balance text-muted" {...rise(1.7)}>
          {line}
        </motion.p>
      </div>
      <Button variant="ghost" size="sm" className="absolute bottom-6" onPress={onDone}>
        {skip}
      </Button>
    </div>
  )
}

// The first run's header: the mark (it glides here from the opening) and where the person is in the steps. It stays
// put while the steps change under it.
export function StepHeader({ at, steps }: { at: number; steps: ReadonlyArray<string> }) {
  return (
    // A band of its own above the step (the step scrolls under it, never behind the mark).
    <div className="relative z-10 flex shrink-0 justify-center px-6">
      <div className="flex w-full max-w-xl items-center justify-between pt-14 pb-6">
        <motion.div layoutId={MARK_ID} className="size-9" transition={{ duration: 1, ease: EXPO }}>
          <Logo className="size-full" />
        </motion.div>
        <ol aria-label={steps[at]} className="flex items-center gap-1.5">
          {steps.map((label, i) => (
            <li key={label} title={label} aria-current={i === at ? "step" : undefined} className={cn("h-1 rounded-full transition-all duration-500", i === at ? "w-6 bg-accent" : i < at ? "w-3 bg-fg/40" : "w-3 bg-control-active")} />
          ))}
        </ol>
      </div>
    </div>
  )
}

// A step changing to the next one: out to one side and in from the other (`dir` 1 forward, -1 back). Only opacity
// and position move (the GPU draws them): a blur over a whole step repaints it every frame and stutters.
const slide = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 40 }),
  center: { opacity: 1, x: 0 },
  exit: (dir: number) => ({ opacity: 0, x: dir * -40 })
}
export function StepTransition({ id, dir, children }: { id: string; dir: number; children: ReactNode }) {
  return (
    <AnimatePresence mode="wait" custom={dir} initial={false}>
      <motion.div key={id} custom={dir} variants={slide} initial="enter" animate="center" exit="exit" transition={{ duration: 0.4, ease: EXPO }} className="relative flex min-h-0 flex-1 will-change-transform">
        {children}
      </motion.div>
    </AnimatePresence>
  )
}

// A first-run step's column under the header: "back" on top (when there is one) and, across from it, "later" (skip
// the setup), then the step.
export type StepAction = { label: string; onPress: () => void; busy?: boolean }
export function StepColumn({ back, later, children }: { back?: StepAction | undefined; later?: StepAction | undefined; children: ReactNode }) {
  return (
    <div className="relative flex min-h-0 flex-1 justify-center overflow-y-auto px-6">
      <div className="flex w-full max-w-xl min-w-0 flex-col gap-6 pt-1 pb-14">
        {(back || later) && (
          <div className="-mx-2.5 -mb-2 flex items-center justify-between">
            {back ? (
              <Button variant="ghost" size="sm" className="text-muted" onPress={back.onPress}>
                <ArrowLeft />
                {back.label}
              </Button>
            ) : (
              <span />
            )}
            {later && (
              <Button variant="ghost" size="sm" className="text-muted" isPending={!!later.busy} onPress={later.onPress}>
                {later.label}
              </Button>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  )
}
