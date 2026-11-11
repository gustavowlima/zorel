// New routine (spec 013) as a list of steps, in one dialog: a name and the agent on top, then the steps in order —
// what starts it (nothing chosen until you choose: no time is set behind your back), the steps it takes (an
// instruction to the agent, a connector's tool, a check, a yes/no split, an "Ask me"), and where the result goes.
// Each card opens in place with its own fields (the editor's, shared), one at a time. Create saves the routine and
// those steps as its first version; the canvas edits them later.
import { type Agent, type ConnectorDestination, type FlowGraph, type FlowNode, isTeammate, PORTS, validateFlow } from "@zorel/contracts"
import { locale, t } from "@zorel/i18n"
import { type ReactNode, useEffect, useState } from "react"
import { agentsAtom, mutations, serversAtom, useInvalidate, useList, useMutation } from "../client.ts"
import { agentTone, hm } from "../labels.ts"
import type { Slot } from "./routine-week.tsx"
import { AgentAvatar, AlarmClock, Badge, Bell, Button, ChevronDown, ChoiceCards, CircleAlert, Clock, Code2, cn, Field, Fold, History, IconButton, IconTile, Input, Mail, Menu, MenuItem, MenuSeparator, MultiSegmented, Play, Plus, RowHit, Segmented, Select, SettingRow, Sparkles, Switch, Tag, Trash2 } from "@/ui"
import { ConnectorDestinations } from "./deliver-to.tsx"
import { missingOf } from "./flow-editor.tsx"
import { KindTile, kindIcon, nodeDetail, nodeTitle } from "./flow-kinds.tsx"
import { ADDABLE, insertAfter, layout, orderOf, removeNode } from "./flow-model.ts"
import { StepFields, TestTrigger, WatchFields } from "./flow-panel.tsx"
import { storedJson, storeJson } from "../state.ts"

type Trigger = Extract<FlowNode, { kind: "trigger" }>["config"]
type Starts = "time" | "arrives" | "message" | "script" | "hand"
type Repeat = "weekly" | "once" | "monthly" | "dayStart"
const STARTS: ReadonlyArray<Starts> = ["time", "arrives", "message", "script", "hand"]
const START_ICON: Record<Starts, () => ReactNode> = { time: () => <AlarmClock />, arrives: () => <Sparkles />, message: () => <Mail />, script: () => <Code2 />, hand: () => <Play /> }
const WEEKDAYS = ["1", "2", "3", "4", "5"]
const EVERY_DAY = ["0", "1", "2", "3", "4", "5", "6"]
// Monday first in the row, as calendars here are read; cron counts Sunday as 0.
const ROW = ["1", "2", "3", "4", "5", "6", "0"]
const dayName = (d: string, style: "short" | "long") => new Date(2026, 10, 8 + Number(d)).toLocaleDateString(locale(), { weekday: style }) // Nov 8, 2026 is a Sunday
const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
const tomorrow = () => new Date(Date.now() + 86_400_000).toLocaleDateString("en-CA")
const FIELD_TODO: Record<string, "connector" | "tool"> = { serverId: "connector", tool: "tool" }
const INDENT = ["", "pl-6", "pl-12", "pl-18", "pl-24"] as const

// A weekly schedule as cron: minute, hour, any day of the month, any month, these weekdays.
const weeklyCron = (days: ReadonlyArray<string>, time: string) => {
  const [h, m] = time.split(":").map(Number) as [number, number]
  const list = [...days].map(Number).sort((a, b) => a - b)
  return `${m} ${h} * * ${list.length === 7 ? "*" : list.join(",")}`
}

// Each way it repeats: the trigger it makes and what it says it will do.
type When = { days: ReadonlyArray<string>; time: string; date: string; day: number }
const REPEAT: Record<Repeat, { trigger: (w: When) => Trigger; summary: (w: When) => string }> = {
  weekly: {
    trigger: ({ days, time }) => ({ on: "schedule", cron: days.length ? weeklyCron(days, time) : "" }),
    summary: ({ days, time }) => (days.length ? t("newRoutine.summary.weekly", { days: listOf(days), time }) : t("newRoutine.pickDay"))
  },
  // The time as it was typed (24h, like the field), the date in the language's own words.
  once: { trigger: ({ date, time }) => ({ on: "once", date, time }), summary: ({ date, time }) => t("newRoutine.summary.once", { date: `${new Date(`${date}T${time}`).toLocaleDateString(locale(), { dateStyle: "medium" })}, ${time}` }) },
  monthly: { trigger: ({ day, time }) => ({ on: "monthly", day, time }), summary: ({ day, time }) => t("newRoutine.summary.monthly", { day, time }) },
  dayStart: { trigger: () => ({ on: "dayStart" }), summary: () => t("newRoutine.summary.dayStart") }
}
const REPEATS = Object.keys(REPEAT) as Repeat[]
const summaryOf = (starts: Starts, repeat: Repeat, w: When) => (starts === "time" ? REPEAT[repeat].summary(w) : t(`newRoutine.summary.${starts}`))

// The first steps: what starts it (its kind chosen in its card), one instruction to the agent, the end.
const FIRST: FlowGraph = layout({
  nodes: [
    { id: "trigger", kind: "trigger", x: 0, y: 0, config: { on: "manual" } },
    { id: "agent1", kind: "agent", x: 0, y: 0, config: { prompt: "" } },
    { id: "end1", kind: "end", x: 0, y: 0, config: {} }
  ],
  edges: [
    { id: "e1", from: "trigger", to: "agent1" },
    { id: "e2", from: "agent1", to: "end1" }
  ]
})
// Where "Add a step" at the foot of the list goes: after the last step of the main path (the "yes" path through a
// split), before its end.
function lastStep(g: FlowGraph): string {
  let at = "trigger"
  for (;;) {
    const next = g.edges.find((e) => e.from === at && (!e.branch || e.branch === "yes"))
    const node = g.nodes.find((n) => n.id === next?.to)
    if (!next || !node || node.kind === "end") return at
    at = node.id
  }
}

// The dialog's draft, per agent page (or the Routines page): kept while it's typed, cleared on Cancel and Create.
type Draft = { agentId: string; name: string; steps: FlowGraph; starts: Starts | null; repeat: Repeat; days: string[]; time: string; date: string; day: number; watch: Trigger; lookFirst: boolean; destinations: ConnectorDestination[] }
const draftKey = (agentId: string | undefined) => `zorel.draft.newRoutine.${agentId ?? "any"}`
function readDraft(agentId: string | undefined): Draft | undefined {
  const d = storedJson<Draft>(draftKey(agentId))
  return d?.steps ? d : undefined // a draft from before the steps (its own prompt field) starts over
}
const writeDraft = (agentId: string | undefined, d: Draft | undefined) => storeJson(draftKey(agentId), d)

type Props = { agent?: Agent | undefined; slot?: Slot | undefined; onDone: () => void }
export function NewRoutine(props: Props) {
  const [fresh, setFresh] = useState(0)
  const startOver = () => {
    writeDraft(props.agent?.id, undefined)
    setFresh((n) => n + 1)
  }
  return <RoutineForm key={fresh} {...props} onStartOver={startOver} />
}

function RoutineForm({ agent, slot, onDone, onStartOver }: Props & { onStartOver: () => void }) {
  const create = useMutation(mutations.createRoutine)
  const saveFlow = useMutation(mutations.saveFlow)
  const remove = useMutation(mutations.removeRoutine)
  const testNew = useMutation(mutations.testNewTrigger)
  const invalidate = useInvalidate()
  const agents = useList(agentsAtom)
  const servers = useList(serversAtom)
  const team = agents.filter((a) => isTeammate(a))
  // What was typed before leaving the dialog (a "Sign in again" in the tool picker goes to Settings) comes back.
  const [draft] = useState(() => (slot ? undefined : readDraft(agent?.id)))
  const [agentId, setAgentId] = useState(draft?.agentId ?? agent?.id ?? team[0]?.id ?? "")
  const who = agents.find((a) => a.id === agentId)
  const [name, setName] = useState(draft?.name ?? "")
  const [steps, setSteps] = useState<FlowGraph>(draft?.steps ?? FIRST)
  // A time slot picked on the week is a choice already made; otherwise nothing starts it until chosen.
  const [starts, setStarts] = useState<Starts | null>(slot ? "time" : (draft?.starts ?? null))
  const [repeat, setRepeat] = useState<Repeat>(draft?.repeat ?? "weekly")
  const [days, setDays] = useState<ReadonlyArray<string>>(slot ? [String(slot.weekday)] : (draft?.days ?? WEEKDAYS))
  const [time, setTime] = useState(slot ? hm(slot.minutes) : (draft?.time ?? "09:00"))
  const [date, setDate] = useState(draft?.date ?? tomorrow())
  const [day, setDay] = useState(draft?.day ?? 1)
  const [watch, setWatch] = useState<Trigger>(draft?.watch ?? { on: "watch" })
  const [lookFirst, setLookFirst] = useState(draft?.lookFirst ?? false)
  const [destinations, setDestinations] = useState<ReadonlyArray<ConnectorDestination>>(draft?.destinations ?? [])
  const restored = !!draft
  const [addingDestination, setAddingDestination] = useState(false)
  const [tried, setTried] = useState(false)
  // The one card open: "trigger", a step's id, or "result".
  const [open, setOpen] = useState<string | null>(slot ? "agent1" : "trigger")
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const typed = !!name || steps !== FIRST || starts !== null
  useEffect(() => {
    writeDraft(agent?.id, typed ? { agentId, name, steps, starts, repeat, days: [...days], time, date, day, watch, lookFirst, destinations: [...destinations] } : undefined)
  }, [agent?.id, typed, agentId, name, steps, starts, repeat, days, time, date, day, watch, lookFirst, destinations])
  const cancel = () => {
    writeDraft(agent?.id, undefined)
    onDone()
  }

  // What starts it, as the flow's trigger.
  const watching = starts === "arrives" || starts === "message"
  const when: When = { days, time, date, day }
  const trigger: Trigger =
    starts === "time" ? REPEAT[repeat].trigger(when) : watching ? { ...watch, on: starts === "message" ? "message" : "watch" } : starts === "script" ? { on: "webhook", lookFirst } : { on: "manual" }
  const graph: FlowGraph = { ...steps, nodes: steps.nodes.map((n) => (n.kind === "trigger" ? { ...n, config: trigger } : n)) }
  const checked = validateFlow(graph)
  const past = starts === "time" && repeat === "once" && new Date(`${date}T${time}`).getTime() <= Date.now()
  const field = !checked.ok && checked.nodeId === "trigger" ? checked.field : undefined
  const stepProblem = !checked.ok && checked.nodeId && checked.nodeId !== "trigger" ? checked : undefined
  const problemNode = steps.nodes.find((n) => n.id === stepProblem?.nodeId)
  // What's still missing, in order, each with the card it's in (pressing it opens that card).
  const checks: ReadonlyArray<{ at: string | null; missing: boolean; text: () => string }> = [
    { at: "result", missing: addingDestination, text: () => t("newRoutine.todo.destination") },
    { at: null, missing: !name.trim(), text: () => t("newRoutine.todo.name") },
    { at: null, missing: !agentId, text: () => t("newRoutine.todo.agent") },
    { at: "trigger", missing: starts === null, text: () => t("newRoutine.todo.starts") },
    { at: "trigger", missing: starts === "time" && repeat === "weekly" && !days.length, text: () => t("newRoutine.pickDay") },
    { at: "trigger", missing: past, text: () => t("newRoutine.past") },
    { at: "trigger", missing: starts !== null && !!field, text: () => t(`newRoutine.todo.${(watching && field && FIELD_TODO[field]) || "field"}`) },
    { at: stepProblem?.nodeId ?? null, missing: !!stepProblem, text: () => `${problemNode ? nodeTitle(problemNode) : ""}: ${missingOf(stepProblem?.field) ?? stepProblem?.problem ?? ""}` },
    { at: null, missing: !checked.ok && !stepProblem && !field, text: () => (checked.ok ? "" : checked.problem) }
  ]
  const first = checks.find((c) => c.missing)
  const todo = first?.text()
  const ready = !first
  // Nothing is "missing" on a dialog just opened: the warnings wait until something was typed or Create tried.
  const touched = tried || typed

  // The routine's own prompt (it names the chat and is the fallback text): the first instruction to the agent.
  const firstPrompt = orderOf(graph)
    .map((i) => i.node)
    .find((n): n is Extract<FlowNode, { kind: "agent" }> => n.kind === "agent" && !!n.config.prompt.trim())
  const submit = () => {
    setTried(true)
    if (!ready) return
    setBusy(true)
    setError(undefined)
    // The routine first (its chat, its delivery), then its steps as version 1: the trigger lives there.
    create({ payload: { agentId, name: name.trim(), prompt: (firstPrompt?.config.prompt ?? name).trim(), cron: null, webhook: false, ...(destinations.length > 0 && { delivery: { channels: ["notify"], connectors: [...destinations] } }) }, reactivityKeys: ["routines"] })
      .then((r) =>
        saveFlow({ params: { id: r.id }, payload: { graph, baseVersion: null }, reactivityKeys: ["routines"] }).then(
          () => {
            invalidate(["chats"])
            writeDraft(agent?.id, undefined)
            onDone()
          },
          (err: { message?: string }) => remove({ params: { id: r.id }, reactivityKeys: ["routines"] }).then(() => Promise.reject(err))
        )
      )
      .catch((err: { message?: string }) => setError(err?.message || t("routines.createFailed")))
      .finally(() => setBusy(false))
  }

  const toggle = (id: string) => setOpen((o) => (o === id ? null : id))
  const add = (from: string, kind: (typeof ADDABLE)[number], branch?: "yes" | "no") => {
    const next = insertAfter(steps, from, kind, branch)
    setSteps(next.graph)
    setOpen(next.id)
  }
  const flagged = (id: string) => touched && first?.at === id

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation() // a dialog's form: its submit must not reach a form around the page
        submit()
      }}
      onKeyDown={(e) => {
        // ⌘Enter / Ctrl+Enter creates from anywhere in the dialog.
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          submit()
        }
      }}
    >
      {/* Only the part between the head and the foot scrolls on a short window. */}
      <div className="-mx-6 flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 pb-6">
        {restored && (
          <p className="flex shrink-0 items-center gap-2 text-sm text-muted">
            <History className="size-4 shrink-0" />
            <span className="flex-1">{t("newRoutine.restored")}</span>
            <Button size="sm" variant="ghost" onPress={onStartOver}>
              {t("newRoutine.startOver")}
            </Button>
          </p>
        )}
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

        <section aria-label={t("newRoutine.steps")} className="flex flex-col gap-2">
          <h3 className="text-sm text-muted">{t("newRoutine.steps")}</h3>
          <ol className="flex flex-col">
            <Card
              id="trigger"
              open={open === "trigger"}
              onToggle={toggle}
              flagged={flagged("trigger")}
              tile={<KindTile kind="trigger" size="sm" />}
              title={t("newRoutine.starts")}
              detail={starts === null ? t("newRoutine.startsEmpty") : summaryOf(starts, repeat, when)}
              dim={starts === null}
              first
            >
              <ChoiceCards list label={t("newRoutine.starts")} value={starts} onChange={setStarts} options={STARTS.map((id) => ({ value: id, title: t(`newRoutine.start.${id}`), description: t(`newRoutine.startHint.${id}`), icon: START_ICON[id]() }))} />
              {/* At a time: how it repeats, on which days, at what time. */}
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
                  <WatchFields c={trigger} set={setWatch} agent={who} />
                  {watch.tool && <TestTrigger run={() => testNew({ payload: { agentId, prompt: (firstPrompt?.config.prompt ?? name).trim() || name || "-", trigger } })} />}
                </div>
              )}
              {starts === "script" && (
                <Switch isSelected={lookFirst} onChange={setLookFirst}>
                  {t("flows.panel.lookFirst")}
                </Switch>
              )}
            </Card>

            {orderOf(steps)
              .filter((i) => i.node.kind !== "trigger")
              .map(({ node, depth, branch }) => (
                <Card
                  key={node.id}
                  id={node.id}
                  depth={depth}
                  branch={branch}
                  open={open === node.id}
                  onToggle={node.kind === "end" ? undefined : toggle}
                  flagged={flagged(node.id)}
                  tile={<KindTile kind={node.kind} size="sm" />}
                  title={nodeTitle(node)}
                  detail={nodeDetail(node, servers)}
                  dim={node.kind === "end"}
                  actions={
                    <>
                      {node.kind !== "end" && <AddMenu label={t("flows.list.add")} paths={PORTS[node.kind].splits ? ["yes", "no"] : [undefined]} onAdd={(kind, path) => add(node.id, kind, path)} />}
                      {(node.kind !== "end" || depth > 0) && (
                        <IconButton label={t("flows.list.remove", { step: nodeTitle(node) })} onPress={() => setSteps(removeNode(steps, node.id))}>
                          <Trash2 />
                        </IconButton>
                      )}
                    </>
                  }
                >
                  {who && <StepFields node={node} graph={graph} agent={who} routineId={undefined} onChange={(n) => setSteps({ ...steps, nodes: steps.nodes.map((x) => (x.id === n.id ? n : x)) })} />}
                </Card>
              ))}
          </ol>
          <AddMenu
            label={t("newRoutine.addStep")}
            paths={[undefined]}
            onAdd={(kind) => add(lastStep(steps), kind)}
            trigger={
              <Button size="sm" variant="ghost" className="self-start">
                <Plus />
                {t("newRoutine.addStep")}
              </Button>
            }
          />
        </section>

        {who && (
          <ol className="flex flex-col">
            <Card
              id="result"
              open={open === "result"}
              onToggle={toggle}
              flagged={flagged("result")}
              tile={
                <IconTile size="sm">
                  <Bell />
                </IconTile>
              }
              title={t("newRoutine.resultTitle")}
              detail={[t("newRoutine.tellMe"), ...destinations.map((d) => d.tool)].join(" · ")}
              first
            >
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
            </Card>
          </ol>
        )}
      </div>

      {/* The foot: what will happen (or what's still missing, which opens its card), and the actions. */}
      <div className="-mx-6 flex shrink-0 flex-wrap items-center gap-3 border-t border-subtle px-6 pt-4">
        <p role="status" aria-live="polite" className={cn("flex min-w-0 flex-1 basis-60 items-center gap-2", todo ? (touched ? "text-warning" : "text-muted") : "text-secondary")}>
          {todo && touched ? <CircleAlert className="size-4 shrink-0" /> : <Clock className="size-4 shrink-0 text-muted" />}
          {first && touched && first.at && first.at !== open ? (
            <Button size="sm" variant="ghost" className="-ml-2 h-auto px-2 text-left text-warning underline underline-offset-2" onPress={() => setOpen(first.at)}>
              {todo}
            </Button>
          ) : (
            <span>{todo ?? [starts && summaryOf(starts, repeat, when), destinations.length > 0 && t("newRoutine.summary.posts", { tools: destinations.map((d) => d.tool).join(", ") })].filter(Boolean).join(" ")}</span>
          )}
          {ready && <span className="shrink-0 text-sm text-dim">{MAC ? "⌘↵" : "Ctrl ↵"}</span>}
        </p>
        {error && <p className="w-full text-sm text-danger">{error}</p>}
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onPress={cancel}>
            {t("common.cancel")}
          </Button>
          <Button variant="default" type="submit" isPending={busy} isDisabled={busy || (tried && !ready)}>
            {t("routines.create")}
          </Button>
        </div>
      </div>
    </form>
  )
}

// One card of the list: its head (a tile, what it is, one line about it) opens its fields below; a line joins it to
// the card above. A split's paths are indented, each tagged yes or no.
function Card({ id, open, onToggle, flagged, tile, title, detail, dim, depth = 0, branch, actions, first, children }: {
  id: string
  open: boolean
  onToggle: ((id: string) => void) | undefined
  flagged: boolean
  tile: ReactNode
  title: string
  detail: string
  dim?: boolean
  depth?: number
  branch?: "yes" | "no" | undefined
  actions?: ReactNode
  first?: boolean
  children?: ReactNode
}) {
  return (
    <li className={cn("flex flex-col", INDENT[Math.min(depth, INDENT.length - 1)])}>
      {!first && <span aria-hidden="true" className="ml-6 h-3 border-l border-subtle" />}
      <div className={cn("rounded-card border", flagged ? "border-warning" : open ? "border-strong" : "border-subtle")}>
        <div className="relative flex min-h-12 items-center gap-3 px-3 py-2">
          {onToggle && <RowHit label={title} expanded={open} onPress={() => onToggle(id)} className="inset-x-0 inset-y-0 rounded-card" />}
          {branch && (
            <span className="pointer-events-none relative">
              <Tag>{t(`flows.branch.${branch}`)}</Tag>
            </span>
          )}
          <span className="pointer-events-none relative">{tile}</span>
          <span className="pointer-events-none relative flex min-w-0 flex-1 flex-col">
            <span className={cn("truncate font-medium", dim && "text-muted")}>{title}</span>
            <span className={cn("truncate text-sm", flagged ? "text-warning" : "text-muted")}>{detail}</span>
          </span>
          {actions && <span className="relative flex shrink-0 items-center">{actions}</span>}
          {onToggle && <ChevronDown className={cn("pointer-events-none relative size-4 shrink-0 text-muted transition-transform duration-120 ease-out motion-reduce:transition-none", open && "rotate-180")} />}
        </div>
        {/* Opens and closes by height (the shared spring), so the cards below move with it instead of jumping. */}
        <Fold open={open && !!children}>
          <div className="flex flex-col gap-4 border-t border-subtle p-4">{children}</div>
        </Fold>
      </div>
    </li>
  )
}

// Adding a step: after this one, or on a split's yes or no path.
function AddMenu({ label, paths, onAdd, trigger }: { label: string; paths: ReadonlyArray<"yes" | "no" | undefined>; onAdd: (kind: (typeof ADDABLE)[number], path: "yes" | "no" | undefined) => void; trigger?: ReactNode }) {
  return (
    <Menu
      label={label}
      trigger={
        trigger ?? (
          <IconButton label={label}>
            <Plus />
          </IconButton>
        )
      }
    >
      {paths.map((path, i) => [
        i > 0 && <MenuSeparator key={`sep-${path}`} />,
        ...ADDABLE.filter((kind) => kind !== "end" || path).map((kind) => (
          <MenuItem key={`${path ?? "next"}-${kind}`} icon={kindIcon(kind)} onAction={() => onAdd(kind, path)}>
            {path ? t("flows.list.addOn", { kind: t(`flows.kind.${kind}`), path: t(`flows.branch.${path}`) }) : t(`flows.kind.${kind}`)}
          </MenuItem>
        ))
      ])}
    </Menu>
  )
}


// "Monday, Wednesday and Friday": the language's own list ("segunda, quarta e sexta").
const listOf = (days: ReadonlyArray<string>) =>
  days.length === 7 ? t("newRoutine.everyDayLower") : days.length === 5 && WEEKDAYS.every((d) => days.includes(d)) ? t("newRoutine.weekdaysLower") : new Intl.ListFormat(locale(), { type: "conjunction" }).format(ROW.filter((d) => days.includes(d)).map((d) => dayName(d, "long")))
