# Tasks: Servers in the App

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

Each phase ends testable on its own; the desktop with no servers behaves as before after every one.

## P1: Picker and health (US1, US2)

- [ ] T001 contracts: `PROTOCOL` integer and `Health` schema `{ version, protocol, ready }`
- [ ] T002 server: `GET /api/health` (open path, both modes); test (no sign-in needed, nothing else in the body)
- [ ] T003 desktop: `health.ts` — check each known server (and the local one) every 60 s and on demand, 5 s timeout,
  states online | connecting | offline | outdated with `seenAt`; unit test of the state reduction
- [ ] T004 desktop: broadcast `servers:changed`; `servers:check`; preloads expose `onChanged` and `check` (nothing else)
- [ ] T005 desktop: switching swaps windows in place (bounds carried over, the previous one hidden, not closed)
- [ ] T006 desktop: ⌘1…⌘9 in the Servers menu; offline page for a window that fails to load (Try again)
- [ ] T007 web: `features/server-picker.tsx` at the top of the sidebar + the "Back to this computer" bar; i18n en/pt-BR
- [ ] T008 verify: two local servers on different ports; stop one; screenshots; memory and changelog

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
