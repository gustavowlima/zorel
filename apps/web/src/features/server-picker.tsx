// Where this window is (spec 017): at the top of the sidebar, in the desktop app with at least one team server, the
// current place (this computer or a server) as a button; pressed, every place with whether it answers now (asked
// then, not on a timer: an open window knows through its own connection) and its shortcut (⌘1 this computer, ⌘2…).
// Choosing one shows it in this window's place. On a server, a thin line under it leads back to this computer.
import { formatTime, t } from "@zorel/i18n"
import { type ReactNode, useEffect, useState } from "react"
import { go } from "../state.ts"
import { LOCAL, serversBridge as bridge, type ServerState } from "./desktop-servers.tsx"
import { ArrowLeft, Button, Check, ChevronDown, cn, Dot, Plus, Popover, Server } from "@/ui"

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
type Place = { id: string; name: string; host: string }
type Listing = { places: ReadonlyArray<Place>; current: string }

function usePlaces(): Listing | undefined {
  const [listing, setListing] = useState<Listing>()
  useEffect(() => {
    void bridge?.list().then(({ servers, current }) =>
      setListing({ current, places: [{ id: LOCAL, name: t("servers.thisComputer"), host: t("servers.thisComputerHint") }, ...servers.map((s) => ({ id: s.origin, name: s.name, host: new URL(s.origin).host }))] })
    )
  }, [])
  return listing
}

// Off macOS the app has no menu bar to hold ⌘1…⌘9: Ctrl+1…9 switch from the page.
function useShortcuts(listing: Listing | undefined) {
  useEffect(() => {
    if (!bridge || MAC || !listing) return
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return
      const target = listing.places[Number(e.key) - 1]
      if (!target || target.id === listing.current) return
      e.preventDefault()
      void bridge?.open(target.id)
    }
    addEventListener("keydown", onKey)
    return () => removeEventListener("keydown", onKey)
  }, [listing])
}

// The brand's place in the sidebar head: the picker when there are servers to pick from, else `fallback` (the app's
// name, as before).
export function ServerPicker({ fallback }: { fallback: ReactNode }) {
  const listing = usePlaces()
  useShortcuts(listing)
  if (!bridge || !listing || listing.places.length < 2) return fallback
  const here = listing.places.find((p) => p.id === listing.current) ?? listing.places[0]!
  return (
    <Popover
      label={t("servers.pick")}
      placement="bottom start"
      className="w-76"
      trigger={
        <Button variant="ghost" size="sm" className="-ml-2 min-w-0 flex-1 justify-start gap-1.5 px-2 font-semibold">
          <span className="truncate">{here.name}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted" />
        </Button>
      }
    >
      {(close) => <Places listing={listing} close={close} />}
    </Popover>
  )
}

const STATE_TONE = { online: "success", offline: "danger" } as const
function Places({ listing, close }: { listing: Listing; close: () => void }) {
  const [states, setStates] = useState<Record<string, ServerState>>()
  // Asked when the list opens; this window's own place answers by being here.
  useEffect(() => {
    void bridge?.check?.().then(setStates, (e: unknown) => console.warn("[servers] check failed", e))
  }, [])
  const stateOf = (p: Place): ServerState | undefined => (p.id === LOCAL || p.id === listing.current ? { state: "online", seenAt: Date.now() } : states?.[p.id])
  return (
    <div className="flex flex-col p-1.5">
      {listing.places.map((p, i) => {
        const s = stateOf(p)
        const hint = s?.state === "offline" ? (s.seenAt ? t("servers.lastSeen", { time: formatTime(s.seenAt) }) : t("servers.offline")) : p.host
        return (
          <Button
            key={p.id}
            variant="ghost"
            className="h-auto justify-start gap-3 px-2.5 py-2 text-left font-normal"
            onPress={() => {
              close()
              if (p.id !== listing.current) void bridge?.open(p.id)
            }}
          >
            <span className="relative flex size-7 shrink-0 items-center justify-center rounded-control bg-control text-muted [&_svg]:size-4">
              <Server />
              {s && (
                <span className="absolute -right-0.5 -bottom-0.5 flex">
                  <Dot tone={STATE_TONE[s.state]} />
                </span>
              )}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-fg">{p.name}</span>
              <span className={cn("truncate text-xs", s?.state === "offline" ? "text-danger" : "text-muted")}>{hint}</span>
            </span>
            {p.id === listing.current ? <Check className="size-4 shrink-0 text-accent-text" /> : i < 9 && <span className="shrink-0 text-xs text-dim tabular-nums">{`${MAC ? "⌘" : "Ctrl "}${i + 1}`}</span>}
          </Button>
        )
      })}
      {/* Adding a server lives on this computer (a page another machine serves can't add servers to it). */}
      {listing.current === LOCAL && (
        <Button
          variant="ghost"
          className="mt-1 justify-start gap-3 border-subtle border-t px-2.5 py-2 font-normal text-muted"
          onPress={() => {
            close()
            go({ view: "settings", tab: "general" })
          }}
        >
          <Plus className="size-4" />
          {t("servers.add")}
        </Button>
      )}
    </div>
  )
}

// On a team server: a thin line under the head saying so, with the way back to this computer.
export function ServerLine() {
  const listing = usePlaces()
  if (!bridge || !listing || listing.current === LOCAL) return null
  const here = listing.places.find((p) => p.id === listing.current)
  return (
    <div className="flex shrink-0 items-center gap-2 px-4.5 pb-2 text-xs text-muted">
      <span className="min-w-0 flex-1 truncate">{t("servers.onServer", { name: here?.host ?? "" })}</span>
      <Button size="sm" variant="ghost" shape="pill" className="-mr-1.5 h-6 gap-1 px-2 text-xs font-normal" onPress={() => void bridge?.open(LOCAL)}>
        <ArrowLeft className="size-3" />
        {t("servers.back")}
      </Button>
    </div>
  )
}
