// Popover with interactive content (the model picker, the team list): React Aria traps focus inside,
// Esc and an outside click close it, and focus returns to the trigger. The body is a flex column that can shrink to
// the room left by the window (React Aria's max-height): scroll areas inside take `min-h-0` and keep the footer in view.
import { type ReactNode, useState } from "react"
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
  // Whether it is open, controlled or not, so the trigger can stay lit (the popup-open variant) while it is.
  const [own, setOwn] = useState(false)
  const open = state.isOpen ?? own
  const onOpenChange = (o: boolean) => {
    setOwn(o)
    state.onOpenChange?.(o)
  }
  return (
    <DialogTrigger {...state} onOpenChange={onOpenChange}>
      <span className="contents" {...(open && { "data-popup-open": "" })}>
        {trigger}
      </span>
      <PopoverPrimitive
        placement={placement}
        offset={6}
        className={cn(
          "z-50 flex flex-col overflow-hidden rounded-sheet border border-strong bg-float shadow-float backdrop-blur-xl backdrop-saturate-150 text-fg outline-none data-entering:animate-in data-entering:fade-in-0 data-entering:zoom-in-[0.98] data-exiting:animate-out data-exiting:fade-out-0 motion-reduce:animate-none",
          className
        )}
      >
        <Dialog aria-label={label} className="flex min-h-0 flex-1 flex-col outline-none">
          {({ close }) => (typeof children === "function" ? children(close) : children)}
        </Dialog>
      </PopoverPrimitive>
    </DialogTrigger>
  )
}
