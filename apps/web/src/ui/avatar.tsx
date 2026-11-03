// Agent avatar: a square with the initial in the agent's identity color (DESIGN.md, "A Regra do Avatar":
// identity colors live only here). Pass `tone` = the agent's position in its project, so teammates never
// share a color (up to six); without it, a hash of the id keeps the color stable.
import { cn } from "@/lib/utils"
import { ProviderIcon } from "./provider-icon"

const TONES = ["bg-agent-1", "bg-agent-2", "bg-agent-3", "bg-agent-4", "bg-agent-5", "bg-agent-6"] as const
const SIZES = { 16: "size-4 rounded-[5px] text-[9px]", 20: "size-5 rounded-[6px] text-[11px]", 28: "size-7 rounded-[9px] text-xs", 32: "size-8 rounded-[10px] text-base" } as const

export const toneOf = (id: string) => {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h % TONES.length
}

export function AgentAvatar({ id, name, tone, size = 20, className }: { id: string; name: string; tone?: number; size?: keyof typeof SIZES; className?: string }) {
  const t = tone === undefined ? toneOf(id) : ((tone % TONES.length) + TONES.length) % TONES.length
  return (
    <span aria-hidden="true" className={cn("inline-flex shrink-0 select-none items-center justify-center font-semibold text-on-accent", TONES[t], SIZES[size], className)}>
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  )
}

// No agent: the reply comes from the plain assistant, shown by the logo of the provider that answered.
const LOGO = { 16: 10, 20: 12, 28: 16, 32: 18 } as const
export function ModelAvatar({ provider, size = 20, className }: { provider: string; size?: keyof typeof SIZES; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("inline-flex shrink-0 items-center justify-center border border-subtle bg-surface text-secondary", SIZES[size], className)}>
      <ProviderIcon provider={provider} size={LOGO[size]} />
    </span>
  )
}
