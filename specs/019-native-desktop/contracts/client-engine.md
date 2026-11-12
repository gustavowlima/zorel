# Client ↔ Engine contract (spec 019)

The native client speaks exactly what the web client speaks. Nothing here is new behaviour; it is the list the Rust
client must implement and the ad hoc messages that move into `packages/contracts` so both clients share one schema.

## Authentication

- Local: `x-zorel-token: <secret>` on every HTTP request and WebSocket upgrade. Secret from the shell, given to the
  server on stdin (`ZOREL_SESSION_STDIN=1`). Names in `@zorel/contracts/session`.
- Team: the server's own sign-in (cookie/credential per origin). Never the local secret.
- Server-side checks unchanged: loopback Host, Origin = Host when present, secret on `/api/*` and `/rpc`.

## Already in contracts (generated to Rust)

| Surface | Source |
|---|---|
| REST `HttpApi "zorel"`, 147 endpoints, 9 groups | `packages/contracts/src/index.ts:842-1055` |
| RPC over WS `/rpc` (JSON): `send`, `steer`, `interrupt`, `retry`, `decide`, `approvals`, streams `subscribeChat`, `subscribeStatus`, `notices` | `packages/contracts/src/events.ts:224-241` |
| ChatEvent union | `packages/contracts/src/events.ts` |

RPC envelope (`Request`, `Chunk`, `Exit`, `Ack`, `Ping`, `Eof`) is Effect's; the Rust client implements it and a
contract test runs it against a live engine.

## Moves into contracts (Phase A)

| Message | Today | New home |
|---|---|---|
| Browser socket `/api/browser?chat=`: state JSON + JPEG binary down, `PanelFrame` up | `apps/server/src/browser.ts:836-851,965` | `packages/contracts/src/browser.ts` |
| Terminals socket `/api/terminals` frames | `apps/web/src/features/shell.tsx:86-90` | `packages/contracts/src/terminal.ts` |
| Attachment upload (raw body + `x-file-name`), `GET /api/attachments/:id` | `apps/web/src/client.ts:384-393` | `HttpApi` group or documented schema |
| `/api/search`, `/api/workspace/import`, `/api/server`, `/api/setup`, `/api/invite/:id`, `/api/chats/:id/terminals`, `/api/browser/picture` | ad hoc | `HttpApi` groups |

## Generation

`scripts/export-schema.ts` → `packages/contracts/schema/openapi.json` + `packages/contracts/schema/rpc.json` + `packages/contracts/schema/sockets.json` (checked in) →
`apps/native/build.rs` (typify) → Rust types. CI regenerates and fails on `git diff`.
