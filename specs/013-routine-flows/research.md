# Research: Routine Flows

Read in the code on 2026-11-10 unless a source is given.

## R1. One flow contract, shared by the server and the editor

- **Decision**: put the flow types and the rules that read them in `packages/contracts/src/flow.ts`. It holds:
  - `FlowGraph = { nodes, edges }`;
  - the node kinds: `trigger`, `tool`, `agent`, `check`, `condition`, `approval`, `end`;
  - the port types: `text`, `data`, `decision`;
  - a `PORTS` table of what each kind takes and gives;
  - `connectionProblem(from, to, branch)`, used by the editor's `isValidConnection`;
  - `validateFlow(graph)`, which checks reachability, loops (refused), the 30-step cap, required fields and branch
    labels.

  The editor and the save handler both call `validateFlow`, so they can't disagree (FR-003, FR-004, FR-021).
- **Why contracts**: it is already the only place for types that cross the network, and it already holds small pure
  rules (`isTeammate`). Effect Schema decodes the graph at the HTTP boundary.
- **Idea**: one ports table read by every editor (`WORKFLOW_PORTS`).

## R2. Versions and old routines

- **Decision**:
  - a new `routine_versions` table (`routine_id`, `n`, `graph` JSON, `created_at`), plus `routines.version`, the
    current n;
  - `routine_runs.version` pins a run to its version (FR-005);
  - a routine with **no** version is a spec 012 routine. The API returns a synthesized graph for it (trigger, one
    agent node with its prompt, delivery), and it keeps running on spec 012's path, unchanged (FR-020). Its first save
    in the editor creates version 1.
- **Why not migrate rows**: there is nothing to rewrite, and the spec 012 path stays exactly as tested.

## R3. Running a flow, durably

- **Decision**:
  - a new `flows.ts` holds the executor, and a new `routine_run_steps` table holds one row per executed node: `run_id`,
    `node_id`, `attempt`, `state` (`running`, `done`, `failed`, `skipped`, `waiting`, `uncertain`), `input` and
    `output` previews (≤ 4 000 characters), `output_file` (the full result in `dataDir/runs/<routine>/<run>/<node>.json`
    when larger), `may_have_written`, `started_at`, `ended_at`, `error`;
  - a run with a version goes through the executor; one without keeps spec 012's `start`;
  - the executor walks the graph from the trigger, one node at a time, with a handler per kind (a dictionary, not a
    switch).
- **Resume (FR-012)**: on boot, for each run still `running`, look at its last step row:
  - a `running` row on a read tool, agent, check or condition runs again (a read can't harm);
  - a `running` row on a write tool with `may_have_written` becomes `uncertain`, and the person gets a card in Needs
    you: "It may have gone out: send again / skip / stop";
  - an `approval` row that is `waiting` keeps waiting (its approval row survives restarts already).
- **`may_have_written`** is set right before the write call is sent and cleared when the result comes back.

## R4. When a failed call surely never ran (FR-013)

- **Reading the code**:
  - `hub.call` (tools.ts) is `connect()` then `client.callTool()`;
  - `connect()` throwing means nothing was sent;
  - the SDK's `ErrorCode` (`@modelcontextprotocol/sdk` 1.32.2, `types.d.ts`) has `ConnectionClosed` (-32000),
    `RequestTimeout` (-32001), `ParseError`, `InvalidRequest`, `MethodNotFound`, `InvalidParams` and `InternalError`.
- **Decision**: a pure `neverRan(error, phase)` in `flows.ts`:

  | Failure | Never ran? |
  |---|---|
  | the connection didn't open | **yes** |
  | `ParseError`, `InvalidRequest`, `MethodNotFound`, `InvalidParams` (refused before running) | **yes** |
  | `ConnectionClosed`, `RequestTimeout`, `InternalError`, anything else after sending | **no** (it may have run) |
  | a result with `isError` | it ran and reported an error: a read may retry, a write doesn't |

  Retries happen only on "yes" (writes) or on any failure (reads), up to the step's setting (1 by default, max 3,
  30 s apart).
- **The distinction that matters**: "the call never ran, so it can go again" versus "Connection closed", which the
  SDK gives to every call already sent, so a write could go twice.

## R5. Tool steps go through the same rules as a chat (FR-010)

- **Today**: `openTools` in runtime.ts decides with `mcpRoute(perms, server, tool, askFirst)`:
  - whether a tool is exposed (the grant per connector);
  - whether it asks (the server mode, its class, "ask" access);
  - the "always allow" key.

  Approvals are rows in `approvals`, with `turn_id NOT NULL` referencing `turns`.
- **Decision**:
  - extract the approval wait from `waitFor`/`askApproval` into a runtime method `requestApproval(chatId, agent, req,
    anchor)`, where `anchor` is `{ turnId }` or `{ runStepId }`;
  - `approvals.turn_id` becomes nullable and `approvals.run_step_id` is added (one migration; drizzle rebuilds the
    SQLite table);
  - Needs you lists flow approvals with their routine and step;
  - the flow's tool handler calls `mcpRoute` with the routine agent's permissions and the run's access (`turnAccess`
    rules: outside text means "ask"), then `hub.call`.

  It never calls a tool the agent couldn't.
- **Watch polling** (routines.ts) keeps calling read tools directly, as today. It only ever reads.

## R6. Forms from a tool's input schema; validation

- **Today**: `RemoteTool.inputSchema` (tools.ts l.138) is the tool's JSON Schema, and `ToolInfo` sent to the web app
  drops it.
- **Decision**:
  - `ToolInfo` gains an optional `inputSchema` and, when the server declares it, `outputSchema`. A new endpoint lists a
    connector's tools for the picker with each tool's state for the routine's agent: usable, `no-access`, `read-only`,
    `off`, or `signed-out` (FR-009).
  - **Web, `schema-form.tsx`**: draws `string` (with `enum` as a choice, `format: date-time` as a date), `number` and
    `integer` (with min and max), `boolean`, and arrays of primitives as chips. Anything else is JSON in a code field.
    The client checks only required fields, types and limits, so errors show early.
  - **Server**: ajv 8 validates the step's fixed values against the tool's schema when saving and before calling.
    `ajv@8.20.0` is already installed through the MCP SDK (`^8.17.1`), so adding it as a direct dependency brings in
    nothing new.
- **Values from earlier steps**: a field's value is either a literal or `{ from: nodeId, path?: string }`. It is
  resolved at run time. A `data` output with a path reads a field (`items[0].id`); there is no expression language.

## R7. Picking ids by name (FR-007, FR-016)

- **Decision**: a pure `listToolFor(field, tools)`.
  - A field named like `<thing>_id` or `<thing>Id` matches read tools of the same connector whose name holds `<thing>`
    (singular or plural) and `list`, `get` or `search`. The best match is suggested and the person can change it.
  - Calling it, then `optionsOf(result)` (reusing `watchItems` to find the list), gives `{ id, label }` from `id` plus
    `name`, `title` or `label`.
  - With no such tool, the field is a text input.

## R8. Agent, check and condition steps

- **agent**: a turn in the routine's chat, through `runtime.send`, with the node's prompt. Values from earlier steps
  are inlined: text as-is, data as fenced JSON marked as outside text. The turn's reply is the step's `text` output,
  read through the existing `runtime.finished` stream (spec 012). The routine's agent is the default, and the step may
  name another teammate (same reach rules as hand-offs).
- **check**: spec 012's `ask(cheapModel)` with `triageText`, plus the node's "only when…" text. It gives a decision
  (`act`).
- **condition**: a rule from a small dictionary (`hasItems`, `isEmpty`, `contains`, `equals`) over an earlier output
  and path, or `ask(cheapModel)` with a yes/no question. When the model fails, the node's default branch is taken
  (FR-018).
- **approval**: `requestApproval` with `kind: "question"` and the summary. Approved takes the main path, declined the
  `no` branch if one is wired (otherwise the run ends), and expired ends the run.
- **end**: stops. A run that stops on `end` has the outcome `nothing` (spec 012's delivery then stays quiet).
- **Run outcome**: `needs` when it waits or failed; `nothing` on an end step; otherwise the last agent step's
  `outcomeOf` marker, or `something`.

## R9. New triggers (FR-014, FR-015)

- **At a time**: the trigger node holds `schedule`:
  - `{ kind: "weekly", days, time }` becomes cron (as today);
  - `{ kind: "once", at }`: one time; after it runs, the routine turns off;
  - `{ kind: "date", date, time }`: one time;
  - `{ kind: "monthly", day, time }`: computed in a pure `nextScheduled(schedule, zone, from)`, where day 29–31 falls
    back to the month's last day. croner covers the weekly case, and the rest is under 30 lines with tests.
- **Message in a channel**: the same as watch (a read tool, its args from the schema form, only new items), with
  channel ids picked by name (R7). It is a preset of watch, not a separate engine.
- **Interval**: a `watch_every` column (1, 5, 15 or 60 min) replaces the fixed 5 min. The minimum is 1 min.
- **Test now**: `POST /api/routines/test-trigger` runs the watch's tool once, applies `freshItems` against what was
  seen without saving it, then the filter and the check. It returns the items with a verdict each, and starts no run.

## R10. Send to a connector (FR-016, FR-017)

- **Decision**:
  - `RoutineDelivery` gains `connectors: Array<{ serverId, tool, args, textField, inThread?: boolean }>`;
  - `textField` is found by `textFieldOf(inputSchema)`: one required string named `text`, `content`, `message` or
    `body`, else asked;
  - delivery runs the call with the same handler as a tool step, with approval by default, and its own "always allow"
    key;
  - skipped when the outcome is `nothing`; never repeated after an uncertain failure (R4);
  - "in thread": when the trigger item has a thread or message id and the tool takes one (a field named like
    `thread_id`, `parent_id` or `reply_to`), it is passed.

## R11. The canvas (decided)

- `@xyflow/react` 12 (MIT), imported only by `routine-flow.tsx` through `React.lazy`, so other screens don't load it.
- Nodes are `React.memo` components and `nodeTypes` is a module constant ([performance guide](https://reactflow.dev/learn/advanced-use/performance)).
- `isValidConnection` calls `connectionProblem` from contracts.
- The look comes from DESIGN.md tokens. The library's CSS is imported only by the editor, with our overrides in one
  scoped stylesheet, so `check:ui` holds.
- **List view**: the same graph shown in topological order, with branches indented. The editor's state is one graph
  value, and both views edit it.
- Measured on 2026-11-10 (scratchpad benchmark): 2000 nodes open in 65 ms, and drag frames are equal to a hand-made
  canvas at 50 nodes.
