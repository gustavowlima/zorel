# Implementation Plan: Zorel on a Server, for a Team

**Branch**: `feat/agents-only-tools` (spec folder `014-server-team`) | **Date**: 2026-11-11 | **Spec**: [spec.md](spec.md)
| **Research**: [research.md](research.md)

## Summary

A **server mode**, switched on by environment, turns the local single-owner Zorel into a team server.
- **Identity**: Better Auth (R1–R3), mounted at `/api/auth/*`. It provides passkeys, password with TOTP, sessions,
  rate limits, one organization for the team, and its roles and link invitations.
- **Zorel's own code** (R4):
  - the first owner's setup token;
  - step-up confirmation for admin actions;
  - device pairing with signed approvals;
  - authorization per resource: chats, projects, personal memory, browser profiles.
- **Without a keychain**: secrets go to a file vault (R5).
- **Shipping**: a container image with Chromium, and the same single binary (R6).

The desktop and local modes don't change: no sign-in, one owner (SC-008).

## Technical Context

- **Language/Version**: TypeScript, Bun 1.4.4.
- **Primary Dependencies**:
  - in use: Effect 4 (HttpApi, RPC), Drizzle 1.0.0-rc.5 on SQLite, React 19, Playwright-core;
  - **new**: `better-auth` 1.7.14 and `@better-auth/passkey` 1.7.14 (server, web client), `uqr` 0.1.3 (web, QR codes;
    MIT, no dependencies).
- **Storage**:
  - Better Auth's 9 `auth_*` tables, through its migrations and its own connection;
  - Zorel adds, in one Drizzle migration:
    - columns: `chats.owner_id`, `projects` visibility;
    - tables: `project_members`, `devices`, `pairing_codes`, `step_ups`.
- **Testing**: bun test, end to end through the real HTTP and RPC routes. Better Auth runs on `:memory:`-backed files
  in a temp folder. A test client signs in with password; passkey ceremonies are covered by a fake authenticator
  (`@simplewebauthn` test vectors) or left to the manual quickstart. Plus Playwright screenshots.
- **Target Platform**:
  - the server runs on Linux (container), macOS and Windows (binary);
  - clients are browsers and, later, the app (016).
- **Constraints**:
  - removing a person takes effect within 5 s (SC-003);
  - every route checks role and resource (SC-004);
  - nothing changes in desktop mode.
- **Scale**: up to about 20 people per server (spec Assumptions).

## Constitution Check

- **I. Scope and Simplicity**:
  - one new auth dependency, which the user decided on, plus a tiny QR library;
  - no Postgres, no per-person containers;
  - server mode is opt-in by environment.
- **II. Security (NON-NEGOTIABLE)**:
  - every authenticated route resolves an Actor and checks role and resource in the handler, not in the UI;
  - secrets live in the vault, never in env, except `ZOREL_SESSION` in dev;
  - errors stay plain to the client.
- **III. Explicit errors**: auth failures are typed (401/403, and "not found" for resources the person may not know
  exist). Rate limits return 429 with a retry hint.
- **IV. Cross-platform**: the server mode binary on all three systems. The container image is Linux only, and the plan
  says so.
- **V. Language**:
  - UI text through i18n;
  - prompts unchanged;
  - no reference products named.

## Design

### M1: Server mode and the first owner (US1)

- **Env**:
  - `ZOREL_SERVER=1` switches it on;
  - `ZOREL_LISTEN` (default `127.0.0.1:4317`);
  - `ZOREL_PUBLIC_URL` (required; https, or a Tailscale name);
  - `ZOREL_TRUSTED_PROXIES` (comma-separated).

  `BunHttpServer.layer` takes the listen host. `ZOREL_ORIGIN` follows the public URL, so OAuth returns there (FR-025).
- **`auth.ts`** (new): builds the Better Auth instance from the data folder's DB file, the vault's `AUTH_SECRET`, the
  public URL (passkey `rpID` and `origin`) and the trusted proxies. Plugins: passkey, twoFactor, organization (creation
  off, roles owner/admin/member) and bearer (devices). It runs its migrations at start.
- **`ServerGuard`** replaces `LocalOnly` in server mode:
  - unsafe methods need `Origin` equal to the public URL (and `Sec-Fetch-Site: same-origin` when sent);
  - `/api/auth/*` and `/api/setup*` are open;
  - everything else needs a session (cookie) or a device bearer.

  It provides `Actor { id, role }` per request. It refuses plain HTTP from another machine unless the public URL is a
  private-network name (FR-003).
- **Setup**: with no owner, the server prints `<public URL>/setup?t=<one-time token>` (1 h). `POST /api/setup` creates
  the owner (`auth.api.signUpEmail`), the organization, and recovery codes (`twoFactor` backup codes). The page then
  registers a passkey, or sets up TOTP when passkeys can't work (IP-only).
- **Web**: in server mode the app first asks `GET /api/auth/get-session`. Signed out, it shows the sign-in screen
  (passkey button, else e-mail + password + code), or the setup screen when the token is in the URL.

### M2: Team, roles, sessions (US2, US3)

- **Invites**: through the organization plugin; an e-mail is the account's sign-in name only, and nothing is sent. The
  link `/<public>/invite/<id>` leads to: sign up (name, e-mail, password), then a passkey.
- **People**: a "People" settings section (admin only) with invite (link + QR), roles, remove, and the activity log.
  Removing someone deletes their member row, revokes all their sessions and marks their devices revoked: effective at
  once (SC-003).
- **Step-up**: admin actions go through `requireFresh(actor)`, with `step_ups` (session id → time of the last passkey
  or TOTP check) and a 5-minute window. The web runs the passkey prompt and retries.
- **Sessions**: "Your sessions and devices" in settings, through Better Auth's `list-sessions` / `revoke-session`, plus
  Zorel's devices. Default lifetime 30 days, with a 7-day idle window via `updateAge`.
- **Audit**: new actions for sign-in (ok and failed), invite created and used, role changed, person removed, session
  revoked, device paired, confirmed and revoked, step-up. The actor is the person's id. Reading the log is admin-only.

### M3: What stays a person's own (US4)

- **Chats**:
  - `chats.owner_id` is set on create, and existing chats get the first owner;
  - outside a project, a chat is visible only to its owner;
  - in a project, it is visible to the project's members.

  A single `canSee(actor, chat)` sits in every chat route, the RPC subscribe, the browser and terminal sockets, search
  and recall.
- **Projects**: `project_members` (an admin adds people). Owners and admins see all projects.
- **Memory**: personal memory's `owner` becomes the person's id (the column exists), and `heard()` already filters user
  scope by owner. Consolidation passes the turn's person.
- **Browser profiles**: `profileOf(agent, person)` gives `<agent>__<person>`, or `<agent>__project-<id>` when the
  project shares a profile. Old per-agent state files are kept for the first owner.
- **Turns**: a turn runs as the person who sent the message. Routines run as their creator, and are paused when that
  person is removed (FR-019).

### M4: Devices (US7)

- **Pairing**: `POST /api/devices/pair` (signed in) makes a code (128-bit secret, 5 min) and a QR payload
  `{ url, spki, code }`. `spki` is the SHA-256 of the server certificate's public key when Zorel terminates TLS; behind a
  proxy it's the public URL's, read once. `POST /api/devices/claim` (open, rate-limited) takes the code, a device name
  and its P-256 public key, and makes a device in state `waiting`.
- **Confirm**: the person (or an admin) confirms in Settings, and the device can then sign a challenge for a session
  (bearer, 1 h).
- **Signed requests**: refresh, and approvals from a device (`decide`), need an `x-zorel-device-signature` over
  `(method, path, timestamp, body hash)`, verified with WebCrypto. The timestamp must be within 2 minutes, and a nonce
  is used once.

### M5: The agents' browser for a team (US5)

- **Separate permissions**: watch = can see the chat; control = the chat's owner, or a project member with control. Both
  are checked per frame and input in `BrowserSocket`.
- **Lease**: `setControl` becomes `{ by: personId, until }`. It is renewed by input and lasts 2 minutes. Another
  person's input is refused, and taking and releasing are written to the audit log.
- **Blur**: when the focused element is a password or card field (`Runtime.evaluate` on focus change), frames for anyone
  but the holder carry a blur rectangle that the client applies. The server also downscales them.
- **Frames**:
  - binary messages, as today (JPEG bytes), with an 8-byte header (frame id, width, height);
  - the screencast keeps `maxFramesInFlight: 1`, and CDP is acked only after a viewer acks;
  - a first picture when someone joins (spec FR-022).

### M6: Engines, connectors, vault (US6)

- `Secrets.file` vault (R5) in server mode when `Bun.secrets` fails.
- **Engine sign-in from Zorel**: the CLI's own login runs in a terminal session (`terminals.ts`) on the server, so the
  admin sees the device code or the paste-back prompt in the Terminal panel. This replaces "the CLI opens a browser on
  this machine".
- **OAuth** returns to the public URL (follows from M1).

### M7: Delivery (US8)

- A `Dockerfile` (R6) and `docs/server.md`: Tailscale (`tailscale serve`), Caddy (`flush_interval -1`), env, backup and
  restore of the data folder plus `vault.key`.
- CI builds the image only on a tag; it is not published until asked.

## Project Structure

```text
apps/server/src/
  auth.ts            # Better Auth instance, server mode config (new)
  server-mode.ts     # env parsing, ServerGuard, Actor per request, setup token (new)
  people.ts          # members, invites, step-up, removal (new)
  devices.ts         # pairing, confirmation, signed requests (new)
  secrets.ts         # + Secrets.file vault
  access.ts          # Actor { id, role: owner | admin | member }
  main.ts            # mount /api/auth/*, guards, canSee in chat routes
  browser.ts         # profiles per person, lease, blur, frame header
  schema.ts / drizzle/<new migration>
apps/web/src/
  features/sign-in.tsx, setup.tsx, people.tsx (settings), devices.tsx (settings)
  auth-client.ts     # Better Auth client (passkey, twoFactor, organization)
docs/server.md, Dockerfile
```

## Testing

- **Contract and route tests** (server mode on, temp data folder):
  - setup token once;
  - sign-in with password;
  - session revoke;
  - invite and accept;
  - a member refused admin routes and other people's chats (SC-004 suite);
  - removal revokes in under 5 s;
  - pairing code once, unconfirmed device refused, signed approval;
  - browser input refused without control, lease expiry.
- **Desktop mode regression**: the whole existing suite runs as today (SC-008).
- **Manual quickstart** (`quickstart.md`, written with M7): the container on Linux, Tailscale, two browsers, a passkey.

## Complexity Tracking

| Choice | Why | Simpler alternative rejected |
|---|---|---|
| Better Auth's own DB connection and tables | Its migrations and adapter own the identity model; Zorel never writes them | Porting its schema into our Drizzle schema: drift with every update |
| Two guards (LocalOnly / ServerGuard) | Desktop mode must stay sign-in free and unchanged | One guard with mode flags in every branch |
