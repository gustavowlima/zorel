// The browser card in a reply: when an agent used its browser in a turn, the reply shows whose browser it was, its
// last action and the address it ended on, and, on each agent's latest such reply, a picture of that browser now
// (GET /api/browser/picture, refreshed while it shows). Take over, the full-screen button and the picture open that
// browser full screen, to drive it. The chat provides how to open it; elsewhere (a task's drawer) they don't show.
import type { Agent, Step } from "@zorel/contracts"
import { t } from "@zorel/i18n"
import { createContext, useContext, useEffect, useState } from "react"
import { agentName } from "../labels.ts"
import { Button, Globe, IconButton, Maximize2, MousePointerClick, Tooltip } from "@/ui"

const REFRESH_MS = 4000

// What the chat lets a card do: open the panel on a browser (owner), full screen or not; and which replies are each
// agent's latest with a browser card (only those show a live picture: older ones would show today's page, not theirs).
export const BrowserCards = createContext<{ open?: (owner: string, full: boolean) => void; live?: ReadonlySet<string> }>({})

// The server's name for an agent's browser profile (browser.ts profileOf).
export const ownerOf = (agentId: string | null) => (agentId ?? "assistant").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 64) || "assistant"

const DID = ["navigate", "read", "click", "type", "press", "hover", "select", "scroll", "wait", "tabs", "back", "upload", "dialog"] as const
const kindOf = (tool: string) => {
  const k = tool.replace(/^browser_/, "")
  return k === "snapshot" ? "read" : (DID as ReadonlyArray<string>).includes(k) ? (k as (typeof DID)[number]) : "steps"
}
const argsOf = (raw: string): Record<string, unknown> => {
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {}
  }
}
// What the step was about, when its arguments say it: the address opened, the text typed, the key pressed.
const targetOf = (s: Step) => {
  const a = argsOf(s.args)
  const v = a.url ?? a.text ?? a.key ?? a.value
  return typeof v === "string" ? v : ""
}
const hostOf = (url: string) => {
  try {
    return new URL(url).host.replace(/^www\./, "")
  } catch {
    return url
  }
}

export const isBrowserStep = (s: Pick<Step, "tool">) => s.tool.startsWith("browser_")

export function BrowserCard({ chatId, messageId, agentId, steps, agents }: { chatId: string; messageId: string; agentId: string | null; steps: ReadonlyArray<Step>; agents: ReadonlyArray<Agent> }) {
  const { open, live: liveCards } = useContext(BrowserCards)
  const owner = ownerOf(agentId)
  const live = !!liveCards?.has(messageId)
  const picture = usePicture(chatId, owner, live)
  const label = (s: Step) => t(`browser.card.did.${kindOf(s.tool)}` as "browser.card.did.navigate")
  const last = steps.at(-1)!
  const url = steps.map(targetOf).filter((v, i) => v && kindOf(steps[i]!.tool) === "navigate").at(-1)
  return (
    <section aria-label={t("browser.card.title", { name: agentName(agentId, agents) })} className="overflow-hidden rounded-card border border-subtle bg-surface">
      <header className="flex items-center gap-2 border-b border-subtle px-3 py-2">
        <Globe className="size-4 shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate text-sm">
          <span className="font-medium">{t("browser.card.title", { name: agentName(agentId, agents) })}</span>
          <span className="text-muted"> · {label(last).toLocaleLowerCase()}</span>
        </span>
        {open && (
          <>
            <Button size="sm" variant="ghost" onPress={() => open(owner, true)}>
              <MousePointerClick />
              {t("browser.card.takeOver")}
            </Button>
            <Tooltip content={t("browser.fullScreen")}>
              <IconButton label={t("browser.fullScreen")} size="xs" onPress={() => open(owner, true)}>
                <Maximize2 className="size-3.5" />
              </IconButton>
            </Tooltip>
          </>
        )}
      </header>
      {/* The address it ended on, and on the latest card the browser as it is now (pressing it opens the panel). */}
      <div className="flex flex-col gap-2 p-3">
        {url && (
          <span className="flex h-control-sm items-center gap-2 truncate rounded-full bg-control px-3 text-sm text-muted">
            <Globe className="size-3.5 shrink-0" />
            {hostOf(url)}
          </span>
        )}
        {live && picture && (
          <Button variant="ghost" className="block h-auto overflow-hidden rounded-control border border-subtle p-0" isDisabled={!open} onPress={() => open?.(owner, true)} aria-label={t("browser.fullScreen")}>
            <img src={picture} alt={t("browser.card.picture")} className="block w-full" />
          </Button>
        )}
      </div>
    </section>
  )
}

// The browser's picture now, while the card is the live one: fetched at once and every REFRESH_MS, kept as an
// object URL (the last one released). None when the browser has no tab or the card isn't live.
function usePicture(chatId: string, owner: string, live: boolean) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!live) return setUrl(undefined)
    let last: string | undefined
    let stop = false
    const load = () =>
      fetch(`/api/browser/picture?${new URLSearchParams({ chat: chatId, owner })}`, { credentials: "same-origin" })
        .then((r) => (r.status === 200 ? r.blob() : undefined))
        .then((blob) => {
          if (stop || !blob) return
          const next = URL.createObjectURL(blob)
          setUrl(next)
          if (last) URL.revokeObjectURL(last)
          last = next
        })
        .catch(() => undefined) // a missed picture: the next one comes in REFRESH_MS
    void load()
    const timer = setInterval(load, REFRESH_MS)
    return () => {
      stop = true
      clearInterval(timer)
      if (last) URL.revokeObjectURL(last)
    }
  }, [chatId, owner, live])
  return url
}
