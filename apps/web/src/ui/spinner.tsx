// Activity indicators (spec 018). Loading and working share one shape: a flat full ring in the current colour with a
// dot travelling round it (never a one-sided arc, no glow). With "reduce motion" the dot stops and the ring stays, so
// the state still reads.
import { t } from "@zorel/i18n"
import type { CSSProperties } from "react"
import { CircleAlert } from "lucide-react"
import { cn } from "@/lib/utils"

export function Spinner({ size = 14, className, label }: { size?: number; className?: string; label?: string }) {
  return (
    <span
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      className={cn("z-orb", className)}
      style={{ width: size, height: size } as CSSProperties}
    >
      <span className="z-ring" style={{ inset: 0 } as CSSProperties}>
        <i />
      </span>
    </span>
  )
}

// A chat's state in the sidebar and headers: working (the ring), waiting for you (a breathing amber dot), failed;
// idle shows nothing.
export function ChatStatusIcon({ state, size = 12 }: { state: "idle" | "running" | "waiting" | "failed"; size?: number }) {
  if (state === "running") return <Spinner size={size} label={t("activity.working")} className="text-secondary" />
  if (state === "waiting")
    return (
      <span role="img" aria-label={t("approval.waiting")} className="inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size } as CSSProperties}>
        <span className="z-mark z-mark-wait" style={{ position: "static", width: Math.max(6, size * 0.6), height: Math.max(6, size * 0.6), boxShadow: "none" } as CSSProperties} />
      </span>
    )
  if (state === "failed") return <CircleAlert size={size} strokeWidth={2.5} className="shrink-0 text-danger" aria-label={t("chat.failed")} role="img" />
  return null
}
