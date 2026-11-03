// Activity indicators. The spinner takes the text color (so it fits a filled button) and rotates only
// while motion is allowed; with "reduce motion" it is a still arc, so the state still reads.
import { CircleAlert, Clock } from "lucide-react"
import { cn } from "@/lib/utils"

export function Spinner({ size = 14, className, label }: { size?: number; className?: string; label?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={3}
      className={cn("shrink-0 animate-spin [animation-duration:900ms] motion-reduce:animate-none", className)}
      role="img"
      aria-hidden={label ? undefined : true}
    >
      <title>{label ?? ""}</title>
      <circle cx="12" cy="12" r="9" stroke="currentColor" opacity={0.25} />
      <path d="M21 12a9 9 0 0 0-9-9" strokeLinecap="round" stroke="currentColor" />
    </svg>
  )
}

// A chat's state in the sidebar and headers: working, waiting for you, failed; idle shows nothing.
export function ChatStatusIcon({ state, size = 12 }: { state: "idle" | "running" | "waiting" | "failed"; size?: number }) {
  if (state === "running") return <Spinner size={size} label="working" className="text-success" />
  if (state === "waiting") return <Clock size={size} strokeWidth={2.5} className="shrink-0 text-accent-text" aria-label="waiting for you" role="img" />
  if (state === "failed") return <CircleAlert size={size} strokeWidth={2.5} className="shrink-0 text-danger" aria-label="failed" role="img" />
  return null
}
