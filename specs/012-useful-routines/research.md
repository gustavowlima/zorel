# Research: Useful Routines

Read in the code on 2026-11-10. Line numbers are approximate.

## R1. A run as its own record (`routine_runs`)

- **Today**:
  - `runRoutine` (routines.ts) sends the message through `runtime.send` with
    `clientId = routine:<id>:<key>`.
  - The routine only keeps `lastRunAt` and `lastStatus` (started, skipped, failed).
  - Nothing remembers a run's outcome, report or cost.
- **Decision**: add a `routine_runs` table, one row per run. Its state is `queued → running → done`; it carries
  the trigger, the payload, the outcome, a short report, the full report, tokens and cost, and links to the turn and
  the reply.
- **Uses**: the outcome (US1), the delta (US2, "the last finished run"), the event queue (US3), the brief (US5), the
  week view (US7), the counts.
- **Why a table and not the turns table**: a run can end without any turn (the cheap check, a refused overflow). It
  also needs delivery state (held, delivered, read) that turns don't have.
- **Alternative rejected**: a JSON history on the routine row. That can't be queried by week, and two writers
  would race.

## R2. The queue (FR-004)

- **Today**: `runRoutine` checks `runtime.busy(chatId)` and skips the run, which loses webhooks. The runtime already
  queues turns per chat, persisted in `turns` and recovered at boot, but `runRoutine` never uses that queue.
- **Decision**:
  - A run with a payload (webhook, watch) is inserted as `queued` and a dispatcher starts it. Scheduled runs keep
    today's rule, skip when busy: a cron catch-up must not pile up.
  - **Dispatcher**: on the scheduler tick (30 s) and right after a run ends, for each routine with `queued` rows and
    no `running` row, start the oldest one. Starting it means `runtime.send` with the run's id as the key.
  - **Cap**: 20 queued per routine. The 21st gets a 429 from the webhook, an "overflow" entry in the history, and
    nothing is inserted.
  - **Restart**: the rows survive. A `running` row whose turn was interrupted at boot is marked done with the
    outcome "needs you" ("interrupted by a restart"), never re-run, as for turns today.
- **Watched connector**: today it already re-polls items it found while busy. Now its fresh items become one queued
  run, so `watchSeen` advances at insert time and the items are safe in the row.

## R3. The outcome marker (FR-001, FR-002)

- **Decision**: routine runs get one extra instruction, in English and appended to `runText`:
  - end the reply with a last line `Outcome: nothing new`, `Outcome: something new` or `Outcome: needs you`;
  - make the first line a one-sentence summary.
- **Parsing**: a pure `outcomeOf(text)` in a new `routine-runs.ts`. It reads the last non-empty line, case-insensitive
  and tolerant to markdown, and returns `{ outcome, report, summary, text }`. `text` is the reply without the marker
  line. Unreadable means "something new" (spec).
- **Removing the marker**: the runtime saves the reply as is. The routines layer finds the run's reply message by
  turn id and rewrites its text without the marker through a small `store.setMessageText`, before the brief or
  delivery uses it. The marker never reaches a channel.
  - ponytail: a client watching the chat live may see the line for a moment. A clean stream would need the runtime
    to know about routines.
- **"Needs you" before the end**: `runtime.subscribeStatus` already streams every chat's status. When a routine
  chat with a `running` run turns `waiting` (an approval or a question), the run is marked "needs you" and delivered
  at once, even though it hasn't ended.
- **A failed turn** is "needs you", with the error as the report.
- **Which turn counts**: the run's own turn, found by its clientId. Hand-offs it causes are part of the chat, not
  of the outcome.

## R4. How a run's end reaches routines.ts

- **Today**: the runtime publishes `turn-completed` and `turn-failed` only on per-chat hubs. There is no global feed
  of finished turns.
- **Decision**: add `RuntimeService.finished: Stream<{ turnId, chatId, clientId, state, messageId, usage, cost }>`,
  one global PubSub published next to the existing `publish(tag…)` in `save`. The routine scheduler layer forks one
  fiber that reads it and handles the ones whose clientId starts with `routine:`.
- **Alternative rejected**: polling `turns` on the tick. It adds up to 30 s of delay and an extra query.

## R5. The delta (FR-003)

- **Decision**: `runText` gains a "previous run" block, added only when one exists. It holds the last `done` run
  with a turn: its time and its reply text (without the marker), capped at 4 000 characters, plus one instruction,
  in English: "Report only what changed since then. If nothing did, say so and end with Outcome: nothing new."
- **Rationale**: it is cheap, deterministic, and needs no extra model call. The routine's chat history is also in
  the context, but the window can drop it. The explicit block is what makes the delta reliable.

## R6. The cheap check (FR-005)

- **Decision**:
  - `routines.lookFirst` is a boolean, used only when the routine has a `watch`.
  - Before starting a queued watch run, one call goes to `ask(cheapModel(agent.model), prompt)`. The prompt holds
    the routine's prompt plus the new items (capped at 6 000 characters) and the question: answer `{"act":
    true|false, "why": "…"}`.
  - **`false`**: the run ends with "nothing new" and the report "Checked: <why>", without a turn.
  - **`true`**, or unparsable, or an error, or a timeout of 20 s: the agent starts. This is the same fail-open rule
    as the router.
  - The check is outside text, so it never starts tools: `ask` has none.
- **Its tokens**: `chat.ts` `collect` ignores usage today; it will read the `done` event's usage.
  `agentTokensSince` adds the triage tokens from `routine_runs`, so the check counts toward the agent's month
  (edge case).

## R7. Time profile (FR-006–FR-008)

- **Storage**: the existing `preferences` table, three keys:
  - `timeZone`: an IANA name, defaulting to the server's `Intl` zone;
  - `quietHours`: `{ from: "21:00", to: "07:00" } | null`;
  - `dayStart`: `{ minutes: number | null, learned: number[] }`. `learned` holds the last 14 first-activity times,
    in minutes after local midnight; `minutes` is set by hand, and when null the median of `learned` is used, with
    540 (09:00) as the default.
- **Activity**:
  - `POST /api/activity`, sent by the web app when it gains focus (at most once per 10 minutes);
  - every `runtime.send` that is not outside, not a routine and not a resume;
  - every Telegram message from the paired person.

  A pure `dayStartState(profile, now, lastActivity)` returns whether today's first activity happened and when. The
  first activity of a day in the profile's zone appends to `learned`.
- **"When my day starts" routines**: they get a `onDayStart` column. On the tick, each due one runs once per local
  day, at the first activity or at the usual start plus 3 h, whichever comes first. It is keyed by the local date,
  so it never runs twice in a day.
- **Quiet hours**: a pure `inQuiet(profile, at)`, which handles windows that cross midnight. Delivery checks it (R8).
- **Cron time zone**: croner takes a `timezone` option. `nextRun` passes the profile's zone, so "09:00" means the
  person's 09:00.
- **Alternative rejected**: a `people` table. There is one person today (review #9 is open), and preferences
  already hold per-person settings.

## R8. Delivery (FR-010–FR-012) and notifications

- **Per routine**:
  - `delivery`: `{ channels: ("notify"|"telegram"|"page")[], pageId?: string }`;
  - `tell`: `"every" | "something" | "brief"`;
  - `urgent`: boolean.

  The defaults are `{ channels: ["notify"] }`, `"something"` and `false`, which also covers the migration of
  existing routines (FR-014).
- **Rule**: `shouldTell(outcome, tell, urgent, quiet)` is a pure function with a table, not chained ifs, and has
  unit tests:
  - "nothing new" never tells;
  - "needs you" tells unless quiet hours apply and the routine isn't urgent;
  - "something new" tells when `tell` isn't `"brief"` and it isn't quiet hours.

  A held item stays in the brief.
- **Channels** are a dictionary, `channel → (run) => Effect`:
  - **notify**: a new global RPC stream `notices` (`Notice { id, kind: "routine", runId, routineId, chatId, title,
    text, outcome }`). `notify.tsx` turns a notice into a desktop notification, and stops its generic "done"
    notification for routine chats (it knows them from the routines atom).
  - **telegram**: `telegram.ts` exports `sayToPaired(text)`, the existing `say` applied to the paired chats.
    If nothing is paired, the run falls back to notify and is flagged `deliveryNote: "telegram not paired"`.
  - **page**: `store.savePage({ id: pageId, … body: report }, "routine")`. It already writes a version
    (`addPageVersion`).
- **The morning brief to channels**: when today's first activity, or the day-start cut-off, happens, a text brief
  (counts plus the "needs you" and "something new" lines) goes to Telegram if it is paired and any routine uses
  Telegram. Today stays the main place.

## R9. Today and the week (FR-009, FR-013)

- **Today**:
  - `GET /api/today` returns the runs since `briefFrom`, which is the previous day start, grouped `needs`,
    `found`, `quiet` (a count), newest first, plus `briefFrom` and the profile.
  - It is built by a pure function over the run rows, with no model.
  - `POST /api/today/read { runIds }` sets `readAt`. Answering the approval also marks its run read.
- **Week view**: `GET /api/routines/runs?from&to` returns `{ runs, planned }`.
  - `planned` is computed on the server by a pure `plannedRuns(routines, profile, from, to)`, with croner (already a
    server dependency, so the web app gets no new one). "My day starts" runs are planned at the usual start.
  - It is capped at 200 per range, so a minutely cron can't flood it.
- **UI**, following the designs at the canvas link and DESIGN.md:
  - `today.tsx`, a new place in the sidebar;
  - `routines.tsx`: a Week/List tab, the week grid, and the detail sections (When, Tell me, Look first, delivery);
  - Settings › General: a "Your day" row (zone, usual start, quiet hours).
