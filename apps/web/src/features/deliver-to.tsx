// Sending a routine's result to a connector (spec 013, the Deliver board, FR-016): any write tool that takes text.
// The field that takes the result is found from the tool's inputs (or chosen when there are several); the other
// fields are filled like a step's (ids picked by name). Posting asks first, and nothing is posted when a run finds
// nothing new; the server checks the whole destination again on save.
import { type Agent, type ConnectorDestination, type JsonSchema, textFieldOf } from "@zorel/contracts"
import { t } from "@zorel/i18n"
import { type ReactNode, useState } from "react"
import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import { catalogAtom, mutations, serversAtom, useList, useMutation } from "../client.ts"
import { Button, ChevronLeft, CodeBlock, Field, IconButton, Plus, Rows, Select, Send, SettingRow, Switch, Trash2 } from "@/ui"
import { SchemaForm } from "./schema-form.tsx"
import { ConnectorTool, type Picked } from "./tool-picker.tsx"

export const MAX_DESTINATIONS = 3

// lead: rows shown before the destinations in the same card (New routine: "Tell me here"). Adding one happens in
// place, as a step with its own way back, never as a dialog over the dialog.
// onAdding: told when a destination is being added (New routine holds Create until it's added or dropped).
export function ConnectorDestinations({ agent, routineId, value, onChange, lead, onAdding }: { agent: Agent; routineId?: string | undefined; value: ReadonlyArray<ConnectorDestination>; onChange: (next: ConnectorDestination[]) => void; lead?: ReactNode; onAdding?: (adding: boolean) => void }) {
  const servers = useList(serversAtom)
  const [adding, setAddingState] = useState(false)
  const setAdding = (v: boolean) => {
    setAddingState(v)
    onAdding?.(v)
  }
  if (adding)
    return (
      <div className="flex flex-col gap-4">
        <Button size="sm" variant="ghost" className="-ml-2 self-start" onPress={() => setAdding(false)}>
          <ChevronLeft />
          {t("deliver.back")}
        </Button>
        <NewDestination
          agent={agent}
          routineId={routineId}
          onAdd={(d) => {
            onChange([...value, d])
            setAdding(false)
          }}
        />
      </div>
    )
  return (
    <div className="flex flex-col gap-2">
      <Rows>
        {lead}
        {value.map((d, i) => (
          <SettingRow key={`${d.serverId}:${d.tool}:${d.textField}:${JSON.stringify(d.args)}`} icon={<Send />} title={`${servers.find((s) => s.id === d.serverId)?.name ?? t("flows.noConnector")} · ${d.tool}`} hint={t("deliver.into", { field: d.textField })}>
            <Switch isSelected={!!d.inThread} onChange={(inThread) => onChange(value.map((x, j) => (j === i ? { ...x, inThread } : x)))}>
              {t("deliver.inThread")}
            </Switch>
            <IconButton label={t("deliver.remove", { tool: d.tool })} onPress={() => onChange(value.filter((_, j) => j !== i))}>
              <Trash2 />
            </IconButton>
          </SettingRow>
        ))}
        {value.length < MAX_DESTINATIONS && (
          <SettingRow icon={<Plus />} title={t("deliver.add")} hint={t("deliver.addHint")}>
            <Button size="sm" variant="secondary" onPress={() => setAdding(true)}>
              {t("deliver.choose")}
            </Button>
          </SettingRow>
        )}
      </Rows>
      <p className="text-sm text-dim">{t("deliver.hint")}</p>
    </div>
  )
}

function NewDestination({ agent, routineId, onAdd }: { agent: Agent; routineId?: string | undefined; onAdd: (d: ConnectorDestination) => void }) {
  const test = useMutation(mutations.testDelivery)
  const [tested, setTested] = useState<{ output: string; error?: string }>()
  const [picked, setPicked] = useState<Picked>()
  const [args, setArgs] = useState<Record<string, unknown>>({})
  const [field, setField] = useState<string>()
  const choose = (p: Picked) => {
    setPicked(p)
    setArgs({})
    setField(p.tool.name ? textFieldOf(p.tool.inputSchema) : undefined)
  }
  if (!picked?.tool.name) return <ConnectorTool agent={agent} need="post" serverId={picked?.server.id ?? ""} tool="" onPick={choose} />
  const props = (picked.tool.inputSchema as JsonSchema).properties ?? {}
  const textFields = Object.entries(props).filter(([, p]) => p.type === "string").map(([k]) => k)
  const missing = ((picked.tool.inputSchema as JsonSchema).required ?? []).some((f) => f !== field && (args[f] === undefined || args[f] === ""))
  return (
    <div className="flex flex-col gap-4">
      <ConnectorTool agent={agent} need="post" serverId={picked.server.id} tool={picked.tool.name} onPick={choose} />
      {textFields.length === 0 ? (
        <p className="text-sm text-danger">{t("deliver.noText")}</p>
      ) : (
        <Field label={t("deliver.field")} hint={t("deliver.fieldHint")}>
          <Select value={field ?? ""} placeholder={t("deliver.fieldPick")} onChange={setField} options={textFields.map((f) => ({ value: f, label: f }))} />
        </Field>
      )}
      {field && <Inputs agent={agent} picked={picked} field={field} args={args} onArgs={setArgs} />}
      {field && <p className="text-sm text-muted">{t("deliver.preview", { tool: picked.tool.name, field })}</p>}
      {tested?.output && <CodeBlock code={tested.output} />}
      {tested?.error && <p className="text-sm text-danger">{tested.error}</p>}
      <div className="flex justify-end gap-2">
        {routineId && (
        <Button
          size="sm"
          variant="secondary"
          isDisabled={!field || missing}
          onPress={() =>
            field &&
            void test({ params: { id: routineId }, payload: { serverId: picked.server.id, tool: picked.tool.name, args, textField: field } })
              .then((r) => setTested({ output: r.output }))
              .catch((e: { message?: string }) => setTested({ output: "", error: e?.message || t("flows.panel.testFailed") }))
          }
        >
          {t("deliver.test")}
        </Button>
        )}
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
