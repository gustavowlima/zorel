// Desktop notifications (the browser's Notification API; the Electron shell shows them as native ones): when a
// chat starts waiting for you, fails, or finishes while you look elsewhere (another chat, or the window hidden).
// On by default once the person allowed them; the switch is in Settings › General. Clicking one opens the chat.
// A sound can play for the same moments, on its own switch (it works with the system's notifications off).
// Routine chats (spec 012) don't use those moments: a routine tells the person through its notices, only when its
// run found something or needs them.
import type { ChatStatus } from "@zorel/contracts/events"
import { t } from "@zorel/i18n"
import { useEffect, useRef, useState } from "react"
import { agentsAtom, chatsAtom, routinesAtom, useInvalidate, useList, useNotice, useReading, useStatuses } from "../client.ts"
import { chatTitle, noteworthy, statusLabel } from "../labels.ts"
import { go, type Route, store, stored } from "../state.ts"
import { Button, SettingRow, Switch } from "@/ui"

const KEY = "zorel.notify"
const SOUND_KEY = "zorel.sound"
const supported = typeof Notification !== "undefined"
const desktop = (window as { zorelDesktop?: { notificationSettings?: () => Promise<boolean> } }).zorelDesktop
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
const enabled = () => supported && Notification.permission === "granted" && stored(KEY) !== "0"

export function useNotifications(route: Route) {
  const statuses = useStatuses()
  const chats = useList(chatsAtom)
  const agents = useList(agentsAtom)
  const routines = useReading(routinesAtom).items
  const invalidate = useInvalidate()
  const notice = useNotice()
  const last = useRef<Record<string, ChatStatus["state"]>>({})
  const shown = useRef<string>(undefined)
  useEffect(() => {
    if (!notice || shown.current === notice.id) return
    shown.current = notice.id
    invalidate(["today", "routines"])
    const looking = !document.hidden && route.view === "chat" && route.id === notice.chatId
    if (looking) return
    if (soundOn()) chime()
    if (!enabled()) return
    const n = new Notification(notice.title, { body: notice.outcome === "needs" ? t("notify.routineNeeds", { text: notice.text }) : notice.text, tag: notice.id })
    n.onclick = () => {
      window.focus()
      go({ view: "chat", id: notice.chatId })
      n.close()
    }
  }, [notice, route, invalidate])
  useEffect(() => {
    const routineChats = new Set(routines.map((r) => r.chatId))
    for (const s of Object.values(statuses)) {
      const kind = noteworthy(last.current[s.chatId], s.state)
      last.current[s.chatId] = s.state
      if (routineChats.has(s.chatId)) {
        if (kind) invalidate(["today", "routines"]) // a run ended: the history and Today read it
        continue
      }
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
  }, [statuses, chats, agents, route, routines, invalidate])
}

// Settings › General: on/off (asking the system's permission the first time), a test, and in the desktop app the
// system's own switch for Zorel (macOS and Windows decide too, and the app can't read that).
export function NotifySetting() {
  const [on, setOn] = useState(enabled)
  if (!supported) return null
  return (
    <SettingRow title={t("notify.title")} hint={
        <>
          <span className="text-sm text-muted">{Notification.permission === "denied" ? t("notify.denied") : t("notify.hint")}</span>
          {on && desktop?.notificationSettings && <span className="text-sm text-dim">{t("notify.systemHint")}</span>}
        </>
      }>
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
            store(KEY, v ? "1" : "0")
            setOn(v && Notification.permission === "granted")
          }
          if (next && Notification.permission !== "granted") void Notification.requestPermission().then((p) => save(p === "granted"))
          else save(next)
        }}
      />
    </SettingRow>
  )
}

// Settings › General: a chime when a chat waits for you, fails or finishes while you're elsewhere.
export function SoundSetting() {
  const [on, setOn] = useState(soundOn)
  return (
    <SettingRow title={t("notify.sound")} hint={t("notify.soundHint")}>
      <Button size="sm" variant="ghost" onPress={chime}>
        {t("notify.listen")}
      </Button>
      <Switch
        aria-label={t("notify.sound")}
        isSelected={on}
        onChange={(v) => {
          store(SOUND_KEY, v ? "1" : "0")
          setOn(v)
          if (v) chime()
        }}
      />
    </SettingRow>
  )
}
