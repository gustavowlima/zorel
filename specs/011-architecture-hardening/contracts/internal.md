# Contracts: Architecture Hardening

No HTTP or RPC contract changes. `packages/contracts` is untouched, so no consumer needs an update.

Internal server interfaces that change:

| Where | Before | After |
|---|---|---|
| `RuntimeService.send` | `send(input: SendInput)` | `send(input: SendInput, opts?: { outside?: boolean })`. Only `runRoutine` passes it. The RPC handler keeps calling `send(p)`. |
| `RuntimeService.forget` | none | `forget(chatId): Effect<void>`. Ends the chat's open event streams and drops its live state. Called after a chat is removed. |
| `store.enqueueTurn` | `{ …, routeTeamId? }` | adds `outside?: boolean`, default false |
| `store.addMessage` | input without `outside` | adds `outside?: boolean`, default false |
| `store.hasOutside` | none | `hasOutside(chatId, after?, until?): Effect<boolean>`: whether any message in the range is outside |
| `TurnRow` | | gains `outside: boolean` |
