# Feature Specification: Recall by Meaning with a Local Model

**Feature Branch**: `feat/memory-efficiency`

**Created**: 2026-11-08

**Status**: Draft

**Input**: User decision (2026-11-08): "Modelo dentro do app" — embeddings computed on the person's computer by a small model shipped with Zorel, to close the paraphrase gap left by specs 001 and 002.

## Baseline

| What | Today |
|---|---|
| Paraphrased question reaching its fact without pinning (recall bench, 1,000 memories) | 15/25 (map 15, words 0) |
| Same-words reach | 25/25 |
| LongMemEval-S hit@5 (zero model, conversation recall) | 0.940 |
| Turn preparation at 1,000 memories | p50 ~4.5 ms, p95 ~7 ms |
| Recall sources | map, facts by words, past messages |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A question in other words finds the fact (Priority: P1) 🎯 MVP

The person said "I'm allergic to penicillin" weeks ago. Today they ask "which antibiotic can't I take?". No word matches and the map may not link "antibiotic" to it. With this story the turn also compares the meaning of the question with the meaning of each kept fact, on the person's own computer, and the fact comes back.

**Why this priority**: it is the gap the last two specs measured and couldn't close without it (15/25).

**Independent Test**: recall bench with the meaning source on: paraphrased reach without pinning ≥ 20/25; same-words 25/25; no leaks.

**Acceptance Scenarios**:

1. **Given** a fact and a question that shares no word with it, **When** the turn is prepared, **Then** the fact can be recalled by meaning.
2. **Given** a fact of another project or another person, **When** the turn is prepared, **Then** it is never recalled by meaning.
3. **Given** the model is not available (not downloaded yet, offline, failed to load), **When** a turn is prepared, **Then** recall works as today, without delay or error.

### User Story 2 - It ships and runs on every system (Priority: P2)

The desktop app carries what the model needs to run on Windows, macOS and Linux; the model itself is downloaded once on first use, in the background, to Zorel's data folder.

**Independent Test**: the packaged server (compiled binary) computes a vector with the runtime shipped next to it; a missing runtime or model leaves recall as today.

**Acceptance Scenarios**:

1. **Given** a fresh install with network, **When** Zorel starts, **Then** the model downloads in the background and recall by meaning starts working without a restart.
2. **Given** no network, **When** Zorel starts, **Then** it works as before and tries again on the next start.

### Edge Cases

- A fact edited or replaced: its meaning is computed again from the new text; the old one is never used.
- Thousands of facts: computing their meaning happens in the background after start, never inside a turn.
- A forgotten or pending fact: never recalled by meaning (same rules as the other sources).

## Requirements *(mandatory)*

- **FR-001**: Recall MUST add a meaning source over the active facts of the turn's scopes and owner, fused with the others by rank.
- **FR-002**: Meaning MUST be computed on the person's computer; no text leaves it for this.
- **FR-003**: A turn MUST NOT wait for the model to load or for facts to be processed; missing meaning means that source contributes nothing.
- **FR-004**: The meaning of a fact MUST follow its current text.
- **FR-005**: The model MUST be downloaded on first use to Zorel's data folder, never committed, and its absence MUST NOT break anything.
- **FR-006**: The packaged app MUST run the model on Windows, macOS and Linux with the runtime shipped for that system only.

## Success Criteria *(mandatory)*

- **SC-001**: Recall bench at 1,000 memories: paraphrased reach without pinning ≥ 20/25 (from 15/25); same-words 25/25; 0 leaks.
- **SC-002**: Turn preparation p95 at 1,000 memories ≤ 2× today's (≤ 15 ms).
- **SC-003**: With the model absent, every existing test and benchmark result is unchanged.
- **SC-004**: The compiled server computes a vector using the runtime shipped beside it (checked by hand on the build machine).
- **SC-005**: LongMemEval-S hit@5 does not drop below 0.940.

## Assumptions

- Model: `all-MiniLM-L6-v2` (384 dimensions, 8-bit, ~23 MB), the one ai-memory ships; runtime: ONNX via `@huggingface/transformers` (measured 2026-11-08 in Bun: 1.3 ms per question, load 0.1–5 s).
- Vectors are kept in memory and recomputed after each start (≈ 1.3 ms per fact; 1,000 facts ≈ 1.3 s in the background). A stored copy comes only if start-up time at large scale asks for it.
- Only facts get a meaning source in this spec; past messages keep their word search (LongMemEval-S is already at 0.940 without it).
- App size grows by the ONNX runtime of one system (~85 MB macOS arm64, ~64 MB Windows x64, ~44 MB Linux x64) plus the model on first use; accepted by the person when choosing this path.
