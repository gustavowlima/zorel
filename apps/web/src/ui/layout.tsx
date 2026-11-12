// Screen scaffolding shared by every page: a header bar (title, a muted line, actions) over a scrolling
// body; sections with small muted headings; the empty state; a thin meter for shares and limits.
//
// One page rhythm (DESIGN.md › Layout): every header is HEADER (56px, the title 28px from the card's edge, the
// actions 16px from the window's); a page's body is a Column (centered, 28px around, reading or wide); its sections
// sit 40px apart, a page's tabs 32px above what they show, and a section's title 12px above its card.
import { EmptyOrbit, Scene, type SceneKind } from "./face"
import { type CSSProperties, type ReactNode, useLayoutEffect, useState } from "react"
import { createPortal } from "react-dom"
import { Button as AriaButton } from "react-aria-components"
import { cn } from "@/lib/utils"
import { ChevronRight, Plug } from "./icons"

// A page's header bar. In the desktop app it moves up into the window's title bar (the #titlebar-slot the shell
// renders): the card starts with the page itself. Elsewhere it is the card's top bar.
export function PageHeader({ className, children }: { className?: string; children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => setSlot(document.getElementById("titlebar-slot")), [])
  if (slot) return createPortal(<div className="flex min-w-0 flex-1 items-center gap-x-3 pr-4 pl-3">{children}</div>, slot)
  return <header className={cn("flex shrink-0 flex-wrap items-center border-b border-subtle", className)}>{children}</header>
}

export const HEADER = "min-h-14 gap-x-4 gap-y-2 py-3 pr-4 pl-7"

export function Screen({ title, subtitle, actions, children, bodyClassName }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; bodyClassName?: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader className={HEADER}>
        <h1 className="truncate text-title font-semibold">{title}</h1>
        {/* A phone keeps the title and the actions: the subtitle steps aside, and the actions wrap instead of being cut. */}
        {subtitle && <span className="hidden min-w-0 flex-1 truncate text-muted sm:block">{subtitle}</span>}
        <span className={cn("flex-1", subtitle && "sm:hidden")} />
        {actions && <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>}
      </PageHeader>
      {/* A plain body scrolls, and keeps its scrollbar's room even when it doesn't, so the centered column doesn't
          shift as a page grows past the window (a tab to the next). A body laid out by the screen does its own. */}
      <div className={cn("relative min-h-0 flex-1 overflow-auto", bodyClassName ?? "gutter-stable")}>{children}</div>
    </div>
  )
}

// A page's column inside a Screen: centered, 28px around it, its sections 40px apart. Reading width (768px) for lists,
// forms and readers; wide (1024px) for settings and dashboards. `column()` gives the same box to an element that must
// be something else (a form, an article, a Tabs).
export const column = (wide?: boolean) => cn("mx-auto flex w-full flex-col px-7 py-7", wide ? "max-w-5xl" : "max-w-3xl")
export const Column = ({ children, className, wide }: { children: ReactNode; className?: string; wide?: boolean }) => (
  <div className={cn(column(wide), "gap-10", className)}>{children}</div>
)

export function Section({ title, description, action, children, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      {/* The action centers on the title (and its line) and adds no height, so a section with a button starts its card
          where one without does. */}
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="text-sm font-medium text-muted">{title}</h2>
          {description && <p className="text-sm text-dim">{description}</p>}
        </div>
        {action && <div className="-my-1.5 flex shrink-0 items-center">{action}</div>}
      </div>
      {children}
    </section>
  )
}

// A group of rows (settings, lists on a page): one card a tone above the canvas, hairlines between its rows, 16px
// inside. The section's title sits outside, above it. Flat: the tone step is the depth, no shadow; never nested.
export const Rows = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn("flex flex-col divide-y divide-subtle rounded-card border border-subtle bg-surface px-4", className)}>{children}</div>
)

// One setting in a group: what it is (an optional icon tile, title, a line of explanation) and its control on the
// right. On a narrow column the control wraps under the text instead of squeezing it (aligned with the text when an
// @container ancestor is narrow). A hint in a state color
// passes its own span (<span className="text-warning">).
export function SettingRow({ icon, title, hint, children, className }: { icon?: ReactNode; title: ReactNode; hint?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 py-3.5", className)}>
      {icon && <IconTile>{icon}</IconTile>}
      <span className="flex min-w-48 flex-1 flex-col gap-0.5">
        <span className="font-medium">{title}</span>
        {hint && <span className="flex flex-col text-sm text-muted">{hint}</span>}
      </span>
      {/* In a narrow container (a side panel, an @container ancestor under 32rem) the control takes its own line,
          lined up with the text instead of under the icon. Without such an ancestor nothing changes. */}
      {children && <span className={cn("flex shrink-0 items-center gap-2 @max-lg:basis-full", icon && "@max-lg:pl-12")}>{children}</span>}
    </div>
  )
}

// The square that holds an icon beside a row or a heading: sm 28px, md 32px, lg 40px (empty states). A translucent
// control tone, so it reads on the canvas and on a surface alike.
const TILE = { sm: "size-7 rounded-control [&_svg]:size-4", md: "size-8 rounded-control [&_svg]:size-4", lg: "size-10 rounded-card [&_svg]:size-5" } as const
export function IconTile({ size = "md", className, style, children }: { size?: keyof typeof TILE | undefined; className?: string | undefined; style?: CSSProperties | undefined; children: ReactNode }) {
  return (
    <span aria-hidden="true" style={style} className={cn("flex shrink-0 items-center justify-center bg-control text-secondary", TILE[size], className)}>
      {children}
    </span>
  )
}

// A brand's mark (a connector's logo: simple-icons' path and hex) in its own color, or a plug when there is none.
// tile: on a 14% wash of the color, lifted toward the text (Settings, a server's row); inline: the bare 16px mark (a
// list's option). A near-black brand (GitHub, Notion, Vercel, Sentry) would vanish on the dark canvas, so it stays
// neutral.
export type Brand = { readonly hex: string; readonly path: string }
function brandTint(hex: string): CSSProperties | undefined {
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.25 ? undefined : ({ "--tint": `#${hex}` } as CSSProperties)
}
export function BrandMark({ brand, variant = "tile" }: { brand: Brand | undefined; variant?: "tile" | "inline" }) {
  const tint = brand && brandTint(brand.hex)
  const mark = brand ? (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={cn(variant === "inline" && "size-4", variant === "inline" && tint && "tint-text")} style={variant === "inline" ? tint : undefined}>
      <path d={brand.path} />
    </svg>
  ) : (
    <Plug className={cn(variant === "inline" && "size-4 text-muted")} />
  )
  if (variant === "inline") return mark
  return (
    <IconTile style={tint} className={tint && "brand-tile!"}>
      {mark}
    </IconTile>
  )
}

// A notice that needs attention on a page (a limit reached, a failover): the icon in the state color, the text in
// the page's own, an optional action under it. "neutral": information, not an alert (a quiet icon, announced politely).
export function Notice({ tone = "warning", icon, title, children, action, className }: { tone?: "warning" | "danger" | "neutral"; icon: ReactNode; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div role={tone === "neutral" ? "status" : "alert"} className={cn("flex gap-3 rounded-card border border-subtle bg-surface px-4 py-3", className)}>
      <span className={cn("mt-0.5 shrink-0 [&_svg]:size-4", tone === "warning" ? "text-warning" : tone === "danger" ? "text-danger" : "text-muted")}>{icon}</span>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-2 text-sm">
        {title && <p className="font-medium text-fg">{title}</p>}
        {children && <div className="text-secondary">{children}</div>}
        {action}
      </div>
    </div>
  )
}

// inset: an empty list inside a section, a card the size of a row, not a page's centred block.
export function EmptyState({ icon, title, hint, action, inset }: { icon?: ReactNode; title: ReactNode; hint?: ReactNode; action?: ReactNode; inset?: boolean }) {
  if (inset)
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-3 rounded-card border border-dashed border-subtle px-4 py-3.5">
        {icon && <IconTile className="text-muted">{icon}</IconTile>}
        <div className="flex min-w-0 flex-1 basis-60 flex-col">
          <p className="font-medium text-fg">{title}</p>
          {hint && <p className="text-pretty text-sm text-muted">{hint}</p>}
        </div>
        {action}
      </div>
    )
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
      {/* A whole screen with nothing yet shows Zorel's signature: the screen's icon in the core, agents in orbit. */}
      <EmptyOrbit icon={icon} className="mb-5" />
      <p className="font-medium text-fg">{title}</p>
      {hint && <p className="max-w-sm text-pretty text-muted">{hint}</p>}
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

// A whole row as one press target (the row's content stays on top, unpressable): on hover a faint wash that reaches
// 6px from the group's edge.
export const RowHit = ({ label, onPress, className, expanded }: { label: string; onPress: () => void; className?: string; expanded?: boolean }) => (
  <AriaButton
    aria-label={label}
    {...(expanded !== undefined && { "aria-expanded": expanded })}
    onPress={onPress}
    className={cn("absolute -inset-x-2.5 inset-y-1.5 cursor-default rounded-row outline-none transition-colors duration-120 ease-out data-focus-visible:ring-2 data-focus-visible:ring-accent data-hovered:bg-control data-pressed:bg-control-hover motion-reduce:transition-none", className)}
  />
)

// A row of a group (Rows) that opens something: the content on the group's 16px edge, a chevron, and on hover a
// faint wash that reaches 6px from the card's edge (never a card over the card). The whole row is one button (an
// overlay under the content); `trailing` holds a control of its own (a "Sign in", a ⋯), pressable on top of it. The
// icon may be a 20px glyph or a face (up to 28px).
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
      {icon && <span className="pointer-events-none relative flex min-w-5 shrink-0 items-center justify-center">{icon}</span>}
      <span className="pointer-events-none relative flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{title}</span>
        {hint && <span className={cn("truncate text-sm", hintTone === "warning" ? "text-warning" : hintTone === "success" ? "text-success" : "text-muted")}>{hint}</span>}
      </span>
      {/* At most a bit under half the row: in a narrow window the title keeps its room and the aside ends with "…". */}
      {aside && <span className="pointer-events-none relative max-w-[45%] min-w-0 shrink-0 truncate text-sm text-muted tabular-nums">{aside}</span>}
      {trailing && <span className="relative flex shrink-0 items-center gap-2">{trailing}</span>}
      <ChevronRight className="pointer-events-none relative size-4 shrink-0 text-muted" />
    </div>
  )
}

// A section with nothing to show yet, said kindly (spec 018): the same card as its rows, a small scene and one line —
// "all clear" reads as good news, not as a hole.
export function QuietCard({ scene, title, hint }: { scene: SceneKind; title: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex items-center gap-4 rounded-card border border-subtle bg-surface px-4 py-3">
      <Scene kind={scene} />
      <div className="flex min-w-0 flex-col">
        <p className="font-medium text-fg">{title}</p>
        {hint && <p className="text-pretty text-sm text-muted">{hint}</p>}
      </div>
    </div>
  )
}
