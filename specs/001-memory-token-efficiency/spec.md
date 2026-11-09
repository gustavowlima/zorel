# Feature Specification: Memory Robustness and Token Efficiency, Measured

**Feature Branch**: `feat/memory-efficiency`

**Created**: 2026-11-08

**Status**: Draft

**Input**: User description: "Memory robustness and token efficiency, measured. Goal: Zorel must be cheaper and more efficient than using Claude Code/Codex directly while keeping memory correct. Prioritized stories, each with a before/after number: P1 measure recall through the entity map at scale; P2 merge near-duplicate memories on insert without a model call; P3 compress large outputs of Zorel's own tools; P4 keep the prompt prefix stable so per-turn recall does not break the prompt cache; P5 pin fewer memories per turn when recall carries the rest; P6 consolidation does not store as facts what it already stored as a skill. Out of scope: embeddings, hosted, UI redesign."

## Context and Baseline (2026-11-08)

The person pays for every token Zorel sends to a model, on their own subscription or key. Zorel
must cost less than using the same CLI directly, without forgetting or mixing up what it learned.

| Measure | Baseline |
|---|---|
| Smallest turn, the CLI alone with the person's setup | 37.8k input tokens |
| Smallest turn through Zorel | 14.6k input tokens |
| Typical Zorel turn (median, all steps summed) | 368k input tokens, 20k of them not cached |
| Share of input served from the provider's cache | 96.4% |
| Paraphrased question → fact found by its words, 1,000 memories | 0/25 |
| Paraphrased question → fact reaches the prompt at all | 17/25, only because it was pinned |
| Recall through the map at that scale | not measured (benchmark facts have no map) |
| Same-meaning variants merged on save | 5/11 (case, punctuation, spaces, accents); 0/1 false merges |
| Memory layer in every turn, 1,000 memories | ~2k tokens (130 pinned facts) |
| A procedure learned from a chat | stored as 1 skill + 2 facts repeating it |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Know whether the map finds facts asked in other words (Priority: P1)

The person asks something in words that don't match how the fact was stored ("what car do I
own?" for "Drives a 2019 Civic"). Zorel's map of what facts are about should bring the fact into
the turn. Today nobody knows how well it does at scale, so every later trade-off is a guess.

**Why this priority**: P5 (pinning fewer facts) is only safe if recall holds, and the decision on
embeddings depends on this number. It changes no behavior, so it is risk-free.

**Independent Test**: Run the recall benchmark at 1,000 memories with map data on the facts and
read the recall figure for paraphrased questions, with and without the map.

**Acceptance Scenarios**:

1. **Given** 1,000 facts with their map points and relations, **When** the 25 paraphrased
   questions are asked, **Then** the benchmark reports how many reach the turn through the map,
   through words, through pinning, and in total.
2. **Given** the same run, **When** the check mode runs in CI, **Then** it fails if map recall
   drops below the recorded value.

---

### User Story 2 - The same fact is not stored twice (Priority: P2)

The person, an agent's own note or a manual edit says the same thing in a slightly different
spelling ("uses VS Code" / "Uses VSCode"). Zorel keeps one fact, not two that both cost tokens.

**Why this priority**: duplicates grow the memory layer and the review queue; merging happens at
save time with no model call, so it is cheap.

**Independent Test**: Save the benchmark's near-duplicate pairs and count merges and false merges.

**Acceptance Scenarios**:

1. **Given** a saved fact, **When** a variant differing only in spelling, accents, plural,
   article or abbreviation is saved in the same scope and owner, **Then** it confirms the existing
   fact instead of adding a new one.
2. **Given** a saved fact, **When** a sentence with the opposite meaning is saved, **Then** both
   are kept.
3. **Given** a fact saved for one owner or scope, **When** a variant arrives for another, **Then**
   both are kept.

---

### User Story 3 - Large tool results don't flood the conversation (Priority: P3)

An agent opens a web page or calls a connector that returns a huge result (a page snapshot, a long
listing). Zorel hands the agent a compact version and keeps the full result available, so the next
steps of the turn don't carry tens of thousands of tokens each.

**Why this priority**: the typical turn's cost comes from steps re-sending context; a single large
result is re-sent at every later step.

**Independent Test**: Replay recorded large outputs of Zorel's own tools and compare sizes before
and after; ask the agent for a detail only present in the full result.

**Acceptance Scenarios**:

1. **Given** a tool result over the size limit, **When** it returns to the agent, **Then** the
   agent receives a compact version that says it was shortened and how to get the rest.
2. **Given** a compacted result, **When** the agent asks for the full content or a part of it,
   **Then** it gets that content in the same turn.
3. **Given** a result under the limit, **When** it returns, **Then** it is passed unchanged.

---

### User Story 4 - Recall does not break the provider's cache (Priority: P4)

Each turn brings different recalled facts. If they sit before the stable part of the prompt, the
provider re-reads everything after them at full price. Zorel keeps the stable part first so it
stays cached across turns.

**Why this priority**: the cache serves 96.4% of input today; any drop is paid at full price.

**Independent Test**: Run two consecutive turns in one session with different recalled facts and
compare the shared prompt prefix and the cached share.

**Acceptance Scenarios**:

1. **Given** an open session, **When** the next turn recalls different facts, **Then** the part of
   the prompt sent before them is identical to the previous turn's.
2. **Given** the same scenario, **When** the turn finishes, **Then** the cached share of its input
   is not lower than the baseline.

---

### User Story 5 - Fewer facts ride along in every turn (Priority: P5)

With recall finding what each turn needs, Zorel pins fewer facts by default and lets recall bring
the rest, so every turn costs less.

**Why this priority**: the memory layer is paid on every turn, but cutting it is only safe after
Story 1 shows recall holds.

**Independent Test**: Run the recall benchmark with the smaller pin budget and compare the memory
layer size and total reach against Story 1's numbers.

**Acceptance Scenarios**:

1. **Given** Story 1's recall figure meets its target, **When** the pin budget is reduced,
   **Then** the memory layer per turn shrinks and the share of planted facts that reach the turn
   does not drop.
2. **Given** Story 1's figure misses its target, **Then** this story is not shipped and the gap is
   recorded as the entry criterion for embeddings.

---

### User Story 6 - A learned procedure is stored once (Priority: P6)

When a chat teaches Zorel how to do something, it keeps it as one skill, not a skill plus facts that
repeat its steps.

**Why this priority**: small, but every repeated fact is paid on every turn it is pinned.

**Independent Test**: Run the consolidation benchmark's procedure case with the real model.

**Acceptance Scenarios**:

1. **Given** a conversation that explains a procedure, **When** it is consolidated, **Then** a
   skill is proposed and no fact restates its steps.
2. **Given** a conversation with a procedure and an unrelated fact, **When** it is consolidated,
   **Then** both the skill and the unrelated fact are kept.

---

### Edge Cases

- Two facts that differ only by a number or a negation ("deploys on Fridays" / "never deploys on
  Fridays") are never merged.
- A forgotten fact is not revived by a near-duplicate; the new one is treated as new.
- A compacted result whose full version is no longer available tells the agent so instead of
  returning nothing.
- A turn with no recalled facts, and a turn whose session was just reopened, still work.
- A memory with no map points (written before the map existed) is still found by its words.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The recall benchmark MUST give its facts map points and relations and report, for
  paraphrased questions, reach through the map, through words, through pinning and in total.
- **FR-002**: The benchmark's check mode MUST fail when map recall or total reach falls below the
  recorded values, or when any scope or owner leak appears.
- **FR-003**: Saving a fact MUST merge it with an existing active fact of the same scope and owner
  when they differ only in spelling, accents, plural, articles or abbreviation, without a model
  call; the existing fact is confirmed and the save reports it.
- **FR-004**: Merging MUST NOT happen across scopes or owners, with forgotten facts, or when the
  two differ in a number or a negation.
- **FR-005**: Results of Zorel's own tools larger than a size limit MUST reach the agent compacted,
  marked as compacted, with a way to read the full result or a part of it in the same turn.
- **FR-006**: Recalled facts MUST be placed after the part of the prompt that stays the same
  between turns of a session.
- **FR-007**: The default pin budget MAY be reduced only if FR-001's measured recall meets SC-001;
  otherwise it stays and the gap is recorded.
- **FR-008**: Consolidation MUST NOT propose facts that restate a skill proposed or stored from
  the same evidence.
- **FR-009**: Every story MUST record its before and after numbers in the project's architecture
  notes when it ships.

### Key Entities

- **Fact (memory)**: a short statement with a scope (person, project, agent), an owner and a state
  (pending, active, forgotten); may mention map points.
- **Map point and relation**: what facts are about and how those things connect.
- **Skill**: a stored procedure an agent can follow.
- **Compacted result**: the short form of a large tool result, with a handle to the full one.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At 1,000 memories, at least 20 of 25 paraphrased questions reach the turn without
  relying on pinning (baseline 0/25 by words; map not measured).
- **SC-002**: At least 8 of the 11 same-meaning variants in the benchmark are merged (adds dropped
  article, plural, third-person rewrite), with 0 merges of opposite meanings and 0 across scopes or
  owners (baseline 5/11).
- **SC-003**: Tool results over the limit reach the agent at least 5 times smaller, and the agent
  still answers a question whose answer is only in the full result.
- **SC-004**: The cached share of input in consecutive turns of a session stays at or above 96%.
- **SC-005**: If shipped, the memory layer per turn at 1,000 memories drops from ~2k to 1k tokens
  or less, with total reach not lower than SC-001's measured value.
- **SC-006**: The procedure case yields 1 skill and 0 facts restating it; all other consolidation
  cases keep their current results (11/11 learned, 0 false, 0 secrets).
- **SC-007**: No regression: all existing tests and both memory benchmarks pass, and the leak
  count stays at 0.

## Assumptions

- "Same meaning" for merging is limited to spelling-level variants; synonyms and rewordings are
  left to consolidation, which already sees existing facts.
- The size limit for compacting tool results starts at about 8k tokens and is tuned by measurement.
- Compaction applies only to tools Zorel runs itself (its browser and connectors through its
  gateway); the CLIs' native tools are outside Zorel's control.
- Comparing whole tasks against the CLI alone is a separate feature; this one uses the benchmarks
  and recorded turns.
- Embeddings stay out unless SC-001 is missed (constitution: light first).
