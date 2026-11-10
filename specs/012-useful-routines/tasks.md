# Tasks: Useful Routines

**Input**: `specs/012-useful-routines/` — plan.md, spec.md, research.md (R1–R9), data-model.md, contracts/api.md,
quickstart.md. Designs: https://claude.ai/artifact/9YF5TKK1BBKX28mPtNZxEg

**Tests**: included (project rule). Read `.agent/memory/server.md` and `.agent/memory/web.md` first. Paths are repo-relative.

## Phase 1: Setup

- [X] T001 In apps/server/src/schema.ts:
  - add the `routineRuns` table, with its indexes, per data-model.md;
  - add the columns `onDayStart`, `lookFirst`, `delivery` (JSON, default `{"channels":["notify"]}`), `tell` (default `something`), `urgent` and `dayRanOn` to `routines`.
- [X] T002 Generate the migration (`bun run db:generate` in apps/server) and rename its folder `<ts>_routine_runs`.

## Phase 2: Foundational (blocks every story)

- [X] T003 [P] In packages/contracts/src/index.ts, add the schemas from data-model.md:
  - `RoutineOutcome`, `RoutineTrigger`, `RoutineRun`, `RoutineDelivery`, `RoutineTell`, `TimeProfile`, `Today`;
  - add the new fields to `Routine`, `NewRoutine` and `RoutinePatch`;
  - add `timeProfile` to `Preferences`.
- [X] T004 [P] Add `Notice` and the `notices` RPC stream in packages/contracts (the events file that holds `ZorelRpc`).
- [X] T005 Add the endpoints from contracts/api.md to the routines and settings groups in packages/contracts/src/index.ts:
  - `runs`, `routineRuns`, `today`, `todayRead`, `activity`, `timePreferences`;
  - add the 429 to `hook`.
- [X] T006 [P] Create apps/server/src/routine-runs.ts with the pure rules (R3, R7, R8, R9), each one a dictionary or table where it branches:
  - `outcomeOf(text)` returns `{ outcome, summary, text }`;
  - `shouldTell(outcome, tell, urgent, quiet)`;
  - `inQuiet(profile, at)`;
  - `localDate(at, zone)`;
  - `dayStartDue(profile, now, activityToday, ranOn)`;
  - `todayOf(runs, from)`;
  - `plannedRuns(routines, profile, from, to, cap = 200)`;
  - `learnDayStart(profile, minutes)`, which keeps the last 14 and takes the median.
- [X] T007 [P] Write apps/server/src/routine-runs.test.ts covering every case in quickstart.md's "Pure rules" row, including windows that cross midnight and a zone other than the server's.
- [X] T008 Add to apps/server/src/db.ts:
  - `addRun`, `updateRun`, `runsOf(routineId, before?)`, `queuedRuns()`, `runningRun(routineId)`, `runByTurn(turnId)`, `runsBetween(from, to)`;
  - `countQueued(routineId)`;
  - `setMessageText(id, text)`;
  - make `agentTokensSince` add `routine_runs.triage_tokens` for the agent's routines;
  - map the new routine columns in and out.
- [X] T009 [P] In apps/server/src/runtime.ts, add the global stream `RuntimeService.finished` (R4). Publish `{ turnId, chatId, clientId, state, messageId, usage, cost }` in `save`, next to the per-chat publish.
- [X] T010 [P] In apps/server/src/chat.ts, make `collect` read the `done` event's usage, so that `ask` returns `{ text, error, usage }`. Check the callers still compile.
- [X] T011 [P] Add the i18n strings in packages/i18n/src/en.ts:
  - `routines.*` for outcomes, week, tell, channels, look first, day start, urgent and the overflow;
  - `today.*`;
  - `settings.day.*` for the zone, usual start, quiet hours and "learned";
  - `notify.routine.*`.

**Checkpoint**: `bun run typecheck` and the T007 tests pass. Behaviour is unchanged.

## Phase 3: User Story 1 — A run tells me only when it matters (P1) 🎯

- [X] T012 [US1] In apps/server/src/schedule.ts `runText`, append the marker instruction (R3), in English: a first-line summary, and a last line `Outcome: …`.
- [X] T013 [US1] Rework `runRoutine` in apps/server/src/routines.ts around runs (R1):
  - insert a run row (trigger from the caller) before sending;
  - the clientId is `routine:<runId>`;
  - set `running` and `startedAt`;
  - keep the skip-when-busy rule for `schedule` and `now`;
  - keep `lastStatus` in step.
- [X] T014 [US1] In the RoutineScheduler layer (apps/server/src/routines.ts), fork a fiber on `runtime.finished` that handles `routine:` clientIds:
  - read the reply and apply `outcomeOf`; a failed turn is `needs` with the error as the summary;
  - write `summary`, `report` (≤ 4000), `outcome`, `cost`, `messageId`, `endedAt`, state `done`;
  - remove the marker with `store.setMessageText`;
  - then deliver (T016).
- [X] T015 [US1] Fork a fiber on `runtime.subscribeStatus` in the same layer. When a routine chat with a running run turns `waiting`, set outcome `needs` and deliver at once, only once per run.
- [X] T016 [US1] Add `deliver(run, routine)` in apps/server/src/routines.ts:
  - use `shouldTell` with a quiet flag that is false until US4;
  - keep a channels dictionary with only `notify` for now, which publishes a `Notice` on a global PubSub exposed through the `notices` RPC handler in apps/server/src/main.ts;
  - set `deliveredAt` or `held`.
- [X] T017 [US1] In apps/web/src/features/notify.tsx:
  - subscribe to `notices` and show each one as a desktop notification (title: the routine; body: the summary; click opens the chat);
  - skip the generic "done" and "failed" notification for routine chats (ids from the routines atom), keeping "waiting" off for them too, because notices cover it;
  - add the notices stream helper in apps/web/src/client.ts.
- [X] T018 [US1] Write tests in apps/server/src/main.test.ts:
  - a fake reply ending `Outcome: nothing new` sends no notice;
  - one ending `something new` sends one notice;
  - a reply with no marker counts as `something`;
  - an approval wait marks the run `needs` before it ends;
  - the saved reply has no marker line.

- [X] T048 [US1] Add `GET /api/routines/:id/runs?before` (50 per page, with `report`) and `DELETE /api/routines/:id/runs` (clears the `done` runs, records an audit entry) to packages/contracts/src/index.ts, apps/server/src/main.ts and db.ts.
- [X] T049 [US1] Add the Runs history section in apps/web/src/features/routines.tsx, in the list rows style of the design's "Routine detail" artboard:
  - each row shows the outcome dot, when, trigger, summary, cost, and the delivery state (told, held, refused, or "telegram not paired");
  - a row opens the reply in the routine's chat;
  - a "Load more" button pages back;
  - "Clear history" asks with a ConfirmDialog first;
  - add `routineRunsAtom` in client.ts.
- [X] T050 [US1] Add retention (FR-017) in apps/server/src/db.ts, as `pruneRuns(now)`: delete `done` runs older than 90 days, except the newest 50 per routine. Run it in the runtime's nightly sleep (apps/server/src/runtime.ts) with `quietly` logging. Test it in apps/server/src/db.test.ts.

**Checkpoint**: noise is gone: runs with nothing new are silent, and every run is in the routine's history.

## Phase 4: User Story 2 — A run reports only what changed (P1)

- [X] T019 [US2] In apps/server/src/routines.ts and schedule.ts, when starting a run, look up the last `done` run with a turn. Pass its time and report to `runText`, which adds the "previous run" block and the instruction (R5) only when one exists.
- [X] T020 [US2] Write a test in apps/server/src/main.test.ts: the second run's prompt (the fake engine's `turns`) holds the first run's report and the "only what changed" line, and the first run's prompt holds neither.

## Phase 5: User Story 3 — Outside events wait in line, and a cheap check comes first (P1)

- [X] T021 [US3] In apps/server/src/routines.ts, route outside triggers to a queue (R2):
  - webhook and watch insert a `queued` run with its payload and label;
  - the cap is `countQueued ≥ 20`, which refuses the run and writes an `overflow` note; the webhook handler in apps/server/src/main.ts answers 429;
  - for a watch, `watchSeen` advances at insert.
- [X] T022 [US3] Add the dispatcher in apps/server/src/routines.ts. On each tick and after each finished run, for every routine with queued runs and no running one, start the oldest. A run that is still outside keeps `{ outside: true }` (FR-015).
- [X] T023 [US3] Add boot recovery in apps/server/src/routines.ts. Runs left `running` whose turn ended `interrupted` (or that have no turn) become `done`, with outcome `needs` and the summary "Stopped by a restart". Queued runs stay queued.
- [X] T024 [US3] Add the cheap check (R6) in apps/server/src/routines.ts, before starting a queued watch run with `lookFirst`:
  - call `ask(cheapModel(agent.model), prompt)`, with items capped at 6000 characters and a 20 s timeout;
  - `act: false` ends the run `nothing`, with the summary "Checked: …" and the triage tokens;
  - an error or unparsable answer starts the agent, and is logged;
  - add the English prompt next to `runText` in schedule.ts.
- [X] T025 [US3] Add validation in apps/server/src/main.ts: `lookFirst` without `watch` is a 400.
- [X] T026 [US3] Write tests in apps/server/src/main.test.ts:
  - 3 webhooks while a run waits lead to 3 runs, in arrival order;
  - the 21st queued gets 429;
  - queued rows survive rebuilding the runtime on the same database (follow the runtime.test.ts pattern if main.test can't rebuild);
  - a fake check answering `{"act":false}` ends the run with no turn;
  - a check returning garbage starts the agent.

**Checkpoint**: MVP (P1) done. Run the full checks here.

## Phase 6: User Story 4 — My time: when my day starts, and quiet hours (P2)

- [X] T027 [US4] Add time profile storage and routes in apps/server/src/db.ts and main.ts:
  - the `timeZone`, `quietHours`, `dayStart`, `lastActivityDay` and `briefAt` preferences;
  - `PUT /api/preferences/time`, validated: the zone through `Intl.DateTimeFormat`, `HH:MM`, minutes 0–1439;
  - `Preferences.timeProfile`.
- [X] T028 [US4] Record activity:
  - `POST /api/activity` in apps/server/src/main.ts;
  - in `runtime.send`, for a person's message (not outside, not `routine:` or `resume:`), call one `noteActivity` helper;
  - in telegram.ts, a paired message calls it too.

  On the first activity of a local day, it appends to `learned` (`learnDayStart`), moves `briefAt`, and triggers the day-start routines and the brief (T030).
- [X] T029 [US4] In apps/server/src/schedule.ts, `nextRun` takes the profile's zone (croner `timezone`). Pass it in the tick and in `createRoutineFor`.
- [X] T030 [US4] Add the `onDayStart` routines in apps/server/src/routines.ts. On the tick and on first activity, each enabled one with `dayStartDue` runs once, with trigger `day_start`, and `dayRanOn` set to the local date.
- [X] T031 [US4] Use the real quiet flag in `deliver`: `inQuiet(profile, now)`, so held runs are not delivered; urgent `needs` still notifies.
- [X] T032 [US4] Add the "Your day" settings in apps/web/src/features/settings.tsx:
  - rows for the zone (Select with `Intl.supportedValuesOf("timeZone")`), the usual start ("learned: 9:10", or set by hand) and quiet hours (from and to, or off);
  - the web app sends `POST /api/activity` on window focus, at most every 10 min (apps/web/src/App.tsx).
- [X] T033 [US4] Write tests in apps/server/src/main.test.ts:
  - a run inside quiet hours sends no notice and is `held`;
  - urgent `needs` notifies;
  - the first activity runs a day-start routine once, and a second activity doesn't;
  - an invalid zone gets 400.

## Phase 7: User Story 5 — The morning brief on a Today page (P2)

- [X] T034 [US5] Add `GET /api/today` (`todayOf` over `runsBetween(briefAt.previous, now)`) and `POST /api/today/read` in apps/server/src/main.ts and db.ts. Answering an approval marks its run read.
- [X] T035 [US5] Create apps/web/src/features/today.tsx following the design's "Today" artboard and DESIGN.md:
  - the header, then Needs you, From your routines and the folded quiet line;
  - the empty state in one line;
  - opening an item marks it read;
  - add `todayAtom` in client.ts, the `today` route in state.ts and App.tsx, and the sidebar place above Needs you in sidebar.tsx, with the Sun icon.
- [X] T036 [US5] On the day's first activity, send the text brief (counts plus the needs and found lines) through `sayToPaired` when any routine delivers to Telegram (R8).
- [X] T037 [P] [US5] Write a test in apps/server/src/main.test.ts: after 5 runs (1 needs, 2 found, 2 quiet), `/api/today` returns 1, 2 and quiet 2; after reading, needs is 0.

## Phase 8: User Story 6 — Where a routine's result lands (P2)

- [X] T038 [US6] In apps/server/src/telegram.ts, export `sayToPaired(text)`, which returns `{ sent }`. It reuses `say`, the secret token and the paired users.
- [X] T039 [US6] Add the `telegram` and `page` channels to the channels dictionary in apps/server/src/routines.ts:
  - `telegram` falls back to `notify` when not paired, with `deliveryNote`;
  - `page` calls `store.savePage({ id: pageId, … }, "routine")`, which keeps a version;
  - `brief` only marks the run held;
  - validate that `delivery.pageId` is in reach in the create and update handlers.
- [X] T040 [US6] Add the routine detail sections in apps/web/src/features/routines.tsx, as in the design's "Routine detail" artboard:
  - What to do (who answers, tokens per run);
  - When (At a time, When my day starts, When something happens; look first);
  - Tell me (when, where chips, page picker, urgent).

  The Runs history is already in place from T049.
- [X] T041 [P] [US6] Write tests in apps/server/src/main.test.ts:
  - page delivery writes a page version with the report;
  - Telegram not paired falls back to a notice with the note;
  - a `brief`-only routine sends no notice and its run is held.

## Phase 9: User Story 7 — The week as a calendar (P3)

- [X] T042 [US7] Add `GET /api/routines/runs?from&to` in apps/server/src/main.ts, with the range at most 31 days, returning `runsBetween` plus `plannedRuns`.
- [X] T043 [US7] Add the Week/List tab in apps/web/src/features/routines.tsx, as in the design's "Routines · week" artboard:
  - a 7-day grid from 07:00 to 22:00;
  - runs by outcome, linking to the routine;
  - planned runs dashed, the day-start line and the quiet band;
  - the side rail with Needs you and the week's counts;
  - sideways scroll inside the box on phones;
  - add `weekRunsAtom` in client.ts.
- [X] T044 [P] [US7] Extend the `plannedRuns` cases in apps/server/src/routine-runs.test.ts: a weekly cron in the person's zone lands on the right local day, day-start routines are placed at the usual start, and the list stops at the cap.

## Phase 10: Polish

- [X] T045 Run `bun run test`, `bun run typecheck`, `bun run check:ui`, `bun run check:i18n` and `bun run lint`. Fix only new warnings.
- [X] T046 Walk through quickstart.md's manual steps on the 4318 server with Playwright screenshots of Week, Detail and Today, compared with the designs.
- [X] T047 Update `.agent/memory/server.md` and `web.md`:
  - runs, outcome marker, delta, queue, cheap check, time profile, delivery, Today and notices;
  - the changelogs, and the index keywords (routines, today, brief, quiet hours, delivery).

  Mark the spec Implemented, and add an "As built" note to data-model.md.

## Dependencies

- Setup → Foundational → US1. US1 is required by every later story, because they all use runs and `deliver`.
- US2 and US3 need only US1. US2 is mostly schedule.ts; US3 is routines.ts plus main.ts.
- US4 is required before US5, which uses `briefAt` and activity. US6 needs US1, and its `brief` channel needs US5's Today to be visible.
- US7 needs only US1 and US4 (the zone).
- routines.ts is touched by T013–T016, T019, T021–T024, T030, T031, T036 and T039: do those in order.

## Parallel examples

- Foundational: T003, T004, T006, T007, T009, T010 and T011 together. Then T005, then T008.
- The test tasks marked [P] (T037, T041, T044) can run alongside the UI tasks.

## Implementation strategy

1. MVP = Phases 1–5 (P1). Stop and check: silent runs, delta, nothing lost, cheap check.
2. Then P2 (US4 → US5 → US6), then P3 (US7).
3. Full checks and memory updates before calling it done.
