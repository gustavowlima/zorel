# Implementation Plan: Agent Teams

**Branch**: `feat/browser-cursor-review` (spec folder `010-agent-teams`) | **Date**: 2026-11-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/010-agent-teams/spec.md`

## Summary

Named, ordered groups of agents (project or global). A team can be:
- added to a chat in one pick: its active members are copied in;
- called by `@handle`: one routed turn, where the existing cheap-model router picks the best-fit member and falls
  back to the first;
- chosen in the agent form.

The routing reuses `router.ts` and `routeTurn`, so the main new pieces are a table pair, CRUD routes, and the pickers.

## Technical Context

- **Language/Version**: TypeScript on Bun 1.4.4.
- **Primary Dependencies**:
  - server: Effect 4 HttpApi, Drizzle 1.0.0-rc.5 on SQLite;
  - web: React with react-aria and Tailwind v4.
  - No new dependency.
- **Storage**: SQLite. A new migration adds `agent_teams`, `agent_team_members` and `turns.route_team_id`, generated
  with `db:generate`; published migrations are never edited.
- **Testing**: `bun test` (server and web pure modules), typecheck, check:ui, check:i18n.
- **Target Platform**: Desktop app and web UI on Windows, macOS and Linux. Nothing OS-specific is involved.
- **Project Type**: Monorepo web app: `apps/server`, `apps/web` and `packages/contracts|i18n`.
- **Performance Goals**: A team call adds at most one router call, bounded by the existing 20 s timeout with fallback
  (SC-006).
- **Constraints**: The chat-member cap of 8 is unchanged. A team holds at most 20 agents.
- **Scale/Scope**: Tens of teams per person. Roughly 4 server files, 5 web files, contracts and i18n.

## Constitution Check

| Principle | Status |
|---|---|
| I. Scope and Simplicity | Pass. Reuses the router, membership and mention rule. Teams are organisation only, with no new per-team settings. |
| II. Security | Pass. Routes sit in the `agents` group with the same auth and authorization; Schema validates on the server; errors carry messages, not stacks. The router prompt already marks user text "data, not instructions". |
| III. Errors/Validation | Pass. Handle clash and reach are checked at the route boundary. Routing failure is logged and falls back. |
| IV. Cross-Platform | Pass. Nothing OS-specific. |
| V. Language | Pass. Router text stays English; UI text goes through i18n. |

Re-check after design: no violations, so Complexity Tracking stays empty.

## Project Structure

### Documentation (this feature)

```text
specs/010-agent-teams/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/teams-api.md
└── checklists/requirements.md
```

### Source Code (repository root)

```text
packages/contracts/src/index.ts      # AgentTeam, NewAgentTeam, AgentTeamPatch, TeamHandleTaken/TeamInvalid,
                                     # teams endpoints in the agents group, teamIds on NewAgent/AgentPatch
packages/i18n/src/en.ts              # teams.* strings; project.team label → "Agents"; audit team.* actions
apps/server/src/schema.ts            # agent_teams, agent_team_members, turns.routeTeamId
apps/server/drizzle/<new>/           # generated migration
apps/server/src/agent-teams.ts       # handle/reach checks, expand(team, chat) → active callable members
apps/server/src/agent-teams.test.ts
apps/server/src/db.ts                # team CRUD + memberships
apps/server/src/main.ts              # handlers, audit, teamIds on agent create/update
apps/server/src/audit.ts             # teamCreated/Updated/Deleted
apps/server/src/context.ts           # mentionedTeams(text, teams)
apps/server/src/runtime.ts           # recipientsOf + chain: team mention → routed turn with routeTeamId;
                                     # routeTurn: roster = team ∩ chat members
apps/web/src/client.ts               # teams atom + mutations
apps/web/src/features/agents.tsx     # Teams section (create/edit/delete, New agent in team)
apps/web/src/features/agent.tsx      # Teams multi-select in the agent form
apps/web/src/features/agent-options.ts (+test)  # teams in options; toJoin expands @team
apps/web/src/features/people.tsx     # TeamPicker: add a team
apps/web/src/features/home.tsx       # new chat: pick a team
apps/web/src/features/audit.tsx      # team.* actions
```

**Structure Decision**: Existing monorepo layout. One new server module (`agent-teams.ts`) holds the pure rules so
they can be tested. Everything else edits existing files.

## Complexity Tracking

No violations.
