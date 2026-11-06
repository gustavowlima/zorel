// An agent's routines (phase 7), on its page and on the Routines screen: recurring or triggered work that runs as a
// message in the routine's own chat. Each row: name, when it runs next (or "on demand"), Run now and on/off, and in
// ⋯ its chat, its webhook URL and delete. New ones in a dialog with schedule presets (or a cron pattern, or a
// connector's read-only tool to watch: it runs on what's new there); agents can
// also propose them from a chat (zorel_routines), as approval cards.
import type { Agent, McpServer, Routine, ToolInfo } from "@zorel/contracts"
import { isTeammate } from "@zorel/contracts"
import { formatAge, formatTime, t } from "@zorel/i18n"
import { useEffect, useState } from "react"
import { agentsAtom, mutations, routinesAtom, serversAtom, useInvalidate, useList, useMutation, useReading } from "../client.ts"
import { agentTone } from "../labels.ts"
import { go } from "../state.ts"
import { parse } from "./receipt-args.ts"
import { AgentAvatar, AlarmClock, Button, Column, ConfirmDialog, Copy, Dialog, EmptyState, Field, IconButton, Input, Menu, MenuItem, MenuSeparator, MessageCircle, MoreHorizontal, Play, Plus, Rows, Screen, Section, Select, Switch, Textarea, Tooltip, Trash2 } from "@/ui"

const PRESETS = [
  { value: "0 * * * *", key: "hourly" },
  { value: "0 9 * * *", key: "daily" },
  { value: "0 9 * * 1-5", key: "weekdays" },
  { value: "0 9 * * 1", key: "weekly" },
  { value: "none", key: "onDemand" },
  { value: "watch", key: "watch" },
  { value: "custom", key: "custom" }
] as const

const when = (r: Routine, servers: ReadonlyArray<McpServer>) =>
  !r.enabled
    ? t("routines.off")
    : r.watch
      ? t("routines.watching", { tool: r.watch.tool, server: servers.find((s) => s.id === r.watch?.serverId)?.name ?? "?" })
      : r.nextRunAt
        ? t("routines.next", { when: formatTime(r.nextRunAt) })
        : t("routines.onDemand")

// Every agent's routines on one page, one section per agent (the agent's name opens its page). "New routine" asks
// which agent runs it.
export function RoutinesView() {
  const agents = useList(agentsAtom)
  const routines = useReading(routinesAtom).items
  const team = agents.filter((a) => isTeammate(a))
  const withRoutines = team.filter((a) => routines.some((r) => r.agentId === a.id))
  const [adding, setAdding] = useState(false)
  const newButton = (variant: "default" | "secondary") =>
    team.length ? (
      <Button size="sm" variant={variant} onPress={() => setAdding(true)}>
        <Plus />
        {t("routines.new")}
      </Button>
    ) : (
      <Button size="sm" variant={variant} onPress={() => go({ view: "agents" })}>
        {t("routines.noAgents")}
      </Button>
    )
  return (
    <Screen title={t("routines.title")} subtitle={t("routines.pageHint")} actions={withRoutines.length > 0 && newButton("secondary")}>
      <Column>
        {withRoutines.length === 0 ? (
          <EmptyState icon={<AlarmClock />} title={t("routines.emptyTitle")} hint={t("routines.emptyHint")} action={newButton("default")} />
        ) : (
          withRoutines.map((a) => <AgentRoutines key={a.id} agent={a} title={a.name} />)
        )}
      </Column>
      <Dialog title={t("routines.new")} size="lg" isOpen={adding} onOpenChange={setAdding}>
        {(close) => <NewRoutine onDone={close} />}
      </Dialog>
    </Screen>
  )
}

// One agent's routines: a group of rows (name; when it runs next and how the last run went; Run now, ⋯ and on/off on
// the right; its chat, its webhook and delete in ⋯). With a webhook, its URL on a muted line.
export function AgentRoutines({ agent, title }: { agent: Agent; title?: string }) {
  const all = useReading(routinesAtom).items
  const mine = all.filter((r) => r.agentId === agent.id)
  const servers = useList(serversAtom)
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
        <Button size="sm" variant="ghost" onPress={() => setAdding(true)}>
          <Plus />
          {t("routines.new")}
        </Button>
      }
    >
      <Rows>
        {mine.length === 0 && <p className="py-3.5 text-muted">{t("routines.none")}</p>}
        {mine.map((r) => (
          <div key={r.id} className="flex flex-col gap-1 py-3">
            <div className="flex items-center gap-2">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">{r.name}</span>
                <span className="truncate text-sm text-muted">
                  {[when(r, servers), r.lastRunAt && t(`routines.last.${r.lastStatus ?? "started"}`, { age: formatAge(r.lastRunAt) })].filter(Boolean).join(" · ")}
                </span>
              </span>
              <Tooltip content={t("routines.runNow")}>
                <IconButton
                  label={t("routines.runNow")}
                  onPress={() => {
                    setError(undefined)
                    void runNow({ params: { id: r.id }, ...keys })
                      .then(() => invalidate(["chats"]))
                      .catch(() => setError(t("routines.runFailed")))
                  }}
                >
                  <Play />
                </IconButton>
              </Tooltip>
              <Menu
                label={t("routines.actions", { name: r.name })}
                trigger={
                  <IconButton label={t("routines.actions", { name: r.name })}>
                    <MoreHorizontal />
                  </IconButton>
                }
              >
                <MenuItem icon={<MessageCircle />} onAction={() => go({ view: "chat", id: r.chatId })}>
                  {t("routines.openChat")}
                </MenuItem>
                {r.token && (
                  <MenuItem icon={<Copy />} onAction={() => void navigator.clipboard.writeText(hookOf(r.token ?? ""))}>
                    {t("routines.copyHook")}
                  </MenuItem>
                )}
                <MenuSeparator />
                <MenuItem icon={<Trash2 />} tone="danger" onAction={() => setConfirm(r)}>
                  {t("common.delete")}
                </MenuItem>
              </Menu>
              <Switch aria-label={t("routines.enabled", { name: r.name })} isSelected={r.enabled} onChange={(enabled) => void update({ params: { id: r.id }, payload: { enabled }, ...keys })} />
            </div>
            {r.token && <code className="truncate font-mono text-sm text-dim">{`POST ${hookOf(r.token)}`}</code>}
          </div>
        ))}
      </Rows>
      {error && <p className="text-sm text-danger">{error}</p>}
      <Dialog title={t("routines.newFor", { name: agent.name })} size="lg" isOpen={adding} onOpenChange={setAdding}>
        {(close) => <NewRoutine agent={agent} onDone={close} />}
      </Dialog>
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
const hookOf = (token: string) => `${location.origin}/api/hooks/${token}`

function NewRoutine({ agent, onDone }: { agent?: Agent; onDone: () => void }) {
  const create = useMutation(mutations.createRoutine)
  const agents = useList(agentsAtom)
  const team = agents.filter((a) => isTeammate(a))
  const [agentId, setAgentId] = useState(agent?.id ?? team[0]?.id ?? "")
  const invalidate = useInvalidate()
  const [name, setName] = useState("")
  const [prompt, setPrompt] = useState("")
  const [preset, setPreset] = useState<string>("0 9 * * 1-5")
  const [custom, setCustom] = useState("")
  const [webhook, setWebhook] = useState(false)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [watch, setWatch] = useState<{ serverId: string; tool: string; args: string }>({ serverId: "", tool: "", args: "" })
  const watching = preset === "watch"
  const cron = preset === "none" || watching ? null : preset === "custom" ? custom.trim() : preset
  const args = parseArgs(watch.args)
  const watchReady = !watching || (!!watch.serverId && !!watch.tool && args !== undefined)
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation() // a dialog's form: its submit must not reach a form around the page
        if (!agentId || !name.trim() || !prompt.trim() || cron === "" || !watchReady) return
        setBusy(true)
        setError(undefined)
        const w = watching && args ? { serverId: watch.serverId, tool: watch.tool, args } : null
        create({ payload: { agentId, name: name.trim(), prompt: prompt.trim(), cron, webhook, watch: w }, reactivityKeys: ["routines"] })
          .then(() => {
            invalidate(["chats"])
            onDone()
          })
          .catch((err: unknown) => setError((err as { message?: string })?.message || t("routines.createFailed")))
          .finally(() => setBusy(false))
      }}
    >
      {!agent && (
        <Field label={t("routines.agent")}>
          <Select
            aria-label={t("routines.agent")}
            value={agentId}
            onChange={setAgentId}
            searchLabel={t("agents.search")}
            emptyLabel={t("agents.noMatch")}
            options={team.map((a) => ({ value: a.id, label: a.name, icon: <AgentAvatar id={a.id} name={a.name} tone={agentTone(a, agents)} size={16} /> }))}
          />
        </Field>
      )}
      <Field label={t("routines.name")}>
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={t("routines.namePlaceholder")} />
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
      {watching && <WatchFields value={watch} onChange={setWatch} argsInvalid={args === undefined} />}
      <Switch isSelected={webhook} onChange={setWebhook}>
        {t("routines.webhook")}
      </Switch>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onPress={onDone}>
          {t("common.cancel")}
        </Button>
        <Button size="sm" type="submit" isPending={busy} isDisabled={!agentId || !name.trim() || !prompt.trim() || cron === "" || !watchReady || busy}>
          {t("routines.create")}
        </Button>
      </div>
    </form>
  )
}

// The tool's arguments as JSON (empty: none); undefined when it isn't a JSON object.
const parseArgs = (text: string) => (text.trim() ? parse(text) : {})

// What a watching routine polls: a connector, one of its read-only tools (polling must change nothing), and the
// tool's arguments. The tools load when the connector is picked.
function WatchFields({ value, onChange, argsInvalid }: { value: { serverId: string; tool: string; args: string }; onChange: (v: { serverId: string; tool: string; args: string }) => void; argsInvalid: boolean }) {
  const servers = useList(serversAtom).filter((s) => s.enabled)
  const inspect = useMutation(mutations.inspectServer)
  const [tools, setTools] = useState<{ serverId: string; list: ReadonlyArray<ToolInfo>; error: string | null }>()
  useEffect(() => {
    if (!value.serverId) return
    let live = true
    inspect({ params: { id: value.serverId } }).then(
      (r) => live && setTools({ serverId: value.serverId, list: r.tools.filter((x) => x.cls === "read"), error: r.error }),
      (e: unknown) => live && setTools({ serverId: value.serverId, list: [], error: String(e) })
    )
    return () => {
      live = false
    }
  }, [value.serverId, inspect])
  // The first connector and its first read tool are picked, so the common case is one click.
  const first = servers[0]?.id
  useEffect(() => {
    if (!value.serverId && first) onChange({ ...value, serverId: first })
  }, [first, value, onChange])
  const firstTool = tools?.serverId === value.serverId ? tools.list[0]?.name : undefined
  useEffect(() => {
    if (!value.tool && firstTool) onChange({ ...value, tool: firstTool })
  }, [firstTool, value, onChange])
  if (!servers.length)
    return (
      <p className="text-sm text-muted">
        {t("routines.noConnectors")}{" "}
        <Button size="sm" variant="ghost" onPress={() => go({ view: "settings", tab: "mcp" })}>
          {t("routines.addConnector")}
        </Button>
      </p>
    )
  const loaded = tools?.serverId === value.serverId ? tools : undefined
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("routines.connector")}>
          <Select aria-label={t("routines.connector")} value={value.serverId} onChange={(serverId) => onChange({ ...value, serverId, tool: "" })} options={servers.map((s) => ({ value: s.id, label: s.name }))} />
        </Field>
        <Field label={t("routines.tool")} hint={loaded?.error ?? (loaded && !loaded.list.length ? t("routines.noReadTools") : t("routines.toolHint"))}>
          <Select
            aria-label={t("routines.tool")}
            value={value.tool}
            onChange={(tool) => onChange({ ...value, tool })}
            searchLabel={t("routines.tool")}
            emptyLabel={t("routines.noReadTools")}
            options={(loaded?.list ?? []).map((x) => ({ value: x.name, label: x.name }))}
          />
        </Field>
      </div>
      <Field label={t("routines.args")} hint={argsInvalid ? t("routines.argsInvalid") : t("routines.argsHint")}>
        <Textarea value={value.args} onChange={(e) => onChange({ ...value, args: e.target.value })} rows={2} className="font-mono" placeholder={'{ "state": "open" }'} />
      </Field>
    </div>
  )
}
