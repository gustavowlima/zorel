# Data Model: Architecture Hardening

## Turn (`turns`), one new column

| field | type | rule |
|---|---|---|
| outside | integer boolean, not null, default false | true for a turn started by a webhook or watch routine, and for every turn that inherits it (hand-off, team call, wrap-up, start_task, task report). While true, the turn runs at "ask" access. |

## Message (`messages`), one new column

| field | type | rule |
|---|---|---|
| outside | integer boolean, not null, default false | true for the user message an outside routine run adds, the reply of an outside turn, and a task report from a task started outside. Learning from a stretch with any such message never keeps facts without review. |

Both columns go in one generated migration (`bun run db:generate` in apps/server). Existing rows read false, which
is today's behaviour. Neither column goes into `packages/contracts`: they are server rules, not shown in the UI.

## Preference `setAsideRoutes` (existing `preferences` table)

```text
{ "<routeKey>": { "until": <ms>, "reason": "<FailureReason>" }, ... }
```

- `routeKey` is the one already in use: `account:<id>` or `provider:<provider>`.
- It is written when a route is set aside and loaded at boot. Entries with `until <= now` are dropped on load and
  when read.
- A saved account's limit keeps using `accounts.limited_until`, so this key only holds routes that have no account,
  plus 10-minute skips.

## Runtime state (memory only)

- `hubs` entry: removed by `forget(chatId)` on chat deletion.
- `gone`: the chat ids forgotten in the last hour, so a late event does not recreate a hub.

## As built (2026-11-10)

- The migration is `apps/server/drizzle/20261110133237_outside_turns`.
- The runtime method that releases a deleted chat is `release`, not `forget`: `forget` already existed (it closes the
  engine sessions on "Edit from here"). `release` closes the sessions too.
- `hasOutside` treats the stretch as conservative. The quiet consolidation's earlier context messages count as part
  of the stretch, so an outside message just before it also sends the facts to review.
- The quickstart's manual steps 1–3 were not run with a real model, because they spend subscription tokens. The same
  flows are covered end to end with the fake engine in main.test.ts ("outside text (spec 011)" and "memory approval
  undo (spec 011)"). The migration was checked live on the 4318 test server.
