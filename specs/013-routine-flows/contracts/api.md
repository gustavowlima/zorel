# Contracts: Routine Flows

Every route is in the routines group (or tools for the tool listing), behind the session secret and its
authorization. Inputs are decoded by schemas; errors carry messages only.

| method | path | in | out | errors |
|---|---|---|---|---|
| GET | /api/routines/:id/flow | — | `{ version: n \| null, graph: FlowGraph }` (synthesized for an old routine) | 404 |
| PUT | /api/routines/:id/flow | `{ graph: FlowGraph, baseVersion: n \| null }` | `{ version: n }` | 400 `FlowInvalid { nodeId?, field?, problem }`; 409 when `baseVersion` isn't current; 404 |
| GET | /api/routines/:id/flow/versions/:n | — | `{ graph }` | 404 |
| POST | /api/routines/:id/flow/test-step | `{ nodeId, graph }` (a tool step) | `{ output, dry, error }` (a write is never called) | 400, 404 |
| POST | /api/routines/:id/flow/test-trigger | `{ graph }` | `{ items: [{ preview, verdict: "runs" \| "seen" \| "checked-out" }], times, note, first }` | 400, 404 |
| GET | /api/mcp/:id/catalog | `?agentId` | `[{ name, description, cls, inputSchema, outputSchema?, state: "usable" \| "no-access" \| "read-only" \| "off" \| "signed-out" }]` | 404 |
| POST | /api/mcp/:id/options | `{ tool, args }` (a read tool only) | `[{ id, label }]` | 400 (not a read tool), 404 |
| GET | /api/routines/:id/runs/:runId (`runDetail`) | — | `{ run: RoutineRun, steps: RunStep[] }` | 404 |
| GET | /api/routines/:id/runs/:runId/steps/:stepId/output | — | `{ text }`, the whole output (masked) | 404 |
| POST | /api/routines/:id/runs/:runId/resolve | `{ stepId, choice: "again" \| "skip" \| "stop" }` (an uncertain step) | `{}` | 400, 404 |

`create` and `update` on routines accept `schedule`, `watchEvery` and `delivery.connectors`. Each connector
destination's `args` are validated against the tool's schema (ajv) on save.

| GET | /api/routine-steps/uncertain | — | `[{ routineId, runId, stepId, nodeId, at }]` (Needs you) | — |

## Shared code (packages/contracts/src/flow.ts)

- `FlowGraph`, `FlowNode`, `FlowEdge`, `PORTS`, `connectionProblem(from, to, branch)`, `validateFlow(graph)` and
  `synthesizeFlow(routine)`.
- They are pure, unit-tested in `flow.test.ts`, and imported by both the server and the editor.

## Server internals

- `flows.ts`: `runFlow(run)` (the executor), `HANDLERS[kind]`, `neverRan(error, phase)`, `textFieldOf(schema)`,
  `listToolFor(field, tools)`, `optionsOf(result)`, `nextScheduled(schedule, zone, from)`.
- `RuntimeService.requestApproval(chatId, agent, req, anchor)`, extracted from `waitFor`.
