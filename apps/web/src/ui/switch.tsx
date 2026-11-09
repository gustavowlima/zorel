// Switch: for changes that apply immediately (DESIGN.md). React Aria handles keyboard and labels.
import type { ReactNode } from "react"
import { Switch as SwitchPrimitive, type SwitchProps } from "react-aria-components"
import { cn } from "@/lib/utils"

export function Switch({ children, className, ...p }: Omit<SwitchProps, "children" | "className"> & { children?: ReactNode; className?: string }) {
  // `relative` anchors React Aria's hidden input (position: absolute) to the switch; without it the input lands on
  // the nearest scroll container and a long list of switches stretches it (the page scrolled as a whole).
  return (
    <SwitchPrimitive {...p} className={cn("group relative inline-flex items-center gap-2.5 text-base text-fg outline-none data-disabled:opacity-50", className)}>
      <span className="relative h-[22px] w-9 shrink-0 rounded-full border border-strong bg-control transition-colors duration-150 ease-out group-data-selected:border-transparent group-data-selected:bg-accent group-data-focus-visible:ring-2 group-data-focus-visible:ring-accent motion-reduce:transition-none">
        <span className="absolute top-[2px] left-[2px] size-4 rounded-full bg-muted transition-transform duration-150 ease-out group-data-selected:translate-x-[14px] group-data-selected:bg-on-accent motion-reduce:transition-none" />
      </span>
      {children}
    </SwitchPrimitive>
  )
}
