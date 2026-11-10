// An agent's routines (phase 7), on its page and on the Routines screen: recurring or triggered work that runs as a
// message in the routine's own chat. Each row: name, when it runs next (or "on demand"), Run now and on/off, and in
// ⋯ its chat, its webhook URL and delete. New ones in a dialog with schedule presets (or a cron pattern, or a
// connector's read-only tool to watch: it runs on what's new there); agents can
// also propose them from a chat (zorel_routines), as approval cards.
// Spec 012: the page has a Week view (routine-week.tsx); each routine has Settings (when to tell the person, where,
// urgent, look first) and a History of its runs (outcome, summary, what the person was told).
import type { Agent, ConnectorDestination, McpServer, Routine, RoutineChannel, RoutineRun, RoutineTell, ToolInfo } from "@zorel/contracts"
import { isTeammate } from "@zorel/contracts"
import { formatAge, formatTime, locale, t } from "@zorel/i18n"
import { useEffect, useState } from "react"
import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import { agentsAtom, mutations, pagesAtom, preferencesAtom, routineHistoryAtom, routinesAtom, serversAtom, useInvalidate, useList, useMutation, useReading } from "../client.ts"
import { agentTone } from "../labels.ts"
import { go } from "../state.ts"
import { parse } from "./receipt-args.ts"
import { AgentAvatar, AlarmClock, Bot, Button, CheckList, cx, Column, ConfirmDialog, Copy, Dialog, Dot, EmptyState, Field, History, IconButton, Input, Menu, MenuItem, MenuSeparator, MessageCircle, MoreHorizontal, Play, Plus, Rows, Screen, Section, Segmented, Select, Settings, SettingRow, Switch, Textarea, Tooltip, Trash2, Workflow } from "@/ui"
import { RoutineWeek, type Slot } from "./routine-week.tsx"
import { ConnectorDestinations } from "./deliver-to.tsx"

const PRESETS = [
  { value: "0 * * * *", key: "hourly" },
  { value: "0 9 * * *", key: "daily" },
  { value: "0 9 * * 1-5", key: "weekdays" },
  { value: "0 9 * * 1", key: "weekly" },
  { value: "dayStart", key: "dayStart" },
  { value: "none", key: "onDemand" },
  { value: "watch", key: "watch" },
  { value: "custom", key: "custom" }
] as const

const when = (r: Routine, servers: ReadonlyArray<McpServer>) =>
  !r.enabled
    ? t("routines.off")
    : r.onDayStart
      ? t("routines.dayStart")
      : r.watch
      ? t("routines.watching", { tool: r.watch.tool, server: servers.find((s) => s.id === r.watch?.serverId)?.name ?? "?" })
      : r.nextRunAt
        ? t("routines.next", { when: formatTime(r.nextRunAt) })
        : t("routines.onDemand")

const VIEW_KEY = "zorel.routinesView"
const savedView = (): "week" | "list" => {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "week"
  } catch {
    return "week"
  }
}
const saveView = (v: "week" | "list") => {
  try {
    localStorage.setItem(VIEW_KEY, v)
  } catch {}
}

// Every routine on one page. The list is an agenda, like a calendar's schedule view: what runs today, tomorrow and
// the days after (each row with its time and the agent that runs it), then what runs when something happens, what
// runs only on demand, and what is off. "New routine" asks which agent runs it.
export function RoutinesView() {
  const agents = useList(agentsAtom)
  const routines = useReading(routinesAtom).items
  const team = agents.filter((a) => isTeammate(a))
  const withRoutines = team.filter((a) => routines.some((r) => r.agentId === a.id))
  const [adding, setAdding] = useState(false)
  const [slot, setSlot] = useState<Slot>() // a slot clicked on the week: the new routine starts there
  // The week first (spec 012); the last choice is remembered on this computer.
  const [view, setView] = useState<"week" | "list">(savedView)
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
    <Screen
      title={t("routines.title")}
      subtitle={t("routines.pageHint")}
      actions={
        withRoutines.length > 0 && (
          <>
            <Segmented
              label={t("routines.view")}
              value={view}
              onChange={(v) => {
                setView(v)
                saveView(v)
              }}
              options={[
                { id: "week", label: t("routines.week") },
                { id: "list", label: t("routines.list") }
              ]}
            />
            {newButton("secondary")}
          </>
        )
      }
    >
      {view === "week" && withRoutines.length > 0 ? (
        <div className="px-7 py-5">
          <RoutineWeek
            onCreate={(s) => {
              setSlot(s)
              setAdding(true)
            }}
          />
        </div>
      ) : (
        <Column>
          {withRoutines.length === 0 ? <EmptyState icon={<AlarmClock />} title={t("routines.emptyTitle")} hint={t("routines.emptyHint")} action={newButton("default")} /> : <RoutineAgenda />}
        </Column>
      )}
      <Dialog
        title={t("routines.new")}
        size="lg"
        isOpen={adding}
        onOpenChange={(o) => {
          setAdding(o)
          if (!o) setSlot(undefined)
        }}
      >
        {(close) => <NewRoutine onDone={close} {...(slot && { slot })} />}
      </Dialog>
    </Screen>
  )
}

const DAY_MS = 24 * 60 * 60_000
const dayKey = (at: number) => new Date(at).toLocaleDateString("en-CA") // YYYY-MM-DD, local
// When a routine runs next: its cron's next time, or for "when my day starts" the usual start today (if it hasn't
// run today and the time hasn't passed) or tomorrow.
function nextAt(r: Routine, startMinutes: number): number | null {
  if (!r.enabled) return null
  if (!r.onDayStart) return r.nextRunAt
  const d = new Date()
  d.setHours(0, startMinutes, 0, 0)
  if (r.dayRanOn === dayKey(Date.now()) || d.getTime() < Date.now()) return d.getTime() + DAY_MS
  return d.getTime()
}
const dayLabel = (at: number) => {
  const key = dayKey(at)
  if (key === dayKey(Date.now())) return t("routines.agenda.today")
  if (key === dayKey(Date.now() + DAY_MS)) return t("routines.agenda.tomorrow")
  return new Date(at).toLocaleDateString(locale(), { weekday: "long", month: "short", day: "numeric" })
}
const clock = (at: number) => new Date(at).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" })
// Groups that aren't a day, in this order, each with what puts a routine there.
const OTHER: ReadonlyArray<{ key: "events" | "onDemand" | "off"; has: (r: Routine) => boolean }> = [
  { key: "events", has: (r) => r.enabled && (!!r.watch || !!r.token) },
  { key: "onDemand", has: (r) => r.enabled && !r.watch && !r.token },
  { key: "off", has: (r) => !r.enabled }
]

function RoutineAgenda() {
  const routines = useReading(routinesAtom).items
  const agents = useList(agentsAtom)
  const prefs = AsyncResult.getOrElse(useAtomValue(preferencesAtom), () => undefined)
  const start = prefs?.timeProfile.dayStartMinutes ?? 9 * 60
  const timed = routines.map((r) => ({ r, at: nextAt(r, start) }))
  const days = new Map<string, Array<{ r: Routine; at: number }>>()
  for (const x of timed.filter((x): x is { r: Routine; at: number } => x.at !== null).sort((a, b) => a.at - b.at)) days.set(dayKey(x.at), [...(days.get(dayKey(x.at)) ?? []), x])
  const untimed = timed.filter((x) => x.at === null).map((x) => x.r)
  const item = (r: Routine, at?: number) => {
    const agent = agents.find((a) => a.id === r.agentId)
    return agent ? <RoutineItem key={r.id} routine={r} agent={agent} showAgent time={at === undefined ? undefined : clock(at)} /> : null
  }
  return (
    <>
      {[...days.values()].map((list) => (
        <Section key={dayKey(list[0]!.at)} title={dayLabel(list[0]!.at)}>
          <Rows>{list.map((x) => item(x.r, x.at))}</Rows>
        </Section>
      ))}
      {OTHER.map(({ key, has }) => {
        const list = untimed.filter(has)
        return list.length ? (
          <Section key={key} title={t(`routines.agenda.${key}`)}>
            <Rows>{list.map((r) => item(r))}</Rows>
          </Section>
        ) : null
      })}
    </>
  )
}

// One agent's routines, on its page: a group of rows with New routine.
export function AgentRoutines({ agent }: { agent: Agent }) {
  const mine = useReading(routinesAtom).items.filter((r) => r.agentId === agent.id)
  const [adding, setAdding] = useState(false)
  return (
    <Section
      title={t("routines.title")}
      description={t("routines.hint")}
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
          <RoutineItem key={r.id} routine={r} agent={agent} />
        ))}
      </Rows>
      <Dialog title={t("routines.newFor", { name: agent.name })} size="lg" isOpen={adding} onOpenChange={setAdding}>
        {(close) => <NewRoutine agent={agent} onDone={close} />}
      </Dialog>
    </Section>
  )
}

// One routine's row: (its time, in the agenda), the agent's face and name (in the agenda), the routine's name,
// when it runs and how the last run went; Run now, ⋯ (its chat, history, settings, webhook, delete) and on/off.
// On the agent's page, a routine with a webhook shows its URL on a muted line.
function RoutineItem({ routine: r, agent, showAgent, time }: { routine: Routine; agent: Agent; showAgent?: boolean; time?: string | undefined }) {
  const agents = useList(agentsAtom)
  const servers = useList(serversAtom)
  const update = useMutation(mutations.updateRoutine)
  const runNow = useMutation(mutations.runRoutine)
  const remove = useMutation(mutations.removeRoutine)
  const invalidate = useInvalidate()
  const [dialog, setDialog] = useState<"settings" | "history" | "delete">()
  const [error, setError] = useState<string>()
  const keys = { reactivityKeys: ["routines"] as const }
  // In the agenda the day and the time already say when (and the group says Off).
  const hint = [showAgent && agent.name, showAgent && (time || !r.enabled) ? undefined : when(r, servers), r.lastRunAt && t(`routines.last.${r.lastStatus ?? "started"}`, { age: formatAge(r.lastRunAt) })].filter(Boolean).join(" · ")
  return (
    <div className="flex flex-col gap-1 py-3">
      <div className="flex items-center gap-3">
        {time !== undefined && <span className="w-16 shrink-0 whitespace-nowrap text-sm text-muted tabular-nums">{time}</span>}
        {showAgent && <AgentAvatar id={agent.id} name={agent.name} tone={agentTone(agent, agents)} size={28} />}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cx("truncate font-medium", !r.enabled && "text-muted")}>{r.name}</span>
          <span className="truncate text-sm text-muted">{hint}</span>
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
          <MenuItem icon={<Workflow />} onAction={() => go({ view: "routine-flow", id: r.id })}>
            {t("flows.edit")}
          </MenuItem>
          <MenuItem icon={<MessageCircle />} onAction={() => go({ view: "chat", id: r.chatId })}>
            {t("routines.openChat")}
          </MenuItem>
          <MenuItem icon={<History />} onAction={() => setDialog("history")}>
            {t("routines.history")}
          </MenuItem>
          <MenuItem icon={<Settings />} onAction={() => setDialog("settings")}>
            {t("routines.settings")}
          </MenuItem>
          {showAgent && (
            <MenuItem icon={<Bot />} onAction={() => go({ view: "agent", id: agent.id })}>
              {t("routines.openAgent", { name: agent.name })}
            </MenuItem>
          )}
          {r.token && (
            <MenuItem icon={<Copy />} onAction={() => void navigator.clipboard.writeText(hookOf(r.token ?? ""))}>
              {t("routines.copyHook")}
            </MenuItem>
          )}
          <MenuSeparator />
          <MenuItem icon={<Trash2 />} tone="danger" onAction={() => setDialog("delete")}>
            {t("common.delete")}
          </MenuItem>
        </Menu>
        <Switch aria-label={t("routines.enabled", { name: r.name })} isSelected={r.enabled} onChange={(enabled) => void update({ params: { id: r.id }, payload: { enabled }, ...keys })} />
      </div>
      {!showAgent && r.token && <code className="truncate font-mono text-sm text-dim">{`POST ${hookOf(r.token)}`}</code>}
      {error && <p className="text-sm text-danger">{error}</p>}
      <Dialog title={t("routines.settingsFor", { name: r.name })} size="lg" isOpen={dialog === "settings"} onOpenChange={(o) => !o && setDialog(undefined)}>
        {(close) => <RoutineSettings routine={r} agent={agent} onDone={close} />}
      </Dialog>
      <Dialog title={t("routines.historyFor", { name: r.name })} size="lg" isOpen={dialog === "history"} onOpenChange={(o) => !o && setDialog(undefined)}>
        {() => <RoutineHistory routine={r} />}
      </Dialog>
      <ConfirmDialog
        isOpen={dialog === "delete"}
        onOpenChange={(o) => !o && setDialog(undefined)}
        title={t("routines.deleteTitle", { name: r.name })}
        description={t("routines.deleteBody")}
        onConfirm={() => void remove({ params: { id: r.id }, ...keys })}
      />
    </div>
  )
}

// The routine's local webhook: POST JSON to it from a script or service on this computer to run it.
const hookOf = (token: string) => `${location.origin}/api/hooks/${token}`

// A slot from the week: "every <day> at <time>" (picked), "every day" and "weekdays" at that time, as cron patterns.
const slotPresets = (s: Slot) => {
  const time = `${String(Math.floor(s.minutes / 60)).padStart(2, "0")}:${String(s.minutes % 60).padStart(2, "0")}`
  const at = `${s.minutes % 60} ${Math.floor(s.minutes / 60)}`
  const day = new Date(2026, 10, 8 + s.weekday).toLocaleDateString(locale(), { weekday: "long" }) // Nov 8, 2026 is a Sunday
  return [
    { value: `${at} * * ${s.weekday}`, label: t("routines.presets.weeklyAt", { day, time }) },
    { value: `${at} * * *`, label: t("routines.presets.dailyAt", { time }) },
    { value: `${at} * * 1-5`, label: t("routines.presets.weekdaysAt", { time }) }
  ]
}

function NewRoutine({ agent, slot, onDone }: { agent?: Agent; slot?: Slot; onDone: () => void }) {
  const create = useMutation(mutations.createRoutine)
  const agents = useList(agentsAtom)
  const team = agents.filter((a) => isTeammate(a))
  const [agentId, setAgentId] = useState(agent?.id ?? team[0]?.id ?? "")
  const invalidate = useInvalidate()
  const [name, setName] = useState("")
  const [prompt, setPrompt] = useState("")
  const fromSlot = slot ? slotPresets(slot) : []
  const [preset, setPreset] = useState<string>(fromSlot[0]?.value ?? "0 9 * * 1-5")
  const [custom, setCustom] = useState("")
  const [webhook, setWebhook] = useState(false)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [watch, setWatch] = useState<{ serverId: string; tool: string; args: string }>({ serverId: "", tool: "", args: "" })
  const watching = preset === "watch"
  const dayStart = preset === "dayStart"
  const [lookFirst, setLookFirst] = useState(false)
  const cron = preset === "none" || watching || dayStart ? null : preset === "custom" ? custom.trim() : preset
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
        create({ payload: { agentId, name: name.trim(), prompt: prompt.trim(), cron, webhook, watch: w, onDayStart: dayStart, lookFirst: lookFirst && (watching || webhook) }, reactivityKeys: ["routines"] })
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
          <Select aria-label={t("routines.when")} value={preset} onChange={setPreset} options={[...fromSlot, ...PRESETS.map((p) => ({ value: p.value, label: t(`routines.presets.${p.key}`) }))]} />
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
      {(watching || webhook) && (
        <Switch isSelected={lookFirst} onChange={setLookFirst}>
          {t("routines.lookFirst")}
        </Switch>
      )}
      {(watching || webhook) && <p className="text-sm text-dim">{t("routines.outsideNote")}</p>}
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

// A routine's delivery (spec 012): when the person is told (every run, when there is something, only in the brief),
// where (notification, Telegram, a page it keeps up to date), urgent (pings in quiet hours), and look first.
const TELLS: ReadonlyArray<RoutineTell> = ["something", "every", "brief"]
const CHANNELS: ReadonlyArray<RoutineChannel> = ["notify", "telegram", "page"]
function RoutineSettings({ routine, agent, onDone }: { routine: Routine; agent: Agent; onDone: () => void }) {
  const update = useMutation(mutations.updateRoutine)
  const pages = useList(pagesAtom).filter((p) => p.scope === "user" || p.scope === `project:${agent.projectId}` || p.scope === `agent:${agent.id}`)
  const [tell, setTell] = useState<RoutineTell>(routine.tell)
  const [channels, setChannels] = useState<ReadonlyArray<string>>(routine.delivery.channels)
  const [pageId, setPageId] = useState(routine.delivery.pageId ?? "")
  const [urgent, setUrgent] = useState(routine.urgent)
  const [lookFirst, setLookFirst] = useState(routine.lookFirst)
  const [connectors, setConnectors] = useState<ReadonlyArray<ConnectorDestination>>(routine.delivery.connectors ?? [])
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const outside = !!routine.watch || !!routine.token
  const needsPage = channels.includes("page") && !pageId
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (needsPage) return
        setBusy(true)
        setError(undefined)
        const picked = CHANNELS.filter((c) => channels.includes(c))
        const delivery = { channels: picked, ...(picked.includes("page") && pageId && { pageId }), ...(connectors.length > 0 && { connectors: [...connectors] }) }
        update({ params: { id: routine.id }, payload: { tell, delivery, urgent, lookFirst: outside && lookFirst }, reactivityKeys: ["routines"] })
          .then(onDone)
          .catch((err: unknown) => setError((err as { message?: string })?.message || t("routines.saveFailed")))
          .finally(() => setBusy(false))
      }}
    >
      <Section title={t("routines.tellTitle")} description={t("routines.tellHint")}>
        <Rows>
          <SettingRow title={t("routines.when")}>
            <Select aria-label={t("routines.when")} value={tell} onChange={(v) => setTell(v as RoutineTell)} options={TELLS.map((v) => ({ value: v, label: t(`routines.tell.${v}`) }))} />
          </SettingRow>
          <SettingRow title={t("routines.where")}>
            <CheckList label={t("routines.where")} value={channels} onChange={setChannels} options={CHANNELS.map((c) => ({ value: c, label: t(`routines.channels.${c}`) }))} />
          </SettingRow>
          {channels.includes("page") && (
            <SettingRow title={t("routines.page")}>
              <Select aria-label={t("routines.page")} value={pageId} onChange={setPageId} placeholder={t("routines.pagePick")} options={pages.map((p) => ({ value: p.id, label: p.title }))} />
            </SettingRow>
          )}
          <SettingRow title={t("routines.urgent")} hint={t("routines.urgentHint")}>
            <Switch aria-label={t("routines.urgent")} isSelected={urgent} onChange={setUrgent} />
          </SettingRow>
          {outside && (
            <SettingRow title={t("routines.lookFirst")} hint={t("routines.lookFirstHint")}>
              <Switch aria-label={t("routines.lookFirst")} isSelected={lookFirst} onChange={setLookFirst} />
            </SettingRow>
          )}
        </Rows>
      </Section>
      <Section title={t("deliver.section")} description={t("deliver.sectionHint")}>
        <ConnectorDestinations agent={agent} value={connectors} onChange={setConnectors} />
      </Section>
      {outside && <p className="text-sm text-dim">{t("routines.outsideNote")}</p>}
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onPress={onDone}>
          {t("common.cancel")}
        </Button>
        <Button size="sm" type="submit" isPending={busy} isDisabled={busy || needsPage}>
          {t("routines.save")}
        </Button>
      </div>
    </form>
  )
}

// A routine's runs (FR-017), newest first, 50 at a time: how each ended, its summary, what the person was told.
// A row opens the reply in the routine's chat. Clearing asks first.
function RoutineHistory({ routine }: { routine: Routine }) {
  const first = useReading(routineHistoryAtom(routine.id))
  const page = useMutation(mutations.routineHistoryPage)
  const clear = useMutation(mutations.clearRoutineHistory)
  const [older, setOlder] = useState<ReadonlyArray<RoutineRun>>([])
  const [end, setEnd] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const runs = [...first.items, ...older]
  const last = runs.at(-1)
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">{t("routines.runs.hint")}</p>
      <Rows>
        {runs.length === 0 && <p className="py-3.5 text-muted">{t("routines.runs.empty")}</p>}
        {runs.map((run) => (
          <RunRow key={run.id} run={run} onOpen={() => go(run.version != null ? { view: "routine-run", id: routine.id, runId: run.id } : { view: "chat", id: routine.chatId })} />
        ))}
      </Rows>
      <div className="flex justify-between gap-2">
        <Button size="sm" variant="ghost" isDisabled={!runs.length} onPress={() => setConfirm(true)}>
          <Trash2 />
          {t("routines.runs.clear")}
        </Button>
        {last && runs.length >= 50 && !end && (
          <Button
            size="sm"
            variant="secondary"
            onPress={() =>
              void page({ params: { id: routine.id }, query: { before: last.createdAt } }).then((more) => {
                setOlder((o) => [...o, ...more])
                if (more.length < 50) setEnd(true)
              })
            }
          >
            {t("routines.runs.more")}
          </Button>
        )}
      </div>
      <ConfirmDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title={t("routines.runs.clearTitle", { name: routine.name })}
        description={t("routines.runs.clearBody")}
        onConfirm={() => void clear({ params: { id: routine.id }, reactivityKeys: ["routines"] }).then(() => setOlder([]))}
      />
    </div>
  )
}

// One run: the outcome's dot, when and how it started, the summary, and what became of the telling.
const STATE_LABEL: Partial<Record<RoutineRun["state"], () => string>> = { queued: () => t("routines.runs.queued"), running: () => t("routines.runs.running") }
function toldOf(run: RoutineRun): string | undefined {
  if (run.deliveryNote === "refused") return t("routines.runs.refused")
  if (run.deliveryNote) return run.deliveryNote
  if (run.held) return t("routines.runs.held")
  return run.deliveredAt ? t("routines.runs.told") : undefined
}
function RunRow({ run, onOpen }: { run: RoutineRun; onOpen: () => void }) {
  const state = STATE_LABEL[run.state]?.()
  const title = run.summary || (run.outcome ? t(`routines.runs.outcome.${run.outcome}`) : state)
  const meta = [formatTime(run.createdAt), t(`routines.runs.trigger.${run.trigger}`), title === state ? undefined : state, toldOf(run), run.triageTokens ? t("routines.runs.tokens", { count: run.triageTokens }) : undefined, run.cost ? `$${run.cost.toFixed(3)}` : undefined]
  return (
    <div className="flex items-center gap-3 py-3">
      <OutcomeDot outcome={run.outcome} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{title}</span>
        <span className="truncate text-sm text-muted">{meta.filter(Boolean).join(" · ")}</span>
      </span>
      {(run.messageId || run.version != null) && (
        <Button size="sm" variant="ghost" onPress={onOpen}>
          {t("routines.runs.open")}
        </Button>
      )}
    </div>
  )
}

const DOT_CLASS: Record<"something" | "nothing", string> = { something: "size-1.5 shrink-0 rounded-full bg-fg", nothing: "size-1.5 shrink-0 rounded-full border border-dim" }
const OutcomeDot = ({ outcome }: { outcome: RoutineRun["outcome"] }) =>
  outcome === "needs" ? <Dot tone="warning" /> : <span aria-hidden="true" className={DOT_CLASS[outcome ?? "nothing"]} />
