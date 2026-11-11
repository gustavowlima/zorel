// Channels (spec 007): talk to Zorel from Telegram through your own bot. The token goes to the keychain (setKey);
// pairing is a one-time code you send to the bot as /pair CODE. Only paired accounts get through.
import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import { t } from "@zorel/i18n"
import { useState } from "react"
import { isTeammate } from "@zorel/contracts"
import { agentsAtom, mutations, telegramAtom, useList, useMutation } from "../client.ts"
import { agentTone } from "../labels.ts"
import { AgentAvatar, Button, ConfirmButton, Input, Rows, Section, Select, SettingRow } from "@/ui"

export function ChannelsSection() {
  const status = AsyncResult.getOrElse(useAtomValue(telegramAtom), () => undefined)
  const setKey = useMutation(mutations.setKey)
  const pair = useMutation(mutations.telegramPair)
  const unpair = useMutation(mutations.telegramUnpair)
  const pickAgent = useMutation(mutations.telegramAgent)
  // Who answers there: a global agent of the person's (spec 015); unset, the one used last.
  const agents = useList(agentsAtom)
  const global = agents.filter((a) => isTeammate(a) && a.projectId === null)
  const [draft, setDraft] = useState("")
  const [error, setError] = useState<string>()
  const saveToken = (value: string) => {
    setError(undefined)
    void setKey({ params: { name: "TELEGRAM_BOT_TOKEN" }, payload: { value }, reactivityKeys: ["telegram"] }).then(
      () => setDraft(""),
      () => setError(t("channels.saveFailed"))
    )
  }
  if (!status) return null
  return (
    <Section title={t("channels.telegram")} description={<span className="block max-w-prose">{t("channels.telegramIntro")}</span>}>
      <Rows>
        {status.fromEnv ? (
          <SettingRow title={t("channels.tokenFromEnv")} hint={<code className="font-mono text-sm">{"TELEGRAM_BOT_TOKEN"}</code>} />
        ) : status.tokenSet ? (
          <SettingRow title={t("channels.tokenSaved")} hint={t("channels.tokenSavedHint")}>
            <ConfirmButton size="sm" variant="ghost" title={t("channels.removeTitle")} description={t("channels.removeBody")} confirmLabel={t("channels.remove")} onConfirm={() => saveToken("")}>
              {t("channels.remove")}
            </ConfirmButton>
          </SettingRow>
        ) : (
          <form
            className="flex flex-wrap items-center gap-3 py-3.5"
            onSubmit={(e) => {
              e.preventDefault()
              if (draft.trim()) saveToken(draft.trim())
            }}
          >
            <span className="flex min-w-48 flex-1 flex-col gap-0.5">
              <span className="font-medium">{t("channels.token")}</span>
              <span className="text-sm text-muted">
                {t("channels.tokenHint")}{" "}
                <a className="text-accent-text underline" href="https://t.me/BotFather" target="_blank" rel="noreferrer">
                  {"@BotFather"}
                </a>
              </span>
            </span>
            <Input type="password" autoComplete="off" className="min-w-48 flex-1" placeholder={t("channels.paste")} aria-label={t("channels.token")} value={draft} onChange={(e) => setDraft(e.target.value)} />
            <Button type="submit" variant="default" isDisabled={!draft.trim()}>
              {t("common.save")}
            </Button>
          </form>
        )}
        {status.tokenSet && (
          <SettingRow
            title={t("channels.paired", { count: status.users })}
            hint={status.pairing ? t("channels.pairWith", { code: status.pairing.code }) : t("channels.pairHint")}
          >
            {status.pairing ? (
              <code className="rounded bg-control px-2 py-1 font-mono text-base">{`/pair ${status.pairing.code}`}</code>
            ) : (
              <Button size="sm" variant="secondary" onPress={() => void pair({ reactivityKeys: ["telegram"] })}>
                {t("channels.pair")}
              </Button>
            )}
            {status.users > 0 && (
              <ConfirmButton size="sm" variant="ghost" title={t("channels.unpairTitle")} description={t("channels.unpairBody")} confirmLabel={t("channels.unpair")} onConfirm={() => void unpair({ reactivityKeys: ["telegram"] })}>
                {t("channels.unpair")}
              </ConfirmButton>
            )}
          </SettingRow>
        )}
        {status.tokenSet && status.agentId && (
          <SettingRow title={t("channels.agent")} hint={status.chosen ? t("channels.agentHint") : t("channels.agentDefault")}>
            <Select
              size="sm"
              className="w-56"
              aria-label={t("channels.agent")}
              value={status.agentId}
              onChange={(agentId) => void pickAgent({ payload: { agentId }, reactivityKeys: ["telegram"] })}
              options={global.map((a) => ({ value: a.id, label: a.name, icon: <AgentAvatar id={a.id} name={a.name} tone={agentTone(a, agents)} size={16} /> }))}
            />
          </SettingRow>
        )}
      </Rows>
      {error && <p className="text-sm text-danger">{error}</p>}
    </Section>
  )
}
