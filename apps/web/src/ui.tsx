// Primitivas do design system. Features importam daqui; não estilizam controles na mão.
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react"

export const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ")

const variants = {
  default: "bg-accent text-white hover:bg-accent-hover",
  secondary: "bg-control text-fg hover:bg-control-hover active:bg-control-active",
  ghost: "text-muted hover:bg-control-hover hover:text-fg",
  destructive: "bg-danger-soft text-danger hover:bg-danger hover:text-white"
}
const sizes = { sm: "h-control-sm px-2.5 text-sm", md: "h-control px-3 text-base", lg: "h-control-lg px-4 text-base" }
const focus = "outline-none focus-visible:ring-2 focus-visible:ring-accent"

export function Button({ variant = "secondary", size = "md", className, type = "button", ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants; size?: keyof typeof sizes }) {
  return (
    <button
      type={type}
      {...p}
      className={cx("pressable inline-flex shrink-0 items-center justify-center gap-1.5 rounded-control font-medium disabled:pointer-events-none disabled:opacity-50", focus, variants[variant], sizes[size], className)}
    />
  )
}

const field = "w-full rounded-control border border-subtle bg-control px-3 text-base text-fg placeholder:text-dim outline-none focus:border-strong focus-visible:ring-2 focus-visible:ring-accent-soft disabled:opacity-50"

export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(field, "h-control", className)} />
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cx(field, "resize-none py-2", className)} />
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(field, "h-control pr-8", className)} />

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
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
