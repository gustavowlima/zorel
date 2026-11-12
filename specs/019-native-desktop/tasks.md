# Tasks: Native Desktop Client

**Input**: Design documents from `specs/019-native-desktop/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/client-engine.md, quickstart.md

**Tests**: included where the plan names them (rpc envelope, schema round-trip, i18n plurals, link checks, gpui-kit
component tests per research R7). No pixel-size tests.

**Before any Rust UI task**: load the `gpui-kit` skill (Coding Guides) and `gpui-kit-design-guides`; Zorel's
`apps/web/DESIGN.md` + `PRODUCT.md` win on identity.

**Gate**: waived on 2026-11-12 by the product owner: "no comparison in this branch, proceed replacing Electron". The prototype's idle memory was measured (73 MB vs ~530 MB, `prototype-report.md`); T036–T040 are not run in this branch.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on unfinished tasks)
- **[Story]**: US1 prototype, US2 daily use / parity, US3 identity and motion

---

## Phase 1: Setup

**Purpose**: Rust workspace and guardrails next to the Bun monorepo

- [X] T001 Create Cargo workspace root `Cargo.toml` (members: `apps/native`), `rust-toolchain.toml` (pinned stable), and add `target/` to `.gitignore`
- [X] T002 Create `apps/native/Cargo.toml` (package `zorel-native`, Apache-2.0) with `gpui-kit` pinned exactly, `default-features = false`, and a hello window (the other crates are added by the task that first uses them, so `cargo machete` stays clean) in `apps/native/src/main.rs`
- [X] T003 [P] Add `apps/native/deny.toml` (licence allow-list Apache/MIT/BSD/ISC/Zlib/Unicode/MPL-2.0; deny GPL/AGPL/LGPL; ban Zed crates `ui`, `theme`, `editor`, `terminal`, `markdown`, `auto_update`; `unknown-git = "deny"`, allow-git only the pinned Zed repo; advisories on)
- [X] T004 [P] Add `_typos.toml` and `.rustfmt.toml` at repo root, and npm scripts in `package.json`: `native` (`cargo run -p zorel-native`), `native:check` (`cargo fmt --check && cargo clippy -p zorel-native -- --deny warnings && typos && cargo machete && cargo deny --manifest-path apps/native/Cargo.toml check`)
- [X] T005 [P] Write `apps/native/AGENTS.md` in gpui-kit's shape (research R7): Coding Guides first, overview, commands, architecture constraints (`RenderOnce` vs `Entity<T>`, state ownership, stable `ElementId`, behaviour in gpui-base vs presentation in `src/ui/`), theme, i18n, dependencies, release (bump the `gpui-pre-*` family together, exact pins), platform support, testing; point to it from `.agent/memory/desktop.md`
- [X] T006 Add CI jobs (macOS, Windows, Linux) under `.github/workflows/`: a Rust job running `bun run native:check` and `cargo test -p zorel-native --locked`, triggered only by changes in `apps/native/**`, `packages/contracts/**`, `packages/i18n/**`, `apps/web/src/styles.css`, `Cargo.*`, `rust-toolchain.toml`, with the cargo registry and `target/` cached; the existing Bun jobs ignore `apps/native/**`

---

## Phase 2: Foundational (plan Phase A — blocks every story)

**Purpose**: one source for wire types, tokens and text, usable by web and native

- [X] T007 [P] Move the browser socket messages (`PanelFrame`, state JSON, frame header) from `apps/server/src/browser.ts:836-851` into `packages/contracts/src/browser.ts` as Effect Schemas; make `apps/server/src/browser.ts` and `apps/web/src/features/browser.tsx` decode with them
- [X] T008 [P] Move the terminals socket frames used in `apps/web/src/features/shell.tsx:86-90` into `packages/contracts/src/terminal.ts`; server and web decode with them
- [X] T009 Type the routes outside `HttpApi` in `packages/contracts/src/routes.ts` (`RouteError`, `WorkspaceImport`, `ServerInfo`, `ATTACHMENT_NAME_HEADER`; the upload already answers the contract's `Attachment`) and use them in `apps/server/src/main.ts`, `server-routes.ts`, `apps/web/src/client.ts`, `auth-client.ts`, `features/storage.tsx`. Narrowed: raw uploads/downloads stay `HttpRouter` routes (HttpApi gains nothing for binary bodies); team, device and sign-in routes are typed with T047 (team servers), not needed by the prototype
- [X] T010 Write `packages/contracts/scripts/export-schema.ts` (`bun run schema`, `--check` in `ci.yml`): one draft 2020-12 `packages/contracts/schema/wire.json` whose `$defs` are every HttpApi endpoint's body and result (`ChatsListSuccess`…), every RPC's payload/result/error (stream RPCs: their element, `…Item`), and the browser/terminal socket and raw-route bodies (an OpenAPI file was dropped: nothing consumed it)
- [X] T011 [P] Write `scripts/export-tokens.ts` (`bun run tokens`, `--check` in `ci.yml`): reads the `--z-*` roles from `apps/web/src/styles.css` (dark `:root` + light override, the only source), resolves `var()` / `color-mix(in srgb, …)`, writes `apps/native/src/theme/tokens.rs` (`Palette` DARK/LIGHT, size/fraction/ms consts) formatted by rustfmt; fails on a value it can't read or a non-colour that differs by theme
- [X] T012 [P] Write `scripts/export-i18n.ts` (`bun run i18n:native`, `--check` in CI): `packages/i18n` (en + pt-BR) → `apps/native/locales/<lang>.json` (one file per language, rust-i18n reads the language from the file name), `{name}` → `%{name}`, plural `{one, other}` → `.one` / `.other` keys
- [X] T013 Extend `scripts/check-i18n.ts` to scan `apps/native/src/**/*.rs`: every `t!("…")` key must be a text and every `tn("…", n)` key a plural in the exported catalog
- [X] T014 Run `bun run test` (513 pass), `typecheck`, `lint` (32 pre-existing warnings), `check:i18n`, `check:ui`, `schema/tokens/i18n:native --check`; record the Phase A result in `.agent/memory/desktop.md`

**Checkpoint**: web unchanged in behaviour, schemas checked in, tokens and catalogs generated.

---

## Phase 3: User Story 1 — Prove it before moving (P1) 🎯 MVP

**Goal**: sidebar + one chat in the native prototype against the real engine, measured against Electron, go / no-go written.

**Independent Test**: quickstart.md procedure produces `prototype-report.md` with every gate marked.

### Engine and network

- [X] T015 [US1] Generate Rust wire types in `apps/native/build.rs` with typify 0.8 from `packages/contracts/schema/wire.json` into `OUT_DIR/wire.rs`, included by `apps/native/src/net/types.rs`. Normalizes what typify can't read: `$defs` refs → `definitions`, Effect's `additionalProperties: true` dropped (else no structs/tagged enums), Effect's non-finite number strings dropped (the engine sends finite numbers)
- [X] T016 [P] [US1] Round-trip test `apps/native/tests/schema_roundtrip.rs`: a fresh engine in a temp `ZOREL_HOME` per test; agents, projects, chats, routines and pages lists decode with the generated types; without the secret `/api` answers 403. (Chat events are covered live in T020: a fresh engine has no agents to run a turn)
- [X] T017 [US1] Engine supervisor in `apps/native/src/engine/mod.rs`: free loopback port, spawn the server (`bun apps/server/src/main.ts` in dev, compiled binary otherwise) with a cleared env plus `ZOREL_PARENT_PID`, `ZOREL_SESSION_STDIN=1`, the 32-byte secret written to stdin then closed; ready = any non-404; logs to the app data folder; `--engine <url> --token <t>` flags attach to a running engine (quickstart) — `apps/native/src/engine/mod.rs` (`Engine::start`/`attach`, `Launch::dev`); logs inherit stdio for now (file logging with T046)
- [X] T018 [US1] HTTP client in `apps/native/src/net/http.rs`: reqwest with `x-zorel-token` default header, base URL from the connection, typed calls for the endpoints the prototype uses
- [X] T019 [US1] effect/rpc client in `apps/native/src/net/rpc.rs`: WebSocket `/rpc`, JSON envelope `Request`/`Chunk`/`Exit`/`Ack`/`Ping`/`Eof`, streams as async iterators, reconnect with backoff 0.5→10 s and resubscribe (snapshot first) — Void payloads go as `null`; each chunk is acked (the engine waits for it); unknown items are skipped and logged
- [X] T020 [P] [US1] Contract test `apps/native/tests/rpc_live.rs`: on a fresh engine, an agent and a chat created over REST; `subscribeChat` starts with a snapshot; `send` returns a turn id and the stream carries turn-started through turn-failed (no provider account); `decide` on an unknown id fails with `ApprovalNotFound`; `approvals` (Void payload) answers; `subscribeStatus` opens
- [X] T021 [US1] Bridge tokio into GPUI in `apps/native/src/runtime.rs` (own: Zed's `gpui_tokio` targets in-tree gpui); `EngineConnection` entity (data-model.md states) in `apps/native/src/state/connection.rs` — `src/state/connection.rs`, window in `src/app.rs` (lib, so `t!` resolves); verified: connect, drop, reconnect; 40 MB footprint (debug)

### State and text

- [X] T022 [P] [US1] Status + chat list entities in `apps/native/src/state/chats.rs` fed by `subscribeStatus` and the chats endpoint — pure `ChatList` (status per chat; an unknown chat asks for a refetch); sidebar order ported from apps/web sidebar-order.ts with the screen (T031)
- [X] T023 [P] [US1] Chat view state in `apps/native/src/state/chat.rs`: rows with stable ids, streaming tail kept apart, approvals, drafts per chat — pure `ChatLog` reducer (snapshot, messages, turns, streaming tail per turn, steps, approvals, status) with a test; the screen owns it
- [X] T024 [P] [US1] i18n in `apps/native/src/i18n.rs`: `rust_i18n::i18n!("locales", fallback = "en")` in `lib.rs`, system language (pt → pt-BR), `tn(key, count)` over icu_plurals; test for en and pt-BR. `extend!(gpui_component)` not needed: only gpui-base is used
- [X] T025 [P] [US1] Theme in `apps/native/src/theme/mod.rs`: `palette(window)` picks `tokens::DARK`/`LIGHT` by the window's appearance, re-rendered on change; reduced motion comes from `gpui_kit::init` (gpui-base reads the system setting on macOS, Windows, Linux) into `cx.reduce_motion()`. In-app light/dark override waits for the settings screen

### Zorel components (on gpui-base, research R7 tests)

- [X] T026 [P] [US1] `apps/native/src/ui/button.rs` (variants of `apps/web/src/ui/button.tsx`, visible hover/focus/pressed/disabled) with a builder test — `src/ui/button.rs`: Primary/Secondary/Ghost/Destructive, Sm/Md, on gpui-base's Button (activation, focus, a11y label)
- [X] T027 [P] [US1] `apps/native/src/ui/face.rs`: AgentFace (hue, eyes open/happy/asleep/aside/up, states idle/working/waiting/done/failed) and WorkingRing, matching `apps/web/src/ui/face.tsx`; builder test — static eyes; alive eyes and the waiting dot's breathing go with T067
- [X] T028 [P] [US1] `apps/native/src/ui/layout.rs`: card, row, section, QuietCard, EmptyState shells from `apps/web/src/ui/layout.tsx` — `card()` and `row()`; QuietCard/EmptyState with the screens that use them
- [X] T029 [P] [US1] `apps/native/src/ui/markdown.rs`: pulldown-cmark → Zorel blocks (paragraph, heading, list item, quote, code, rule; tables as text) with marks and links → GPUI text runs; raw HTML shown as text; links open only if http(s)/mailto; tested. Parsing stays on the UI thread for now (a reply is a few KB) and code blocks have no syntax colours yet — both noted with `ponytail:`
- [X] T030 [P] [US1] `apps/native/src/ui/input.rs`: composer on gpui-base Input/Textarea (IME, paste, submit, multiline) — the composer is gpui-base's `Textarea` (IME, paste, auto-grow 1–8 rows); Enter sends, Shift+Enter breaks the line

### Screens

- [X] T031 [US1] Sidebar in `apps/native/src/screens/sidebar.rs` (chat list with faces and status, matching `apps/web/src/features/sidebar.tsx` essentials) using a virtual list — `src/screens/sidebar.rs` (order ported from sidebar-order.ts, tested; face shows each chat's state); rows are built each render (fine for hundreds, `ponytail:` noted)
- [X] T032 [US1] Chat screen in `apps/native/src/screens/chat.rs`: virtual list anchored to bottom, cached row heights, streaming reply, composer, approval card with allow/deny — `src/screens/chat.rs`: the kit's `MessageScroller` (tail follow, keeps your place, jump to latest); a text delta re-measures only its reply's row; approval card with Allow/Deny over RPC; markdown cached per message id. `--open <chat>` opens one at start (measurements)
- [ ] T033 [US1] Browser panel spike in `apps/native/src/screens/browser.rs`: `/api/browser` socket, JPEG decode off-thread with `image` (jpeg only), drop late frames, `RenderImage`
- [X] T034 [US1] Needs you in `apps/native/src/screens/inbox.rs`: approvals (allow always / deny / allow; a command as code), questions (answer in words or skip), proposed memories (keep / discard), filters with counts, newest first, "Open the chat", empty and "that's all" states; a "Pending" row with the count tops the sidebar; refreshed on every status change. Deferred with `ponytail:`: a routine's uncertain step and editing an "Ask me" step (T054), "Edit"/"Review the change" on a memory (T055). (Effort not compared: gate waived)

### Measure and decide

- [X] T035 [P] [US1] `scripts/seed-long-chat.ts`: seeds a temp `ZOREL_HOME` with one chat of ≥ 500 messages (code, tables, an open approval) — writes N messages (code, tables, lists, quotes, links) into a throwaway folder; refuses a real `.zorel` path
- [~] T036 [P] [US1] Frame log in `apps/native/src/debug/frames.rs` (frame times to a file behind `ZOREL_FRAME_LOG`) and launch timestamp to chat list painted — skipped: gate waived (see Gate above)
- [~] T037 [US1] `scripts/measure-desktop.ts`: sums `footprint` (macOS) of the client's processes, drives the scroll, reads frame logs; runs both clients per quickstart.md, 3 runs, medians — skipped: gate waived (see Gate above)
- [~] T038 [US1] Run the procedure on macOS; also `MTL_HUD_ENABLED=1` and `samply record` captures attached to the report — skipped: gate waived (see Gate above)
- [~] T039 [US1] Identity review: light/dark screenshots of sidebar + chat next to the web app, saved under `specs/019-native-desktop/prototype/` — skipped: gate waived (see Gate above)
- [~] T040 [US1] Write `specs/019-native-desktop/prototype-report.md` (data-model PrototypeReport) with SC-001..SC-004, browser panel fps and the **go / no-go**; on go, rewrite D11 and D20 in `docs/ARCHITECTURE.md`; on no-go, record the Electron alternative (virtualised lists, incremental markdown) and stop — skipped: gate waived (see Gate above)

**Checkpoint**: decision recorded. Everything below needs **go**.

---

## Phase 4: User Story 2 — Daily use in the native app (P2)

**Goal**: every screen and shell feature of today's desktop app, on 3 OSes, lighter.

**Independent Test**: parity checklist below 100% on macOS, Windows, Linux; idle memory ≤ 1/3 of Electron after 1 h.

### Shell (plan Phase C)

- [X] T041 [P] [US2] Tray in `apps/native/src/shell/tray.rs` (gpui-tray, `gpui-kit` backend): Windows and Linux only, as Electron (macOS: the Dock); "Open Zorel" and a click bring the window back, Quit quits. The app now runs with `QuitMode::Explicit`: closing the window never quits (the engine keeps working); the Dock reopen, the tray and `show_window` reopen it. Servers in the menu with T047. Not exercised live on Windows/Linux
- [X] T042 [P] [US2] App menus in `apps/native/src/shell/menus.rs`: macOS app menu (Services, hide, hide others, show all, quit), Edit on gpui-base's input actions, Window (minimize, zoom); ⌘Q ⌘H ⌥⌘H ⌘M; labels from `desktop.menu.*` in packages/i18n; no menu bar on Windows/Linux, as Electron. (Servers submenu with T047)
- [X] T043 [P] [US2] Notifications in `apps/native/src/shell/notify.rs` (notify-rust): the web's rules — a chat that starts waiting, fails or finishes while you look elsewhere (not routine chats), and each routine notice; a click brings Zorel forward and opens the chat (`wait_for_action` on a thread per notification). Tested rules. `ponytail:` no in-app switch/chime yet (T056); macOS shows them only for a signed bundle (T048) — not yet seen live
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
- [ ] T062 [US2] Accessibility pass: every interactive element has role/name/state from the catalog; UI integration tests assert focus order and accessibility for chat, composer, approval card, Needs you (`apps/native/tests/a11y.rs`) — Note (2026-11-12): rows set role/label/description/selected/expanded (NavRow), but gpui-pre 0.3.12 exposes no element tree to macOS accessibility yet (agent-desktop sees only the window controls); recheck on each gpui-pre bump

**Checkpoint**: native app is a full replacement on 3 OSes.

---

## Phase 5: User Story 3 — Same identity, more fluid (P3)

**Goal**: continuous transitions and springy panels on Zorel's tokens, off under reduced motion.

**Independent Test**: recordings of the main flows; reduce-motion on stops decorative motion.

- [ ] T063 [P] [US3] Motion tokens wired in `apps/native/src/theme/motion.rs` added to the `--z-*` block in `apps/web/src/styles.css` and exported by `scripts/export-tokens.ts` (duration tiers, easing, control/movement springs)
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
