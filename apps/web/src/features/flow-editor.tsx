// A routine's steps (spec 013): one graph, shown as a list (branches indented), a step's panel beside it, saved as a new
// version. The contract's validateFlow runs as the person edits, so what the server would refuse shows (and names
// the step) before Save; the server checks again, with the connectors' own tool descriptions.
import { type FlowGraph, validateFlow } from "@zorel/contracts"
import { t } from "@zorel/i18n"
import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import { useState } from "react"
import { agentsAtom, mutations, routineFlowAtom, routinesAtom, useInvalidate, useList, useMutation, useReading } from "../client.ts"
import { go, storedJson, storeJson } from "../state.ts"
import { ArrowLeft, Button, CircleAlert, cn, Drawer, History, Column, EmptyState, IconButton, Notice, Screen, Spinner } from "@/ui"
import { FlowList } from "./flow-list.tsx"
import { StepPanel } from "./flow-panel.tsx"
import { removeNode } from "./flow-model.ts"

// What a required field left empty means, in words (the contract names the field).
const MISSING: Record<string, () => string> = {
  serverId: () => t("flows.missing.tool"),
  tool: () => t("flows.missing.tool"),
  prompt: () => t("flows.missing.prompt"),
  cron: () => t("flows.missing.cron"),
  onlyWhen: () => t("flows.missing.onlyWhen"),
  input: () => t("flows.missing.input"),
  arg: () => t("flows.missing.arg"),
  summary: () => t("flows.missing.summary"),
  date: () => t("flows.missing.date"),
  day: () => t("flows.missing.day"),
  time: () => t("flows.missing.time")
}
export const missingOf = (field: string | undefined) => (field ? MISSING[field]?.() : undefined)

// Unsaved steps survive leaving the page (as the agent page's drafts do): kept per routine with the version they
// were made on, and offered back only on that version.
type Draft = { base: number | null; graph: FlowGraph }
const draftKey = (id: string) => `zorel.draft.flow.${id}`


export function FlowEditorView({ routineId }: { routineId: string }) {
  const routine = useReading(routinesAtom).items.find((r) => r.id === routineId)
  const agent = useList(agentsAtom).find((a) => a.id === routine?.agentId)
  const loaded = AsyncResult.getOrElse(useAtomValue(routineFlowAtom(routineId)), () => undefined)
  if (!routine || !agent || !loaded)
    return (
      <Screen title={t("flows.title")}>
        <Column>{loaded === undefined ? <Spinner /> : <EmptyState title={t("notFound.title")} />}</Column>
      </Screen>
    )
  return <Editor key={`${routineId}:${loaded.version ?? 0}`} routineId={routineId} name={routine.name} agent={agent} initial={loaded.graph} version={loaded.version} />
}

function Editor({ routineId, name, agent, initial, version: initialVersion }: { routineId: string; name: string; agent: Parameters<typeof StepPanel>[0]["agent"]; initial: FlowGraph; version: number | null }) {
  const save = useMutation(mutations.saveFlow)
  const invalidate = useInvalidate()
  const [draft] = useState(() => {
    const d = storedJson<Draft>(draftKey(routineId))
    return d && d.base === initialVersion ? d : undefined
  })
  const [graph, setGraph] = useState(draft?.graph ?? initial)
  const [version, setVersion] = useState(initialVersion)
  const [dirty, setDirty] = useState(!!draft)
  const [restored, setRestored] = useState(!!draft)
  const [selected, setSelected] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<{ message: string; nodeId?: string | undefined; conflict?: boolean }>()
  const edit = (g: FlowGraph) => {
    setGraph(g)
    setDirty(true)
    setFailure(undefined)
    storeJson(draftKey(routineId), { base: version, graph: g })
  }
  const discard = () => {
    storeJson(draftKey(routineId), undefined)
    setGraph(initial)
    setDirty(false)
    setRestored(false)
  }
  const checked = validateFlow(graph)
  const problem = checked.ok ? undefined : { ...checked, problem: missingOf(checked.field) ?? checked.problem }
  const node = graph.nodes.find((n) => n.id === selected)
  const onSave = () => {
    setSaving(true)
    void save({ params: { id: routineId }, payload: { graph, baseVersion: version }, reactivityKeys: ["routines"] })
      .then((r) => {
        setVersion(r.version)
        setDirty(false)
        setRestored(false)
        storeJson(draftKey(routineId), undefined)
        invalidate(["routines"])
      })
      .catch((e: { _tag?: string; message?: string; nodeId?: string }) => {
        if (e?._tag === "FlowInvalid") {
          setFailure({ message: e.message ?? t("flows.saveFailed"), nodeId: e.nodeId })
          if (e.nodeId) setSelected(e.nodeId)
        } else setFailure({ message: e?._tag === "FlowConflict" ? t("flows.conflict") : t("flows.saveFailed"), conflict: e?._tag === "FlowConflict" })
      })
      .finally(() => setSaving(false))
  }
  // The one step with something to fix (what the server refused, else what the flow still misses): shown on it.
  const issue = failure?.nodeId ? { nodeId: failure.nodeId, message: failure.message } : dirty && problem?.nodeId ? { nodeId: problem.nodeId, message: problem.problem } : undefined
  return (
    <Screen
      title={
        <span className="flex items-center gap-2">
          <IconButton label={t("flows.back")} onPress={() => go({ view: "routines" })}>
            <ArrowLeft />
          </IconButton>
          {name}
        </span>
      }
      subtitle={dirty ? t("flows.unsaved") : version ? t("flows.savedVersion", { n: version }) : t("flows.notSaved")}
      actions={
        <Button size="sm" variant="default" isPending={saving} isDisabled={!dirty || !!problem} onPress={onSave}>
          {t("common.save")}
        </Button>
      }
      bodyClassName="flex flex-col md:flex-row"
    >
      {/* On a phone an open step takes the screen; its close button brings the steps back. */}
      <div className={cn("min-h-0 min-w-0 flex-1 flex-col", node ? "hidden md:flex" : "flex")}>
        {restored && (
          <div className="px-4 pt-4">
            <Notice
              tone="neutral"
              icon={<History />}
              title={t("flows.restored")}
              action={
                <Button size="sm" variant="secondary" onPress={discard}>
                  {t("flows.discard")}
                </Button>
              }
            />
          </div>
        )}
        {/* Only what belongs to no step (a newer version saved elsewhere, the server's own refusal) is a notice here;
            a step's problem shows on the step itself. */}
        {(failure ? !failure.nodeId : dirty && problem && !problem.nodeId) && (
          <div className="px-4 pt-4">
            <Notice
              icon={<CircleAlert />}
              title={failure ? failure.message : problem?.problem}
              action={
                failure?.conflict && (
                  <Button size="sm" variant="secondary" onPress={() => invalidate(["routines"])}>
                    {t("flows.reload")}
                  </Button>
                )
              }
            />
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-auto p-4 md:p-7">
          <div className="mx-auto max-w-3xl">
            <FlowList graph={graph} onGraph={edit} selected={selected} onSelect={setSelected} issue={issue} />
          </div>
        </div>
      </div>
      {/* A step's panel slides in beside the steps (on a phone it takes the screen, as before). */}
      <Drawer open={!!node} className="flex min-h-0 overflow-hidden md:shrink-0">
        {node && (
        <StepPanel
          key={node.id}
          graph={graph}
          node={node}
          agent={agent}
          routineId={routineId}
          onChange={(n) => edit({ ...graph, nodes: graph.nodes.map((x) => (x.id === n.id ? n : x)) })}
          onRemove={() => {
            edit(removeNode(graph, node.id))
            setSelected(undefined)
          }}
          onClose={() => setSelected(undefined)}
        />
        )}
      </Drawer>
    </Screen>
  )
}
