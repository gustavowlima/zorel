# Research: Architecture Hardening

Everything here was read in the code on 2026-11-10. No outside source was needed.

## R1. Where a turn's access is decided

- **Decision**: add one helper, `turnAccess(chat, agent, row) = row.outside ? "ask" : effectiveAccess(chat, agent)`
  in apps/server/src/runtime.ts. Use it in every place that today calls `effectiveAccess(chat, agent)` for the
  running turn:
  - `runTurn` (the `access` passed to `engineStream`, which sets the native harness's permission mode);
  - `openTools`: `askFirst` (~l.406), the preview approval (~l.492) and `mine` in `taskCall` (~l.524).
- **Why "ask" and not `narrower(…, "ask")`**: `RANK` in team.ts is `ask 0 < workspace 1 < full 2`. "ask" is already
  the narrowest level, so capping at it always gives "ask". It is still a cap: nothing is ever widened (FR-003).
- **Rationale**: one rule in one place. The approval flow, the "always allow" rules (an edge case in the spec) and the
  routine policy (decline and report, or wait) already work at "ask".
- **Alternatives rejected**:
  - Change the chat's `access` for routine chats: that would also cap the person's own messages there (FR-002).
  - A new access level: none is needed.

## R2. What counts as outside, and how it travels

- `runRoutine(id, key, payload, label)` (routines.ts) is the only path that starts a webhook or watch run. `payload`
  is set exactly when outside text is included: the webhook body, or the watched connector's new items. Cron runs and
  "Run now" have no payload.
- **Decision**:
  - `runRoutine` passes `outside: payload !== undefined` to `runtime.send`, as a second argument
    `send(input, { outside })`. It is not a field of the RPC `SendInput`: a client can never set it, and nothing in
    `packages/contracts` changes.
  - It is stored on the turn (`turns.outside`) and on the user message the run adds (`messages.outside`).
- **Inheritance**:
  - `chain` → `enqueueAgent(…, outside)` copies `row.outside` to hand-offs and team calls.
  - `startTask` gets the flag from `taskCall` (which has `row`). The task chat's first message and its turn are
    marked. The task chat's `access` is left as is: the flag on its turns does the capping.
  - `reportTask`: when the task chat holds an outside message, the reported message and the asker's follow-up turn
    are marked too.
  - The wrap-up turn in `chain` (~l.1301) copies the flag.
  - The assistant reply of an outside turn is saved with `outside = true`. It may quote the payload.
- **Telegram**: goes through `runtime.send` without the flag, so the person's own access applies (spec assumption).

## R3. Memory from outside text

- Today a fact is saved without review only when `Preferences.memoryApproval === "undo"`. That applies in two places:
  - `consolidate` (chat.ts ~l.335, `onItsOwn`);
  - `rememberCall` (runtime.ts ~l.650, `kept`).
- The agent's "auto" mode is not involved: the spec's wording was corrected accordingly.
- `grounded()` treats every `role: "user"` message as the person. An outside run's message is `role: "user"`, so a
  payload passes as "what the person said".
- **Decision**:
  - `consolidate`: if `store.hasOutside(chatId, after, until)` is true for the stretch, `onItsOwn = []`. The facts
    still become proposals.
  - `rememberCall`: `kept = … && !row.outside`.
- **Alternative rejected**: dropping outside messages from learning altogether. A webhook routine's own results (a
  daily report) are worth remembering; review is enough protection.

## R4. Silent failures

- `Effect.ignore` on background learning in runtime.ts:
  - l.1404: consolidate "window", when a worker ends;
  - l.1425: consolidate "quiet";
  - l.1712: `mapEarlierFacts` on start.
- l.1718 (the map's nightly sleep) already logs inside `sleep`; its outer `ignore` is harmless and stays.
- `consolidate` already logs a model failure (chat.ts l.297). What `ignore` hides are the typed `Busy` and `NotFound`
  results (expected: not failures, FR-006) and defects or database errors (unexpected: FR-005).
- **Decision**: one local helper, `quietly(what, chatId)`. It does `Effect.catchTags({ Busy, NotFound })` to void,
  then `Effect.catchCause` to `Effect.logWarning(\`${what} failed\`, { chatId, cause })`.
  - The global `maskedLogger` (observability.ts l.44) masks credentials in every log line, which covers FR-005's
    masking.
  - `mapEarlierFacts` has no `NotFound`/`Busy`, so only the cause log applies.

## R5. Routes set aside

- A saved account at its limit is already persisted: `accounts.hold` → `accounts.limitedUntil`, read by `held()`.
- Not persisted is `skipped` (an in-memory Map, runtime.ts l.963). It takes:
  - a limit on a route with no account (the default login), set to 10 minutes and ignoring `f.until`;
  - every other failure, 10 minutes.
- **Decision**:
  - In the failover branch (~l.1219), a limit with no account is set aside until `f.until ?? now + 1 h`, the same as
    `accounts.hold`. Other reasons keep `SKIP_MS`.
  - `skipped` is saved as JSON in the existing `preferences` table under the key `setAsideRoutes`: `{ [routeKey]:
    { until, reason } }`. It is written on every change and loaded at boot. Entries already past are dropped on load
    and when read.
- **Why preferences**: the table and its `preference`/`setPreference` methods already exist. There are at most a
  handful of entries (one per provider or account), so no migration and no new table.
- **Alternative rejected**: a `route_holds` table. Same data, more code.

## R6. Deleted chat's live state

- `hubs` (runtime.ts l.197) creates one PubSub per chat on first publish or subscribe and never removes it.
- `subscribeChat` already refuses a chat that no longer exists, so a reconnecting window can't bring it back.
- **Decision**: a `forget(chatId)` runtime method. It does `PubSub.shutdown` (open streams end) and deletes the
  hub, and also deletes the chat's `statuses` entry. It is called after `store.removeChat` in the chat remove handler
  (main.ts ~l.322) and in the hidden-builder-chat cleanup (main.ts l.225).
- **Running turn**: deletion already cascades in the database. `forget` runs after the removal, and a late `publish`
  from a turn that is still ending would recreate the hub. To avoid that, `publish` skips chats that `forget`
  removed: a small `gone` Set, cleared when its entry is older than an hour.
  - ponytail: a Set in memory, which is fine because a restart has no hubs to leak.
