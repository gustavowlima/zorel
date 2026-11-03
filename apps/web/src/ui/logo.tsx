// Zero's mark: a zero crossed by a Z's diagonal (the same drawing as the app icon, apps/desktop/assets/icon.svg).
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <ellipse cx="12" cy="12" rx="5.4" ry="7.6" stroke="currentColor" strokeWidth="2.4" />
      <line x1="8.6" y1="17" x2="15.4" y2="7" stroke="var(--color-accent)" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}
