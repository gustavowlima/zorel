# Quickstart: Routine Flows

```sh
bun run test && bun run typecheck && bun run check:ui && bun run check:i18n && bun run lint
```

| Area | File | Proves |
|---|---|---|
| Contract | packages/contracts/src/flow.test.ts | `PORTS` and `connectionProblem` refuse a decision into a tool. `validateFlow` catches an unreachable node, a cycle, a missing required field, a duplicate branch and step 31. `synthesizeFlow` covers an old routine |
| Pure server rules | apps/server/src/flows.test.ts | `neverRan` (each error code and phase); `textFieldOf`; `listToolFor` (channel_id finds list_channels); `optionsOf`; `nextScheduled` (once, date, monthly on day 31 in a 30-day month, zone) |
| Executor | apps/server/src/main.test.ts with a fake MCP server | A read tool → agent → end flow keeps three step rows with previews. A write is approved, then sent once. A restart mid-read reruns it. A restart mid-write leaves it `uncertain` with a Needs you card, and "again" sends it once. A tool error before sending retries, and one after doesn't. A run stays on version 1 after version 2 is saved |
| Rules as chat | main.test.ts | A tool step for an agent without write access is refused. A write asks unless "always allowed". An outside trigger means "ask" |
| Triggers | main.test.ts | Test trigger on a fake channel tool returns the new items with verdicts and starts no run. `once` turns the routine off after its run |
| Delivery | main.test.ts | A connector destination posts after approval. An outcome `nothing` posts nothing |
| Old routines | main.test.ts | The spec 012 routine tests still pass unchanged. `GET /flow` on one returns the synthesized graph |

Manual (dev server, Playwright screenshots against the design boards):
1. Build "message arrives → check → condition → agent → ask me → reply in the connector" on the canvas, without typing
   JSON.
2. Switch to List: reorder, remove and add steps by keyboard only.
3. Open a run: the timeline with inputs and outputs, and the version.
