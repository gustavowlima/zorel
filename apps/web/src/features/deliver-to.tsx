// Sending a routine's result to a connector (spec 013, the Deliver board, FR-016): any write tool that takes text.
// The field that takes the result is found from the tool's inputs (or chosen when there are several); the other
// fields are filled like a step's (ids picked by name). Posting asks first, and nothing is posted when a run finds
// nothing new; the server checks the whole destination again on save.
import { type Agent, type ConnectorDestination, type JsonSchema, textFieldOf } from "@zorel/contracts"
import { t } from "@zorel/i18n"
import { useState } from "react"
import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import { catalogAtom, serversAtom, useList } from "../client.ts"
import { Button, Dialog, Field, IconButton, Plus, Rows, Select, SettingRow, Switch, Trash2 } from "@/ui"
import { SchemaForm } from "./schema-form.tsx"
import { type Picked, ToolPicker } from "./tool-picker.tsx"

export const MAX_DESTINATIONS = 3

export function ConnectorDestinations({ agent, value, onChange }: { agent: Agent; value: ReadonlyArray<ConnectorDestination>; onChange: (next: ConnectorDestination[]) => void }) {
  const servers = useList(serversAtom)
  const [adding, setAdding] = useState(false)
  return (
    <div className="flex flex-col gap-3">
      {value.length > 0 && (
        <Rows>
          {value.map((d, i) => (
            <SettingRow key={`${d.serverId}:${d.tool}:${d.textField}:${JSON.stringify(d.args)}`} title={`${servers.find((s) => s.id === d.serverId)?.name ?? t("flows.noConnector")} · ${d.tool}`} hint={t("deliver.into", { field: d.textField })}>
              <Switch isSelected={!!d.inThread} onChange={(inThread) => onChange(value.map((x, j) => (j === i ? { ...x, inThread } : x)))}>
                {t("deliver.inThread")}
              </Switch>
              <IconButton label={t("deliver.remove", { tool: d.tool })} onPress={() => onChange(value.filter((_, j) => j !== i))}>
                <Trash2 />
              </IconButton>
            </SettingRow>
          ))}
        </Rows>
      )}
      {value.length < MAX_DESTINATIONS && (
        <Button size="sm" variant="secondary" className="self-start" onPress={() => setAdding(true)}>
          <Plus />
          {t("deliver.add")}
        </Button>
      )}
      <p className="text-sm text-dim">{t("deliver.hint")}</p>
      <Dialog title={t("deliver.title")} size="lg" isOpen={adding} onOpenChange={setAdding}>
        {(close) => (
          <NewDestination
            agent={agent}
            onAdd={(d) => {
              onChange([...value, d])
              close()
            }}
          />
        )}
      </Dialog>
    </div>
  )
}

function NewDestination({ agent, onAdd }: { agent: Agent; onAdd: (d: ConnectorDestination) => void }) {
  const [picked, setPicked] = useState<Picked>()
  const [args, setArgs] = useState<Record<string, unknown>>({})
  const [field, setField] = useState<string>()
  if (!picked)
    return (
      <ToolPicker
        agent={agent}
        only="write"
        onPick={(p) => {
          setPicked(p)
          setField(textFieldOf(p.tool.inputSchema))
        }}
      />
    )
  const props = (picked.tool.inputSchema as JsonSchema).properties ?? {}
  const textFields = Object.entries(props).filter(([, p]) => p.type === "string").map(([k]) => k)
  const missing = ((picked.tool.inputSchema as JsonSchema).required ?? []).some((f) => f !== field && (args[f] === undefined || args[f] === ""))
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-sm">
          {picked.server.name} · {picked.tool.name}
        </span>
        <Button size="sm" variant="ghost" onPress={() => setPicked(undefined)}>
          {t("flows.panel.change")}
        </Button>
      </div>
      {textFields.length === 0 ? (
        <p className="text-sm text-danger">{t("deliver.noText")}</p>
      ) : (
        <Field label={t("deliver.field")} hint={t("deliver.fieldHint")}>
          <Select value={field ?? ""} placeholder={t("deliver.fieldPick")} onChange={setField} options={textFields.map((f) => ({ value: f, label: f }))} />
        </Field>
      )}
      {field && <Inputs agent={agent} picked={picked} field={field} args={args} onArgs={setArgs} />}
      {field && <p className="text-sm text-muted">{t("deliver.preview", { tool: picked.tool.name, field })}</p>}
      <div className="flex justify-end">
        <Button size="sm" isDisabled={!field || missing} onPress={() => field && onAdd({ serverId: picked.server.id, tool: picked.tool.name, args, textField: field })}>
          {t("deliver.addThis")}
        </Button>
      </div>
    </div>
  )
}

// The other inputs, with the connector's own tools at hand so an id is picked by name.
function Inputs({ agent, picked, field, args, onArgs }: { agent: Agent; picked: Picked; field: string; args: Record<string, unknown>; onArgs: (a: Record<string, unknown>) => void }) {
  const tools = AsyncResult.getOrElse(useAtomValue(catalogAtom(picked.server.id, agent.id)), () => undefined)?.tools ?? []
  return <SchemaForm schema={picked.tool.inputSchema} value={args} onChange={onArgs} sources={[]} serverId={picked.server.id} tools={tools} omit={field} />
}
