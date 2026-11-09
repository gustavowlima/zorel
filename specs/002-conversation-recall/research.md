# Research: Recall from Past Conversations

Findings from reading the code on 2026-11-08 (`feat/memory-efficiency` at 9c61a92) and ai-memory's
source (MIT, cloned the same day). No open questions remain.

## R1. Searching past messages (Story 1)

- **Found**: `searchMessages` (`src/db.ts:556`) is a `LIKE '%q%'` scan over every message, newest
  first, with no scope; only the app's search box uses it (`src/main.ts:371`). Messages are inserted
  once and never have their text updated (only `revertedAt`), and deleted by cascade with their chat.
  The project already keeps FTS5 indexes by triggers (`memory_index`, `page_index`, `entity_index`,
  e.g. `drizzle/20261105230802_entity_index/migration.sql`).
- **Decision**: a `message_index` FTS5 table (`id UNINDEXED, body`, `unicode61 remove_diacritics 2`,
  like `memory_index`) kept by insert/delete triggers, filled from existing rows in the same
  migration. A store read `recallMessages(projectId | null, query, exclude, limit)` matches with
  `ftsQuery` (stopwords out, as for facts), joins `chats` on the same project (or no project), skips
  the current chat's messages after its `summaryUntil` (they are in the window), orders by bm25, and
  returns the excerpt from FTS5's own `snippet()` (about 32 tokens around the matches), with chat
  title, role, agent and time. 5 per turn.
- **Guards**: excerpts holding a credential are dropped (`hasCredential`, measured 0.27 ms per
  300-char excerpt); an excerpt containing a forgotten fact's normalized text is dropped; an excerpt
  that says the same as a recalled fact (`similar`, Jaccard ≥ 0.6) is dropped.
- **Rationale**: ai-memory's observation stream (raw turns voting for their session) took zero-model
  hit@5 on LongMemEval-S from 0.662 to 0.951. Zorel already stores the turns; only the index and the
  read are missing. `snippet()` is native, no excerpt code to write.
- **Alternatives rejected**: the existing LIKE scan (no ranking, no scope, full scan); recalling
  whole messages (a pasted log would fill the budget); only the person's lines (decisions are often
  stated by the agent and confirmed with "yes").

## R2. Fused ranking (Story 2)

- **Found**: `recall` (`src/chat.ts:46`) returns map association (best 5) then facts by words (5),
  concatenated, cut at 2,000 characters. A fact found by both counts once, in the map's place.
- **Decision**: reciprocal rank fusion, `score = Σ 1/(60 + rank)` over the three lists (map, facts by
  words, messages), k = 60 as ai-memory and the RRF paper use. Ties: a fact before an excerpt
  (approved, shorter). The budget is filled in fused order, as today. `recall` returns facts and
  excerpts separately (both in fused order) for the prompt, and the fused list (with source ids) for
  the benchmarks.
- **Check**: the recall bench (`--check`) keeps same-words reach 25/25 and paraphrased reach without
  pin ≥ 6 (`PARA_FLOOR`); a unit test shows a two-source fact outranks a one-source fact.
- **Alternatives rejected**: score normalization and weighted sums (bm25 and PageRank scales differ;
  RRF needs only ranks).

## R3. Untrusted recalled content (Story 3)

- **Found**: the dynamic part (skill bodies, summary, recalled memories) is built in `buildTurn`
  (`src/context.ts` ~205–212) and wrapped as `<context>…</context>` in two places: native sessions
  (`src/runtime.ts:320`) and sessionless engines (`sessionless`, `src/engines.ts`). Nothing escapes a
  `</context>` inside a memory, and nothing tells the agent it is data.
- **Decision**: the recalled section opens with one sentence (contract below). The closing marker is
  neutralized once, in `buildTurn`, on the whole dynamic string (`</context` → `<\/context`), so both
  wrappers are covered and no recalled text can end the block. Nothing is added when nothing is
  recalled.
- **Rationale**: same notice idea as ai-memory's `UNTRUSTED_MEMORY_NOTICE`; one place to escape.

## R4. LongMemEval-S harness (Story 4)

- **Dataset**: `https://huggingface.co/datasets/xiaowu0162/longmemeval/resolve/main/longmemeval_s`
  (MIT), sha256 `08d8dad4be43ee2049a22ff5674eb86725d0ce5ff434cde2627e5e8e7e117894` (the file
  ai-memory pins for every published number). Downloaded on first run to
  `<home>/.cache/zorel/longmemeval_s.json` (`os.homedir()`, so the same on Windows, macOS and Linux),
  checked against the hash, never in the repository.
- **Shape**: 500 questions; each has `haystack_sessions` (about 50 sessions of user/assistant turns),
  `haystack_session_ids`, `answer_session_ids`, `question`, `question_type`. Questions whose id ends
  in `_abs` (30) have a false premise and are excluded from hit@k, as ai-memory does → 470 scored.
- **Method**: per question, a fresh database: one project, one chat per haystack session (messages in
  order), then a new chat in the project with the question; run `recall` and map each recalled
  excerpt to its chat → session id; distinct sessions in fused order; hit@k = an answer session among
  the first k (k = 5, 10), the same definition as ai-memory's `score_question`. Also reported: whether
  an answer session reaches the turn within the 2,000-character budget, and p50 recall latency.
  Options: `--limit N`, `--types a,b`.
- **Baseline**: before Story 1, Zorel's recall cannot see conversations and the benchmark has no
  consolidation (no model), so it scores 0 by construction; the harness records that, and the
  meaningful number is after Story 1, next to ai-memory's 0.951 (FTS + observation stream).
- **Alternatives rejected**: consolidating each session with the model first (500 × 50 model calls;
  out of scope); committing a sample of the dataset (licence allows it, but size and churn don't).
