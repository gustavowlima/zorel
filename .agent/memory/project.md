# project
updated: 2026-11-04

## summary

Zorel: open source AI agent workspace with Projects (project agents) and standalone Chats.
Context assembled by the app every turn (project → chat → memories), not accumulated in a CLI session.
Continuous learning via memories and skills approved by the user. Model switch on any turn,
using subscriptions (official CLI: Claude Code, Codex, ACP) or API token (effect/ai).

## technical context

- stack: Bun 1.4 workspaces, Effect 4.1.2 (HttpApi + Schema), bun:sqlite, Vite + React 19 + Tailwind v4
- packages/contracts is the only source of types that cross the network; web uses HttpApiClient derived from it
- subscriptions: always spawn the official CLI; never read/store its OAuth token (provider terms)
- decided not to fork an existing UI: its core depends on the CLI's native session, ~1M LOC, ~150 commits/day, Node/pnpm
- Apache-2.0 license (compatible with the third-party code credited in NOTICE; patents); own git repository at zero/ (previously lived inside the dev/ repo)
- macOS signing: user chose no signing for now (2026-11-03); config turns itself on if the secrets are registered
- CI: .github/workflows/ci.yml (typecheck, test, build; macOS app on push to main)
- lint: Biome as linter only (no formatter), recommended preset; noNonNullAssertion and noBannedTypes off with reason in biome.json; any only as warning

## target architecture (2026-11-03)

- source of truth: docs/ARCHITECTURE.md (decisions D1–D12, modules, phases 1–7)
- Effect end to end: HttpApi (CRUD) + effect/rpc over WebSocket (turns) + atoms on the front (AtomHttpApi/AtomRpc); oRPC, Zod, Mastra and LangGraph discarded
- target engines (harness first): subscription → owner's harness (Claude Agent SDK, Codex App Server, the CLI's ACP); API key of ANY provider (including Anthropic/OpenAI) → OpenCode via ACP with config through OPENCODE_CONFIG_CONTENT; effect/ai only for internal tasks and quick conversation without workspace; per-turn measurement decides whether any provider gets a native route
- hybrid context: native session + layered context as resume point + per-session read marking + work steps
- next phase: 1 (background runtime)
- i18n (D13): all UI text via packages/i18n (en.ts source, other languages `satisfies Messages`); English only for now; server sends code + parameters, not sentence; model prompts in English with "reply in the user's language"; user content is not translated; migration together with phase 1
- multi-account (D14, ARCHITECTURE 6.1): provider_accounts table (subscription with managed login folder ~/.zorel/accounts/<id> via CLAUDE_CONFIG_DIR/CODEX_HOME/...; api-key with key in the keychain); accountId on agent and chat; manual switch = provider switch (resume point), no shadow home; OPTIONAL automatic failover (ordered list of up to 8 {account, model}, may cross providers; triggers limit/error; only if the turn has not acted yet; back to the primary after reset; terms warning when adding a 2nd subscription of the same provider; off by default) — phase 2b; pool with rotation stays out (external proxy); subscriptions in phase 2, multiple keys in phase 5
- usage (D15, ARCHITECTURE 10.2, phase 2c): turns data (tokens incl. cache, estimated cost via models.dev catalog, latencies, failover); limit windows per account (Claude rate_limit_event, Codex account/rateLimits/read) read 1 at a time, 4 min cache, backoff 5/10/20/40 min up to 1 h; alerts at 80%; budget at 100% asks for confirmation (does not block silently)
- architecture validation (2026-11-03): Claude Agent SDK confirmed (setModel/interrupt only in streaming input; rewindFiles; switching model resets cache); harness decided by the account, not by the model name; new projects.path; desktop with server in background in phase 7; terms warning for Claude subscription via Agent SDK
- decisions 2026-11-03: D16 own project (no fork; copy packages/effect-acp and effect-codex-app-server with NOTICE); D17 doors open for hosting (Actor, Drizzle+@effect/sql, Secrets, Workspace, memory owner/audience, versioned agent, Engine); D9 Drizzle 1.0 rc pinned on top of @effect/sql-sqlite-bun (Postgres later via @effect/sql-pg; FTS5 in plain sql; API contract separate from the tables)
- purpose: code now; hosted + automation later (phase 8)
- D18 knowledge base (ARCHITECTURE 8.2, phase 3b): per-project/global collections linked to agents; sources upload/incremental local folder/URL; hybrid search FTS5+vectors with RRF; citations; embeddings Ollama or API via effect/ai EmbeddingModel; tool mode (zero.knowledge_search) or auto
- local database: libSQL (@effect/sql-libsql) with native vectors (F32_BLOB, libsql_vector_idx, vector_top_k); validate in the phase 1 spike (native in Bun, FTS5); plan B bun:sqlite + brute force
- memory management (8.1): pin/exclude from context, versions, visible retention, export/import, turn off per agent/project; context inspector "what the model saw" per answer
- 2026-11-03 "light" review: D0 light first (one process, one database file, no mandatory external service; grow only with measurement); D18 became LEARNED knowledge (capture→consolidate→retrieve→baton), single page (fact/decision/how-to/pitfall/reference/session) replaces memories+skills; consolidation without LLM always (session page + handoff) and LLM optional; entry summary ~1.5k tokens + zorel.knowledge_search FTS; D7: project knowledge goes in directly with versions/undo/feed, what is about the user goes through approval; RAG by upload, libSQL, embeddings, graph, mem0 → backlog with criterion; database back to @effect/sql-sqlite-bun
- approvals and interaction between agents (ARCHITECTURE 9.2/9.3, phase 4): per-agent levels Workspace (default)/Ask before/Full access mapped per harness; single card for native tool and MCP, binding by call hash, approve once/always allow (revocable rule)/decline with reason; persisted, expire in 30 min (=decline); promoting to Full access answers the pending ones; "Needs you" screen; routine: decline and report (default) or wait; agent only restricts, never widens; created agent inherits the creator's limits; send_message with automatic reply + waiting on multiple requests + loop protection + idempotency; start_task (2 parallel, up to 4; 8 open); interrupt_agent only on what the caller requested; delegation policy (Status/Result/Evidence/Unblock); channel: deterministic routing, later a leader without tools using responsibilities; collapsed block "conversation between agents"
- architecture closed (2026-11-03): section 12 Cross-cutting (observability with masking, tests in 3 layers, migration of current data + backup VACUUM INTO, export/import workspace without secrets, notifications, attachments 10×20 MB, app update with channels and waiting for turns); section 13 Phases; default agent per project; context files inject/link in the backlog
- D20: no Rust as main stack; only isolated pieces with a measured limit (2026-11-03)
- PRODUCT.md (apps/web, impeccable init 2026-11-03): users = dev + small team (2–5); differentiators = the context belongs to Zorel, learns while working, team of agents, uses what you already pay for; name "Zorel" (renamed from "Zero" on 2026-11-04; the user owns zorel.dev); Apache-2.0; direct/technical tone; OPEN DECISION: how the team shares before hosted (server on the team's network vs bringing forward login/roles from phase 8)

## order (2026-11-03)

- engine first: phase 1 (runtime) and phase 2 (engines) before the interface; the UI phase redesigns everything once, with i18n and atoms, from the prototype
- screens prototype: https://claude.ai/artifact/ERkKURix2bnKAqzi97emmw (private to the owner)
- new phases: 3c execution panel (terminal, tests, problems, processes, logs); connector catalog with OAuth in phase 4
- phase 1 (runtime) and phase 2 (live engines) completed on 2026-11-03; next in §13 order: UI phase (new interface), or 2b/2c (failover, usage)

## conventions

- code comments in English (user request on 2026-11-03; replaces AGENTS.md's "comments in the project language" for this project). UI text and model prompts are not comments: they stay as they are until the UI phase i18n
- alias in the server: `#server/*` (package.json "imports"), not tsconfig `paths`: the desktop bundles the server and only imports is resolved by the server's own package.json
- commits in English from 2026-11-03 (user request); code comments in English too; earlier history stays in Portuguese
- renamed Zero → Zorel (2026-11-04): packages @zorel/*, env ZOREL_*, tools zorel_*, MCP gateway "zorel", keychain dev.zorel.app, appId dev.zorel.app. Legacy kept: data in ~/.zero/zero.db keeps being used if it exists (not moved: the database stores absolute paths); keychain reads dev.zero.app and copies; localStorage zero.* copied to zorel.*; zero-* backups still pruned; import accepts "zero.agent". The repository folder stays dev/zero
