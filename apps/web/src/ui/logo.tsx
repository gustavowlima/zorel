// Zorel's mark: a Z in one stroke whose two corners curve into hooks (an echo of the zero it grew from), in the text color (the app icon, apps/desktop/assets/icon.svg, and the
// favicon in apps/web/index.html draw the same path).
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M6.5 7.5a3 3 0 0 1 3-3h8L6.5 19.5h8a3 3 0 0 0 3-3" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
