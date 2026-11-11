# Implementation Plan: Always With Agents

**Branch**: `feat/browser-cursor-review` | **Date**: 2026-11-11 | **Spec**: [spec.md](spec.md)

## Summary

The rule ("every chat has an agent") is enforced where requests come in:
- the chat routes;
- the Telegram channel;
- the runtime's send.

The data layer stays permissive, so the old agentless chats and the low-level tests keep working. The web app:
- gains a first-run gate;
- picks a default agent on Home;
- stops offering chats without agents;
- asks who continues a chat that lost its agents.

## Technical Context

- Server: Bun, Effect HttpApi (`apps/server/src/main.ts`), runtime (`runtime.ts`), Telegram (`telegram.ts`), routines
  (`routines.ts`).
- Web: React 19 (`apps/web/src`), atoms in `client.ts`, i18n in `packages/i18n`.
- "The person's agents" = `isTeammate(agent)` (contracts): it excludes the built-in Builder and archived agents.
- Default agent ("used last"): the first teammate of the most recent chat (by `lastAt ?? createdAt`) that is still
  callable, else the first callable agent. It is a pure helper, `lastUsedAgent`, shared by Home, the project crew
  hint and the channel default; on the server, `defaultAgent(store)` does the same for Telegram.

## Constitution Check

- I. Scope and Simplicity:
  - no new dependency;
  - no data migration (the user's old chats are test data);
  - the rule lives at the boundary, not spread through the runtime.
- II. Security: the server validates (≥1 teammate on create and update, last agent can't be archived or deleted); the
  client checks are UX only.
- III. Explicit errors: refusals come back as typed HTTP errors with a reason the UI shows.
- IV. Cross-platform: nothing OS-specific.
- V. Language: UI text through i18n (en + pt-BR); model-facing text unchanged.

## Design

### Server
1. `main.ts`:
   - `chats.create`/`update` refuse an empty `agentIds` (400 `chat_needs_agent`), and every id must be a teammate.
   - `agents.archive`/`remove` refuse the last teammate (409 `last_agent`).
2. `runtime.ts` `enqueueFor`: a chat with no active member raises `ChatNeedsAgent` (a new tagged error on `send`),
   instead of queueing an agentless turn. The web asks who continues.
3. `telegram.ts`:
   - a new Telegram chat uses the preference `telegramAgent` when it names a callable teammate, else
     `defaultAgent(store)`;
   - Settings › Channels sets the preference (`PUT /api/preferences/telegram-agent`).
4. `routines.ts`: a routine whose agent is missing (not only archived) is skipped with a notice.

### Web
1. `App.tsx`: when the agents list has loaded and holds no teammate, render `FirstRun` instead of the app.
2. `features/first-run.tsx`:
   - name with a suggestion;
   - purpose chips (research, writing, code, operations, own words) that set the instructions;
   - the model picker (connected models; with none, a link that opens the accounts settings in a dialog in place);
   - the draft is kept in localStorage;
   - Create makes the agent, then a chat with it, then goes there.
3. `home.tsx`:
   - no plain mode;
   - with no project crew, an agent select defaulting to `lastUsedAgent`;
   - the crew chip loses its "×".
4. `people.tsx` (the chat's team picker): the last member can't be removed.
5. Project crew settings: no "No agent"; the empty state says "the agent you used last".
6. `chat.tsx`: when the chat has no active member, the composer shows "Who continues this chat?" with the agents, and
   the message is sent after picking (`updateChat`, then `send`).
7. `channels.tsx`: an agent select for Telegram.

## Testing

- Server (`main.test.ts`):
  - creating or emptying a chat with no agents is refused;
  - the last agent can't be archived or deleted;
  - a Telegram chat gets the chosen or default agent;
  - sending into an agentless chat raises `ChatNeedsAgent`.

  The tests that created agentless chats through the API get an agent.
- Web: `lastUsedAgent` unit test; screenshots of the first run, Home and a chat whose agent was deleted.
