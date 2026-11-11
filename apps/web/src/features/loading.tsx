// The app loading: Zorel's mark in the middle, breathing, until it knows what to show (local or team mode, then
// whether there are agents yet). One screen for every wait at start, so nothing else flashes before the right one.
import { Logo } from "@/ui"

export function Loading({ desktop = false }: { desktop?: boolean }) {
  return (
    <div className="flex h-full flex-col bg-canvas">
      {desktop && <div className="app-drag h-12 shrink-0" />}
      <div role="status" aria-busy="true" className="flex flex-1 items-center justify-center">
        <Logo className="size-10 animate-pulse text-muted motion-reduce:animate-none" />
      </div>
    </div>
  )
}
