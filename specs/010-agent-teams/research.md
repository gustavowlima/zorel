# Research: Agent Teams

All findings come from the repo (2026-11-10); no external library is involved.

## R1. Routing a team call

- **Decision**: Reuse the existing router (`apps/server/src/router.ts`: `routerPrompt`, `parseRoute`, `routerModel`)
  and the routed-turn path in `runtime.ts` (`routeTurn`, `turns.route`, handoff event `via: "route"` with `reason`).
  A team call queues one turn marked to route, and the turn records which team it routes over. `routeTurn` then routes
  over that team's members in the chat instead of over all the chat's members.
- **Rationale**: The router already does what FR-009/012/013 ask. It makes one cheap model call with the roster's
  title and description, falls back to the first in the list on any failure, has a 20 s timeout, and shows its choice
  in the chat ("Routed to X: reason"). Only the roster changes.
- **Alternatives**: (a) A new router for teams: duplicates code. (b) Keyword matching on the description: fails on
  paraphrase, which works against SC-005. (c) Every member answers: rejected by the person ("usaria roteamento").

## R2. The team's handle

- **Decision**: A team's handle is derived from its name with the same `handleOf` rule agents use ("Review Crew" →
  `review-crew`). Saving a team is refused on the server when its handle equals the handle of a callable agent or of
  another team within the same reach (its project plus global).
- **Rationale**: Agents have no stored handle, and every mention path (`MENTION_RE`, `mentioned`, `toJoin`, chips)
  derives handles from names. Deriving the team's handle the same way keeps one rule.
- **Gap found**: Agents' handles are not checked for uniqueness today. FR-004 checks only in the team direction: a
  team cannot take an agent's or another team's handle. Creating or renaming an agent to a team's handle is also
  refused. Two agents sharing a handle stays as it is today and is out of scope.

## R3. Membership in chats

- **Decision**: Adding a team to a chat copies its active members into `chat_members`, appended in team order and
  deduplicated, up to the chat's 8-member cap. Overflow is reported, not silently dropped. A first-time leader is
  whoever is first in the result.
- **Rationale**: FR-006 says the chat holds agents, not a link to the team. `NewChat.agentIds` and the members update
  already take a list of agents, so the web expands the team before sending, and the server validates as today.
- **Mentions on send**: `@team` in a message makes the team's active members who are callable and not yet members join
  on send (extending `toJoin`), the same as adding the team. The routed turn then picks among them.
  - In an agent's hand-off, `@team` routes among the team members who are already in the chat. If none are, the
    hand-off does nothing, the same as mentioning an agent who is not in the chat.

## R4. Naming in code

- **Decision**: The entity is `AgentTeam` in contracts. The tables are `agent_teams` and `agent_team_members`, the
  server module is `apps/server/src/agent-teams.ts`, and the UI label is "Teams".
- **Rationale**: "team" already means a chat's members in code (`team.ts`, `TeamPicker`, `routerPrompt(team…)`, i18n
  `team.*` "Who answers"). The project page labels its agents "Team" (`project.team`). That label becomes "Agents" so
  the word "Teams" means one thing on screen.

## R5. Where teams are managed

- **Decision**: The Agents view (`features/agents.tsx`, global and per project) gets a Teams section above the agents
  list: create, rename, edit members (ordered), delete, and "New agent" with the team chosen in advance. The agent
  form (`features/agent.tsx`) gets a "Teams" multi-select.
- **Rationale**: Spec assumption: no new sidebar place. The agent form is where an agent's other relations are
  already edited.

## R6. Audit and authorization

- **Decision**: New audit actions `team.created`, `team.updated` and `team.deleted` go in the "agent" category. Team
  routes sit in the same `agents` HttpApi group, behind the same session middleware and the same authorization as
  agent routes. Every payload is validated by Schema on the server.
