# Contract: Teams API

These endpoints sit in the existing `agents` HttpApiGroup (`packages/contracts/src/index.ts`). They use the same
session auth and the same authorization as `/api/agents/*`, and every payload is Schema-validated on the server.

| method | path | payload | success | errors |
|---|---|---|---|---|
| GET | /api/teams | none | `AgentTeam[]` | none |
| POST | /api/teams | `NewAgentTeam` | `AgentTeam` | NotFound (project or agent), `TeamHandleTaken` (409), `TeamInvalid` (400: member outside reach, builtin, >20) |
| PATCH | /api/teams/:id | `AgentTeamPatch` | `AgentTeam` | NotFound, `TeamHandleTaken`, `TeamInvalid` |
| DELETE | /api/teams/:id | none | 204 | none (idempotent) |

Changed endpoints:
- `POST /api/agents` and `PATCH /api/agents/:id` take an optional `teamIds`. The new error `TeamHandleTaken` covers an
  agent whose name would take a team's handle.

Error bodies carry a human message only, never a stack trace.

Audit actions:
- `team.created` / `team.updated` / `team.deleted` (category "agent"), with `{ name }`.

Mention rule (unchanged regex `MENTION_RE`): `@handle` resolves to an agent first. If no agent matches, it resolves to
a team in reach. Handles are unique across both (R2), so the order never decides.

Live events: none new. A routed team call publishes the existing `handoff` event with `via: "route"` and `reason`
starting with the team name.
