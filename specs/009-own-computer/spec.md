# Feature Specification: An Agent's Own Computer (Podman, Docker as fallback)

**Feature Branch**: `feat/memory-efficiency` | **Created**: 2026-11-09 | **Status**: Implemented

**Input**: "falta garantir computadores próprios com podman correto?" then "prossiga" (2026-11-08/09). Giving
each agent a Linux container is a common pattern; Zorel has none: agents run on the person's machine inside
the OS sandbox (Seatbelt, bubblewrap).

## User Scenarios & Testing

### User Story 1 - A Linux computer of its own (P1)

On an agent's permissions, "Own computer" is "None" (today) or "Linux container". With a container, the
agent gets tools to run commands, read, write and edit files in an isolated Linux (Node 22 on Debian) where
it installs and runs anything without asking; the chat's project folder is lent at `/projects/<name>`
(read-only at the "ask" access level); its own scratch space is `/work`, kept between turns.

**Independent Test**: with Podman (or Docker) on the machine, a container starts for an agent, a command
runs, a file written in the lent folder shows on the host, ports map to 127.0.0.1; erasing removes it.

### User Story 2 - The right engine, explained (P1)

Zorel prefers Podman (no daemon, rootless, Apache-2.0) and falls back to Docker. Settings show which engine
it found and what's missing ("Podman is installed but its machine isn't running: podman machine start").

**Independent Test**: engine detection maps the CLI's answers (missing, machine stopped, daemon down, ok) to
one status each.

## Requirements

- **FR-001**: Engine: `podman` when its `info` succeeds, else `docker` when its `info` succeeds, else a
  status saying what to install or start; one engine for the whole app run.
- **FR-002**: One container per agent and project, named with a hash of the data folder (two installs never
  collide); image `docker.io/library/node:22-bookworm`; `--init`, 3 GB memory, 2 CPUs, common dev ports
  published on 127.0.0.1 only; on Linux with Podman, `--userns=keep-id` so files written in lent folders
  belong to the person.
- **FR-003**: Lent folder: the chat's project path, only inside the home folder, never the home itself,
  hidden folders, `Library`/`AppData`, or Zorel's data folder; read-only at the "ask" access level.
- **FR-004**: Tools (only when the agent's computer is a container): `computer_run` (bash, timeout, output
  start+end kept), `computer_read`, `computer_write`, `computer_edit` (exact replace), `computer_ports`.
  Results pass through the outside-text guard and large-result shortening.
- **FR-005**: The agent's computer setting lives in `AgentPermissions.computer` ("none" | "container").
- **FR-006**: Erase removes the agent's containers, their saved state and folders.

## Success Criteria

- **SC-001**: Real run on this Mac with Podman: container up, `node --version` runs, a file written in the
  lent folder appears on the host, erase leaves nothing (`podman ps -a` shows none).
- **SC-002**: Unit tests for engine status, folder checks, mount and run arguments, output clipping.
- **SC-003**: Every existing test green.

## Assumptions

- Derived from third-party Apache-2.0 code (credited in NOTICE): folder checks, container arguments,
  output clipping, the per-install name prefix. Not ported in v1: services with logs, screenshots, show_file,
  "this computer" (the Mac) mode, moving folders between projects.
- macOS and Windows run Podman in its own VM (`podman machine`), which shares the home folder by default.

## Tasks

- [X] T001 `apps/server/src/computer.ts`: engine detection, folder check, container lifecycle, exec, tools, erase
- [X] T002 Contracts: `AgentPermissions.computer`; `GET /api/computer`, `POST /api/computer/erase/:agentId`
- [X] T003 `apps/server/src/runtime.ts`: tools for agents with a container, routing, guard, shortening
- [X] T004 Web: "Own computer" row in agent permissions with the engine's status; i18n
- [X] T005 Tests (unit + a real run by hand with Podman); NOTICE; docs and memory

## Results (2026-11-09)

- SC-001 (real, this Mac, Podman 6.1.4 with its libkrun machine): engine podman; first start 42 s (image
  pull included); Node 22.23.4 on Linux aarch64; a file written in the lent folder appeared on the host;
  edit and read worked; apt available; ports published on 127.0.0.1; erase left no container and no folder.
- Found on the way: Podman reads the person's `~/.docker/config.json` and its credential helpers (here a
  missing `docker-credential-gcloud` broke every pull). Zorel gives Podman an empty login file of its own
  (`REGISTRY_AUTH_FILE`); Docker keeps its config (Docker Desktop's context lives there).
- SC-002: 4 unit tests (engine status, folder checks, container arguments, output); SC-003: 271 server tests
  green, typecheck ok, lint 33 warnings.
