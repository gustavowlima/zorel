# Feature Specification: Native Desktop Client

**Feature Branch**: `019-native-desktop`

**Created**: 2026-11-12

**Status**: Draft

**Input**: User description: "Spec 019: native desktop client on GPUI replacing Electron. Goal: cut the desktop UI's memory (Electron ~530 MB idle measured) and app size (571 MB .app) while keeping Zorel's own visual identity, made more fluid. Keep the Bun server as the engine and talk to it over the existing HTTP/stream API; the web UI stays for browser access. Direction under evaluation: GPUI + gpui-kit (gpui-base unstyled primitives, own components on Zorel tokens), like Zeron (own GPUI fork + gpui-base only). Must cover strategy, libraries, security, migration phases, spike with measurable gates."

## Context

Measured on 2026-11-12 (macOS, Apple Silicon, app idle):

| What | Today |
|---|---|
| Desktop shell + page (4 processes) | ~530 MB |
| Local server | ~177 MB |
| Each running agent | 300–550 MB (unchanged by this spec) |
| Installed app | 571 MB, of which 243 MB is the embedded browser runtime, 202 MB the agents' browser, 91 MB the server |
| Download | 249 MB |

The desktop app is open all day, so the shell's resident cost is paid all day. This spec replaces the shell and its
page with a native client and leaves the engine (the local server), the agents and the web app as they are.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Prove it before moving (Priority: P1)

Before anything is migrated, a throwaway native prototype shows the sidebar and one chat against the real local server,
and is measured against today's app on the same machine and the same conversation. The result is a go / no-go written
next to this spec.

**Why this priority**: the whole migration costs months; a two-week prototype with numbers decides whether it is worth it
and which toolkit to use, without touching what users run.

**Independent Test**: run the prototype and today's app side by side on one long conversation; read the measurements
report; it states each gate below as met or not.

**Acceptance Scenarios**:

1. **Given** the local server running with a conversation of 500+ messages, **When** the prototype opens it, **Then** the
   report records idle memory, memory after scrolling the whole conversation, time to first screen, and frame pacing
   while a reply streams, next to the same numbers for today's app.
2. **Given** the report, **When** a gate is missed, **Then** the decision is no-go (or a named change of toolkit) and no
   migration phase starts.
3. **Given** the prototype, **When** the person compares the screens, **Then** the identity reads as Zorel's (agent faces
   with their states, the working ring, tokens, type) and not as a stock component kit.

---

### User Story 2 - Daily use in the native app (Priority: P2)

A person installs Zorel and uses it for a whole day — chats, Home, Needs you, Agents, Routines, Settings — in the native
app, with the same features as today's desktop app, and the machine stays light.

**Why this priority**: this is the value: the same Zorel, far lighter and more fluid.

**Independent Test**: install a build, walk the feature parity checklist screen by screen, measure memory at idle and
after an hour of use.

**Acceptance Scenarios**:

1. **Given** the native app open and idle, **When** memory is measured, **Then** the app's own processes (excluding the
   server and agents) use at most a third of what today's shell uses.
2. **Given** an agent streaming a long reply with code and a table, **When** the person scrolls up and back, **Then**
   nothing stutters and the view stays pinned to the bottom when it was there.
3. **Given** an agent waiting for approval or asking a question, **When** the app is in the background, **Then** a system
   notification arrives and clicking it opens that chat at the waiting item.
4. **Given** the agents' browser in use, **When** the person opens the Browser panel, **Then** they see the live page and
   can take over and hand back, as today.
5. **Given** a terminal in the side panel, **When** the person types, **Then** it behaves as today's terminal (colours,
   resize, copy/paste, input methods).

---

### User Story 3 - Same identity, more fluid (Priority: P3)

Zorel's identity (tokens, agent faces, working ring, cards, scenes) carries over and gains motion that the current app
cannot afford: transitions between screens, springy panels, smooth streaming text, under the same reduced-motion rule.

**Why this priority**: the person asked for their identity "more fluid"; it matters once parity exists.

**Independent Test**: screen recordings of the main flows compared with today's; reduced-motion on stops all decorative
motion.

**Acceptance Scenarios**:

1. **Given** the person moves between Home, a chat and Needs you, **When** they watch, **Then** transitions are continuous
   and keep their place (no flash, no layout jump).
2. **Given** the system's reduce-motion setting on, **When** any screen is used, **Then** decorative motion is off and
   state changes are still visible.
3. **Given** the person's light/dark choice and theme, **When** it changes, **Then** the whole app follows at once.

### Edge Cases

- The engine is down, slow to start, or crashes mid-stream: the app shows the state, reconnects, and does not lose the
  draft being typed.
- A team server is on an older version whose API the native app does not speak: that server opens in the system browser
  instead, with a clear note.
- The agents' browser is not installed yet (downloaded on first use): the panel says so and offers to fetch it.
- Very long messages, huge code blocks, a 5,000-turn chat: memory stays bounded and scrolling stays smooth.
- Right-to-left text, emoji, CJK input methods, pasted images and files.
- High-DPI and mixed-DPI monitors; Linux on Wayland and X11; Windows with scaling.
- A screen reader user navigates the chat, the composer and the approval actions.
- The OS keychain is locked or denied: the app still opens and explains what it cannot do.

## Requirements *(mandatory)*

### Functional Requirements

**Prototype and gates**

- **FR-001**: A prototype MUST render the sidebar and one chat (history, live streaming reply, composer, approval card)
  against the real local server, with Zorel's identity.
- **FR-002**: The prototype MUST be measured against today's app with a written, repeatable procedure (same machine,
  same data) and the numbers kept with this spec.
- **FR-003**: Migration MUST NOT start unless every gate in Success Criteria SC-001 to SC-004 is met by the prototype.

**Parity**

- **FR-004**: The native app MUST cover every screen and action of today's desktop app (the parity checklist is part of
  the plan), including: chats and tasks, Home, Needs you, Agents, Projects, Routines, Memory, Settings, onboarding,
  terminal, the agents' browser panel, files and diffs, attachments, keyboard shortcuts.
- **FR-005**: The native app MUST keep today's shell features: tray/menu-bar presence, system notifications that open the
  right place, update checks and installs, keep-awake while agents work on power, folder picker, open-in-system links,
  downloads, the local engine's lifecycle (start, stop with the app, restart after a crash, logs), team servers.
- **FR-006**: The native app MUST use the same engine API the web app uses; no feature may exist only in the native app
  or only in the web app because of the client.
- **FR-007**: All UI text MUST come from the shared translations, in every language Zorel supports today.

**Identity and motion**

- **FR-008**: Visual tokens (colour, type, radius, spacing, motion) MUST have one source shared by the web app and the
  native app, so a change lands in both.
- **FR-009**: Decorative motion MUST stop when the system asks for reduced motion.

**Security**

- **FR-010**: The secret that lets the desktop app talk to its local engine MUST never be shown to page content, written
  in plain text outside the OS keychain or the engine's protected files, or inherited by processes the engine starts.
- **FR-011**: The engine connection MUST stay on the local machine only (loopback) for the local engine; team servers
  MUST use encrypted connections and keep each server's sign-in separate.
- **FR-012**: Nothing from a team server (content, links, files) may reach this computer's folders, apps or local secret
  without the person's explicit action, as today.
- **FR-013**: Updates MUST be signed and verified before installing; a failed update MUST leave the previous version
  working.
- **FR-014**: The release MUST ship with code signing / notarisation on macOS and Windows, and a list of third-party
  licences; dependencies MUST be pinned and checked for known vulnerabilities and licence compatibility on every build.
- **FR-015**: Links and content from agents (markdown, HTML, images) MUST be rendered without executing scripts, and
  external links MUST open in the system browser after the same checks as today.

**Platforms and accessibility**

- **FR-016**: The native app MUST run on macOS, Windows and Linux (Wayland and X11) with the same features; any gap is
  listed in the release notes.
- **FR-017**: Every interactive element MUST be reachable by keyboard and exposed to screen readers with role, name and
  state.

**Migration**

- **FR-018**: Migration MUST be phased; until the native app reaches parity, today's desktop app stays the shipped one.
- **FR-019**: No data migration from today's app is required: Zorel is in development, and the native app may start
  from a clean data folder.
- **FR-020**: The web app MUST keep working in a browser for remote access throughout and after the migration.
- **FR-021**: The agents' browser runtime SHOULD be fetched on first use instead of shipped in the installer, to reduce
  download size.

### Key Entities

- **Engine connection**: where the client's engine is (local or a team server), how it authenticates, its state
  (starting, ready, reconnecting, down).
- **Design tokens**: the named values of the identity (colours per theme, type, radius, spacing, motion), one source for
  both clients.
- **Parity checklist**: every screen and shell feature of today's app, with its state in the native app.
- **Prototype report**: the measurements, procedure, machine, and the go / no-go decision.

## Success Criteria *(mandatory)*

### Measurable Outcomes

Prototype gates (all must pass to start migration):

- **SC-001**: Idle memory of the prototype's own processes is ≤ 180 MB (today ~530 MB), measured the same way.
- **SC-002**: After scrolling a 500-message chat top to bottom and back, memory grows by ≤ 50 MB and no frame takes
  longer than 2 frame intervals for more than 1% of frames.
- **SC-003**: From launch to the chat list visible takes ≤ 0.5 s on the reference machine (engine already running).
- **SC-004**: Building one more screen in the prototype (e.g. Needs you) takes ≤ 2× the time it takes in today's app,
  so the full migration is estimable.

Release outcomes:

- **SC-005**: The installed app is ≤ 200 MB (today 571 MB) and the download ≤ 120 MB (today 249 MB).
- **SC-006**: Idle memory of the app's own processes stays ≤ 1/3 of today's after one hour of normal use.
- **SC-007**: 100% of the parity checklist passes on macOS, Windows and Linux before today's app is retired.
- **SC-008**: The identity review on the main screens finds no element that reads as a stock component kit.

## Assumptions

- The local server stays the engine, in its current language, unchanged except where the native client needs a missing
  endpoint or a typed description of the existing ones.
- The agents' browser keeps streaming page frames from the engine, so the native client does not need to embed a web
  engine for it.
- Team servers keep their own web app; the native app talks to them through the same API when versions match and falls
  back to the system browser otherwise.
- The agents (CLI processes) and their memory are out of scope; the gains are in the shell only.
- The toolkit choice (direction: a native GPU UI framework with unstyled behavioural primitives and Zorel's own
  components) is confirmed or changed by the prototype; the plan's research records the alternatives.
- Zorel is in development with no users to preserve: losing local data, preferences or sign-ins on the switch is
  acceptable, and no upgrade path from the Electron app is built.
- Mobile clients are out of scope.
