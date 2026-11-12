// An agent's routines (phase 7), on its page and on the Routines screen: recurring or triggered work that runs as a
// message in the routine's own chat. Each row: name, when it runs next (or "on demand"), Run now and on/off, and in
// ⋯ its chat, its webhook URL and delete. New ones in a dialog with schedule presets (or a cron pattern, or a
// connector's read-only tool to watch: it runs on what's new there); agents can
// also propose them from a chat (zorel_routines), as approval cards.
// Spec 012: the page has a Week view (routine-week.tsx); each routine has Settings (when to tell the person, where,
// urgent, look first) and a History of its runs (outcome, summary, what the person was told).
import type { Agent, ConnectorDestination, McpServer, Routine, RoutineChannel, RoutineRun, RoutineTell, } from "@zorel/contracts"
import { isTeammate } from "@zorel/contracts"
import { formatAge, formatTime, locale, t } from "@zorel/i18n"
import { useState } from "react"
import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import { agentsAtom, mutations, pagesAtom, preferencesAtom, routineHistoryAtom, routinesAtom, serversAtom, useInvalidate, useList, useMutation, useReading } from "../client.ts"
import { agentTint, agentTone } from "../labels.ts"
import { go, type Route, store, stored } from "../state.ts"
import { AgentAvatar, AlarmClock, Fold, MultiSegmented, Bot, Button, cn, Column, ConfirmDialog, Copy, Dialog, Dot, EmptyState, History, IconButton, Menu, MenuItem, MenuSeparator, MessageCircle, MoreHorizontal, Play, Plus, Rows, Screen, Section, Segmented, Select, Settings, SettingRow, Switch, Tooltip, Trash2, Workflow, SETTLE } from "@/ui"
import { RoutineWeek, type Slot } from "./routine-week.tsx"
import { ConnectorDestinations } from "./deliver-to.tsx"
import { NewRoutine } from "./new-routine.tsx"


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
const savedView = (): "week" | "list" => (stored(VIEW_KEY) === "list" ? "list" : "week")
const saveView = (v: "week" | "list") => store(VIEW_KEY, v)

// Every routine on one page. The list is an agenda, like a calendar's schedule view: what runs today, tomorrow and
// the days after (each row with its time and the agent that runs it), then what runs when something happens, what
// runs only on demand, and what is off. "New routine" asks which agent runs it.
export function RoutinesView() {
  // A routine pressed on the week: its sheet (and the run pressed, when it was one).
  const [showing, setShowing] = useState<{ routineId: string; runId: string | undefined }>()
  const shown = useList(routinesAtom).find((r) => r.id === showing?.routineId)
  const showingAgent = useList(agentsAtom).find((a) => a.id === shown?.agentId)
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
        // The week is always there (spec 018): even with no routine yet, an empty slot starts one.
        (
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
            {newButton(withRoutines.length ? "secondary" : "default")}
          </>
        )
      }
    >
      {view === "week" ? (
        <div className={cn("px-7 py-5", SETTLE)}>
          <RoutineWeek
            {...(team.length > 0 && {
              onCreate: (s: Slot) => {
                setSlot(s)
                setAdding(true)
              }
            })}
            onOpen={(routineId, runId) => setShowing({ routineId, runId })}
          />
        </div>
      ) : (
        <Column className={SETTLE}>
          {withRoutines.length === 0 ? <EmptyState icon={<AlarmClock />} title={t("routines.emptyTitle")} hint={t("routines.emptyHint")} action={newButton("default")} /> : <RoutineAgenda />}
        </Column>
      )}
      <Dialog
        title={t("routines.new")}
        size="xl"
        anchor="top"
        isOpen={adding}
        onOpenChange={(o) => {
          setAdding(o)
          if (!o) setSlot(undefined)
        }}
      >
        {(close) => <NewRoutine onDone={close} {...(slot && { slot })} />}
      </Dialog>
      {shown && showingAgent && (
        <Dialog title={shown.name} size="lg" isOpen onOpenChange={(o) => !o && setShowing(undefined)}>
          {(close) => <RoutineSheet routine={shown} agent={showingAgent} runId={showing?.runId} onClose={close} />}
        </Dialog>
      )}
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
      <Dialog title={t("routines.newFor", { name: agent.name })} size="xl" anchor="top" isOpen={adding} onOpenChange={setAdding}>
        {(close) => <NewRoutine agent={agent} onDone={close} />}
      </Dialog>
    </Section>
  )
}

// What a routine's row and its sheet both do: run it now (a failure said in place) and turn it on or off.
function useRoutineActions(r: Routine) {
  const update = useMutation(mutations.updateRoutine)
  const run = useMutation(mutations.runRoutine)
  const invalidate = useInvalidate()
  const [error, setError] = useState<string>()
  const runNow = () => {
    setError(undefined)
    void run({ params: { id: r.id }, reactivityKeys: ["routines"] })
      .then(() => invalidate(["chats"]))
      .catch(() => setError(t("routines.runFailed")))
  }
  const enabled = <Switch aria-label={t("routines.enabled", { name: r.name })} isSelected={r.enabled} onChange={(on) => void update({ params: { id: r.id }, payload: { enabled: on }, reactivityKeys: ["routines"] })} />
  return { runNow, enabled, error }
}

// One routine's row: (its time, in the agenda), the agent's face and name (in the agenda), the routine's name,
// when it runs and how the last run went; Run now, ⋯ (its chat, history, settings, webhook, delete) and on/off.
// On the agent's page, a routine with a webhook shows its URL on a muted line.
function RoutineItem({ routine: r, agent, showAgent, time }: { routine: Routine; agent: Agent; showAgent?: boolean; time?: string | undefined }) {
  const agents = useList(agentsAtom)
  const servers = useList(serversAtom)
  const remove = useMutation(mutations.removeRoutine)
  const { runNow, enabled, error } = useRoutineActions(r)
  const [dialog, setDialog] = useState<"settings" | "history" | "delete">()
  // In the agenda the day and the time already say when (and the group says Off).
  const hint = [showAgent && agent.name, showAgent && (time || !r.enabled) ? undefined : when(r, servers), r.lastRunAt && t(`routines.last.${r.lastStatus ?? "started"}`, { age: formatAge(r.lastRunAt) })].filter(Boolean).join(" · ")
  return (
    <div className="flex flex-col gap-1 py-3">
      <div className="flex items-center gap-3">
        {time !== undefined && <span className="w-16 shrink-0 whitespace-nowrap text-sm text-muted tabular-nums">{time}</span>}
        {showAgent && <AgentAvatar id={agent.id} name={agent.name} tone={agentTone(agent, agents)} size={28} />}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn("truncate font-medium", !r.enabled && "text-muted")}>{r.name}</span>
          <span className="truncate text-sm text-muted">{hint}</span>
        </span>
        <Tooltip content={t("flows.edit")}>
          <IconButton label={t("flows.edit")} onPress={() => go({ view: "routine-flow", id: r.id })}>
            <Workflow />
          </IconButton>
        </Tooltip>
        <Tooltip content={t("routines.runNow")}>
          <IconButton label={t("routines.runNow")} onPress={runNow}>
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
        {enabled}
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
        onConfirm={() => void remove({ params: { id: r.id }, reactivityKeys: ["routines"] })}
      />
    </div>
  )
}

// A routine at a glance, from the week: whose it is and when it runs (and on/off), the run that was pressed, what you
// can do with it (run now, its steps, its chat, its settings: in place), and its last runs.
function RoutineSheet({ routine: r, agent, runId, onClose }: { routine: Routine; agent: Agent; runId: string | undefined; onClose: () => void }) {
  const agents = useList(agentsAtom)
  const servers = useList(serversAtom)
  const { runNow, enabled, error } = useRoutineActions(r)
  const run = useReading(routineHistoryAtom(r.id)).items.find((x) => x.id === runId)
  const [editing, setEditing] = useState(false)
  const leave = (to: Route) => {
    onClose()
    go(to)
  }
  if (editing) return <RoutineSettings routine={r} agent={agent} onDone={() => setEditing(false)} />
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <AgentAvatar id={agent.id} name={agent.name} tone={agentTone(agent, agents)} size={28} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn("tint-text truncate font-medium", agentTint(agent, agents))}>{agent.name}</span>
          <span className="truncate text-sm text-muted">{when(r, servers)}</span>
        </span>
        {enabled}
      </div>
      {run && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm text-muted">{t("routines.thisRun")}</h3>
          <Rows>
            <RunRow run={run} onOpen={() => leave(run.version != null ? { view: "routine-run", id: r.id, runId: run.id } : { view: "chat", id: r.chatId })} />
          </Rows>
        </section>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="default" onPress={runNow}>
          <Play />
          {t("routines.runNow")}
        </Button>
        <Button size="sm" variant="secondary" onPress={() => leave({ view: "routine-flow", id: r.id })}>
          <Workflow />
          {t("flows.edit")}
        </Button>
        <Button size="sm" variant="secondary" onPress={() => leave({ view: "chat", id: r.chatId })}>
          <MessageCircle />
          {t("routines.openChat")}
        </Button>
        <Button size="sm" variant="ghost" onPress={() => setEditing(true)}>
          <Settings />
          {t("routines.settings")}
        </Button>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <section className="flex flex-col gap-2">
        <h3 className="text-sm text-muted">{t("routines.history")}</h3>
        <RoutineHistory routine={r} />
      </section>
    </div>
  )
}

// The routine's local webhook: POST JSON to it from a script or service on this computer to run it.
const hookOf = (token: string) => `${location.origin}/api/hooks/${token}`

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
      className="flex flex-col gap-8"
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
          {/* Where: the channels side by side, several at once (as a routine's days). */}
          <SettingRow title={t("routines.where")}>
            <MultiSegmented label={t("routines.where")} value={channels} onChange={setChannels} options={CHANNELS.map((c) => ({ id: c, label: t(`routines.channels.${c}`) }))} />
          </SettingRow>
          <Fold open={channels.includes("page")}>
            <SettingRow title={t("routines.page")}>
              <Select aria-label={t("routines.page")} value={pageId} onChange={setPageId} placeholder={t("routines.pagePick")} options={pages.map((p) => ({ value: p.id, label: p.title }))} />
            </SettingRow>
          </Fold>
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
      {/* The add card already says what a destination is: no description repeating it above. */}
      <Section title={t("deliver.section")}>
        <ConnectorDestinations agent={agent} routineId={routine.id} value={connectors} onChange={setConnectors} />
      </Section>
      {outside && <p className="text-sm text-dim">{t("routines.outsideNote")}</p>}
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onPress={onDone}>
          {t("common.cancel")}
        </Button>
        <Button variant="default" type="submit" isPending={busy} isDisabled={busy || needsPage}>
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
