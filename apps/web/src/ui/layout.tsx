// Screen scaffolding shared by every page: a header bar (title, a muted line, actions) over a scrolling
// body; sections with small muted headings; the empty state; a thin meter for shares and limits.
import { type ReactNode, useLayoutEffect, useState } from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"

// A page's header bar. In the desktop app it moves up into the window's title bar (the #titlebar-slot the shell
// renders), as in a reference app: the card starts with the page itself. Elsewhere it is the card's top bar.
export function PageHeader({ className, children }: { className?: string; children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => setSlot(document.getElementById("titlebar-slot")), [])
  if (slot) return createPortal(<div className="flex min-w-0 flex-1 items-center gap-x-3 pr-3 pl-7">{children}</div>, slot)
  return <header className={cn("flex shrink-0 flex-wrap items-center border-b border-subtle", className)}>{children}</header>
}

export function Screen({ title, subtitle, actions, children, bodyClassName }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; bodyClassName?: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader className="min-h-14 gap-x-4 gap-y-2 px-7 py-3">
        <h1 className="truncate text-lg font-semibold">{title}</h1>
        {subtitle && <span className="min-w-0 flex-1 truncate text-muted">{subtitle}</span>}
        {!subtitle && <span className="flex-1" />}
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </PageHeader>
      <div className={cn("min-h-0 flex-1 overflow-auto", bodyClassName)}>{children}</div>
    </div>
  )
}

// A centered reading column inside a Screen.
export const Column = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn("mx-auto flex w-full max-w-3xl flex-col gap-8 px-7 py-7", className)}>{children}</div>
)

export function Section({ title, description, action, children, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-end gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="text-sm font-medium text-muted">{title}</h2>
          {description && <p className="text-sm text-dim">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

// A list of rows separated by hairlines (settings, inbox): flat, no nested cards.
export const Rows = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn("flex flex-col divide-y divide-subtle border-y border-subtle", className)}>{children}</div>
)

export function EmptyState({ icon, title, hint, action }: { icon?: ReactNode; title: ReactNode; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
      {icon && <span className="mb-1 flex size-10 items-center justify-center rounded-card bg-surface text-muted [&_svg]:size-5">{icon}</span>}
      <p className="font-medium text-fg">{title}</p>
      {hint && <p className="max-w-sm text-muted">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

// value in 0..1. With warnAt (e.g. 0.8 for a subscription limit, ARCHITECTURE §10.2) it turns warning past it.
export function Meter({ value, label, warnAt, className }: { value: number; label: string; warnAt?: number; className?: string }) {
  const v = Math.min(1, Math.max(0, value))
  return (
    // biome-ignore lint/a11y/useSemanticElements: a native <meter> can't take the tokens' look in every engine
    <span role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)} className={cn("block h-1 overflow-hidden rounded-full bg-control", className)}>
      <span className={cn("block h-full rounded-full transition-[width] duration-300 ease-out motion-reduce:transition-none", warnAt !== undefined && v > warnAt ? "bg-warning" : "bg-accent")} style={{ width: `${v * 100}%` }} />
    </span>
  )
}

// Monospace inline (paths, commands, tool names).
export const Code = ({ children, className }: { children: ReactNode; className?: string }) => (
  <code className={cn("rounded-md bg-surface px-1.5 py-0.5 font-mono text-sm", className)}>{children}</code>
)
