// Agents: the whole team in one place — the global agents, then each project's, as groups of rows with a count (and a
// search once the team is long) — with who is working now, and one "New agent" menu (Build with AI, blank, import).
// A row opens the agent's page; its ⋯ exports or deletes it. Agents can also be created or changed from a chat
// (zorel_create_agent, zorel_update_agent): they show up here once the person approves the proposal.
import { type Agent, isTeammate } from "@zorel/contracts"
import { t } from "@zorel/i18n"
import { useState } from "react"
import { agentsAtom, mutations, projectsAtom, useList, useMutation, useStatuses } from "../client.ts"
import { exportAgent, importedAgent } from "./agent.tsx"
import { agentTone, modelLabel } from "../labels.ts"
import { go } from "../state.ts"
import { AgentAvatar, Archive, ArchiveRestore, Bot, Button, ChevronDown, ChevronRight, Column, ConfirmDialog, Dot, Download, EmptyState, IconButton, ListRow, Menu, MenuItem, MenuSeparator, MoreHorizontal, Pencil, pickFiles, Plus, Rows, Screen, SearchInput, Section, Sparkles, Tag, Trash2, Upload } from "@/ui"

// The agents working now (a chat of theirs is running or waiting).
export function useWorking() {
  const statuses = useStatuses()
  return new Set(Object.values(statuses).flatMap((s) => (s.state !== "idle" && s.agentId ? [s.agentId] : [])))
}

// One agent as a row of a group (the Agents screen, a project's Agents tab): face, name (and "working" while a chat of
// theirs runs), their title, the model on the right; tags only for what differs from the default (fallbacks, an
// access other than Workspace), so a long team stays scannable. The row opens the agent; ⋯ opens, exports or deletes.
export function AgentItem({ agent, agents, working, onDelete }: { agent: Agent; agents: ReadonlyArray<Agent>; working: boolean; onDelete: (a: Agent) => void }) {
  const line = agent.title || agent.description || agent.instructions.trim().split("\n")[0]
  const archive = useArchive()
  return (
    <ListRow
      label={`${t("agents.open")}: ${agent.name}`}
      onPress={() => go({ view: "agent", id: agent.id })}
      icon={<AgentAvatar id={agent.id} name={agent.name} tone={agentTone(agent, agents)} size={28} />}
      title={
        <span className="flex items-center gap-2">
          <span className="truncate">{agent.name}</span>
          {working && (
            <span className="inline-flex shrink-0 items-center gap-1 text-sm font-normal text-accent-text">
              <Dot tone="accent" />
              {t("agents.working")}
            </span>
          )}
        </span>
      }
      {...(line && { hint: line })}
      aside={
        <span className="flex items-center gap-1.5">
          {agent.failover.length > 0 && <Tag hint={t("builder.fallbacksHint")}>{t("builder.fallbacks", { count: agent.failover.length })}</Tag>}
          {agent.access !== "workspace" && <Tag hint={t(`access.${agent.access}Hint`)}>{t("builder.accessIs", { access: t(`access.${agent.access}`) })}</Tag>}
          <span className="hidden truncate sm:inline">{modelLabel(agent.model)}</span>
        </span>
      }
      trailing={
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
          <MenuItem icon={agent.archivedAt ? <ArchiveRestore /> : <Archive />} onAction={() => archive(agent, !agent.archivedAt)}>
            {agent.archivedAt ? t("agent.restoreArchived") : t("agent.archive")}
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={<Trash2 />} tone="danger" onAction={() => onDelete(agent)}>
            {t("agent.deleteAction")}
          </MenuItem>
        </Menu>
      }
    />
  )
}

// Archiving keeps an agent and its history but takes it off the team: it answers no one and runs no routine.
export function useArchive() {
  const update = useMutation(mutations.updateAgent)
  return (agent: Agent, archived: boolean) => void update({ params: { id: agent.id }, payload: { archived }, reactivityKeys: ["agents"] })
}

// A team past this many gets a search field (the same threshold as every long list).
export const SEARCH_AT = 8
export const agentMatches = (a: Agent, q: string) => !q || `${a.name} ${a.title} ${a.description}`.toLowerCase().includes(q)

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
  const [query, setQuery] = useState("")
  const q = query.trim().toLowerCase()
  const team = agents.filter(isTeammate)
  const archived = agents.filter((a) => !a.builtin && a.archivedAt && agentMatches(a, q))
  const [showArchived, setShowArchived] = useState(false)
  const groups = [
    { id: null as string | null, name: t("agents.global"), hint: t("agents.globalHint") },
    ...projects.map((p) => ({ id: p.id as string | null, name: p.name, hint: undefined as string | undefined }))
  ].map((g) => ({ ...g, list: team.filter((a) => a.projectId === g.id && agentMatches(a, q)) }))
  const shown = groups.filter((g) => g.list.length > 0)
  return (
    <Screen
      title={t("agents.title")}
      subtitle={t("agents.subtitle")}
      actions={
        <>
          {team.length > SEARCH_AT && (
            <SearchInput size="sm" className="w-56" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("agents.search")} aria-label={t("agents.search")} />
          )}
          <NewAgentMenu />
        </>
      }
    >
      <Column className="gap-10">
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
        ) : shown.length === 0 ? (
          <p className="text-muted">{t("agents.noMatch")}</p>
        ) : (
          shown.map((g) => (
            <Section key={g.id ?? "global"} title={`${g.name} · ${g.list.length}`} description={g.hint} action={g.id ? <NewAgentMenu projectId={g.id} projectName={g.name} compact /> : undefined}>
              <Rows>
                {g.list.map((a) => (
                  <AgentItem key={a.id} agent={a} agents={agents} working={working.has(a.id)} onDelete={del.ask} />
                ))}
              </Rows>
            </Section>
          ))
        )}
        {/* Archived agents: out of the team, folded away; each can come back (its ⋯ › Restore). */}
        {archived.length > 0 && (
          <Section
            title={`${t("agents.archived")} · ${archived.length}`}
            description={t("agents.archivedHint")}
            action={
              <Button size="sm" variant="ghost" onPress={() => setShowArchived((v) => !v)}>
                {showArchived ? t("agents.hideArchived") : t("agents.showArchived")}
              </Button>
            }
          >
            {showArchived && (
              <Rows>
                {archived.map((a) => (
                  <AgentItem key={a.id} agent={a} agents={agents} working={false} onDelete={del.ask} />
                ))}
              </Rows>
            )}
          </Section>
        )}
      </Column>
      {del.dialog}
    </Screen>
  )
}
