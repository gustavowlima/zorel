// The agents "#" and "@" offer in the message box, apart from the screen so the rule can be tested: who can be called
// (not the Builder; the project's own and the global ones), the list itself (the chat's members first, in the chat's
// order, then the rest, each with the line that says what it is or that it joins the chat), and who a message
// calls that is not in the chat yet (they join when it is sent).
import { type Agent, type AgentTeam, MENTION_RE, isTeammate, type Project } from "@zorel/contracts"

const CHAT_MEMBERS_MAX = 8 // NewChat/ChatPatch agentIds
import { handleOf } from "../labels.ts"
import { handleKey } from "./mentions.ts"

export const callable = <A extends Pick<Agent, "projectId" | "builtin" | "archivedAt">>(agents: ReadonlyArray<A>, projectId: string | null): A[] =>
  agents.filter((a) => isTeammate(a) && (a.projectId === null || a.projectId === projectId))

interface AgentOption<A> {
  readonly agent: A
  readonly id: string // the handle the text carries after the "@"
  readonly label: string
  readonly hint: string
  readonly member: boolean // already in the chat; the others join it when picked
}

export function agentOptions<A extends Pick<Agent, "id" | "name">>(
  agents: ReadonlyArray<A>,
  memberIds: ReadonlyArray<string>,
  hints: { member: (a: A) => string; outside: string }
): AgentOption<A>[] {
  const members = memberIds.flatMap((id) => agents.find((a) => a.id === id) ?? [])
  const outside = agents.filter((a) => !memberIds.includes(a.id))
  return [
    ...members.map((agent) => ({ agent, id: handleOf(agent), label: agent.name, hint: hints.member(agent), member: true })),
    ...outside.map((agent) => ({ agent, id: handleOf(agent), label: agent.name, hint: hints.outside, member: false }))
  ]
}

// Who a message names that must join the chat before it is sent: callable agents mentioned in the text who are not
// members, once each, in the order they appear. Read as the server reads mentions (MENTION_RE, code in backticks
// left out), so exactly the ones it would route to are the ones that join.
// A team named (`@team`, spec 010) brings in its callable members, in team order; the server then routes the message
// to the one who fits.
export function toJoin<A extends Pick<Agent, "id" | "name">>(text: string, chatAgentIds: ReadonlyArray<string>, callable: ReadonlyArray<A>, teams: ReadonlyArray<Pick<AgentTeam, "name" | "agentIds">> = []): A[] {
  const out: A[] = []
  for (const m of text.replace(/```[\s\S]*?```|`[^`]*`/g, " ").matchAll(MENTION_RE)) {
    const handle = handleKey(m[1]!)
    const agent = callable.find((a) => handleOf(a) === handle)
    const team = agent ? undefined : teams.find((x) => handleOf(x) === handle)
    for (const a of agent ? [agent] : team ? teamAgents(team, callable) : []) if (!chatAgentIds.includes(a.id) && !out.includes(a)) out.push(a)
  }
  return out
}

// A team's members who can be called here, in team order (archived and other projects' agents aren't in `callable`).
const teamAgents = <A extends Pick<Agent, "id">>(team: Pick<AgentTeam, "agentIds">, callable: ReadonlyArray<A>): A[] =>
  team.agentIds.flatMap((id) => callable.find((a) => a.id === id) ?? [])

// Adding a whole team to a chat: its callable members not in the chat yet, after the ones there, up to the cap.
export function withTeam<A extends Pick<Agent, "id">>(team: Pick<AgentTeam, "agentIds">, callable: ReadonlyArray<A>, memberIds: ReadonlyArray<string>, cap = CHAT_MEMBERS_MAX) {
  const fresh = teamAgents(team, callable).filter((a) => !memberIds.includes(a.id))
  const room = Math.max(0, cap - memberIds.length)
  return { ids: [...memberIds, ...fresh.slice(0, room).map((a) => a.id)], added: fresh.slice(0, room), overflow: Math.max(0, fresh.length - room) }
}

// The teams a chat in this project can call or add (its own and the global ones).
export const teamsIn = <T extends Pick<AgentTeam, "projectId">>(teams: ReadonlyArray<T>, projectId: string | null): T[] => teams.filter((x) => x.projectId === null || x.projectId === projectId)

// Who a new chat in a project starts with: its agents, then its teams' members, once each, only those in reach (an
// archived agent or a deleted team drops out), up to what a chat holds. The router then picks who answers each message.
export function projectCrew<A extends Pick<Agent, "id">>(project: Pick<Project, "agentIds" | "teamIds"> | undefined, callable: ReadonlyArray<A>, teams: ReadonlyArray<Pick<AgentTeam, "id" | "agentIds">>): A[] {
  if (!project) return []
  const ids = [...project.agentIds, ...project.teamIds.flatMap((id) => teams.find((x) => x.id === id)?.agentIds ?? [])]
  return [...new Set(ids)].flatMap((id) => callable.find((a) => a.id === id) ?? []).slice(0, CHAT_MEMBERS_MAX)
}
