# Zorel

Zorel is an open source workspace for AI coding agents. You organize work into **projects**, give each project a **team of agents**, and talk to them in **chats** and **multi-agent channels**. Zorel owns the context and the knowledge, so you can switch model, provider or account on any message without losing anything. It runs as a desktop app (macOS, Windows, Linux) or as a local web app.

## Why Zorel

- **The context belongs to Zorel, not to a CLI session.** Every turn is assembled in layers (base, agent, channel, your memories, project brief and knowledge, agent memories, chat summary, knowledge retrieved for the current message, recent messages) under a budget. That assembly is the resume point for any engine, so switching model or provider needs no handoff.
- **It learns while it works.** Work becomes project knowledge: facts, decisions, how-tos, pitfalls and session notes, versioned with restore. What is about *you* (preferences, ways of working) only enters the context after you approve it.
- **A team of agents, not one chat.** Agents delegate to each other with `@mentions`, every handoff is visible in the chat, and every action that changes something goes through the approval level you chose.
- **Uses what you already pay for.** Subscriptions run through the official CLI you are already logged into (Claude Code, Codex, other ACP agents). API keys from any provider work too. Several accounts per provider, optional automatic failover when a limit runs out, and usage you can see.
- **Light.** One process, one SQLite file, no required external service.

## Features

### Projects, agents and chats
- Projects with a folder on disk, a brief, a default agent, their own agents, chats and knowledge.
- Standalone chats and **channels** with several agents. The lead (★) answers when nobody is mentioned; `@handle` picks who answers; agents pass the turn by mentioning each other (up to 3 replies in a row without a message from you).
- Create and edit agents and teams from the conversation (a proposal card you accept), or in the Builder. Agent versions with restore, export and import without secrets.

### Turn runtime
- Turns run in the background, queued per chat, and survive closing the window. A running turn interrupted by a restart is kept as partial, never replayed.
- Steer a running turn, interrupt it, or **edit from here**: rewind the conversation and, optionally, the file changes made since.
- Runaway guards: a stalled turn, a repeated step loop or a streak of failing steps ends the turn and says why.
- **Pause all** stops running turns and holds the queue and routines until you resume.
- When every route of a chat hits its usage limit, the chat resumes on its own when the limit resets.

### Coding workspace
- Per-turn **diffs** (Changes) and a file browser with tabs, name search and a virtualized tree.
- **Git** panel, integrated **terminal** (PowerShell on Windows, your login shell elsewhere), `package.json` scripts as terminal tabs, running servers with open-in-browser and stop.
- A built-in **browser** agents can drive.
- **Processes**: servers listening inside a chat's folder, live terminals, engine sessions and MCP connections, with live CPU and memory.

### Approvals and tools
- Three access levels per agent: **Workspace** (default), **Ask before** and **Full access**, mapped onto each engine.
- One approval card for native tools and MCP tools: approve once, always allow (revocable rule) or deny with a reason. Pending approvals are persisted and expire. **Needs you** collects everything waiting on you.
- MCP servers, local (command) or remote (URL), global or per project, with a catalog of connectors and OAuth sign-in. Each server has a mode:

| Mode | The agent sees | Asks for approval |
|---|---|---|
| Read only | read tools only | — |
| All, writes with approval | every tool | tools that write or are sensitive |
| All, without asking | every tool | nothing |

Tools are classified by their MCP annotations and, without them, by name (`delete`, `send`, `deploy`… are sensitive). Every turn gets its own session on a **local MCP gateway** with a secret URL: it is the only tool source for any engine, and a call outside the list never runs. Server tokens and headers live in the **system keychain**, never in the database.

### Knowledge
- Knowledge pages scoped to you, a project or an agent: Markdown, full-text search (SQLite FTS5), every edit versioned with restore, pin to keep a page in context.
- Agents search and write knowledge through Zorel tools; a feed shows what Zorel learned.
- Context meter and **Compact** to summarize older messages on demand.

### Models, accounts and usage
- Pick the model on any message. Model ids are `<provider>/<model>`, and models are listed by each engine.
- Multiple accounts per provider, each with isolated credentials (its own CLI login folder for subscriptions, its own keychain entry for API keys).
- Optional **failover**: an ordered list of alternatives per agent or chat, used only when the turn has not acted yet, so no side effect is ever repeated.
- **Usage**: tokens, estimated cost and time per turn, aggregated by agent, project, account and model, plus each subscription's limit windows, reset times and alerts.

### Automation
- **Routines**: scheduled runs of an agent, each in its own chat.
- System notifications when a chat needs you, fails or finishes while you are elsewhere.
- **Move to another computer**: export the whole workspace (database and attachments, no secrets) as one archive and import it elsewhere.

## Engines

| Credential | Engine | How it signs in |
|---|---|---|
| Claude subscription | Claude Agent SDK, running your installed `claude` CLI | `claude auth login` |
| ChatGPT subscription | Codex App Server | `codex login` |
| Other agent CLIs (Gemini CLI, Cursor, Kimi…) | ACP | each CLI's own login |
| API key: Anthropic, OpenAI, OpenRouter, Gemini, or a local server (Ollama, LM Studio) | OpenCode via ACP | key saved in Settings (stored in the system keychain) |

Zorel never reads or stores a CLI's OAuth login. CLIs run without saved sessions, without your user config, hooks or plugins, and only with the gateway's tools. Each provider has its own terms for third-party apps; sharing one subscription among several people through one Zorel is risky.

## Install

The desktop app (macOS and Linux):

```bash
curl -fsSL https://pub-8f59c7217f0547e39737b4e19c25cbe6.r2.dev/latest/install.sh | sh
```

On Windows, use the installer from the latest release. Running the script again updates the app; the app's update button does the same.

## Run from source

Requires [Bun](https://bun.sh) 1.4+.

```bash
bun install
bun run dev            # server on :4317 and web on :5173; open the login link the server prints
bun run start          # builds the web app and serves everything from one process; open the login link it prints
bun run desktop        # desktop app (Electron) in dev mode
bun run desktop:build  # packages the desktop app into apps/desktop/artifacts
bun run lint           # Biome
bun run test
bun run typecheck
bun run check:ui       # design system rules
bun run check:i18n     # translation catalog
```

Data lives in `~/.zorel` (change it with `ZOREL_HOME`). The server only listens on `127.0.0.1`.

## Structure

```
packages/contracts   API and entities (Effect Schema): the single source of types for server and web
packages/i18n        typed UI message catalog (English is the source)
apps/server          Bun + Effect HttpApi/RPC + Drizzle over SQLite
  runtime.ts         per-chat turn queue, recovery, guards
  context.ts         layered turn assembly
  engines/           Claude Agent SDK, Codex App Server, ACP
  tools.ts           MCP hub, policy and per-turn gateway
  secrets.ts         keys and variables in the system keychain
  main.ts            routes and the web build
apps/web             Vite + React 19 + Tailwind v4, design system in src/ui
apps/desktop         Electron window; the server runs as a separate compiled Bun process
apps/site            zorel.dev landing page
```

Architecture, decisions and roadmap: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Releases

CI (`.github/workflows/ci.yml`) runs typecheck, tests and build on every push and pull request. A `v*` tag builds the desktop app for each system, publishes a GitHub release and copies its files to R2 (`latest/`), which `install.sh` and installed apps download from (secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`). macOS signing and notarization turn on when `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` are set; without them the macOS build is signed ad hoc and installs with `install.sh`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, checks and conventions, [SECURITY.md](SECURITY.md) to report a vulnerability privately, and [CHANGELOG.md](CHANGELOG.md) for what changed in each version.

## License

[Apache-2.0](LICENSE). Third-party attributions are in [NOTICE](NOTICE).
