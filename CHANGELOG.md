# Changelog

What changed in each version of Zorel. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org) (while in 0.x, a minor version may change things). Each
section is also the release's notes on GitHub.

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

[0.2.2]: https://github.com/gustavowlima/zorel/releases/tag/v0.2.2
[0.2.1]: https://github.com/gustavowlima/zorel/releases/tag/v0.2.1
[0.2.0]: https://github.com/gustavowlima/zorel/releases/tag/v0.2.0
