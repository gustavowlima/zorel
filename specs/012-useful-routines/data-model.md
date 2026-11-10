# Data Model: Useful Routines

## RoutineRun (new table `routine_runs`)

| field | type | rule |
|---|---|---|
| id | text PK | generated |
| routine_id | text FK routines ON DELETE CASCADE | Deleting a routine takes its queued runs. The edge case also wants past runs kept in the brief until read; we accept losing them, because the brief reads from this table. |
| trigger | text enum `schedule` \| `day_start` \| `now` \| `webhook` \| `watch` | where it came from (FR-016's source) |
| payload | text JSON, null | the event's content (webhook body, new items), kept while queued |
| label | text, null | what the payload is ("New from GitHub (list_runs)") |
| state | text enum `queued` \| `running` \| `done` | |
| outcome | text enum `nothing` \| `something` \| `needs`, null until known | can become `needs` while running (waiting) |
| summary | text, default "" | first line of the reply, or the cheap check's "Checked: …", ≤ 200 chars |
| report | text, default "" | reply without the marker, ≤ 4000 chars (the next run's "previous run") |
| turn_id | text, null | the run's own turn; null when it ended at the check |
| message_id | text, null | its reply |
| triage_tokens | integer, default 0 | the cheap check's input+output, counted in the agent's month |
| cost | real, null | from the turn |
| held | integer boolean, default false | a ping held by quiet hours or by "brief only" |
| delivered_at | integer, null | when it was told, on any channel |
| delivery_note | text, null | e.g. "telegram not paired" |
| read_at | integer, null | opened or answered on Today |
| created_at / started_at / ended_at | integer | ms |

Index: `(routine_id, state, created_at)` for the queue, and `(created_at)` for Today and the week.

Retention (FR-017): once a day, with the memory map's nightly sleep, `done` runs older than 90 days are deleted,
except the newest 50 of each routine. Queued and running runs are never pruned. "Clear history" deletes a routine's
`done` runs. The chat messages stay: they belong to the chat.

Transitions:

```text
queued --dispatcher--> running --turn ends--> done
   \--cheap check "no"--------------------> done (outcome nothing, no turn)
running --chat waiting--> running (outcome needs, delivered at once)
running --boot finds its turn interrupted--> done (outcome needs, summary "Stopped by a restart")
```

## Routine (existing `routines`), new columns

| field | type | rule |
|---|---|---|
| on_day_start | integer boolean, default false | runs once per local day at the first activity or start + 3 h |
| look_first | integer boolean, default false | cheap check before a watch run (only with `watch`) |
| delivery | text JSON, default `{"channels":["notify"]}` | `{ channels: ("notify"\|"telegram"\|"page")[], pageId?: string }` |
| tell | text enum `every` \| `something` \| `brief`, default `something` | |
| urgent | integer boolean, default false | a "needs you" pings in quiet hours |
| day_ran_on | text, null | local date (`YYYY-MM-DD`) of the last day-start run, so it runs once a day |

`last_status` stays for compatibility. It is set from the newest run.

## Preferences (existing table), new keys

| key | value |
|---|---|
| `timeZone` | IANA name; default the server's zone |
| `quietHours` | `{"from":"21:00","to":"07:00"}` or null |
| `dayStart` | `{"minutes": number \| null, "learned": number[]}` (≤ 14 learned values, minutes after local midnight) |
| `lastActivityDay` | local date of the last activity, so only the first activity of a day counts |
| `briefAt` | `{"current": ms, "previous": ms}`: the day starts that bound Today |

## Contracts (packages/contracts)

- `RoutineOutcome = "nothing" | "something" | "needs"`, `RoutineTrigger`, `RoutineRun` (the table's fields minus
  `payload`; `report` only on the detail endpoint).
- `RoutineDelivery`, `RoutineTell`. `Routine`, `NewRoutine` and `RoutinePatch` gain `onDayStart`, `lookFirst`,
  `delivery`, `tell` and `urgent`.
- `TimeProfile = { timeZone, quietHours, dayStartMinutes, learned: boolean }`, inside `Preferences` plus a `PUT`.
- `Today = { from, needs: RoutineRun[], found: RoutineRun[], quiet: number }`.
- `Notice` (RPC stream `notices`).

## As built (2026-11-10)

- **Migration:** `apps/server/drizzle/20261110144537_routine_runs`.
- **New files:**
  - `routine-runs.ts`, the pure rules;
  - `time-profile.ts`, the preferences and activity;
  - `routine-week.tsx`, the week grid;
  - `your-day.tsx`, the settings.

  The last two are split out so `routines.tsx` and `settings.tsx` stay readable.
- **Look first** works for webhooks too, not only watched connectors: "something happens" covers both, and the
  webhook was the only way to exercise it end to end in the tests. The API refuses it without a webhook or a watch.
- **Dispatcher:** it doesn't wait for an idle chat, because the runtime already queues the turn behind. It never
  starts a disabled routine's queued runs; this was found live on the test server, where a queued run of a turned-off
  routine started.
- **Retention:** it runs from the routines tick once a day, keeping the last time in memory, not from the runtime's
  nightly sleep.
- **Week view:** it uses the browser's zone for drawing. The server's planned runs follow the profile's zone, and the
  two are the same on one computer.
- **Verified live on the 4318 test server**, with two real Claude turns run by mistake:
  - a day-start run ended "Outcome: nothing new", which was read as "nothing", with the marker removed and no ping;
  - a webhook run ended "needs".
- **Not covered by an end-to-end test:**
  - the day-start trigger (it waits for the 30 s tick); the rule itself is unit-tested in `dayStartDue`;
  - the morning brief sent to Telegram.
