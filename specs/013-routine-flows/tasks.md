# Tasks: Routine Flows

**Input**: `specs/013-routine-flows/`: plan.md, spec.md, research.md (R1–R11), data-model.md, contracts/api.md,
quickstart.md. Designs: https://claude.ai/artifact/9YF5TKK1BBKX28mPtNZxEg (Steps, ToolStep, RunTrace, ToolPicker,
Trigger, Deliver, Flow).

**Tests**: included (project rule). Read `.agent/memory/server.md` and `.agent/memory/web.md` first. Paths are
repo-relative. Branch by dictionary, never by chained conditions. Every model-facing text in English; UI strings in
`packages/i18n/src/en.ts`.

**Delivery order** (plan.md): P1-a = Phases 1–2 + US3 + the server half of US2; P1-b = US1 + the web half of US2;
P2 = US4–US6.

## Phase 1: Setup

- [X] T001 Add the dependencies, each with a one-line reason in the commit:
  - `@xyflow/react@12.12.1` to apps/web/package.json (the canvas, R11);
  - `ajv@^8.20.0` to apps/server/package.json (already in the tree through the MCP SDK, R6).

  Run `bun install` and check `bun.lock` adds no new ajv copy.
- [X] T002 In apps/server/src/schema.ts, per data-model.md:
  - add the `routineVersions` table (PK `routine_id, n`, FK cascade);
  - add the `routineRunSteps` table with its `(run_id, started_at)` index;
  - add `version` (int null), `schedule` (JSON null) and `watchEvery` (int, default 5) to `routines`;
  - add `version` (int null) to `routineRuns`;
  - make `approvals.turnId` nullable and add `runStepId` (FK `routine_run_steps` cascade), with a check that exactly
    one is set.
- [X] T003 Generate the migration (`bun run db:generate` in apps/server) and rename its folder `<ts>_routine_flows`.
  Read the generated SQL: the approvals rebuild must copy every existing row.

## Phase 2: Foundational (blocks every story)

- [X] T004 [P] Create packages/contracts/src/flow.ts (R1):
  - Effect Schemas `FlowNode`, `FlowEdge`, `FlowGraph`, `Value` (literal or `{ from, path? }`) and the `config` per
    kind (data-model.md);
  - `PORTS` table, `connectionProblem(from, to, branch)`;
  - `validateFlow(graph)`, which returns `{ ok: true } | { ok: false, nodeId?, field?, problem }`;
  - `synthesizeFlow(routine)` for a spec 012 routine (trigger, one agent node, end);
  - `MAX_STEPS = 30`; `REQUIRED` per kind as a dictionary.

  Export it from packages/contracts/src/index.ts.
- [X] T005 [P] Write packages/contracts/src/flow.test.ts for every case in quickstart.md's Contract row:
  - a decision into a tool is refused;
  - an unreachable node, a cycle, a missing required field, a duplicate branch and a 31st step are refused, each
    naming the node and the field;
  - `synthesizeFlow` on an old routine gives trigger → agent → end.
- [X] T006 In packages/contracts/src/index.ts, add per contracts/api.md:
  - `RunStep` and `RunStepState`;
  - errors `FlowInvalid` (400, `nodeId?`, `field?`, `problem`) and `FlowConflict` (409);
  - endpoints `flow` (GET), `saveFlow` (PUT, `{ graph, baseVersion }`), `flowVersion`, `run` (with steps),
    `stepOutput`, `resolveStep`, in the routines group;
  - `Routine` gains `version`, `schedule`, `watchEvery`;
  - `RoutineRun` gains `version`.
- [X] T007 Add to apps/server/src/db.ts:
  - `addVersion(routineId, graph)` (next n in one transaction, sets `routines.version`), `versionOf(routineId, n)`;
  - `addStep`, `updateStep`, `stepsOf(runId)`, `lastStep(runId)`, `runStep(id)`;
  - map the new routine and run columns in and out;
  - `approvals`: accept `runStepId` and a null `turnId` in add and list.
- [X] T008 In apps/server/src/runtime.ts, extract `requestApproval(chatId, agent, req, anchor)` from `waitFor` /
  `askApproval`, where `anchor` is `{ turnId } | { runStepId }`. The chat path calls it with `{ turnId }` and behaves
  as before. Existing approval tests must pass unchanged.
- [X] T009 Create apps/server/src/flows.ts with the executor skeleton (R3, R8):
  - `runFlow(run)` walks the pinned version from the trigger, one node at a time;
  - `HANDLERS` dictionary with `agent` (a turn through `runtime.send`, the reply read from `runtime.finished`, earlier
    data inlined as fenced JSON marked outside) and `end`;
  - one `routine_run_steps` row per node: `running` before, `done`/`failed` after, previews masked and cut at 4000
    chars, the full output in `dataDir/runs/<routine>/<run>/<node>.json` via `path.join` when larger;
  - the run's outcome per R8 (`end` → `nothing`; else the last agent's `outcomeOf`; `needs` when failed or waiting).
- [X] T010 In apps/server/src/routines.ts, send a run whose routine has a `version` to `runFlow` (pin `run.version`
  at start); a routine without one keeps spec 012's `start`. Delivery after a flow run uses the existing `deliver`.

**Checkpoint**: an old routine runs exactly as before; a versioned trigger → agent → end routine runs through
`runFlow` with two step rows.

## Phase 3: User Story 3 — Runs kept step by step, resumable, never writing twice (P1) 🎯 MVP (server)

**Goal**: every run keeps a trace, resumes after a restart, and never repeats a write.
**Independent test**: quickstart.md "Executor" row.

- [X] T011 [P] [US3] In apps/server/src/flows.ts add the pure `neverRan(error, phase)` (R4 table, a dictionary over
  the SDK `ErrorCode`) and the retry rule (reads: any failure; writes: only `neverRan`; up to `retries`, 30 s apart).
- [X] T012 [P] [US3] Write apps/server/src/flows.test.ts for `neverRan`: each error code, a failed `connect()`, and
  an `isError` result for a read and a write.
- [X] T013 [US3] Resume in `recover` (apps/server/src/routines.ts), using `lastStep`:
  - `running` on a read tool, agent, check or condition → run it again (attempt + 1);
  - `running` on a write tool with `mayHaveWritten` → `uncertain`, run `needs`, a Needs you card;
  - `waiting` → keep waiting.
- [X] T014 [US3] Add the routes in apps/server/src/main.ts: `run` (run plus steps), `stepOutput` (reads the file
  under dataDir only, never a path from the client), `resolveStep` (`again` / `skip` / `stop` on an `uncertain` step
  only, else 400). Check the routine's owner on each, like the other routine routes.
- [X] T015 [US3] Tests in apps/server/src/main.test.ts:
  - a three-step run keeps three rows with previews;
  - a restart mid-read reruns the step;
  - a restart mid-write leaves it `uncertain`, and `again` sends it once;
  - a run stays on version 1 after version 2 is saved;
  - a secret in an output is masked in the preview.
- [X] T016 [P] [US3] Create apps/web/src/features/run-trace.tsx (RunTrace board): the timeline with state, duration,
  attempts, input and output previews, "full output" link, the version, and the uncertain card's three buttons.
  Route `#/routine/<id>/run/<runId>` in apps/web/src/state.ts and App.tsx; `RunRow` in routines.tsx links to it.
- [X] T017 [US3] In apps/web/src/features/inbox.tsx, list uncertain steps and run-step approvals with the routine and
  the step name.

**Checkpoint**: SC-003 holds in the restart tests.

## Phase 4: User Story 2 — Any connector's tool as a step (P1)

**Goal**: generic tool steps with schema forms, ids by name, Test now and chat rules.
**Independent test**: quickstart.md "Rules as chat" row, plus Test step on a fake read tool.

- [X] T018 [P] [US2] In apps/server/src/flows.ts add the pure `textFieldOf(schema)`, `listToolFor(field, tools)` and
  `optionsOf(result)` (reusing `watchItems`), with cases in flows.test.ts (`channel_id` finds `list_channels`; no
  match gives none).
- [X] T019 [US2] In apps/server/src/tools.ts:
  - `ToolInfo` carries `inputSchema` and `outputSchema` when declared (update the contract schema in index.ts);
  - `catalogFor(serverId, agent)` gives each tool its `state` (`usable`, `no-access`, `read-only`, `off`,
    `signed-out`) from `mcpRoute` and the account state;
  - `options(serverId, tool, args)` refuses a non-read tool.
- [X] T020 [US2] Add the `tool` handler to `HANDLERS` (apps/server/src/flows.ts):
  - resolve `Value`s from earlier steps;
  - ajv-check the args against `inputSchema` (cached compile per schema);
  - `mcpRoute` with the agent's grants and the run's access (outside → ask); refused → `failed` with the reason;
  - a write asks through `requestApproval(…, { runStepId })` unless always allowed;
  - set `mayHaveWritten` before a write is sent, clear it on the answer; retry per T011.
- [X] T021 [US2] Routes in apps/server/src/main.ts: `tools/:serverId/catalog`, `tools/:serverId/options`,
  `routines/flow/test-step` (a write returns the args it would send, `dry: true`, and calls nothing).
  `saveFlow` ajv-checks every tool node's fixed args.
- [X] T022 [US2] Tests in apps/server/src/main.test.ts with the fake MCP server:
  - a tool step for an agent without write access is refused;
  - a write asks unless always allowed, then is sent once;
  - an outside trigger makes it ask;
  - an error before sending retries, one after doesn't;
  - test-step on a write calls nothing.
- [X] T023 [P] [US2] Create apps/web/src/features/schema-form.tsx: string (enum → choice, `date-time` → date),
  number/integer with limits, boolean, arrays of primitives as chips, anything else as a JSON code field; required
  marks, limit messages; each field can switch to "from an earlier step" (node and path). `@/ui` primitives only.
- [X] T024 [P] [US2] Create apps/web/src/features/tool-picker.tsx (ToolPicker board): grouped by connector, search,
  Reads / Writes filter, disabled tools with their reason and one fix action (sign in again, allow write, turn on).
- [X] T025 [US2] Id fields: when `listToolFor` finds a read tool, the form shows a name picker fed by the options
  endpoint and keeps the id; otherwise a text field. Add the client atoms in apps/web/src/client.ts.

## Phase 5: User Story 1 — Build a routine as steps (P1)

**Goal**: the canvas and the List view edit one graph; saves are versioned.
**Independent test**: spec US1 independent test.

- [X] T026 [US1] Routes `flow` (synthesized graph and `version: null` for an old routine), `saveFlow` (`validateFlow`
  → `FlowInvalid`; `baseVersion` not current → 409; else `addVersion`) and `flowVersion` in apps/server/src/main.ts,
  with tests in main.test.ts (old routine → synthesized; bad graph names the node; stale base → 409).
- [X] T027 [P] [US1] Create apps/web/src/features/flow-panel.tsx: the side panel per kind (a dictionary from kind to
  panel); the tool panel uses schema-form and tool-picker; Test step calls test-step and shows the result.
- [X] T028 [P] [US1] Create apps/web/src/features/routine-flow.tsx (Flow board), loaded with `React.lazy` from
  routines.tsx only:
  - module-level `nodeTypes` of `React.memo` nodes;
  - `isValidConnection` calls `connectionProblem` and shows its reason in one line;
  - add a step on an edge or at the end; the panel opens on select;
  - the library CSS plus one scoped override sheet on DESIGN.md tokens (`check:ui` must pass).
- [X] T029 [P] [US1] Create apps/web/src/features/flow-list.tsx: the same graph in topological order with branches
  indented; add, edit, reorder and remove by keyboard; usable at phone width.
- [X] T030 [US1] Editor shell in routines.tsx: Canvas / List segmented (remembered like `zorel.routinesView`), one
  graph state shared by both views, Save with `baseVersion`, save errors pointing at the node and field, version shown.
  Route `#/routine/<id>/flow` in state.ts and App.tsx.
- [X] T031 [US1] i18n for the editor, panels, picker, form, trace and errors in packages/i18n/src/en.ts.

**Checkpoint**: P1 done. Manual steps 2 and 3 of quickstart.md pass.

## Phase 6: User Story 4 — More triggers, each testable (P2)

- [X] T032 [P] [US4] Pure `nextScheduled(schedule, zone, from)` in apps/server/src/flows.ts for `once`, `date` and
  `monthly` (day 29–31 → last day), with tests (day 31 in a 30-day month, February, another zone).
- [X] T033 [US4] In apps/server/src/routines.ts: `tick` uses `nextScheduled` for non-cron schedules; `once` turns the
  routine off after its run; watches poll at `watchEvery` (1/5/15/60, never under 1 min); the message preset is a
  watch with its own trigger panel.
- [X] T034 [US4] Route `routines/flow/test-trigger` in main.ts: run the watch tool once, `freshItems` without saving
  seen ids, then the filter and the check; return items with a verdict; start no run. Tests: verdicts on a fake
  channel tool, no run row added; `once` turns off.
- [X] T035 [US4] Trigger panel in flow-panel.tsx (Trigger board): every kind from FR-014, the interval, the filter,
  channel ids by name (T025), Test now with the verdict list.

## Phase 7: User Story 5 — Send the result to a connector (P2)

- [X] T036 [US5] `RoutineDelivery.connectors` in packages/contracts/src/index.ts; `settingsOk` ajv-checks each
  destination's args.
- [X] T037 [US5] A `connector` entry in the `CHANNELS` dictionary (apps/server/src/routines.ts): reuse the tool
  handler with its own always-allow key; skip on `nothing`; never resend after an uncertain failure; pass the thread
  id when `inThread` and the tool takes one.
- [X] T038 [US5] Tests: a destination posts after approval; `nothing` posts nothing; an uncertain post is not resent.
- [X] T039 [US5] Deliver panel (Deliver board) in flow-panel.tsx: pick connector and tool, the text field from
  `textFieldOf` or a choice, other fields by name, "reply in thread", preview and dry test.

## Phase 8: User Story 6 — Branch, ask, end quietly (P2)

- [X] T040 [US6] Handlers in apps/server/src/flows.ts:
  - `check`: spec 012's triage with the node's "only when…" → decision;
  - `condition`: a `RULES` dictionary (`hasItems`, `isEmpty`, `contains`, `equals`) or the cheap model's yes/no;
    on model failure take `defaultBranch` and note it on the step;
  - `approval`: `requestApproval(…, { runStepId })`, Telegram when paired; approved → main path, declined → `no`
    branch or end, expired → end; the branch kept on the step row.
- [X] T041 [US6] Tests in main.test.ts: the US6 independent test (matching messages reach the agent, others end with
  outcome `nothing` and no notice); condition default on model failure; approve / decline / expire paths.
- [X] T042 [US6] Condition, check and Ask me panels in flow-panel.tsx; branch labels on canvas edges and indented
  branches in the List view.

## Phase 9: Polish

- [X] T043 Edge cases: a tool removed or with a new required input marks the step "needs attention" and stops the run
  there; a deleted connector blocks turning the routine on.
- [X] T044 Playwright screenshots against the design boards (quickstart manual steps 1–3). Disable sample routines on
  the test server before visiting (spec 012 lesson).
- [X] T045 Run `bun run test && bun run typecheck && bun run check:ui && bun run check:i18n && bun run lint`.
- [X] T046 Update `.agent/memory/server.md`, `web.md`, their changelogs and the index; mark spec.md Implemented with
  As-built notes.

## Dependencies

- Phase 1 → Phase 2 → everything else.
- US3 (Phase 3) and the server half of US2 (T018–T022) can run in parallel after Phase 2.
- US1 (Phase 5) needs T019 (catalog) for the tool panel; its canvas and list (T028, T029) can start right after
  Phase 2.
- US4, US5, US6 each need Phase 2 and the tool handler (T020); they are independent of each other.

## Parallel examples

- After Phase 2: T011 + T012 + T018 + T023 + T024 + T028 + T029 (different files).
- P2: T032 alongside T036.

## Implementation strategy

1. MVP = Phases 1–3 + T018–T022: flows run durably on the server with tool steps, testable by API.
2. Add Phase 5 and the rest of Phase 4: the editor is usable.
3. Add US4–US6 one at a time; each is testable on its own.

## As built (P1-a, 2026-11-10)

- The server half is done: contract, versions, executor, resume, approvals per run step, tool steps, catalog, options,
  Test step, run detail, step output and resolve. Tests: packages/contracts/src/flow.test.ts,
  apps/server/src/flows.test.ts, apps/server/src/flows.run.test.ts (fake MCP server, stub runtime: restarts are the
  rows left halfway, then `resumeFlow`), and the "routine flows (spec 013)" test in main.test.ts.
- The handlers for check, condition and "Ask me" (T040) are written in flows.ts with the rest; their tests (T041) and
  panels (T042) are still open.
- Changes from the plan:
  - a value from an earlier step is `{ $from, path? }`, not `{ from }` (a literal object with a `from` key stays a literal);
  - the agent step has no `agentId` (the routine's agent answers);
  - routes: `GET /api/mcp/:id/catalog?agentId`, `POST /api/mcp/:id/options`, `POST /api/routines/:id/flow/test-step`,
    `GET /api/routines/:id/runs/:runId` (endpoint `runDetail`);
  - `Hub.call` sends `tools/call` itself instead of the SDK's `callTool`. The SDK's `callTool` throws InvalidParams after
    the tool ran when the result doesn't fit the tool's outputSchema. `neverRan` would read that as "refused before
    running" and send a write twice.
  - saving a flow writes its trigger onto the routine's columns (cron, watch, token, day start, look first), so the
    clock, the watch and the webhook stay spec 012's.
- Open: T016 and T017 (the web Run view and Needs you rows), and everything from T023 on.

## As built (P1-b, 2026-11-10)

- Web: flow-editor.tsx (the screen, `#/routine/<id>/flow`), routine-flow.tsx (the React Flow canvas, a lazy chunk:
  61 KB gzip + 3 KB CSS, nothing else loads it), routine-flow.css (React Flow's variables on Zorel tokens),
  flow-list.tsx, flow-panel.tsx (a panel per kind), schema-form.tsx + schema-rules.ts, tool-picker.tsx,
  flow-kinds.tsx (tile, icon, title and line per kind), flow-model.ts (the graph edits both views share: insertAfter,
  removeNode, move, orderOf, layout, earlierValues), run-trace.tsx (`#/routine/<id>/run/<runId>`).
- Needs you lists the writes that may have gone out (`GET /api/routine-steps/uncertain`) and shows an "Ask me" as
  Allow / Deny with what the step before gave. Today and the history open a flow run in the Run view.
- Dialog (ui/dialog.tsx) now fits the window and scrolls its body; the tool list overflowed the screen before.
- The editor runs validateFlow as you edit. It names the step and says what's missing, but not for the step that's
  open. Save is off until the flow is valid.
- Checked on the 4318 test server (Playwright screenshots, dark, 1440 and 390 wide): canvas, adding a step on a
  path, the picker, the form from a real connector's schema, List, the Run view of a model-free flow, the uncertain
  card, Needs you. Resolving "stop" through the API returned 204.
- Still open: T032–T039 (the new triggers with interval and Test now, delivery to a connector), T041 (the branch and
  Ask me tests), T043–T046.

## As built (P2, 2026-11-10)

- Triggers: `on` gains `once` (date + time), `monthly` (day + time; 29–31 fall on a shorter month's last day),
  `message` (a watch on a channel, the same engine) and `every` (1/5/15/60 min). Saving copies them onto
  `routines.schedule` (JSON) and `routines.watch_every` (migration `20261110185116_routine_schedules`).
  `nextScheduled` (routine-runs.ts) feeds the clock and the week's planned runs. A `once` routine turns itself off
  after its run, and saving one in the past is refused (`FlowInvalid`, field `date`).
- Test now for a trigger: `POST /api/routines/:id/flow/test-trigger`. A watch is called once and sorts the items into
  would run, already seen, or skipped by the check. A first look only learns what's there. Nothing is marked seen and
  no run starts. A clock gives its next three times.
- Delivery: `RoutineDelivery.connectors` (at most 3). Each send is the flow tool handler (same access, approvals and
  retries) kept as a run step `deliver:<n>`, started apart so the run's end doesn't wait for an OK. It's skipped when
  nothing is new, and "in thread" passes the trigger item's id into the tool's thread field. A send halfway at a
  restart becomes uncertain (`recoverDeliveries`); `resolveStep` sends again, skips or stops it. Saving checks that
  the tool writes, that the text field is one of its inputs, and the rest with ajv.
- T043: a tool the connector no longer has stops its step with the reason (and the panel says so). Turning on a
  routine whose steps or destinations use a deleted connector is refused.
- Tests: routine-runs.test.ts (nextScheduled), flows.run.test.ts (trigger test, once turns off, delivery, nothing
  posts nothing, uncertain send, condition paths and default, Ask me approve/decline/expire), main.test.ts (P2 routes).
- Screens checked on 4318: monthly trigger with Test now (Nov 30, Dec 31, Jan 31), the destination dialog (write
  tools only, text field found by itself, the connector's error shown).

## Gaps closed (2026-11-10, after review against the spec)

- FR-019: an "Ask me" and a routine's write approval also go to Telegram when paired: `askOnTelegram`, a message
  with Yes/No (Allow/Deny) buttons (callback `ap:<id>:y|n`). Only a paired account's tap decides; the buttons go
  away after it (`answerCallbackQuery`, `editMessageReplyMarkup`). `requestApproval` takes `notify` and returns
  `{ outcome, reason }`.
- US4 AS3: a watch reads several channels (`watch.more`, the same tool with other inputs). A message trigger
  (`each`) starts one run per new message. `freshItems` counts an item read twice in one poll once; before this fix,
  two channels returning the same item made two runs.
- FR-014: the "Only when it mentions" filter (`watch.filter`, words separated by commas, `filterItems`). Test now
  marks what it skips "filtered". Changing the filter doesn't reset what was seen; changing the channels does.
- US5: a destination's "Test without sending" (`POST /api/routines/:id/delivery/test`). It checks the destination
  like a save, then shows the arguments with the last result as the text.
- An earlier step's output fields are picked from the tool's `outputSchema` (now in the catalog), or from what that
  step's last test gave (`pathsFromSchema` / `pathsFromSample`); otherwise the field is typed.
- Design details: "Edit the text first" on an Ask me (the edited text is what the next steps get); the Run view's
  "If Zorel stops now, this run picks up at step N"; the agent panel's Agent and Can use; unsaved steps kept as a
  draft per routine and version (`zorel.draft.flow.<id>`), offered back with Discard.
- Checked end to end on 4318 with a real agent (Claude Code, Atlas): trigger, agent, condition, Ask me (26 s),
  approved from Needs you with edited text, end. Telegram was not checked live (no bot paired): `parseCard` is
  tested, the send isn't.
