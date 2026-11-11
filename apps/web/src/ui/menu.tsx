// Action menu (⋯): a trigger button plus a popover list. React Aria handles focus, typeahead and Esc.
import type { ReactNode } from "react"
import { Menu as MenuPrimitive, MenuItem as MenuItemPrimitive, MenuTrigger, Popover, Separator } from "react-aria-components"
import { cn } from "@/lib/utils"

export function Menu({ trigger, children, label }: { trigger: ReactNode; children: ReactNode; label: string }) {
  return (
    <MenuTrigger>
      {trigger}
      <Popover
        placement="bottom end"
        offset={6}
        className="z-50 min-w-48 rounded-card border border-strong bg-float shadow-float backdrop-blur-xl backdrop-saturate-150 p-1 outline-none data-entering:animate-in data-entering:fade-in-0 data-entering:zoom-in-[0.98] data-exiting:animate-out data-exiting:fade-out-0 motion-reduce:animate-none"
      >
        <MenuPrimitive aria-label={label} className="outline-none">
          {children}
        </MenuPrimitive>
      </Popover>
    </MenuTrigger>
  )
}

export function MenuItem({ children, onAction, tone = "default", icon, isDisabled }: { children: ReactNode; onAction: () => void; tone?: "default" | "danger"; icon?: ReactNode; isDisabled?: boolean }) {
  return (
    <MenuItemPrimitive
      onAction={onAction}
      isDisabled={isDisabled ?? false}
      className={cn(
        "flex h-control-sm cursor-default items-center gap-2 rounded-md px-2 text-base outline-none data-disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        // Focus speaks the item's own voice: blue for an ordinary item, red for a destructive one (never blue on red).
        tone === "danger" ? "text-danger data-focused:bg-danger-soft" : "text-secondary data-focused:bg-accent-soft data-focused:text-fg data-focused:[&_svg]:text-accent-text"
      )}
    >
      {icon}
      {children}
    </MenuItemPrimitive>
  )
}

export const MenuSeparator = () => <Separator className="my-1 h-px bg-subtle" />
