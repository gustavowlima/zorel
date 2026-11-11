# Feature Specification: Zorel on a Server, for a Team

**Feature Branch**: not created yet | **Created**: 2026-11-10 | **Status**: Draft

**Input**: "Server with a team (spec 014)". Zorel runs on a person's own server (a rented machine or a box at home),
reached directly over HTTPS or a private network, and a team uses it:
- people join by invite, with roles;
- they sign in with passkeys, or a password plus a code as a fallback;
- they pair devices, which an admin can revoke;
- each person's chats, memory and site logins stay theirs;
- the agents' browser can be watched and taken over under explicit permissions.

The research and the decisions behind each choice are in `docs/research/server-mobile.md`. The mobile app is spec 016; this spec lays its groundwork
(device pairing and device-signed approvals).

## Baseline (2026-11-10, release 0.6.0)

| What | Today |
|---|---|
| Where it runs | On the person's computer (desktop app or local web); the server only answers its own machine |
| Who can use it | One owner, proven by a secret made at each launch (a link printed at start, or the desktop app) |
| People, roles | None. Every request is the local owner (the "Actor" seam exists for this) |
| Chats and memory | All belong to the one owner; personal memory has an owner field but only one person exists |
| Agents' browser | One profile per agent (its own logins) plus one for the person; the panel's view and control have no permissions beyond being the owner |
| Credentials | In the OS keychain |
| Engine CLI sign-in | The person runs the CLI's login on their own computer |
| Connector sign-in (OAuth) | Returns to the local address |
| Packaging | Desktop app per system; a single server binary inside it |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Install on a server and become its owner (Priority: P1)

An admin of a small team starts Zorel on a server and sets the address people will use to reach it (its public
address). The server prints a one-time setup link on its console. The admin opens it and creates the owner account
with a passkey. They also get recovery codes to keep. After that, the setup link no longer works.

**Why this priority**: Nothing else exists without a first, safe owner. A server reachable from a network must never
be usable by whoever finds it first.

**Independent Test**: Start the server with a public address. Open the printed link and create the owner with a
passkey. Open the same link again: it is refused. Restart the server: no new setup link is printed while an owner
exists.

**Acceptance Scenarios**:

1. **Given** a server with no owner, **When** it starts, **Then** it prints a setup link that works once and expires
   after 1 hour, and every other page asks for that link.
2. **Given** the setup link, **When** the admin creates the owner, **Then** the account is made with a passkey (or a
   password plus an authenticator code when the address has no domain name), recovery codes are shown once, and the
   link stops working.
3. **Given** a request whose origin isn't the configured public address, **When** it tries to change anything,
   **Then** it is refused.
4. **Given** a server reached over plain HTTP from another machine, **When** someone opens it, **Then** Zorel refuses
   to sign anyone in. It explains that a secure address (HTTPS or a private network name) is required, and links to
   the setup guide.
5. **Given** the owner lost their passkey, **When** they use a recovery code, **Then** they get in, that code stops
   working, and they are asked to register a new passkey.

---

### User Story 2 - Invite the team with roles (Priority: P1)

The owner invites people. Each invite is a single-use link that lasts 24 hours and carries a role fixed when it was
made: owner, admin or member. The invited person opens it, chooses a name and registers a passkey. Admins manage
people. Members use the projects they belong to. Removing someone cuts their access at once, on every device.

**Why this priority**: "Team now" is the user's decision. Roles checked on every action are what make it safe to
share one server.

**Independent Test**: The owner invites a member. The member signs in and sees only the projects they were added to.
The owner removes the member: the member's open page and paired devices lose access within seconds.

**Acceptance Scenarios**:

1. **Given** an admin, **When** they create an invite, **Then** they choose the role and can copy the link or show it
   as a QR code. The link works once, for 24 hours, and can be cancelled before use.
2. **Given** a member, **When** they try an admin action (invite, change a role, see the activity log, manage
   connectors or engine sign-ins), **Then** it is refused by the server, not only hidden in the screen.
3. **Given** a member who is not in a project, **When** they ask for that project's chats, files, agents or browser,
   **Then** the server answers as if it didn't exist.
4. **Given** an admin removing a person or changing their role, **When** they confirm, **Then** they must first confirm
   with their passkey again. The change takes effect on every session and device of that person at once, and it is
   written to the activity log.
5. **Given** the last owner, **When** someone tries to remove them or lower their role, **Then** it is refused: there
   is always at least one owner.

---

### User Story 3 - Sign in, sessions and devices (Priority: P1)

A person signs in with their passkey, or with a password and an authenticator code. Settings lists their sessions and
devices: where, when last used, which browser or app. They can sign any of them out. Sessions expire after a period
of inactivity and after a maximum age. Repeated failed attempts slow down and then stop for a while.

**Why this priority**: Sign-in and the ability to cut a lost device are what make access trustworthy.

**Independent Test**: Sign in on two browsers. From the first, sign the second out: its next action asks to sign in.
Make repeated wrong attempts for one account: attempts are refused for a growing time, and the activity log records
them.

**Acceptance Scenarios**:

1. **Given** a person with a passkey, **When** they sign in, **Then** they are in with one gesture (fingerprint, face
   or device PIN), with no password typed.
2. **Given** a session idle for longer than the idle limit (default 7 days) or older than the maximum (default 30
   days), **When** it is used, **Then** it asks to sign in again.
3. **Given** wrong attempts from one network address or against one account, invite or pairing code, **When** they
   repeat, **Then** each further attempt waits longer. The person sees a plain message with no detail about which part
   was wrong, and the activity log records the attempts.
4. **Given** the server behind a reverse proxy, **When** it limits attempts, **Then** it counts the real client
   address only from a proxy the admin declared trusted, never from a header any client could send.
5. **Given** a person signing out or being signed out, **When** that happens, **Then** that session stops working on
   the server immediately.

---

### User Story 4 - Each person's chats, memory and site logins stay theirs (Priority: P1)

Chats outside a project are private to the person who started them, even from the owner. Project chats are seen by
the project's members. Personal memory (facts about a person) reaches only that person's turns. When an agent signs
in to a site in its browser for a person, that login belongs to that agent and that person. A project's agents may
use a project profile shared by its members.

**Why this priority**: A team server that leaks one person's chats, memory or site logins to another is worse than
no server.

**Independent Test**: Two members each chat privately with the same agent. Each asks the agent what it remembers about
them: neither sees the other's facts, and neither can open the other's chat by its link. One has the agent sign in to
a site. The other asks the same agent to open that site: it is not signed in.

**Acceptance Scenarios**:

1. **Given** a private chat, **When** anyone but its creator asks for it (by list, link, search or recall), **Then** it
   is not found.
2. **Given** a person's personal memory, **When** another person's turn runs, **Then** none of it is in that turn's
   context or reachable by the memory search tool.
3. **Given** an agent's browser used for a person, **When** the same agent works for another person, **Then** it uses a
   separate profile: cookies, storage and logins are not shared.
4. **Given** a project with a shared project profile turned on, **When** its agents browse for any member, **Then**
   they share that project's logins, and the project settings say so.
5. **Given** an admin, **When** they look at the activity log, **Then** they see who did what (sign-ins, invites, role
   changes, approvals, takeovers). They never see the content of private chats.

---

### User Story 5 - Watch and take over an agent's browser, safely (Priority: P2)

From a chat or the browser cards, a person watches an agent's browser live and, when allowed, takes control (to sign
in, solve a check, or fix something). Watching and controlling are separate permissions. While a person holds
control, the agent can't act on that browser. When the page shows a password or card field with focus, others
watching see that area blurred.

**Why this priority**: Shared browsers are where a team can see each other's secrets. It also builds the stream the
phone will use (spec 016).

**Independent Test**: A member watches an agent's browser in a project they belong to. They take control and type in a
password field: another watcher sees the area blurred. While they hold control, the agent's browser action is refused
with "a person has control". They release control and the agent continues.

**Acceptance Scenarios**:

1. **Given** a person without access to the agent's project or chat, **When** they ask to watch its browser, **Then**
   no picture is sent.
2. **Given** a person who may watch but not control, **When** their client sends a click or a key, **Then** the server
   ignores it and logs the attempt.
3. **Given** a person who takes control, **When** they stop interacting for the lease time (default 2 minutes) or
   close the view, **Then** control returns to the agent, and both events are in the activity log.
4. **Given** a slow connection, **When** someone watches, **Then** they always see the newest picture, never a growing
   delay. Pictures pause while the page doesn't change, and the view shows the page is still.
5. **Given** a focused password or card field, **When** pictures are sent to watchers, **Then** that area is blurred
   for everyone except the person who holds control.

---

### User Story 6 - Engines and connectors work on a server (Priority: P2)

An admin signs Zorel's engines in (Claude Code, Codex and the others) from Zorel's own terminal on the server, using
each CLI's device code or paste-back flow, without SSH. Connectors that sign in through a web page return to the
public address. Credentials are kept in an encrypted file when the server has no keychain.

**Why this priority**: A server where agents can't run or connectors can't connect is useless. These are the gaps
between local and server.

**Independent Test**: On a server with no keychain, an admin opens Settings › Accounts, starts the Claude sign-in and
completes it with the code shown. A turn then runs. They connect a web-sign-in connector, and the service returns to
the public address. Restart the server: both still work, and the credential file on disk is unreadable without the
server's key.

**Acceptance Scenarios**:

1. **Given** an engine CLI not signed in, **When** an admin starts its sign-in from Zorel, **Then** the CLI's own login
   runs in Zorel's terminal. The admin finishes it in their browser, and Zorel never reads or stores the CLI's token.
2. **Given** a connector that signs in on a web page, **When** the service sends the person back, **Then** it lands on
   the configured public address and the connection completes.
3. **Given** no OS keychain, **When** a credential is saved, **Then** it is stored encrypted with a key that only the
   server's user can read, and the setup guide says how to back that key up.
4. **Given** a member, **When** they open engine sign-ins or connector management, **Then** they can't change them;
   they can use what the admins set up.

---

### User Story 7 - Pair a device (groundwork for the mobile app) (Priority: P2)

A person pairs a phone (spec 016) by scanning a QR code from Settings › Devices. The code carries the server's address,
a fingerprint of the server's identity, and a one-time secret that lasts at most 5 minutes. The device creates its own
key, which never leaves it. The person, or an admin for someone else, confirms the device by name before it gets
access. Approvals sent from a device are signed with its key.

**Why this priority**: The mobile app needs it, and it must be right before the app exists. It can be tested with a
test client.

**Independent Test**: Make a pairing code and complete pairing with a test client. The device shows as "waiting for
confirmation" until confirmed; then it can read the person's chats. Revoke it: its next request is refused. Reuse the
same code: it is refused.

**Acceptance Scenarios**:

1. **Given** a pairing code, **When** it is used once, older than 5 minutes, or guessed wrong repeatedly, **Then** it
   no longer works.
2. **Given** a device that paired, **When** it isn't yet confirmed, **Then** it can't read or do anything.
3. **Given** a confirmed device, **When** it approves an action, **Then** the server accepts it only when it is signed
   by that device's key, the action is still pending, and the device isn't revoked.
4. **Given** a device's access token, **When** it leaks without the device's key, **Then** it expires within an hour
   and can't be renewed or used to approve.

---

### User Story 8 - Install it the way servers are installed (Priority: P3)

An admin runs Zorel from a container image (with the agents' browser included) or from the single binary. They follow
a short guide to reach it over a private network (Tailscale) or through a reverse proxy with HTTPS (Caddy). Data lives
in one folder that the guide says how to back up.

**Why this priority**: It makes the rest reachable, but people can run the binary by hand first.

**Independent Test**: On a clean Linux machine, follow the guide with the container image and with the binary. Both
reach the setup link and run an agent turn with a browser step. The guide's backup steps restore a working server.

**Acceptance Scenarios**:

1. **Given** the container image, **When** it starts with a data folder and a public address, **Then** Zorel runs with
   its browser, and nothing but the web port is exposed.
2. **Given** a reverse proxy, **When** it forwards to Zorel, **Then** live updates and browser pictures stream without
   being buffered, as the guide's configuration shows.

---

### Edge Cases

- The public address changes (a new domain): passkeys made for the old one stop working. The admin is warned before
  saving, and people sign in with a recovery code or password to register a new passkey.
- The server is only reachable by an IP address: passkeys can't work there, so sign-in uses password plus
  authenticator code, and Settings explains how a domain or private network name enables passkeys.
- Two admins change the same person at once: the last confirmed change wins, and both are in the activity log.
- A person removed while an agent is running a turn they started: the turn finishes or stops as an owner would expect
  (it is not left half-done), but its results go only to people who still have access.
- A routine created by a person who is later removed: it is paused and an admin is told. It never keeps running under
  a removed person's access.
- The clock on the server is wrong: expiries use the server's clock, and pairing codes have a margin of under a minute.
- A watcher's connection drops while they hold control: the lease expires and control returns to the agent.
- The desktop app on a person's own computer keeps working as today (single owner, local), with no sign-in screen.
- Everything works on Windows, macOS and Linux servers. The container image is Linux; what couldn't be run live on
  Windows is stated.

## Requirements *(mandatory)*

### Functional Requirements

**Reaching the server**

- **FR-001**: Zorel MUST run in a server mode in which the admin sets the listen address and the public address. The
  desktop and local modes MUST keep working as today.
- **FR-002**: In server mode, every request that changes anything MUST come from the configured public address
  (origin check). The passkey domain MUST come only from the configured public address, never from the request.
- **FR-003**: Zorel MUST refuse to sign anyone in over an insecure connection from another machine, with a message that
  links to the guide.

**First owner and the team**

- **FR-004**: A server with no owner MUST print a one-time setup link (valid 1 hour, single use) and accept nothing else
  until an owner exists.
- **FR-005**: Admins MUST be able to create invites with a fixed role (owner, admin, member), single use and valid 24
  hours, shown as a link and a QR code, and cancel them.
- **FR-006**: Every server action MUST check the person's role and their access to the resource (project, chat, agent,
  browser, device). Refusals MUST look the same as "not found" for resources the person may not know exist.
- **FR-007**: Admin actions (invites, roles, removing people, revoking others' devices, engine and connector settings)
  MUST require a fresh confirmation with the admin's passkey, or password plus code. The confirmation lasts at most 5
  minutes.
- **FR-008**: Removing a person or changing their role MUST take effect on all their sessions and devices at once.
  There MUST always be at least one owner.

**Sign-in, sessions, devices**

- **FR-009**: People MUST be able to sign in with a passkey, or with a password plus an authenticator code where
  passkeys can't work. Each account MUST get one-time recovery codes.
- **FR-010**: Sessions MUST be kept on the server, revocable one by one. Each MUST have an idle limit (default 7 days)
  and a maximum age (default 30 days), and only a hashed form of its secret may be stored.
- **FR-011**: Settings MUST list a person's sessions and devices (kind, last used, approximate place by network), and
  let the person sign any of them out.
- **FR-012**: Failed sign-in, invite and pairing attempts MUST be limited per network address and per target (account,
  invite, pairing code), with a growing wait. They MUST be written to the activity log, and the client address MUST
  only be read from a declared trusted proxy.
- **FR-013**: Pairing MUST use a one-time code (at most 5 minutes) carrying the public address and the server's identity
  fingerprint. The device MUST create its own key and register only the public part. The device MUST stay inactive
  until confirmed by name.
- **FR-014**: A device's access token MUST last at most 1 hour. Renewing it and approving actions MUST require a
  signature by the device's key.

**What stays a person's own**

- **FR-015**: Chats outside a project MUST be visible only to their creator. Project chats MUST be visible only to the
  project's members.
- **FR-016**: Personal memory MUST reach only its owner's turns and searches.
- **FR-017**: An agent's browser profile MUST be per agent and per person. A project MAY turn on a shared project
  profile for its agents, and the project's settings MUST say so.
- **FR-018**: The activity log MUST record sign-ins, failed attempts, invites, role changes, removals, device pairing
  and revocation, approvals and browser takeovers. It MUST be visible to owners and admins and never show private chat
  content.
- **FR-019**: Routines and running turns of a removed person MUST be paused or stopped, and an admin MUST be told.

**The agents' browser**

- **FR-020**: Watching and controlling an agent's browser MUST be separate permissions, checked by the server for every
  picture sent and every input received.
- **FR-021**: Taking control MUST give one person a lease (default 2 minutes, renewed while they interact). While it
  lasts, the agent's browser actions MUST be refused with a clear reason. Taking and returning control MUST be logged.
- **FR-022**: The view MUST always show the newest picture, never a backlog. Its speed MUST follow what the viewer's
  connection can take, and it MUST show a still page as still, not as a broken connection.
- **FR-023**: When a password or payment card field has focus, the pictures sent to anyone but the controlling person
  MUST blur that field's area.

**Engines, connectors, credentials**

- **FR-024**: Admins MUST be able to sign engine CLIs in from Zorel's terminal on the server, using each CLI's own
  login. Zorel MUST never read or store the CLI's token.
- **FR-025**: Connectors that sign in on a web page MUST return to the public address.
- **FR-026**: Without an OS keychain, credentials MUST be stored encrypted with a key readable only by the server's
  user. The guide MUST say how to back it up.

**Delivery**

- **FR-027**: Zorel MUST be offered as a container image that includes the agents' browser, and as the single binary.
  A guide MUST cover a private network (Tailscale), a reverse proxy with HTTPS (Caddy), and backup and restore of the
  data folder.

### Key Entities

- **Person**: someone on the team. Has a name, a role (owner, admin, member), passkeys and/or a password plus
  authenticator, recovery codes, and a state (active, removed).
- **Invite**: single use; has a role, who made it, an expiry and its state (open, used, cancelled, expired).
- **Session**: a signed-in browser or app. Has its person, the kind of client, the last time and place used, an
  expiry, and whether it was revoked.
- **Device**: a paired app. Has its person, its name, its public key, a state (waiting, active, revoked), and when it
  was paired and last used.
- **Pairing code**: one time; has its person, an expiry and the server identity fingerprint it carries.
- **Project membership**: which people belong to which project.
- **Browser profile**: whose logins an agent uses: per agent and person, or a project's shared profile.
- **Control lease**: who controls an agent's browser now, and until when.
- **Activity entry**: who, what, when, from where, and on which resource (never private content).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An admin goes from a clean Linux machine to a signed-in owner, following the guide, in under 15 minutes.
- **SC-002**: An invited person joins and is signed in within 2 minutes of opening the invite.
- **SC-003**: Removing a person or revoking a device takes effect everywhere within 5 seconds.
- **SC-004**: Across an automated suite of every server action, 100% check role and resource. A member reaches none of
  another person's private chats, personal memory or site logins.
- **SC-005**: 20 wrong attempts against one account from many addresses don't get a single guess through faster than
  one per growing wait. The log records all 20.
- **SC-006**: On a mobile-grade connection (about 5 Mbit/s and 100 ms of latency), the browser view stays within half
  a second of the page and never builds a backlog.
- **SC-007**: A person takes control of an agent's browser in one press. The agent can't act on it until control
  returns.
- **SC-008**: A local desktop install upgraded to this version keeps working with no sign-in screen and no change in
  behavior.

## Assumptions

- The server is a Linux machine the team controls. Windows and macOS servers run the binary and are covered by the
  existing per-system tests. The container image is Linux only.
- Teams are small (up to about 20 people). One database file is enough (Postgres stays out of scope, as decided in
  D0 and phase 8).
- A domain name or a private network name is available for passkeys. Without one, password plus authenticator code is
  the supported path.
- Engine subscriptions are individual. The guide says teams should use API keys or each person's own account where
  provider terms require it. Zorel doesn't enforce provider terms.
- Agents run under the server's user, inside the existing sandboxes. Per-person containers are out of scope.
- Out of scope: the relay, the mobile app itself (spec 016), push notifications, single sign-on with a company identity
  provider, Postgres, per-person containers, and video streaming of the browser.
- Technical decisions carried into the plan from `docs/research/server-mobile.md`:
  - Sessions are a server-side table with hashed tokens and a host-only secure cookie.
  - The device key is hardware-backed when possible.
  - Browser pictures go as binary messages, with the browser's own frame pacing tied to the viewer's acknowledgement,
    a first picture when someone joins, and quality adapting to round-trip time.
  - Origin is checked together with the fetch-site header.
