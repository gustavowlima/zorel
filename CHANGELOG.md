# Changelog

What changed in each version of Zorel. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org) (while in 0.x, a minor version may change things). Each
section is also the release's notes on GitHub.

## [0.6.0] - 2026-11-10

### Added

- **Routine flows.** A routine is a trigger plus steps (a connector's tool, an agent, a cheap check, a yes/no
  condition, Ask me, end), built as a list in New routine or on a canvas. Runs go step by step, resume after a
  restart and never send a write twice. Triggers: at a time (weekly, once, monthly), when your day starts, something
  new in a connector, a message in a channel, a webhook, or by hand; **Test now** shows what one would find.
- **Routines that report:** run history with outcomes, what changed since the last report, a week view and Today;
  results go to a notification, Telegram (with Yes/No buttons), a page or any connector.
- **Agent teams:** call `@team` and one member answers; projects name the agents and teams that take part, and each
  message goes to the right one.
- **Tasks beside the chat:** a task an agent gives a teammate opens in a drawer next to the chat instead of filling
  the sidebar; the teammate's report shows its status, how it checked and a link to the task.
- **Browser cards:** one card per agent's browser (and yours) with a live picture; open one to see its tabs. The
  Browser panel also opens full screen, with the agent's pointer and what it's doing.
- **Antigravity** (Google's agent CLI) as an engine, under Zorel's access levels; Antigravity and OpenCode install
  from inside Zorel.
- **Zorel in Brazilian Portuguese:** follows the system's language, or pick it in Settings › General.
- Page editor with a formatting toolbar and real heading sizes; tool arguments in Form or JSON mode.

### Changed

- New logo, a darker neutral palette, and content that settles in softly on every tab and list; the new chat shows
  the logo's orbits behind it.
- Every screen works in a window 390 px wide.
- Desktop updates: Restart shows it's updating, can't be pressed twice, and says why an install failed.

### Security

- The desktop app hands the server its secret on stdin, not in the environment; agents get their own process
  namespace; agent-desktop downloads are checked against pinned SHA-256 values; containers run with
  no-new-privileges and stop when Zorel exits.
- Text from webhooks and watched connectors is outside data: runs it starts are capped at "Ask first" and facts
  learned from it go to review.
- Opening a local-network page (192.168.x, 10.x, .local) asks first; risky commands from every engine reach the
  approval card; Codex on Windows asks before writing below full access.

## [0.5.0] - 2026-11-09

### Added

- **Memory that works for you.** Agents keep facts while they reply (Keep, Move, Undo right in the chat) and file
  them on a **map** of what they're about; each turn recalls by association, by meaning (a local model, no cloud)
  and from the project's past chats. On LongMemEval-S retrieval, hit@5 goes from 0 to 0.940.
- **Memory** has three views (Facts, Map, Pages) under one header: tabs per owner, a review of new and old facts,
  pinned facts, and an Undo receipt when a fact is forgotten or moved.
- **An agent's own Linux computer** (Podman first, Docker as fallback): it installs and runs anything in its own
  container, with the project folder lent to it.
- **Desktop apps** (agent-desktop), an optional install from inside Zorel: agents read and use your apps through
  the accessibility tree.
- **Telegram channel:** talk to your agents from Telegram after pairing with `/pair`.
- **Twelve connectors beyond code**, and MCP tools loaded only when an agent needs them.

### Changed

- **One sidebar:** New chat and Search beside the logo, then Needs you, Agents, Routines and Memory; Skills moved to
  Settings.
- A reply reads as it happened: words and groups of steps in order, each turn's work a tree with a one-line summary.
- Every screen shares one rhythm (header, column, sections), Pages included.
- **Processes** shows only what a chat's own terminals and sessions started, plus Zorel itself.
- Cheaper turns: large tool results are shortened (the rest read on demand), engines keep a stable prompt prefix,
  and a fact said again in other words is merged.
- Settings: the memory model sits under Advanced; the routing model choice is gone (automatic covers it).

### Security

- Text from tools, pages and recalled memory is marked as outside data: it can't give the agent orders.

## [0.4.0] - 2026-11-05

### Added

- **See your agents work.** The Agents screen says what each one is doing now; **Watch** opens the chat it is
  running in. An agent's new **Work** tab lists what it's doing this moment and every session it ran (project › chat,
  how it ended, how long, steps, tokens); a session opens its chat on that reply. **Chat with** opens your own chat
  with it.
- **Run** in a chat's header: start the project's server (a package.json script, or any command with `{port}`) on a
  free port, its output in the Terminal panel and its page in the Browser panel. Agents can do the same
  (`zorel_preview`), with your OK below full access.
- **Chat access** beside the model: Agents' own, Ask first, Workspace or **Full access** for every agent in that chat
  (Full access asks once what it means). Delegated tasks keep the chat's level.
- **Token limits per agent:** a monthly one and one per reply (with **Continue**), on the agent's page.
- **Try again** on a reply that failed or was stopped.
- **Archive an agent:** out of the team and every picker, its history kept; Restore brings it back.
- **Routines that watch a connector:** a read-only tool checked every 5 minutes; the routine runs on what's new (a new
  issue, a failing monitor, an email).
- **Agents working at once:** a limit in Settings › General; chats over it wait in line.
- **"#" calls an agent into a chat**, mentions show as chips, and the sidebar gets faces and search.
- **Steering:** a message sent while Claude or Codex works reaches it in the running turn.

### Changed

- The message box keeps the text, attach, Stop and Send; the model, access and context sit under it.
- A reply keeps every step (reads and searches too) and more of each output, with **Show all**.
- Quitting the desktop app asks first when agents or routines would stop.

## [0.3.0] - 2026-11-05

### Added

- **Agents get faces** (Open Bot Avatar): one per agent, in the chat, the lists and the Builder.
- **Build with AI** proposes the agents in the middle of its screen for review, answers the questions it asks, picks
  a primary model per agent before creating, and builds a global team from a chat without a project.
- **Who answers, with `#`** in the message box on the home screen (as in a chat), shown as a chip you can clear.
- **Reasoning as a slider** in the model picker; the picker keeps one size and sends a provider that isn't set up to
  its page in Settings.
- **Routines from the Routines screen:** "New routine" asks which agent; routines are created in a dialog.
- **Search in long lists:** Agents, selects and the chat's team picker get a search field past 8 items.

### Changed

- **Pages are grouped:** each section of Settings, Storage, Skills, Providers and an agent's page is one group of
  rows, with the control on the right.
- **Agents as rows**, grouped with a count, tags only for what differs from the default; the same in a project's
  Agents tab.
- **An agent's profile in three groups** (who it is, model, instructions); unsaved edits are kept when you leave the
  page, with Discard. Its memories and skills open Knowledge filtered to it.
- **Knowledge:** the kind as tabs and the state in a "Show" select; one empty state when there is nothing yet.
- **Needs you** as one list; the chat's name opens it.
- A project's overview starts with its team and its chats; the sidebar folds on its own under 900px.
- Menus, selects and pickers share one look; a trigger stays lit while its menu is open; focus rings show only when
  you move with the keyboard.

### Fixed

- The Builder no longer starts on a fixed model: it picks the first one available, and a failure can be retried.
- The chat's step list opens under its pill; opening the Builder never deletes a conversation someone is in.
- The message box's model chip sits centred with the buttons beside it.

## [0.2.2] - 2026-11-05

### Fixed

- The installed app's server stopped (code 1) when the agents' browser started: playwright-core now ships as files next to the server instead of inside its binary.

### Changed

- The Windows installer has one name every version (`zorel-windows-setup.exe`), so zorel.dev links it.
- Graphite theme, floating menus, Add project with a folder browser, standard fields; see the merged pull requests #4 and #5.

## [0.2.1] - 2026-11-04

The 0.2.0 builds for macOS and Linux failed in CI; this is the same release, built for all three systems.

### Fixed

- macOS release build without a signing secret (signed ad hoc, as intended).
- Linux AppImage: the executable is named `zorel`.

## [0.2.0] - 2026-11-04

The first public version.

### Added

- **Agents that work on your projects** on Claude Code, Codex, OpenCode and Gemini CLI, on your own subscription, or
  any model with an API key through OpenCode.
- **Access levels and approvals:** "Workspace", "Ask first" and "Full access", with an OS sandbox below full access
  and approval cards that show exactly what will run.
- **Memory that learns:** facts and skills from your conversations, reviewed before they stay, found by search even in
  other words; knowledge pages per project.
- **A browser for the agents**, bundled with the desktop app, one isolated context per agent.
- **Routines** on a schedule or a webhook, a workspace you can export and import, usage and limits per account.
- **Desktop app** for macOS, Linux and Windows, with updates in the app and `install.sh` on macOS and Linux.

### Security

- The local API requires a per-launch session secret; agents can't call it.
- Imported workspaces arrive with routines and connectors off and full access capped.

[0.6.0]: https://github.com/gustavowlima/zorel/releases/tag/v0.6.0
[0.5.0]: https://github.com/gustavowlima/zorel/releases/tag/v0.5.0
[0.4.0]: https://github.com/gustavowlima/zorel/releases/tag/v0.4.0
[0.3.0]: https://github.com/gustavowlima/zorel/releases/tag/v0.3.0
[0.2.2]: https://github.com/gustavowlima/zorel/releases/tag/v0.2.2
[0.2.1]: https://github.com/gustavowlima/zorel/releases/tag/v0.2.1
[0.2.0]: https://github.com/gustavowlima/zorel/releases/tag/v0.2.0
