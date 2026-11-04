// Motion (motion.dev) for the moves CSS can't do cleanly: a width or height to/from "auto" without unmounting,
// and one shape sliding between places (layoutId). One spring for the whole app; MotionConfig in main.tsx turns
// it all off when the system asks for reduced motion.
import { AnimatePresence, motion } from "motion/react"
import type { ReactNode } from "react"

export const spring = { type: "spring", bounce: 0, visualDuration: 0.22 } as const

// A block that opens and closes by height (a sidebar section, a group).
export function Fold({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div key="fold" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={spring} className="overflow-hidden">
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

export { MotionConfig } from "motion/react"
