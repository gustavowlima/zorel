// An agent's routines (phase 7), on its page: recurring or triggered work that runs as a message in the routine's
// own chat. Each row: name, when it runs next (or "on demand"), on/off, Run now, its chat, and its webhook URL
// when it has one. New ones from a short form with schedule presets (or a cron pattern); agents can also propose
// them from a chat (zero_routines), as approval cards.
import type { Agent, Routine } from "@zero/contracts"
import { formatAge, formatTime, t } from "@zero/i18n"
import { useState } from "react"
import { agentsAtom, mutations, routinesAtom, useInvalidate, useList, useMutation, useReading } from "../client.ts"
import { go } from "../state.ts"
import { AlarmClock, Button, Column, EmptyState, Screen, ConfirmDialog, Copy, Field, IconButton, Input, MessageCircle, Play, Plus, Rows, Section, Select, Switch, Textarea, Tooltip, Trash2 } from "@/ui"

const PRESETS = [
  { value: "0 * * * *", key: "hourly" },
  { value: "0 9 * * *", key: "daily" },
  { value: "0 9 * * 1-5", key: "weekdays" },
  { value: "0 9 * * 1", key: "weekly" },
  { value: "none", key: "onDemand" },
  { value: "custom", key: "custom" }
] as const

const when = (r: Routine) =>
  !r.enabled ? t("routines.off") : r.nextRunAt ? t("routines.next", { when: formatTime(r.nextRunAt) }) : t("routines.onDemand")

// Every agent's routines on one page, one section per agent (the agent's name opens its page).
export function RoutinesView() {
  const agents = useList(agentsAtom)
  const routines = useReading(routinesAtom).items
  const withRoutines = agents.filter((a) => routines.some((r) => r.agentId === a.id))
  return (
    <Screen title={t("routines.title")} subtitle={t("routines.pageHint")}>
      <Column>
        {withRoutines.length === 0 ? (
          <EmptyState icon={<AlarmClock />} title={t("routines.emptyTitle")} hint={t("routines.emptyHint")} action={<Button size="sm" variant="secondary" onPress={() => go({ view: "agents" })}>{t("nav.agents")}</Button>} />
        ) : (
          withRoutines.map((a) => <AgentRoutines key={a.id} agent={a} title={a.name} />)
        )}
      </Column>
    </Screen>
  )
}

export function AgentRoutines({ agent, title }: { agent: Agent; title?: string }) {
  const all = useReading(routinesAtom).items
  const mine = all.filter((r) => r.agentId === agent.id)
  const update = useMutation(mutations.updateRoutine)
  const runNow = useMutation(mutations.runRoutine)
  const remove = useMutation(mutations.removeRoutine)
  const invalidate = useInvalidate()
  const [adding, setAdding] = useState(false)
  const [confirm, setConfirm] = useState<Routine>()
  const [error, setError] = useState<string>()
  const keys = { reactivityKeys: ["routines"] as const }
  return (
    <Section
      title={title ? <Button variant="ghost" className="-ml-2 h-auto px-2 py-0.5 text-sm font-medium text-muted" onPress={() => go({ view: "agent", id: agent.id })}>{title}</Button> : t("routines.title")}
      description={title ? undefined : t("routines.hint")}
      action={
        !adding && (
          <Button size="sm" variant="ghost" onPress={() => setAdding(true)}>
            <Plus />
            {t("routines.new")}
          </Button>
        )
      }
    >
      {adding && <NewRoutine agent={agent} onDone={() => setAdding(false)} />}
      {mine.length > 0 && (
        <Rows>
          {mine.map((r) => (
            <div key={r.id} className="flex flex-col gap-1 py-2.5">
              <div className="flex items-center gap-2">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{r.name}</span>
                  <span className="truncate text-sm text-muted">
                    {[when(r), r.cron, r.lastRunAt && t(`routines.last.${r.lastStatus ?? "started"}`, { age: formatAge(r.lastRunAt) })].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <Tooltip content={t("routines.openChat")}>
                  <IconButton label={t("routines.openChat")} size="sm" onPress={() => go({ view: "chat", id: r.chatId })}>
                    <MessageCircle className="size-3.5" />
                  </IconButton>
                </Tooltip>
                <Tooltip content={t("routines.runNow")}>
                  <IconButton
                    label={t("routines.runNow")}
                    size="sm"
                    onPress={() => {
                      setError(undefined)
                      void runNow({ params: { id: r.id }, ...keys })
                        .then(() => invalidate(["chats"]))
                        .catch(() => setError(t("routines.runFailed")))
                    }}
                  >
                    <Play className="size-3.5" />
                  </IconButton>
                </Tooltip>
                <Tooltip content={t("common.delete")}>
                  <IconButton label={t("common.delete")} size="sm" onPress={() => setConfirm(r)}>
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </Tooltip>
                <Switch aria-label={t("routines.enabled", { name: r.name })} isSelected={r.enabled} onChange={(enabled) => void update({ params: { id: r.id }, payload: { enabled }, ...keys })} />
              </div>
              {r.token && <HookUrl token={r.token} />}
            </div>
          ))}
        </Rows>
      )}
      {!adding && mine.length === 0 && <p className="text-sm text-muted">{t("routines.none")}</p>}
      {error && <p className="text-sm text-danger">{error}</p>}
      <ConfirmDialog
        isOpen={!!confirm}
        onOpenChange={(o) => !o && setConfirm(undefined)}
        title={t("routines.deleteTitle", { name: confirm?.name ?? "" })}
        description={t("routines.deleteBody")}
        onConfirm={() => confirm && void remove({ params: { id: confirm.id }, ...keys })}
      />
    </Section>
  )
}

// The routine's local webhook: POST JSON to it from a script or service on this computer to run it.
function HookUrl({ token }: { token: string }) {
  const url = `${location.origin}/api/hooks/${token}`
  const [copied, setCopied] = useState(false)
  return (
    <span className="flex items-center gap-2 pl-0.5">
      <code className="min-w-0 flex-1 truncate font-mono text-sm text-muted">{`POST ${url}`}</code>
      <IconButton
        label={copied ? t("common.copied") : t("routines.copyHook")}
        size="sm"
        onPress={() => {
          void navigator.clipboard.writeText(url)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
      >
        <Copy className="size-3.5" />
      </IconButton>
    </span>
  )
}

function NewRoutine({ agent, onDone }: { agent: Agent; onDone: () => void }) {
  const create = useMutation(mutations.createRoutine)
  const invalidate = useInvalidate()
  const [name, setName] = useState("")
  const [prompt, setPrompt] = useState("")
  const [preset, setPreset] = useState<string>("0 9 * * 1-5")
  const [custom, setCustom] = useState("")
  const [webhook, setWebhook] = useState(false)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const cron = preset === "none" ? null : preset === "custom" ? custom.trim() : preset
  return (
    <form
      className="flex flex-col gap-3 rounded-card border border-subtle p-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim() || !prompt.trim() || cron === "") return
        setBusy(true)
        setError(undefined)
        create({ payload: { agentId: agent.id, name: name.trim(), prompt: prompt.trim(), cron, webhook }, reactivityKeys: ["routines"] })
          .then(() => {
            invalidate(["chats"])
            onDone()
          })
          .catch((err: unknown) => setError((err as { message?: string })?.message || t("routines.createFailed")))
          .finally(() => setBusy(false))
      }}
    >
      <Field label={t("routines.name")}>
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={t("routines.namePlaceholder")} />
      </Field>
      <Field label={t("routines.prompt")} hint={t("routines.promptHint")}>
        <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} maxLength={8000} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("routines.when")}>
          <Select aria-label={t("routines.when")} value={preset} onChange={setPreset} options={PRESETS.map((p) => ({ value: p.value, label: t(`routines.presets.${p.key}`) }))} />
        </Field>
        {preset === "custom" && (
          <Field label={t("routines.cron")} hint={t("routines.cronHint")}>
            <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="*/30 9-18 * * 1-5" className="font-mono" />
          </Field>
        )}
      </div>
      <Switch isSelected={webhook} onChange={setWebhook}>
        {t("routines.webhook")}
      </Switch>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onPress={onDone}>
          {t("common.cancel")}
        </Button>
        <Button size="sm" type="submit" isPending={busy} isDisabled={!name.trim() || !prompt.trim() || cron === "" || busy}>
          {t("routines.create")}
        </Button>
      </div>
    </form>
  )
}
