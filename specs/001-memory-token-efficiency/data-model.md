# Data Model: Memory Robustness and Token Efficiency

No table or migration changes. Everything below is derived at runtime or lives in memory.

## Fact (memory) — existing, `memories` table

| Field | Use in this feature |
|---|---|
| `scope`, `owner` | merging only happens inside the same pair (FR-004) |
| `state` | only `active` facts are compared; `forgotten` ones are never revived |
| `normalized` | existing exact key (case, accents, punctuation, spaces) |
| `confirmedAt` | bumped when a variant merges into the fact (ranks it first for the pin budget) |
| `kind` | `fact` vs `skill`: Story 6 drops facts restating a skill from the same answer |

**Derived key `canonical(text)`** (not stored): `normalized` words in order, minus articles,
possessives and a leading subject (`the user`, `user`, `the person`), trailing plural `s` removed on
words of 4+ letters. Equal canonical keys in the same scope + owner = same fact.

## Map point and relation — existing (`entities`, `memory_entities`, `relations`)

Unchanged. The benchmark files facts on them through `linkMemory`, using a frozen real extraction
for the 25 needles and template words for the noise.

## Compacted result — new, in memory only

| Field | Meaning |
|---|---|
| `id` | short handle shown to the agent (`r1`, `r2`… per chat) |
| `chatId` | results are only readable from the chat that produced them |
| `text` | the full result |
| `at` | when it was kept; the newest 20 per chat stay, older ones drop |

Lifecycle: created when one of Zorel's own tools returns more than `COMPACT_AT` characters; read by
`zorel_read_result`; dropped when 20 newer ones exist in the chat or the server restarts (then the
tool answers that the full result is no longer available).

## Turn context — existing (`buildTurn` output)

`stable` / `frame` / `dynamic` keep their meaning. Change: sessionless engines place `dynamic` after
the transcript instead of inside the system part, matching native sessions.
