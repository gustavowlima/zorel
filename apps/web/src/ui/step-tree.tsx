// The work a reply did, as a tree (the sidebar's lines; DESIGN.md "Steps"): a head with a chevron (a spinner while it
// works) the trunk hangs from, and the summary in words; under it, open, one row per step: an elbow from the trunk
// (x 8) to its glyph (x 24), its title in plain words from x 46, quiet facts after it (how long, that it failed), and
// its command or path in mono only on hover or focus. The trunk runs on only while a step follows (`last` ends it). A
// row that opens shows what it ran and returned under it, the trunk passing beside. A note (a thought) has no glyph
// and no elbow: its words sit in the tree.
import type { ReactNode } from "react"
import { Button } from "react-aria-components"
import { cn } from "@/lib/utils"
import { ChevronRight } from "./icons"

export function StepHead({
  open,
  rows = true,
  onToggle,
  leading,
  controls,
  children
}: {
  open: boolean
  rows?: boolean // any steps under it yet (a turn just started has none: no trunk to draw)
  onToggle: () => void
  leading?: ReactNode
  controls?: string
  children: ReactNode
}) {
  return (
    <Button
      onPress={onToggle}
      aria-expanded={open}
      {...(controls && { "aria-controls": controls })}
      className="relative flex h-7 w-fit max-w-full min-w-0 cursor-default items-center gap-2 rounded-control pr-2.5 text-left text-base text-muted outline-none transition-colors duration-120 ease-out data-hovered:text-secondary data-focus-visible:ring-2 data-focus-visible:ring-accent motion-reduce:transition-none"
    >
      <span className="flex w-4 shrink-0 justify-center text-dim [&_svg]:size-3.5">
        {leading ?? <ChevronRight aria-hidden="true" className={cn("transition-transform duration-200 ease-out motion-reduce:transition-none", open && "rotate-90")} />}
      </span>
      <span className="flex min-w-0 items-baseline gap-1.5">{children}</span>
      {/* Open: the trunk starts under the chevron. */}
      {open && rows && <span aria-hidden="true" className="pointer-events-none absolute top-5 bottom-0 left-2 border-l border-strong" />}
    </Button>
  )
}

export const StepList = ({ id, children }: { id?: string; children: ReactNode }) => (
  <ol {...(id && { id })} className="flex flex-col text-base">
    {children}
  </ol>
)

type Tone = "default" | "danger" | "warning" | "waiting"
const TONE: Record<Tone, string> = { default: "text-dim", danger: "text-danger", warning: "text-warning", waiting: "text-accent-text" }

export function StepRow({
  icon,
  title,
  facts,
  hint,
  tone = "default",
  last = false,
  open,
  onToggle,
  controls,
  children
}: {
  icon: ReactNode
  title: string
  facts?: ReactNode // after the title, quiet: how long, that it failed or waits
  hint?: string | undefined // the command, path or URL, on hover or focus
  tone?: Tone
  last?: boolean
  open?: boolean
  onToggle?: (() => void) | undefined // the row opens to `children`
  controls?: string
  children?: ReactNode
}) {
  const content = (
    <>
      <span aria-hidden="true" className={cn("absolute top-1.5 left-6 flex size-4 items-center justify-center [&_svg]:size-3.5", TONE[tone])}>
        {icon}
      </span>
      <span className={cn("min-w-0 shrink truncate", onToggle && open ? "text-fg" : "text-secondary")} title={hint ? `${title}\n${hint}` : title}>
        {title}
      </span>
      {facts && <span className="flex shrink-0 items-center gap-2 text-sm text-dim tabular-nums">{facts}</span>}
      {hint && (
        <span className="min-w-0 flex-1 truncate font-mono text-sm text-dim opacity-0 transition-opacity duration-120 group-hover/step:opacity-100 group-data-focus-visible/step:opacity-100 motion-reduce:transition-none">
          {hint}
        </span>
      )}
    </>
  )
  const row = "group/step relative flex min-h-7 w-full min-w-0 items-center gap-2 rounded-control pr-2.5 pl-11.5 text-left outline-none"
  return (
    <li className="relative">
      {/* The elbow from the trunk to the glyph, and the trunk on below unless this is the last step. */}
      <span aria-hidden="true" className="pointer-events-none absolute top-0 left-2 h-3.5 w-3 rounded-bl-lg border-b border-l border-strong" />
      {!last && <span aria-hidden="true" className="pointer-events-none absolute top-3.5 bottom-0 left-2 border-l border-strong" />}
      {onToggle ? (
        <Button
          onPress={onToggle}
          aria-expanded={!!open}
          {...(controls && { "aria-controls": controls })}
          className={({ isHovered, isFocusVisible }) => cn(row, "cursor-default", (isHovered || isFocusVisible) && "tree-wash [--wash:var(--z-bg-hover)]", isFocusVisible && "ring-2 ring-accent")}
        >
          {content}
        </Button>
      ) : (
        <div className={row}>{content}</div>
      )}
      {open && children && (
        <div {...(controls && { id: controls })} className="flex min-w-0 flex-col gap-1.5 pt-0.5 pr-2.5 pb-2.5 pl-11.5">
          {children}
        </div>
      )}
    </li>
  )
}

// A thought: its words in the tree, two lines at most; the trunk passes it only on its way to a step below.
export function StepNote({ last = false, children }: { last?: boolean; children: ReactNode }) {
  return (
    <li className="relative py-1 pr-2.5 pl-6 text-dim">
      {!last && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-2 border-l border-strong" />}
      <span className="line-clamp-2">{children}</span>
    </li>
  )
}
