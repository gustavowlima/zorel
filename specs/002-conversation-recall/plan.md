# Implementation Plan: Recall from Past Conversations, Fused and Measured

**Branch**: `feat/memory-efficiency` | **Date**: 2026-11-08 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-conversation-recall/spec.md`

## Summary

Let each turn's recall also find what was said in other chats of the same scope: an FTS5 index over
messages (one migration, triggers like the other indexes) gives short `snippet()` excerpts, filtered
for credentials, forgotten facts and repeats of recalled facts (Story 1). Order map, fact and message
results by reciprocal rank fusion instead of concatenation (Story 2). Open the recalled section with
an untrusted-data notice and neutralize `</context` inside the dynamic part (Story 3). Measure with a
zero-model LongMemEval-S harness against ai-memory's 0.951 (Story 4). No model call, no new
dependency. Details: [research.md](research.md).

## Technical Context

**Language/Version**: TypeScript on Bun 1.4

**Primary Dependencies**: Effect 4.1, Drizzle 1.0 rc over `@effect/sql-sqlite-bun` (SQLite FTS5)

**Storage**: SQLite; one migration adds `message_index` (FTS5) with triggers and a backfill

**Testing**: `bun test`; `bench/memory-recall.bench.ts --check`; new `bench/longmemeval.bench.ts` (by hand)

**Target Platform**: local server on Windows, macOS and Linux

**Project Type**: desktop + local web app with a Bun server (`apps/server`)

**Performance Goals**: prepare p95 ≤ 17.4 ms at 1,000 memories (2× today's 8.7 ms); message search
over a project's messages < 5 ms

**Constraints**: no model call per turn; recalled section ≤ 2,000 characters; model-facing text in
English; dataset never committed

**Scale/Scope**: real use ≪ 1,000 memories and thousands of messages; benchmark: 470 questions × ~50
sessions each

## Constitution Check

| Principle | Check | Result |
|---|---|---|
| I. Scope and simplicity | Four stories from the spec; reuses FTS5 + triggers pattern, `snippet()`, `ftsQuery`, `similar`, `hasCredential`; one migration; one new bench file | ✅ |
| II. Security | Excerpts never cross projects; credentials dropped before the prompt; recalled text marked untrusted and unable to close its block | ✅ |
| III. Errors and boundaries | Dataset hash checked, mismatch fails loudly; empty query recalls nothing | ✅ |
| IV. Cross-platform | Dataset path from `os.homedir()`; no OS-specific code | ✅ |
| V. Language | Notice, headings and excerpt labels in English; no reply-language forcing | ✅ |
| Workflow | `bun run test`, both benches; numbers in `docs/ARCHITECTURE.md` §8 and `.agent/memory/server.md` | ✅ |

Post-design re-check: unchanged, all ✅. No Complexity Tracking entries.

## Project Structure

### Documentation (this feature)

```text
specs/002-conversation-recall/
├── plan.md
├── research.md          # R1–R4
├── data-model.md        # message_index, excerpt, recall result
├── quickstart.md
├── contracts/
│   └── recalled-context.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
apps/server/
├── drizzle/<timestamp>_message_index/migration.sql  # Story 1: FTS5 + triggers + backfill
├── bench/
│   ├── memory-recall.bench.ts   # Story 2 check (reach must not drop)
│   └── longmemeval.bench.ts     # Story 4 (new)
└── src/
    ├── db.ts            # Story 1: recallMessages()
    ├── db.test.ts       # Story 1 tests
    ├── chat.ts          # Stories 1–2: recall() with three streams + RRF; prepare passes excerpts
    ├── context.ts       # Stories 1, 3: excerpts section, notice, </context escape in buildTurn
    └── engines.test.ts  # Stories 2–3 tests
```

**Structure Decision**: existing `apps/server` layout; each change in the file that owns the concern.

## Order and gates

1. Story 4's harness first, run once: the before number (0 by construction, recorded).
2. Story 3 (small, security) before Story 1 widens what reaches the prompt.
3. Story 1, then Story 2; recall bench `--check` and prepare p95 after each.
4. Story 4 again: the after number, next to 0.951. Below 0.80 → the per-type gap is the next spec's input.
