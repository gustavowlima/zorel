// Zorel's mark: two arcs from opposite corners, each ending in a dot, and the core between them; all one color. The
// arcs stop short of the core along a ring around it (a cut that follows the circle, not round line ends touching
// it). In the app it draws in the text color, its strokes heavier than the 100px original so it still reads at 20px.
// The app icon (apps/desktop/assets/icon.svg) and the favicon (apps/web/index.html) draw the same shape, white on the
// graphite tile.
import { useId } from "react"

export const MARK_ARCS = "M21.7 21.7 A40 40 0 0 1 78.3 21.7 L61.3 38.7 M38.7 61.3 L21.7 78.3 A40 40 0 0 0 78.3 78.3"
export const CORE_R = 13
export const CUT_R = 18.5 // the ring the arcs stop at: the core plus a gap

// The mask that cuts the arcs around the core (inside an <svg> with viewBox 0 0 100 100).
export function CoreCut({ id }: { id: string }) {
  return (
    <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
      <rect x="-10" y="-10" width="120" height="120" fill="white" />
      <circle cx="50" cy="50" r={CUT_R} fill="black" />
    </mask>
  )
}

export function Logo({ className }: { className?: string }) {
  const cut = useId()
  return (
    <svg viewBox="0 0 100 100" fill="none" aria-hidden="true" className={className}>
      <CoreCut id={cut} />
      <path d={MARK_ARCS} mask={`url(#${cut})`} stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="50" cy="50" r={CORE_R} fill="currentColor" />
      <circle cx="21.7" cy="21.7" r="8" fill="currentColor" />
      <circle cx="78.3" cy="78.3" r="8" fill="currentColor" />
    </svg>
  )
}
