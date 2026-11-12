// Agent avatar: the agent's face (ui/face.tsx, spec 018) — a circle in its identity colour with two white pill eyes,
// its state on it. The colour comes from `tone` = the agent's position in its project, so teammates never share one
// (up to six); without `tone`, a hash of the id keeps it stable. `live` (or a working/waiting state) makes the eyes
// glance and blink; reduced motion stills them.
import { cn } from "@/lib/utils"
import { AgentFace, type FaceState } from "./face"
import { ProviderIcon } from "./provider-icon"

const TONE_COUNT = 6 // --z-agent-1..6 in styles.css
const SIZES = { 16: "size-4 rounded-full", 20: "size-5 rounded-full", 28: "size-7 rounded-full", 32: "size-8 rounded-full", 40: "size-10 rounded-full", 64: "size-16 rounded-full" } as const

const hash = (id: string) => {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h
}
export const toneOf = (id: string) => hash(id) % TONE_COUNT

export function AgentAvatar({
  id,
  tone,
  size = 20,
  live = false,
  state,
  className
}: {
  id: string
  name: string
  tone?: number
  size?: keyof typeof SIZES
  live?: boolean
  state?: FaceState | undefined
  className?: string | undefined
}) {
  const t = tone === undefined ? toneOf(id) : tone
  return <AgentFace tone={t} size={size} state={state} {...(live && { alive: true })} className={className} />
}

// No agent: the reply comes from the plain assistant, shown by the logo of the provider that answered.
const LOGO = { 16: 10, 20: 12, 28: 16, 32: 18, 40: 22, 64: 34 } as const
export function ModelAvatar({ provider, size = 20, className }: { provider: string; size?: keyof typeof SIZES; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("inline-flex shrink-0 items-center justify-center border border-subtle bg-surface text-secondary", SIZES[size], className)}>
      <ProviderIcon provider={provider} size={LOGO[size]} />
    </span>
  )
}
