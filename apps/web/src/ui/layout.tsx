// Screen scaffolding shared by every page: a header bar (title, a muted line, actions) over a scrolling
// body; sections with small muted headings; the empty state; a thin meter for shares and limits.
import { type ReactNode, useLayoutEffect, useState } from "react"
import { createPortal } from "react-dom"
import { Button as AriaButton } from "react-aria-components"
import { cn } from "@/lib/utils"
import { ChevronRight } from "./icons"

// A page's header bar. In the desktop app it moves up into the window's title bar (the #titlebar-slot the shell
// renders): the card starts with the page itself. Elsewhere it is the card's top bar.
export function PageHeader({ className, children }: { className?: string; children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => setSlot(document.getElementById("titlebar-slot")), [])
  if (slot) return createPortal(<div className="flex min-w-0 flex-1 items-center gap-x-3 pr-4 pl-3">{children}</div>, slot)
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
      <div className={cn("relative min-h-0 flex-1 overflow-auto", bodyClassName)}>{children}</div>
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

// The square that holds an icon beside a row or a heading: sm 28px, md 32px, lg 40px (empty states). A translucent
// control tone, so it reads on the canvas and on a surface alike.
const TILE = { sm: "size-7 rounded-control [&_svg]:size-4", md: "size-8 rounded-control [&_svg]:size-4", lg: "size-10 rounded-card [&_svg]:size-5" } as const
export function IconTile({ size = "md", className, children }: { size?: keyof typeof TILE; className?: string; children: ReactNode }) {
  return (
    <span aria-hidden="true" className={cn("flex shrink-0 items-center justify-center bg-control text-secondary", TILE[size], className)}>
      {children}
    </span>
  )
}

// A notice that needs attention on a page (a limit reached, a failover): the icon in the state color, the text in
// the page's own, an optional action under it.
export function Notice({ tone = "warning", icon, title, children, action, className }: { tone?: "warning" | "danger"; icon: ReactNode; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div role="alert" className={cn("flex gap-3 rounded-card border border-subtle bg-surface px-4 py-3", className)}>
      <span className={cn("mt-0.5 shrink-0 [&_svg]:size-4", tone === "warning" ? "text-warning" : "text-danger")}>{icon}</span>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-2 text-sm">
        {title && <p className="font-medium text-fg">{title}</p>}
        {children && <div className="text-secondary">{children}</div>}
        {action}
      </div>
    </div>
  )
}

export function EmptyState({ icon, title, hint, action }: { icon?: ReactNode; title: ReactNode; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
      {icon && (
        <IconTile size="lg" className="mb-1 text-muted">
          {icon}
        </IconTile>
      )}
      <p className="font-medium text-fg">{title}</p>
      {hint && <p className="max-w-sm text-muted">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

// value in 0..1. With warnAt (e.g. 0.8 for a subscription limit, ARCHITECTURE §10.2) it turns warning past it.
// role "progressbar" for work under way (a download), "meter" for a level (usage).
export function Meter({ value, label, warnAt, className, role = "meter" }: { value: number; label: string; warnAt?: number; className?: string; role?: "meter" | "progressbar" }) {
  const v = Math.min(1, Math.max(0, value))
  return (
    // A span, not a native <meter>/<progress>: those can't take the tokens' look in every engine.
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: role is "meter" or "progressbar", both take aria-label (Biome can't read a dynamic role)
    <span role={role} aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)} className={cn("block h-1 overflow-hidden rounded-full bg-control", className)}>
      <span className={cn("block h-full rounded-full transition-[width] duration-300 ease-out motion-reduce:transition-none", warnAt !== undefined && v > warnAt ? "bg-warning" : "bg-accent")} style={{ width: `${v * 100}%` }} />
    </span>
  )
}

// Monospace inline (paths, commands, tool names).
export const Code = ({ children, className }: { children: ReactNode; className?: string }) => (
  <code className={cn("rounded-md bg-surface px-1.5 py-0.5 font-mono text-sm", className)}>{children}</code>
)

// A row of a list between hairlines (Rows) that opens something: content flush with the section heading, a chevron,
// and on hover a faint wash inset inside the hairlines (never a card over them). The whole row is one button (an
// overlay under the content); `trailing` holds a control of its own (a "Sign in"), pressable on top of it.
// A whole row as one press target (the row's content stays on top, unpressable): hover tint inside the hairlines.
export const RowHit = ({ label, onPress }: { label: string; onPress: () => void }) => (
  <AriaButton
    aria-label={label}
    onPress={onPress}
    className="absolute -inset-x-2.5 inset-y-1 cursor-default rounded-control outline-none transition-colors duration-120 ease-out data-focus-visible:ring-2 data-focus-visible:ring-accent data-hovered:bg-hover data-pressed:bg-control-active motion-reduce:transition-none"
  />
)

export function ListRow({
  icon,
  title,
  hint,
  hintTone,
  aside,
  trailing,
  onPress,
  label
}: {
  icon?: ReactNode
  title: ReactNode
  hint?: ReactNode
  hintTone?: "warning" | "success"
  aside?: ReactNode // quiet text on the right (a size, a count)
  trailing?: ReactNode
  onPress: () => void
  label: string
}) {
  return (
    <div className="relative flex min-h-14 items-center gap-3.5 py-2.5">
      <RowHit label={label} onPress={onPress} />
      {icon && <span className="pointer-events-none relative flex size-5 shrink-0 items-center justify-center">{icon}</span>}
      <span className="pointer-events-none relative flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{title}</span>
        {hint && <span className={cn("truncate text-sm", hintTone === "warning" ? "text-warning" : hintTone === "success" ? "text-success" : "text-muted")}>{hint}</span>}
      </span>
      {aside && <span className="pointer-events-none relative shrink-0 text-sm text-muted tabular-nums">{aside}</span>}
      {trailing && <span className="relative flex shrink-0 items-center gap-2">{trailing}</span>}
      <ChevronRight className="pointer-events-none relative size-4 shrink-0 text-muted" />
    </div>
  )
}
