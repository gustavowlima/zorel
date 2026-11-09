# Feature Specification: Telegram Channel

**Feature Branch**: `feat/memory-efficiency` | **Created**: 2026-11-08 | **Status**: Implemented

**Input**: item 1 of the platform list (2026-11-08): external channels (OpenBot has Slack, Telegram,
WhatsApp, Discord, Signal; ideas only). Telegram first: a bot token is the whole setup and long polling
needs no public address, which fits a local app.

## User Story 1 - Talk to Zorel from the phone (P1)

The person creates a bot with @BotFather, pastes its token in Settings › Channels, gets a one-time code
and sends `/pair CODE` to the bot. From then on, messages to the bot go into a Zorel chat and the reply
comes back; an approval is announced and waits in the app; `/new` starts a new chat.

**Independent Test** (`apps/server/src/main.test.ts`, fake Telegram API): a stranger is turned away; a wrong
code is refused; the right code pairs once; a paired message gets the agent's reply; a stranger still gets
nothing from the agent; unpairing works.

## Requirements

- **FR-001**: Only paired Telegram accounts reach the runtime (authorization, constitution II); pairing is
  a one-time code valid 10 minutes, issued from the authenticated app.
- **FR-002**: The bot token lives in the system keychain (`TELEGRAM_BOT_TOKEN` among the API keys) and is
  masked in logs; error messages never carry the request URL.
- **FR-003**: A message enters through the runtime like one typed in the app (same queue, approvals,
  memory); the reply is split under Telegram's 4,096 characters.
- **FR-004**: Long polling (no webhook, no public address); a failed poll waits 10 s and retries.

## Out of scope (next)

Inline approve/deny buttons, attachments and voice, choosing the agent or project per Telegram chat,
other channels (Slack, Discord, WhatsApp).

## Tasks

- [X] T001 `apps/server/src/telegram.ts`: polling loop, pairing, chat mapping, relay through the runtime
- [X] T002 Contracts + handlers: `GET /api/channels/telegram`, `POST …/pair`, `DELETE …/users`; token via `setKey`
- [X] T003 `apps/web/src/features/channels.tsx`: Settings › Channels (token, pairing code, unpair)
- [X] T004 Test with a fake Telegram API; typecheck, lint, all tests
- [X] T005 Record in `docs/ARCHITECTURE.md`, `.agent/memory/server.md` and `web.md`, changelogs

## Result (2026-11-08)

End-to-end test green against a fake Telegram API (pairing, refusal, relay, unpair). Not checked here: a
real bot on api.telegram.org (needs the person's token).
