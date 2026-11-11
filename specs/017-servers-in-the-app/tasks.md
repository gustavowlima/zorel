# Tasks: Servers in the App

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

Each phase ends testable on its own; the desktop with no servers behaves as before after every one.

## P1: Picker and state (US1, US2) — lean (2026-11-11, the user: no timer, the connection is continuous)

- [X] T001 desktop: switching shows the chosen window in the place of the one it was chosen in and hides that one
  (`place`); new windows open with its bounds; the Dock reopens when every window is hidden
- [X] T002 desktop: keep the 3 most recent server windows alive; close hidden ones after 30 min (`trimServers`)
- [X] T003 desktop: `servers:check` asks each known server `GET /api/server` (5 s) when the picker opens; bridges expose
  `check` (nothing else new)
- [X] T004 desktop: ⌘1…⌘9 in the Servers menu (macOS); an offline page (name, "isn't answering", Try again) when a
  server window fails to load; a pasted setup link keeps its one-time code
- [X] T005 web: `features/server-picker.tsx` in the sidebar head (only with team servers; Ctrl+1…9 off macOS) and the
  "On <host> · This computer" line on a server's window; i18n en/pt-BR
- [ ] T006 verify by hand: a second local server (server mode on 127.0.0.1:4400), switch both ways, stop it, reopen

## P2: Approved SSH commands

- [ ] T009 server: `ssh.ts` — key pair, public key, host fingerprint, `run` with BatchMode and Zorel's known_hosts
- [ ] T010 server: `zorel_remote_run` for built-in helpers; approval card with the exact command; audit `ssh.ran`
- [ ] T011 tests: against a local sshd container when Docker is present, else a fake `ssh` on PATH

## P3: Install on another computer

- [ ] T012 server: built-in "Installer" agent (hidden), its instructions, opened from "Add a server"
- [ ] T013 web: "Install on another computer" entry; the helper's chat screen (as the Builder's)
- [ ] T014 docs: recipes (WireGuard, Tailscale, Headscale/NetBird, Cloudflare Tunnel, reverse proxy with the WebSocket
  upgrade), each with what it exposes
- [ ] T015 verify on a disposable Linux machine (manual) and in the test container (automated)

## P4: A project on an SSH host

- [ ] T016 prototype CLI-on-host vs tools-remoted; record the choice in plan.md
- [ ] T017 server: `run_hosts` + routing the project's turns and shells; "H isn't reachable" failure
- [ ] T018 web: the project page's "Runs on"; tests; memory
