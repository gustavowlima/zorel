// Who is talking: the author avatar (agent color, or the model's logo for the plain assistant) and the
// team picker (who answers in a chat: the lead first, members, add or remove).
import type { Agent, Chat } from "@zorel/contracts"
import { isTeammate } from "@zorel/contracts"
import { t } from "@zorel/i18n"
import { agentsAtom, mutations, teamsAtom, useList, useMutation } from "../client.ts"
import { callable, teamsIn, withTeam } from "./agent-options.ts"
import { agentTint, agentTone, handleOf, modelLabel, splitModel } from "../labels.ts"
import { useState } from "react"
import { AgentAvatar, Button, IconButton, ModelAvatar, Plus, Popover, SearchInput, Users, X } from "@/ui"

type Size = 16 | 20 | 28 | 32

export function AuthorAvatar({ agent, model, size = 32 }: { agent: Agent | undefined; model: string | null; size?: Size }) {
  const agents = useList(agentsAtom)
  if (agent) return <AgentAvatar id={agent.id} name={agent.name} tone={agentTone(agent, agents)} size={size} />
  return <ModelAvatar provider={splitModel(model ?? "").provider} size={size} />
}

// Header: the chat's members as overlapping avatars (or "Add an agent" when it has none); opens the team list
// to add, remove or pick the lead. Who answers a message is picked in the text with @.
export function TeamPicker({ chat }: { chat: Chat }) {
  const agents = useList(agentsAtom)
  const update = useMutation(mutations.updateChat)
  // Teams (spec 010): one press adds the members who aren't here yet, in the team's order.
  const reach = callable(agents, chat.projectId)
  const teams = teamsIn(useList(teamsAtom), chat.projectId).map((x) => ({ team: x, add: withTeam(x, reach, chat.agentIds) }))
  const [overflow, setOverflow] = useState(0)
  const team = chat.agentIds.flatMap((id) => agents.find((a) => a.id === id) ?? [])
  const candidates = agents.filter((a) => isTeammate(a) && (a.projectId === null || a.projectId === chat.projectId) && !chat.agentIds.includes(a.id))
  const lead = team[0]
  // A long list gets a search field (the same threshold as Select's).
  const [query, setQuery] = useState("")
  const q = query.trim().toLowerCase()
  const searchable = candidates.length > 8
  const shown = q ? candidates.filter((a) => `${a.name} ${handleOf(a)} ${a.title}`.toLowerCase().includes(q)) : candidates
  const setTeam = (agentIds: ReadonlyArray<string>, model?: string) =>
    update({ params: { id: chat.id }, payload: { agentIds, ...(model && { model }) }, reactivityKeys: ["chats"] })
  // No agents to pick: the model answers on its own and the model chip already says which.
  if (!lead && candidates.length === 0 && teams.length === 0) return null

  return (
    <Popover
      label={t("team.title")}
      className="w-80"
      placement="bottom end"
      trigger={
        <Button size="sm" variant="ghost" aria-label={team.length ? t("chat.members", { names: team.map((a) => a.name).join(", ") }) : t("team.add")} shape="pill" className="gap-1.5 px-1.5 text-muted">
          {team.length ? (
            <span className="flex">
              {team.map((a, i) => (
                <AgentAvatar key={a.id} id={a.id} name={a.name} tone={agentTone(a, agents)} size={20} className={i ? "-ml-1.5 ring-2 ring-canvas" : "ring-2 ring-canvas"} />
              ))}
            </span>
          ) : (
            <>
              <Plus className="size-3.5" />
              {t("team.add")}
            </>
          )}
        </Button>
      }
    >
      <div className="flex min-h-0 flex-col gap-1 p-2">
        <p className="px-2 pt-1 pb-1.5 text-sm font-medium text-muted">{t("team.title")}</p>
        {team.length === 0 && candidates.length === 0 && (
          <p className="px-2 pb-2 text-sm text-dim">
            {t("team.noAgents")} {t("team.noAgentsHint")}
          </p>
        )}
        {team.map((a, i) => (
          <div key={a.id} className="flex items-center gap-2.5 rounded-control px-2 py-1.5">
            <AgentAvatar id={a.id} name={a.name} tone={agentTone(a, agents)} size={20} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-medium">{a.name}</span>
              <span className="truncate text-sm text-muted">{i === 0 ? t("team.leadHint") : `@${handleOf(a)} · ${modelLabel(a.model)}`}</span>
            </span>
            {i === 0 ? (
              <span className={`tinted ${agentTint(a, agents)} inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-xs font-medium`}>{t("team.lead")}</span>
            ) : (
              // The lead's model drives the chat, so it follows the new lead.
              <Button size="sm" variant="ghost" onPress={() => void setTeam([a.id, ...chat.agentIds.filter((x) => x !== a.id)], a.model)}>
                {t("team.makeLead")}
              </Button>
            )}
            <IconButton label={t("team.removeMember", { name: a.name })} size="xs" onPress={() => void setTeam(chat.agentIds.filter((x) => x !== a.id))}>
              <X className="size-3.5" />
            </IconButton>
          </div>
        ))}
        {candidates.length > 0 && (
          <>
            <p className="mt-1 border-t border-subtle px-2 pt-2.5 pb-1 text-sm font-medium text-muted">{t("team.add")}</p>
            {searchable && <SearchInput size="sm" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("agents.search")} aria-label={t("agents.search")} className="mx-1 mb-1" />}
            <div className="scroll-quiet flex min-h-0 flex-col gap-1 overflow-y-auto">
              {shown.length === 0 && <p className="px-2 py-1.5 text-sm text-muted">{t("agents.noMatch")}</p>}
              {shown.map((a) => (
                <Button
                  key={a.id}
                  variant="ghost"
                  className="h-auto justify-start gap-2.5 px-2 py-1.5 text-left font-normal text-fg"
                  onPress={() => void setTeam([...chat.agentIds, a.id], chat.agentIds.length ? undefined : a.model)}
                >
                  <AgentAvatar id={a.id} name={a.name} tone={agentTone(a, agents)} size={20} />
                  <span className="min-w-0 flex-1 truncate">{a.name}</span>
                  <Plus className="size-3.5 text-muted" />
                </Button>
              ))}
            </div>
          </>
        )}
        {teams.length > 0 && (
          <>
            <p className="mt-1 border-t border-subtle px-2 pt-2.5 pb-1 text-sm font-medium text-muted">{t("teams.addTeam")}</p>
            {teams.map(({ team: x, add }) => (
              <Button
                key={x.id}
                variant="ghost"
                isDisabled={add.added.length === 0}
                className="h-auto justify-start gap-2.5 px-2 py-1.5 text-left font-normal text-fg"
                onPress={() => {
                  setOverflow(add.overflow)
                  void setTeam(add.ids, chat.agentIds.length ? undefined : add.added[0]?.model)
                }}
              >
                <Users className="size-4 text-muted" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{x.name}</span>
                  <span className="truncate text-sm text-muted">{add.added.length ? t("teams.added", { names: add.added.map((a) => a.name).join(", ") }) : t("teams.allIn")}</span>
                </span>
                <Plus className="size-3.5 text-muted" />
              </Button>
            ))}
            {overflow > 0 && <p className="px-2 py-1 text-sm text-warning">{t("teams.overflow", { count: overflow })}</p>}
          </>
        )}
        {team.length > 1 && <p className="border-t border-subtle px-2 pt-2 text-sm text-dim">{t("team.mentionHint")}</p>}
      </div>
    </Popover>
  )
}
