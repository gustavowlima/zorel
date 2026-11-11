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

## Phase 1: picker and state (lean, as built)

- No new endpoint and no timer (the user: the connection is continuous): an open window knows through its own
  WebSocket; the picker asks the existing `GET /api/server` of each known server once when it opens
  (`servers:check`, main process, `net.fetch`, 5 s). No version check: a server's window shows its own web app.
- Switching (`servers.ts` `place`): the chosen window takes the place of the one it was chosen in, which hides (its
  page and notifications go on). At most 3 server windows alive; hidden over 30 min → closed (`trimServers`, every
  5 min and on each switch). The Dock reopens when every window is hidden.
- ⌘1…⌘9 in the Servers menu on macOS; Ctrl+1…9 from the page elsewhere (no menu bar there).
- A server window that fails to load shows a small offline page of the app (two languages from the system's locale).
- Web: `features/server-picker.tsx` replaces the app name in the sidebar head when there are team servers; a thin
  "On <host> · This computer" line under it in a server's window.

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

## Phase 4: a project on an SSH host — T016 findings (2026-11-11)

**Feasible: the engine CLI on the host.** Every engine starts one local process spoken to over stdio, through one seam
each: Claude (`spawnClaudeCodeProcess` in the SDK options), Codex (`Bun.spawn` of `codex app-server`), ACP agents
(`commandFor` + `Bun.spawn`). Each can become `ssh -T user@host -- cd <folder> && env … <cli> <args>`. The tool
gateway (`http://127.0.0.1:<port>/mcp/<48-hex token>`) is reached from the host through a reverse forward
(`-R <port>:127.0.0.1:<port>`; one master connection per host with ControlMaster, no multiplexing on Windows'
OpenSSH, so there one forward per session). The CLI must be installed and signed in on the host (its own login).
"Tools remoted" is not possible for Claude Code and Codex: their file and shell tools are built in.

**What assumes the folder is on this machine** and would need a remote version or be turned off for such a project:
the changes view, checkpoints and undo (`workspace.ts`: git trees of the folder), the terminal panel (`terminals.ts`,
a local PTY), previews (`preview.ts`: a local port; would need `-L`), file reads and attachments paths, the agent's
own computer (spec 009), worktrees (spec 016), and the prompt's "You work in the project folder" line.

**Options**: (A) engine turns on the host only, with those features off for remote projects; (B) all of them over SSH
(remote git, an SSH PTY, `-L` forwards for previews), the largest piece of this spec; (C) no remote projects: a
machine whose power you want runs a Zorel server (phases 1–3), which gives every feature there with nothing new.

## Risks

- Hidden windows still use memory: at most the servers opened in this run; a server not used for 30 min may be closed
  and reopened on demand (ponytail if memory matters).
- `ssh` on Windows: OpenSSH client is optional on some editions; the helper says how to enable it.
