# Quickstart: validating Agent Teams

Prerequisites: `bun install`, a model account that can answer (any provider) for the routing checks.

## Automated

```sh
bun run test        # includes the new agent-teams tests (server) and agent-options tests (web)
bun run typecheck
bun run check:ui && bun run check:i18n
```

Expected new tests:
- `apps/server/src/agent-teams.test.ts`: create/rename/delete; handle clash with an agent and with a team (409);
  member outside reach refused; deleting a team keeps its agents; agent delete drops its memberships.
- Router/runtime test (`engines.test.ts` or `main.test.ts`): a routed turn with `route_team_id` only offers that
  team's members, and a bad answer or timeout falls back to the team's first member.
- `apps/web/src/features/agent-options.test.ts`: `toJoin("@frontend …")` adds the team's callable active members
  that are not yet members, once each, skipping archived ones and anything in backticks.

## Manual (dev server)

1. Agents › Teams › New team "Frontend": Designer (title "UI design"), Tester (title "Writes tests"). Reload; the
   order is kept.
2. New chat › members picker › pick "Frontend": both join, and Designer is the lead.
3. In a chat with no members, send "@frontend write tests for the header". Both join; the chat shows
   "Routed to Tester: Frontend · …", and Tester answers.
4. Send "@frontend hi". Designer answers, either because the route picked them or because of the fallback.
5. Rename an agent to "Frontend". The rename is refused: the handle is taken.
6. Delete the team. Designer and Tester and their chats are unchanged.
7. Settings › Audit shows the team's created, updated and deleted actions.
