// Desktop notifications (the browser's Notification API; the Electron shell shows them as native ones): when a
// chat starts waiting for you, fails, or finishes while you look elsewhere (another chat, or the window hidden).
// On by default once the person allowed them; the switch is in Settings › General. Clicking one opens the chat.
import type { ChatStatus } from "@zorel/contracts/events"
import { t } from "@zorel/i18n"
import { useEffect, useRef, useState } from "react"
import { agentsAtom, chatsAtom, useList, useStatuses } from "../client.ts"
import { chatTitle, noteworthy, statusLabel } from "../labels.ts"
import { go, type Route } from "../state.ts"
import { Switch } from "@/ui"

const KEY = "zorel.notify"
const supported = typeof Notification !== "undefined"
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
      if (!kind || looking || !enabled()) continue
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

// Settings › General: on/off (asking the system's permission the first time).
export function NotifySetting() {
  const [on, setOn] = useState(enabled)
  if (!supported) return null
  return (
    <div className="flex flex-wrap items-center gap-3 py-3.5">
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-medium">{t("notify.title")}</span>
        <span className="text-sm text-muted">{Notification.permission === "denied" ? t("notify.denied") : t("notify.hint")}</span>
      </span>
      <Switch
        aria-label={t("notify.title")}
        isSelected={on}
        isDisabled={Notification.permission === "denied"}
        onChange={(next) => {
          const save = (v: boolean) => {
            try {
              localStorage.setItem(KEY, v ? "1" : "0")
            } catch {}
            setOn(v && Notification.permission === "granted")
          }
          if (next && Notification.permission !== "granted") void Notification.requestPermission().then((p) => save(p === "granted"))
          else save(next)
        }}
      />
    </div>
  )
}
