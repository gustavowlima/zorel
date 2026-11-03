// Tooltip: React Aria. The trigger is a React Aria Button (Button, IconButton), so the text also shows on keyboard focus.
import type { ReactNode } from "react"
import { Tooltip as TooltipPrimitive, TooltipTrigger } from "react-aria-components"

export function Tooltip({ content, children, disabled }: { content: ReactNode; children: ReactNode; disabled?: boolean }) {
  return (
    <TooltipTrigger delay={500} isDisabled={disabled ?? false}>
      {children}
      <TooltipPrimitive
        offset={6}
        className="z-50 max-w-xs rounded-control border border-strong bg-raised px-2.5 py-1.5 text-sm text-secondary data-entering:animate-in data-entering:fade-in-0 data-exiting:animate-out data-exiting:fade-out-0 motion-reduce:animate-none"
      >
        {content}
      </TooltipPrimitive>
    </TooltipTrigger>
  )
}
