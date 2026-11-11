// Zorel's mark: two arcs from opposite corners, each ending in a dot, and the blue core between them.
// In the app it draws in the text color with the accent core, its strokes heavier than the 100px original so it
// still reads at 20px. The app icon (apps/desktop/assets/icon.svg) and the favicon (apps/web/index.html) draw the
// same shape, white on the graphite tile.
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" fill="none" aria-hidden="true" className={className}>
      <path d="M21.7 21.7 A40 40 0 0 1 78.3 21.7 L61.3 38.7 M38.7 61.3 L21.7 78.3 A40 40 0 0 0 78.3 78.3" stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="50" cy="50" r="13" className="fill-accent" />
      <circle cx="21.7" cy="21.7" r="8" fill="currentColor" />
      <circle cx="78.3" cy="78.3" r="8" fill="currentColor" />
    </svg>
  )
}
