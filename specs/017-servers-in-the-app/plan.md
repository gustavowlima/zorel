# Implementation Plan: Servers in the App

**Branch**: `feat/agents-only-tools` (spec folder `017-servers-in-the-app`) | **Date**: 2026-11-11 | **Spec**: [spec.md](spec.md)

## Summary

Four phases, each testable and committed on its own; the local desktop mode never changes behavior for a person with
no servers.

1. **Picker and health** (US1, US2): `GET /api/health`; the desktop's main process checks every known server each
   minute; the web sidebar shows the current server and a picker; switching swaps windows in place.
2. **Approved SSH commands** (groundwork for US3, US4): a server-side runner that runs one command on a host only
   after the person approves its exact text, with Zorel's own key and known-hosts file, secrets on stdin, every
   command audited.
3. **Install on another computer** (US3, US5): a built-in helper agent (like the Builder) with the runner as its tool;
   installs Zorel as a service listening on loopback, then shows the recipes to reach it.
4. **A project on an SSH host** (US4): the project's agents work on the host. First task of the phase: a prototype to
   choose between running the engine CLI on the host (its own login there) or keeping it here and remoting tools.

## Technical Context

- **Language/Version**: TypeScript, Bun 1.4.4; Electron 45 (desktop main).
- **Dependencies**: none new. SSH is the system's OpenSSH client (`ssh`, `ssh-keygen`, `ssh-keyscan`: present on macOS,
  Linux and Windows 10+); health checks use Electron's `net.fetch`.
- **Storage**:
  - desktop `servers.json` gains nothing persistent but `last`; states live in memory;
  - server: `dataDir/ssh/` holds Zorel's key pair (`id_ed25519`, 0600) and `known_hosts`; a `run_hosts` table in
    phase 4 (project id, host, user, port, folder).
- **Testing**: bun test (server: health route, runner against a local `sshd` in a temp container when Docker is present,
  else a fake `ssh` on PATH); desktop: unit tests for state reduction and window swap logic; Playwright screenshots of
  the picker.
- **Constraints**: a server page never gets more bridge than `servers.list/open/onChanged` (FR-005); no network,
  firewall or DNS changes on any machine (FR-009).

## Phase 1: picker and health

- **Server**: `GET /api/health` (open path in server-routes, also in local mode) → `{ version, protocol, ready }`.
  `PROTOCOL` (an integer in contracts) changes only on a breaking client/server change.
- **Desktop main** (`servers.ts`):
  - `health.ts`: every 60 s, and when a picker opens (`servers:check`), `net.fetch(origin + "/api/health")` with a 5 s
    timeout for the local server and each saved one → `{ state: online | connecting | offline | outdated, version,
    seenAt }` in memory; changes broadcast to every window (`servers:changed`).
  - Switching (`servers:open`): the target window takes the current window's bounds and shows; the current hides (not
    closed: its page and notifications live on). The local window is one of them.
  - ⌘1…⌘9 in the "Servers" menu (accelerators), ⌘1 = this computer.
  - A server window that fails to load shows a small offline page (its name, "isn't answering", last seen, Try again).
- **Preloads**: `servers.onChanged(cb)` and `servers.check()` added to both bridges (still nothing else).
- **Web**: `features/server-picker.tsx` at the top of the sidebar (desktop only, from the bridge): current server name
  + state dot; a Popover listing this computer and each server (state, host, ⌘n), "Add a server…" (opens Settings ›
  Servers, from this computer only); a thin "On <name> · Back to this computer" bar when the window isn't local. The
  web app without desktop shows nothing new.

## Phase 2: approved SSH commands

- `apps/server/src/ssh.ts`:
  - `ensureKey()`: `ssh-keygen -t ed25519 -N "" -f dataDir/ssh/id_ed25519` once; `publicKey()` for the person to add on
    the host;
  - `fingerprint(host, port)`: `ssh-keyscan` → the host key's SHA256 fingerprint, shown for approval before it is
    written to `known_hosts`;
  - `run(target, command, stdin?)`: `ssh -i key -o BatchMode=yes -o StrictHostKeyChecking=yes -o
    UserKnownHostsFile=… -p port user@host -- command`, stdout/stderr capped, timeout, exit code.
- A tool `zorel_remote_run({ host, command, stdin_secret? })` for built-in helpers only: each call is an approval card
  with the exact command (and "a secret goes on stdin", never its value), audited (`ssh.ran`), refused at "ask"/outside.

## Phase 3: install on another computer

- A built-in agent "Installer" (like the Builder: hidden from lists, opened from "Add a server › Install on another
  computer") with instructions for the steps: check the OS and architecture; download the server binary of this app's
  version from the release; create a `zorel` user and a systemd service with `ZOREL_SERVER=1`, `ZOREL_LISTEN=127.0.0.1:4317`,
  `ZOREL_PUBLIC_URL` (asked from the person); start it; read the one-time setup token from the service's journal; show
  the recipes; when the person gives the HTTPS address, add the server in the desktop app and open its setup page.
- Linux with systemd first; anything else ends with the manual steps (spec 014 quickstart).

## Phase 4: a project on an SSH host

- First task: prototype both ways on one host and pick (recorded in this plan):
  - **CLI on the host**: the engine CLI (Claude Code / Codex / agy) runs over `ssh` on the host, its login there; the
    session's stdio is the SSH channel. Simple and faithful; needs the CLI installed and signed in on the host.
  - **Tools remoted**: the engine stays here, its file and shell tools go through `ssh`. Native engines edit the local
    disk directly, so this only works for engines whose tools Zorel owns.
- Then: `run_hosts` table, the project page's "Runs on", turn failure "H isn't reachable" (connect timeout 10 s).

## Risks

- Hidden windows still use memory: at most the servers opened in this run; a server not used for 30 min may be closed
  and reopened on demand (ponytail if memory matters).
- `ssh` on Windows: OpenSSH client is optional on some editions; the helper says how to enable it.
