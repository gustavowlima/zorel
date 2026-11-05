// Popover with interactive content (the model picker, the team list): React Aria traps focus inside,
// Esc and an outside click close it, and focus returns to the trigger.
import type { ReactNode } from "react"
import { Dialog, DialogTrigger, type DialogTriggerProps, Popover as PopoverPrimitive, type PopoverProps } from "react-aria-components"
import { cn } from "@/lib/utils"

export function Popover({
  trigger,
  label,
  children,
  placement = "top start",
  className,
  ...state
}: Pick<DialogTriggerProps, "isOpen" | "onOpenChange"> & {
  trigger: ReactNode
  label: string
  children: ReactNode | ((close: () => void) => ReactNode)
  placement?: PopoverProps["placement"]
  className?: string
}) {
  return (
    <DialogTrigger {...state}>
      {trigger}
      <PopoverPrimitive
        placement={placement}
        offset={6}
        className={cn(
          "z-50 overflow-hidden rounded-sheet border border-strong bg-float shadow-float backdrop-blur-xl backdrop-saturate-150 text-fg outline-none data-entering:animate-in data-entering:fade-in-0 data-entering:zoom-in-[0.98] data-exiting:animate-out data-exiting:fade-out-0 motion-reduce:animate-none",
          className
        )}
      >
        <Dialog aria-label={label} className="outline-none">
          {({ close }) => (typeof children === "function" ? children(close) : children)}
        </Dialog>
      </PopoverPrimitive>
    </DialogTrigger>
  )
}
