# Implementation Plan: Recall by Meaning with a Local Model

**Branch**: `feat/memory-efficiency` | **Date**: 2026-11-08 | **Spec**: [spec.md](spec.md)

## Summary

A new `vectors.ts` keeps a lazily loaded `feature-extraction` pipeline (`Xenova/all-MiniLM-L6-v2`, q8,
mean pooling, normalized) and an in-memory map fact id → `{ text, vector }`. `recall` gets a fourth
source: cosine between the question's vector and the vectors of the scope's active facts, top 10
above 0.25, fused by RRF like the others; facts without a vector are queued for the background.
Nothing waits for the model. Packaging follows Playwright's pattern: the server build swaps the
library's runtime `require("onnxruntime-node")` for `ZOREL_ONNX`, a one-file bundle of
`onnxruntime-node` plus only the build machine's native binary ships beside the server, and `sharp`
(images, unused) becomes an empty module.

## Technical Context

**Language/Version**: TypeScript on Bun 1.4

**Primary Dependencies**: new `@huggingface/transformers` 4.3.2 (ONNX Runtime). Justification
(AGENTS.md): paraphrase recall needs meaning; the person chose an in-app model; measured working in
Bun and in a compiled Bun binary on 2026-11-08.

**Storage**: none new (vectors in memory, recomputed after start; model files in `<dataDir>/models`)

**Testing**: `bun test` with an injected fake embedder; recall bench `--vectors`; LongMemEval-S

**Performance Goals**: query vector ≤ 2 ms; prepare p95 ≤ 15 ms at 1,000 memories

**Constraints**: no model call over the network; never blocks a turn; cross-platform packaging

## Constitution Check

| Principle | Check | Result |
|---|---|---|
| I. Scope and simplicity | One new module, one dependency (justified above), no migration; facts only | ✅ |
| II. Security | Text never leaves the machine; same scope/owner/state rules as the other sources | ✅ |
| III. Errors and boundaries | Model load or download failure logs one warning and disables the source | ✅ |
| IV. Cross-platform | Runtime shipped per platform; model path from the data folder | ✅ |
| V. Language | No model-facing text changes | ✅ |
| Workflow | tests, both benches, numbers in ARCHITECTURE §8 and server memory | ✅ |

## Source Code

```text
apps/server/src/vectors.ts       # pipeline, in-memory index, background queue, cosine top-k
apps/server/src/chat.ts          # recall: fourth source
apps/server/src/runtime.ts       # start the model in the background at boot
apps/server/src/engines.test.ts  # (or db.test.ts) recall with a fake embedder
apps/server/bench/memory-recall.bench.ts  # --vectors
apps/desktop/scripts/server.ts   # Bun.build --compile with the two build-time swaps (replaces the CLI line)
apps/desktop/scripts/onnx.ts     # copies the onnxruntime bundle + this platform's binary to build/
apps/desktop/src/main.ts         # ZOREL_ONNX for the packaged server
```

## Tasks

- [X] T001 Add `@huggingface/transformers@4.3.2` to `apps/server/package.json`
- [X] T002 [US1] `apps/server/src/vectors.ts`: `startVectors(dataDir)` (lazy pipeline, `env.cacheDir = <dataDir>/models`, one warning on failure), `vectorOf(text)`, `index` map, `ensure(facts)` background queue (serialized), `nearest(query, facts, k, min)`; `setEmbedder(fn)` for tests
- [X] T003 [US1] `apps/server/src/chat.ts` `recall`: fourth source from `nearest` over `store.activeMemories(scopes)` facts (minus `exclude`), `ensure` the ones without a vector
- [X] T004 [US1] `apps/server/src/runtime.ts`: `startVectors(dataDir)` in the background at boot
- [X] T005 [US1] Test (`apps/server/src/db.test.ts`): with a fake embedder, a fact sharing no word with the question is recalled by meaning; another project's is not; with no embedder, recall is unchanged
- [X] T006 [US1] `bench/memory-recall.bench.ts --vectors`: start the model, embed all facts, report reach; record SC-001/SC-002; `PARA_FLOOR` with vectors
- [ ] T007 [US2] `apps/desktop/scripts/server.ts` + `scripts/onnx.ts` + `ZOREL_ONNX` in `apps/desktop/src/main.ts`; check by hand that the compiled server computes a vector (SC-004)
- [ ] T008 Run LongMemEval-S (SC-005), `bun run test`, typecheck, lint; record in ARCHITECTURE §8, `.agent/memory/server.md`, changelog; licence of the new dependency in third-party licences
