# Tasks: Zorel on a Server, for a Team

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Research**: [research.md](research.md)

Each milestone ends testable on its own; desktop mode stays unchanged after every one (run the whole suite).

## M1: Server mode and the first owner (US1, P1)

- [X] T001 Add `better-auth@1.7.14`, `@better-auth/passkey@1.7.14` (server and web) and `uqr@0.1.3` (web), pinned
- [X] T002 `apps/server/src/server-mode.ts`: parse `ZOREL_SERVER`, `ZOREL_LISTEN`, `ZOREL_PUBLIC_URL` (required),
  `ZOREL_TRUSTED_PROXIES`; validation errors are plain and fatal at start; unit tests
- [X] T003 `Secrets.file` vault in apps/server/src/secrets.ts (AES-256-GCM, `vault.key` 0600), used in server mode when
  `Bun.secrets` fails; `AUTH_SECRET` generated once; tests
- [X] T004 `apps/server/src/auth.ts`: the Better Auth instance with `auth_*` model names, telemetry off, passkey
  (rpID/origin from the public URL), twoFactor, organization (creation off), bearer, trusted proxies; migrations at start
- [X] T005 main.ts: listen host from `ZOREL_LISTEN`; mount `/api/auth/*`; `ZOREL_ORIGIN` follows the public URL
- [X] T006 `ServerGuard` (server-mode.ts): Origin and Sec-Fetch-Site checks, open paths, session to `Actor` per request,
  refuse insecure remote HTTP; `access.ts` Actor role owner | admin | member; WebSocket upgrades go through it
- [X] T007 Setup: the one-time token printed at start while no owner exists; `POST /api/setup` creates owner,
  organization and backup codes; tests (token once, expiry, refused afterwards)
- [X] T008 Web: auth client; signed-out gate in server mode; sign-in screen (passkey, password + code); setup screen
  (owner, passkey or TOTP, recovery codes shown once); i18n en/pt-BR
- [X] T009 Tests: server mode end to end (setup → sign-in → a protected route → sign-out refused); desktop suite intact

### M1 as built (2026-11-11)

- server-mode.ts (env), secrets.ts `Secrets.file` vault (always in server mode), auth.ts (Better Auth, personOf,
  setupToken, createOwner), server-routes.ts (Guard, /api/auth/*, /api/server, /api/setup), main.ts wiring;
  web auth-client.ts and features/sign-in.tsx (ServerGate, Setup, SignIn).
- Tests: server-mode.test.ts (env, vault), server-mode.e2e.test.ts (setup once, sign-in, 401/403, closed sign-up,
  sign-out). Checked live in a browser: setup → first agent (spec 015) → sign out → sign in.
- Left for M3: the Memories group still reads `Actor` once at build time (the local owner); per-request reads come
  with ownership. Passkey ceremonies have no automated test yet (manual quickstart).

## M2: Team, roles, sessions (US2, US3, P1)

- [X] T010 Invites through the organization plugin (link + QR, 24 h, role fixed, cancel); invite page (sign up then
  passkey)
- [X] T011 People settings (admin): list, role change, remove (sessions revoked, devices revoked, routines paused);
  the last owner kept
- [X] T012 Step-up (`step_ups`, 5 min) on admin routes; web passkey prompt and retry
- [X] T013 Sessions and devices list in settings; revoke one; idle/absolute lifetimes
- [X] T014 Audit actions for auth and people; activity log admin-only
- [X] T015 Tests: member refused admin routes; removal effective within 5 s; last owner kept

## M3: What stays a person's own (US4, P1)

- [X] T016 Migration: `chats.owner_id` (existing chats → first owner), `project_members`
- [X] T017 `canSee(actor, chat|project)` in every chat and project route, RPC subscribe, browser/terminal sockets,
  search and recall; "not found" for the unseen
- [X] T018 Personal memory owner = the person (turns, consolidation); tests across two people
- [X] T019 Browser profiles per agent and person; project shared profile switch; old state kept for the first owner
- [X] T020 Turns run as the sender; routines as their creator, paused when that person is removed
- [X] T021 SC-004 suite: every route × member/admin/owner × own/other resource

## M4: Devices (US7, P2)

- [X] T022 `devices`, `pairing_codes`; pair (code + QR payload), claim (rate-limited), confirm, revoke
- [X] T023 Device sessions (bearer, 1 h) and signed refresh/approvals (P-256, timestamp, nonce); tests with a fake device

## M5: The agents' browser for a team (US5, P2)

- [X] T024 Watch/control permissions per frame and input; control lease (2 min) with audit
- [X] T025 Blur on password/card focus for non-holders; frame header; CDP ack after the viewer acks; first picture

## M6: Engines, connectors, vault (US6, P2)

- [X] T026 Engine sign-in in a Terminal session on the server (device code / paste-back)
- [X] T027 OAuth return through the public URL verified end to end

## M7: Delivery (US8, P3)

- [X] T028 Dockerfile (bun, server binary, web build, Chromium headless shell, non-root, volume, one port)
- [X] T029 docs/server.md (Tailscale, Caddy, env, backup/restore with vault.key) and quickstart.md

### M2–M7 as built (2026-11-11)

- M2: team-routes.ts (invites, roles, removal, project members), step-up = a session younger than 5 minutes
  (`adminCheck` in server-routes.ts); web features/team.tsx (members, invites with QR, sessions, StepUp).
- M3: visibility.ts — the guard checks what each request names: chats, projects, attachments, and ids of turns,
  approvals, routines, memories, pages and agents (`Store.refOf`). Lists filter per person (`seen`, `visibleRoutines`).
  The server machine (processes, folders, desktop, usage, storage) is admins'. `access-matrix.test.ts` (SC-004)
  fails on any API route that isn't open, admin-only, checked or listed as shared on purpose.
- T019: profiles `<agent>--<person>`; a project switch (`projects.shared_browser`) makes it `<agent>--p-<project>`.
- M4: devices.ts — pairing code (5 min, hash stored), claim signed by the server's identity key (vault), confirm,
  revoke (its sessions deleted), one-hour bearer sessions and approvals signed by the device's P-256 key (timestamp
  ±2 min, nonce once). Device sessions can't approve over the socket. Web: Settings › Team › Phones.
- M5: control lease (2 min, renewed per input, one holder), audit `browser.control_taken/returned`, watch-only for
  members on others' chats, CDP ack after the watchers take the frame (≤500 ms). A focused password/card field:
  non-holders get no new frames (their last one shown blurred) and no previews.
- M6: on a server the CLI sign-in runs in a PTY (Codex with `--device-auth`); the web shows its text and sends the
  pasted code (`POST /api/accounts/:id/login/code`). OAuth return reachable signed out (state-checked), tested.
- M7: Dockerfile (+ .dockerignore), docs/server.md, quickstart.md.
- Left out on purpose: a per-frame header (the state message carries tab and holder); blurring only the field's area
  (frames are withheld instead, which reveals less); the memory map's personal scope on a team server (its points
  have no owner). Not checked against the real Codex CLI: `--device-auth` output and prompt.
