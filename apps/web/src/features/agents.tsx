// Agents: the whole team in one place — the global agents, then each project's — with who is working now, and
// "New agent". A row opens the agent's page. Agents can also be created or changed from a chat (zero_create_agent,
// zero_update_agent): they show up here once the person approves the proposal.
import type { Agent } from "@zero/contracts"
import { t } from "@zero/i18n"
import { agentsAtom, projectsAtom, useList, useStatuses } from "../client.ts"
import { agentTone, modelLabel } from "../labels.ts"
import { go } from "../state.ts"
import { AgentAvatar, Bot, Button, ChevronRight, Column, Dot, EmptyState, IconButton, Plus, Screen, Section, Tooltip } from "@/ui"

// The agents working now (a chat of theirs is running or waiting).
export function useWorking() {
  const statuses = useStatuses()
  return new Set(Object.values(statuses).flatMap((s) => (s.state !== "idle" && s.agentId ? [s.agentId] : [])))
}

export function AgentRow({ agent, agents, working }: { agent: Agent; agents: ReadonlyArray<Agent>; working: boolean }) {
  const line = agent.title || agent.description || agent.instructions.trim().split("\n")[0]
  return (
    <Button variant="ghost" className="h-14 justify-start gap-3 rounded-none px-1 font-normal text-fg" onPress={() => go({ view: "agent", id: agent.id })}>
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
      <span className="shrink-0 text-sm text-muted">{t(`access.${agent.access}`)}</span>
      <ChevronRight className="text-muted" />
    </Button>
  )
}

export function AgentsView() {
  const agents = useList(agentsAtom)
  const projects = useList(projectsAtom)
  const working = useWorking()
  const groups = [
    { id: null as string | null, name: t("agents.global"), hint: t("agents.globalHint") },
    ...projects.map((p) => ({ id: p.id as string | null, name: p.name, hint: undefined as string | undefined }))
  ].map((g) => ({ ...g, list: agents.filter((a) => a.projectId === g.id) }))
  return (
    <Screen
      title={t("agents.title")}
      subtitle={t("agents.subtitle")}
      actions={
        <Button size="sm" variant="secondary" onPress={() => go({ view: "new-agent", projectId: null })}>
          <Plus />
          {t("nav.newAgent")}
        </Button>
      }
    >
      <Column>
      {agents.length === 0 ? (
        <EmptyState icon={<Bot />} title={t("agents.empty")} hint={t("agents.emptyHint")} />
      ) : (
        groups
          .filter((g) => g.id === null || g.list.length > 0)
          .map((g) => (
            <Section
              key={g.id ?? "global"}
              title={g.name}
              description={g.hint}
              action={
                g.id && (
                  <Tooltip content={t("nav.newAgentIn", { name: g.name })}>
                    <IconButton label={t("nav.newAgentIn", { name: g.name })} size="sm" onPress={() => go({ view: "new-agent", projectId: g.id })}>
                      <Plus className="size-3.5" />
                    </IconButton>
                  </Tooltip>
                )
              }
            >
              {g.list.length ? (
                <div className="flex flex-col divide-y divide-subtle border-y border-subtle">
                  {g.list.map((a) => (
                    <AgentRow key={a.id} agent={a} agents={agents} working={working.has(a.id)} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted">{t("agents.noGlobal")}</p>
              )}
            </Section>
          ))
      )}
      </Column>
    </Screen>
  )
}
