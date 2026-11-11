# Tasks: Architecture Hardening

**Input**: `specs/011-architecture-hardening/`: plan.md, spec.md, research.md (R1–R6), data-model.md,
contracts/internal.md, quickstart.md.

**Tests**: included. Project rule: non-trivial logic leaves a runnable check behind, and quickstart.md lists the
tests.

Paths are repo-relative. Read `.agent/memory/server.md` before starting. Every change is in apps/server; `packages/contracts` is not touched.

## Phase 1: Setup

- [X] T001 Add `outside: integer({ mode: "boolean" }).notNull().default(false)` to `turns` and to `messages` in apps/server/src/schema.ts, each with a one-line comment (see data-model.md).
- [X] T002 Generate the migration with `bun run db:generate` (in apps/server). This creates a new folder in apps/server/drizzle/. Never edit a published migration.

## Phase 2: Foundational (blocks US1)

- [X] T003 In apps/server/src/db.ts:
  - `enqueueTurn` and `addMessage` accept `outside?: boolean` (default false);
  - `TurnRow` carries `outside`;
  - add `hasOutside(chatId, after?, until?)`, a boolean "exists" query over `messages` in the `at` range.
- [X] T004 In apps/server/src/runtime.ts, change `RuntimeService.send` to `send(input, opts?: { outside?: boolean })`:
  - the user message and the queued turns get `outside`;
  - thread it through `addUserMessage`, `enqueueFor`, `enqueueRecipients` (both target and team-call turns);
  - the RPC handler in apps/server/src/main.ts keeps `runtime.send(p)` unchanged.

**Checkpoint**: `bun run typecheck` passes, and behaviour is unchanged (nothing sets `outside` yet).

## Phase 3: User Story 1 — Outside text can't act without the person (P1) 🎯 MVP

**Goal**: turns started by webhook or watch routines, and everything they hand off, run at "ask", and their facts go to review (FR-001–FR-004).
**Independent test**: quickstart manual steps 1–3 and the T011 tests.

- [X] T005 [US1] In apps/server/src/routines.ts `runRoutine`, call `runtime.send(…, { outside: payload !== undefined })` (R2).
- [X] T006 [US1] In apps/server/src/runtime.ts:
  - add `turnAccess(chat, agent, row)`, which returns `"ask"` when `row.outside` and otherwise `effectiveAccess(chat, agent)`;
  - use it for the `access` in `runTurn` and for `askFirst`, the preview check and `mine` in `openTools`/`taskCall` (R1).
- [X] T007 [US1] Carry the flag in apps/server/src/runtime.ts (R2):
  - `enqueueAgent(…, outside)`, so `chain` hand-offs, team calls and the wrap-up copy `row.outside`;
  - `startTask` takes `outside` from `taskCall`, and marks the task chat's first message and its turns;
  - `reportTask` marks the reported message and the asker's turn when `store.hasOutside(taskChatId)`;
  - the assistant reply saved by `runTurn` gets `outside: row.outside`.
- [X] T008 [US1] In apps/server/src/runtime.ts `rememberCall`, set `kept` only when `!row.outside` (R3).
- [X] T009 [US1] In apps/server/src/chat.ts `consolidate`, set `onItsOwn = []` when `store.hasOutside(chat.id, <stretch first at - 1>, <stretch last at>)` (R3).
- [X] T010 [P] [US1] Add a fake-engine tool call to the main.test.ts helpers if none fits. The test needs a reply that calls a gateway write tool, so an approval can be observed.
- [X] T011 [US1] Write tests in apps/server/src/main.test.ts:
  - (a) a webhook run for a Full access agent: the turn's write tool waits for approval (or is declined per the routine policy);
  - (b) the person's own message in that chat runs without asking;
  - (c) a hand-off from the outside turn is also capped;
  - (d) a cron/"Run now" run is not capped;
  - (e) with `memoryApproval = "undo"`, consolidating a stretch with the outside message keeps no memory and leaves proposals.

**Checkpoint**: outside turns ask, and the person's own turns are unchanged.

## Phase 4: User Story 2 — A failed learning is visible (P1)

**Goal**: FR-005, FR-006.
**Independent test**: the T013 tests.

- [X] T012 [US2] In apps/server/src/runtime.ts:
  - add `quietly(what, chatId?)`. It does `Effect.catchTags({ Busy, NotFound })` to void, then `Effect.catchCause` to `Effect.logWarning(\`${what} failed\`, { chatId, cause: String(cause) })`;
  - use it instead of `Effect.ignore` at the consolidate "window" (~l.1404) and "quiet" (~l.1425) call sites, and at `mapEarlierFacts` (~l.1712);
  - import `Busy`/`NotFound` from chat.ts;
  - leave l.1718 as is: it already logs.
- [X] T013 [P] [US2] Write tests in apps/server/src/runtime.test.ts, capturing logs with a test `Logger`:
  - a consolidation that dies logs one warning naming the chat;
  - a `Busy` result logs nothing.

  If the runtime can't be built there, unit-test `quietly` on its own (export it).

## Phase 5: User Story 3 — A route set aside stays set aside (P2)

**Goal**: FR-007.
**Independent test**: the T016 test.

- [X] T014 [US3] In apps/server/src/runtime.ts, persist `skipped` (R5):
  - load the `setAsideRoutes` preference at start, dropping entries already past and unreadable JSON (log the latter);
  - every `skipped.set`/`delete` goes through one `setAside(key, value | undefined)` that writes the JSON back;
  - `held()` deletes a past entry when it reads one.
- [X] T015 [US3] In the failover branch (~l.1219) of apps/server/src/runtime.ts, a `limit` with no account is set aside until `f.until ?? now + 60 min`. Other reasons keep `SKIP_MS`.
- [X] T016 [P] [US3] Test in apps/server/src/runtime.test.ts (or main.test.ts with the failover fixtures):
  - a limit on a route without an account, with `until` 2 h ahead, is still skipped after 15 min of fake clock;
  - it is still skipped after rebuilding the runtime on the same database;
  - a past entry is dropped.

## Phase 6: User Story 4 — A deleted chat leaves nothing running behind (P3)

**Goal**: FR-008.
**Independent test**: the T019 test.

- [X] T017 [US4] In apps/server/src/runtime.ts, add `forget(chatId)` to `RuntimeService` (R6):
  - shut down and delete the chat's hub, and delete its `statuses` entry;
  - add the chat to a `gone` map (id to time, entries older than 1 h pruned on add);
  - `publish` skips ids in `gone`.
- [X] T018 [US4] In apps/server/src/main.ts, call `runtime.forget(id)` after `store.removeChat` in the chats `remove` handler (~l.322) and in the hidden builder chats cleanup (~l.225).
- [X] T019 [P] [US4] Test in apps/server/src/runtime.test.ts or main.test.ts: subscribe to a chat, delete it, and check that the stream ends and a late `publish` doesn't bring the hub back. Expose a hub count only if no other way exists, and mark it test-only.

## Phase 7: Polish

- [X] T020 Run `bun run test`, `bun run typecheck`, `bun run check:ui`, `bun run check:i18n` and `bun run lint`. Fix only new warnings.
- [X] T021 Walk through the quickstart manual steps on the dev server, posting to the webhook with curl.
- [X] T022 Update `.agent/memory/server.md`:
  - the outside cap and its inheritance;
  - `messages.outside` and the review rule;
  - `setAsideRoutes`;
  - `forget`;
  - no `Effect.ignore` on background work.

  Also append to `.agent/memory/changelog/server.md`, and add the keywords (outside, webhook, failover) to `.agent/memory/index.md`.
- [X] T023 Mark the spec Status "Implemented", and add an "As built" note to data-model.md if anything differed.

## Dependencies

- Setup (T001–T002) → Foundational (T003–T004) → US1.
- US2 (T012–T013), US3 (T014–T016) and US4 (T017–T019) don't need the migration or each other, so they can start right after Setup. They all edit runtime.ts, so do them one after another, not at the same time.
- T011 needs T005–T010.
- Polish runs last.

## Parallel examples

- T010 (test helper) while T005–T009 are written.
- The test tasks T013, T016 and T019 are in different test blocks and don't depend on each other.

## Implementation strategy

1. MVP = Phases 1–3: the security fix.
2. Then US2 (one small helper), US3, US4.
3. Run the full checks and update memory (Phase 7) before calling it done.
