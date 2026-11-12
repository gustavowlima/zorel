# Tasks: Native Desktop Client

**Input**: Design documents from `specs/019-native-desktop/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/client-engine.md, quickstart.md

**Tests**: included where the plan names them (rpc envelope, schema round-trip, i18n plurals, link checks, gpui-kit
component tests per research R7). No pixel-size tests.

**Before any Rust UI task**: load the `gpui-kit` skill (Coding Guides) and `gpui-kit-design-guides`; Zorel's
`apps/web/DESIGN.md` + `PRODUCT.md` win on identity.

**Gate**: Phase 4+ (US2, US3) starts only after T040 records **go** (FR-003).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on unfinished tasks)
- **[Story]**: US1 prototype, US2 daily use / parity, US3 identity and motion

---

## Phase 1: Setup

**Purpose**: Rust workspace and guardrails next to the Bun monorepo

- [ ] T001 Create Cargo workspace root `Cargo.toml` (members: `apps/native`), `rust-toolchain.toml` (pinned stable), and add `target/` to `.gitignore`
- [ ] T002 Create `apps/native/Cargo.toml` (package `zorel-native`, Apache-2.0) with `gpui-kit` pinned exactly, `default-features = false`, plus tokio, Zed `gpui_tokio` by git `rev`, reqwest 0.13, tokio-tungstenite 0.30, serde, serde_json, rust-i18n 4.2, icu_plurals 2.4, and a hello window in `apps/native/src/main.rs`
- [ ] T003 [P] Add `apps/native/deny.toml` (licence allow-list Apache/MIT/BSD/ISC/Zlib/Unicode/MPL-2.0; deny GPL/AGPL/LGPL; ban Zed crates `ui`, `theme`, `editor`, `terminal`, `markdown`, `auto_update`; `unknown-git = "deny"`, allow-git only the pinned Zed repo; advisories on)
- [ ] T004 [P] Add `_typos.toml` and `.rustfmt.toml` at repo root, and npm scripts in `package.json`: `native` (`cargo run -p zorel-native`), `native:check` (`cargo fmt --check && cargo clippy -p zorel-native -- --deny warnings && typos && cargo machete && cargo deny --manifest-path apps/native/Cargo.toml check`)
- [ ] T005 [P] Write `apps/native/AGENTS.md` in gpui-kit's shape (research R7): Coding Guides first, overview, commands, architecture constraints (`RenderOnce` vs `Entity<T>`, state ownership, stable `ElementId`, behaviour in gpui-base vs presentation in `src/ui/`), theme, i18n, dependencies, release (bump the `gpui-pre-*` family together, exact pins), platform support, testing; point to it from `.agent/memory/desktop.md`
- [ ] T006 Add CI jobs (macOS, Windows, Linux) under `.github/workflows/`: a Rust job running `bun run native:check` and `cargo test -p zorel-native --locked`, triggered only by changes in `apps/native/**`, `packages/contracts/**`, `packages/i18n/**`, `packages/design-tokens/**`, `Cargo.*`, `rust-toolchain.toml`, with the cargo registry and `target/` cached; the existing Bun jobs ignore `apps/native/**`

---

## Phase 2: Foundational (plan Phase A — blocks every story)

**Purpose**: one source for wire types, tokens and text, usable by web and native

- [ ] T007 [P] Move the browser socket messages (`PanelFrame`, state JSON, frame header) from `apps/server/src/browser.ts:836-851` into `packages/contracts/src/browser.ts` as Effect Schemas; make `apps/server/src/browser.ts` and `apps/web/src/features/browser.tsx` decode with them
- [ ] T008 [P] Move the terminals socket frames used in `apps/web/src/features/shell.tsx:86-90` into `packages/contracts/src/terminal.ts`; server and web decode with them
- [ ] T009 Add `HttpApi` groups in `packages/contracts/src/index.ts` for attachments upload/get, `/api/search`, `/api/workspace/import`, `/api/server`, `/api/setup`, `/api/invite/:id`, `/api/chats/:id/terminals`, `/api/browser/picture`; switch their server handlers and web callers (`apps/web/src/client.ts:384-393`) to them
- [ ] T010 Write `scripts/export-schema.ts`: `OpenApi.fromApi(Api)` → `packages/contracts/schema/openapi.json`; `Schema.toJsonSchemaDocument` for RPC payloads, `ChatEvent`, browser and terminal messages → `packages/contracts/schema/rpc.json`, `packages/contracts/schema/sockets.json`; add `bun run schema` and a CI step that fails on `git diff --exit-code packages/contracts/schema/`
- [ ] T011 [P] Create `packages/design-tokens/` with `tokens.json` seeded from the 252 `--z-*` declarations in `apps/web/src/styles.css` (light + dark, type, radius, space, agent hues, motion tiers in gpui-kit `MotionTokens` shape) and `generate.ts` that writes the `--z-*` block back into `apps/web/src/styles.css` (byte-identical output on first run) and `apps/native/themes/zorel.json` (gpui-kit `ThemeSet`) + `apps/native/src/theme/tokens.rs` (Zorel-only tokens)
- [ ] T012 [P] Write `scripts/export-i18n.ts`: `packages/i18n` (en + pt-BR) → `apps/native/locales/ui.yml` (`_version: 2`), `{name}` → `%{name}`, plural `{one, other}` → `.one` / `.other` subkeys
- [ ] T013 Extend `scripts/check-i18n.ts` to scan `apps/native/src/**/*.rs` for `t!("…")` keys and fail when a key is missing from the catalog
- [ ] T014 Run `bun run test`, `bun run typecheck`, `bun run check:i18n`, `bun run check:ui`; record the Phase A result in `.agent/memory/desktop.md`

**Checkpoint**: web unchanged in behaviour, schemas checked in, tokens and catalogs generated.

---

## Phase 3: User Story 1 — Prove it before moving (P1) 🎯 MVP

**Goal**: sidebar + one chat in the native prototype against the real engine, measured against Electron, go / no-go written.

**Independent Test**: quickstart.md procedure produces `prototype-report.md` with every gate marked.

### Engine and network

- [ ] T015 [US1] Generate Rust wire types in `apps/native/build.rs` with typify from `packages/contracts/schema/*.json` into `OUT_DIR`, re-exported from `apps/native/src/net/types.rs`
- [ ] T016 [P] [US1] Round-trip test `apps/native/tests/schema_roundtrip.rs`: decode real responses captured from a temp engine (`ZOREL_HOME` temp dir) for chats list, snapshot and each `ChatEvent` variant
- [ ] T017 [US1] Engine supervisor in `apps/native/src/engine/mod.rs`: free loopback port, spawn the server (`bun apps/server/src/main.ts` in dev, compiled binary otherwise) with a cleared env plus `ZOREL_PARENT_PID`, `ZOREL_SESSION_STDIN=1`, the 32-byte secret written to stdin then closed; ready = any non-404; logs to the app data folder; `--engine <url> --token <t>` flags attach to a running engine (quickstart)
- [ ] T018 [US1] HTTP client in `apps/native/src/net/http.rs`: reqwest with `x-zorel-token` default header, base URL from the connection, typed calls for the endpoints the prototype uses
- [ ] T019 [US1] effect/rpc client in `apps/native/src/net/rpc.rs`: WebSocket `/rpc`, JSON envelope `Request`/`Chunk`/`Exit`/`Ack`/`Ping`/`Eof`, streams as async iterators, reconnect with backoff 0.5→10 s and resubscribe (snapshot first)
- [ ] T020 [P] [US1] Contract test `apps/native/tests/rpc_live.rs`: start a temp engine, `subscribeChat` receives a snapshot, `send` produces `turn-started`, `decide` resolves an approval
- [ ] T021 [US1] Bridge tokio into GPUI with `gpui_tokio` in `apps/native/src/main.rs`; `EngineConnection` entity (data-model.md states) in `apps/native/src/state/connection.rs`

### State and text

- [ ] T022 [P] [US1] Status + chat list entities in `apps/native/src/state/chats.rs` fed by `subscribeStatus` and the chats endpoint
- [ ] T023 [P] [US1] Chat view state in `apps/native/src/state/chat.rs`: rows with stable ids, streaming tail kept apart, approvals, drafts per chat
- [ ] T024 [P] [US1] i18n in `apps/native/src/i18n.rs`: `rust_i18n::i18n!("locales", fallback = "en")`, `extend!(gpui_component)` before `gpui_kit::init`, `plural(key, count)` over icu_plurals; unit test for en and pt-BR plurals in the same file
- [ ] T025 [P] [US1] Theme load in `apps/native/src/theme/mod.rs`: `themes/zorel.json` + `tokens.rs`, follows system light/dark, exposes reduced-motion

### Zorel components (on gpui-base, research R7 tests)

- [ ] T026 [P] [US1] `apps/native/src/ui/button.rs` (variants of `apps/web/src/ui/button.tsx`, visible hover/focus/pressed/disabled) with a builder test
- [ ] T027 [P] [US1] `apps/native/src/ui/face.rs`: AgentFace (hue, eyes open/happy/asleep/aside/up, states idle/working/waiting/done/failed) and WorkingRing, matching `apps/web/src/ui/face.tsx`; builder test
- [ ] T028 [P] [US1] `apps/native/src/ui/layout.rs`: card, row, section, QuietCard, EmptyState shells from `apps/web/src/ui/layout.tsx`
- [ ] T029 [P] [US1] `apps/native/src/ui/markdown.rs`: pulldown-cmark parse off the UI thread, only the streaming tail re-parsed, raw HTML ignored, links checked http(s) before `cx.open_url`; tree-sitter colours painted after layout; test that HTML and `javascript:` links are inert
- [ ] T030 [P] [US1] `apps/native/src/ui/input.rs`: composer on gpui-base Input/Textarea (IME, paste, submit, multiline)

### Screens

- [ ] T031 [US1] Sidebar in `apps/native/src/screens/sidebar.rs` (chat list with faces and status, matching `apps/web/src/features/sidebar.tsx` essentials) using a virtual list
- [ ] T032 [US1] Chat screen in `apps/native/src/screens/chat.rs`: virtual list anchored to bottom, cached row heights, streaming reply, composer, approval card with allow/deny
- [ ] T033 [US1] Browser panel spike in `apps/native/src/screens/browser.rs`: `/api/browser` socket, JPEG decode off-thread with `image` (jpeg only), drop late frames, `RenderImage`
- [ ] T034 [US1] Needs you screen in `apps/native/src/screens/inbox.rs` (for SC-004 effort measure), timed against the web implementation history of `apps/web/src/features/inbox.tsx`

### Measure and decide

- [ ] T035 [P] [US1] `scripts/seed-long-chat.ts`: seeds a temp `ZOREL_HOME` with one chat of ≥ 500 messages (code, tables, an open approval)
- [ ] T036 [P] [US1] Frame log in `apps/native/src/debug/frames.rs` (frame times to a file behind `ZOREL_FRAME_LOG`) and launch timestamp to chat list painted
- [ ] T037 [US1] `scripts/measure-desktop.ts`: sums `footprint` (macOS) of the client's processes, drives the scroll, reads frame logs; runs both clients per quickstart.md, 3 runs, medians
- [ ] T038 [US1] Run the procedure on macOS; also `MTL_HUD_ENABLED=1` and `samply record` captures attached to the report
- [ ] T039 [US1] Identity review: light/dark screenshots of sidebar + chat next to the web app, saved under `specs/019-native-desktop/prototype/`
- [ ] T040 [US1] Write `specs/019-native-desktop/prototype-report.md` (data-model PrototypeReport) with SC-001..SC-004, browser panel fps and the **go / no-go**; on go, rewrite D11 and D20 in `docs/ARCHITECTURE.md`; on no-go, record the Electron alternative (virtualised lists, incremental markdown) and stop

**Checkpoint**: decision recorded. Everything below needs **go**.

---

## Phase 4: User Story 2 — Daily use in the native app (P2)

**Goal**: every screen and shell feature of today's desktop app, on 3 OSes, lighter.

**Independent Test**: parity checklist below 100% on macOS, Windows, Linux; idle memory ≤ 1/3 of Electron after 1 h.

### Shell (plan Phase C)

- [ ] T041 [P] [US2] Tray with gpui-tray in `apps/native/src/shell/tray.rs` (open, new chat, quit; ksni fallback on Linux if needed)
- [ ] T042 [P] [US2] App menus with `cx.set_menus` in `apps/native/src/shell/menus.rs` (app, Edit, Window on macOS; in-window elsewhere; no reload/devtools)
- [ ] T043 [P] [US2] Notifications with notify-rust in `apps/native/src/shell/notify.rs`: approvals/questions/notices → system notification → click opens that chat at the item; verify click-through in a signed macOS bundle
- [ ] T044 [P] [US2] Keep-awake on AC power (keepawake + starship-battery polled 60 s) in `apps/native/src/shell/awake.rs`, pref in `prefs.json`
- [ ] T045 [P] [US2] Dialogs (rfd folder picker, xdg-portal on Linux), open-in-system links (http(s) only), downloads to the Downloads folder in `apps/native/src/shell/system.rs`
- [ ] T046 [P] [US2] Single instance + open at login (`--hidden`) in `apps/native/src/shell/instance.rs`
- [ ] T047 [US2] Team servers in `apps/native/src/shell/servers.rs`: `servers.json`, per-origin credential in keyring, never the local secret, version check via `/api/server` → mismatch opens the system browser; forget deletes the credential
- [ ] T048 [US2] Packaging + updates with Velopack in `apps/native/packaging/`: sidecar server binary signed inside-out, Ed25519-signed manifest verified before swap, refuse downgrade; replaces the `curl | sh` path; macOS Developer ID + hardened runtime + notarisation, Windows Authenticode, Linux AppImage + minisign
- [ ] T049 [US2] Agents' browser fetched on first use: server installs Playwright Chromium into the data folder when missing (`apps/server/src/browser.ts`), panel shows the download state; drop `Resources/browsers` from the native bundle

### Screens (plan Phase D) — each mirrors its web feature file

- [ ] T050 [P] [US2] Home (`apps/web/src/features/home.tsx`, `today.tsx`, `your-day.tsx`) → `apps/native/src/screens/home.rs`
- [ ] T051 [P] [US2] Tasks: drawer, panel, report (`task-drawer.tsx`, `task-panel.tsx`, `task-report.ts`) → `apps/native/src/screens/task.rs`
- [ ] T052 [P] [US2] Agents, agent detail, memory, copies, work (`agents.tsx`, `agent.tsx`, `agent-*.tsx`) → `apps/native/src/screens/agents.rs`
- [ ] T053 [P] [US2] Projects, workspace, files, diffs, git (`project.tsx`, `workspace.tsx`, `file-view.tsx`, `diff-view.tsx`, `diff-pool.tsx`, `git.tsx`) → `apps/native/src/screens/project.rs`
- [ ] T054 [P] [US2] Routines and flows (`routines.tsx`, `new-routine.tsx`, `routine-week.tsx`, `flow-*.tsx`, `week-lanes.ts`) → `apps/native/src/screens/routines.rs`
- [ ] T055 [P] [US2] Knowledge and memory (`knowledge.tsx`, `memory.tsx`, `memory-map.tsx`, `pages.tsx`, `reading.tsx`) → `apps/native/src/screens/knowledge.rs`
- [ ] T056 [P] [US2] Settings and its sections (`settings.tsx`, `providers.tsx`, `limits.tsx`, `failover.tsx`, `usage.tsx`, `permissions.tsx`, `mcp.tsx`, `skills.tsx`, `channels.tsx`, `storage.tsx`, `audit.tsx`, `team.tsx`, `teams.tsx`, `people.tsx`, `cli-version.tsx`, `computer-apps.tsx`, `own-computer.tsx`) → `apps/native/src/screens/settings/`
- [ ] T057 [P] [US2] Onboarding and sign-in (`first-run.tsx`, `first-run-connect.tsx`, `sign-in.tsx`, `server-picker.tsx`, `desktop-servers.tsx`) → `apps/native/src/screens/onboarding.rs`
- [ ] T058 [P] [US2] Terminal on alacritty_terminal (`shell.tsx`, `processes.tsx`) → `apps/native/src/screens/terminal.rs`: colours, resize, selection, copy/paste, IME
- [ ] T059 [P] [US2] Chat extras: mentions, model picker, queue, question, context meter, run trace, steps, attachments, image viewer, browser card, palette (`mention.tsx`, `model-picker.tsx`, `queue.tsx`, `question.tsx`, `context-meter.tsx`, `run-trace.tsx`, `steps.ts`, `browser-card.tsx`, `palette.tsx`) → `apps/native/src/screens/chat/`
- [ ] T060 [US2] Keyboard shortcuts parity (`apps/web/src/features/palette.tsx` and global handlers) as GPUI actions + keybindings in `apps/native/src/actions.rs`
- [ ] T061 [US2] Parity checklist table (data-model ParityItem) appended to this file; every row done or n/a on macOS, Windows, Linux (SC-007)
- [ ] T062 [US2] Accessibility pass: every interactive element has role/name/state from the catalog; UI integration tests assert focus order and accessibility for chat, composer, approval card, Needs you (`apps/native/tests/a11y.rs`)

**Checkpoint**: native app is a full replacement on 3 OSes.

---

## Phase 5: User Story 3 — Same identity, more fluid (P3)

**Goal**: continuous transitions and springy panels on Zorel's tokens, off under reduced motion.

**Independent Test**: recordings of the main flows; reduce-motion on stops decorative motion.

- [ ] T063 [P] [US3] Motion tokens wired in `apps/native/src/theme/motion.rs` from `packages/design-tokens` (duration tiers, easing, control/movement springs)
- [ ] T064 [P] [US3] Screen transitions (Home ↔ chat ↔ Needs you) with `gpui_base` presence/transition in `apps/native/src/screens/router.rs`, keeping scroll position and no layout jump
- [ ] T065 [P] [US3] Springy side panels (task, browser, files) with `gpui_base::spring` in `apps/native/src/ui/panel.rs`
- [ ] T066 [P] [US3] Streaming text smoothing (fade/advance per chunk, opacity only) in `apps/native/src/ui/markdown.rs`
- [ ] T067 [P] [US3] Faces alive (glance, blink, ring dot, waiting breath) and scenes in `apps/native/src/ui/face.rs` and `apps/native/src/ui/scene.rs`, matching `apps/web/src/ui/face.tsx` and the restrained illustration rule
- [ ] T068 [US3] Reduced-motion audit: every motion reads the theme flag; theme/light-dark change repaints all windows at once (`cx.refresh_windows()`)
- [ ] T069 [US3] Identity review against `apps/web/DESIGN.md` with the gpui-kit Design review checklist; no element reads as a stock kit (SC-008)

---

## Phase 6: Polish and switch (plan Phase F)

- [ ] T070 Measure release builds on macOS, Windows, Linux: installed size ≤ 200 MB, download ≤ 120 MB, idle memory ≤ 1/3 of Electron after 1 h (SC-005, SC-006); results in `prototype-report.md`
- [ ] T071 CycloneDX SBOM (`cargo cyclonedx`) and `THIRD_PARTY_LICENSES.md` from both Rust and JS dependencies (`scripts/third-party-licenses.ts`) attached to each release
- [ ] T072 Make the native app the shipped desktop: release job builds `apps/native` packages; update `install.sh` and docs
- [ ] T073 Delete `apps/desktop` and its scripts from `package.json`; remove Electron notes from `.agent/memory/desktop.md`
- [ ] T074 Update `docs/ARCHITECTURE.md` (D11, D20, section 11 Security), `README.md`, `.agent/memory/desktop.md` + changelog + index
- [ ] T075 Final run: `bun run test`, `bun run typecheck`, `bun run check:i18n`, `bun run check:ui`, `bun run native:check`, `cargo test --all --locked`

---

## Dependencies & Execution Order

- Phase 1 → Phase 2 → US1 (Phase 3) → **gate T040** → US2 (Phase 4) and US3 (Phase 5) → Phase 6.
- US3 needs the US1 components (T026–T030) and screens from US2 that it animates (T050–T059); motion tokens (T063) can start right after the gate.
- Inside US1: T015 → T016/T018/T019 → T020/T021 → T022/T023 → T031–T034 → T035–T040. Components T024–T030 parallel once T021 exists.
- Inside US2: shell tasks T041–T046 parallel; T047 after T018; T048 after T041–T046; screens T050–T059 parallel; T060–T062 last.

## Parallel Examples

```text
Phase 2: T007, T008, T011, T012 together (different packages).
US1:     T026 button, T027 face, T028 layout, T029 markdown, T030 input together.
US2:     T050–T059 one screen per agent/worktree.
US3:     T063–T067 together.
```

## Implementation Strategy

1. **MVP = Phase 1 + Phase 2 + US1**: ends with a measured go / no-go. Phase 2 also benefits the web app if the answer
   is no-go.
2. On go: US2 shell first (T041–T049) so the native app can be dogfooded daily, then screens in order of use (Home,
   chat extras, tasks, settings…).
3. US3 in parallel with late US2 screens.
4. Switch (Phase 6) only when SC-005..SC-008 pass; no data migration (Zorel is in development).
