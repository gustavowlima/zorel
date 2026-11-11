# Research: Zorel on a Server, for a Team

**Date**: 2026-11-11 | **Spec**: [spec.md](spec.md) | Broader decisions (devices, push, the browser on the phone):
[docs/research/server-mobile.md](../../docs/research/server-mobile.md)

## R1. Identity library: Better Auth

- **Decision**: Better Auth `1.7.14` and `@better-auth/passkey` `1.7.14`, pinned (both at least two weeks old on
  2026-11-11; the project ships patch releases every few days, so updates are deliberate).
- **Rationale**: authentication is the worst place for hand-written code, and this spec puts security first. Better
  Auth covers:
  - passkeys (on `@simplewebauthn`);
  - email and password, with TOTP and backup codes (`twoFactor`);
  - server-side sessions that can be listed and revoked;
  - rate limiting;
  - roles and invitations (`organization`);
  - device authorization;
  - later, the Expo app (`@better-auth/expo`, spec 016).
- **Alternatives considered**: our own stack (`@simplewebauthn/server` + `Bun.password` argon2id + hand-written TOTP +
  our own sessions): fewer dependencies, but about 1.5–2k lines of security-sensitive code to maintain. Compared on
  2026-11-11; the user chose Better Auth.
- **Cost accepted**:
  - Size: 46 packages, 27 MB of node_modules. They come through zod, kysely, jose, better-call and nanostores.
  - A telemetry package that must stay off.
  - Its own routes under `/api/auth/*`, outside our typed contracts. The web calls them through its client.

## R2. Spike (2026-11-11, scratch project, nothing in the repo)

- Better Auth on a Bun `Database` (bun:sqlite), WAL, in the same file as an app table. Its migrations
  (`getMigrations(auth.options).runMigrations()`) created 9 tables, all renamed with `modelName`:
  - `auth_users`, `auth_sessions`, `auth_accounts`, `auth_verifications`;
  - `auth_passkeys`, `auth_two_factors`;
  - `auth_organizations`, `auth_members`, `auth_invitations`.

  The app table kept working.
- Mounted in `Bun.serve` as `auth.handler(req)` for `/api/auth/*`, with `telemetry: { enabled: false }`.
- Server-side sign-up (`auth.api.signUpEmail`), then HTTP sign-in: the cookie is `better-auth.session_token`, and
  `get-session` returns the user.
- One organization, with the creation of others turned off (`allowUserToCreateOrganization: false`). An invitation
  through `organization/invite-member` sends nothing when no e-mail function is set. Accepting it by its id after
  signing in gives the member its role.
- `list-sessions` and `revoke-other-sessions`: a revoked session's cookie reads as no session at once.
- `passkey/generate-register-options` carries the configured RP id and name.
- 12 wrong passwords in a row: the 12th gets 429.
- Warnings to act on:
  - "could not determine a client IP": behind a proxy it needs `advanced.ipAddress.trustedProxies` /
    `ipAddressHeaders`, which matches FR-012;
  - a low-entropy secret warning: the auth secret comes from the vault (R5).

## R3. How it fits Zorel

- **Two connections, one file**: Better Auth gets its own `bun:sqlite` connection (Kysely), and Zorel's stays on
  `@effect/sql-sqlite-bun` with Drizzle. SQLite in WAL with `busy_timeout` handles both. Better Auth's tables are
  created by its own migrations at start, after Zorel's Drizzle migrations; Zorel never writes them.
- **Mounted in Effect**: one `HttpRouter` route catches `/api/auth/*` and hands the raw `Request` to `auth.handler`.
  The global guard (today `LocalOnly`) becomes `ServerGuard` in server mode:
  - the origin must equal the public URL;
  - `/api/auth/*` stays open to signed-out users;
  - every other route resolves the session (`auth.api.getSession({ headers })`) or a device token, sets `Actor`, and
    refuses otherwise.
- **The Actor seam**: `Actor` (`access.ts`) is provided per request in server mode as `{ id, role }`, with role
  `owner | admin | member` from the organization membership. Desktop and local mode keep `Actor.local` and no auth at
  all.
- **One team**: a single organization is created with the first owner. Every invite joins it. Better Auth's
  organization roles are the person's role.
- **E-mail**: Better Auth identifies accounts by e-mail. Without a mail server it is only the sign-in name; it is never
  verified or used to send anything (no `sendInvitationEmail`, no verification). The invite link carries the
  invitation id.

## R4. What stays Zorel's own

- **First owner**: a one-time setup token printed on the console (1 h). The setup page creates the owner server-side
  (`auth.api.signUpEmail`) with sign-up otherwise closed (`disableSignUp: true` on the public routes), then the team.
- **Step-up**: admin actions require a passkey assertion (or password + TOTP) from the last 5 minutes. The time is kept
  on Zorel's side, keyed by the Better Auth session id, after a `passkey/verify-authentication` the web runs for it.
- **Device pairing** (spec text: QR, pinned server identity, admin confirmation, P-256 key): tables `devices` and
  `pairing_codes` in Zorel's Drizzle schema. A confirmed device gets a short Better Auth session, through the bearer
  plugin, for reads, and signs refreshes and approvals with its key (WebCrypto `ECDSA P-256` verify on the server).
- **Authorization per resource**: chats get `owner_id` (who started them) and stay private outside projects. Projects
  get members (`project_members`). Personal memory uses the existing `memories.owner` with the person's id. Browser
  profiles become `<agent>:<person>` (or `<agent>:project-<id>`).

## R5. Secrets without a keychain

- **Decision**: a file vault for servers. `<data>/vault.json`, values sealed with AES-256-GCM under a key in
  `<data>/vault.key` (0600, readable only by the server's user). It is a new `Secrets.file` layer on the existing
  `memoryStore(cache, persist)`, chosen when `ZOREL_SERVER=1` and `Bun.secrets` isn't usable.
- **Better Auth secret**: generated once into the vault (`AUTH_SECRET`), never from an environment variable in
  production.

## R6. Packaging

- **Container image**: `oven/bun` base, the compiled server and web build, Playwright's Chromium headless shell, the
  data folder as a volume, one port. A non-root user.
- **Binary**: the existing `bun build --compile` output (apps/desktop/scripts/server.ts) gains server mode through env:
  `ZOREL_SERVER=1`, `ZOREL_LISTEN=0.0.0.0:4317`, `ZOREL_PUBLIC_URL=https://zorel.example`,
  `ZOREL_TRUSTED_PROXIES=127.0.0.1`.
