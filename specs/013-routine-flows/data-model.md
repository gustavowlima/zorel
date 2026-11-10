# Data Model: Routine Flows

## Flow (contracts, `packages/contracts/src/flow.ts`)

```text
FlowGraph   = { nodes: FlowNode[] (≤ 31: trigger + 30), edges: FlowEdge[] }
FlowNode    = { id, kind, x, y, config }
  kind ∈ trigger | tool | agent | check | condition | approval | end
FlowEdge    = { id, from, to, branch?: "yes" | "no" }    // branch only out of condition / approval
PortType    = text | data | decision
PORTS[kind] = { in: PortType[], out: PortType[] }
  trigger   { in: [],                out: [text, data] }
  tool      { in: [text, data],      out: [data] }
  agent     { in: [text, data],      out: [text] }
  check     { in: [text, data],      out: [decision] }
  condition { in: [text, data, decision], out: [decision] }   // edges carry yes / no
  approval  { in: [text, data],      out: [decision] }
  end       { in: [text, data, decision], out: [] }
Value       = literal JSON | { $from: nodeId, path?: string }   // path only on data: "items.0.id"
```

`config` by kind:
- **trigger**: `{ on: schedule | dayStart | watch | webhook | manual, cron?, serverId?, tool?, args?, lookFirst? }`. Saving copies it onto the routine's columns.
- **tool**: `{ serverId, tool, args: Record<string, Value>, retries: 0–3 }`.
- **agent**: `{ prompt }`; the routine's agent answers, given the value the step before handed on.
- **check**: `{ onlyWhen }`.
- **condition**: `{ rule: hasItems | isEmpty | contains | equals | ask, input: Value, arg?, defaultBranch: yes | no }`.
- **approval**: `{ summary, expiresMinutes? }`.
- **end**: `{}`.

`validateFlow(graph)` returns `{ ok: true } | { ok: false, nodeId?, field?, problem }`. It checks:
- exactly one trigger, with no incoming edges;
- every node reachable from the trigger;
- no cycle;
- each edge allowed by `PORTS`, with branch labels exactly where needed and both branches of a condition used at most
  once each;
- required config present;
- at most 30 steps.

## Tables (apps/server/src/schema.ts)

### routine_versions (new)

| field | type | rule |
|---|---|---|
| routine_id | text FK routines ON DELETE CASCADE | |
| n | integer | 1, 2, 3… per routine |
| graph | text JSON | a validated FlowGraph |
| created_at | integer | |
| PK | (routine_id, n) | |

### routines (existing), new columns

| field | type | rule |
|---|---|---|
| version | integer null | current version n; null = a spec 012 routine (synthesized graph, old path) |
| schedule | text JSON null | the non-cron schedules (`once`, `date`, `monthly`); `cron` stays for weekly |
| watch_every | integer, default 5 | minutes between checks: 1, 5, 15 or 60 |

`delivery` (JSON) gains `connectors: Array<{ serverId, tool, args, textField, inThread }>`.

### routine_runs (existing), new column

| field | type | rule |
|---|---|---|
| version | integer null | the version the run uses; null = old path |

### routine_run_steps (new)

| field | type | rule |
|---|---|---|
| id | text PK | |
| run_id | text FK routine_runs ON DELETE CASCADE | |
| node_id | text | |
| attempt | integer, default 1 | |
| state | text enum: running, done, failed, skipped, waiting, uncertain | |
| branch | text null | the branch a condition or approval took |
| input | text, default "" | preview ≤ 4000 chars, masked |
| output | text, default "" | preview ≤ 4000 chars, masked |
| output_file | text null | path of the full output when larger |
| may_have_written | integer boolean, default false | set before a write call is sent, cleared on its answer |
| error | text null | |
| started_at / ended_at | integer | |

Index: `(run_id, started_at)`.

### approvals (existing), changed

| field | change |
|---|---|
| turn_id | becomes nullable |
| run_step_id | new, text null, FK routine_run_steps ON DELETE CASCADE |

There is a check that exactly one of the two is set.

## State of a run step

```text
running --ok--> done
running --error, never ran, attempts left--> running (attempt + 1)
running --error otherwise--> failed           (the run ends "needs you")
running --write sent, server stopped--> uncertain --person: send again--> running
                                                  --skip--> skipped
                                                  --stop--> failed
(approval) running --> waiting --approved/declined/expired--> done (branch)
```
