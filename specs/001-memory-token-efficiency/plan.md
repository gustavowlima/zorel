# Implementation Plan: Memory Robustness and Token Efficiency, Measured

**Branch**: `feat/memory-efficiency` | **Date**: 2026-11-08 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-memory-token-efficiency/spec.md`

## Summary

Make Zorel's memory measurably correct at scale and cut the tokens each turn costs. First measure
recall through the entity map with a frozen real extraction in the benchmark (Story 1); then merge
spelling-level duplicate facts at save time (Story 2), shorten large results of Zorel's own tools
behind a `zorel_read_result` handle (Story 3), move per-turn context after the transcript for
sessionless engines so the provider cache holds (Story 4), lower the pin budget only if Story 1's
recall holds (Story 5), and stop consolidation from restating a skill as facts (Story 6). No model
calls added on the hot path, no new dependency, no migration. Details: [research.md](research.md).

## Technical Context

**Language/Version**: TypeScript on Bun 1.4

**Primary Dependencies**: Effect 4.1 (HttpApi, Schema, rpc), Drizzle 1.0 rc over `@effect/sql-sqlite-bun`, MCP SDK (gateway), Playwright (agents' browser)

**Storage**: SQLite (one file) with FTS5; no schema change in this feature

**Testing**: `bun test` (unit + integration in `apps/server/src/*.test.ts`); benchmarks `apps/server/bench/memory-recall.bench.ts` (no model, `--check` in CI) and `memory-consolidation.bench.ts` (real model, run by hand)

**Target Platform**: local server on Windows, macOS and Linux (desktop app and local web)

**Project Type**: desktop + local web app with a Bun server (`apps/server`), React web (`apps/web`)

**Performance Goals**: turn preparation stays ≤ 5 ms p95 at 1,000 memories (today 4.4 ms); merge check on save < 2 ms at 1,000 facts per scope

**Constraints**: no model call added per turn or per save; model-facing text in English; prompt cache share ≥ 96%

**Scale/Scope**: benchmark at 1,000 memories (also runs 100 and 10,000); real use today ≪ 1,000

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Result |
|---|---|---|
| I. Scope and simplicity | Six stories from the spec only; no new files beyond a bench fixture; no dependency; no migration; light first (no model on hot path) | ✅ |
| II. Security | No secret handling changes; compacted results are kept per chat in memory and readable only from that chat; merging never crosses owner or scope | ✅ |
| III. Errors and boundaries | `zorel_read_result` validates input at the gateway; unknown handles return a tool error, not an exception | ✅ |
| IV. Cross-platform | No OS-specific code | ✅ |
| V. Language | Fixes the Portuguese `[… resultado cortado]` marker sent to models; all new model-facing text in English | ✅ |
| Workflow | `bun run test` + both benchmarks; numbers recorded in `docs/ARCHITECTURE.md` §8 and `.agent/memory/server.md` | ✅ |

Post-design re-check (after Phase 1): unchanged, all ✅. No Complexity Tracking entries.

## Project Structure

### Documentation (this feature)

```text
specs/001-memory-token-efficiency/
├── plan.md              # this file
├── research.md          # R1–R6 decisions
├── data-model.md        # facts, canonical key, compacted result
├── quickstart.md        # how to validate each story
├── contracts/
│   └── agent-tools.md   # compacted result text, zorel_read_result, prompt layout
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
apps/server/
├── bench/
│   ├── memory-recall.bench.ts        # Story 1 (map in the bench, map/words/pin/total), Story 2 & 5 numbers
│   ├── memory-consolidation.bench.ts # Story 6 check
│   └── fixtures/needle-map.json      # Story 1: frozen real extraction of the 25 needles (new)
└── src/
    ├── db.ts           # Story 2: canonical key in addMemory
    ├── db.test.ts      # Story 2 tests
    ├── tools.ts        # Story 3: compact() replaces the 40k cut; zorel_read_result
    ├── browser.ts      # Story 3: snapshot goes through compact()
    ├── engines.ts      # Story 4: sessionless layout (stable → transcript → <context>)
    ├── engines.test.ts # Stories 3 & 4 tests
    ├── context.ts      # Story 5: MEMORY_BUDGET (conditional)
    └── chat.ts         # Story 6: consolidation rule + filter
```

**Structure Decision**: existing `apps/server` layout; changes stay in the files that already own
each concern. The only new file is the bench fixture.

## Order and gates

1. Story 1 → record the number. **Gate for Story 5.**
2. Stories 2, 3, 4, 6 are independent of each other; each ships with its test and number.
3. Story 5 last, only if Story 1 met SC-001; otherwise write the gap as the embeddings entry
   criterion.
