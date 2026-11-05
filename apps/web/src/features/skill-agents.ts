// Which agents use a skill: the rules the Memory & skills tab, Knowledge and Settings share. A skill's `agents` is
// the list of agents that see it; empty means all of them (and agents created later). The server refuses ids that
// are archived or gone, so what is written only ever holds active teammates.
import { type Agent, isTeammate } from "@zorel/contracts"

export const SEARCH_FROM = 8 // the picker gets a search from this many agents

export const teamOf = (agents: ReadonlyArray<Agent>) => agents.filter((a) => isTeammate(a))

// Does this agent see the skill?
export const sees = (ids: ReadonlyArray<string> | undefined, agentId: string) => !ids?.length || ids.includes(agentId)

// The ids still active: what can be written back.
const active = (ids: ReadonlyArray<string>, team: ReadonlyArray<Agent>) => ids.filter((id) => teamOf(team).some((a) => a.id === id))

export const MAX_AGENTS = 50 // the contract's limit on a skill's agents

// Who a skill can reach: a project's skill only the agents that work in that project (its own and the global ones).
const reach = (team: ReadonlyArray<Agent>, scope: string | undefined) => {
  const project = scope?.startsWith("project:") ? scope.slice("project:".length) : null
  return teamOf(team).filter((a) => project === null || a.projectId === null || a.projectId === project)
}

// "Stop using" for one agent: the others written out. null when nobody else would be left (an empty list would
// mean everyone) or the list would pass the limit, so the screen sends the person to edit the skill instead.
export function withoutAgent(ids: ReadonlyArray<string> | undefined, agentId: string, team: ReadonlyArray<Agent>, scope?: string): string[] | null {
  const rest = (ids?.length ? active(ids, team) : reach(team, scope).map((a) => a.id)).filter((id) => id !== agentId)
  return rest.length && rest.length <= MAX_AGENTS ? rest : null
}

// "Use it": this agent added to the active ones already listed.
export const withAgent = (ids: ReadonlyArray<string> | undefined, agentId: string, team: ReadonlyArray<Agent>): string[] => [...new Set([...active(ids ?? [], team), agentId])]

// How the list reads: everyone, nobody left (all its agents are gone), or these agents.
export type UsedByView = { kind: "all" } | { kind: "none" } | { kind: "some"; names: ReadonlyArray<string> }
export function usedByView(ids: ReadonlyArray<string> | undefined, team: ReadonlyArray<Agent>): UsedByView {
  if (!ids?.length) return { kind: "all" }
  const names = teamOf(team).filter((a) => ids.includes(a.id)).map((a) => a.name)
  return names.length ? { kind: "some", names } : { kind: "none" }
}
