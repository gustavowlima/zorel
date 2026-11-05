// Desktop notifications (the browser's Notification API; the Electron shell shows them as native ones): when a
// chat starts waiting for you, fails, or finishes while you look elsewhere (another chat, or the window hidden).
// On by default once the person allowed them; the switch is in Settings › General. Clicking one opens the chat.
// A sound can play for the same moments, on its own switch (it works with the system's notifications off).
import type { ChatStatus } from "@zorel/contracts/events"
import { t } from "@zorel/i18n"
import { useEffect, useRef, useState } from "react"
import { agentsAtom, chatsAtom, useList, useStatuses } from "../client.ts"
import { chatTitle, noteworthy, statusLabel } from "../labels.ts"
import { go, type Route } from "../state.ts"
import { Button, Switch } from "@/ui"

const KEY = "zorel.notify"
const SOUND_KEY = "zorel.sound"
const supported = typeof Notification !== "undefined"
const desktop = (window as { zorelDesktop?: { notificationSettings?: () => Promise<boolean> } }).zorelDesktop
const stored = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const store = (key: string, on: boolean) => {
  try {
    localStorage.setItem(key, on ? "1" : "0")
  } catch {}
}
const soundOn = () => stored(SOUND_KEY) === "1"

// A short two-note chime, made on the spot (no audio file to ship): a soft sine, rising a fifth.
const CHIME = [
  { hz: 660, at: 0 },
  { hz: 990, at: 0.12 }
] as const
const NOTE_S = 0.35
const VOLUME = 0.12
export function chime() {
  const ctx = new AudioContext()
  for (const n of CHIME) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = n.hz
    gain.gain.setValueAtTime(0, ctx.currentTime + n.at)
    gain.gain.linearRampToValueAtTime(VOLUME, ctx.currentTime + n.at + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + n.at + NOTE_S)
    osc.connect(gain).connect(ctx.destination)
    osc.start(ctx.currentTime + n.at)
    osc.stop(ctx.currentTime + n.at + NOTE_S)
  }
  setTimeout(() => void ctx.close(), (CHIME.at(-1)!.at + NOTE_S) * 1000 + 100)
}
const enabled = () => {
  try {
    return supported && Notification.permission === "granted" && localStorage.getItem(KEY) !== "0"
  } catch {
    return false
  }
}

export function useNotifications(route: Route) {
  const statuses = useStatuses()
  const chats = useList(chatsAtom)
  const agents = useList(agentsAtom)
  const last = useRef<Record<string, ChatStatus["state"]>>({})
  useEffect(() => {
    for (const s of Object.values(statuses)) {
      const kind = noteworthy(last.current[s.chatId], s.state)
      last.current[s.chatId] = s.state
      const looking = !document.hidden && route.view === "chat" && route.id === s.chatId
      if (!kind || looking) continue
      if (soundOn()) chime()
      if (!enabled()) continue
      const chat = chats.find((c) => c.id === s.chatId)
      const n = new Notification(chat ? chatTitle(chat) : t("app.name"), { body: kind === "done" ? t("notify.done") : statusLabel(s, agents), tag: s.chatId })
      n.onclick = () => {
        window.focus()
        go({ view: "chat", id: s.chatId })
        n.close()
      }
    }
  }, [statuses, chats, agents, route])
}

// Settings › General: on/off (asking the system's permission the first time), a test, and in the desktop app the
// system's own switch for Zorel (macOS and Windows decide too, and the app can't read that).
export function NotifySetting() {
  const [on, setOn] = useState(enabled)
  if (!supported) return null
  return (
    <div className="flex flex-wrap items-center gap-3 py-3.5">
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-medium">{t("notify.title")}</span>
        <span className="text-sm text-muted">{Notification.permission === "denied" ? t("notify.denied") : t("notify.hint")}</span>
        {on && desktop?.notificationSettings && <span className="text-sm text-dim">{t("notify.systemHint")}</span>}
      </span>
      {on && (
        <Button size="sm" variant="ghost" onPress={() => new Notification(t("app.name"), { body: t("notify.test") })}>
          {t("notify.sendTest")}
        </Button>
      )}
      {on && desktop?.notificationSettings && (
        <Button size="sm" variant="secondary" onPress={() => void desktop.notificationSettings?.()}>
          {t("notify.systemSettings")}
        </Button>
      )}
      <Switch
        aria-label={t("notify.title")}
        isSelected={on}
        isDisabled={Notification.permission === "denied"}
        onChange={(next) => {
          const save = (v: boolean) => {
            store(KEY, v)
            setOn(v && Notification.permission === "granted")
          }
          if (next && Notification.permission !== "granted") void Notification.requestPermission().then((p) => save(p === "granted"))
          else save(next)
        }}
      />
    </div>
  )
}

// Settings › General: a chime when a chat waits for you, fails or finishes while you're elsewhere.
export function SoundSetting() {
  const [on, setOn] = useState(soundOn)
  return (
    <div className="flex flex-wrap items-center gap-3 py-3.5">
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-medium">{t("notify.sound")}</span>
        <span className="text-sm text-muted">{t("notify.soundHint")}</span>
      </span>
      <Button size="sm" variant="ghost" onPress={chime}>
        {t("notify.listen")}
      </Button>
      <Switch
        aria-label={t("notify.sound")}
        isSelected={on}
        onChange={(v) => {
          store(SOUND_KEY, v)
          setOn(v)
          if (v) chime()
        }}
      />
    </div>
  )
}
