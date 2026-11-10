// A tool's inputs as a form (spec 013, FR-006): drawn from the tool's own description of them. Text, numbers with
// their limits, choices, yes/no and lists get controls; anything deeper is JSON, checked as it's typed. Any field can
// take what an earlier step gave instead, and a field holding an id is picked by name when the same connector has a
// tool that lists them. The server checks the same description again on save and before calling.
import { type FlowNode, isRef, type JsonSchema, listToolFor, PORTS, type ValueRef } from "@zorel/contracts"
import { t } from "@zorel/i18n"
import { useState } from "react"
import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import { catalogAtom, mutations, useMutation } from "../client.ts"
import { Button, IconButton, Input, Link2, Select, Switch, Textarea, Tooltip, Unlink } from "@/ui"
import { nodeTitle } from "./flow-kinds.tsx"
import { kindOf, pathsFromSample, pathsFromSchema, type Prop, samples } from "./schema-rules.ts"
import { fieldProblem as problemOf } from "./schema-rules.ts"

type Args = Record<string, unknown>

export function SchemaForm({ schema, value, onChange, sources, serverId, tools, omit, agentId }: {
  schema: Record<string, unknown>
  value: Args
  onChange: (next: Args) => void
  sources: ReadonlyArray<FlowNode> // earlier steps that give a value
  serverId: string
  tools: ReadonlyArray<{ name: string; cls: string }>
  omit?: string // a field filled elsewhere (a destination's text)
  agentId?: string // whose view of the connectors names an earlier tool step's output fields
}) {
  const s = schema as JsonSchema
  const required = new Set(s.required ?? [])
  const fields = Object.entries(s.properties ?? {}).filter(([k]) => k !== omit)
  if (!fields.length) return <p className="text-sm text-muted">{t("flows.form.noInputs")}</p>
  const set = (k: string, v: unknown) => {
    const next = { ...value }
    if (v === undefined || v === "") delete next[k]
    else next[k] = v
    onChange(next)
  }
  return (
    <div className="flex flex-col gap-4">
      {fields.map(([k, prop]) => (
        <SchemaField key={k} name={k} prop={prop} required={required.has(k)} value={value[k]} onChange={(v) => set(k, v)} sources={sources} serverId={serverId} lister={listToolFor(k, tools)} agentId={agentId} />
      ))}
    </div>
  )
}

function SchemaField({ name, prop, required, value, onChange, sources, serverId, lister, agentId }: {
  name: string
  prop: Prop
  required: boolean
  value: unknown
  onChange: (v: unknown) => void
  sources: ReadonlyArray<FlowNode>
  serverId: string
  lister: string | undefined
  agentId: string | undefined
}) {
  const ref = isRef(value) ? value : undefined
  const problem = problemOf(prop, required, value)
  const label = prop.title ?? name
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-sm text-muted">
        <span className="min-w-0 flex-1 truncate">
          {label}
          {required && <span className="text-dim"> *</span>}
        </span>
        {sources.length > 0 && (
          <Tooltip content={ref ? t("flows.form.typeValue") : t("flows.form.fromStep")}>
            <IconButton size="xs" label={ref ? t("flows.form.typeValue") : t("flows.form.fromStep")} onPress={() => onChange(ref ? undefined : ({ $from: sources.at(-1)!.id } satisfies ValueRef))}>
              {ref ? <Unlink /> : <Link2 />}
            </IconButton>
          </Tooltip>
        )}
      </div>
      {ref ? <FromStep value={ref} onChange={onChange} sources={sources} agentId={agentId} /> : <Literal name={label} prop={prop} value={value} onChange={onChange} serverId={serverId} lister={lister} />}
      {prop.description && <span className="text-sm text-dim">{prop.description}</span>}
      {problem && <span className="text-sm text-danger">{problem}</span>}
    </div>
  )
}

export function FromStep({ value, onChange, sources, agentId }: { value: ValueRef; onChange: (v: ValueRef | undefined) => void; sources: ReadonlyArray<FlowNode>; agentId?: string | undefined }) {
  const source = sources.find((n) => n.id === value.$from)
  return (
    <div className="flex gap-2">
      <Select aria-label={t("flows.form.fromStep")} className="min-w-0 flex-1" value={value.$from} onChange={($from) => onChange({ $from })} options={sources.map((n) => ({ value: n.id, label: nodeTitle(n) }))} />
      {source && PORTS[source.kind].gives === "data" && <PathPick source={source} value={value} onChange={onChange} agentId={agentId} />}
    </div>
  )
}

// Which field of a data step: picked from its output's shape when known (its tool's outputSchema or its last test),
// else typed.
function PathPick({ source, value, onChange, agentId }: { source: FlowNode; value: ValueRef; onChange: (v: ValueRef) => void; agentId?: string | undefined }) {
  const tool = source.kind === "tool" ? source.config : undefined
  const catalog = AsyncResult.getOrElse(useAtomValue(catalogAtom(tool?.serverId ?? "", agentId ?? "")), () => undefined)
  const declared = tool && agentId ? catalog?.tools.find((x) => x.name === tool.tool)?.outputSchema : undefined
  const paths = [...new Set([...pathsFromSchema(declared), ...pathsFromSample(samples.get(source.id))])]
  const set = (path: string) => onChange({ $from: value.$from, ...(path.trim() && { path: path.trim() }) })
  if (!paths.length) return <Input aria-label={t("flows.form.path")} placeholder={t("flows.form.pathHint")} className="w-36" value={value.path ?? ""} onChange={(e) => set(e.target.value)} />
  return (
    <Select
      aria-label={t("flows.form.path")}
      className="w-44"
      value={value.path ?? ""}
      onChange={set}
      options={[{ value: "", label: t("flows.form.wholeValue") }, ...(value.path && !paths.includes(value.path) ? [value.path] : []).map((p) => ({ value: p, label: p })), ...paths.map((p) => ({ value: p, label: p }))]}
    />
  )
}

function Literal({ name, prop, value, onChange, serverId, lister }: { name: string; prop: Prop; value: unknown; onChange: (v: unknown) => void; serverId: string; lister: string | undefined }) {
  const kind = kindOf(prop)
  if (kind === "choice")
    return <Select aria-label={name} value={value === undefined ? "" : String(value)} onChange={(v) => onChange(prop.enum?.find((x) => String(x) === v) ?? v)} options={[{ value: "", label: t("flows.form.unset") }, ...(prop.enum ?? []).map((x) => ({ value: String(x), label: String(x) }))]} />
  if (kind === "boolean") return <Switch aria-label={name} isSelected={value === true} onChange={onChange} />
  if (kind === "number")
    return <Input aria-label={name} type="number" value={typeof value === "number" ? String(value) : ""} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} />
  if (kind === "list")
    return <Input aria-label={name} placeholder={t("flows.form.listHint")} value={Array.isArray(value) ? value.join(", ") : ""} onChange={(e) => onChange(listOf(e.target.value, prop.items?.type))} />
  if (kind === "json") return <JsonField name={name} value={value} onChange={onChange} />
  return lister ? <ByName name={name} value={value} onChange={onChange} serverId={serverId} tool={lister} /> : <Input aria-label={name} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} />
}

const listOf = (text: string, type: unknown) => {
  const items = text.split(",").map((x) => x.trim()).filter(Boolean)
  return items.length ? items.map((x) => (type === "string" ? x : Number(x))) : undefined
}

function JsonField({ name, value, onChange }: { name: string; value: unknown; onChange: (v: unknown) => void }) {
  const [text, setText] = useState(() => (value === undefined ? "" : JSON.stringify(value, null, 2)))
  const [bad, setBad] = useState(false)
  return (
    <>
      <Textarea
        aria-label={name}
        rows={4}
        className="font-mono text-sm"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          try {
            onChange(e.target.value.trim() ? JSON.parse(e.target.value) : undefined)
            setBad(false)
          } catch {
            setBad(true)
          }
        }}
      />
      {bad && <span className="text-sm text-danger">{t("flows.form.badJson")}</span>}
    </>
  )
}

// An id picked by name: the connector's own list, read when asked; the id is what's kept.
function ByName({ name, value, onChange, serverId, tool }: { name: string; value: unknown; onChange: (v: unknown) => void; serverId: string; tool: string }) {
  const load = useMutation(mutations.toolOptions)
  const [options, setOptions] = useState<ReadonlyArray<{ id: string; label: string }>>()
  const [failed, setFailed] = useState(false)
  const id = typeof value === "string" ? value : ""
  if (options?.length)
    return <Select aria-label={name} value={id} onChange={onChange} options={[...(id && !options.some((o) => o.id === id) ? [{ value: id, label: id }] : []), ...options.map((o) => ({ value: o.id, label: o.label }))]} />
  return (
    <div className="flex gap-2">
      <Input aria-label={name} className="min-w-0 flex-1" value={id} onChange={(e) => onChange(e.target.value)} />
      <Button
        size="sm"
        variant="secondary"
        onPress={() => {
          setFailed(false)
          void load({ params: { id: serverId }, payload: { tool, args: {} } })
            .then((list) => (list.length ? setOptions(list) : setFailed(true)))
            .catch(() => setFailed(true))
        }}
      >
        {t("flows.form.pick")}
      </Button>
      {failed && <span className="self-center text-sm text-dim">{t("flows.form.pickFailed")}</span>}
    </div>
  )
}
