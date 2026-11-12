# Quickstart: prototype measurement (spec 019, Phase B gates)

The procedure that decides go / no-go. Same machine, same data, both apps, written to `prototype-report.md`.

## Prerequisites

- Rust toolchain from `rust-toolchain.toml`; Bun; macOS with Xcode command-line tools (Windows/Linux runs repeat the
  same steps later).
- A seeded engine home with one chat of ≥ 500 messages including code blocks, tables and an open approval:
  `ZOREL_HOME=$TMP/z bun scripts/seed-long-chat.ts` (written in Phase B).

## Run

```sh
# engine (shared by both clients)
PORT=4318 ZOREL_HOME=$TMP/z ZOREL_SESSION=proto bun apps/server/src/main.ts

# native prototype
cargo run --release -p zorel-native -- --engine http://127.0.0.1:4318 --token proto

# baseline: today's desktop app pointed at the same engine
bun run desktop  # with the same ZOREL_HOME
```

## Measure (each 3 times, median)

| Gate | How | Pass |
|---|---|---|
| SC-001 idle memory | after 60 s idle on the chat list: sum `footprint` of the client's processes (not the engine) | ≤ 180 MB |
| SC-002 scroll | open the long chat, scroll top→bottom→top with a scripted wheel; memory delta; frame times from the client's frame log | Δ ≤ 50 MB; ≤ 1% frames > 2 intervals |
| SC-003 launch | engine already up; time from process start to chat list painted (client log timestamp) | ≤ 0.5 s |
| SC-004 effort | hours to build "Needs you" in the prototype vs its web implementation history | ≤ 2× |
| Browser panel | agent browsing; panel at 30 fps frames; UI frame log while streaming | no frame > 2 intervals caused by decode |
| Identity | side-by-side screenshots light/dark; person's review | reads as Zorel |

## Decide

All gates pass → go: record in `prototype-report.md`, update `docs/ARCHITECTURE.md` (D11, D20) and start Phase C.
Any gate fails → no-go or a named change (e.g. GPUI Fast on, own fork), recorded with numbers; Electron path
(virtualised lists, incremental markdown) is planned instead.
