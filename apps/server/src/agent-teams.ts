// Teams (spec 010): the rules that don't touch the database, so they can be tested. A team's handle comes from its
// name (as an agent's); it must not be one an agent or another team in reach already answers to, or `@x` would be
// ambiguous. Reach is what a chat can see: a project's own plus the global ones.
import { type Agent, type AgentTeam, isTeammate, TEAM_MAX } from "@zorel/contracts"
import { handleOf } from "./context.ts"

type Scoped = { readonly projectId: string | null }
// Two things meet in some chat: either is global, or both are in the same project.
const meet = (a: Scoped, b: Scoped) => a.projectId === null || b.projectId === null || a.projectId === b.projectId

export const teamHandle = (name: string) => handleOf({ name })

// What already answers to `handle` where `self` is seen (undefined: free). selfId: the team or agent being renamed.
export function handleClash(handle: string, self: Scoped & { id?: string | undefined }, reach: { agents: ReadonlyArray<Agent>; teams: ReadonlyArray<Pick<AgentTeam, "id" | "projectId" | "name">> }): string | undefined {
  if (!handle) return "The name needs a letter or digit to make a handle."
  const agent = reach.agents.find((a) => a.id !== self.id && !a.builtin && meet(a, self) && handleOf(a) === handle)
  if (agent) return `@${handle} is already the agent ${agent.name}. Pick another name.`
  const team = reach.teams.find((t) => t.id !== self.id && meet(t, self) && teamHandle(t.name) === handle)
  return team ? `@${handle} is already the team ${team.name}. Pick another name.` : undefined
}

// Whether a team can hold an agent: a global agent fits any team; a project's agent only that project's teams.
export const holds = (team: Scoped, agent: Scoped) => agent.projectId === null || agent.projectId === team.projectId

// Why these agents can't be the team's members (undefined: they can). A global team holds global agents only.
export function invalidMembers(team: Scoped, agentIds: ReadonlyArray<string>, agents: ReadonlyArray<Agent>): string | undefined {
  if (agentIds.length > TEAM_MAX) return `A team holds at most ${TEAM_MAX} agents.`
  for (const id of agentIds) {
    const a = agents.find((x) => x.id === id)
    if (!a) return "One of the agents no longer exists."
    if (a.builtin) return `${a.name} can't be in a team.`
    if (!holds(team, a)) return `${a.name} belongs to another project, so it can't be in this team.`
  }
  return undefined
}

// The members who can work, in team order: archived (and missing) agents are skipped and come back when restored.
export const activeMembers = (team: Pick<AgentTeam, "agentIds">, agents: ReadonlyArray<Agent>): Agent[] =>
  team.agentIds.flatMap((id) => agents.find((a) => a.id === id && isTeammate(a)) ?? [])

// The teams a chat in `projectId` can call or add.
export const teamsIn = <T extends Scoped>(teams: ReadonlyArray<T>, projectId: string | null): T[] => teams.filter((t) => t.projectId === null || t.projectId === projectId)
