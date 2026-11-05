// Agents: the whole team in one place — the global agents, then each project's — with who is working now, and
// one "New agent" menu (Build with AI, blank, import). A row opens the agent's page; its ⋯ exports or deletes it. Agents can also be created or changed from a chat (zorel_create_agent,
// zorel_update_agent): they show up here once the person approves the proposal.
import type { Agent } from "@zorel/contracts"
import { t } from "@zorel/i18n"
import { useState } from "react"
import { agentsAtom, mutations, projectsAtom, useList, useMutation, useStatuses } from "../client.ts"
import { exportAgent, importedAgent } from "./agent.tsx"
import { agentTone, modelLabel } from "../labels.ts"
import { go } from "../state.ts"
import { AgentAvatar, Bot, Button, ChevronDown, ChevronRight, ConfirmDialog, Dot, Download, EmptyState, IconButton, Menu, MenuItem, MenuSeparator, MoreHorizontal, Pencil, pickFiles, Plus, RowHit, Screen, Section, Sparkles, Tag, Trash2, Upload } from "@/ui"

// The agents working now (a chat of theirs is running or waiting).
export function useWorking() {
  const statuses = useStatuses()
  return new Set(Object.values(statuses).flatMap((s) => (s.state !== "idle" && s.agentId ? [s.agentId] : [])))
}

// One agent: avatar, name (and "working" while a chat of theirs runs), its role, its model; pressing opens its page.
// The ⋯ menu (shown on hover or focus) opens, exports or deletes it.
export function AgentRow({ agent, agents, working, onDelete }: { agent: Agent; agents: ReadonlyArray<Agent>; working: boolean; onDelete?: (a: Agent) => void }) {
  const line = agent.title || agent.description || agent.instructions.trim().split("\n")[0]
  return (
    <div className="group/row relative flex items-center">
      <Button variant="ghost" className="h-14 min-w-0 flex-1 justify-start gap-3 rounded-none px-1 pr-11 font-normal text-fg" onPress={() => go({ view: "agent", id: agent.id })}>
        <AgentAvatar id={agent.id} name={agent.name} tone={agentTone(agent, agents)} size={28} />
        <span className="flex min-w-0 flex-1 flex-col text-left">
          <span className="flex items-center gap-2 truncate font-medium">
            {agent.name}
            {working && (
              <span className="inline-flex items-center gap-1 text-sm font-normal text-accent-text">
                <Dot tone="accent" />
                {t("agents.working")}
              </span>
            )}
          </span>
          {line && <span className="truncate text-sm text-muted">{line}</span>}
        </span>
        <span className="shrink-0 text-sm text-muted">{modelLabel(agent.model)}</span>
      </Button>
      <span className="absolute right-1 opacity-0 transition-opacity duration-120 group-focus-within/row:opacity-100 group-hover/row:opacity-100 motion-reduce:transition-none">
        <Menu
          label={t("agents.actions", { name: agent.name })}
          trigger={
            <IconButton label={t("agents.actions", { name: agent.name })}>
              <MoreHorizontal />
            </IconButton>
          }
        >
          <MenuItem icon={<ChevronRight />} onAction={() => go({ view: "agent", id: agent.id })}>
            {t("agents.open")}
          </MenuItem>
          <MenuItem icon={<Download />} onAction={() => exportAgent(agent)}>
            {t("agent.export")}
          </MenuItem>
          {onDelete && (
            <>
              <MenuSeparator />
              <MenuItem icon={<Trash2 />} tone="danger" onAction={() => onDelete(agent)}>
                {t("agent.deleteAction")}
              </MenuItem>
            </>
          )}
        </Menu>
      </span>
    </div>
  )
}

// One agent as a card (the Agents screen, like the Builder's review): face, name (and "working"), role, what it does,
// how it runs. The whole card opens its page; the ⋯ menu sits on top of it.
export function AgentCard({ agent, agents, working, onDelete }: { agent: Agent; agents: ReadonlyArray<Agent>; working: boolean; onDelete: (a: Agent) => void }) {
  return (
    <article className="relative flex flex-col gap-3 rounded-card border border-subtle p-4 transition-colors duration-120 hover:border-strong motion-reduce:transition-none">
      <RowHit label={t("agents.open") + ": " + agent.name} onPress={() => go({ view: "agent", id: agent.id })} className="inset-0 rounded-card data-hovered:bg-transparent" />
      <div className="pointer-events-none relative flex items-center gap-3 pr-8">
        <AgentAvatar id={agent.id} name={agent.name} tone={agentTone(agent, agents)} size={40} />
        <span className="flex min-w-0 flex-col">
          <span className="flex items-center gap-2 truncate font-medium">
            {agent.name}
            {working && (
              <span className="inline-flex items-center gap-1 text-sm font-normal text-accent-text">
                <Dot tone="accent" />
                {t("agents.working")}
              </span>
            )}
          </span>
          {agent.title && <span className="truncate text-sm text-muted">{agent.title}</span>}
        </span>
      </div>
      {agent.description && <p className="pointer-events-none relative line-clamp-2 text-secondary">{agent.description}</p>}
      <div className="pointer-events-none relative mt-auto flex flex-wrap gap-1.5">
        <Tag hint={t("builder.runsOnHint")}>{t("builder.runsOn", { model: modelLabel(agent.model) })}</Tag>
        {agent.failover.length > 0 && <Tag hint={t("builder.fallbacksHint")}>{t("builder.fallbacks", { count: agent.failover.length })}</Tag>}
        <Tag hint={t(`access.${agent.access}Hint`)}>{t("builder.accessIs", { access: t(`access.${agent.access}`) })}</Tag>
      </div>
      <span className="absolute top-3 right-3">
        <Menu
          label={t("agents.actions", { name: agent.name })}
          trigger={
            <IconButton label={t("agents.actions", { name: agent.name })}>
              <MoreHorizontal />
            </IconButton>
          }
        >
          <MenuItem icon={<ChevronRight />} onAction={() => go({ view: "agent", id: agent.id })}>
            {t("agents.open")}
          </MenuItem>
          <MenuItem icon={<Download />} onAction={() => exportAgent(agent)}>
            {t("agent.export")}
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={<Trash2 />} tone="danger" onAction={() => onDelete(agent)}>
            {t("agent.deleteAction")}
          </MenuItem>
        </Menu>
      </span>
    </article>
  )
}

// Deleting from a list: one confirm for the screen (the agent's own page has the same).
export function useDeleteAgent() {
  const remove = useMutation(mutations.removeAgent)
  const [target, setTarget] = useState<Agent>()
  const dialog = (
    <ConfirmDialog
      isOpen={!!target}
      onOpenChange={(o) => !o && setTarget(undefined)}
      title={t("agent.deleteTitle", { name: target?.name ?? "" })}
      description={t("agent.deleteBody")}
      onConfirm={() => target && void remove({ params: { id: target.id }, reactivityKeys: ["agents", "chats", "memories"] })}
    />
  )
  return { ask: setTarget, dialog }
}

// "New agent": one button, three ways — describe it to the Builder (its own screen), start from a blank form, or
// bring a file exported from Zorel. In a project, the agent is that project's.
export function NewAgentMenu({ projectId = null, projectName, compact }: { projectId?: string | null; projectName?: string; compact?: boolean }) {
  const create = useMutation(mutations.createAgent)
  const [error, setError] = useState<string>()
  const label = projectName ? t("nav.newAgentIn", { name: projectName }) : t("nav.newAgent")
  const importFile = () =>
    void pickFiles({ accept: ".json,application/json" })
      .then(([file]) => file?.text())
      .then((text) => (text ? create({ payload: importedAgent(text, projectId), reactivityKeys: ["agents"] }).then((a) => go({ view: "agent", id: a.id })) : undefined))
      .catch((err: unknown) => setError(err instanceof Error && err.message ? err.message : t("agent.importFailed")))
  return (
    <span className="flex items-center gap-2">
      {error && <span className="text-sm text-danger">{error}</span>}
      <Menu
        label={label}
        trigger={
          compact ? (
            <IconButton label={label} size="xs">
              <Plus className="size-3.5" />
            </IconButton>
          ) : (
            <Button size="sm" variant="default">
              <Plus />
              {t("nav.newAgent")}
              <ChevronDown className="-mr-0.5 size-3.5 opacity-80" />
            </Button>
          )
        }
      >
        <MenuItem icon={<Sparkles />} onAction={() => go({ view: "builder", projectId })}>
          {t("agents.withAi")}
        </MenuItem>
        <MenuItem icon={<Pencil />} onAction={() => go({ view: "new-agent", projectId })}>
          {t("agents.blank")}
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          icon={<Upload />}
          onAction={() => {
            setError(undefined)
            importFile()
          }}
        >
          {t("agents.importFile")}
        </MenuItem>
      </Menu>
    </span>
  )
}

export function AgentsView() {
  const agents = useList(agentsAtom)
  const projects = useList(projectsAtom)
  const working = useWorking()
  const del = useDeleteAgent()
  const groups = [
    { id: null as string | null, name: t("agents.global"), hint: t("agents.globalHint") },
    ...projects.map((p) => ({ id: p.id as string | null, name: p.name, hint: undefined as string | undefined }))
  ].map((g) => ({ ...g, list: agents.filter((a) => !a.builtin && a.projectId === g.id) }))
  const team = agents.filter((a) => !a.builtin)
  return (
    <Screen title={t("agents.title")} subtitle={t("agents.subtitle")} actions={<NewAgentMenu />}>
      {/* Wider than a settings column: the agents are cards, two per row. */}
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-8 py-8">
        {team.length === 0 ? (
          <EmptyState
            icon={<Bot />}
            title={t("agents.empty")}
            hint={t("agents.emptyHint")}
            action={
              <Button size="sm" variant="default" onPress={() => go({ view: "builder", projectId: null })}>
                <Sparkles />
                {t("agents.withAi")}
              </Button>
            }
          />
        ) : (
          groups
            .filter((g) => g.list.length > 0)
            .map((g) => (
              <Section key={g.id ?? "global"} title={g.name} description={g.hint} action={g.id ? <NewAgentMenu projectId={g.id} projectName={g.name} compact /> : undefined}>
                <div className="grid gap-3 lg:grid-cols-2">
                  {g.list.map((a) => (
                    <AgentCard key={a.id} agent={a} agents={agents} working={working.has(a.id)} onDelete={del.ask} />
                  ))}
                </div>
              </Section>
            ))
        )}
      </div>
      {del.dialog}
    </Screen>
  )
}
