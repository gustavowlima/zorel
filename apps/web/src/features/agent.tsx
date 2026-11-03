// Agent (prototype "Agent settings"): name, default model (with account and reasoning), role, and the tools
// its chats can reach. Without an id it creates one, in a project or global.
import type { Agent, FailoverTarget } from "@zero/contracts"
import { t } from "@zero/i18n"
import { useEffect, useState } from "react"
import { agentsAtom, mutations, projectsAtom, serversAtom, useList, useMutation } from "../client.ts"
import { agentTone } from "../labels.ts"
import { go } from "../state.ts"
import { FailoverEditor, useTermsPending } from "./failover.tsx"
import { type ModelChoice, ModelPicker } from "./model-picker.tsx"
import { AgentAvatar, Button, ConfirmDialog, Field, IconButton, Input, Menu, MenuItem, MoreHorizontal, Screen, Section, Textarea, Trash2 } from "@/ui"

const DEFAULT: ModelChoice = { model: "claude-cli/sonnet", accountId: null, effort: null }

export function AgentView({ agent, projectId }: { agent?: Agent; projectId: string | null }) {
  const agents = useList(agentsAtom)
  const projects = useList(projectsAtom)
  const servers = useList(serversAtom)
  const create = useMutation(mutations.createAgent)
  const update = useMutation(mutations.updateAgent)
  const remove = useMutation(mutations.removeAgent)
  const [name, setName] = useState(agent?.name ?? "")
  const [instructions, setInstructions] = useState(agent?.instructions ?? "")
  const [choice, setChoice] = useState<ModelChoice>(agent ? { model: agent.model, accountId: agent.accountId, effort: agent.effort } : DEFAULT)
  const [failover, setFailover] = useState<ReadonlyArray<FailoverTarget>>(agent?.failover ?? [])
  const termsPending = useTermsPending({ model: choice.model, accountId: choice.accountId }, failover)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setName(agent?.name ?? "")
    setInstructions(agent?.instructions ?? "")
    setChoice(agent ? { model: agent.model, accountId: agent.accountId, effort: agent.effort } : DEFAULT)
    setFailover(agent?.failover ?? [])
  }, [agent])

  const project = projects.find((p) => p.id === (agent?.projectId ?? projectId))
  const tools = servers.filter((s) => s.projectId === null || s.projectId === project?.id)
  const dirty =
    !agent ||
    name !== agent.name ||
    instructions !== agent.instructions ||
    choice.model !== agent.model ||
    choice.accountId !== agent.accountId ||
    choice.effort !== agent.effort ||
    JSON.stringify(failover) !== JSON.stringify(agent.failover)

  const save = () => {
    setBusy(true)
    const payload = { name: name.trim(), instructions, ...choice, failover }
    const done = agent
      ? update({ params: { id: agent.id }, payload, reactivityKeys: ["agents"] })
      : create({ payload: { ...payload, projectId: project?.id ?? null }, reactivityKeys: ["agents"] }).then((a) => go({ view: "agent", id: a.id }))
    void done.finally(() => setBusy(false))
  }

  return (
    <Screen
      title={
        <span className="flex items-center gap-3">
          {agent && <AgentAvatar id={agent.id} name={agent.name} tone={agentTone(agent, agents)} size={28} />}
          {agent?.name ?? t("agent.newTitle")}
        </span>
      }
      subtitle={project ? t("agent.of", { project: project.name }) : t("agent.globalHint")}
      actions={
        <>
          {agent && (
            <Menu
              label={t("common.more")}
              trigger={
                <IconButton label={t("common.more")}>
                  <MoreHorizontal />
                </IconButton>
              }
            >
              <MenuItem icon={<Trash2 />} tone="danger" onAction={() => setConfirm(true)}>
                {t("agent.deleteAction")}
              </MenuItem>
            </Menu>
          )}
          <Button variant="default" isPending={busy} isDisabled={!dirty || !name.trim() || busy || termsPending} onPress={save}>
            {agent ? t("common.save") : t("agent.create")}
          </Button>
        </>
      }
    >
      <form
        className="mx-auto flex w-full max-w-2xl flex-col gap-7 px-8 py-7"
        onSubmit={(e) => {
          e.preventDefault()
          if (dirty && name.trim() && !termsPending) save()
        }}
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label={t("agent.name")}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required {...(!agent && { autoFocus: true })} />
          </Field>
          <Field label={t("agent.model")} hint={t("agent.modelHint")}>
            <ModelPicker variant="field" value={choice} onChange={setChoice} />
          </Field>
        </div>
        <Field label={t("agent.role")} hint={t("agent.roleHint")}>
          <Textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={6} maxLength={8000} />
        </Field>
        <Section title={t("failover.title")} description={t("failover.intro")}>
          <FailoverEditor primary={{ model: choice.model, accountId: choice.accountId }} value={failover} onChange={setFailover} />
        </Section>
        <Section title={t("agent.tools")} description={t("agent.toolsHint")}>
          {tools.length === 0 ? (
            <p className="text-muted">{t("agent.noTools")}</p>
          ) : (
            <div className="flex flex-col divide-y divide-subtle border-y border-subtle">
              {tools.map((s) => (
                <div key={s.id} className="flex h-11 items-center gap-3">
                  <span className="min-w-0 flex-1 truncate">{s.name}</span>
                  <span className="text-sm text-muted">{s.enabled ? t(`mcp.modes.${s.mode}`) : t("mcp.off")}</span>
                </div>
              ))}
            </div>
          )}
        </Section>
      </form>
      {agent && (
        <ConfirmDialog
          isOpen={confirm}
          onOpenChange={setConfirm}
          title={t("agent.deleteTitle", { name: agent.name })}
          description={t("agent.deleteBody")}
          onConfirm={() =>
            void remove({ params: { id: agent.id }, reactivityKeys: ["agents", "chats", "memories"] }).then(() =>
              go(agent.projectId ? { view: "project", id: agent.projectId, tab: "agents" } : { view: "home" })
            )
          }
        />
      )}
    </Screen>
  )
}
