# References: what was used and what was not

Traceability map. For each good practice from the three references studied, it says where it is applied in Zorel, with the file and the test that covers it, or why it was left out. Update it when the decision changes.

Licenses: a reference app is Apache-2.0 and the derived code is attributed in `NOTICE`. T3 Code is MIT, and architecture ideas came from it, not code. a reference app is PolyForm Noncommercial: **ideas only, no code**.

## a reference app

| Practice | In Zorel | Verification |
|---|---|---|
| Sessionless CLI: the context is assembled by the app on every turn | `engines.ts` (`--no-session-persistence`, `--ephemeral`), `context.ts` | `engines.test.ts` (args), real turn with 658 input tokens |
| Isolated CLI: no tools of its own, no user config, hooks or plugins | `claudeArgs`, `codexArgs` | `engines.test.ts` |
| Rolling summary: window of 30 verbatim messages, consolidates above 50 | `context.ts` (`WINDOW`, `MAX_AFTER`), `chat.ts` (`consolidate`) | `main.test.ts` |
| Scoped memories with human approval | `db.ts` (state pending/active/forgotten), `memories.tsx` | `main.test.ts` |
| Memory budget in the prompt and the rest searchable (BM25) | `pinned()`, `searchMemories` (FTS5) | `engines.test.ts`, `db.test.ts` |
| Consolidation receives what was forgotten | `consolidationPrompt` (`forgotten`) | `main.test.ts` (learning) |
| Cap on pending proposals | `chat.ts` (`MAX_PENDING`) | `main.test.ts` (learning) |
| Skills proposed by the agent and approved | `parseConsolidation` (skills), `memory_index` | `main.test.ts`, `engines.test.ts` |
| @mention and hand-off with a depth limit | `mentioned()`, `chain()`, `MAX_DEPTH` | `main.test.ts` (channel), real test Claude → Codex |
| Per-turn MCP gateway with a secret URL, the only source of tools | `tools.ts` (`Gateway`) | `main.test.ts`, real test with Claude and Codex |
| Tool classification: annotation > name, sensitive beats read | `classify()` | `engines.test.ts` |
| Approval of the exact call, and refusal returned to the model | `openTools()` in `chat.ts` | `main.test.ts`, real test |
| Truncated tool result | `MAX_RESULT_CHARS` | — |
| Secrets in the system keychain | `secrets.ts` (`Bun.secrets`) | `main.test.ts` (keys, with in-memory storage) |
| Login shell PATH in the desktop app | `apps/desktop/src/bun/index.ts` | real `.app` found `claude` and `codex` |
| **Out:** LLM router when no one is mentioned | the lead (★) is the one who answers | Decision: cost and latency on every message. a reference app also starts with the lead. Add if channels grow. |
| **Out:** per-agent token limits, "pause everything", routines, quiet hours | tokens are already recorded per message | Not requested. The data for limits already exists (`input_tokens`/`output_tokens`). |
| **Out:** "always allow" a tool | the server mode (`auto`) covers the case | — |

## T3 Code

| Practice | In Zorel | Verification |
|---|---|---|
| Single contract with Effect Schema; server and clients follow the schema | `packages/contracts` + `HttpApiClient` in web | `tsc` on both sides, 400 at the boundary (`main.test.ts`) |
| Effect services and Layers, with tests swapping the implementation | `Store`, `Secrets`, `Engines`, `Tools`, `DataDir` | `main.test.ts` (Secrets.memory, fake engine) |
| "Every way in has a way out" (reverse states) | delete project/agent/chat/server; forget → **restore** memory; turn off → turn on server | `main.test.ts` (learning) |
| Do not hardcode origins in the bundle | web uses `location.origin` and the Vite proxy | — |
| Single origin in production | the server serves `apps/web/dist` (`WebRoute`) | stable `.app` tested |
| Provider switch without losing context | trivial: context belongs to Zorel, not to the session | `main.test.ts` (switch), real test Claude → Codex |
| **Out:** git checkpoints, worktrees, mobile, remote tunnel, source control integrations | — | Focused on remote coding. Outside Zorel's scope. |
| **Out:** compaction before the cache expires | — | Does not apply: there is no native session to compact. |

## a reference app (ideas only)

| Practice | In Zorel | Verification |
|---|---|---|
| Strict trust boundary on the local server | `LocalOnly`: local Host against DNS rebinding, local Origin against CSRF; listens only on 127.0.0.1 | `main.test.ts` (local only) |
| Secret never in a file or log; redacted | values in the keychain; `envKeys` stores only names; keys never come back through the API | `main.test.ts` (keys) |
| A single schema system | only Effect Schema (a reference app suffers from Zod + Effect Schema) | — |
| Linter in CI | Biome (`biome.json`, `bun run lint` in CI) | CI |
| Two-layer memory: essentials in the prompt, the rest searchable | `pinned()` + FTS5 | `engines.test.ts`, `db.test.ts` |
| Memory review triggers | consolidation on a full window or manually (Compact) | `main.test.ts` |
| Message saved even if the turn is interrupted | `reply()` → `onExit` records it as "interrupted" | — |
| Detection of local Ollama / LM Studio | `probe()` in `engines.ts` | test with an OpenAI-compatible mock |
| Subscription through the subscription CLI: never touch the login | only the official CLI; no OAuth | — |
| **Out:** event sourcing with idempotent receipts | the per-chat lock (`Busy`, 409) prevents duplicate turns; simple tables | Add if there are several processes or sync between devices. |
| **Out:** FIFO queue with recovery after a crash | — | Today one turn per chat, synchronous with the client. Needed once there are routines and background agents. |
| **Out:** list of fallback models | — | Add if provider failures show up in use. |

## Other references evaluated

| Project | License | What came into Zorel | What did not |
|---|---|---|---|
| [Zeron](https://github.com/zeronsh/zeron) (Rust) | MIT | Per-provider marker of "how far each session has read": on a switch, only the delta is resent (ARCHITECTURE §7). Desktop server in the background, separate from the window (D11) | CRDT and relay sync; gpui interface |
| [ai-memory](https://github.com/akitaonrails/ai-memory) (Rust) | MIT | Typed handoff offered, not consumed; usage-based retention without an LLM; L0/L1 context; secret scrubbing; versions; recall evaluation (§8, memory 2) | Markdown in git as the source of truth; capture through hooks; multi-user server |
| [AgenticOS](https://github.com/vstorm-co/agenticos) (Python) | Apache-2.0 | Agent as versioned data with references; builder with testing and an agent that drafts agents for approval; per-agent toolbox; memory scope by owner and public (phase 4, D17). Backlog: loop detector, cache monitor, reviewer during the run, chained audit | FastAPI, Pydantic AI, Postgres + pgvector + Redis; multi-company model (phase 8 decides what to bring) |
| [T3 Code](https://github.com/pingdotgg/t3code) | MIT | `effect-acp` and `effect-codex-app-server` copied (D16); RPC over WebSocket and atoms on the front end (D3, D4); multiple accounts with a login folder per account (D14) | Full fork (D16: Node, Electron, ~600 thousand lines, no i18n) |

**Rejected as a dependency**, with the reason in the cited decision:
- **Mastra and LangGraph** (D5): two runtimes, duplicated state and memory, Zod.
- **oRPC** (D1): experimental integration with Effect.
- **Zod** (D2).
- **`@effect/sql-drizzle`** (D9): Effect 3 only. We use `drizzle-orm` 1.0, which integrates natively with Effect 4.
