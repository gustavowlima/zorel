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
