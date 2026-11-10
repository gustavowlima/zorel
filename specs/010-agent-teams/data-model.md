# Data Model: Agent Teams

## AgentTeam (table `agent_teams`)

| field | type | rule |
|---|---|---|
| id | text PK | generated |
| project_id | text null, FK projects ON DELETE CASCADE | null = global team |
| name | text | 1–80 chars (`Name` schema); handle = `handleOf(name)` |
| created_at / updated_at | integer | ms |

Validation (server, on create and rename):
- The handle is non-empty, and no callable agent or other team in reach has the same handle. Reach means: for a
  project team, the project's teams and agents plus global ones; for a global team, every team and agent. A clash is
  refused with `TeamHandleTaken` (409).

## AgentTeamMember (table `agent_team_members`)

| field | type | rule |
|---|---|---|
| team_id | text FK agent_teams ON DELETE CASCADE | |
| agent_id | text FK agents ON DELETE CASCADE | |
| position | integer | 0 = first (routing fallback) |
| PK | (team_id, agent_id) | an agent at most once per team |

Validation:
- At most 20 members per team.
- A global team holds global agents only. A project team holds the project's agents and global agents.
- Builtin agents are refused.
- Archived agents may stay as members. They are skipped when the team is added to a chat or called (FR-011), and come
  back when restored.

## Turn (existing table `turns`), one new column

| field | type | rule |
|---|---|---|
| route_team_id | text null | set with `route = true` when a team was called. `routeTurn` routes over this team's members in the chat. Null = route over all members (today's behaviour). No FK: a deleted team falls back to the chat's lead. |

## Contracts types (packages/contracts)

- `AgentTeam = { id, projectId: Id | null, name, handle, agentIds: Id[], createdAt, updatedAt }`. `handle` is computed
  on read and never accepted as input.
- `NewAgentTeam = { projectId, name, agentIds }` and `AgentTeamPatch = { name?, agentIds? }`. A patch with `agentIds`
  replaces the whole ordered list.
- `NewAgent` / `AgentPatch` gain `teamIds?: Id[]`. On create the agent is appended to each listed team. On patch the
  given set replaces which teams hold the agent, keeping its position in teams it stays in.
- Handoff event: no change. `via: "route"` plus `reason` already render. The router's `reason` is prefixed with the
  team name so the chat reads "Frontend → Tester: tests".

## Lifecycle

- Delete team: its rows and memberships go. Agents and chats are untouched (SC-003).
- Delete agent: cascade removes its memberships.
- Delete project: cascade removes the project's teams.
- Archive agent: the membership stays and is skipped at use.

## As built (2026-11-10)

- No `position` on teams: the list is oldest first. Add it when someone needs to reorder teams.
- A hand-off to `@team` from one of that team's own members is skipped: it would route back to the speaker in a loop.
  The member names the teammate instead.
- A team call opens no wrap-up turn for the agent that handed off, unlike an `@agent` hand-off.
- Team mentions render as plain `@text` in messages; only agents get chips.
