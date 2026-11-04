// Zorel's mark: one rounded stroke that reads as a Z, in the text color (the app icon,
// apps/desktop/assets/icon.svg, draws the same in white on blue).
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M6.5 13.5V10a5.5 5.5 0 0 1 5.5-5.5h5.5L6.5 19.5H12a5.5 5.5 0 0 0 5.5-5.5v-3.5"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
