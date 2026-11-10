// New routine (spec 013): who runs it, what it does, what starts it, and where the result goes, in one dialog. What
// starts it uses the editor's own trigger fields (a connector's tool and its inputs as a form, never JSON), and the
// dialog saves a first version of its steps: trigger → the agent → end, refined later in the editor. A sentence at
// the foot says what will happen.
import { type Agent, type ConnectorDestination, type FlowGraph, isTeammate, validateFlow } from "@zorel/contracts"
import { locale, t } from "@zorel/i18n"
import { type ReactNode, useEffect, useState } from "react"
import { agentsAtom, mutations, useInvalidate, useList, useMutation } from "../client.ts"
import { agentTone } from "../labels.ts"
import { go } from "../state.ts"
import { AgentAvatar, AlarmClock, Badge, History, ArrowRight, Bell, Button, ChoiceCards, CircleAlert, Clock, Code2, cx, Dot, Field, Input, Mail, MultiSegmented, Play, Segmented, Select, SettingRow, Sparkles, Switch, Tab, TabList, TabPanel, Tabs, Textarea } from "@/ui"
import { ConnectorDestinations } from "./deliver-to.tsx"
import { TestTrigger, WatchFields } from "./flow-panel.tsx"
import type { Slot } from "./routine-week.tsx"

type Trigger = Extract<FlowGraph["nodes"][number], { kind: "trigger" }>["config"]
type Part = "basics" | "when" | "result"
const PARTS: ReadonlyArray<Part> = ["basics", "when", "result"]
type Starts = "time" | "arrives" | "message" | "script" | "hand"
type Repeat = "weekly" | "once" | "monthly" | "dayStart"
const STARTS: ReadonlyArray<Starts> = ["time", "arrives", "message", "script", "hand"]
const START_ICON: Record<Starts, () => ReactNode> = { time: () => <AlarmClock />, arrives: () => <Sparkles />, message: () => <Mail />, script: () => <Code2 />, hand: () => <Play /> }
const REPEATS: ReadonlyArray<Repeat> = ["weekly", "once", "monthly", "dayStart"]
const WEEKDAYS = ["1", "2", "3", "4", "5"]
const EVERY_DAY = ["0", "1", "2", "3", "4", "5", "6"]
// Monday first in the row, as calendars here are read; cron counts Sunday as 0.
const ROW = ["1", "2", "3", "4", "5", "6", "0"]
const dayName = (d: string, style: "short" | "long") => new Date(2026, 10, 8 + Number(d)).toLocaleDateString(locale(), { weekday: style }) // Nov 8, 2026 is a Sunday
const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
const tomorrow = () => new Date(Date.now() + 86_400_000).toLocaleDateString("en-CA")

// A weekly schedule as cron: minute, hour, any day of the month, any month, these weekdays.
export const weeklyCron = (days: ReadonlyArray<string>, time: string) => {
  const [h, m] = time.split(":").map(Number) as [number, number]
  const list = [...days].map(Number).sort((a, b) => a - b)
  return `${m} ${h} * * ${list.length === 7 ? "*" : list.join(",")}`
}

// The dialog's draft, per agent page (or the Routines page): kept while it's typed, cleared on Cancel and Create.
type Draft = { agentId: string; name: string; prompt: string; starts: Starts; repeat: Repeat; days: string[]; time: string; date: string; day: number; watch: Trigger; lookFirst: boolean; destinations: ConnectorDestination[] }
const draftKey = (agentId: string | undefined) => `zorel.draft.newRoutine.${agentId ?? "any"}`
function readDraft(agentId: string | undefined): Draft | undefined {
  try {
    const raw = localStorage.getItem(draftKey(agentId))
    return raw ? (JSON.parse(raw) as Draft) : undefined
  } catch {
    return undefined
  }
}
function writeDraft(agentId: string | undefined, d: Draft | undefined) {
  try {
    if (d) localStorage.setItem(draftKey(agentId), JSON.stringify(d))
    else localStorage.removeItem(draftKey(agentId))
  } catch {}
}

export function NewRoutine({ agent, slot, onDone }: { agent?: Agent | undefined; slot?: Slot | undefined; onDone: () => void }) {
  const create = useMutation(mutations.createRoutine)
  const saveFlow = useMutation(mutations.saveFlow)
  const remove = useMutation(mutations.removeRoutine)
  const testNew = useMutation(mutations.testNewTrigger)
  const invalidate = useInvalidate()
  const agents = useList(agentsAtom)
  const team = agents.filter((a) => isTeammate(a))
  // What was typed before leaving the dialog (a "Sign in again" in the tool picker goes to Settings) comes back.
  const [draft] = useState(() => (slot ? undefined : readDraft(agent?.id)))
  const [agentId, setAgentId] = useState(draft?.agentId ?? agent?.id ?? team[0]?.id ?? "")
  const who = agents.find((a) => a.id === agentId)
  const [name, setName] = useState(draft?.name ?? "")
  const [prompt, setPrompt] = useState(draft?.prompt ?? "")
  const [starts, setStarts] = useState<Starts>(draft?.starts ?? "time")
  const [repeat, setRepeat] = useState<Repeat>(draft?.repeat ?? "weekly")
  const [days, setDays] = useState<ReadonlyArray<string>>(slot ? [String(slot.weekday)] : (draft?.days ?? WEEKDAYS))
  const [time, setTime] = useState(slot ? hhmm(slot.minutes) : (draft?.time ?? "09:00"))
  const [date, setDate] = useState(draft?.date ?? tomorrow())
  const [day, setDay] = useState(draft?.day ?? 1)
  const [watch, setWatch] = useState<Trigger>(draft?.watch ?? { on: "watch" })
  const [lookFirst, setLookFirst] = useState(draft?.lookFirst ?? false)
  const [destinations, setDestinations] = useState<ReadonlyArray<ConnectorDestination>>(draft?.destinations ?? [])
  const [restored, setRestored] = useState(!!draft)
  const [addingDestination, setAddingDestination] = useState(false)
  const [tried, setTried] = useState(false)
  // Kept as it's typed; Cancel and Create clear it.
  useEffect(() => {
    writeDraft(agent?.id, name || prompt ? { agentId, name, prompt, starts, repeat, days: [...days], time, date, day, watch, lookFirst, destinations: [...destinations] } : undefined)
  }, [agent?.id, agentId, name, prompt, starts, repeat, days, time, date, day, watch, lookFirst, destinations])
  const startOver = () => {
    writeDraft(agent?.id, undefined)
    setName("")
    setPrompt("")
    setStarts("time")
    setRepeat("weekly")
    setDays(WEEKDAYS)
    setTime("09:00")
    setWatch({ on: "watch" })
    setDate(tomorrow())
    setDay(1)
    setLookFirst(false)
    setAgentId(agent?.id ?? team[0]?.id ?? "")
    setDestinations([])
    setTab("basics")
    setRestored(false)
  }
  const cancel = () => {
    writeDraft(agent?.id, undefined)
    onDone()
  }
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<Part>("basics")

  // What starts it, as the flow's trigger.
  const trigger: Trigger =
    starts === "time"
      ? repeat === "weekly"
        ? { on: "schedule", cron: days.length ? weeklyCron(days, time) : "" }
        : repeat === "once"
          ? { on: "once", date, time }
          : repeat === "monthly"
            ? { on: "monthly", day, time }
            : { on: "dayStart" }
      : starts === "arrives" || starts === "message"
        ? { ...watch, on: starts === "message" ? "message" : "watch" }
        : starts === "script"
          ? { on: "webhook", lookFirst }
          : { on: "manual" }
  const graph: FlowGraph = {
    nodes: [
      { id: "trigger", kind: "trigger", x: 0, y: 0, config: trigger },
      { id: "agent", kind: "agent", x: 0, y: 120, config: { prompt: prompt.trim() } },
      { id: "end", kind: "end", x: 0, y: 240, config: {} }
    ],
    edges: [
      { id: "e1", from: "trigger", to: "agent" },
      { id: "e2", from: "agent", to: "end" }
    ]
  }
  const checked = validateFlow(graph)
  const past = starts === "time" && repeat === "once" && new Date(`${date}T${time}`).getTime() <= Date.now()
  // Each part's own check, so its tab can say it needs something.
  const basicsOk = !!agentId && !!name.trim() && !!prompt.trim()
  const whenOk = (checked.ok || (!checked.ok && checked.nodeId === "agent")) && !past && !(starts === "time" && repeat === "weekly" && !days.length)
  const ready = basicsOk && whenOk && checked.ok && !addingDestination
  // Nothing is "missing" on a dialog just opened: the warnings wait until something was typed, another part opened,
  // or Create tried.
  const touched = tried || !!name || !!prompt || tab !== "basics"
  const missing: Record<Part, boolean> = { basics: touched && !basicsOk, when: touched && !whenOk, result: false }
  // The first thing still missing, said where the summary goes (a disabled Create must say why).
  const watching = starts === "arrives" || starts === "message"
  const field = !checked.ok && checked.nodeId === "trigger" ? checked.field : undefined
  // What's still missing, in order, each with the part it's in. The open part's own first, then the others'; a
  // missing thing on another part is a link to it.
  const checks: ReadonlyArray<{ part: Part; missing: boolean; text: () => string }> = [
    { part: "result", missing: addingDestination, text: () => t("newRoutine.todo.destination") },
    { part: "basics", missing: !name.trim(), text: () => t("newRoutine.todo.name") },
    { part: "basics", missing: !prompt.trim(), text: () => t("newRoutine.todo.prompt") },
    { part: "basics", missing: !agentId, text: () => t("newRoutine.todo.agent") },
    { part: "when", missing: starts === "time" && repeat === "weekly" && !days.length, text: () => t("newRoutine.pickDay") },
    { part: "when", missing: past, text: () => t("newRoutine.past") },
    { part: "when", missing: watching && (field === "serverId" || field === "tool"), text: () => t("newRoutine.todo.tool") },
    { part: "when", missing: !!field && !(watching && (field === "serverId" || field === "tool")), text: () => t("newRoutine.todo.field") }
  ]
  const first = checks.find((c) => c.missing && c.part === tab) ?? checks.find((c) => c.missing)
  const todo = first?.text()

  const submit = (steps: boolean) => {
    if (!ready) return
    setBusy(true)
    setError(undefined)
    // The routine first (its chat, its delivery), then its steps as version 1: the trigger lives there.
    create({ payload: { agentId, name: name.trim(), prompt: prompt.trim(), cron: null, webhook: false, ...(destinations.length > 0 && { delivery: { channels: ["notify"], connectors: [...destinations] } }) }, reactivityKeys: ["routines"] })
      .then((r) =>
        saveFlow({ params: { id: r.id }, payload: { graph, baseVersion: null }, reactivityKeys: ["routines"] }).then(
          () => {
            invalidate(["chats"])
            writeDraft(agent?.id, undefined)
            onDone()
            if (steps) go({ view: "routine-flow", id: r.id })
          },
          (err: { message?: string }) => remove({ params: { id: r.id }, reactivityKeys: ["routines"] }).then(() => Promise.reject(err))
        )
      )
      .catch((err: { message?: string }) => setError(err?.message || t("routines.createFailed")))
      .finally(() => setBusy(false))
  }

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation() // a dialog's form: its submit must not reach a form around the page
        submit(false)
      }}
      onKeyDown={(e) => {
        // ⌘Enter / Ctrl+Enter creates from any part.
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          setTried(true)
          submit(false)
        }
      }}
    >
      {restored && (
        <p className="mb-4 flex shrink-0 items-center gap-2 text-sm text-muted">
          <History className="size-4 shrink-0" />
          <span className="flex-1">{t("newRoutine.restored")}</span>
          <Button size="sm" variant="ghost" onPress={startOver}>
            {t("newRoutine.startOver")}
          </Button>
        </p>
      )}
      {/* The tabs stay on top and the foot below; only the part between them scrolls on a short window. */}
      <Tabs selectedKey={tab} onSelectionChange={(k) => setTab(k as Part)} className="min-h-0 flex-1 gap-0">
        <TabList label={t("newRoutine.parts")} className="shrink-0">
          {PARTS.map((p) => (
            <Tab key={p} id={p}>
              {t(`newRoutine.part.${p}`)}
              {missing[p] && (
                <>
                  <Dot tone="warning" />
                  <span className="sr-only">{t("newRoutine.needsSomething")}</span>
                </>
              )}
            </Tab>
          ))}
        </TabList>

        <div className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6 pt-6 pb-6">
        <TabPanel id="basics" className="flex flex-col gap-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t("routines.name")}>
              <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={t("routines.namePlaceholder")} />
            </Field>
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
          </div>
          <Field label={t("routines.prompt")} hint={t("newRoutine.promptHint")}>
            <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5} maxLength={8000} placeholder={t("newRoutine.promptPlaceholder")} />
          </Field>
        </TabPanel>

        <TabPanel id="when" className="flex flex-col gap-6">
          <ChoiceCards list label={t("newRoutine.starts")} value={starts} onChange={setStarts} options={STARTS.map((id) => ({ value: id, title: t(`newRoutine.start.${id}`), description: t(`newRoutine.startHint.${id}`), icon: START_ICON[id]() }))} />
          {starts === "time" && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2 text-sm text-muted">
                {t("newRoutine.repeat")}
                <Segmented label={t("newRoutine.repeat")} value={repeat} onChange={setRepeat} options={REPEATS.map((id) => ({ id, label: t(`newRoutine.repeats.${id}`) }))} />
              </div>
              {repeat === "weekly" && (
                <div className="flex flex-col gap-2 text-sm text-muted">
                  {t("newRoutine.on")}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <MultiSegmented label={t("newRoutine.days")} value={days} onChange={setDays} options={ROW.map((d) => ({ id: d, label: dayName(d, "short").slice(0, 3), title: dayName(d, "long") }))} />
                    <span className="flex gap-1">
                      <Button size="sm" variant="ghost" onPress={() => setDays(WEEKDAYS)}>
                        {t("newRoutine.weekdays")}
                      </Button>
                      <Button size="sm" variant="ghost" onPress={() => setDays(EVERY_DAY)}>
                        {t("newRoutine.everyDay")}
                      </Button>
                    </span>
                  </div>
                </div>
              )}
              {repeat !== "dayStart" && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {repeat === "once" && (
                    <Field label={t("flows.panel.date")}>
                      <Input type="date" min={new Date().toLocaleDateString("en-CA")} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
                    </Field>
                  )}
                  {repeat === "monthly" && (
                    <Field label={t("flows.panel.day")}>
                      <Select value={String(day)} onChange={(v) => setDay(Number(v))} options={Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))} />
                    </Field>
                  )}
                  <Field label={t("flows.panel.time")}>
                    <Input type="time" value={time} onChange={(e) => e.target.value && setTime(e.target.value)} />
                  </Field>
                </div>
              )}
            </div>
          )}
          {watching && who && (
            <div className="flex flex-col gap-4">
              <WatchFields c={{ ...watch, on: starts === "message" ? "message" : "watch" }} set={setWatch} agent={who} />
              {watch.tool && <TestTrigger run={() => testNew({ payload: { agentId, prompt: prompt.trim(), trigger } })} />}
            </div>
          )}
          {starts === "script" && (
            <Switch isSelected={lookFirst} onChange={setLookFirst}>
              {t("flows.panel.lookFirst")}
            </Switch>
          )}
        </TabPanel>

        <TabPanel id="result" className="flex flex-col gap-6">
          {who && (
            <ConnectorDestinations
              agent={who}
              value={destinations}
              onChange={setDestinations}
              lead={
                <SettingRow icon={<Bell />} title={t("newRoutine.tellMe")} hint={t("newRoutine.tellMeHint")}>
                  <Badge tone="neutral">{t("newRoutine.tellMeOn")}</Badge>
                </SettingRow>
              }
              onAdding={setAddingDestination}
            />
          )}
        </TabPanel>
        </div>
      </Tabs>

      {/* The foot: what will happen (or what's still missing), and the actions, on one line. */}
      <div className="-mx-6 flex shrink-0 flex-wrap items-center gap-3 border-t border-subtle px-6 pt-4">
        <p role="status" aria-live="polite" className={cx("flex min-w-0 flex-1 basis-60 items-center gap-2", todo ? (touched ? "text-warning" : "text-muted") : "text-secondary")}>
          {todo && touched ? <CircleAlert className="size-4 shrink-0" /> : <Clock className="size-4 shrink-0 text-muted" />}
          {first && first.part !== tab && touched ? (
            <Button size="sm" variant="ghost" className="-ml-2 h-auto px-2 text-warning underline underline-offset-2" onPress={() => setTab(first.part)}>
              {todo}
            </Button>
          ) : (
            <span>{todo ?? [summaryOf(starts, repeat, days, time, date, day), destinations.length > 0 && t("newRoutine.summary.posts", { tools: destinations.map((d) => d.tool).join(", ") })].filter(Boolean).join(" ")}</span>
          )}
          {ready && <span className="shrink-0 text-sm text-dim">{MAC ? "⌘↵" : "Ctrl ↵"}</span>}
        </p>
        {error && <p className="w-full text-sm text-danger">{error}</p>}
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onPress={cancel}>
            {t("common.cancel")}
          </Button>
          {tab !== "result" && (
            <Button variant="secondary" onPress={() => setTab(PARTS[PARTS.indexOf(tab) + 1]!)}>
              {t("newRoutine.next")}
              <ArrowRight />
            </Button>
          )}
          <Button variant="default" type="submit" isPending={busy} isDisabled={!ready || busy}>
            {t("routines.create")}
          </Button>
        </div>
      </div>
    </form>
  )
}

// What will happen, in one sentence (the foot of the dialog).
// "Monday, Wednesday and Friday": the language's own list ("segunda, quarta e sexta").
const listOf = (days: ReadonlyArray<string>) =>
  days.length === 7 ? t("newRoutine.everyDayLower") : days.length === 5 && WEEKDAYS.every((d) => days.includes(d)) ? t("newRoutine.weekdaysLower") : new Intl.ListFormat(locale(), { type: "conjunction" }).format(ROW.filter((d) => days.includes(d)).map((d) => dayName(d, "long")))
function summaryOf(starts: Starts, repeat: Repeat, days: ReadonlyArray<string>, time: string, date: string, day: number): string {
  if (starts === "time" && repeat === "weekly") return days.length ? t("newRoutine.summary.weekly", { days: listOf(days), time }) : t("newRoutine.pickDay")
  // The time as it was typed (24h, like the field), the date in the language's own words.
  if (starts === "time" && repeat === "once") return t("newRoutine.summary.once", { date: `${new Date(`${date}T${time}`).toLocaleDateString(locale(), { dateStyle: "medium" })}, ${time}` })
  if (starts === "time" && repeat === "monthly") return t("newRoutine.summary.monthly", { day, time })
  if (starts === "time") return t("newRoutine.summary.dayStart")
  return t(`newRoutine.summary.${starts}`)
}
