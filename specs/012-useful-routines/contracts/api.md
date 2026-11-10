# Contracts: Useful Routines

Every route sits in the existing groups and behind the session secret, with the same authorization as today's
routine routes. Inputs are validated by the schemas, and errors carry messages only.

## HTTP

| method | path | in | out | errors |
|---|---|---|---|---|
| GET | /api/routines/runs | `?from&to` (ms; at most 31 days apart) | `{ runs: RoutineRun[], planned: { routineId, at }[] }` (planned ≤ 200) | 400 range |
| GET | /api/routines/:id/runs | `?before` (paging, 50) | `RoutineRun[]` with `report` | 404 |
| DELETE | /api/routines/:id/runs | — | `{}`: clears the `done` runs, with an audit entry | 404 |
| GET | /api/today | — | `Today` | — |
| POST | /api/today/read | `{ runIds: Id[] }` (≤ 100) | `{}` | — |
| POST | /api/activity | — | `{}` (the web app sends it on focus) | — |
| PUT | /api/preferences/time | `TimeProfile` input: `timeZone` (must be a valid IANA zone), `quietHours` (`HH:MM` both or null), `dayStartMinutes` (0–1439 or null for learned) | `Preferences` | 400 |
| POST | /api/hooks/:token | body (unchanged) | 202 queued | 404 unknown or off, **429 queue full (new)** |

`create` and `update` on routines accept the new fields:
- `delivery.pageId` must be a page in the routine's reach;
- `lookFirst` without a `watch` is refused with 400.

## RPC

- `notices`: a stream of `Notice { id, kind: "routine", runId, routineId, chatId, title, text, outcome }`. The web
  app's notifications read it. Routine chats no longer give the generic "done" notification.

## Internal (server)

- `RuntimeService.finished`: a stream of finished turns `{ turnId, chatId, clientId, state, messageId, usage, cost }`.
- `routine-runs.ts`, all pure and unit tested:
  - `outcomeOf(text)`;
  - `shouldTell(outcome, tell, urgent, quiet)`;
  - `inQuiet(profile, at)`;
  - `dayStartDue(profile, now, activityToday)`;
  - `todayOf(runs, from)`;
  - `plannedRuns(routines, profile, from, to)`.
- `telegram.ts`: `sayToPaired(text) → { sent: boolean }`.
