# Quickstart: Useful Routines

## Automated checks

```sh
bun run test && bun run typecheck && bun run check:ui && bun run check:i18n && bun run lint
```

| Area | File | Proves |
|---|---|---|
| Pure rules | apps/server/src/routine-runs.test.ts | `outcomeOf` (each marker, markdown, missing, cut); `shouldTell` (the full table); `inQuiet` (across midnight, edges); `dayStartDue` (first activity, cut-off, once a day, zone); `todayOf` (groups, order, folded count); `plannedRuns` (cron in zone, day start, cap) |
| Outcome and delivery | apps/server/src/main.test.ts | A run ending "nothing new" sends no notice. "Something new" sends one. A run that waits for approval is "needs you" before it ends. The marker is removed from the saved reply. |
| Delta | main.test.ts | The second run's prompt holds the first run's report and the "only what changed" line. |
| Queue | main.test.ts | 3 webhooks during a run lead to 3 runs, in order. The 21st waiting gets 429. Queued runs survive rebuilding the server on the same database. |
| Cheap check | main.test.ts | A fake check answering `act: false` ends the run "nothing new" with no turn. A failing check starts the agent. |
| Quiet hours | main.test.ts | A run inside quiet hours is held, no notice, and shows in `/api/today`. An urgent "needs you" still notifies. |
| Page and Telegram | main.test.ts | A page delivery writes a new version. Telegram not paired falls back to a notice, with the note. |

## Manual check (dev server, Playwright screenshots)

1. Routines › Week: last week's runs by outcome, the planned runs dashed, the quiet band, the day-start line.
2. Create a "When my day starts" routine. Next morning, the first click in the app runs it once.
3. Today: Needs you, From your routines and the folded quiet count. Opening an item marks it read.
4. A phone-width window: the week grid scrolls inside its box.
