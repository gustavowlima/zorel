// Input and Textarea: React Aria (same API as the native element) with Zorel's tokens.
import type { ComponentProps } from "react"
import { Input as InputPrimitive, TextArea as TextAreaPrimitive } from "react-aria-components"
import { cn } from "@/lib/utils"
import { Search } from "./icons"

// Also used by the Select trigger, so fields and selects share the same body.
export const field =
  "w-full rounded-control border border-subtle bg-control px-3 text-base text-fg outline-none placeholder:text-dim transition-colors data-hovered:border-strong data-focused:border-strong data-focus-visible:ring-2 data-focus-visible:ring-accent-soft data-disabled:opacity-50"

type Props<T> = Omit<T, "className"> & { className?: string }

// Two heights from the control scale: md (32px, forms) and sm (28px, toolbars, filters, panels).
const HEIGHT = { md: "h-control", sm: "h-control-sm text-sm" } as const
type InputProps = Props<Omit<ComponentProps<typeof InputPrimitive>, "size">> & { size?: keyof typeof HEIGHT }

export const Input = ({ className, size = "md", ...p }: InputProps) => <InputPrimitive data-slot="input" {...p} className={cn(field, HEIGHT[size], className)} />

// A search field: the magnifier inside, in the same place and size everywhere. className sizes the field in its
// row (w-56, flex-1); everything else goes to the input.
export function SearchInput({ className, size = "md", ...p }: InputProps) {
  return (
    <span className={cn("relative block min-w-0", className)}>
      <Search aria-hidden="true" className={cn("pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted", size === "sm" ? "size-3.5" : "size-4")} />
      <Input size={size} {...p} className="pl-8" />
    </span>
  )
}

export const Textarea = ({ className, ...p }: Props<ComponentProps<typeof TextAreaPrimitive>>) => <TextAreaPrimitive data-slot="textarea" {...p} className={cn(field, "resize-none py-2", className)} />

// Textarea without a frame, for surfaces that draw their own (the message box).
export const BareTextarea = ({ className, ...p }: Props<ComponentProps<typeof TextAreaPrimitive>>) => (
  <TextAreaPrimitive data-slot="textarea" {...p} className={cn("w-full resize-none border-0 bg-transparent px-2 py-0 text-base leading-relaxed text-fg outline-none placeholder:text-dim", className)} />
)
