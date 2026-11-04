// Tabs as pills (the prototype's segmented look): the selected one sits on a surface; keyboard arrows move.
import type { ReactNode } from "react"
import { Button, Tab as TabPrimitive, TabList as TabListPrimitive, TabPanel as TabPanelPrimitive, Tabs as TabsPrimitive, type TabsProps } from "react-aria-components"
import { cn } from "@/lib/utils"
import { X } from "./icons"

export const Tabs = ({ className, ...p }: Omit<TabsProps, "className"> & { className?: string }) => <TabsPrimitive {...p} className={cn("flex flex-col gap-3", className)} />

export const TabList = ({ children, label, className }: { children: ReactNode; label: string; className?: string }) => (
  <TabListPrimitive aria-label={label} className={cn("scroll-quiet flex items-center gap-1 overflow-x-auto", className)}>
    {children}
  </TabListPrimitive>
)

// onClose: a small × inside the tab closes it (out of the Tab order: the tab list keeps one stop; Delete or
// Backspace on the focused tab closes it too, see onKeyDown on the TabList's owner).
export function Tab({ id, children, count, onClose, closeLabel }: { id: string; children: ReactNode; count?: ReactNode; onClose?: () => void; closeLabel?: string }) {
  return (
    <TabPrimitive
      id={id}
      className="group/tab inline-flex h-control-sm shrink-0 cursor-default items-center gap-1.5 whitespace-nowrap rounded-full border border-transparent px-3 text-sm text-muted outline-none transition-colors duration-150 ease-out data-hovered:text-fg data-selected:border-subtle data-selected:bg-surface data-selected:text-fg data-focus-visible:ring-2 data-focus-visible:ring-accent motion-reduce:transition-none"
    >
      {children}
      {count !== undefined && <span className="text-xs tabular-nums text-dim">{count}</span>}
      {onClose && (
        <Button
          aria-label={closeLabel ?? ""}
          excludeFromTabOrder
          onPress={onClose}
          className="-mr-1.5 flex size-4 items-center justify-center rounded-full text-muted outline-none data-hovered:bg-hover data-hovered:text-fg"
        >
          <X className="size-3" />
        </Button>
      )}
    </TabPrimitive>
  )
}

// keepMounted: the panel stays in the page while another tab is shown (a live terminal), just hidden.
export const TabPanel = ({ id, children, className, keepMounted = false }: { id: string; children: ReactNode; className?: string; keepMounted?: boolean }) => (
  <TabPanelPrimitive id={id} shouldForceMount={keepMounted} className={cn("outline-none [&[inert]]:hidden", className)}>
    {children}
  </TabPanelPrimitive>
)
