// Zorel's mark: a Z in one rounded stroke, in the text color (the app icon, apps/desktop/assets/icon.svg, and the
// favicon in apps/web/index.html draw the same path).
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M7 7.5h9.4c.7 0 1 .8.6 1.3L7.4 15.2c-.4.5-.1 1.3.6 1.3H17" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
