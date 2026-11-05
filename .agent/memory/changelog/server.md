2026-11-02 | added agents, chats, messages, memories (FTS5), CLI/API engines, layered context, consolidation | MVP
2026-11-02 | channels (chat_members, @mention, handoff up to 3), skills (memories.kind), MCP (hub + gateway + approval), keys in the keychain (Bun.secrets), own FTS index with title | request "implement everything"
2026-11-03 | LocalOnly guard (Host\/Origin), forgotten ones in consolidation + pending cap, restore memory | best-practices audit of the references
2026-11-03 | D5 revised: API key becomes a harness credential (Claude SDK, Codex, OpenCode ACP); effect/ai internal only | own loop over effect/ai is weak compared to harnesses like OpenCode
2026-11-03 | API key from any provider (including Anthropic/OpenAI) → OpenCode; subscription → owner's harness | a single path for keys, same behavior across models
2026-11-03 | automatic account\/model failover becomes supported, optional and with a terms notice (phase 2b) | user request; before it was manual switching only
2026-11-03 | database: direct bun:sqlite → Drizzle 1.0 rc over @effect/sql (phase 1) | native Effect 4 integration, SQLite→Postgres portability, generated migrations
2026-11-03 | local driver: @effect/sql-sqlite-bun → @effect/sql-libsql; RAG enters the design (D18) | native vectors without extension; user request
2026-11-03 | memories+skills → learned knowledge pages; upload RAG and libSQL removed; driver back to sqlite-bun | request: light, simple, efficient; knowledge base = learning
2026-11-03 | shadcn headless base: React Aria (--base aria), not Radix nor Base UI | user decision; built-in a11y and i18n
2026-11-03 | turn event contract (events.ts) and subscribeStatus | engine first; prototype becomes the event spec
2026-11-03 | database migrated to Drizzle (effect-sqlite-bun), repository in Effect, adoption of the MVP database with backup | D9, phase 1
2026-11-03 | turn runtime (queue in the database, WebSocket RPC, recovery on boot); SSE removed | phase 1, ARCHITECTURE §5
2026-11-03 | phase 1 close: masked logs + spans, Actor and owner/audience on memories, first token, errors as code, daily backup keeping 7 | ARCHITECTURE §12, §13
2026-11-03 | comments now in English | user request
2026-11-03 | native Claude session (Agent SDK) with per-session marker | phase 2, step 1
2026-11-03 | native Codex session (minimal client, isolated CODEX_HOME); D16 revised | phase 2, step 2
2026-11-03 | multi-account: provider_accounts, account per chat/agent, login/status via CLI | phase 2, step 4
2026-11-03 | real steering in Codex, reasoning level, cache tokens per turn | phase 2, step 5
2026-11-03 | attachments and images; session per provider (returning to Claude sends only the delta); phase 2 completed | §12, §13
2026-11-03 | GET /api/usage and RPC approvals | Usage and Needs you screens
2026-11-03 | failover per agent/chat, wait for limit, usage reading per account | phase 2b
2026-11-03 | workspace with shadow git, per-agent access, native tools, diff/undo, turn watchdog | phase 3
2026-11-03 | consumption (cost, limit windows) and real model names from the CLIs | phase 2c
2026-11-03 | position on projects and chats + reorder endpoints | drag and drop in the sidebar
2026-11-03 | audit log with evlog writing to SQLite | user request
2026-11-03 | context endpoint, window in the catalog, $skill in the turn | new composer
2026-11-03 | claude-cli loads user/project/local settings with policy-only permissions and no hooks; CLI slash commands listed and dispatched | run Claude Code's own / commands
2026-11-03 | run panel: project scripts in terminal tabs, local servers with open in browser and stop | phase 3c
2026-11-03 | git in chat: status, commit with model-drafted message, push, PR via gh, new branch; audited | git workflow without leaving the chat
2026-11-03 | worktree per chat (POST/DELETE /api/chats/:id/worktree) | isolate parallel chats
2026-11-03 | agents create/edit agents via tools with approval card; access limited to the proposer's | phase 4
2026-11-03 | agent versions with restore; export/import profile without account | phase 4
2026-11-03 | human-evidence rule, confirm and zero_search_memories | more reliable memory
2026-11-03 | protection against loops and repeated failures in the turn | stop runaway turns
2026-11-03 | routines: cron, run now, local webhook, tool zero_routines | phase 7
2026-11-03 | Builder (Build with AI) and creating a whole team in one card | user request: one assistant to create several agents at once
2026-11-03 | pause everything and system notifications | item 1 of the list
2026-11-03 | resume automatically on limit reset | item 2 of the list
2026-11-03 | edit from here (rewind) with optional file undo | item 4
2026-11-03 | phase 4 closed: default agent per project and connector catalog | item 5
2026-11-03 | browser: hover, select, scroll, upload, dialogs and browser_run | item 6
2026-11-03 | knowledge pages with versions and agent tools | item 7, phase 3b
2026-11-03 | ACP: OpenCode and Gemini CLI through one adapter | item 8, phase 5
2026-11-04 | ACP agents confined in the macOS sandbox below full access | before, Workspace level allowed everything
2026-11-04 | per-agent permissions (web, browser, connectors, always allow, request access) | user request: per-agent control of what it may reach
2026-11-04 | skills: read on demand, propose improvement with diff, versions and restore | skills improve with review and can be rolled back
2026-11-04 | selectable computer skills and option to use Claude Code/Codex native skills | user request
2026-11-04 | OAuth connectors (oauth.ts, mcp_servers.auth, sign-in/callback routes) | user asked for a one-click connectors section
2026-11-04 | Hub.refused + env in MCP server patch | reconnect a connector with a refused credential
2026-11-04 | renamed Zero → Zorel (env, keychain, tools, data folder with legacy) | user chose the name Zorel (owner of zorel.dev)
2026-11-04 | zorel_start_task (delegation with return to the originating chat) | team phase: agents become a team
2026-11-04 | prompts, tool results and errors in English; no language instruction | user request: everything in English without forcing a language
2026-11-04 | cross-platform procs.ts + real-time consumption in Processes | user asked for live consumption; everything must run on Windows, macOS and Linux
2026-11-04 | terminal on Windows (PowerShell) and ACP sandbox on Linux (bubblewrap) | rule: everything on all three OSes
2026-11-04 | zorel_ask_user (question with options, answer goes back to the agent) | team: agent asks instead of guessing
2026-11-04 | export/import workspace (phase 7) | move to another computer without losing projects, agents, chats and knowledge
2026-11-04 | closing of the mention handoff, follow-up without mention stays with the colleague, Status/Result/Evidence format, notice at the limit | real team test
2026-11-04 | cheap router for messages without mention; MCP gateway in SSE with ping | user asked for the router; question expired at 5 min
2026-11-04 | fs-ops.ts + POST /api/chats/:id/fs; cross-platform openFile | interactive Files tab; openFile only worked on macOS
2026-11-04 | GitStatus.files: string[] -> {path,status}[] | Git panel shows A/M/D/R per file
2026-11-04 | API requires the session secret; Claude Code sandbox; whole cards; gitdir validated; inert import; attachments without inline HTML; browser only http(s); Windows without cmd | security audit (cloudflare security-audit-skill) confirmed the findings
2026-11-04 | browser: launch over pipe, context per agent, logins sealed in the keychain, Chromium bundled in desktop, sign-in window | app independent of Chrome and with no CDP port
2026-11-04 | memory: owner, essentials, rotation per scope, keywords, corrections, grounding, secretlint, Schema in parse | evaluation showed 1/25 with other words, 2 false memories, correction without effect, latent leak between owners
2026-11-05 | steer: Claude gets real steering (steerGate by uuid, no timer); "Send now" interrupts when the engine can't steer; MENTION_RE moved to contracts, e-mails no longer call agents | one mention rule for server and web; no stray result leaks into the next turn
2026-11-05 | steerGate: orphans, 30 s protection limit, steer only after stamping is seen | Stop returns at once and nothing of a pending steer leaks; a CLI that ignores uuids can't freeze a turn
2026-11-05 | claude sandbox split in policy tier + flag layer; agent env without app ZOREL_*; macOS shell zsh; chats.access + effectiveAccess + audit | SDK dropped allowLocalBinding/autoAllowBash from managedSettings; per-chat access was asked by the user
2026-11-05 | chat access only narrows; Stop closes the Claude session when a steer is pending; send-now fallback saves the message after the interrupted turn | review of the agents' changes: elevation path, unseen work after Stop, out-of-order history
2026-11-05 | agents working at once: global configurable limit, chats over it wait in line | user asked for a limit set in Settings
2026-11-05 | zorel_preview: any project's dev server on a free port, shown in the chat's Browser panel | user wants previews for any project (as Tucano/OpenBot), without containers or portless
2026-11-05 | per-agent monthly and per-reply token limits, archive, retry | user asked for items 1-3 of the Tucano comparison
2026-11-05 | routines triggered by connector events (poll a read-only MCP tool, run on new items) | item 4 of the Tucano comparison
2026-11-05 | Run button: the person starts the project server like zorel_preview | user: "rodar localmente" = Zorel runs the project in the chat folder
2026-11-05 | task chats inherit the asking chat's access level | the chat's level must cover every agent working for it
2026-11-05 | chat access level overrides agents both ways, including Full access | user chose option B
2026-11-05 | runs endpoint; steps keep reads/searches and 4000 chars of output | user wants each agent session reviewable after it ends
