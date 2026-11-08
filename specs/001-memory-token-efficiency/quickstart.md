# Quickstart: validating this feature

Run from `apps/server`. Each story has its own check; all must pass before the feature is done.

## Prerequisites

- Bun installed, `bun install` done at the repo root.
- For Story 6 (and to refresh the Story 1 fixture): Claude Code signed in (the benchmark uses
  `claude-cli/haiku`; ~15 small calls).

## Always

```bash
bun test                                   # every existing test green (SC-007)
bun bench/memory-recall.bench.ts 1000 --check
```

## Story 1 — recall through the map

```bash
bun bench/memory-recall.bench.ts 1000
```

Expected: a `para` block with `reach by map`, `by words`, `by pin`, `total`. SC-001: `total without
pin` ≥ 20/25. `--check` fails below the recorded floor and on any leak.

## Story 2 — same fact not stored twice

Same run, `Dedupe` block: ≥ 8/11 same-meaning variants `merged`, `reversed meaning` `kept both`,
the cross-owner pair kept (SC-002). Unit tests in `src/db.test.ts` cover numbers, negations,
forgotten facts and other scopes.

## Story 3 — large results

```bash
bun test src/engines.test.ts src/browser.test.ts
```

Expected: a 48k-character result comes back ≤ 3,200 characters with the handle line; reading by
offset and by `find` returns the cut part; a result under 16,000 characters is unchanged (SC-003).

## Story 4 — stable prefix

```bash
bun test src/engines.test.ts
```

Expected: for each sessionless engine path, two turns with different recalled facts produce prompts
identical up to the `<context>` block (SC-004). On a real chat, Usage shows the cached share of
consecutive turns ≥ 96%.

## Story 5 — fewer pinned facts (only if Story 1 passed)

```bash
bun bench/memory-recall.bench.ts 1000
```

Expected: `memory layer chars in prompt` ≤ ~4,000 (≈1k tokens) and total reach not below Story 1's
number (SC-005). If Story 1 failed, the budget stays and the gap is written in
`docs/ARCHITECTURE.md` as the entry criterion for embeddings.

## Story 6 — procedure stored once

```bash
bun bench/memory-consolidation.bench.ts claude-cli/haiku
```

Expected: `procedure` → 1 skill, 0 facts restating it; totals still `learned 11/11, false 0,
secrets leaked 0/2` (SC-006).

## Recording

Each story writes its before/after numbers in `docs/ARCHITECTURE.md` §8 and
`.agent/memory/server.md` (FR-009).

## Before

Measured 2026-11-08 on `feat/memory-efficiency` at 111a798 (`bun bench/memory-recall.bench.ts 1000`;
`bun test`: 246 pass, 0 fail).

| metric | 1000 |
|---|---|
| prepare() p50 / p95 ms | 1.94 / 4.89 |
| pinned memories / chars | 130 / 7970 |
| needles pinned (recency) | 17/25 |
| lex: FTS recall@5 | 8/25 |
| para: FTS recall@5 | 0/25 |
| para: reaches the prompt (pinned or retrieved) | 17/25 |
| memory layer chars in prompt avg | 8284 (~2071 tok) |
| scope/state/owner leaks | 0 |

Dedupe: 5/11 same-meaning variants merged (case+punct, whitespace+hyphen, punct, diacritics,
diacritics in token); kept apart: abbreviation, reworded, dropped article, synonym, plural,
third-person rewrite; reversed meaning kept (correct).
