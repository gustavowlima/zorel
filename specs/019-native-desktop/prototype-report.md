# Prototype report (spec 019, Phase B) — partial

**Status**: in progress. The go / no-go is written when every gate below is measured (T040).

**Machine**: Apple Silicon Mac, macOS 27 (Darwin 27.0.0) · **Build**: `cargo build --release` (thin LTO, stripped),
gpui-kit 0.9.1 (gpui-base only) on gpui-pre 0.3.12 · **Engine**: the Bun server from this checkout, separate process,
throwaway data folder seeded by `scripts/seed-long-chat.ts` (1 agent, 1 chat, 500 messages: code, tables, lists).

## Measured (2026-11-12)

| Gate | How | Target | Electron today | Native prototype | |
|---|---|---|---|---|---|
| SC-001 idle memory | `footprint` of the client's own processes after 60 s idle, the 500-message chat open | ≤ 180 MB | ~530 MB (4 processes, measured 2026-11-12) | **73 MB** (1 process) | ✅ |
| Shell size | the client binary | — | 243 MB (Electron frameworks in Zorel.app) | **13.9 MB** | — |
| Debug build, same chat | `footprint` | — | — | 70 MB | — |

What the prototype draws in that run: the sidebar with each chat's face and state, the chat (markdown messages in a
bottom-anchored list, live streaming reply, approval cards, composer), on the engine's real HTTP + RPC API.

## Still to measure

- SC-002: memory growth and frame pacing while scrolling the 500 messages top → bottom → top (needs the frame log, T036,
  and a scripted scroll, T037).
- SC-003: launch to chat list painted with the engine already running (T036 timestamp).
- SC-004: hours to build "Needs you" (T034) against its web history.
- Browser panel at 30 fps (T033).
- Identity review, light and dark (T039): needs a person and screenshots (macOS asks for Screen Recording permission
  to capture another app's window).
