// A short way through a flow, one step at a time (the side panel's Ship): a 20px mark per step on a hairline (the
// transcript's and the sidebar's line), done (a check on the control tone), now (an accent ring around its dot) or
// later (an empty ring). The step that's now holds what to do; the others say where things stand.
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { Check } from "./icons"

export const Milestones = ({ label, children }: { label: string; children: ReactNode }) => (
  <ol aria-label={label} className="flex flex-col">
    {children}
  </ol>
)

export function Milestone({ state, title, hint, children }: { state: "done" | "now" | "later"; title: ReactNode; hint?: ReactNode; children?: ReactNode }) {
  return (
    <li className="group/ms relative flex gap-3 pb-4 last:pb-0" {...(state === "now" && { "aria-current": "step" as const })}>
      <span aria-hidden="true" className="pointer-events-none absolute top-6 bottom-1 left-2.5 border-l border-strong group-last/ms:hidden" />
      <span
        aria-hidden="true"
        className={cn(
          "relative flex size-5 shrink-0 items-center justify-center rounded-full border",
          state === "done" ? "border-transparent bg-control text-muted" : state === "now" ? "border-accent" : "border-strong"
        )}
      >
        {state === "done" && <Check className="size-3" strokeWidth={2.5} />}
        {state === "now" && <span className="size-2 rounded-full bg-accent" />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-px">
        <span className={cn("min-w-0", state === "later" ? "text-muted" : state === "now" ? "text-fg" : "text-secondary")}>{title}</span>
        {hint && <span className="text-sm text-dim">{hint}</span>}
        {children && <div className="mt-2 flex min-w-0 flex-col gap-2">{children}</div>}
      </div>
    </li>
  )
}
