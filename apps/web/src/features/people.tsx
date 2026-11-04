// Who is talking: the author avatar (agent color, or the model's logo for the plain assistant) and the
// team picker (who answers in a chat: the lead first, members, add or remove).
import type { Agent, Chat } from "@zorel/contracts"
import { t } from "@zorel/i18n"
import { agentsAtom, mutations, useList, useMutation } from "../client.ts"
import { agentTone, handleOf, modelLabel, splitModel } from "../labels.ts"
import { AgentAvatar, Badge, Button, IconButton, ModelAvatar, Plus, Popover, X } from "@/ui"

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
  const team = chat.agentIds.flatMap((id) => agents.find((a) => a.id === id) ?? [])
  const candidates = agents.filter((a) => !a.builtin && (a.projectId === null || a.projectId === chat.projectId) && !chat.agentIds.includes(a.id))
  const lead = team[0]
  const setTeam = (agentIds: ReadonlyArray<string>, model?: string) =>
    update({ params: { id: chat.id }, payload: { agentIds, ...(model && { model }) }, reactivityKeys: ["chats"] })
  // No agents to pick: the model answers on its own and the model chip already says which.
  if (!lead && candidates.length === 0) return null

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
      <div className="flex flex-col gap-1 p-2">
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
              <Badge tone="accent">{t("team.lead")}</Badge>
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
            {candidates.map((a) => (
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
          </>
        )}
        {team.length > 1 && <p className="border-t border-subtle px-2 pt-2 text-sm text-dim">{t("team.mentionHint")}</p>}
      </div>
    </Popover>
  )
}
