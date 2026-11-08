# Research: Memory Robustness and Token Efficiency

All findings come from reading the code on 2026-11-08 (`feat/memory-efficiency`) and running both
memory benchmarks. No open questions remain.

## R1. How to measure recall through the map honestly (Story 1)

- **Found**: `bench/memory-recall.bench.ts` seeds 25 needles + noise through `addMemory` only, so
  no fact has map points; `recall()` (`src/chat.ts:46`) seeds the spread from `namedPoints(query)`,
  which needs points whose name or alias appears in the question. The map path is never exercised.
- **Decision**: record the real extraction once: run the app's own map extraction (`MAP_SYSTEM`,
  `src/chat.ts:291`, the same call the backfill uses) on the 25 needles with the memory model, save
  its JSON as a fixture (`bench/fixtures/needle-map.json`), and file it with `linkMemory`. Noise facts
  get maps from their template slots: `noiseFact` (`bench/memory-recall.bench.ts:39`) picks words
  from lists (`W.lang`, `W.tool`, `W.style`, `W.day`); it returns those words too and each becomes
  a point, so the noise competes on the map as it does on words.
  The benchmark then reports reach by map, by words, by pin and in total, and `--check` fails below
  the recorded floor.
- **Rationale**: hand-writing maps while looking at the paraphrased questions would grade our own
  homework; a frozen real extraction is what production would have, and stays deterministic in CI.
- **Alternatives rejected**: calling the model in every bench run (cost, flaky CI); embeddings
  (out of scope until this number shows a gap).

## R2. Merging same-meaning variants without a model (Story 2)

- **Found**: `addMemory` (`src/db.ts:641`) dedupes only on `normalize(text)` (case, accents,
  punctuation, spaces) via the `(scope, normalized)` conflict. Benchmark: 5/11 merged; kept apart:
  abbreviation, reworded, dropped article, synonym, plural, third-person rewrite; the reversed
  meaning is correctly kept.
- **Decision**: a second key, `canonical(text)`: normalized words without articles and possessives
  (`the a an their his her my`, pt `o a os as um uma`), a leading subject (`the user`, `user`,
  `the person`), and a trailing plural `s` on words of 4+ letters, **in order**. Before inserting,
  compare it with the active facts of the same scope and owner (already loaded per turn by
  `activeMemories`; a scan of ~1k rows is <2 ms); equal key → confirm the existing one and return
  undefined, as today's exact duplicate does.
- **Guards**: word order is kept (so "TypeScript over JavaScript" ≠ reversed); keys must also have
  the same numbers and the same negations (`not never no nao nunca`), which order alone already
  implies; forgotten facts are not compared (FR-004).
- **Expected**: dropped article, plural and third-person rewrite merge → 8/11. Abbreviation,
  synonym and rewording stay to consolidation, which sees existing facts.
- **Alternatives rejected**: Dice similarity on the whole sentence (merges "deploys on Fridays" with
  "never deploys on Fridays" at 0.8+); a new indexed column + migration (not needed at this scale:
  `ponytail:` comment, add the column if a scope passes ~10k facts).

## R3. Large tool results (Story 3)

- **Found**: Zorel's own tools already cut, but lose the rest: MCP results at 40,000 chars
  (`src/tools.ts:44`, with a Portuguese marker `[… resultado cortado]` that breaks the
  English-to-model rule) and browser snapshots at 30,000 chars (`src/browser.ts:449`). An agent
  cannot reach what was cut, and a 40k result (~10k tokens) is re-sent at every later step.
- **Decision**: one function for both paths: over `COMPACT_AT` (16,000 chars ≈ 4k tokens) the
  agent gets the first `COMPACT_HEAD` (3,000 chars) + a line with the full size and a handle; the
  full text is kept for the turn (in memory, per chat, last 20 results). A new internal tool
  `zorel_read_result` returns a slice by offset or the lines matching a text. ≥5× smaller for every
  result over the limit (16,000 → ≤3,200 with the line).
- **Rationale**: same idea as Mastra's observations and reference apps deferring big payloads,
  without a model call (D0 light first).
- **Alternatives rejected**: summarizing with the cheap model (latency and cost per call, may drop
  the detail the agent needs); writing results to files (the agent's sandbox may not read Zorel's
  data folder).

## R4. Prompt prefix and the provider cache (Story 4)

- **Found**: native sessions (Claude SDK, Codex App Server) already keep the session tied to
  `turn.frame` (no memories) and send `turn.dynamic` (skill bodies, summary, recalled facts) with
  the turn's message (`src/runtime.ts:320`). Sessionless engines do not: `system = stable +
  dynamic` goes first, then the transcript (`src/engines.ts:477`, `:563`, `:577`), so every turn's
  different recall changes the prompt before the transcript and the provider re-reads it uncached.
- **Decision**: sessionless engines receive `stable` first, then the transcript, then the dynamic
  part in a `<context>` block at the end (the same block native sessions use).
- **Test**: two consecutive turns with different recalled facts produce prompts whose text before
  the `<context>` block is identical (prefix check), on every engine path.

## R5. Fewer pinned facts (Story 5)

- **Found**: `MEMORY_BUDGET` = 8,000 chars (`src/context.ts:19`) → 130 facts, ~2k tokens per turn
  at 1,000 memories.
- **Decision**: lower to 4,000 only if R1's total reach without pinning meets SC-001 (≥20/25);
  re-run the benchmark at both budgets and keep the smaller one only if total reach doesn't drop.

## R6. Procedure stored once (Story 6)

- **Found**: the consolidation prompt asks for facts and skills independently; for the procedure
  case Haiku proposed 1 skill + 2 facts restating its steps.
- **Decision**: one rule in the consolidation instructions ("a fact must not restate a skill you
  propose in the same answer") plus a filter after parsing: drop a proposed fact whose words are
  all contained in a skill proposed in the same answer (normalized, stopwords out). Measured with
  the real-model benchmark (15 cases): procedure → 1 skill, 0 restating facts; others unchanged.
