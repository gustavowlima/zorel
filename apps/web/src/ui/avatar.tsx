// Agent avatar: a little object with eyes (Open Bot Avatar, MIT, see NOTICE) inside a soft tile of the agent's
// identity color (DESIGN.md, "The Avatar Rule": identity colors live only here). The shape comes from the agent's id
// and the color from `tone` = the agent's position in its project, so teammates never share a color (up to six) and
// are told apart by shape too; without `tone`, a hash of the id keeps the color stable. Small avatars (lists, chat)
// are still SVGs drawn once per shape, color and size; `live` ones (the Builder's review) breathe and blink, and stop
// with reduced motion.
import { examples, renderAvatarSvg } from "open-bot-avatar"
import { type MountedAvatar, mountAvatar } from "open-bot-avatar/dom"
import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import { ProviderIcon } from "./provider-icon"

const TONE_COUNT = 6 // --z-agent-1..6 in styles.css
const TILES = ["bg-agent-1/15", "bg-agent-2/15", "bg-agent-3/15", "bg-agent-4/15", "bg-agent-5/15", "bg-agent-6/15"] as const
const SIZES = { 16: "size-4 rounded-[5px] text-[9px]", 20: "size-5 rounded-[6px] text-[11px]", 28: "size-7 rounded-[9px] text-xs", 32: "size-8 rounded-[10px] text-base", 40: "size-10 rounded-[12px] text-lg" } as const
const FIGURE = 0.82 // the object's share of its tile

const hash = (id: string) => {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h
}
export const toneOf = (id: string) => hash(id) % TONE_COUNT

// The still renderer takes a hex color; the tones are tokens, read once from the theme (the same in both themes).
const toneColors: string[] = []
const colorOf = (tone: number) => (toneColors[tone] ??= getComputedStyle(document.documentElement).getPropertyValue(`--z-agent-${tone + 1}`).trim())

const drawn = new Map<string, string>()
function avatarSvg(shape: number, tone: number, size: number) {
  const key = `${shape}:${tone}:${size}`
  let svg = drawn.get(key)
  if (!svg) {
    // Decorative here (the name is always beside it): no title or role of its own.
    svg = renderAvatarSvg(examples[shape]!, { color: colorOf(tone), size, reducedMotion: true })
      .replace(/<title>[^<]*<\/title>/, "")
      .replace(/ role="img" aria-label="[^"]*"/, "")
    drawn.set(key, svg)
  }
  return svg
}

function LiveFigure({ shape, tone }: { shape: number; tone: number }) {
  const host = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const mounted: MountedAvatar = mountAvatar(host.current!, { definition: examples[shape]!, color: colorOf(tone), label: "", reducedMotion: "system" })
    return () => mounted.destroy()
  }, [shape, tone])
  return <span ref={host} className="block size-[82%]" />
}

export function AgentAvatar({ id, tone, size = 20, live = false, className }: { id: string; name: string; tone?: number; size?: keyof typeof SIZES; live?: boolean; className?: string }) {
  const t = tone === undefined ? toneOf(id) : ((tone % TONE_COUNT) + TONE_COUNT) % TONE_COUNT
  const shape = hash(id) % examples.length
  const tile = cn("inline-flex shrink-0 select-none items-center justify-center", TILES[t], SIZES[size], className)
  if (live)
    return (
      <span aria-hidden="true" className={tile}>
        <LiveFigure shape={shape} tone={t} />
      </span>
    )
  return (
    <span
      aria-hidden="true"
      className={cn(tile, "[&>svg]:size-[82%]")}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: an SVG drawn by open-bot-avatar from its own bundled shapes, never user input
      dangerouslySetInnerHTML={{ __html: avatarSvg(shape, t, Math.round(size * FIGURE)) }}
    />
  )
}

// No agent: the reply comes from the plain assistant, shown by the logo of the provider that answered.
const LOGO = { 16: 10, 20: 12, 28: 16, 32: 18, 40: 22 } as const
export function ModelAvatar({ provider, size = 20, className }: { provider: string; size?: keyof typeof SIZES; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("inline-flex shrink-0 items-center justify-center border border-subtle bg-surface text-secondary", SIZES[size], className)}>
      <ProviderIcon provider={provider} size={LOGO[size]} />
    </span>
  )
}
