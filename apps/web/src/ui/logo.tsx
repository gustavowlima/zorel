// Zero's mark: one rounded stroke that reads as both a zero and a Z. Its loop is the zero; the diagonal, in the
// signal blue, is the Z's stroke (the app icon, apps/desktop/assets/icon.svg, draws the same in white on blue).
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M6.5 13.5V10a5.5 5.5 0 0 1 5.5-5.5h5.5M6.5 19.5H12a5.5 5.5 0 0 0 5.5-5.5v-3.5" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
      <path d="M17.5 4.5 6.5 19.5" stroke="var(--color-accent)" strokeWidth="2.1" strokeLinecap="round" />
    </svg>
  )
}
