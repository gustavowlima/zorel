// The side panel of one flow step (spec 013): its settings by kind, a name, and removing it. The canvas and the List
// view both open it; it changes the node and nothing else.
import type { Agent, FlowGraph, FlowNode, TriggerTest } from "@zorel/contracts"
import { formatTime, t } from "@zorel/i18n"
import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import { type ReactNode, useState } from "react"
import { catalogAtom, mutations, serversAtom, useList, useMutation } from "../client.ts"
import { Badge, Button, ChevronLeft, CodeBlock, Plus, Rows, SettingRow, Field, IconButton, Input, Play, Segmented, Select, Switch, Textarea, Trash2, X } from "@/ui"
import { KindTile, nodeTitle } from "./flow-kinds.tsx"
import { earlierValues } from "./flow-model.ts"
import { SchemaForm } from "./schema-form.tsx"
import { samples } from "./schema-rules.ts"
import { type Picked, ToolPicker } from "./tool-picker.tsx"

type Of<K extends FlowNode["kind"]> = Extract<FlowNode, { kind: K }>
type PanelProps<K extends FlowNode["kind"]> = { node: Of<K>; graph: FlowGraph; agent: Agent; routineId: string; set: (config: Of<K>["config"]) => void }

export function StepPanel({ graph, node, agent, routineId, onChange, onRemove, onClose }: {
  graph: FlowGraph
  node: FlowNode
  agent: Agent
  routineId: string
  onChange: (node: FlowNode) => void
  onRemove: () => void
  onClose: () => void
}) {
  const Panel = PANELS[node.kind] as (p: PanelProps<FlowNode["kind"]>) => ReactNode
  return (
    <aside aria-label={nodeTitle(node)} className="flex w-full flex-col gap-5 overflow-auto border-subtle p-5 md:w-88 md:shrink-0 md:border-l">
      <div className="flex items-center gap-2.5">
        <KindTile kind={node.kind} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-semibold">{nodeTitle(node)}</span>
          <span className="text-sm text-dim">{t(`flows.kindHint.${node.kind}`)}</span>
        </span>
        <IconButton label={t("flows.panel.close")} onPress={onClose}>
          <X />
        </IconButton>
      </div>
      <Field label={t("flows.panel.label")}>
        <Input value={node.label ?? ""} placeholder={nodeTitle({ ...node, label: undefined } as FlowNode)} onChange={(e) => onChange({ ...node, label: e.target.value.slice(0, 80) || undefined } as FlowNode)} />
      </Field>
      <Panel node={node} graph={graph} agent={agent} routineId={routineId} set={(config) => onChange({ ...node, config } as FlowNode)} />
      {node.kind !== "trigger" && (
        <Button size="sm" variant="ghost" className="self-start text-danger" onPress={onRemove}>
          <Trash2 />
          {t("flows.panel.remove")}
        </Button>
      )}
    </aside>
  )
}

const ON = ["manual", "schedule", "once", "monthly", "dayStart", "watch", "message", "webhook"] as const
const EVERY = [1, 5, 15, 60] as const

const PANELS: { [K in FlowNode["kind"]]: (p: PanelProps<K>) => ReactNode } = {
  trigger: ({ node, graph, agent, routineId, set }) => {
    const testOf = useMutation(mutations.testTrigger)
    const c = node.config
    const watching = c.on === "watch" || c.on === "message"
    return (
      <>
        <Field label={t("flows.panel.when")}>
          <Select value={c.on} onChange={(on) => set({ on: on as (typeof ON)[number] })} options={ON.map((on) => ({ value: on, label: t(`flows.trigger.${on}`) }))} />
        </Field>
        {c.on === "schedule" && (
          <Field label={t("flows.panel.cron")} hint={t("flows.panel.cronHint")}>
            <Input className="font-mono" value={c.cron ?? ""} placeholder="0 9 * * 1-5" onChange={(e) => set({ ...c, cron: e.target.value })} />
          </Field>
        )}
        {c.on === "once" && (
          <Field label={t("flows.panel.date")}>
            <Input type="date" value={c.date ?? ""} onChange={(e) => set({ ...c, date: e.target.value || undefined })} />
          </Field>
        )}
        {c.on === "monthly" && (
          <Field label={t("flows.panel.day")} hint={t("flows.panel.dayHint")}>
            <Select value={String(c.day ?? "")} onChange={(v) => set({ ...c, day: Number(v) })} options={Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))} />
          </Field>
        )}
        {(c.on === "once" || c.on === "monthly") && (
          <Field label={t("flows.panel.time")}>
            <Input type="time" value={c.time ?? ""} onChange={(e) => set({ ...c, time: e.target.value || undefined })} />
          </Field>
        )}
        {watching && <WatchFields c={c} set={set} agent={agent} />}
        {(c.on === "dayStart" || c.on === "webhook" || c.on === "manual") && <p className="text-sm text-muted">{t(`flows.triggerHint.${c.on}`)}</p>}
        {c.on !== "dayStart" && c.on !== "webhook" && c.on !== "manual" && <TestTrigger run={() => testOf({ params: { id: routineId }, payload: { graph } })} />}
      </>
    )
  },

  tool: ({ node, graph, agent, routineId, set }) => {
    const c = node.config
    return (
      <>
        <ToolChoice
          agent={agent}
          serverId={c.serverId}
          tool={c.tool}
          args={c.args}
          sources={earlierValues(graph, node.id)}
          onTool={(p) => set({ ...c, serverId: p.server.id, tool: p.tool.name, args: {} })}
          onArgs={(args) => set({ ...c, args })}
        />
        {c.tool && (
          <>
            <Field label={t("flows.panel.retries")} hint={t("flows.panel.retriesHint")}>
              <Select value={String(c.retries ?? 1)} onChange={(v) => set({ ...c, retries: Number(v) })} options={[0, 1, 2, 3].map((n) => ({ value: String(n), label: t("flows.panel.retryCount", { count: n }) }))} />
            </Field>
            <TestStep routineId={routineId} graph={graph} nodeId={node.id} />
          </>
        )}
      </>
    )
  },

  agent: ({ node, agent, set }) => (
    <>
      <Field label={t("flows.panel.prompt")} hint={t("flows.panel.promptHint", { agent: agent.name })}>
        <Textarea rows={6} value={node.config.prompt} onChange={(e) => set({ prompt: e.target.value.slice(0, 8000) })} />
      </Field>
      <CanUse agent={agent} />
    </>
  ),

  check: ({ node, set }) => (
    <Field label={t("flows.panel.onlyWhen")} hint={t("flows.panel.onlyWhenHint")}>
      <Textarea rows={4} value={node.config.onlyWhen} onChange={(e) => set({ onlyWhen: e.target.value.slice(0, 2000) })} />
    </Field>
  ),

  condition: ({ node, graph, set }) => {
    const c = node.config
    const sources = earlierValues(graph, node.id)
    return (
      <>
        <Field label={t("flows.panel.rule")}>
          <Select value={c.rule} onChange={(rule) => set({ ...c, rule: rule as typeof c.rule })} options={(["hasItems", "isEmpty", "contains", "equals", "ask"] as const).map((r) => ({ value: r, label: t(`flows.rule.${r}`) }))} />
        </Field>
        <Field label={t("flows.panel.input")}>
          <Select
            value={c.input?.$from ?? ""}
            onChange={($from) => set({ ...c, ...($from ? { input: { $from } } : { input: undefined }) })}
            options={[...(c.rule === "ask" ? [{ value: "", label: t("flows.panel.stepBefore") }] : []), ...sources.map((n) => ({ value: n.id, label: nodeTitle(n) }))]}
          />
        </Field>
        {c.rule !== "hasItems" && c.rule !== "isEmpty" && (
          <Field label={c.rule === "ask" ? t("flows.panel.question") : t("flows.panel.text")}>
            {c.rule === "ask" ? <Textarea rows={3} value={c.arg ?? ""} onChange={(e) => set({ ...c, arg: e.target.value })} /> : <Input value={c.arg ?? ""} onChange={(e) => set({ ...c, arg: e.target.value })} />}
          </Field>
        )}
        {c.rule === "ask" && (
          <div className="flex flex-col gap-1.5 text-sm text-muted">
            {t("flows.panel.default")}
            <Segmented label={t("flows.panel.default")} value={c.defaultBranch} onChange={(defaultBranch) => set({ ...c, defaultBranch })} options={[{ id: "yes", label: t("flows.branch.yes") }, { id: "no", label: t("flows.branch.no") }]} />
          </div>
        )}
      </>
    )
  },

  approval: ({ node, set }) => (
    <>
      <Field label={t("flows.panel.ask")} hint={t("flows.panel.askHint")}>
        <Textarea rows={3} value={node.config.summary} onChange={(e) => set({ ...node.config, summary: e.target.value.slice(0, 500) })} />
      </Field>
      <Field label={t("flows.panel.expires")}>
        <Select value={String(node.config.expiresMinutes ?? 30)} onChange={(v) => set({ ...node.config, expiresMinutes: Number(v) })} options={[15, 30, 60, 240, 1440].map((m) => ({ value: String(m), label: t("flows.panel.minutes", { count: m }) }))} />
      </Field>
    </>
  ),

  end: () => <p className="text-sm text-muted">{t("flows.endHint")}</p>
}

// What the step's agent may reach: its connectors with the grant it has (the same rule the server applies).
function CanUse({ agent }: { agent: Agent }) {
  const servers = useList(serversAtom).filter((s) => s.enabled && (s.projectId === null || s.projectId === agent.projectId))
  const reach = servers.flatMap((s) => {
    const grant = agent.permissions?.grants[s.id] ?? (s.mode === "read" ? "read" : "write")
    return grant === "none" ? [] : [t(grant === "read" ? "flows.panel.readOnly" : "flows.panel.readWrite", { name: s.name })]
  })
  return (
    <Rows>
      <SettingRow title={t("flows.panel.agent")} hint={agent.name} />
      <SettingRow title={t("flows.panel.canUse")} hint={reach.length ? reach.join(", ") : t("flows.panel.noConnectors")} />
    </Rows>
  )
}

// More channels for a watch (FR-014, US4): the same tool read with other inputs, each its own form.
const MAX_MORE = 9
function OtherChannels({ agent, serverId, tool, more, onMore }: { agent: Agent; serverId: string; tool: string; more: ReadonlyArray<Record<string, unknown>>; onMore: (m: Array<Record<string, unknown>>) => void }) {
  return (
    <div className="flex flex-col gap-3">
      {more.map((args, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the channels are edited in place, never reordered
        <div key={i} className="flex flex-col gap-3 rounded-card border border-subtle p-3">
          <div className="flex items-center justify-between text-sm text-muted">
            {t("flows.panel.channel", { n: i + 2 })}
            <IconButton size="xs" label={t("flows.panel.removeChannel")} onPress={() => onMore(more.filter((_, j) => j !== i))}>
              <Trash2 />
            </IconButton>
          </div>
          <ToolInputs agent={agent} serverId={serverId} tool={tool} args={args} sources={[]} onArgs={(a) => onMore(more.map((x, j) => (j === i ? a : x)))} />
        </div>
      ))}
      {more.length < MAX_MORE && (
        <Button size="sm" variant="ghost" className="self-start" onPress={() => onMore([...more, {}])}>
          <Plus />
          {t("flows.panel.addChannel")}
        </Button>
      )}
    </div>
  )
}

// The tool of a step: picked from the connectors, then its inputs as a form.
function ToolChoice({ agent, readsOnly, serverId, tool, args, sources, onTool, onArgs }: {
  agent: Agent
  readsOnly?: boolean
  serverId: string
  tool: string
  args: Record<string, unknown>
  sources: ReadonlyArray<FlowNode>
  onTool: (p: Picked) => void
  onArgs: (args: Record<string, unknown>) => void
}) {
  // The picker opens in place, with its own way back: never a dialog over the dialog (New routine) or the panel.
  const [picking, setPicking] = useState(false)
  if (picking)
    return (
      <div className="flex flex-col gap-4">
        <Button size="sm" variant="ghost" className="-ml-2 self-start" onPress={() => setPicking(false)}>
          <ChevronLeft />
          {t("deliver.back")}
        </Button>
        <ToolPicker
          agent={agent}
          only={readsOnly ? "read" : undefined}
          onPick={(p) => {
            onTool(p)
            setPicking(false)
          }}
        />
      </div>
    )
  if (!tool)
    return (
      <div className="flex flex-col gap-2">
        <Button variant="secondary" className="self-start" onPress={() => setPicking(true)}>
          <Plus />
          {t("flows.pickTool")}
        </Button>
        {readsOnly && <span className="text-sm text-dim">{t("flows.pickWatchHint")}</span>}
      </div>
    )
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-sm">{tool}</span>
        <Button size="sm" variant="ghost" onPress={() => setPicking(true)}>
          {t("flows.panel.change")}
        </Button>
      </div>
      <ToolInputs agent={agent} serverId={serverId} tool={tool} args={args} sources={sources} onArgs={onArgs} />
    </>
  )
}

function ToolInputs({ agent, serverId, tool, args, sources, onArgs }: { agent: Agent; serverId: string; tool: string; args: Record<string, unknown>; sources: ReadonlyArray<FlowNode>; onArgs: (a: Record<string, unknown>) => void }) {
  const catalog = AsyncResult.getOrElse(useAtomValue(catalogAtom(serverId, agent.id)), () => undefined)
  const found = catalog?.tools.find((x) => x.name === tool)
  if (!catalog) return null
  if (!found) return <p className="text-sm text-danger">{t("flows.panel.toolGone", { tool })}</p>
  return <SchemaForm schema={found.inputSchema} value={args} onChange={onArgs} sources={sources} serverId={serverId} tools={catalog.tools} agentId={agent.id} />
}

type Trigger = Extract<FlowNode, { kind: "trigger" }>["config"]
// What a watch reads and how (spec 013): the connector's read tool and its inputs (as a form), other channels, the
// "only when" filter, how often, and the cheap check. The editor's trigger panel and New routine share it.
export function WatchFields({ c, set, agent }: { c: Trigger; set: (c: Trigger) => void; agent: Agent }) {
  return (
    <>
        {(
          <ToolChoice
            agent={agent}
            readsOnly
            serverId={c.serverId ?? ""}
            tool={c.tool ?? ""}
            args={c.args ?? {}}
            sources={[]}
            onTool={(p) => set({ ...c, serverId: p.server.id, tool: p.tool.name, args: {} })}
            onArgs={(args) => set({ ...c, args })}
          />
        )}
        {/* The rest only once there's a tool: what it reads decides what's worth setting. */}
        {c.tool && c.serverId && (
          <>
        <OtherChannels agent={agent} serverId={c.serverId} tool={c.tool} more={c.more ?? []} onMore={(more) => set({ ...c, more: more.length ? more : undefined })} />
        {(
          <Field label={t("flows.panel.filter")} hint={t("flows.panel.filterHint")}>
            <Input value={c.filter ?? ""} placeholder={t("flows.panel.filterPlaceholder")} onChange={(e) => set({ ...c, filter: e.target.value.slice(0, 500) || undefined })} />
          </Field>
        )}
        {(
          <Field label={t("flows.panel.every")} hint={t("flows.panel.everyHint")}>
            <Select value={String(c.every ?? 5)} onChange={(v) => set({ ...c, every: Number(v) as (typeof EVERY)[number] })} options={EVERY.map((m) => ({ value: String(m), label: t("flows.every", { count: m }) }))} />
          </Field>
        )}
        {(
          <Switch isSelected={!!c.lookFirst} onChange={(lookFirst) => set({ ...c, lookFirst })}>
            {t("flows.panel.lookFirst")}
          </Switch>
        )}
          </>
        )}
    </>
  )
}

// Test now for the trigger (FR-015): what it would find now. Nothing runs and nothing is marked seen.
const VERDICT_TONE = { runs: "accent", seen: "neutral", filtered: "neutral", "checked-out": "neutral" } as const
export function TestTrigger({ run }: { run: () => Promise<TriggerTest> }) {
  const [result, setResult] = useState<TriggerTest>()
  const [failed, setFailed] = useState(false)
  const [running, setRunning] = useState(false)
  return (
    <div className="flex flex-col gap-2">
      <Button
        size="sm"
        variant="secondary"
        className="self-start"
        isPending={running}
        onPress={() => {
          setRunning(true)
          setFailed(false)
          void run()
            .then(setResult)
            .catch(() => setFailed(true))
            .finally(() => setRunning(false))
        }}
      >
        <Play />
        {t("flows.panel.testTrigger")}
      </Button>
      {failed && <p className="text-sm text-danger">{t("flows.panel.testFailed")}</p>}
      {result?.note && <p className="text-sm text-muted">{result.note}</p>}
      {result?.first && <p className="text-sm text-muted">{t("flows.panel.firstLook")}</p>}
      {result && result.times.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {result.times.map((at) => (
            <li key={at} className="tabular-nums">
              {formatTime(at)}
            </li>
          ))}
        </ul>
      )}
      {result && !result.note && !result.times.length && !result.items.length && <p className="text-sm text-muted">{t("flows.panel.nothingFound")}</p>}
      {result?.items.map((item, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a test's items have no ids of their own, and the list never reorders
        <div key={i} className="flex items-start gap-2">
          <span className="min-w-0 flex-1 truncate font-mono text-sm text-muted">{item.preview}</span>
          <Badge tone={VERDICT_TONE[item.verdict]}>{t(`flows.verdict.${item.verdict}`)}</Badge>
        </div>
      ))}
    </div>
  )
}

// Test now (FR-008): the step alone, with what's set now. A write is never sent: the test shows what would be.
function TestStep({ routineId, graph, nodeId }: { routineId: string; graph: FlowGraph; nodeId: string }) {
  const test = useMutation(mutations.testStep)
  const [result, setResult] = useState<{ output: string; dry: boolean; error: string | null }>()
  const [running, setRunning] = useState(false)
  return (
    <div className="flex flex-col gap-2">
      <Button
        size="sm"
        variant="secondary"
        className="self-start"
        isPending={running}
        onPress={() => {
          setRunning(true)
          void test({ params: { id: routineId }, payload: { graph, nodeId } })
            .then((r) => {
              setResult(r)
              // What it gave: its fields are offered to the steps after it.
              if (!r.dry && !r.error)
                try {
                  samples.set(nodeId, JSON.parse(r.output))
                } catch {}
            })
            .catch(() => setResult({ output: "", dry: false, error: t("flows.panel.testFailed") }))
            .finally(() => setRunning(false))
        }}
      >
        <Play />
        {t("flows.panel.test")}
      </Button>
      {result?.error && <p className="text-sm text-danger">{result.error}</p>}
      {result?.dry && <p className="text-sm text-muted">{t("flows.panel.dry")}</p>}
      {result?.output && <CodeBlock code={result.output.slice(0, 4000)} />}
    </div>
  )
}
