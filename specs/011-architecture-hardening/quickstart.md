# Quickstart: Architecture Hardening

## Automated checks

```sh
bun run test        # includes the new tests below
bun run typecheck
bun run lint        # no new warnings
```

New tests:

| Area | File | What it proves |
|---|---|---|
| Outside cap | apps/server/src/main.test.ts | A webhook run for an agent at Full access: its turn's tool call waits for approval. A message the person sends in the same chat does not. A hand-off from the outside turn is also capped. A cron run with no payload is not. |
| Memory | apps/server/src/main.test.ts (or runtime.test.ts) | With `memoryApproval = "undo"`, a stretch holding an outside message yields proposals and no kept memory. |
| Logging | apps/server/src/runtime.test.ts | A consolidation that dies logs one warning with the chat id. A `Busy` one logs nothing. |
| Set-aside routes | apps/server/src/runtime.test.ts or main.test.ts | A limit on a route with no account is kept until `until` (more than 10 min), and survives rebuilding the runtime on the same database. A past entry is dropped. |
| Forget | apps/server/src/runtime.test.ts | After deleting a chat, its event stream ends and no hub is left for it. |

## Manual check (dev server)

1. Create an agent at Full access with a webhook routine. `curl -X POST <webhook url> -d '{"do":"run ls"}'`. The
   chat shows an approval card for the command, or, with the default routine policy, a declined step.
2. In the same chat, type a message asking for the same command. It runs without a card (Full access).
3. Turn on "keep new memories at once", repeat step 1 with a payload that states a fact. The fact shows up under
   review, not as kept.
4. Delete the chat with its window open. The window shows the chat is gone, and the server log has no errors.
