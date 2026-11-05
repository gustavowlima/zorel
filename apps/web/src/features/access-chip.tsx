// The chat's access level, beside the model in the message box: what every agent in this chat may do without asking.
// Unset, each agent works at its own level (its page › Tools and access); set, the chat's level is everyone's here,
// wider or narrower. Full access never asks, so choosing it the first time shows what that means and waits for an OK.
import type { Access, Chat } from "@zorel/contracts"
import { t } from "@zorel/i18n"
import { useState } from "react"
import { mutations, useMutation } from "../client.ts"
import { readSet, writeSet } from "../state.ts"
import { Button, ChoiceCards, ConfirmDialog, cx, Popover, Shield, ShieldAlert } from "@/ui"

const LEVELS = ["own", "ask", "workspace", "full"] as const
const CONFIRMED = "zorel.fullAccessConfirmed" // per browser; blocked storage: it asks again next time
const confirmed = () => readSet(CONFIRMED).has("full")
const remember = () => writeSet(CONFIRMED, new Set(["full"]))

type Level = (typeof LEVELS)[number]
const labelOf = (v: Level) => (v === "own" ? t("chatAccess.own") : t(`access.${v}`))
const hintOf = (v: Level) => (v === "own" ? t("chatAccess.ownHint") : t(`access.${v}Hint`))

export function AccessChip({ chat }: { chat: Chat }) {
  const update = useMutation(mutations.updateChat)
  const [asking, setAsking] = useState(false)
  const set = (access: Access | null) => void update({ params: { id: chat.id }, payload: { access }, reactivityKeys: ["chats"] })
  const full = chat.access === "full"
  return (
    <>
      <Popover
        label={t("chatAccess.title")}
        placement="top start"
        trigger={
          <Button size="sm" variant="ghost" aria-label={t("chatAccess.title")} className={cx("font-normal", full ? "text-warning" : "text-muted")}>
            {full ? <ShieldAlert /> : <Shield />}
            <span className="truncate">{labelOf(chat.access ?? "own")}</span>
          </Button>
        }
      >
        {(close) => (
          <div className="flex w-96 flex-col gap-2 p-3">
            <p className="text-sm font-medium">{t("chatAccess.title")}</p>
            <p className="text-sm text-muted">{t("chatAccess.hint")}</p>
            <ChoiceCards<Level>
              label={t("chatAccess.title")}
              value={chat.access ?? "own"}
              onChange={(v) => {
                close()
                if (v === "full" && !confirmed()) return setAsking(true)
                set(v === "own" ? null : v)
              }}
              options={LEVELS.map((v) => ({ value: v, title: labelOf(v), description: hintOf(v) }))}
            />
          </div>
        )}
      </Popover>
      <ConfirmDialog
        isOpen={asking}
        onOpenChange={setAsking}
        title={t("chatAccess.fullTitle")}
        description={t("chatAccess.fullBody")}
        confirmLabel={t("chatAccess.fullConfirm")}
        onConfirm={() => {
          remember()
          set("full")
        }}
      />
    </>
  )
}
