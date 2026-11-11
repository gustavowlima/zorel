// Tabs as pills (the prototype's segmented look): the selected one sits on a surface that slides from the tab it
// left (the rail's Marker, one group per tab list; still under reduced motion); keyboard arrows move.
import { createContext, type ReactNode, useContext, useId } from "react"
import { Button, Tab as TabPrimitive, TabList as TabListPrimitive, TabPanel as TabPanelPrimitive, Tabs as TabsPrimitive, type TabsProps } from "react-aria-components"
import { cn } from "@/lib/utils"
import { X } from "./icons"
import { Marker, SETTLE } from "./motion"

const Group = createContext<{ id: string; tint?: string | undefined }>({ id: "tabs" })

export const Tabs = ({ className, ...p }: Omit<TabsProps, "className"> & { className?: string }) => <TabsPrimitive {...p} className={cn("flex flex-col gap-3", className)} />

// tint: the tabs of one agent's page wear its color (identity tint) instead of the neutral surface.
export const TabList = ({ children, label, className, tint }: { children: ReactNode; label: string; className?: string; tint?: string | undefined }) => (
  <TabListPrimitive aria-label={label} className={cn("scroll-quiet flex items-center gap-1 overflow-x-auto", tint, className)}>
    <Group.Provider value={{ id: useId(), tint }}>{children}</Group.Provider>
  </TabListPrimitive>
)

// onClose: a small × inside the tab closes it (out of the Tab order: the tab list keeps one stop; Delete or
// Backspace on the focused tab closes it too, see onKeyDown on the TabList's owner).
// tint: a tab about one agent (its notes) wears that agent's color when chosen; the list's own tint otherwise.
export function Tab({ id, children, count, onClose, closeLabel, tint }: { id: string; children: ReactNode; count?: ReactNode; onClose?: () => void; closeLabel?: string; tint?: string | undefined }) {
  const group = useContext(Group)
  const tinted = !!(tint ?? group.tint)
  return (
    <TabPrimitive
      id={id}
      className={cn("group/tab relative isolate inline-flex h-control-sm shrink-0 cursor-default items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-sm text-muted outline-none transition-colors duration-150 ease-out data-hovered:text-fg data-focus-visible:ring-2 data-focus-visible:ring-accent motion-reduce:transition-none", tint, tinted ? "data-selected:text-[color-mix(in_oklab,var(--tint)_45%,var(--z-text))]" : "data-selected:text-fg")}
    >
      {({ isSelected }) => (
        <>
      {isSelected && <Marker id={group.id} className={cn("absolute inset-0 -z-10 rounded-full border", tinted ? "tinted" : "border-subtle bg-surface")} />}
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
        </>
      )}
    </TabPrimitive>
  )
}

// keepMounted: the panel stays in the page while another tab is shown (a live terminal), just hidden.
// A panel that opens settles in (a short fade and a 4px rise) instead of swapping in at once.
export const TabPanel = ({ id, children, className, keepMounted = false }: { id: string; children: ReactNode; className?: string; keepMounted?: boolean }) => (
  <TabPanelPrimitive id={id} shouldForceMount={keepMounted} className={cn("outline-none [&[inert]]:hidden", !keepMounted && SETTLE, className)}>
    {children}
  </TabPanelPrimitive>
)
