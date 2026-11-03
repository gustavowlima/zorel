// Input and Textarea: React Aria (same API as the native element) with Zero's tokens.
import type { ComponentProps } from "react"
import { Input as InputPrimitive, TextArea as TextAreaPrimitive } from "react-aria-components"
import { cn } from "@/lib/utils"

// Also used by the Select trigger, so fields and selects share the same body.
export const field =
  "w-full rounded-control border border-subtle bg-control px-3 text-base text-fg outline-none placeholder:text-dim transition-colors data-hovered:border-strong data-focused:border-strong data-focus-visible:ring-2 data-focus-visible:ring-accent-soft data-disabled:opacity-50"

type Props<T> = Omit<T, "className"> & { className?: string }

export const Input = ({ className, ...p }: Props<ComponentProps<typeof InputPrimitive>>) => <InputPrimitive data-slot="input" {...p} className={cn(field, "h-control", className)} />

export const Textarea = ({ className, ...p }: Props<ComponentProps<typeof TextAreaPrimitive>>) => <TextAreaPrimitive data-slot="textarea" {...p} className={cn(field, "resize-none py-2", className)} />
