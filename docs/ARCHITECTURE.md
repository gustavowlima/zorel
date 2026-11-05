# Zorel architecture

This document records the current state, the target architecture and the decisions made, with the reason and the discarded alternatives.

It comes before the code: when you change a decision, update it here and in `.agent/memory/`.

Reviewed on 2026-11-04.

**Background processes (2026-11-04):** Settings › Processes and the chat header button read `GET /api/processes`: servers listening on ports inside some chat's folder (one `lsof` for all folders; the project folder belongs to all of its chats, a worktree belongs to one), live terminals, engine sessions kept between turns and open MCP connections. Stopping a server only accepts a pid from that list (never an arbitrary process); closing a session never happens under a running turn. Running turns come from the live statuses the web already receives.

**Windows, macOS and Linux (2026-11-04, user rule: every feature on all three):** the terminal opens PowerShell on Windows (`pwsh` when installed) and `$SHELL` as a login shell on the others; the server binary comes out as `zorel-server.exe` on Windows and packaging carries both names; ACP agents below "Full access" run confined in Seatbelt (macOS) or bubblewrap (Linux, when installed: the whole system read-only and the same writable folders), tested for real in a container; on Windows there is no equivalent sandbox yet and the turn is refused with the explanation. CI has one job per system for what depends on it (processes, terminal, sandbox) and builds the app for all three (dmg/zip, Windows installer, AppImage); the Developer ID certificate only enters the macOS job. The repository has no remote yet, so CI has not run.

**Real-time usage and the three systems (2026-11-04):** `server/procs.ts` reads the process table on Windows (one PowerShell kept open for the server's lifetime, queried on each read: `Get-CimInstance Win32_Process`), on Linux (`/proc`, no new process) and on macOS (`ps`), the listening ports (`netstat`, `ss`, `lsof`) and the working folder where the system reports it (Linux and macOS). CPU comes from the difference in CPU time between two reads (100% = one core). Zorel's tree starts at the desktop app (`ZOREL_PARENT_PID`) or at the server and adds up everything they started; each row counts its own process and its children, and the parts do not overlap (agent sessions, terminals, connections, server, others, app). A server belongs to a chat by its folder (Linux and macOS) or by having been born from a terminal or session of the chat (all three; this is how Windows finds them). The session pid comes from the engine itself (Claude: `spawnClaudeCodeProcess` identical to the SDK's; Codex: the app-server; local MCP: the transport). The parsers have tests with sample output from each system; Linux was run for real in a container; Windows only through the tests.

**Moving to another computer (2026-11-04, phase 7):** Settings › Storage › "Move to another computer". Export (`GET /api/workspace/export`) produces a `.tar.gz` (`Bun.Archive`, no dependency) with a consistent copy of the database (`VACUUM INTO`), the attachments and a manifest with the source folder. Import (`POST /api/workspace/import`) checks the file (manifest and Zorel tables), stores it as `import-pending.tar.gz` and applies it on the next startup, before the database opens: the current database and attachments go to `backups/before-import-<time>/`, the imported ones take their place and attachment paths are rewritten to the new folder (unpacked inside the data folder, so files are not moved between disks). What does not travel: keychain secrets (API keys, connector logins), CLI logins (`accounts/`), restore points (`workspaces/`), browser profiles and backups. `server/transfer.ts`, with a round-trip test.

**Prompt language (2026-11-04):** everything that goes to the model (base prompt, consolidation, tool results, engine errors) is in English, and nothing tells it to reply in a given language: the model follows the language of whoever writes.

**Name (2026-11-04):** the project was called **Zero** and became **Zorel** ("Zero" collided with other products and had no domain; zorel.dev belongs to the author). What already existed keeps working: the `~/.zero` folder (with `zero.db`) stays in use when it exists and `~/.zorel` does not, without being moved, because the database stores absolute paths of attachments and accounts; keychain secrets are read from the old service `dev.zero.app` and copied to `dev.zorel.app`; browser preferences `zero.*` are copied to `zorel.*`; `zero-*.db` backups keep being pruned; agents exported as `zero.agent` are still imported. The desktop app changes its appId (`dev.zorel.app`), so Electron's data folder is new (logins in the agents' tabs start over).

**Purpose:** Zorel is, **now**, an agent platform **for code**: desktop and local web, projects, a team of agents, its own memory and context. **Later**, it evolves toward **hosted and automation**, without a rewrite, because the doors for that stay open from now on (D17).

---

## 1. Decisions

| # | Decision | Why | Discarded |
|---|---|---|---|
| D0 | **Light first**: one process, one database file, **no required external service** (no Qdrant, Ollama, Redis or mem0 needed to work). Each feature starts at the useful minimum and only grows when a measurement (latency, recall, cost) shows it needs to; the rest goes to the backlog with an entry criterion | Explicit request: simple, light and efficient. Fewer parts = fewer failures and trivial installation (desktop and, later, hosted) | Complete features from the start (tiers, graph, document RAG, multiple sources): more code and more dependencies before proving value |
| D1 | **Effect end to end**: server, contract and front end | One schema, one error model, one stream model, from the database to the component. | **oRPC**: the Effect integration is experimental, translates errors and streams at both ends and has no reference of that size. **tRPC/Hono**: would abandon `HttpApi` |
| D2 | **Effect Schema**, no Zod | `HttpApi`/`effect/rpc` generate validation, encoding, errors and client from it. It is bidirectional | Zod. It only comes in as an internal dependency of the Claude Agent SDK, restricted to the Claude adapter |
| D3 | **Transport**: `HttpApi` for CRUD; `effect/rpc` over WebSocket for turns and events | The turn leaves the HTTP request. Commands and subscription stay separate | SSE tied to the `POST` (the current model). oRPC |
| D4 | **Front end with atoms** (`effect/reactivity` + `@effect/atom-react`): `AtomHttpApi` for CRUD, `AtomRpc` for chat | Cache, stale-while-revalidate, invalidation by key and optimism, generated from the same contract | TanStack Query. It would require oRPC or a parallel client |
| D5 | **Harness first, with one rule per credential**. **Subscription → the owner's harness**: Claude Agent SDK, Codex App Server or the CLI's ACP. **API key → OpenCode via ACP, for all providers**, including Anthropic and OpenAI. `effect/ai` stays only for internal tasks (consolidation, titles, routing, memory review) and for the quick conversation without a workspace | Live session, steering, interruption and live model switching, with mature code tools (files, shell, editing, LSP, compaction, permissions). In key mode there is a single path: credential injection, model catalog (models.dev) and permissions, with the same behavior when switching between models. The subscription adapters do not need to handle keys. **Accepted cost:** Anthropic and OpenAI models may perform a little worse in OpenCode than in the owners' harnesses. Per-turn measurement decides whether some provider gets a native route | `claude -p` / `codex exec` per turn (3–7 s per turn, loses the work between turns). Own tool loop over `effect/ai` for agents with an API key (would reinvent a harness, worse). ACP also for Claude/Codex (lags behind native). Mastra/LangGraph (two runtimes, duplicated state and memory, Zod) |
| D6 | **Hybrid context**: native session when the engine allows it, with **Zorel's layered context as the resume point** | Keeps the differentiator (curated context, approved memories, free model switching) and gains latency, cache and tool continuity | Native session only (loses control of the context; raw 32k handoff). No session only (process cost per turn; loses the work between turns) |
| D7 | **Continuous learning with control**: Zorel learns on its own while it works (D18). **Project knowledge goes in directly**, with version history, undo and a "what Zorel learned" feed. **What is about you** (preferences, way of working, valid across all projects) **goes through your approval** | Approving every knowledge page becomes too much work in continuous learning; version + undo + feed give control at low cost. What is personal and spans projects remains under approval | Approve everything (stalls learning). Write everything with no review or history |
| D8 | **Tools only through Zorel's gateway** | Policy and approval apply to every engine | Tools configured directly in each CLI |
| D9 | **Drizzle ORM 1.0 (rc, pinned version) over `@effect/sql`**: **`@effect/sql-sqlite-bun`** (Bun's own SQLite) now and `@effect/sql-pg` when hosted. Simple tables, plus idempotent receipts where there are retries. Migrations generated by `drizzle-kit`. FTS5 and triggers in plain SQL (`sql`). Repository types derived via `drizzle-orm/effect-schema`; **the API contract stays separate from the tables** | Typed queries and schema in TypeScript without leaving Effect: Drizzle runs over the `@effect/sql` client, so errors, transactions and traces stay in Effect. Switching databases is switching the Effect driver. Native integration with Effect 4 since `drizzle-orm@1.0.0-beta.24`; in `rc.5`, with the `sqlite-bun`, `pg` and other drivers. Bun's SQLite needs no extra native module (D0) | `bun:sqlite` directly (the current state: everything by hand, no portability). libSQL (native vectors): only justified with document RAG, which left the scope (D18); if embeddings become necessary, they start with brute force in SQLite itself. `@effect/sql-drizzle` (Effect 3 only). Full event sourcing: only with cross-device sync. **Accepted risk:** 1.0 is still a release candidate, and the schema is per database (`sqliteTable` → `pgTable` requires porting once when hosting) |
| D10 | **Durable routines and flows with `effect/workflow`** (future phase) | Already in the `effect` package | LangGraph, Temporal |
| D11 | **Desktop with Electron** (decided on 2026-11-04; Electrobun before). The main process (Node) only takes care of the window; **the server stays Bun**, compiled into a binary (`bun build --compile`) and started by Electron as a **separate process**: closing the window does not stop turns or routines, and the window only connects. The agents' browser is the same on desktop and web: a windowless Chromium that the server opens through Playwright **over a pipe** (installed Chrome, else Edge, else Playwright's headless Chromium, which the desktop ships in the package: the app does not depend on an installed browser), **one context per agent** (separate cookies, storage and logins; the person's tabs in another), logins saved in `<data>/browser/state/<profile>.bin` with AES-256-GCM and the key in the keychain; the panel streams frames. | Native browser inside the app with CDP control: a real page in the window (instant scrolling and typing), the same `browser_*` tools in both cases. Electrobun's WKWebView does not speak CDP, and Electrobun's CEF weighs as much as Electron without the ecosystem | Electrobun (no CDP in WebKit; CEF as a heavy option). Server inside the main process (would require porting the server from Bun to Node and dies with the window). **Accepted cost:** two runtimes in the app (Electron's Node + the server binary) **Today (2026-11-04):** shell done — `apps/desktop` on Electron 45, server as a child process (compiled binary in the package, `bun` in dev), a closed window keeps app and server running, parent watchdog in the server, tray outside macOS, ~215 MB Electron + ~80 MB server. **Native browser (2026-11-04, removed the same day by the security audit: Electron's debugging port has no authentication, so any local process, including an agent, could control the app window; the accepted cost is ~93 MB more in the download, for the embedded Chromium, and replacing the native view with frames; researched in 2026-11: Electron does not accept `--remote-debugging-pipe` and Playwright only attaches to Electron through a port):** Electron refuses `Target.createTarget`, so the main process creates the tabs (`WebContentsView`) at the server's request through a local endpoint with a token, and the server adopts them over CDP (free port on 127.0.0.1, read from `DevToolsActivePort`). One `persist:agent-<id>` partition per agent (its own logins, `you` for tabs opened by the person); permissions denied, downloads blocked, popups in the same tab, no preload in the tabs, at most 24 alive. The views live in a hidden window (the agent browses with the window closed) and the panel borrows them into its rectangle through the preload (`window.zorelDesktop`). "Take over": a transparent layer on top receives the human click (CDP input goes straight to the page and also fires Electron's mouse events, so there is no other way to tell them apart). On the web it stays the windowless Chrome with a single profile **Distribution (2026-11-04):** "Open Zorel when you log in" in Settings › General (desktop only; opened at login it starts without a window, `wasOpenedAtLogin` on macOS, `--hidden` on Windows); automatic updates with `electron-updater` (GitHub Releases; checks on open and every 6 h, installs on quit; fixed target in `electron-builder.yml` (gustavowlima/zorel, the same as `install.sh`)); `release` job in CI on a `v*` tag. Only the Developer ID certificate is missing (secrets `CSC_LINK`…): without it macOS neither runs nor updates the packaged app. **Good practices (2026-11-04):** an app menu, not a browser menu (macOS: app, Edit and Window; Windows/Linux without a bar; Reload/DevTools only in dev); right click only with Cut/Copy/Paste on text; no zoom; permissions only for notifications, clipboard and full screen, and only for the Zorel window; fuses in the binary (no RunAsNode, NODE_OPTIONS or --inspect, only the verified app.asar, encrypted cookies); icon on Apple's grid (824 of 1024 with a transparent margin, generated by `scripts/icons.sh` with headless Chrome); a downloaded update shows up as a button in the corner of the rail and restarts into it (`update:get`/`update:install` in the preload) |
| D12 | **Apache-2.0 license**. Code derived only from MIT/Apache projects, with `NOTICE` | — | Code under non-commercial licenses (PolyForm Noncommercial) |
| D13 | **i18n from now on, with English as the only language for now**. All user-visible text comes from a typed catalog (`packages/i18n`). English is the source of truth, and a new language only goes in complete | Adding languages later becomes just translating, without hunting for text in the code. A missing key does not compile | Text hard-coded in the components (the current state, in Portuguese). Heavy libs (i18next, FormatJS) while there is only one language: `Intl` covers plurals, dates and numbers |
| D14 | **Multiple accounts per provider**: each account is a record with an isolated credential (the CLI's own login folder for subscriptions; its own key in the keychain for API keys). Agent and chat choose the account. Switching accounts works like switching providers (the resume point goes into the new session). **Optional automatic switching (failover)**: an ordered list of alternatives per agent/chat, triggered by a limit or a provider error, **turned on only by explicit choice** and with a terms warning for subscriptions | Separating work and personal accounts and splitting limits is a common request, and automatic switching avoids stopping work midway. With our context, the switch does not need a separate "shadow home" and can even go to another provider | Failover on by default: rotating subscription accounts to get around a limit may violate the providers' terms, so the user must take on the risk explicitly. A pool with account rotation in Zorel: left to an external proxy |
| D15 | **Usage area**: tokens, estimated cost and time per turn, aggregated by agent, project, account and model, plus the limit windows of each subscription and configurable alerts | Knowing how much each agent and project consumes, how much of the subscription is left and when it resets. It is the basis of failover and of the native route vs OpenCode decision. | Tokens per message only (the current state). Hard budget block without prior warning |
| D16 | **Our own project, not a fork**. The protocol clients are Zorel's own, each with only what it uses: ACP in `engines/acp.ts`, Codex App Server in `engines/codex.ts`. **Revised on 2026-11-03:** `effect-codex-app-server` is not copied (about 61 thousand lines, almost all generated schema for the whole protocol); Zorel has its own minimal client (`engines/codex.ts`) with only the methods and fields it uses, and uses the original package as the protocol reference. The Claude and OpenCode adapters, the usage readers and the atoms and RPC pattern serve as **reference** | Zorel's differentiator (context, memory, team) stays at the center of the design, not grafted onto 94 thousand lines of orchestration. The code work is done by the harnesses, so the code interface we need is moderate. The Bun server is lean and becomes a single binary for hosting | A rigid fork of an existing app: would bring git, terminal and remote access ready-made, but also Node + pnpm + Electron, ~600 thousand lines to maintain and no i18n. **Criterion to revisit:** if its full git experience (worktrees, PRs, review, terminal) becomes a short-term priority |
| D17 | **Doors open for hosting**, without building hosting now: (1) every request resolves an `Actor` (today, always the local owner; `LocalOnly` becomes one form of access); (2) database via `@effect/sql` + Drizzle (D9); (3) secrets only through the `Secrets` service (keychain now, vault in the database later); (4) `Workspace` service (local folder + harness sandbox now, container later); (5) memory with **whose it is** and **who hears it** from the first migration; (6) agent as versioned data; (7) engines behind the `Engine` interface (a light runtime for automation comes in later as one more engine) | Each item costs little now and a lot later, especially data (memory without owner/audience, database tied to the driver) | Building hosting now (login, team, vault, Postgres, containers): left for phase 8. Ignoring hosting: would force rewriting access, database and memory |
| D18 | **Learned knowledge**: **capture → consolidate → retrieve → hand off**. A single model, the **knowledge page** (fact, decision, how-to, pitfall, reference, session), replaces the memories and skills tables. Capture comes from the runtime itself; consolidation works **without an LLM** (session page extracted from the steps) and, optionally, with a call to a cheap model; retrieval is a **short entry brief** in the context + on-demand FTS search | The agent continues the work without re-explaining: what was decided, what failed, how things are done here. A single model is simpler than memories + skills + a document base. No required LLM, no external service (D0) | Document RAG by upload (stays in the backlog). mem0 (writes without control, requires an external vector database in the TS SDK; available via MCP for whoever wants it). Graph, entities and decay tiers (backlog) |
| D19 | **Our own design system, maintained with the impeccable skill**: `DESIGN.md` (tokens + rules) and `PRODUCT.md` (product truth) at the root of the web app as the authority; `--z-*` tokens as the only source of color, size, radius and duration; primitives in `apps/web/src/ui/` as the only visual API of the screens, **generated by shadcn (CLI 4.x, `--base aria` = React Aria Components) and restyled with our tokens**; impeccable's detector on for UI edits and `audit` + `polish` when closing each phase | Consistency that does not depend on the memory of whoever codes: the standard is written (DESIGN.md), checked mechanically (detector and `check:ui`) and refined in short, bounded passes. Foundation rules (control scale, tokens only, interactions) are good and tested | Copying CSS or components from other apps (license: ideas only). Using shadcn **with its default look** (neutral palette, its `--radius`): it would become the face of every app. MUI and the like as a visual dependency. Writing the complex components from scratch (accessibility and keyboard are expensive). Storybook or a gallery page (weight and one more screen to maintain; the real screens are the reference) |
| D20 | **No Rust as the main stack**. Rust only for **specific pieces** with a measured limit (e.g. process supervisor or sandbox in hosted mode, heavy local embeddings), called by the server | A turn's time belongs to the model and the CLI, not the server. The agent ecosystem is TypeScript first (Claude Agent SDK, `effect-acp`, `effect-codex-app-server`). Decisions D1–D19 (Effect, Drizzle, shadcn + React Aria, i18n) still hold. Product logic changes fast | Rewriting in Rust + gpui: redoes the design system and accessibility, reimplements by hand what the Agent SDK provides. Tauri: only if a native interface becomes a priority |

---

## 2. Overview (target)

```
 apps/web (React + atoms)           apps/desktop (Electron: window + child server)
   │ AtomHttpApi ──── HTTP ────┐       │
   │ AtomRpc ─── WebSocket ────┤       │ starts the same server on a free port
   ▼                           ▼       ▼
 apps/server ── LocalOnly (Host/Origin/session)──────────────────────────────────
   ├─ HttpApi (CRUD: projects, agents, chats, memories, MCP, accounts, usage, settings)
   ├─ Rpc (send, steer, interrupt, decide, subscribeChat)
   ├─ Turn runtime ── queue per chat · persisted state · recovery on boot
   │     ├─ Context ──── layers + read marking per session + work steps
   │     ├─ Engines ──── ClaudeSdk │ CodexAppServer │ Acp(*) │ Api(effect/ai)
   │     └─ MCP gateway ─ zorel.* (internal tools) + user MCP · policy · approval
   ├─ Knowledge ── capture (steps + messages) → consolidation → versioned pages → entry brief + FTS search
   ├─ Accounts and usage ── provider_accounts · failover · limit windows · cost
   ├─ Actor (access) · Workspace (where the agent works)
   └─ Store (Drizzle over @effect/sql: Bun's SQLite now, Postgres later) · Secrets (keychain now, vault later)
```

---

## 3. Modules

| Module | Today | Target |
|---|---|---|
| `packages/contracts` | Entities + `Api` (HttpApi) + `SendEvent` | + `ZorelRpc` (`RpcGroup`) with a typed `ChatEvent`. `SendEvent` goes away |
| `server/db.ts` | 3 migrations; synchronous repository over `bun:sqlite` | `db/schema.ts` (Drizzle) + `db/migrations/` (`drizzle-kit`) + Effect repositories over `@effect/sql-sqlite-bun`. New tables: `turns`, `approvals`, `provider_sessions`, `provider_accounts`, `usage_windows`, structured work steps, `projects.path`, failover list on agent and chat, `observations`, `pages` (+ `page_versions`, FTS5) with owner/audience, agent versions |
| `server/access.ts`, `server/workspace.ts` | — | `Actor` (who makes the request) and `Workspace` (where the agent works): D17's doors |
| `server/usage/` | Tokens per message | `pricing.ts` (price per model, from the OpenCode/models.dev catalog, with a manual fallback), `windows.ts` (reading the limit windows per account, with cache and spacing), `aggregate.ts` (queries for the usage area) |
| `server/engines.ts` | CLI wrappers + `effect/ai` in a single file | `engines/` folder: `types.ts` (interface + capabilities), `claude-sdk.ts`, `codex-app-server.ts`, `acp.ts` (own JSON-RPC client), `api.ts`. Codex has its own minimal App Server client (`codex.ts`) |
| `server/chat.ts` | Turn inside the request stream | `runtime/`: `queue.ts` (queue per chat), `turn.ts` (execution of one response), `recovery.ts` (boot), `events.ts` (PubSub per chat) |
| `server/context.ts` | Full assembly on every turn | + `deltaSince(session)` (only what the session has not seen); the full assembly becomes the resume point |
| `server/tools.ts` | Hub + gateway + policy | + internal `zorel.*` tools; permission bridge for native tools |
| `server/knowledge/` | Memories and skills scattered across `chat.ts`/`db.ts`/`context.ts` | `capture.ts` (observations per turn, no secrets), `consolidate.ts` (session page without LLM + proposals with optional LLM), `brief.ts` (entry brief), `search.ts` (FTS), `redact.ts` |
| `web/api.ts`, `state.ts` | `call()` + `useState` + `reload()` | `client.ts` (`AtomHttpApi.Service` + `AtomRpc`) and atoms per resource |

Rule: the domain (context, engines, learning, tools) imports nothing from transport. `main.ts` and `rpc.ts` only translate.

---

## 4. Contract and transport

**CRUD (`HttpApi`, already exists):** projects, agents, chats (no sending), memories, MCP servers, keys, models. **New:** accounts (`provider_accounts`, login, failover) and usage (aggregates, windows, budgets).

**Turns (`effect/rpc` at `/rpc`, WebSocket):**

```ts
RpcGroup.make(
  Rpc.make("send",          { payload: { chatId, clientId, text, model? }, success: { turnId } }),  // clientId: idempotency
  Rpc.make("steer",         { payload: { chatId, text } }),
  Rpc.make("interrupt",     { payload: { chatId } }),
  Rpc.make("decide",        { payload: { approvalId, approve } }),
  Rpc.make("subscribeChat", { payload: { chatId }, success: ChatEvent, stream: true }),
  Rpc.make("subscribeStatus", { success: ChatStatus, stream: true })
)
```

- `subscribeChat` always starts with a `snapshot` (messages since the summary, turn in progress, open approvals, queue) and continues with live events. **Reconnecting is subscribing again.**
- `ChatEvent` (in `packages/contracts/src/events.ts`): `snapshot | message | queued | turn-started | text (agrupado) | reasoning | step-started | step-finished | approval | approval-resolved | handoff | model-switched | learned | context-usage | turn-completed | turn-failed | interrupted | status`. The steps (`WorkStep`) carry type, title, files, duration and changes per file: this is what the chat's activity pill shows.
- `subscribeStatus`: status of all chats (running, waiting for you, failed), for the sidebar and "Needs you".
- **Text deltas grouped every 100 ms** or 8 KiB.
- `LocalOnly` covers HTTP and WebSocket, with the session secret (section 11).

---

## 5. Turn runtime

**States** (`turns` table): `queued → running → completed | failed | interrupted`. The columns are `chat_id`, `agent_id`, `model`, `client_id UNIQUE`, `started_at`, `ended_at`, `error`, `usage`.

- **Queue per chat**, with one turn at a time. Agent chaining (@mention, up to 3 hand-offs) creates new turns in the same queue.
- **Message while the agent is busy:** goes to the queue by default. Becomes `steer` if the engine supports it and you ask for it.
- **Interrupt:** through the engine (`interrupt`/`turn/interrupt`). The partial text is saved as `interrupted`.
- **Approvals** are persisted (`approvals`) and no longer only in memory. When the turn closes, the open ones become refusals.
- **Idempotency:** `send` with the same `clientId` returns the same `turnId`, so resending does not duplicate.
- **Recovery on boot:** a `running` turn without a process becomes `interrupted`, and the partial message is preserved. It never repeats an uncertain side effect.
- **The turn does not depend on the client.** Closing the tab stops nothing.
- **Turn guards** (`runawayGuard` in runtime.ts):
  - **stuck:** 10 min without any engine event, outside of a pending approval, ends the turn and reopens the session on the next one;
  - **loop:** the same step (type, title and start of the output) 4 times in a row ends the turn saying which one;
  - **failures:** 6 steps in a row with an error end the turn.
  
- **Resume at reset** (automatic): when the turn fails without having acted and **all** of the chat's routes are at the usage limit, the chat saves `resumeAt` = the nearest reset. The routines' 30 s tick sends at that time "The usage limit has reset. Continue where you left off." (clientId `resume:<chat>:<time>`, idempotent; with everything paused, it stays in the queue). The chat shows the banner with Cancel; writing something yourself also cancels.
- **Edit from here**: `POST /api/chats/:id/rewind {messageId, files}` with the chat stopped. With `files`, it first undoes, through the checkpoints, the later turns not yet undone, from newest to oldest (a conflict stops everything, without touching the conversation). Then it deletes the message and what came after it, clears the summary if it covered that stretch and closes the chat's native sessions (`runtime.forget`), so the next turn starts from what Zorel keeps and the provider does not remember what was removed. The text goes back into the message field.
- **Search** (Cmd+K): `GET /api/search?q=` searches the messages (LIKE with escaping, the 30 newest; FTS5 like `memory_index` when the volume calls for it) and returns chat, message, time and the surrounding snippet. Places, chats, projects and agents are filtered on the client.
- **Pause everything**: `PUT /api/pause` saves the `paused` preference; pausing interrupts running turns, and while paused new turns stay `queued` (the chat's worker does not start) and routines do not fire (they stay due); unpausing wakes each chat's queue. It survives a server restart.
- **Notifications** (on the client): the `subscribeStatus` stream that already feeds the sidebar fires a system notification when a chat starts waiting for you, fails or finishes while you are looking elsewhere; turned on in Settings › General.

  Loop and failures apply to native steps and to gateway tools. They are not provider failures, so they do not trigger failover. Failover itself only switches routes if the turn has not acted yet (edited, ran or called a tool that writes), so it never repeats an effect.

---

## 6. Engines

```ts
interface Engine {
  readonly capabilities: {
    session: "native" | "none"          // native: keeps a live session between turns
    steer: boolean
    interrupt: boolean
    liveModelSwitch: boolean            // model switch without a new session
    images: boolean
    reasoningEffort: ReadonlyArray<"low" | "medium" | "high" | "max">
    nativeTools: boolean                // the CLI's own shell/editing
  }
  open(input: { chatId; agentId; model; cwd; resume?: ProviderSessionId; tools?: TurnTools; permissions }): Effect<EngineSession>
}
interface EngineSession {
  readonly id: ProviderSessionId
  turn(input: { system?: string; messages: TurnMessage[]; images?; effort? }): Stream<EngineEvent>
  steer(text: string): Effect<void>
  interrupt: Effect<void>
  setModel(model: string, effort?: string): Effect<void>
  close: Effect<void>
}
```

| Adapter | Base | Session | Notes |
|---|---|---|---|
| `claude-sdk` | `@anthropic-ai/claude-agent-sdk` (runs the **installed** official CLI, via `pathToClaudeCodeExecutable`: the ~300 MB binary the package ships is never used or packaged) | native: one process per (chat, agent) with streaming input; `persistSession: false` (resuming uses Zorel's resume point) | Live `setModel`. The turn's gateway swapped with `setMcpServers`. Its own tools turned off (`tools: []`). Login is never read |
| `codex-app-server` | `codex app-server` (JSON-RPC), our own minimal client | native: one process and one thread per (chat, agent), `ephemeral` (resuming uses the resume point). Zorel's own `CODEX_HOME` per account: the user's `config.toml` (MCP, `AGENTS.md`, memories) never reaches the agents, and `app-server` has no `--ignore-user-config` | Model per `turn/start`. `turn/steer`, `turn/interrupt`, `thread/compact/start`, `model/list`, `account/rateLimits/read`. Sandbox `read-only`/`workspace-write` |
| `acp` | own JSON-RPC client over stdio (`engines/acp.ts`) | native when the agent supports it | **OpenCode** (the harness for **all** API keys), Gemini CLI, Cursor, Kimi, Cline, Grok, Hermes |
| `api` | `effect/ai` | `none` | **Not a project agent.** Only for consolidation, titles, routing, memory review and quick conversation without a workspace. Cache markers, one message per block |

**Credential → harness:**

| Credential | Harness | How the credential arrives |
|---|---|---|
| Claude subscription (Pro/Max) | `claude-sdk` | The CLI's own login (never read by Zorel) |
| ChatGPT subscription | `codex-app-server` | The CLI's own login |
| Other CLIs with their own subscription (Gemini CLI, Cursor, Kimi…) | `acp` | The CLI's own login |
| **Any API key**: Anthropic, OpenAI, OpenRouter, Gemini, DeepSeek, Groq; or a local server (Ollama, LM Studio, OpenAI-compatible base) | `acp` → `opencode acp` | Config injected through `OPENCODE_CONFIG_CONTENT` (provider, model, `baseURL`, `apiKey` taken from the keychain). The user's `opencode.json` is never touched. Permission comes from Zorel's access level (section 9) |

**The account decides the harness, not the model name.** The choice is the pair `{ accountId, model }`: a `subscription/claude` account uses the Claude Agent SDK, and an `api-key/anthropic` account uses OpenCode, even if the model is the same. The picker shows both ("Sonnet · personal Claude" and "Sonnet · Anthropic key"). Switching between them is the same as switching providers: the resume point goes into the new session.

*Migration from the current state:* the ids `claude-cli/…`, `codex-cli/…` and `anthropic/…` become the default account of the matching provider plus the model name.

- **Same guarantees for all:** layered context and resume point, learned knowledge, MCP gateway with policy and approval, queue, interruption and model switching. The harness only does the code agent's work.
- **Several accounts per provider:** see 6.1.
- **Models** listed by the harness itself (`model/list`, OpenCode's catalog via models.dev), not by a fixed list. Each account has its own list, because different accounts may have different models.

### 6.1 Multiple accounts (D14)

**Data model.** `provider_accounts` table:

| column | description |
|---|---|
| `id`, `label` | e.g. "Work Claude", "Personal Claude" |
| `kind` | `subscription` \| `api-key` |
| `provider` | `claude`, `codex`, `gemini-cli`… (subscription) or `anthropic`, `openai`, `openrouter`… (key) |
| `home` | subscription: login folder managed by Zorel, `~/.zorel/accounts/<id>`, or `null` for the CLI's default login |
| `secret` | key: name in the keychain (`account:<id>`). The value never goes to the database |
| `base_url` | key: optional (Ollama, LM Studio, OpenAI-compatible base) |
| `identity` | whatever the harness reports (e-mail or plan), for display only |

The "default" account of each CLI shows up without registration. **Claude:** it is the login already on your computer (`home = null`). **Codex:** it is a folder of Zorel's own (`~/.zorel/accounts/codex-default`), with a login done once through Zorel, because `codex app-server` always loads the user's `config.toml` (MCP servers, `AGENTS.md`, memories) and has no way to ignore it (implemented on 2026-11-03).

**How the credential reaches the harness:**

| Type | Isolation |
|---|---|
| Claude (subscription) | `CLAUDE_CONFIG_DIR=<home>` in the SDK process. Does not change `HOME` or the system keychain |
| Codex (subscription) | `CODEX_HOME=<home>`. If the CLI uses the system keychain for the login, the extra account needs file storage (a Codex limitation) |
| ACP CLIs (subscription) | Each CLI's folder variable (`GEMINI_HOME`, `GROK_HOME`…), declared in the adapter |
| API key (OpenCode) | The account's key goes in that session's injected config. Two Anthropic accounts are two distinct providers in the config |

**Login inside Zorel.**
- Zorel runs the CLI's official login command with the account's folder. For example: `CLAUDE_CONFIG_DIR=… claude auth login`, `CODEX_HOME=… codex login`.
- The flow happens in the provider's browser. Zorel never sees or stores the token.
- Afterwards, Zorel reads only the identity from the harness, for display.
- Removing the account deletes the folder, with confirmation.

**Choosing the account:**
- Agent and chat have `accountId`. The model id stays `provider/model`.
- The model picker lists models per account ("Sonnet · personal Claude").
- Members of a channel can use different accounts.
- **Switching accounts mid-chat** ends the old account's session and opens another on the new account with the resume point, just like a provider switch. It does not reuse the native session across accounts, so there is no "shadow home": it is simpler and does not depend on how each CLI stores sessions.

**Automatic switching (failover).**

*Configuration:* each agent (and each chat, when it overrides) has an ordered list of up to 8 alternatives `{ account, model }`. The alternatives may be from another provider, for example: personal Claude subscription → work Claude subscription → Anthropic key via OpenCode → OpenRouter key. Since the context is ours, any alternative continues the work. The list starts empty, and failover stays off until you build it.

*Warning:* when you add a **second subscription account from the same provider** to the list, Zorel shows once, and records that you accepted: "Switching subscription accounts to get around limits may violate the provider's terms and lead to the account being blocked. The risk is yours." API key alternatives do not have this warning, but they show that they now cost per token.

*Triggers* (classified by the adapter from each harness's signal: Claude's `rate_limit_event`, Codex's errors and `account/rateLimits`, OpenCode's errors):

| Trigger | What happens |
|---|---|
| **Subscription limit** (with a return time) | The account waits until the reset. The turn goes to the first ready alternative. **Switches back on its own** to the main account when the reset passes |
| **Provider error**: `rate_limit`, `billing`, `unavailable`, `auth`, `network`, `timeout` | **Only if the turn has not acted yet**: no tool that writes was executed. The message goes back to the queue and runs on the next alternative. The account that failed is skipped for 10 min |
| Error after the turn has acted | **Does not switch.** Fails with the explanation and offers to resume manually; never repeats an uncertain side effect |
| Content error / invalid request | Does not switch: another model would give the same error |

*Limits:* each message tries each alternative at most once. If all of them fail, the turn fails and lists the reason for each attempt.

*Visibility:*
- Every switch shows up in the chat ("Personal Claude limited until 14:30, continuing with work Claude").
- The message stores the account and model that actually replied.
- Per-turn measurement records the switches.

*Reading usage per account:* the subscription's limit windows (Claude, Codex) come in together with failover. That way Zorel knows when the account comes back and can warn before the limit is reached.

*How it turned out (2026-11-03):*
- List in `agents.failover` and `chats.failover` (null = the lead agent's), edited on the agent page and in "Fallbacks…" in the chat menu. The terms warning is accepted once (`preferences`).
- Classification: Claude's parser reads `rate_limit_event` (`rejected` + `resetsAt` becomes `limit`) and the error code of assistant messages; Codex reads `codexErrorInfo` from `turn/completed` and `account/rateLimits` (requests the read at the start of each turn and listens for updates); API and processes use a heuristic over the message (`classifyMessage`).
- "Already acted" = the gateway executed a tool of class `write` or `sensitive` (even if it failed).
- The wait for a limit lives in `provider_accounts.limited_until` (survives a restart); other errors skip the route for 10 min, in memory. The latest usage read lives in `provider_accounts.usage` and shows up in Usage and in the model picker.
- Switches: live `failover` event, `messages.switches` and `turns.switches`; the turn stores the model and account that replied.

*A rotating pool* of several accounts to spread load stays outside Zorel (an external proxy as an API key with a compatible base). Failover only switches on a failure or a limit, not to balance.

---

## 7. Context (D6)

**Resume point**, always up to date and kept in Zorel:

```
base → agent → channel → about you (approved) → project (brief) → knowledge entry brief
     → chat summary → work steps (compacted) → last 30 messages
```

**Rules per situation:**

| Situation | Sent |
|---|---|
| Live session, same provider | Only the messages after the session's marker (`provider_sessions.seen_message_id`), plus the layers that changed since the last send (identified by hash) |
| Model switch within the same provider | Live `setModel` (Claude: only in streaming input mode, which is what we use), so the same as the row above. **Each model has its own prompt cache**, and the first call after the switch pays for the conversation without cache |
| Provider switch / new session / resume failed | **Full resume point** |
| Back to a provider already used | Resumes its session and sends only what it has not seen yet |
| `api` engine | Resume point on every turn, with prompt cache |

- **Work steps:** from each turn, the tools used, the commands and the changed files are kept. They go into the resume point compacted; the detail is available through `zorel.history_read`.
- **Typed handoff:** `{ done, failed, open, next step, files }`, generated without an LLM from the work steps. It is tied to the chat and is **offered**, never consumed automatically.
- The CLI's **native compaction** can happen freely: the resume point does not depend on it.
- **Measurement on every turn:** latency to the first token, total latency, input tokens, tokens read from cache and output tokens. Context decisions are based on these numbers.

---

## 8. Learned knowledge (D18, D7)

**Today (implemented, 2026-11-03):** memories (`fact`) and skills in SQLite, with you/project/agent scope. **Skills (2026-11-04):** the context lists the titles and brings the step by step of the most relevant ones; the agent reads any other with `zorel_read_skill` and proposes a new one or an **improvement** with `zorel_propose_skill` (title, steps, reason, `improves`), which stays pending (at most 5 per chat). The improvement points to the skill it replaces (`memories.replaces`) and stores the reason; in Knowledge the person sees the diff line by line and "Apply the change" writes the new text into the skill, with the previous one in `memory_versions` (every edit also becomes a version, with restore). **Skills from the computer (2026-11-04):** Settings › Skills lists the SKILL.md files that already exist (Claude Code `~/.claude/skills`, Claude Code plugins at their newest version, Codex `~/.codex/skills`, `~/.agents/skills`; a folder linked in two places counts once) and the person chooses which ones Zorel's agents use (`fileSkills` preference, only paths found by the scan). The chosen ones go into the context's skill list (title and what it is for) and `zorel_read_skill` reads the file on the spot (`server/file-skills.ts`). Separately, **"Let Claude Code and Codex use their own skills"** (`nativeSkills` preference, off by default): Claude gets the `Skill` tool (reads the user's and the plugins' skills) and Codex stops turning off discovery and the skills it finds; it applies from each chat's next session. Tested live: a file skill read by the agent; with the native ones on, Claude saw 119 skills.
- **Consolidation** with an LLM when the chat goes past 50 messages beyond the summary: the stretch that leaves the window becomes a summary and memory and skill **proposals**, pending until you approve them in "Needs you". What you told it to forget goes in the prompt so it does not come back.
- **Human evidence rule**: the stretch arrives numbered and each proposed memory cites the numbers of the messages that prove it. Only your messages count: an agent's guess, plan or assumption never becomes a memory. Skills do not require it (a procedure can come from the agent's work).
- **Confirmation:** consolidation returns the ids of existing memories that the stretch confirmed again, and repeating an active memory (by any path) also confirms it. `confirmedAt` orders the budget.
- **Retrieval in three levels:** up to 8,000 characters fixed in the context: first the memories you marked as **essential** ("Always in context"), then the most recently confirmed of each scope in rotation (you, the project and the agent share the space; before, yours took up almost all of it). On each turn, the FTS5 search (BM25) brings the 5 that best match **your last 3 messages**; and the agent searches for the rest with `zorel_search_memories` (up to 10), which asks for words and synonyms and tells it to try again before treating the fact as never stored. Consolidation writes **keywords** into each memory (synonyms, related terms, the other language), indexed in the search and never shown, so a question in other words finds the fact. Personal memories (`user`) only reach their own owner (`owner`); the unique key is still (scope, text) and will include the owner once there is hosting. No embeddings for now: FTS5 (BM25) only; the 2026-11-04 evaluation (`apps/server/bench/`) measures when it becomes worth it.
- **Evaluation (2026-11-04, `apps/server/bench/`):** `memory-recall.bench.ts` (10 thousand memories, no model: time, accuracy, budget, leakage across scopes and owners) and `memory-consolidation.bench.ts` (15 conversations with a real model). With Haiku: 11/11 facts learned, 0 false memories, 0/2 secrets stored, a correction becomes a replacement 1/1, and the learned fact is found with other words 4/4. Building a turn's memory with 10 thousand memories: p95 ~50 ms.
- **Consolidation with rules in the code, not only in the prompt:** the text goes to the model without credentials (`redact`: `secretlint`'s recommended rules, the secrets Zorel stores and "the password is X" said in words), and summaries, memories and skills with credentials are discarded; the response is read with Effect Schema, item by item; a memory must cite one of your messages and cannot carry a name or number that only the agent said (the cat "Whiskers" from the agent's poem); a fact that only rewrites an active memory confirms it (words in common, Jaccard ≥ 0.6), and a correction ("I moved to Berlin") stays pending as an update of the old memory (`replaces`), applied on approval, without leaving the two contradicting each other. Temporary instructions ("only this week") do not become memories.
- **Next (phase 3b):** the pages below. The design target: Markdown files as the truth, FTS5 index with links, versions, change packages with hash and rebase, curator at the end of the conversation, cited sources, periodic review of contradictions.

**Single model: the page.**

```
page = { scope: project | agent | you, type, title, summary (1 line), body,
         state: active | pending ("you" only) | retired, previous version,
         uses, last use, origin: turns that produced it, owner and audience (D17) }

type: fact · decision · how-to · pitfall · reference · session
```

Today's memories and skills migrate to pages: memory → `fact`, skill → `how-to`.

**1. Capture.** The runtime already sees each turn. It records the **observations**: the request, the work steps (tools, files, commands, errors) and the response, **with secrets removed before writing**. There are no hooks and no extra process.

**2. Consolidation**, triggered when a block of work closes (a fraction of the context window reached, end of the chat or a button):
- **Without an LLM, always:** a `session` page extracted from the observations (what was asked, done, changed, what failed and what was left open) and the chat's **typed handoff**.
- **With an LLM, optional** (a cheap model, one call per block): proposes creating or updating `decision`, `pitfall`, `how-to` and `fact` pages, and **retiring** the page the conversation showed to be outdated.
  - What belongs to the **project or the agent** goes in directly, as a new version.
  - What is **about you** stays pending until approval.
  - Cap on pending items: 20.

**3. Retrieval:**
- **Entry brief** (a context layer, section 7): title + 1-line summary of the **pinned** pages and the most relevant ones (recency + uses), within a budget of ~1,500 tokens. The body does not go in.
- **`zorel.knowledge_search`**: FTS5 search (BM25) over title, summary and body, returning snippets with the page link. **`zorel.knowledge_read`**: opens the whole page.
- Each page delivered to the model counts as one use. What is used rises in the entry brief; what is not sinks on its own.
- **Embeddings only with measurement:** if the evaluation shows that word search loses recall on paraphrases, a small local model comes into the process, with brute force in SQLite (no vector index or external service).

**4. Hand off.** The typed handoff (`feito, falhou, em aberto, próximo passo, arquivos`) is tied to the chat. It is **offered** on resume and never consumed on its own.

### 8.1 Managing knowledge

| Action | Where |
|---|---|
| **"What Zorel learned" feed**: pages created, updated and retired, per project and per day | Knowledge screen |
| Read, edit, **pin**, retire and restore a page | Knowledge screen |
| **Version history and undo** for each page | Page |
| Approve, edit or discard what is **about you** | "To review" queue |
| See where the page came from (origin turns, with a link) | Page |
| **"What the model saw"**: per response, the layers sent and the tokens of each one (recorded in the turn) | Chat |
| Turn off learning for an agent or a project | Agent or project settings |
| Export the project's knowledge as Markdown | Knowledge screen |

**Backlog with entry criteria:**

| Item | Comes in when |
|---|---|
| Local embeddings | The evaluation shows recall loss on paraphrases |
| Near-duplicate and contradiction detection | Duplicates show up in the feed often |
| "Helped / wrong" feedback | The entry brief often brings useless pages |
| Markdown mirror in the project folder | A request to version knowledge together with the code |
| Document RAG by upload | A real need to search documents that did not come from the work |
| Graph, entities, decay tiers | More than ~5 thousand pages per project or insufficient recall |
| mem0 integration | Via MCP, for whoever wants it, it already works without new code |

## 9. Tools, approvals and interaction between agents

### 9.1 Tools

- **MCP gateway per turn** (already exists): secret URL, closed list, `read`/`approve`/`auto` modes per server and global or per-project scope.
- **Internal `zorel.*` tools** in the same gateway: knowledge (`knowledge_search`, `knowledge_read`), history (`history_search`, `history_read`), team (`list_agents`, `send_message`, `start_task`, `interrupt_agent`) and `ask_user`. When they go past about 15, they come in through on-demand search (`tool_search`).
- **Project's default agent:** a new chat in the project starts with it; any member can reply afterwards.
- **Project workspace:** the project gets `path` (a folder on disk, optional). It is the `cwd` of the project's agents; without a folder, the agent runs in an empty Zorel folder, as today. **The agent never adds folders to itself** (only you do), and Zorel refuses the disk root, the home folder and Zorel's data folder.
- **Undoing edits:** the Claude Agent SDK has `rewindFiles` (checkpoint per message). The other harnesses depend on git: Zorel suggests committing or using a worktree before Workspace-level work.
- **Connectors with OAuth (done on 2026-11-04):** Settings › Connectors brings ready-made services. Remote ones that follow the MCP authorization spec (Notion, Linear, Jira and Confluence, Sentry, Vercel, Supabase, Stripe) connect with one click: the SDK does discovery, dynamic client registration, PKCE and refresh (`server/oauth.ts`, `McpOAuth`). The client registration, the tokens and the verifier live in the keychain (`mcp-oauth:<id>`), never in the database. Connecting (`POST /api/mcp/:id/sign-in`) returns the authorization URL, which opens in the browser; the service comes back to `GET /api/oauth/callback`, which only accepts a `state` issued by Zorel, once, for 10 minutes. `mcp_servers.auth` (`none`/`oauth`) says whether the Hub passes the `authProvider`. GitHub does not register clients, so it asks for a personal token (it becomes the `Authorization` header). Context7, Figma (desktop app) and Playwright ask for nothing. When the service refuses the credential (401, or a revoked OAuth token with no refresh), the Hub marks the server as refused (`hub.refused`, cleared when connecting or changing the credential) and Settings asks to "Reconnect"; a new token comes in through `PATCH /api/mcp/:id` with `env`, without recreating the server (per-agent permissions, tied to the id, remain). Connectors start in `approve` mode; the list of custom servers ("Custom servers") remains for anything else.

**How it turned out (2026-11-03):**
- `projects.path` validated by the `Workspace` service (absolute, real, a folder; refuses the root, home and the data folder). Without a folder, the agent works in `<dataDir>/runs/<chat>`.
- **Restore points the same for all harnesses** (revised decision: instead of `rewindFiles` on Claude and git only on the others): a **shadow** git repository per project in `<dataDir>/workspaces/<id>.git` (`GIT_DIR` there, `GIT_WORK_TREE` = the folder). Before and after each turn Zorel records the tree (`git add -A` + `write-tree`, respecting the project's `.gitignore`, plus `node_modules`). The turn's diff and undo come from these two trees; undo refuses if a file from the turn changed afterwards (`UndoConflict`). The project's own git repository is never touched.
- Claude: `tools` = Read, Glob, Grep, Edit, Write, Bash; `canUseTool` applies the level (`engines/policy.ts`: commands that delete, publish or use the network always ask in Workspace). Codex: `sandbox`/`approvalPolicy` per level, shell on in the app-server, `item/commandExecution/requestApproval` and `item/fileChange/requestApproval` answered by Zorel's card. The machine's skills turned off in Zorel's `CODEX_HOME` (`skills/config/write`), never in the user's.
- Native steps (Claude's `tool_use`/`tool_result`, Codex's `commandExecution`/`fileChange` items) become `WorkStep`; reading and searching do not count as "acted" for failover, editing and commands do.
- Handoff: each response carries into the next turn a note of what it did ("[Done in this turn: edited a.ts (+2 −1); ran `bun test` (ok)]"), so another agent or another provider knows what changed.
- Watchdog: an engine with no signal at all for 10 min, with no approval pending, fails as `unavailable` (the process may have died without the SDK noticing) and the session is closed.
- **Files like an editor's explorer** (2026-11-04): `POST /api/chats/:id/fs {op, path?, to?, paths?, id?}` with `op` = create | rename | move | delete | restore | open | reveal, over the chat's folder (`chatRoot`: the worktree or the project folder). `fs-ops.ts` checks that every path stays inside the folder (`relative()`, works on Windows), moves across disks (EXDEV → copy and delete) and sends what is deleted to Zorel's trash (`<dataDir>/trash/<id>/`, keeping the paths; `restore` undoes it; it goes away after 7 days). Open and reveal in folder use each system's command (`open`/`open -R`, `cmd /c start`/`explorer /select,`, `xdg-open`). In the interface, React Aria `Tree` (already installed, instead of @headless-tree): multiple selection, F2 renames in place, Delete deletes with Undo, dragging moves into the folder, double click opens (a changed file opens the diff), context menu. Icons per format: the language's brand from `simple-icons` (already installed) in its color, lucide shapes for the rest. The tree is virtualized (React Aria's `Virtualizer` + `ListLayout`, 28px rows): only the visible rows stay in the DOM. Opening a file (double click, Cmd+Enter, Open menu) creates a tab with the code (`GET /api/chats/:id/file`, @pierre/diffs's `File`); the first tab is always the tree. Search by name filters the tree and opens the folders along the path.
- Interface: a summary of changes under each response (view, undo), a Changes/Files right panel and a read-only terminal with the agents' commands. The diff uses `@pierre/diffs` 1.6.1 (`FileDiff`, syntax highlighting, in-line changes, unchanged lines collapsed) **inside a worker pool** (`diff-pool.tsx`). Without the pool, a bug in the lib shows up: with React 19's `StrictMode` and `disableFileHeader`, the remount finds the empty `<pre>` from the first mount, treats it as already rendered and never draws (no error). Colors come from the `--z-*` tokens via `unsafeCSS` (CSS variables cross the shadow DOM) and the theme follows Zorel's light/dark. The panel loads the viewer on demand.

### 9.2 Approvals

**Access level per agent**, chosen only by you, one of three:

| Level | What it does without asking | What it asks about | Claude SDK | Codex | OpenCode/ACP |
|---|---|---|---|---|---|
| **Workspace** (default) | Read; edit and run commands **inside** the workspace (project folder + folders you added) | Writing outside it; network; destructive commands; MCP write tools according to the server's mode | `canUseTool` decides by path and command | sandbox `workspace-write` + `approvalPolicy: on-request` | `session/request_permission` + permissions injected in the config |
| **Ask first** | Read only | Every write and every command | `canUseTool` asks about everything that is not reading | `read-only` + `on-request` | everything on `ask` |
| **Full access** | Everything | Nothing (only what the MCP server's mode requires) | everything allowed | `danger-full-access` | everything on `allow` |

**Per-agent permissions (done on 2026-11-04):** besides the access level (folder and shell), each agent has `permissions` (a JSON column): `web` (search and page reading through the engine's own tools: `WebSearch`/`WebFetch` on Claude, `web_search` on Codex, `fetch` requests on ACP), `browser` (Zorel's `browser_*` tools), `grants` per MCP server — `none` hides, `read` exposes only read tools, `write` all of them; with no entry it follows the server's mode — and `always`, the "Always allow" rules (`<server>:<tool>` or `browser`). Destructive tools (class `sensitive`: delete, send, publish, pay…) always ask, except for a server on `auto` or an `always` rule; browser clicks whose label commits to something (buy, publish, send, delete…) always ask and do not accept "always". The agent asks for more with `zorel_request_access` (web, browser or a connector with a level), approved on a card. The pure rule lives in `server/permissions.ts`; the agent page has the **Tools and access** tab. Default: web and browser on, connectors by the server's mode.

**Creating an agent with AI (2026-11-04):** the Builder is an agent of Zorel's own (`agents.builtin = "builder"`), outside the lists, the pickers and the team tools; you talk to it only on the **Build with AI** screen (`#/build[/project]`), in a hidden chat (`chats.hidden`) recreated on each visit. The proposal (`zorel_create_agent`) shows up as a preview on the side, with Create and Not now (the same approval card). The proposal already carries the powers (`web`, `browser`, `connectors` by name with level, `reason`); the Builder proposes the minimum (browser only if asked, connectors listed, the rest without access) and its ceiling is workspace (not its own "ask", which does not act); the screen follows two steps (Describe, Powers) and ends by creating the agent with the adjusted powers and opening its page (no first task, by the user's decision). Tested live with Claude: proposal in ~10 s. The Builder's prompt belongs to Zorel and updates when the screen opens; for code work without a project it asks you to choose the project in the screen's picker before proposing. Gateway tools have a longer timeout than the approval card's (Claude `MCP_TOOL_TIMEOUT`, Codex `tool_timeout_sec`: 31 min), otherwise a slow approval would drop the call (~60 s on Claude).

**The approval card**, the same for native and MCP tools:
- Shows the agent, the tool, the arguments (with secrets masked) and the folder.
- **Bound to the exact call:** a hash of the tool plus the canonical arguments. An approval does not apply to another call.
- Possible answers:
  - **Approve once.**
  - **Always allow** this tool, for this agent. This records a visible and revocable rule (done on 2026-11-04 for MCP tools and the browser: the card only shows the button when the approval carries `alwaysKey`; the engine's native tools still approve once).
  - **Refuse with a reason.** The agent reads the reason and does not try again without asking.
- **Persisted in the database** (`approvals`): survives a restart and closing the tab.
- **Expires** (default 30 min), and expiry counts as a refusal.
- **Promoting an agent to Full access answers on its own** the approvals it has pending.
- **Routines that watch a connector (2026-11-05).** `routines.watch` = `{ serverId, tool, args }`: every `WATCH_EVERY` (5 min) the scheduler calls that MCP tool, only when the hub classifies it `read` (polling never changes anything remotely). `watchItems` reads the result as a JSON list (or the first list inside an object, a single value, or lines); `freshItems` keys each item by id/number/key/uid/url (else its whole JSON, hashed) against `watch_seen` (last 1000 keys). The first poll only learns; new items run the routine with them as the message's payload ("New from <connector> (<tool>)"). Items are marked seen only when the run started, so a busy chat gets them on the next poll. A failed poll sets `lastStatus` failed and retries next time.
- **Agent limits, archive, retry (2026-11-05).** `agents.monthly_tokens` / `reply_tokens` (null: none): before a turn the agent's input + output tokens since the UTC month began are summed; at or over the limit the turn fails with `monthly_limit` without starting. Engines that report tokens while a turn runs (Claude: each assistant message's usage; Codex: `thread/tokenUsage/updated`) send `usage` events; past the reply limit the runaway guard stops the turn with `reply_limit`, keeping its text. `agents.archived_at`: an archived agent is out of `members` (answers no one, mentions and routing skip it), of delegation (`visibleTo`) and of routines. RPC `retry(chatId, messageId)` enqueues a new turn for the reply's agent (the lead if it left or was archived), its partial reply in the context.
- **Agents working at once (2026-11-05).** A global limit on chats with an agent at work (preference `maxRunning`, default 4, 0 = no limit; Settings › General). A slot is a chat's worker (its queue, one turn at a time); over the limit a chat keeps its turn queued, shows "Waiting for a free slot" and starts, oldest first, when a worker ends or the limit goes up. Delegating doesn't hold a slot: the asking turn ends and its chat's worker frees it.
- **A chat can set its own level (2026-11-05).** `chats.access` (null: each agent's own) applies to every agent in that chat and only narrows: each agent works at the narrower of the chat's level and its own (workspace at most in a chat with no agent), so full access stays a choice on the agent's page; it is the person's choice, recorded in the audit log, and the engine session reopens because the sandbox is fixed when it opens. Delegating (`zorel_start_task`) compares the target with the chat's level; agent proposals are never wider than the narrower of the chat's level and the proposer's own.

**"Needs you" screen:** gathers pending approvals, questions (`ask_user`) and logins from all chats, tasks and routines, with a link to the origin and a desktop notification.
- The approval of a delegated task **also** shows up in the chat of whoever delegated it.
- **A routine has nobody watching.** Each routine defines what to do when it needs approval:
  - **refuse and report** (default);
  - **wait** up to X hours, with a notice.

**Security rules**:
- **An agent can only restrict access** (its own or a colleague's), never widen it. Only you widen it.
- **An agent created by another inherits its creator's limits.** An agent in Workspace does not escape the sandbox by creating a colleague.
- **A change to an MCP server made by an agent** (only when you ask) always goes through approval. Tools never receive or return header or variable values: you type keys on the MCP screen.
- **Channel tools** refuse requests that did not come from a person.

### 9.3 Interaction between agents

**Implemented (2026-11-03):** delegation by `@mention` (handoff with a cap of 3 replies in a row) and Zorel's own tools, offered on every turn alongside the MCP ones:
- `zorel_list_agents` and `zorel_read_agent`: read the team (global + project; agent by id or `@handle`). Free.
- `zorel_create_agent` and `zorel_update_agent`: become an **approval card** with the profile field by field and only save on your OK; audited in the agent's name and recorded as an agent version. The new agent never has access above whoever proposes it (ask < workspace < full) and an agent only narrows another's access. Without a model, it inherits the proposer's; an invalid model comes back as an error with the valid providers (without a separate `list_models`).
- `zorel_create_agent` accepts **a whole team** (`agents: [...]`, up to 8, distinct names): a single card with each profile under its name; approving creates all of them.
- **Builder** (for teams): a global system agent (title "Designs agents and teams", `ask` access), created the first time you use **Build with AI** (Agents screen or the project's Agents tab), which opens a chat with it in the project. It understands the goal (at most 3 questions), reads the team so as not to duplicate (it improves an existing agent with `zorel_update_agent` instead of creating a near-copy), proposes the team on a card and, if the work is recurring, the routines. It is an ordinary agent: its instructions can be edited.
- `zorel_search_memories`: searches memory beyond the context budget (section 8).
- **Browser** (lean): besides opening, reading and clicking, `browser_hover`, `browser_select`, `browser_scroll`, `browser_upload` (only files from the chat's folder, through an input or the file picker), `browser_dialog` (alert/confirm/prompt are refused by default and reported in the next result; accepting the next one is an explicit request) and `browser_run` — up to 20 declarative steps in one call, returning the page once (without running arbitrary JavaScript). Separate profiles per agent are left out: each profile is another Chrome process; they come in if separate logins become a need.
- `zorel_routines`: lists, proposes and cancels routines (section 13, phase 7), always with a card.
- Each agent profile keeps **versions** (who changed it, when) with restore, and exports/imports as `.agent.json` without the account.

- **`zorel_start_task` (2026-11-04)**, delegation with a return: the colleague works in **its own chat** (it shows up in the sidebar with live status; title "<agent>: <task>"), with the task as the first message; when that chat's queue empties, the last reply goes back to the origin chat as a message from the colleague, with the "Open the task" link, and whoever asked takes the next turn there. `reply: false` delivers without a return (covers `send_message` without a reply). Limits: 4 open tasks per chat, 2 levels of nesting; a colleague with more access than the requester only works with an approval card. `chats.task_of` (the chat waiting for the result, cleared on delivery) and `chats.task_by` (who asked). Tested live with Claude Haiku: delegate, reply and continue in ~6 s.

- **Conversation between agents (2026-11-04):**
  - **Router (2026-11-04):** in a team, a message without a mention (and that is not a follow-up) goes to a turn marked `route`; when it starts, a short call to a cheap model (`ZOREL_ROUTER_MODEL`, or the Claude subscription's Haiku, or the chat's model) reads the team's roles and the last 10 messages and picks **one** agent: the specialist when the request belongs to a colleague, the lead when it is coordination, vague or spans several areas (the lead then splits and closes). Failure or an unreadable response: the lead. Line "Sent to Tester · <reason>". `server/router.ts`. Live: tests → Tester and README → Docsync directly (21 s each); "launch v1" → Tech Lead, which split and closed.
  - **Gateway over SSE (2026-11-04):** tool calls respond over SSE with a ping every 30 s; before, the JSON response only came out at the end, and the engines' HTTP client (undici: 300 s to the first byte) dropped any approval or question that waited more than 5 minutes.
  - **Who replies without a mention (before the router):** the lead (which routes by the colleagues' descriptions, see the channel prompt); but a message without a mention right after you talked to a colleague by @handle, and it replied, continues with that colleague (a follow-up). The field's placeholder says who it goes to.
  - **Closing:** whoever passes work by @mention gets a turn after **all** of those called reply (the replies arrive together), unless one of them already called it back; a reply that failed also counts, so nothing waits forever. Line "X handed back to Y".
  - **Format for whoever receives work:** Status: done | partial | blocked · Result · Evidence (short, checkable). Whoever asks does not repeat the answer, only closes; never mentions someone just to thank them.
  - **One delivery, one hand-off:** a colleague that received `zorel_start_task` in the turn is not called again by its mention in the reply.
  - **Limit:** 3 replies in a row without a message from you; when it stops, the line "The agents stopped here so they don't talk in circles. Send a message to go on.".
  - **Steer** only shows up when the turn's engine accepts mid-turn correction (Codex).
  - Tested live with Claude Haiku (Tech Lead + Tester + Docsync in demo-app): request without a mention → the lead passes it to Tester with a briefing → Tester replies in Status/Result/Evidence → the lead closes; a follow-up without a mention stays with Tester; a README + tests request → the lead splits it between the two and closes once with both deliveries.

- **`zorel_ask_user` (2026-11-04)**: the agent asks and waits. The question is a card of type `question` on the same mechanism as approvals (chat, "Needs you", notification, 30 min and then it moves on): up to 6 one-click options, a free answer or "Skip". The answer travels in `decide`'s `reason` and comes back as the tool result ("The user answered: …"); with no answer, the agent continues with its best guess and says what it assumed. The chat status says "asks you something" (label `question`). Tested live with Claude Haiku.

**Planned — tools** (`zorel.*`):

| Tool | Behavior |
|---|---|
| `list_agents` | Visible agents with **responsibilities**, status (`working`/`idle`), queue and last activity. It is the first step before delegating |
| `send_message(to[], text, expectsReply = true, replyTo?)` | Delivers to each recipient's queue. With `expectsReply`, **the recipient's final reply comes back on its own** to whoever asked, as a message with no reply requested. There is protection against hand-off loops (the origin of the chain is carried) and idempotency by key, so a resend does not duplicate |
| `start_task(agent, text)` | **Done as `zorel_start_task`** (above). Original plan: opens a **parallel task**: a side thread with its own session and the result coming back. At most 2 tasks running per agent (configurable up to 4) and 8 open on the agent's own initiative |
| `interrupt_agent(agent)` | Only interrupts work **that the caller itself asked for**. Never your work, a routine's or another agent's. First cancels its requests that are in the queue and leaves the target a notice of the reason for stopping |
| `ask_user` | **Done as `zorel_ask_user`** (above). Original plan: asks you (shows up in "Needs you"). On Claude, uses the native `AskUserQuestion` |

**Semantics:**
- **Request to several agents:** the replies wait in the requester's queue until **all** copies finish, and then go into a single turn, which says who did not reply. A message from you does not wait: it goes in right away and carries what has already arrived.
- **Busy agent:** another agent's message follows the recipient's mode (queue by default, or steering if the harness supports it). Replies to a multiple request and channel work always stay in the queue, so they arrive together.
- **Delegation policy in the base prompt:**
  - check `list_agents` before saying it cannot do something;
  - delegate to whoever has the responsibility;
  - never hand the task back to whoever passed it;
  - do not narrate preparation or exchange confirmations in a loop;
  - delegated reply in the **Status / Result / Evidence / Unblock** format;
  - the synthesis for you starts with the colleague's name;
  - never say it verified something without a tool result or reply that shows it;
  - may offer to create a specialist, but only creates one if you accept.

**Channels:**
- **Deterministic routing first:** explicit recipient, `@mention` or `@all`, reply to a task, single member.
- **Without that, the lead decides** in a call without tools, reading the channel summary and the members' **responsibilities**.
- Each chosen member receives its task.
- Limits: up to 8 automatic assignments per request and 2 in parallel per channel.
- Hand-off by `@mention` between agents keeps the cap of 3 replies in a row without a message from you.

**Visibility (where Zorel goes further):**
- The exchange between agents shows up in the chat as a **collapsed** "conversation between agents" block: who asked what, of whom, and the result.
- **Usage per delegation** (tokens and cost of each colleague) goes into the usage area.
- Each colleague's **"what the model saw"** is also accessible.

## 10. Front end

- **Page runtime:** `ZorelClient = AtomHttpApi.Service(...)` + `AtomRpc` over WebSocket with reconnection.
- **CRUD:** `ZorelClient.query(..., { reactivityKeys })` + `Atom.swr`. Mutations with the same keys revalidate on their own, and `reload()` goes away.
- **Chat:** `Atom.family(chatId → subscribeChat)`. The component reads the state (snapshot + events) and renders the grouped live response.
- **How it turned out (2026-11-03, `apps/web/src/client.ts`):** `Zorel` (`AtomHttpApi`) and `Live` (`AtomRpc`, one WebSocket). One query per resource with its key (`projects`, `agents`, `chats`, `memories`, `servers`, `accounts`, `keys`, `models`, `usage`, `approvals`). The chat is `Atom.family` over `subscribeChat` folded by `reduceChat` with `Stream.scan`; it does not use `AtomRpc`'s stream query because that accumulates in batches (`PullResult`). The statuses of all chats come from an atom kept alive over `subscribeStatus`. When a chat leaves "running", `App` invalidates `chats`, `memories`, `usage` and `approvals`, because the server changes the title, proposed memories and usage on its own. No `Atom.swr` for now: invalidation by key is enough.
- **Design system:** see 10.3.

## 10.3 Design system (D19)

**Foundation:**
- **Control scale:** 24 px (support), 28 px (bars), **32 px (default)**, 36 px (important action). Already exists in `styles.css` (`--spacing-control-*`).
- **Theme:** dark by default, light through `data-theme`, following the system. The light theme only **changes token values**, never creates tokens.
- **Tokens only:** color, text size, radius, shadow and duration come from the `--z-*` tokens. A color literal outside the tokens file is an error.
- **Interaction:** hover only with a fine pointer (`@media (hover: hover) and (pointer: fine)`); press = `scale(0.97)`; animations under 300 ms and respecting `prefers-reduced-motion`.
- **Required states** in every component: default, hover, `focus-visible`, active, disabled, loading/empty when it applies. Full keyboard support and an accessible label (`IconButton` always with `label`).

**Primitives** (`apps/web/src/ui/`, the only visual API of the screens):
- **Simple:** `Text`, `Heading`, `Button` (`default` for the context's main action, `secondary`, `ghost` in bars, `destructive`, `link`), `IconButton`, `Badge`, `Card`, `Separator`, `Spinner`, `Skeleton`, `Kbd`.
- **Form:** `Field` (label, description, error, `aria-describedby`) wrapping `Input`, `Textarea` and `Select`. `Switch` only for an immediate change.
- **Origin: shadcn.** The CLI (`shadcn init --base aria`, then `shadcn add <component>`) copies the code into `ui/`. **The code is ours**: no runtime dependency on shadcn, editable at will. Headless base: **React Aria Components** (Adobe). It is a reference in accessibility (keyboard, focus, screen readers) and has built-in internationalization (dates, numbers, right-to-left by locale), which reinforces D13. **Radix and Base UI are not used.**
- **Theme:** `styles.css` maps shadcn's semantic tokens (`background`, `foreground`, `primary`, `border`, `input`, `ring`, `popover`…) to the `--z-*` ones once. shadcn's neutral palette and default `--radius` are not used. Heights adjusted to the 24/28/32/36 scale.
- **Complex ones, over React Aria via shadcn**: `Dialog`, `AlertDialog`, `DropdownMenu`, `Popover`, `Tooltip`, `Tabs`, `RadioGroup`, `Combobox`. Screens **never import the headless library or the icons directly**, only the primitives. That way, swapping or updating the library touches no screen.
- **Zorel's own:** message bubble, tool steps block, approval card, proposal card, member chip, model and account picker, "what the model saw" inspector.

**impeccable artifacts** (at the root of `apps/web`):
- **`PRODUCT.md`** (`/impeccable init`): what Zorel is, for whom, **Operate** mode (a work app: legibility, consistency and native expectations above expression; the brand lives in the details) and tone.
- **`DESIGN.md`** (`/impeccable document`): the tokens in YAML and the rules above, generated from the current code. It is the reference every agent (and every dev) checks before creating a screen.

**Flow per screen or phase:**

| Moment | Command | Output |
|---|---|---|
| Before a new screen or flow | `/impeccable shape` | UX/UI plan before the code |
| During UI edits | detector on (`/impeccable hooks on`) | Mechanical problems on the spot: contrast, overflow, literals, fonts |
| When the screen is finished | `/impeccable audit` | Accessibility, performance, responsive |
| When the phase closes | `/impeccable polish` (one pass, bounded) | Final finish |
| Copy, errors and i18n | `/impeccable harden` and `clarify` | Error states, edge cases, short and clear copy |
| Component repeated on 2+ screens | `/impeccable extract` | Becomes a primitive |

**Mechanical check in CI:** `check:ui` fails on a color literal outside the tokens, a size, radius or duration outside the scale, a hand-made `<button>` or dialog in the screens, or a direct import of the headless library or icons outside `ui/`. It works as a ratchet (`scripts/check-ui.ts`): the debt that already exists is frozen in `apps/web/ui-baseline.json` per file and rule, and can only go down; `bun run check:ui --update` locks in the improvement. `src/ui/` and `src/dev/` are left out, because they are the design system itself.

**Screen prototype** (source of the redesign, UI phase): chat with expandable pills and right and bottom panels, "Needs you", knowledge, agent, usage and settings (connectors, MCP, skills). Link in `.agent/memory/design-system.md`.

**No gallery (user's decision, 2026-11-03):** there is no primitives page and no Storybook. The real screens are the visual reference; the primitives are checked by `check:ui`, by the detector and by reviewing the screens in both themes.

---

## 10.1 Internationalization (D13)

**Today (2026-11-03):** done on the web. `packages/i18n` has the `en.ts` catalog, `t()` with plurals through `Intl.PluralRules` and formatters (numbers, percentage, duration, age, date). `check:i18n` (`scripts/check-i18n.ts`) reads the AST of each `.tsx` with `@babel/parser` and fails on text in JSX or in props read by the person (`placeholder`, `aria-label`, `title`…). Missing on the server: the model hints (`listModels`) and the status label still come out as text; the web ignores both and builds the text from the catalog.

**Target:**

- **`packages/i18n`:** `en.ts` is the source catalog, an object nested by area (`chat.send`, `knowledge.approve`…). The other languages are `satisfies Messages`, so a missing or extra key breaks the typecheck.
- **Usage API:** `t("chat.send")` and `t("knowledge.pending", { count })`.
  - Plurals with `Intl.PluralRules`.
  - Dates and numbers with `Intl.DateTimeFormat` / `Intl.NumberFormat`.
  - Simple interpolation (`{count}`), no HTML in the catalog.
- **Language:** only `en` for now. The choice (`navigator.language`, saved preference) already goes through a single function, so it does not change when there are other languages.
- **Server:** errors and warnings for the user come out as **code + parameters** (`{ code: "chat.busy" }`, `{ code: "agents.chain_stopped", max: 3 }`) in the contract, and the front end translates. The server does not send ready-made sentences for the interface.
- **Model prompts:** in English (base prompt, consolidation, channel protocol). The instruction "reply in the user's language" still applies, so the conversation's language does not depend on the interface's language.
- **User content** (brief, memories, messages, names) **is not translated**: it stays as it was written.
- **Check:** a script in CI flags literal text in JSX (`check:i18n`), with explicit exceptions.

## 10.2 Usage area (D15)

**Today (2026-11-03, phase 2c done):**
- **Cost:** `pricing.ts` reads the models.dev catalog (USD per 1M tokens), stores it in `<dataDir>/pricing.json` and updates once a day; offline it uses the last copy. Each turn and message records `cost` and `account_id`. CLI aliases (`claude-cli/opus`) use the newest model of the family.
- **Limit windows:** `POST /api/accounts/:id/limits` reads all of the account's windows through the CLI itself (Claude: the Agent SDK's `usage_EXPERIMENTAL…`; Codex: `account/rateLimits/read` in a short-lived app-server). 4 min cache, one read at a time, failures with growing backoff (5 to 60 min). The turns' `limits` events also update the windows.
- **Usage screen**: agent, metric (cost or tokens) and period filters in the header; main number with the total; harnesses with their share (the chart legend); stacked area per day and harness with reading by hover and keyboard; token totals (with and without cache); breakdown by model, agent, project, account or day; one card per subscription with the windows and the reset; most expensive turns (`GET /api/usage/top`); warning from 80% (`LIMIT_ALERT`). The sidebar shows the fullest window next to Usage, and each response shows the account and cost.
- **Real model names:** the picker uses the list each CLI offers today (the Agent SDK's `supportedModels()`, Codex's `model/list`), with name and description ("Opus 5.5"). It lives in `preferences` (`cliModels`), is served right away and re-read in the background after 1 h; without a CLI, the fixed aliases come back.

**Data source:** the `turns` table, which phase 1 already writes. Each turn records account, model, harness, tokens (input, cache read, cache written, output), estimated cost, time to first token, total time and failover switches.

**Cost:**
- **API key:** estimated cost = tokens × the model's price. The price comes from the OpenCode/models.dev catalog, with the option to correct it by hand.
- **Subscription:** cost per token does not apply. It shows the "API equivalent", only as a reference, and what matters: the limit windows.

**Limit windows per account**, read from the harness:
- Claude: `rate_limit_event` with a 5 h window and a weekly window.
- Codex: `account/rateLimits/read`.
- Others: when the harness reports them.

The read happens **one at a time, with a 4 min cache and growing spacing on failure** (5/10/20/40 min, up to 1 h), so as not to spend limit just to measure.

**Screen:**
- Current month by agent, project, account and model, with a daily chart.
- Card per subscription account: window usage and reset time.
- The most expensive turns, with a link to the chat.

**Alerts and budget** (optional):
- Warning on reaching 80% of a subscription window or of a monthly budget (per agent or per API key account).
- On reaching 100% of the budget: the turn asks for confirmation to continue. It does not block silently.
- The subscription limit feeds failover (section 6.1).

**In the chat:** each message already shows tokens. It also starts showing the estimated cost, or "subscription", and the account used.

## 11. Security

- **Server local only and for the owner only** (security audit, 2026-11-04): listens on `127.0.0.1`. `LocalOnly` requires a local Host, an Origin (when present) equal to its own origin (another localhost port is also refused) and, on `/api` and `/rpc`, the **session secret**: 32 random bytes per startup. A local address alone proves nothing, because the agents and any process on the machine reach the loopback. The desktop generates the secret, hands it to the server through `ZOREL_SESSION` (the server reads it and deletes it from the env, so no child process inherits it) and injects it as the `x-zorel-token` header on the window's requests, from the main process (the page never sees the secret). In the browser, the link printed at startup (`/api/login?t=…`) sets an `HttpOnly; SameSite=Strict` cookie. Only the web files, the login, the OAuth callback (tied to the state) and `/api/hooks/:token` stay open. The names live in `@zorel/contracts/session`.
- **Confinement of agents below "full":** ACP runs in Seatbelt/bubblewrap; the shared git folder only comes in as writable in a real worktree (the `gitdir` must point back to the folder's `.git`). Claude Code runs the shell in Claude Code's own sandbox (Seatbelt; on Linux, bubblewrap + socat), with writing only in the folder and no network (`strictAllowlist` in the managed tier, no escape from the sandbox). Without a sandbox (Windows), only read commands without shell syntax, with paths inside the folder, run without asking.
- **The approval card shows what runs:** the task, the agent proposal, the routine and the MCP and browser arguments go to the card in full (up to 12,000 characters); larger than that, the tool refuses and asks to split. The card for a native call says how many characters were left out.
- **A workspace import arrives inert:** routines and MCP servers turned off, `full` agents become `ask` and attachments outside `<data>/attachments` are discarded (serving an attachment also checks the folder).
- **Attachments:** only passive types (raster images, PDF, plain text, audio, video) open as a page; the rest is downloaded. All with `CSP: sandbox`.
- **Agents' browser:** only http(s) addresses, also in a new tab. Controlled over a pipe, never over a debugging port (not even Electron's). The desktop window only navigates within its own origin (compared by origin, not by prefix).
- **Opening a file on Windows:** `rundll32 url.dll,FileProtocolHandler`, never through `cmd`.
- **Secrets:** API keys and MCP variables in the system keychain, never in the database or returned by the API.
- **Login of the subscription CLIs:** never read or stored.
- **Terms:** using the Claude subscription through the Agent SDK in a third-party app is a gray area: Anthropic has not confirmed it is allowed. Zorel uses the official CLI with the user's own login and shows this warning when connecting a Claude subscription account. With an API key, the path is OpenCode, without that risk.
- **Tools** only through the gateway, with policy and approval.
- **Storage** (Settings › Storage, 2026-11-03): measures the data folder on demand (workspaces, attachments, database, backups, chat folders, accounts), per project and the largest chats. Cleaning only removes old backups (the most recent stays) and folders of deleted chats and projects; it never runs `git gc` on the snapshots, because the trees have no refs and gc would delete the diff and undo history. Each cleanup goes to the audit log.
- **Audit log** (Settings › Audit log, 2026-11-03): every change to providers (accounts, keys by name, never the value), projects, agents, MCP servers, failover terms, every approval or denial and every undone turn. Built with evlog's audit helpers (`defineAuditAction`, `audit`, `auditDiff` with sensitive fields redacted) and written to the `audit_events` table inside the same Effect as the change; a failure to write only logs, it never undoes the change. SQLite only for now: no hash-chained journal.
- **Secret sanitization** before writing observations and pages (section 8, capture).
- **Untrusted content:** tool output, pages and memories are treated as untrusted in the base prompt.

---

## 12. Cross-cutting

By D0's yardstick, each topic in its minimal form.

**Observability:**
- Effect structured logs (`Effect.log*` with chat, turn, agent and account annotations), always going through **secret masking**: the `Secrets` values are registered as sensitive.
- Effect spans per turn, engine call and tool call.
- **"Export diagnostics"** produces a JSON with versions, status of harnesses and accounts (no e-mail or token), counts and recent errors. It never includes conversation content.

**Tests**, in three layers:
1. **Unit tests** of pure functions: context assembly, tool policy and classification, parsers, consolidation without an LLM and mentions.
2. **End to end with a fake engine**: real server, in-memory database and typed client. It is today's pattern (`main.test.ts`). Covers each phase's done criterion.
3. **Smoke with real CLIs** (Claude Code, Codex, OpenCode): manual or scheduled, never required in CI, because it spends subscription.

CI runs lint, typecheck, i18n and layers 1 and 2. **Each migration has a test** that starts from the previous schema with data.

**Migration of current data** (phase 1):
- One Drizzle migration brings today's whole schema: projects, agents, chats, members, messages, memories, MCP servers.
- In phase 3b, a memory becomes a `fact` page and a skill becomes `how-to`, keeping state, scope and dates.
- **Automatic backup** of the file before migrating. Tested with a copied real database.

**Backup and export:**
- Backup of the SQLite file with `VACUUM INTO`: daily and before each migration, keeping the last 7.
- **Export and import the workspace** as a `.zip` (projects, agents, chats, knowledge and settings), **without secrets**. MCP servers come back turned off.

**Notifications** (desktop):
- Fire on: an approval or question waiting, a task or routine done or failed, an account limit reached, failover triggered.
- Turn on and off by type, agent and project. They do not notify the window that is in focus.

**Attachments and images** (phase 2):
- Drag or paste into the chat. Limits of 10 per message, 20 MB each.
- Stored in `ZOREL_HOME/attachments/<chat>`.
- An image goes as an image to the harness that supports it (Claude SDK, Codex `--image`/local item, OpenCode). Other files go as a **path**, for the agent to read with its own tools.
- Deleting the chat deletes the attachments.

**App update** (phase 7):
- electron-builder produces the package (dmg; `electron-updater` with `stable` and `beta` channels once there is a Developer ID — macOS only updates a signed app).
- **The swap waits for running turns to finish.** Migrations run at startup, after the backup.
- The background server restarts on the new version.

## 13. Phases

**Order:** engine first (phases 1 and 2), then the new interface (UI phase), designed from the prototype and on top of the real events. Each phase ends with lint, typecheck and tests green and a real test with Claude Code and Codex. From the UI phase on, also `check:ui` and `check:i18n` green and, on the screens that changed, **clean detector + `/impeccable audit` + one `/impeccable polish` pass**.

| Phase | Delivery | Done when |
|---|---|---|
| **1. Runtime** (done on 2026-11-03) | **Event contract** (`ChatEvent`, `ZorelRpc`, done); **database migrated to Drizzle + `@effect/sql-sqlite-bun`, with migration of the current data and backup** (section 12); logs with masking and spans; tests in layers 1 and 2 in CI; (with owner/audience in the tables that store knowledge), **`Actor`**, `turns`, queue, `ZorelRpc` + `subscribeChat`, interrupt, recovery on boot, grouped deltas, per-turn measurement recorded in `turns`, server errors as codes. **The current chat screen only starts consuming `subscribeChat`** (no redesign) | Closing the tab in the middle of a turn and reopening shows the turn continuing. `kill -9` on the server marks the turn `interrupted` with the partial text. Resending the same `clientId` does not duplicate |
| **2. Live engines** (done on 2026-11-03) | Claude Agent SDK + Codex App Server with session, per-session marker, steering, `setModel`, reasoning effort, images. **Subscriptions only** (API keys belong to phase 5). **Multiple subscription accounts** (`provider_accounts`, login inside Zorel, `accountId` on agent and chat); **attachments and images** (section 12) | The second turn in the same chat does not start a process. Switching Claude → Codex → Claude sends only the delta when coming back. The latency and cache numbers are recorded |
| **UI. New interface** (done on 2026-11-03) | Complete design system: `DESIGN.md` updated from the prototype, tokens, missing primitives, `check:ui` in CI, detector on; app structure (tree sidebar with live status) and **all screens rewritten once**, already with **`packages/i18n` (en) and `t()`** and **atoms in the chat and in CRUD**; expandable activity pill, approval cards, model picker with accounts | No literal text in JSX outside the catalog (`check:i18n` green), `check:ui` green, clean detector and `/impeccable audit` on each screen |
| **2b. Failover** (done on 2026-11-03) | List of alternatives per agent and chat, error classification per adapter, waiting on a limit with automatic return, "only if it has not acted yet" rule, terms warning, usage reading per account, switches visible in the chat | With the main account at its limit, the turn continues on the alternative and comes back on its own after the reset. An error after a write tool does not repeat the turn. With no list configured, nothing switches |
| **2c. Usage** (done on 2026-11-03) | Usage area (section 10.2): aggregates by agent, project, account and model; estimated cost; limit windows per account; alerts | The screen shows the month's usage per agent and how much is left of each subscription with the reset time. An 80% alert shows up before the limit |
| **3. Code workspace** (central phase, done on 2026-11-03) | `projects.path`, `Workspace` service, the project's `cwd`, access levels, approval of native tools, **diff of each turn's changes** in the right panel (Changes and Files, with `@pierre/diffs`) and the read-only terminal with the agents' commands, **checkpoint and undo** (`rewindFiles` on Claude, git on the others), work steps and typed handoff | An agent reads, edits and runs the project's tests with approval. The turn's diff shows up in the chat and can be undone. After switching providers, the new agent knows what was done |
| **3b. Learned knowledge** (base done on 2026-11-03, lean: a `pages` table separate from memories — you/project/agent scope, Markdown up to 100k, FTS5 `page_index` via triggers, every edit becomes `page_versions` with restore, pinning puts only the title in the context; agents with `zorel_knowledge_search`/`read`/`write`, writing to the project or agent directly as a version and about you only with approval; Pages tab on the Knowledge screen. Later, in order of value: automatic curator at the end of the conversation (today the agent writes when it decides), links between pages, Markdown mirror in the folder, document ingestion and the periodic review of contradictions) | Section 8: pages (migration of memories and skills), per-turn capture with secrets removed, consolidation without an LLM (session page + handoff) and with an optional LLM, entry brief, `zorel.knowledge_search`/`read`, Knowledge screen with feed, versions and undo, approval queue for what is about you, "what the model saw" | After a work chat, the session page and the handoff exist without any LLM call. A new chat in the project receives the entry brief and finds the decision made earlier through search. Undoing a page update restores the previous version |
| **3c. Run panel** (done on 2026-11-03, lean: `package.json` scripts in terminal tabs and Servers with open in browser and stop; Tests and Problems are the `test`/`typecheck`/`lint` scripts running there, with the output going to the agent through "Add to chat" and clickable paths. Dedicated test and problem lists come in if this flow is not enough) | Bottom panel: interactive terminal in the project folder (subject to approvals), Tests (rerun the failures, send to an agent), Problems (`tsc` and Biome), Processes (servers with stop and restart) and Logs | A broken test shows up in Tests and an agent fixes it from there. A server started by an agent shows up in Processes and can be stopped |
| **4. Team** (done on 2026-11-03, lean: Agents screen; create/edit agents and teams through conversation with a proposal card, access never above the proposer's; Builder; versions with restore; export/import without secrets; default agent per project; catalog of pre-filled MCP connectors (GitHub, Notion, Context7, Figma, Playwright, Filesystem, Postgres) with a token, no OAuth in the app; notifications and pause everything. "Responsibilities" live in the agent's description, which is what the others read to route — a separate field comes in if the description is not enough. Later: OAuth for connectors, builder with a test chat, persisted "always allow") | Agent as versioned data (versions, publishing, reverting a version, exporting without secrets); **responsibilities** field; creating and configuring agents through conversation (`zorel.create_agent`/`update_agent`/`read_agent`/`list_models`) with a **proposal card**; builder with a test chat; **interaction from section 9.3** (`list_agents`, `send_message` with automatic reply and waiting on multiple requests, `start_task`, `interrupt_agent`, `ask_user`, delegation policy, lead routing); **approvals from 9.2** (three levels, "always allow", refusal with a reason, persisted, "Needs you", restriction and inheritance rules); team screen with status, queue and usage; **connector catalog** (GitHub, Notion, Figma… as MCP servers already configured, with OAuth login); **notifications** (section 12); default agent per project | An agent delegates to two colleagues, both replies come back together in a single turn, and the approval of one of them shows up in the origin chat and in "Needs you". An agent in Workspace cannot create a colleague with Full access. Restoring a previous version of the profile works |
| **5. ACP** (started on 2026-11-03, lean: our own `engines/acp.ts`, a JSON-RPC client over stdio with only what Zorel uses — `initialize`, `session/new` with the tool gateway as HTTP MCP when the agent accepts it, `session/set_model`, `session/prompt`, `session/update` becoming text and steps, `session/request_permission` answered by the access level (in "Ask first" it refuses and notes it in the reply; the approval card is left for the version with a live session). No state between turns, like the CLI fallback. Providers **OpenCode** (`opencode acp`, tested end to end) and **Gemini CLI** (`gemini --acp`; Google turned off the client for individual accounts, so it only works with a Workspace account/key). They show up in the picker when the binary is installed. **Confinement (2026-11-04):** below "Full access", the ACP agent's whole process runs in the macOS sandbox (`sandbox-exec`, Seatbelt): writing only in the chat's folder (in Workspace, plus a worktree's main `.git`), temporary files, caches and the CLI's own state folders; reading, network and processes stay open. On Linux, the same with bubblewrap (2026-11-04); on Windows, below "Full access" the turn is refused. **API keys through OpenCode (2026-11-04):** a chat turn with a key model (Anthropic, OpenAI, OpenRouter, Ollama, LM Studio) runs on `opencode acp` when it is installed: config in `OPENCODE_CONFIG_CONTENT` (model `provider/model`; local ones as an OpenAI-compatible provider with the URL), the key in a variable that the config references (`{env:ZOREL_PROVIDER_KEY}`), without `.claude`, external skills or the user's project config; same sandbox and permissions as the ACP agents. Internal tasks and machines without OpenCode stay on the direct engine (`ZOREL_API_ENGINE=direct` forces it). The injection path (config + sandbox) was tested live with OpenCode's own free provider; not yet with a real paid key. Tokens come in the `session/prompt` response (`usage`) and go into usage. **Approvals (2026-11-04):** in "Ask first", each `session/request_permission` becomes the turn's approval card (the agent waits for the decision), without needing a live session. Cut (ponytail): live session (it would only save the latency of starting the process per turn), and models read from the harness (the picker's list is enough until someone misses it). Not tested: a real paid key through OpenCode) | `effect-acp`, **first with OpenCode as the harness for all API keys**, including Anthropic and OpenAI (injected config), **with several keys per provider**; then Gemini CLI, Cursor, Kimi…; multiple accounts; models read from each harness. The `api` engine stops showing up as a project agent | A project agent with an OpenRouter key reads, edits and runs tests just like one with Claude |
| **6. Knowledge 2** (2026-11-04: the evaluation runs in CI — `memory-recall.bench.ts 1000 --check` fails if a memory crosses scope or owner, if the pin goes over the budget or if a fact asked in its own words does not reach the prompt. Embeddings stay out: with the consolidation's keywords, 4/4 learned facts are found with other words) | Backlog items from section 8.1 that have met the entry criterion, plus the recall evaluation running in CI | Each item comes in with the number that justified its entry recorded |
| **7. Local automation** (done on 2026-11-04: the desktop's server in its own process, which keeps running with the window closed; open at login; app update with notice, progress and "Check for updates"; keep the computer awake when plugged in; export and import workspace (the import arrives turned off: routines and MCP off, "full" access becomes "ask"); routines done on 2026-11-03 — each routine belongs to an agent and has its own chat; each run is a message in it through the normal runtime; cron with `croner` (time zone and daylight saving time) checked every 30 s, catching up once on what it missed while asleep; "Run now"; local webhook `POST /api/hooks/:token` with the body in the message; run idempotent per time slot (clientId) and skipped if the chat is busy; agents list, propose and cancel with `zorel_routines`, always with an approval card. Cut (ponytail): a published version separate from the agent's edits, because each change already becomes a version with restore and the proposal card; HMAC on webhooks, because the 256-bit token in the URL is already the secret and only the computer itself calls it) | Desktop server in the background separate from the window; routines (cron, daylight saving time) with a responsible agent, running a **published version** of the agent; webhooks with HMAC over `effect/workflow`; **app update** with channels and waiting on turns (section 12); export and import workspace | A daily routine runs with the app closed (server/desktop in the background) |
| **8. Hosted** | On top of D17's doors: login (e-mail + password or OIDC) and a real `Actor`; team and simple roles; memory by audience enforced; secrets vault in the database with envelope encryption; Postgres (`@effect/sql-pg` + ported Drizzle schema); container per project or agent; Docker image + single binary; API to run agents; light runtime for automation agents (no harness); channels (Slack, Telegram) | The same Zorel runs on a server with login, two people use different projects, a private memory never shows up in the other's project, and the agent's shell runs isolated in a container |

**Out of current scope:** cross-device sync, **mobile app and native interface** (gpui, SwiftUI, Tauri with a native screen; the desktop is Electron with the web interface, D11/D20), LLM router, account rotation pool and macOS signing.

**Evaluated backlog (no phase yet):** **store of ready-made agents** (published agents with instructions, powers, skills and routines, installable in one click; the user's idea on 2026-11-04, instead of fixed templates in the form); shared context files with `inject`/`link` mode (today the brief and the pinned pages cover it: it comes in if the same text starts being repeated across agents); tool loop detector, prompt cache break monitor per run, reviewer during the run and hash-chained audit; visual responses saved as pages; Zorel as an MCP server for other clients (Claude Code, Cursor).
