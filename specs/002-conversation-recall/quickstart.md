# Quickstart: validating this feature

Run from `apps/server`.

## Always

```bash
bun test                                   # every test green (SC-007)
bun bench/memory-recall.bench.ts 1000 --check
```

## Story 1 — other chats

```bash
bun test src/db.test.ts
```

Expected: a fact said only in an earlier chat of the same project is recalled as an excerpt for ≥ 9
of 10 same-word questions; 0 of 10 from another project; the current window is never recalled; an
excerpt with a credential or a forgotten fact is dropped (SC-001).

## Story 2 — fused ranking

```bash
bun bench/memory-recall.bench.ts 1000 --check
```

Expected: same-words reach 25/25, paraphrased reach without pin ≥ 6/25, prepare p95 ≤ 17.4 ms
(SC-002, SC-005); unit test: a two-source fact outranks a one-source fact.

## Story 3 — untrusted

```bash
bun test src/engines.test.ts
```

Expected: the notice opens the recalled section only when something was recalled; a memory holding
`</context>` plus an instruction leaves exactly one closing tag, at the end, in both prompt paths
(SC-003).

## Story 4 — LongMemEval-S

```bash
bun bench/longmemeval.bench.ts            # downloads ~/.cache/zorel/longmemeval_s.json once
bun bench/longmemeval.bench.ts --limit 50 # quick look
```

Expected: hit@5, hit@10, in-turn reach and latency, overall and by type; first run before Story 1,
last after Stories 1–3, both recorded next to ai-memory's 0.951 (SC-004).

## Before

Measured 2026-11-08 at 9e62b93 (code unchanged since), `bun bench/memory-recall.bench.ts 1000`:
lex reach 25/25 (FTS hit@5 8/25); para reach without pin 6/25 (map 6, words 0), total 20/25;
`prepare()` p50 4.32 ms, p95 8.69 ms. `bun test` (apps/server): 250 pass, 0 fail.

LongMemEval-S before (`bun bench/longmemeval.bench.ts`, all 470 scored, 30 abstention skipped):
hit@5 0.000, hit@10 0.000, in-turn 0.000 on every type, as expected by construction (recall can't
see conversations; the benchmark runs no consolidation). ai-memory 3.4.3: hit@5 0.951.

## After

Measured 2026-11-08 at the end of spec 002. `bun run test`: 317 pass, 0 fail; typecheck ok; lint ok
(37 warnings, same as before); `bun bench/memory-recall.bench.ts 1000 --check`: ok.

| SC | before | after | met? |
|---|---|---|---|
| SC-001 fact said in another chat of the project reaches the turn | never (conversations not recalled) | ≥ 9/10 (db.test), 0/10 from another project | yes |
| SC-002 recall bench after fusion | lex 25/25, para without pin 6/25 | lex 25/25, para without pin 6/25 | yes |
| SC-003 recalled text can't close `<context>` | no notice, no escape | notice + `noClose`, one closing tag in both prompt paths (engines.test) | yes |
| SC-004 LongMemEval-S hit@5 (zero model) | 0.000 | **0.940** (hit@10 0.966, in-turn 0.928); ai-memory 0.951 | yes (≥ 0.80) |
| SC-005 prepare p95 at 1,000 memories | 8.69 ms | 8.44 ms (≤ 17.4) | yes |
| SC-006 recalled part ≤ 2,000 characters | — | budget shared by facts and excerpts, 5 excerpts max | yes |
| SC-007 no regression | 250 server tests | 253 server tests (317 total) green | yes |

Weakest LongMemEval-S types for the next spec: single-session-preference (hit@5 0.633) and
temporal-reasoning (0.913).
