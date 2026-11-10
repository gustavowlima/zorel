# Implementation Plan: Routine Flows

**Branch**: `feat/browser-cursor-review` (spec folder `013-routine-flows`) | **Date**: 2026-11-10 | **Spec**: [spec.md](./spec.md)

**Input**: `specs/013-routine-flows/spec.md`. Designs: https://claude.ai/artifact/9YF5TKK1BBKX28mPtNZxEg

## Summary

A routine gains a versioned **flow**: a trigger and up to 30 typed steps, defined once in `packages/contracts` and
validated the same way by the editor and the server (R1, R2).

A durable **executor** (`flows.ts`) runs a flow node by node:
- it keeps a row per step and resumes after a restart;
- it never repeats a step that may have written, and retries only calls that surely never ran (R3, R4);
- it applies the same grants and approvals as a chat (R5);
- approvals can belong to a run step, not only a turn.

Tool steps work with **any MCP connector**: forms come from the tool's input schema (ajv checks on the server), and ids
are picked by name through a read tool of the same connector (R6, R7). Triggers gain once, a date, monthly, the check
interval and Test now (R9). Delivery can post to a connector tool (R10).

The editor is **React Flow**, loaded lazily, with a List view of the same graph (R11).

Routines saved before this feature keep the spec 012 path until they are saved in the editor.

## Technical Context

- **Language/Version**: TypeScript, Bun 1.4.4.
- **Primary Dependencies**:
  - in use: Effect 4, Drizzle 1.0.0-rc.5 on SQLite, croner 10, `@modelcontextprotocol/sdk` 1.32.2, React 19 with
    react-aria;
  - **new**: `@xyflow/react` 12.12 (web, lazy) and `ajv` 8 (server; already installed through the MCP SDK).
- **Storage**:
  - new tables `routine_versions` and `routine_run_steps`;
  - new columns on `routines` and `routine_runs`;
  - `approvals.turn_id` nullable plus `run_step_id`.

  One generated migration.
- **Testing**: bun test (contract, pure rules, end to end with a fake MCP server), Playwright screenshots.
- **Target Platform**: Windows, macOS, Linux; nothing OS-specific.
- **Project Type**: monorepo web service and web app.
- **Performance Goals**:
  - the editor responds instantly at 30 steps (the library measured fine at 2000);
  - Test now under 5 s on a responsive connector;
  - one DB write per step transition.
- **Constraints**:
  - FR-020: old routines run unchanged;
  - FR-010: no step widens access;
  - outside text keeps spec 011;
  - every model-facing text in English.
- **Scale/Scope**:
  - contracts: `flow.ts` plus its tests;
  - server: `flows.ts` (executor and pure rules), routines.ts (dispatch to the executor, triggers), runtime.ts
    (`requestApproval` extract), tools.ts (catalog with state, options), db.ts, schema.ts, main.ts;
  - web: `routine-flow.tsx` (canvas, lazy), `flow-list.tsx`, `flow-panel.tsx` (the step panels), `schema-form.tsx`,
    `tool-picker.tsx`, `run-trace.tsx`, routines.tsx (open the editor), inbox.tsx (flow approvals and uncertain
    steps), i18n.

## Constitution Check

| Principle | Status |
|---|---|
| I. Scope and Simplicity | ✅ Two dependencies, both justified: React Flow saves about 3k lines and measured fastest; ajv is already in the tree. No expression language, loops or parallel branches. Old routines keep their path (no rewrite). |
| II. Security | ✅ Tool steps reuse `mcpRoute` grants and approvals. Writes ask by default. Outside text means "ask". A write is never repeated after an uncertain failure. The server validates every graph and every args set (ajv). Outputs are masked before they are kept. The options endpoint calls read tools only. |
| III. Explicit Errors | ✅ Every step failure is kept with its reason. A failed save names the node and the field. Uncertain writes go to the person, never silently retried. |
| IV. Cross-Platform | ✅ No OS code. The full output files go under dataDir via `path.join`. |
| V. Language | ✅ Agent and check prompts in English. UI strings in i18n. Node labels are user content. |
| Architecture | ✅ The flow contract is in `packages/contracts`, shared by both sides. |

Post-design re-check: ✅. The approvals table change is the riskiest migration (a table rebuild), and it is covered by
the existing approval tests plus new ones.

## Project Structure

```text
packages/contracts/src/flow.ts (+ flow.test.ts), index.ts (endpoints, ToolInfo schema fields)
apps/server/src/
  schema.ts, drizzle/<new>/        versions, run steps, columns, approvals change
  flows.ts (+ flows.test.ts)       executor, HANDLERS, neverRan, textFieldOf, listToolFor, optionsOf, nextScheduled
  routines.ts                      versioned runs → runFlow; schedules; watch_every; test-trigger
  runtime.ts                       requestApproval(chatId, agent, req, anchor)
  tools.ts                         catalog with state per agent, outputSchema, options
  db.ts, main.ts, main.test.ts
apps/web/src/features/
  routine-flow.tsx (lazy: React Flow canvas), flow-list.tsx, flow-panel.tsx, schema-form.tsx,
  tool-picker.tsx, run-trace.tsx, routines.tsx, inbox.tsx
apps/web/src/state.ts, App.tsx     route #/routine/<id>/flow and #/routine/<id>/run/<runId>
packages/i18n/src/en.ts
```

## Delivery order

1. **P1-a**: contract and validation; versions; executor with tool, agent and end steps; durable rows and resume;
   neverRan; `requestApproval` for run steps.
2. **P1-b**: the editor (canvas and List), the tool picker and schema form, Test step, Run view.
3. **P2**: triggers (once, date, monthly, interval, message preset, Test now), connector delivery, condition, check and
   "Ask me" steps.

## Complexity Tracking

| Choice | Why needed | Simpler alternative rejected because |
|---|---|---|
| `@xyflow/react` dependency | The person chose a canvas editor; the library measured fastest among the ready ones | A hand-made canvas is about 3k lines (OpenBot); a list-only editor was declined |
| `ajv` as a direct dependency | Server-side validation of arbitrary tool schemas (constitution II) | Hand-written JSON Schema checks would be partial; ajv is already installed through the MCP SDK |
| Nullable `approvals.turn_id` | Run steps need approvals without a model turn | A fake turn per tool step would fight the runtime's queue and boot recovery |
