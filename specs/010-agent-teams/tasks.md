# Tasks: Agent Teams

**Input**: `specs/010-agent-teams/` — plan.md, spec.md, research.md (R1–R6), data-model.md, contracts/teams-api.md,
quickstart.md.

**Tests**: included. Project rule: non-trivial logic leaves a runnable check behind, and quickstart.md lists the
tests.

Paths are repo-relative. Read `.agent/memory/server.md` and `.agent/memory/web.md` before starting.

## Phase 1: Setup

- [X] T001 Add `agentTeams` (id, projectId FK projects cascade, name, position, createdAt, updatedAt) and `agentTeamMembers` (teamId FK cascade, agentId FK agents cascade, position, PK teamId+agentId) tables, and `routeTeamId: text("route_team_id")` on `turns`, in apps/server/src/schema.ts
- [X] T002 Generate the migration with `bun run db:generate` (in apps/server), creating a new folder in apps/server/drizzle/. Never edit a published migration.

## Phase 2: Foundational (blocks every story)

- [X] T003 [P] Add the `AgentTeam` (id, projectId, name, handle, agentIds, createdAt, updatedAt), `NewAgentTeam`, `AgentTeamPatch` (agentIds max 20) schemas, and the `TeamHandleTaken` (409) and `TeamInvalid` (400) errors, in packages/contracts/src/index.ts
- [X] T004 Add the `GET/POST /api/teams` and `PATCH/DELETE /api/teams/:id` endpoints to the `agents` HttpApiGroup, per contracts/teams-api.md, in packages/contracts/src/index.ts
- [X] T005 [P] Create the pure rules in apps/server/src/agent-teams.ts:
  - `teamHandle(name)` (reuses `handleOf` from context.ts);
  - `handleClash(handle, reach: {agents, teams}, selfId?)`;
  - `validMembers(team, agents)` (reach: a global team holds global agents only; a project team holds that project's agents and global ones; builtin agents refused; max 20);
  - `activeMembers(team, agents)` (team order; drops archived, builtin and missing agents).
- [X] T006 [P] Write unit tests for T005 in apps/server/src/agent-teams.test.ts:
  - handle clash with an agent and with a team, in reach and outside it;
  - global/project reach;
  - builtin refused;
  - archived skipped;
  - order kept.
- [X] T007 Add team storage to apps/server/src/db.ts:
  - `teams()` returns each team with `agentIds` ordered by position;
  - `createTeam`, `updateTeam` (a patch with agentIds replaces the members in a transaction), `removeTeam`;
  - `setAgentTeams(agentId, teamIds)` appends to new teams and keeps the agent's position in teams it stays in.
- [X] T008 [P] Add the `teamCreated`/`teamUpdated`/`teamDeleted` actions (`team.*`, category "agent") in apps/server/src/audit.ts
- [X] T009 [P] Add i18n strings in packages/i18n/src/en.ts:
  - `teams.*`: title, new, name, members, empty, handleTaken, invalid, addTeam, newAgentInTeam, overflow "{count} didn't fit (8 per chat)";
  - `audit.actions.team_created|updated|deleted`;
  - change `project.team` from "Team" to "Agents" (R4).
- [X] T010 [P] Add the `teams` atom and the `createTeam`/`updateTeam`/`removeTeam` mutations (reactivity key "teams") in apps/web/src/client.ts, and the `team.*` actions in apps/web/src/features/audit.tsx

**Checkpoint**: the contracts, storage and pure rules are in place, and `bun run typecheck` passes.

## Phase 3: User Story 1 — Group agents into a team (P1) 🎯 MVP

**Goal**: Create, rename, re-order, change members of and delete teams. Agents are untouched by a team's deletion.
**Independent test**: Quickstart manual steps 1, 5 and 6, plus the T013 tests.

- [X] T011 [US1] Implement the team handlers in apps/server/src/main.ts:
  - list;
  - create/update: validate the project and agents exist (NotFound), `handleClash` → `TeamHandleTaken`, `validMembers` → `TeamInvalid`, record the audit action;
  - remove: idempotent, records the audit action.
  - Same auth and authorization as the agent handlers; error bodies carry messages only.
- [X] T012 [US1] In the agent create/update handlers in apps/server/src/main.ts, refuse a name whose handle equals a team's handle in reach (`TeamHandleTaken`), and add that error to the agents create/update endpoints in packages/contracts/src/index.ts
- [X] T013 [P] [US1] Write the E2E test in apps/server/src/main.test.ts (or apps/server/src/agent-teams.test.ts using the app layer):
  - create, rename and delete a team;
  - the 409 on a clash;
  - deleting the team leaves its agents;
  - deleting an agent drops its membership.
- [X] T014 [US1] Add a Teams section above the agents list in apps/web/src/features/agents.tsx (global and per project):
  - team rows show the name, `@handle` and member chips;
  - a "New team" dialog takes a name and an ordered member pick;
  - edit (rename, add/remove/reorder members) and delete (with confirmation);
  - the server error text is shown on a clash or invalid member.

**Checkpoint**: teams can be managed end to end.

## Phase 4: User Story 2 — Add a whole team to a chat (P1)

**Goal**: Wherever agents are added to a chat, teams appear next to them. Picking one adds the team's active members
in order, without duplicates, up to the cap of 8.
**Independent test**: Quickstart manual step 2.

- [X] T015 [P] [US2] Add `teamMembersToAdd(team, agents, memberIds, cap = 8)` in apps/web/src/features/agent-options.ts. It returns `{ add, overflow }`: callable active members not yet in the chat, in team order.
- [X] T016 [P] [US2] Test T015 in apps/web/src/features/agent-options.test.ts: duplicates skipped, archived skipped, order kept, overflow past 8.
- [X] T017 [US2] In the TeamPicker (apps/web/src/features/people.tsx), add a "Teams" group to the add menu. Picking a team updates the chat's members with the appended list (the first becomes lead if the chat had none) and shows `teams.overflow` when some did not fit.
- [X] T018 [US2] In the new-chat agent pick (apps/web/src/features/home.tsx), list teams too. Picking one puts its active members into `agentIds` (still capped at 8).

**Checkpoint**: one pick adds a whole team.

## Phase 5: User Story 3 — Call a team by its handle (P2)

**Goal**: `@team` routes to one best-fit member (R1, R3).
**Independent test**: Quickstart manual steps 3 and 4, plus T022.

- [X] T019 [US3] Add `mentionedTeams(text, teams)` to apps/server/src/context.ts. It uses the same plain-text and `MENTION_RE` handling as `mentioned` and keeps the order of appearance.
- [X] T020 [US3] In apps/server/src/runtime.ts `recipientsOf`, for each mentioned team with at least one member in the chat, add a target of the team's first in-chat member with `route: true` and `routeTeamId: team.id` (counts toward `MAX_MENTIONS`).
  - Thread `routeTeamId` through `enqueueRecipients`, `store.enqueueTurn` and the turn row in apps/server/src/db.ts.
  - In `chain`, do the same for an agent's hand-off text (depth + 1, same `MAX_DEPTH` handling).
- [X] T021 [US3] Change `routeTurn` in apps/server/src/runtime.ts:
  - when `row.routeTeamId` is set, the roster is the team's active members in the chat, in team order, and the fallback is the first of them;
  - prefix the handoff `reason` with the team name;
  - if the team is gone, fall back to the chat's lead.
- [X] T022 [P] [US3] Add tests:
  - `mentionedTeams` (code span and e-mail ignored) in apps/server/src/engines.test.ts;
  - a routed team turn whose router answer names a non-member, or is unreadable, falls back to the team's first member (mock `ask`), in apps/server/src/main.test.ts.
- [X] T023 [US3] Extend `toJoin` in apps/web/src/features/agent-options.ts (and its call sites in apps/web/src/features/chat.tsx and home.tsx) so that `@team` brings in the team's callable active members who are not yet members. Add tests in apps/web/src/features/agent-options.test.ts.
- [X] T024 [US3] Offer teams in the composer's `@`/`#` suggestions (apps/web/src/features/agent-options.ts `agentOptions` plus apps/web/src/features/composer.tsx) with a hint like "Team · 3 agents". The chip renders as a normal `@handle` (mention.tsx resolves teams to a chip too).

**Checkpoint**: `@frontend …` reaches the right member.

## Phase 6: User Story 4 — Put an agent in a team when creating it (P2)

**Goal**: Choose teams in the agent form, and "New agent" from a team.
**Independent test**: Create an agent with a team chosen; the team lists it last.

- [X] T025 [US4] Add an optional `teamIds` (max 20) to `NewAgent`/`AgentPatch` in packages/contracts/src/index.ts. The create/update handlers in apps/server/src/main.ts call `setAgentTeams`, validating reach and existence.
- [X] T026 [US4] Add a "Teams" multi-select (teams in reach) to the agent form in apps/web/src/features/agent.tsx, preselected from the `#/agent/new/...` route's team query when present.
- [X] T027 [US4] Make "New agent" on a team row (apps/web/src/features/agents.tsx) open the agent form with that team preselected (route state in apps/web/src/state.ts if a param is needed).

## Phase 7: Polish

- [X] T028 Run `bun run test`, `bun run typecheck`, `bun run check:ui`, `bun run check:i18n` and biome lint; fix only new warnings.
- [X] T029 Walk through quickstart.md on the dev server with Playwright (screenshots of the Teams section, the picker and a routed reply).
- [X] T030 Update .agent/memory/server.md and .agent/memory/web.md (teams rules, `routeTeamId`, handle clash), the index keywords (teams) in .agent/memory/index.md, and the changelogs in .agent/memory/changelog/. Mark the spec Status "Implemented".

## Dependencies

- Setup (T001–T002) → Foundational (T003–T010) → US1 → US2 / US3 / US4.
- US2, US3 and US4 depend only on US1's server handlers (T011). They touch mostly different files and can run in any
  order, except that T023/T024 and T015 share agent-options.ts (do them in sequence).
- T020/T021 change runtime.ts; do them in sequence.

## Parallel examples

- Foundational: T003, T005, T006, T008, T009 and T010 together (different files). T004 comes after T003.
- US2: T015 and T016 together, then T017 and T018.
- US3: T019 and T022 (context tests) while T023 runs on the web.

## Implementation strategy

1. MVP = Phases 1–3 (teams exist and can be managed).
2. Add US2 (the main time saver), then US3 (routing), then US4.
3. Run the full checks and update memory (Phase 7) before calling it done.
