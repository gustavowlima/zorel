# Tasks: Always With Agents

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Status**: Implemented (2026-11-11)

- [X] T001 [US2] Contracts: `ChatNeedsAgent` (RPC send), `ChatNeedsAgentError` and `LastAgent` (HTTP) in packages/contracts
- [X] T002 [US2] Server: chats.create/update refuse no agents (apps/server/src/main.ts)
- [X] T003 [US2] Server: runtime.send refuses a chat with no active member (apps/server/src/runtime.ts)
- [X] T004 [US3] Server: the last teammate can't be archived or deleted, one check at a time (main.ts `keepsAnAgent`)
- [X] T005 [US3] Server: a routine whose agent is gone or archived doesn't run (apps/server/src/routines.ts)
- [X] T006 [US4] Server: Telegram chats get the chosen or last-used agent; `PUT /api/channels/telegram/agent` (telegram.ts `channelAgent`)
- [X] T007 [US1] Web: first-run gate (App.tsx) and screen (features/first-run.tsx) with draft, purposes, AI pick, connect in place
- [X] T008 [US2] Web: Home picks the agent used last (`lastUsedAgent`), no plain chat (features/home.tsx)
- [X] T009 [US2] Web: the chat keeps its last member (features/people.tsx); project crew empty text
- [X] T010 [US3] Web: "Who continues this chat?" for chats whose agents are gone (features/chat.tsx)
- [X] T011 [US3] Web: archive/delete disabled on the last agent with the reason (agent.tsx, agents.tsx)
- [X] T012 [US4] Web: Telegram agent picker (features/channels.tsx)
- [X] T013 Tests: agents-only.test.ts, main.test.ts (spec 015), runtime tests with a plain agent, agent-options lastUsedAgent

## As built

- The data layer stays permissive (low-level tests and old chats); the rule is enforced at the routes, the channel and send.
- Old agentless chats are left as they are (the user's are test data); they ask who continues on the next message.
- The first-run "connect an AI" opens the providers screen in a dialog.
