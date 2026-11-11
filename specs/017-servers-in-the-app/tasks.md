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

- [X] T009 server: `ssh.ts` — Zorel's key pair (`publicKey`), `scanHost` (SHA256 fingerprint), `trust`/`isKnown`
  (Zorel's known_hosts), `runRemote` (BatchMode, StrictHostKeyChecking=yes, IdentitiesOnly, secret on stdin, output end)
- [X] T010 server: tools `zorel_ssh_key` and `zorel_ssh_run`, offered only to the built-in "installer" agent and never
  from outside text; a new host's fingerprint card (kind network) before anything; the exact command as a card (kind
  command); audit `ssh.trusted` / `ssh.ran`
- [X] T011 tests: ssh.test.ts (targets refuse option-like names, args, known_hosts, stdin secret via a fake ssh);
  runtime tests (trust then run once approved; a declined command never runs; a plain agent gets nothing). A real
  sshd container test is left to P3's manual check

## P3: Install on another computer

- [X] T012 server: built-in "Installer" agent (team.ts INSTALLER: SSH key → check → git clone → docker build → docker run on
  127.0.0.1:4317 only → setup link), `POST /api/installer` (admins only + step-up on a team server)
- [X] T013 web: Settings › Servers › "Install on another computer" opens a normal chat with the Installer (its approval
  cards show each exact command)
- [X] T014 docs/server.md "Reaching it": a table of ways (proxy, Tailscale, WireGuard, Headscale/NetBird, Cloudflare
  Tunnel) with what each exposes, nginx WebSocket upgrade, Cloudflare Tunnel; installing and switching from the app
- [ ] T015 verify on a disposable Linux machine (manual) and in the test container (automated)

## P4: A project on an SSH host

- [ ] T016 prototype CLI-on-host vs tools-remoted; record the choice in plan.md
- [ ] T017 server: `run_hosts` + routing the project's turns and shells; "H isn't reachable" failure
- [ ] T018 web: the project page's "Runs on"; tests; memory
