// Primitivas do design system. Features importam daqui (@/ui); não estilizam controles na mão.
import { cn as cx } from "@/lib/utils"
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react"

export { cn as cx } from "@/lib/utils"
export { Button, type ButtonProps } from "./button"

const focus = "outline-none focus-visible:ring-2 focus-visible:ring-accent"

const field = "w-full rounded-control border border-subtle bg-control px-3 text-base text-fg placeholder:text-dim outline-none focus:border-strong focus-visible:ring-2 focus-visible:ring-accent-soft disabled:opacity-50"

export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(field, "h-control", className)} />
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cx(field, "resize-none py-2", className)} />
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(field, "h-control pr-8", className)} />

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: `children` é sempre um controle (Input, Select, Textarea, ModelPicker)
    <label className="flex flex-col gap-1 text-sm text-muted">
      {label}
      {children}
      {hint && <span className="text-xs text-dim">{hint}</span>}
    </label>
  )
}

export function SidebarItem({ active, className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      {...p}
      className={cx("pressable flex h-control-sm w-full items-center gap-2 rounded-control px-2 text-left text-base", focus, active ? "bg-control-active text-fg" : "text-muted hover:bg-control-hover hover:text-fg", className)}
    />
  )
}

export const SectionLabel = ({ children }: { children: ReactNode }) => <div className="px-2 pt-4 pb-1 text-xs font-medium uppercase tracking-wide text-dim">{children}</div>

export const Badge = ({ tone = "neutral", children }: { tone?: "neutral" | "accent" | "warning" | "danger"; children: ReactNode }) => (
  <span
    className={cx(
      "inline-flex h-5 items-center rounded-full px-2 text-xs font-medium",
      tone === "neutral" && "bg-control text-muted",
      tone === "accent" && "bg-accent-soft text-accent-text",
      tone === "warning" && "bg-control text-warning",
      tone === "danger" && "bg-danger-soft text-danger"
    )}
  >
    {children}
  </span>
)

export const Card = ({ className, children }: { className?: string; children: ReactNode }) => (
  <div className={cx("rounded-card border border-subtle bg-surface p-4", className)}>{children}</div>
)

export const Page = ({ title, actions, children }: { title: ReactNode; actions?: ReactNode; children: ReactNode }) => (
  <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-8">
    <header className="flex items-center justify-between gap-3">
      <h1 className="truncate text-lg font-semibold">{title}</h1>
      <div className="flex gap-2">{actions}</div>
    </header>
    {children}
  </div>
)
