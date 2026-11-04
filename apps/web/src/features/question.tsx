// A question an agent asked (zorel_ask_user): the options it suggested, one press each, or your own words; Skip lets
// it go on without an answer. The same card in the chat and in Needs you; the first answer wins.
import type { Approval } from "@zorel/contracts/events"
import { t } from "@zorel/i18n"
import { type FormEvent, useState } from "react"
import { mutations, useMutation } from "../client.ts"
import { Button, Input } from "@/ui"

const optionsOf = (a: Approval): string[] => {
  try {
    const v = (JSON.parse(a.args) as { options?: unknown }).options
    return Array.isArray(v) ? v.filter((o): o is string => typeof o === "string") : []
  } catch {
    return []
  }
}

export function QuestionAnswer({ approval: a, onError }: { approval: Approval; onError?: (message: string) => void }) {
  const decide = useMutation(mutations.decide)
  const [text, setText] = useState("")
  const [pending, setPending] = useState<string>()
  const send = (answer: string | null) => {
    setPending(answer ?? "")
    const payload = answer ? { approvalId: a.id, outcome: "approved" as const, reason: answer } : { approvalId: a.id, outcome: "denied" as const }
    decide({ payload, reactivityKeys: ["approvals"] }).catch(() => {
      setPending(undefined)
      onError?.(t("chat.approvalGone"))
    })
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (text.trim()) send(text.trim())
  }
  const options = optionsOf(a)
  return (
    <div className="flex w-full flex-col gap-2.5">
      {options.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {options.map((o) => (
            <Button key={o} size="sm" variant="secondary" shape="pill" isPending={pending === o} isDisabled={pending !== undefined} onPress={() => send(o)}>
              {o}
            </Button>
          ))}
        </div>
      )}
      <form onSubmit={submit} className="flex items-center gap-2">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={options.length ? t("question.other") : t("question.placeholder")} aria-label={t("question.answer")} maxLength={2000} disabled={pending !== undefined} className="flex-1" />
        <Button type="submit" size="sm" variant="secondary" isPending={pending === text.trim() && !!text.trim()} isDisabled={!text.trim() || pending !== undefined}>
          {t("question.send")}
        </Button>
        <Button size="sm" variant="ghost" isDisabled={pending !== undefined} onPress={() => send(null)}>
          {t("question.skip")}
        </Button>
      </form>
    </div>
  )
}
