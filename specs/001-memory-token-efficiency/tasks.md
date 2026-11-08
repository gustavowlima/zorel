# Tasks: Memory Robustness and Token Efficiency, Measured

**Input**: Design documents from `/specs/001-memory-token-efficiency/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/agent-tools.md, quickstart.md

**Tests**: included. The spec makes every story a before/after number, and the constitution requires
`bun run test` green; each story leaves one runnable check (a unit test or a benchmark line).

**Paths**: relative to the repo root. Server code in `apps/server/src/`, benchmarks in
`apps/server/bench/`. Run commands from `apps/server`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US6 = spec stories P1–P6

---

## Phase 1: Setup

- [X] T001 Record the "before" numbers: run `bun bench/memory-recall.bench.ts 1000` and `bun test` from `apps/server`, and paste the Part 1 table and the Dedupe block into a `## Before` section at the end of `specs/001-memory-token-efficiency/quickstart.md`

---

## Phase 2: Foundational

No shared prerequisite: each story touches its own files. Stories can start after T001.

---

## Phase 3: User Story 1 - Recall through the map at scale (Priority: P1) 🎯 MVP

**Goal**: the recall benchmark files its facts on the map and reports reach by map, by words, by pin and in total for paraphrased questions.

**Independent Test**: `bun bench/memory-recall.bench.ts 1000` prints the four reach lines; `--check` fails below the recorded floor.

- [X] T002 [US1] Add `bench/extract-needle-map.ts` in `apps/server/bench/`: for the 25 `NEEDLES` (export them from `apps/server/bench/memory-recall.bench.ts`), call the app's own map extraction (`MAP_SYSTEM` + `parseMapItems` from `apps/server/src/chat.ts`, same model choice as `mapEarlierFacts`) and write `{ text, entities, relations }[]` to `apps/server/bench/fixtures/needle-map.json`; run it once and commit the fixture (never at bench time)
- [X] T003 [US1] In `apps/server/bench/memory-recall.bench.ts`, make `noiseFact` return `{ text, topics }` with the list words it picked (`W.lang`, `W.tool`, `W.style`, `W.day`) and file every noise fact with `r.linkMemory(id, scope, { entities: topics.map(name => ({ name, type: "concept" })), relations: [] })`
- [X] T004 [US1] In `apps/server/bench/memory-recall.bench.ts`, file each needle with `r.linkMemory` using its entry in `fixtures/needle-map.json` (fail loudly if a needle has no entry)
- [X] T005 [US1] In `apps/server/bench/memory-recall.bench.ts`, for each paraphrased query classify how the needle reached the turn: `map` (in `recall()`'s association part), `words` (FTS part), `pin` (pinned only), `none`; print rows `para: reach by map`, `by words`, `by pin`, `total without pin`, `total`, and list the misses with what came first
- [X] T006 [US1] In `apps/server/bench/memory-recall.bench.ts` `--check`, fail when `total without pin` at 1,000 is below a `PARA_FLOOR` constant set to the measured value, keeping the existing leak and budget checks
- [X] T007 [US1] Record the result: the four numbers and whether SC-001 (≥ 20/25 without pin) is met in `docs/ARCHITECTURE.md` §8 (after the A4.3 paragraph) and `.agent/memory/server.md`

**Checkpoint**: the map's recall is a number in CI. It decides US5.

---

## Phase 4: User Story 2 - The same fact is not stored twice (Priority: P2)

**Goal**: spelling-level variants (dropped article, plural, third-person subject) confirm the existing fact instead of adding one.

**Independent Test**: Dedupe block shows ≥ 8/11 merged, reversed meaning kept; db tests green.

- [X] T008 [P] [US2] Add `canonical(text)` next to `normalize` in `apps/server/src/db.ts`: normalized words in order, minus articles/possessives (`the a an their his her my its`, `o a os as um uma meu minha seu sua`), a leading `the user` / `user` / `the person` / `a pessoa`, and a trailing `s` on words of 4+ letters
- [X] T009 [US2] In `addMemory` (`apps/server/src/db.ts`), before the insert: load the active facts of the same scope and owner and kind, and if one has the same `canonical` key, bump its `confirmedAt` and return `undefined` (as the exact-duplicate path does); `ponytail:` comment on the scan (add an indexed column past ~10k facts per scope)
- [X] T010 [US2] Tests in `apps/server/src/db.test.ts`: dropped article, plural and "The user uses…" merge; "Prefers TypeScript over JavaScript" vs the reverse, "deploys on Fridays" vs "never deploys on Fridays", "port 8080" vs "port 8081", another owner, another scope and a forgotten fact all stay separate
- [X] T011 [US2] Run the recall bench, check the Dedupe block (≥ 8/11, reversed kept) and record before/after in `docs/ARCHITECTURE.md` §8 and `.agent/memory/server.md`

**Checkpoint**: duplicates by spelling are gone; meaning-level ones stay with consolidation.

---

## Phase 5: User Story 3 - Large tool results don't flood the conversation (Priority: P3)

**Goal**: results of Zorel's own tools over 16,000 characters reach the agent as the first 3,000 plus a handle; the rest is readable with `zorel_read_result`.

**Independent Test**: unit tests show a 48k result returned ≤ 3,200 chars with the handle line, the rest readable by offset and by `find`, and small results unchanged.

- [X] T012 [P] [US3] In `apps/server/src/tools.ts`: add `COMPACT_AT = 16_000`, `COMPACT_HEAD = 3_000`, a per-chat store of the last 20 full results (`Map<chatId, {id, text}[]>`, ids `r1`, `r2`…), `compact(chatId, text)` returning the text unchanged or head + the English line from `contracts/agent-tools.md`, and `readResult(chatId, {id, offset, length, find})`; change the `resultText` marker to English (`[… result cut]`)
- [X] T013 [P] [US3] Define `READ_RESULT_TOOL` (`zorel_read_result`, inputs per `contracts/agent-tools.md`, class read) in `apps/server/src/team.ts` next to `REMEMBER_TOOL`
- [X] T014 [US3] In `apps/server/src/runtime.ts` tool `call`: pass the text content of every MCP and browser result through `compact(chat.id, …)` before returning it to the agent (the step shown in the app keeps `resultText`), handle `READ_RESULT_TOOL` with `readResult`, add it to the tool list at line ~422, and keep it out of the list while the chat has no shortened result (same rule as `idleTools`)
- [X] T015 [US3] In `apps/server/src/browser.ts`, drop the 30,000-char cut of `browser_snapshot` (compaction now applies) and remove `MAX_SNAPSHOT_CHARS` if nothing else uses it
- [X] T016 [US3] Tests in `apps/server/src/engines.test.ts` (or a new `apps/server/src/tools.test.ts` if they don't fit there): 48,000-char result → ≤ 3,200 chars with handle; `offset` and `find` return the cut part; unknown id and offset past the end return the contract's tool errors; a 15,000-char result is unchanged; another chat cannot read the handle
- [X] T017 [US3] Record before/after (largest result sizes, ratio) in `docs/ARCHITECTURE.md` §8 and `.agent/memory/server.md`

**Checkpoint**: no tool result of Zorel's own carries more than ~4k tokens into later steps.

---

## Phase 6: User Story 4 - Recall does not break the provider's cache (Priority: P4)

**Goal**: sessionless engines send the stable part, then the transcript, then the `<context>` block, so the prefix stays the same between turns.

**Independent Test**: two turns with different recalled facts produce prompts identical up to `<context>` on every sessionless path.

- [X] T018 [US4] In `apps/server/src/engines.ts`, sessionless paths (`--system-prompt` CLI at ~line 301, Codex `developer_instructions` at ~369, effect/ai `Prompt.make` at ~477, ACP `prompt:` at ~563 and ~577): use `turn.stable` (fallback `system`) as the system part and append `turn.dynamic` as a `<context>…</context>` block after the transcript (in the last user message for `Prompt.make`); native sessions unchanged
- [X] T019 [US4] Test in `apps/server/src/engines.test.ts`: build two turns with `buildTurn` differing only in `retrieved`; for each sessionless path the rendered prompt is identical up to `<context>` and differs after it
- [X] T020 [US4] Record the change and the prefix test in `docs/ARCHITECTURE.md` §7 (context) and `.agent/memory/server.md`

**Checkpoint**: per-turn recall never sits before cached content.

---

## Phase 7: User Story 6 - A learned procedure is stored once (Priority: P6)

**Goal**: consolidation proposes a skill without facts restating it.

**Independent Test**: consolidation bench `procedure` case → 1 skill, 0 restating facts; totals unchanged.

- [X] T021 [P] [US6] Add the rule "A fact must not restate a skill you propose in the same answer" to `CONSOLIDATION_SYSTEM` in `apps/server/src/context.ts`
- [X] T022 [US6] After `parseConsolidation` in `apps/server/src/context.ts`, drop a proposed fact whose content words (normalized, stopwords out) are all contained in a skill proposed in the same answer; unit test for it in `apps/server/src/engines.test.ts` (or wherever `parseConsolidation` is already tested: `grep -rn parseConsolidation apps/server/src/*.test.ts`)
- [X] T023 [US6] Run `bun bench/memory-consolidation.bench.ts claude-cli/haiku`; expect procedure → 1 skill, 0 restating facts and `learned 11/11, false 0, secrets leaked 0/2`; record in `docs/ARCHITECTURE.md` §8 and `.agent/memory/server.md`

---

## Phase 8: User Story 5 - Fewer facts ride along in every turn (Priority: P5)

**Goal**: halve the pin budget if, and only if, US1 showed recall holds.

**Depends on**: T007 (US1 result). If SC-001 was missed, do only T026. **US1 result: missed (6/25) → only T026.**

- [ ] T024 (skipped: US1 missed SC-001) [US5] In `apps/server/src/context.ts`, set `MEMORY_BUDGET` to 4,000 (from 8,000)
- [ ] T025 (skipped: US1 missed SC-001) [US5] Run the recall bench at 1,000; keep the change only if `memory layer chars in prompt` ≤ ~4,000 and `total` reach is not below the 8,000-budget run; otherwise revert T024
- [X] T026 [US5] Record the outcome in `docs/ARCHITECTURE.md` §8 and `.agent/memory/server.md`; if SC-001 was missed or T025 reverted, write the gap as the entry criterion for embeddings

---

## Phase 9: Polish & Cross-Cutting

- [X] T029 [US1] Bring `prepare()` back under 5 ms p95 at 1,000 mapped memories: `linksAmong` (`apps/server/src/db.ts`) co-mention self-join costs ~16 ms (found by T005)
- [ ] T027 Run `bun run test`, `bun run typecheck`, `bun run lint` from the repo root and `bun bench/memory-recall.bench.ts 1000 --check` from `apps/server`; all green
- [ ] T028 Add a `## After` table next to `## Before` in `specs/001-memory-token-efficiency/quickstart.md` with every SC's before/after number, and append a line per changed rule to `.agent/memory/changelog/server.md`

---

## Dependencies & Execution Order

- **T001** first (baseline).
- **US1 (T002–T007)**: T002 → T004; T003 independent of T002; T005 → T006 → T007.
- **US2, US3, US4, US6**: independent of each other and of US1; any order after T001.
- **US5 (T024–T026)**: after T007.
- **Polish (T027–T028)**: last.

Story order by value: US1 → US3 → US4 → US2 → US6 → US5 (US3 and US4 save the most tokens).

## Parallel Opportunities

- After T001: T002, T003, T008, T012, T013, T021 touch different files and can start together.
- Inside US3: T012 (`tools.ts`) and T013 (`team.ts`) in parallel, then T014 (`runtime.ts`).
- US4's T018 (`engines.ts`) can run alongside US2 (`db.ts`) and US6 (`context.ts`), but T022 and T024 both edit `context.ts`: not at the same time.

## Implementation Strategy

1. **MVP = US1**: the map's recall becomes a measured number; it changes no behavior and decides US5 and embeddings.
2. Then the token savers: US3 (large results) and US4 (cache prefix).
3. Then the correctness/cleanliness wins: US2 (duplicates), US6 (procedure once).
4. US5 last, gated by US1.
5. Commit after each story with its numbers recorded; stop at any checkpoint to validate.
