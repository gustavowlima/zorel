# Contributing to Zorel

Thanks for wanting to help. Zorel is a local app where AI agents work on your projects: a Bun server (Effect, SQLite),
a React web app, an Electron shell for the desktop, and the coding-agent CLIs people already use (Claude Code, Codex,
OpenCode, Gemini CLI). This guide gets you from clone to pull request.

## Setup

You need [Bun](https://bun.sh) 1.4+ on macOS, Linux or Windows, and at least one harness signed in
(`claude auth login` is the quickest).

```bash
git clone https://github.com/gustavowlima/zorel.git
cd zorel
bun install
bun run dev        # server on :4317, web on :5173: open the login link the server prints
bun run desktop    # or the desktop app (Electron) in dev mode
```

Handy environment variables:

| Variable | What it does |
|---|---|
| `ZOREL_HOME=<dir>` | Use another data folder (default `~/.zorel`): a fresh install, a copy to test against |
| `PORT=<n>` | The server's port (default 4317) |
| `ZOREL_MEMORY_MODEL=<provider/model>` | The model that consolidates memories (default: the chat's) |
| `ZOREL_API_ENGINE=direct` | API-key models run on the direct engine instead of OpenCode |

## Checks

```bash
bun run typecheck
bun run lint
bun run test
bun run check:ui     # screens use the design system's primitives and tokens
bun run check:i18n   # every string a person reads is in the catalog
bun apps/server/bench/memory-recall.bench.ts 1000 --check
```

All of them run on every pull request (the tests that depend on the system also on macOS and Windows). A change
in the server comes with a test. For UI changes, attach a screenshot.

## How the code is laid out

```
apps/
  server/     Bun + Effect: HTTP/RPC API, SQLite (Drizzle), turns, engines (CLIs, ACP, APIs), MCP gateway,
              memory and knowledge, routines, the agents' browser
  web/        React UI (React Aria, Tailwind tokens), talking to the server over HTTP and RPC
  desktop/    Electron: the window, the server as a child process, updates, install.sh
  site/       zorel.dev, a static page
packages/
  contracts/  The API contract (Effect Schema), shared by server and web
  i18n/       The string catalog
docs/         ARCHITECTURE.md: decisions, the target architecture and the phases
.agent/       Engineering memory: read .agent/memory/index.md before a task, update it after
```

## Conventions

- **Language.** Code, comments, commits, pull requests, docs and prompts are in English. UI text goes through
  `t()` and the catalog in `packages/i18n`.
- **macOS, Linux and Windows.** Every feature works on the three: use `path.join` for paths, no shell-specific
  commands, and a test for anything that parses system output.
- **Small and direct.** The simple version that works over infrastructure for cases that don't exist yet.
  Comments say why, not what.
- **Dependencies** need a reason in the pull request, and a version published at least two weeks ago.
- **Design system.** Screens use the primitives in `apps/web/src/ui` and the theme tokens (`apps/web/DESIGN.md`);
  `check:ui` refuses literal colors, arbitrary sizes and raw controls.
- **Commits** are small and focused, with a message in the imperative ("Add …", "Fix …").

## Pull requests

1. Open an issue first for anything bigger than a fix, so we can agree on the approach.
2. Branch from `main`, keep the change focused, and make sure every check passes.
3. Describe what changed and how you checked it.

## Reporting bugs

Open an issue with your system and its version, the Zorel version (**Settings › General › About**), the engine and
model involved, and the steps to reproduce. A screenshot of the chat with its steps expanded helps a lot.

For security issues, see [SECURITY.md](SECURITY.md) instead of opening a public issue.
