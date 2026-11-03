// Tabs as pills (the prototype's segmented look): the selected one sits on a surface; keyboard arrows move.
import type { ReactNode } from "react"
import { Tab as TabPrimitive, TabList as TabListPrimitive, TabPanel as TabPanelPrimitive, Tabs as TabsPrimitive, type TabsProps } from "react-aria-components"
import { cn } from "@/lib/utils"

export const Tabs = ({ className, ...p }: Omit<TabsProps, "className"> & { className?: string }) => <TabsPrimitive {...p} className={cn("flex flex-col gap-3", className)} />

export const TabList = ({ children, label, className }: { children: ReactNode; label: string; className?: string }) => (
  <TabListPrimitive aria-label={label} className={cn("flex flex-wrap items-center gap-1", className)}>
    {children}
  </TabListPrimitive>
)

export function Tab({ id, children, count }: { id: string; children: ReactNode; count?: ReactNode }) {
  return (
    <TabPrimitive
      id={id}
      className="inline-flex h-control-sm cursor-default items-center gap-1.5 rounded-full border border-transparent px-3 text-sm text-muted outline-none transition-colors duration-150 ease-out data-hovered:text-fg data-selected:border-subtle data-selected:bg-surface data-selected:text-fg data-focus-visible:ring-2 data-focus-visible:ring-accent motion-reduce:transition-none"
    >
      {children}
      {count !== undefined && <span className="text-xs tabular-nums text-dim">{count}</span>}
    </TabPrimitive>
  )
}

export const TabPanel = ({ id, children, className }: { id: string; children: ReactNode; className?: string }) => (
  <TabPanelPrimitive id={id} className={cn("outline-none", className)}>
    {children}
  </TabPanelPrimitive>
)
