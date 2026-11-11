# Feature Specification: Servers in the App

**Feature Branch**: `feat/agents-only-tools` | **Created**: 2026-11-11 | **Status**: Implemented (2026-11-11; User Story 4 dropped)

**Input**: "a spec de execução em servidores e seleção de servidor no próprio Zorel" (2026-11-11). Zorel already runs
on a team server (spec 014) and the desktop app opens such servers (2026-11-11), but choosing where you are and
getting a server running are still hidden in a menu and a settings row. This spec makes servers a first-class place in
the app: see them, switch between them, know their state, add one (including installing it on another computer from
a chat), and decide where an agent's work runs.

## Baseline (2026-11-11)

| What | Today |
|---|---|
| What a server is | A whole Zorel install (spec 014) with its own agents, chats, memory and files |
| Desktop | `servers.json` in userData lists `{origin, name}` and the last one used. Each server opens in its own window (`persist:server-<hash>` session, a preload with only `servers.list/open`), same-origin navigation only |
| Switching | Menu "Servers" (macOS) or tray, and Settings › General › Servers. No picker in the window itself |
| Adding | Paste a server address or an invite link (from this computer's window only) |
| State | None shown: a server that doesn't answer is a blank or failed page |
| Version | Not checked: an old server and a new app may not understand each other |
| Installing a server | By hand (spec 014 quickstart) |
| Where an agent works | On the machine its server runs on; its own Linux computer (spec 009) is a local container |
| Web (no desktop) | One server: the one that served the page |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See and switch servers from the window (Priority: P1)

The person has this computer and two team servers. At the top of the sidebar, the place they're in shows its name and
state; pressing it lists every server with a dot for its state (online, connecting, offline, needs update) and a
shortcut (⌘1…⌘9). Choosing one shows it in this window: the sidebar, chats and agents are that server's. A thin bar
says which server this is when it isn't this computer, with "Back to this computer".

**Why this priority**: Today you can't tell where you are or get elsewhere without the menu.

**Independent Test**: With two servers added, switch with the picker and with ⌘2; the window shows the second server;
"Back to this computer" returns.

**Acceptance Scenarios**:

1. **Given** two servers, **When** the person opens the picker, **Then** each shows its name, host and state.
2. **Given** a server that doesn't answer, **When** chosen, **Then** the window shows "<name> isn't answering" with
   "Try again" and the last time it was reached, never a blank page.
3. **Given** the person switches away and back, **Then** the server's page is still there (no reload), and its
   notifications kept arriving meanwhile.

---

### User Story 2 - Know whether a server answers (Priority: P1)

No timer: an open window already knows through its own connection (the WebSocket reconnects by itself). When the
picker opens, the app asks each server it knows the existing public `GET /api/server` once and shows online, or "not
answering · last seen <time>". A server's window always shows that server's own web app, so the page and the server
never disagree on versions; nothing to check there.

**Acceptance Scenarios**:

1. **Given** a server that is down, **When** the picker opens, **Then** it shows "not answering" and when it was last
   seen.

---

### User Story 3 - Add a server the easy ways (Priority: P1)

"Add a server" offers: paste an invite link or address (as today), or "Install on another computer", which opens a
chat with a helper that installs Zorel there over SSH (listening on loopback, User Story 5): each command is shown and
approved, secrets (the setup code) go on stdin, never as arguments.

**Acceptance Scenarios**:

1. **Given** an SSH host the person can reach, **When** they choose "Install on another computer" and give the host,
   **Then** the helper proposes each command, runs the approved ones, shows how to reach the server, and adds it to
   the picker once the person gives its address.
2. **Given** a command fails, **Then** the helper says what failed and what to try, and nothing is added.

---

### User Story 4 - Dropped (2026-11-11): a project on an SSH host

Running a project's agents on another machine while Zorel stays here was dropped after the phase 4 findings (plan.md):
the changes view, undo, the terminal, previews, agents' own copies and computers all assume a local folder. A machine
whose power you want runs a Zorel server (User Stories 1–3, 5), which gives every feature there.

---

### User Story 5 - Safe by default; reaching the server is the person's choice (Priority: P1)

Zorel doesn't set up networks. A server installed from the app listens only on the machine's loopback; how the
person's devices reach it (a private network, an outbound tunnel, a reverse proxy with HTTPS) is theirs to set up,
with short recipes in the docs that say what each exposes. The app keeps its rule: it opens a server only over HTTPS,
or plain HTTP on this computer.

**Why this priority**: Networks, firewalls and domains differ from person to person; doing them for people makes Zorel
responsible for machines it can't see. A server that listens only on loopback exposes nothing by itself.

**Acceptance Scenarios**:

1. **Given** a fresh install, **When** it starts, **Then** it listens on 127.0.0.1 only; listening elsewhere needs an
   explicit setting.
2. **Given** the install from the app ends, **Then** the helper shows the recipes to reach it and adds the server once
   the person gives its HTTPS address.

---

### Edge Cases

- A server forgotten while its window is open: the window closes and the picker returns to this computer.
- A server whose address changed (a new domain): the person edits the address; passkeys tied to the old domain need a
  new sign-in (spec 014).
- The web app (no desktop): the picker shows only the current server and "Open the desktop app to use several".
- A detached chat window stays on its server when the main window switches.
- Two windows on the same server: allowed; each is a view of the same server.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The window MUST show the current server and switch to another from a picker and from ⌘1…⌘9.
- **FR-002**: A server's view MUST stay alive after switching away (no reload when coming back), up to the 3 most
  recently used; one hidden for over 30 minutes closes and reloads when chosen again (each is a renderer process).
- **FR-003**: The picker MUST ask each known server `GET /api/server` (public, already there) when it opens; no
  periodic checks.
- **FR-004**: The app MUST show each server as online or not answering, with the last time it answered.
- **FR-005**: A server's page MUST never reach this computer's bridge beyond listing and switching servers (as today).
- **FR-006**: "Install on another computer" MUST run each SSH command only after the person approves it, and MUST
  pass secrets on stdin.
- **FR-008**: A server MUST listen only on loopback unless a listen address is set explicitly (already so:
  `ZOREL_LISTEN` defaults to `127.0.0.1`).
- **FR-009**: Zorel MUST NOT change the machine's network, firewall or DNS; the docs MUST give recipes (private
  network, outbound tunnel, reverse proxy with HTTPS) with what each exposes.

### Key Entities

- **Server**: a Zorel install the app knows (origin, name, last seen, version, state).


## Success Criteria *(mandatory)*

- **SC-001**: Switching to a known online server shows it in under a second after the first visit.
- **SC-002**: No server is shown as online when its check failed when the picker opened.
- **SC-003**: A fresh Linux machine reachable over SSH runs Zorel without the person typing a command themselves.

## Reaching a server (research, 2026-11-11; for the docs' recipes)

| Recipe | Exposes | Notes |
|---|---|---|
| WireGuard (self-managed) | One UDP port that answers no unauthenticated packet | Free and open; each device needs the WireGuard app. Still HTTPS: a domain name pointing at the private address with a DNS-validated certificate (e.g. Caddy), since sign-in cookies are `Secure` and plain HTTP on a private IP can't hold them |
| Tailscale | No inbound port; `tailscale serve` gives a tailnet-only HTTPS name | Free plan: 6 users, non-commercial; paid for teams |
| Headscale / NetBird | Like Tailscale, self-hosted coordination | The coordinator must be public; NetBird needs ~5 services |
| Cloudflare Tunnel | No inbound port, IP hidden, public HTTPS name (passkeys work) | Free; needs a domain on Cloudflare; TLS ends at Cloudflare (it can read the traffic) |
| Reverse proxy with HTTPS (spec 014) | The machine's IP, port 443 | The person keeps it patched |

## Communication

Unchanged: the app talks to a server over one WebSocket (`/rpc`, Effect RPC: every live event, Stop, send-now) plus
plain HTTPS requests (`/api/…`); it reconnects every second and gets a snapshot on reconnect. Every recipe above
carries WebSockets; a reverse proxy must pass the upgrade (Caddy does by itself; nginx needs `Upgrade`/`Connection`
headers). The health check is one short HTTPS request a minute. No WebRTC: it only matters for peer-to-peer with no
public meeting point, out of scope; the client's transport stays swappable (spec 014).

## Decisions (2026-11-11, the user)

1. A server is a whole other Zorel you switch to (as today); not a target for one chat or agent.
2. The picker sits at the top of the sidebar, with ⌘1…⌘9 and a "Back to this computer" bar.
3. In this spec: install on another computer over SSH from a chat. A project's agents working on an SSH host was
   dropped after the phase 4 findings: use a server on that machine.
4. Dropped: a second Zorel on this computer.
5. Networking is the person's: Zorel listens on loopback by default and documents the ways to reach it; it never
   changes the machine's network, firewall or DNS.
