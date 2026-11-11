// Motion (motion.dev) for the moves CSS can't do cleanly: a width or height to/from "auto" without unmounting,
// and one shape sliding between places (layoutId). One spring for the whole app; MotionConfig in main.tsx turns
// it all off when the system asks for reduced motion.
import { AnimatePresence, motion } from "motion/react"
import type { ReactNode } from "react"

// How new content settles in where it replaces other content (a tab's panel, a list switching scope); CSS, no JS.
export const SETTLE = "animate-in fade-in-0 slide-in-from-bottom-1 duration-200 ease-out motion-reduce:animate-none"

export const spring = { type: "spring", bounce: 0, visualDuration: 0.22 } as const

// How things open and close, shared so they never drift apart. By height: clipped only while it moves (once open, a
// focus ring at its edge shows whole). By width: a side panel. AnimatePresence keeps a leaving child's last render on
// screen through its exit, so the callers don't need to hold on to what it showed.
const byHeight = {
  initial: { height: 0, opacity: 0, overflow: "hidden" },
  animate: { height: "auto", opacity: 1, transitionEnd: { overflow: "visible" } },
  exit: { height: 0, opacity: 0, overflow: "hidden" },
  transition: spring
} as const
const byWidth = { initial: { width: 0, opacity: 0 }, animate: { width: "auto", opacity: 1 }, exit: { width: 0, opacity: 0 }, transition: spring } as const
const rising = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: 8 }, transition: spring } as const

// A block that opens and closes by height (a sidebar section, a group).
export function Fold({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div key="fold" {...byHeight}>
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// A panel that slides its width open and closed, keeping its content mounted (state and scroll survive). `closed`:
// the width it keeps when closed (a gutter), so whatever follows moves in the same spring.
export function SlideWidth({ open, width, closed = 0, children }: { open: boolean; width: number; closed?: number; children: ReactNode }) {
  return (
    <motion.div initial={false} animate={{ width: open ? width : closed, opacity: open ? 1 : 0 }} transition={spring} className="flex shrink-0 overflow-hidden" aria-hidden={!open} inert={!open}>
      {children}
    </motion.div>
  )
}

// A box whose width follows a value (or its content's, "auto") in the shared spring.
export function Width({ width, className, children }: { width: number | "auto"; className?: string; children: ReactNode }) {
  return (
    <motion.div initial={false} animate={{ width }} transition={spring} className={className}>
      {children}
    </motion.div>
  )
}

// The current place's background, sliding from the previous one (one per `id` group).
export const Marker = ({ id, className }: { id: string; className?: string }) => <motion.span layoutId={id} transition={spring} aria-hidden="true" className={className} />

// A row that glides to its new place when its list is reordered (a drop, a move), instead of jumping: Motion's
// layout animation on the shared spring. Still under reduced motion (MotionConfig).
export const Reflow = ({ className, children }: { className?: string; children: ReactNode }) => (
  <motion.div layout="position" transition={spring} className={className}>
    {children}
  </motion.div>
)

// A side panel that opens and closes by its width (the shared spring), so what sits beside it gives way smoothly
// instead of jumping.
export function Drawer({ open, className, children }: { open: boolean; className?: string; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div key="drawer" {...byWidth} className={className ?? "flex min-h-0 shrink-0 overflow-hidden"}>
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// A list whose rows come and go: a row taught, forgotten or moved opens or closes by its height with a fade (and the
// rest glide), instead of popping. Wrap the rows (each a PresenceRow with its own key) in ListPresence.
export const ListPresence = ({ children }: { children: ReactNode }) => <AnimatePresence initial={false}>{children}</AnimatePresence>
export const PresenceRow = ({ className, children }: { className?: string; children: ReactNode }) => (
  <motion.div layout="position" {...byHeight} className={className}>
    {children}
  </motion.div>
)
// Something that appears to tell you a thing (an Undo receipt): rises 8px into place and fades, and leaves the way back.
export function Rise({ show, className, children }: { show: boolean; className?: string; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div key="rise" {...rising} className={className}>
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export { MotionConfig } from "motion/react"
