# Implementation Plan: Useful Routines

**Branch**: `feat/browser-cursor-review` (spec folder `012-useful-routines`) | **Date**: 2026-11-10 | **Spec**: [spec.md](./spec.md)

**Input**: `specs/012-useful-routines/spec.md`. Designs: https://claude.ai/artifact/9YF5TKK1BBKX28mPtNZxEg

## Summary

Routines get a **run record** (`routine_runs`, R1). It holds four things:
- **the outcome**: the agent's own last-line marker, read without a model (R3);
- **the delta**: the previous run's report goes into the next prompt (R5);
- **the queue**: outside events wait as queued rows instead of being skipped (R2);
- **the cheap check**: an optional small-model gate before watch runs (R6).

A **time profile** (preferences, R7) and **delivery settings** per routine (R8) decide whether, when and where a run
is told:
- notification, through a new `notices` RPC stream;
- Telegram;
- a knowledge page;
- only the morning brief.

**Today** and the **week view** read the run rows (R9). Calendar and e-mail later plug in as new trigger sources
(FR-016), with no change here.

## Technical Context

- **Language/Version**: TypeScript on Bun 1.4.4.
- **Primary Dependencies**: Effect 4 (HttpApi, rpc, PubSub), Drizzle 1.0.0-rc.5 on SQLite, croner 10 (already in
  the server), React 19 with react-aria and Tailwind v4 on the web. No new dependency.
- **Storage**:
  - a new table `routine_runs`;
  - 6 new columns on `routines`;
  - 5 preference keys.

  It all goes in one generated migration.
- **Testing**: bun test. A new `routine-runs.test.ts` covers the pure rules; `main.test.ts` covers end to end with
  the fake engine. Playwright screenshots for the UI.
- **Target Platform**: the local server and the web/desktop app, on Windows, macOS and Linux. Time zones come from
  `Intl` and croner's `timezone`. Nothing is OS-specific.
- **Project Type**: a monorepo with a web service and a web app.
- **Performance Goals**:
  - Today is one indexed query;
  - the week view is one query plus planned runs, capped at 200;
  - the cheap check is one small-model call, with a 20 s timeout.
- **Constraints**:
  - existing routines behave as before (FR-014), with notification delivery and "when there is something";
  - outside runs keep spec 011's cap (FR-015);
  - every text sent to a model is in English.
- **Scale/Scope**:
  - server: routines.ts, schedule.ts, a new routine-runs.ts, runtime.ts (only the `finished` stream), telegram.ts,
    chat.ts (usage in `collect`), db.ts, schema.ts, main.ts;
  - web: a new today.tsx, routines.tsx, notify.tsx, sidebar, settings and client;
  - contracts and i18n.

## Constitution Check

| Principle | Status |
|---|---|
| I. Scope and Simplicity | ✅ One new table, no new dependency or service. The later items (feedback memory, agenda, modules) stay out. Pure rules live in one new module, because routines.ts holds effects only. |
| II. Security | ✅ New routes behind the session secret, with the routines group's authorization. Inputs validated by schemas: zone checked with `Intl`, `HH:MM`, a range of at most 31 days, `pageId` in reach. Outside runs keep the "ask" cap. The cheap check has no tools. Telegram goes only to the paired chat. |
| III. Explicit Errors | ✅ A failed cheap check falls back to the agent and is logged. A failed delivery is logged and noted on the run. The webhook overflow answers 429 with a reason. |
| IV. Cross-Platform | ✅ Zones through `Intl` and croner. No OS tools. |
| V. Language | ✅ The marker instruction and the delta block are English text for the model. UI text goes through i18n. The agent replies in the person's language as it does today: the marker is the only fixed English, and it is removed. |
| Architecture | ✅ The new types live in `packages/contracts`. The notices stream is RPC, like the others. |

Post-design re-check: ✅. One risk is accepted and documented in R3: a viewer of the live chat may see the marker
line for a moment.

## Project Structure

```text
specs/012-useful-routines/  plan.md research.md data-model.md contracts/api.md quickstart.md tasks.md
apps/server/src/
  schema.ts, drizzle/<new>/        routine_runs, routine columns
  routine-runs.ts (+ .test.ts)     pure: outcomeOf, shouldTell, inQuiet, dayStartDue, todayOf, plannedRuns
  routines.ts                      queue + dispatcher, day start, cheap check, finished-turn handler, delivery
  schedule.ts                      runText + marker/delta blocks; nextRun with timezone
  runtime.ts                       finished stream
  chat.ts                          collect reads usage
  telegram.ts                      sayToPaired; activity on paired messages
  db.ts                            runs CRUD, today, week, prefs, agentTokensSince + triage
  main.ts                          routes, hooks 429, activity, time prefs
packages/contracts/src/index.ts, events.ts (Notice), packages/i18n/src/en.ts
apps/web/src/
  client.ts                        atoms: todayAtom, weekRunsAtom, notices
  features/today.tsx (new)         the brief
  features/routines.tsx            Week/List, week grid, detail sections
  features/notify.tsx              notices → notifications; routine chats skip "done"
  features/sidebar.tsx, settings.tsx, state.ts, App.tsx   Today place, "Your day" row
```

**Structure Decision**: edit in place. The only new files are routine-runs.ts with its test, and today.tsx.

## Delivery order

1. **P1 (MVP)**: run record, outcome, delta, queue, cheap check, notices, and suppressing the routine "done"
   notification.
2. **P2**: time profile, quiet hours, day start, delivery (Telegram, page, brief only), Today.
3. **P3**: week view.

## Complexity Tracking

None.
