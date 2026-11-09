# Feature Specification: Computer Apps (agent-desktop, installed in-app)

**Feature Branch**: `feat/memory-efficiency` | **Created**: 2026-11-08 | **Status**: Implemented

**Input**: "precisamos do agent desktop da vercel … opcional para baixar e instalar" (2026-11-08), then
"sim" to: native in-app install + a reference app's usage model (per agent, per app, few tools, approval only on
what commits).

## Baseline

A "Desktop apps" connector (commit aa67661) ran `npx -y agent-desktop@1.2.0 mcp`: it needs Node.js, gives
all 67 tools to every agent for the whole computer, and asks approval for every action.

## User Scenarios & Testing

### User Story 1 - Install it from the app, on any system (P1)

On an agent's permissions, "Computer apps" says whether agent-desktop is installed. "Install" downloads the
official release for this system and processor, checks it against the release's `checksums.txt`, and keeps
it in Zorel's data folder. No Node.js, no terminal. On macOS it shows the Accessibility state and opens the
system's guide.

**Independent Test**: against a fake release server, install extracts the binary and its helper and
reports "installed 1.2.0"; a checksum that doesn't match is refused and nothing is kept.

### User Story 2 - Give an agent some apps, each read or use (P1)

The person gives an agent named apps (picked from the open ones, or typed), each "read only" or "read and
use". The agent gets a handful of tools (list its apps, open, read the window as a numbered list, read the
menus, and, for "use" apps, click, type, press a key). An app not given, or Zorel itself, is refused.

**Independent Test**: unit tests on the tool layer with a fake CLI: a given app is read as a numbered list;
a target is found by number or text; an app not given is refused; a read-only app refuses click/type/key;
the tools are not listed for an agent with no apps or when agent-desktop isn't installed.

### User Story 3 - Approval only on what commits (P1)

A click whose label sends, pays, publishes, deletes, schedules (or has no label), and Return or a send/
delete shortcut, waits for the person's approval; everything else goes through. At the "ask" access level
every change asks, as for the browser.

**Independent Test**: risky labels and keys are recognized; ordinary ones aren't.

## Requirements

- **FR-001**: Install downloads `agent-desktop-v<VERSION>-<target>.tar.gz` for the running OS/arch from the
  pinned GitHub release, verifies SHA-256 against the release's `checksums.txt`, extracts it (binary + helper)
  to `<dataDir>/tools/agent-desktop/<VERSION>/`; a mismatch keeps nothing.
- **FR-002**: Status reports installed/version and, on macOS, the Accessibility state and its suggestion.
- **FR-003**: Agent permissions gain `apps: [{ name, level: "read" | "use" }]` (default none).
- **FR-004**: Tools exist only for an agent with apps and an installed agent-desktop; each call checks the
  app is given and the level allows the action; Zorel itself is never an app.
- **FR-005**: Risky clicks and keys ask approval (reuses the browser's risky words); results pass through
  the outside-text guard (spec 004).
- **FR-006**: The npx connector is removed.

## Success Criteria

- **SC-001**: Install and checksum refusal pass against a fake release server; a real install on macOS
  arm64 reports version 1.2.0 (checked by hand).
- **SC-002**: The tool layer's tests above pass; every existing test green.
- **SC-003**: An agent with apps carries ≤ 8 desktop tools (vs 67).

## Assumptions

- Ported from a reference app (Apache-2.0, credited in NOTICE): the numbered list (`itemize`), picking by number or
  text (`pick`), risky click/key rules, key names per OS.
- v1 opens apps by name (`agent-desktop launch`, and `open -a` with Chromium accessibility on macOS);
  a reference app's Windows/Linux app resolution through the Start menu and `.desktop` files is left for later.
- macOS Accessibility must be granted to the app that runs Zorel; agent-desktop's own guide shows how.

## Tasks

- [X] T001 `apps/server/src/desktop.ts`: version, target per OS/arch (table), install (download, checksum, extract), status, CLI runner
- [X] T002 `apps/server/src/desktop-apps.ts`: itemize/pick/risky rules (ported), tools, call handler with grants
- [X] T003 Contracts: `AgentPermissions.apps`; `GET /api/desktop`, `POST /api/desktop/install`, `POST /api/desktop/guide`, `GET /api/desktop/running`
- [X] T004 `apps/server/src/runtime.ts`: list tools for agents with apps; route calls; approvals; guard
- [X] T005 `apps/web/src/features/permissions.tsx` (+ i18n): Computer apps section; remove the npx connector
- [X] T006 Tests (fake release server, fake CLI); NOTICE; docs and memory

## Results (2026-11-08)

- SC-001: fake release server: install + checksum refusal pass; real install from GitHub on macOS arm64:
  1.0 s, version 1.2.0, status reports Accessibility "denied" for the terminal (correct).
- SC-002: 4 desktop tests (install, numbered list and pick, risky rules, per-app gating with approval) and
  265 server tests green; typecheck ok; lint 37 warnings (unchanged).
- SC-003: an agent with apps carries 7 desktop tools (4 with read-only apps), down from 67.
- Not checked here: a real snapshot/click on an app (this terminal has no Accessibility permission), and
  Windows/Linux (opening apps by name only in v1).
