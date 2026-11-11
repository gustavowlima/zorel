# Implementation Plan: Architecture Hardening

**Branch**: `feat/browser-cursor-review` (spec folder `011-architecture-hardening`) | **Date**: 2026-11-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/011-architecture-hardening/spec.md`

## Summary

Four server-only fixes from the 2026-11-10 architecture review:

1. **Outside cap**: turns started by webhook or connector-watch routines, and everything they hand off, run at
   "ask" access. Facts from them always go to review (R1–R3).
2. **Visible failures**: background learning failures are logged instead of being swallowed, while the expected
   "busy" and "nothing to do" results stay quiet (R4).
3. **Routes set aside**: the in-memory skip list is persisted in preferences. A limit on the default login is held
   until its reset (R5).
4. **Deleted chats**: deleting a chat releases its event hub (R6).

There are no UI, no contract and no dependency changes.

## Technical Context

- **Language/Version**: TypeScript on Bun 1.4.4.
- **Primary Dependencies**: Effect 4 (HttpApi, rpc, PubSub, Logger) and Drizzle 1.0.0-rc.5 on SQLite, all already
  in use.
- **Storage**:
  - two boolean columns (`turns.outside`, `messages.outside`) in one generated migration;
  - one preference key (`setAsideRoutes`).
- **Testing**: `bun test` (main.test.ts end to end with fake engines, plus runtime.test.ts).
- **Target Platform**: the local server on Windows, macOS and Linux. Nothing here shells out or touches the OS.
- **Project Type**: web service and web app (monorepo). Only apps/server changes.
- **Performance Goals**:
  - one extra indexed lookup (`hasOutside`) per consolidation;
  - one small preference write per route set aside.
- **Constraints**:
  - a turn not started from outside behaves exactly as today (FR-009);
  - no RPC field lets a client set `outside`.
- **Scale/Scope**: about 8 touch points in runtime.ts, 2 in chat.ts, 2 in main.ts, plus db.ts, schema.ts and
  routines.ts.

## Constitution Check

| Principle | Status |
|---|---|
| I. Scope and Simplicity | ✅ No new file outside tests and the migration, no dependency, no refactor (review #2 stays out). |
| II. Security | ✅ The feature is a security fix. The flag is server-only, and the cap only lowers access. |
| III. Explicit Errors | ✅ It removes three silent `Effect.ignore`s, which is this principle's rule. |
| IV. Cross-Platform | ✅ No OS-specific code. |
| V. Language | ✅ No new prompt or UI text. The log messages are in English. |
| Architecture Constraints | ✅ `packages/contracts` is untouched, because the new fields don't cross the network. |

Post-design re-check: still ✅. The design adds no table, only columns and a preference key.

## Project Structure

### Documentation (this feature)

```text
specs/011-architecture-hardening/
├── spec.md
├── plan.md
├── research.md        # R1–R6, decisions with the code lines they touch
├── data-model.md
├── contracts/internal.md
├── quickstart.md
├── checklists/requirements.md
└── tasks.md           # /speckit-tasks
```

### Source Code

```text
apps/server/
├── src/schema.ts       # turns.outside, messages.outside
├── drizzle/<new>/      # generated migration
├── src/db.ts           # enqueueTurn/addMessage take outside; TurnRow.outside; hasOutside
├── src/routines.ts     # runRoutine passes outside when a payload exists
├── src/runtime.ts      # send opts, turnAccess, inheritance (chain, startTask, reportTask),
│                       # rememberCall, quietly(), setAsideRoutes, forget()
├── src/chat.ts         # consolidate: no onItsOwn when the stretch has outside text
├── src/main.ts         # forget() after removeChat (2 places)
├── src/main.test.ts    # outside cap, memory review
└── src/runtime.test.ts # logging, set-aside routes, forget
```

**Structure Decision**: edit the existing server files in place, following each file's style.

## Complexity Tracking

None.
