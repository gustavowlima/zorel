# Implementation Plan: Native Desktop Client

**Branch**: `019-native-desktop` | **Date**: 2026-11-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/019-native-desktop/spec.md`

## Summary

Replace the Electron shell (~530 MB idle, 243 MB of the 571 MB app) with a native GPUI client in Rust that is a pure
client of the existing Bun engine API. Zorel's identity is rebuilt as its own components on `gpui-base` (unstyled
behaviour, AccessKit), with tokens and translations generated from the same sources as the web app. Strangler
migration: a measured prototype with go/no-go gates first; Electron stays shipped until the native app reaches 100%
parity. Details and sources: [research.md](research.md).

## Technical Context

**Language/Version**: Rust (stable, pinned in `rust-toolchain.toml`) for `apps/native`; TypeScript/Bun unchanged for
engine and web.

**Primary Dependencies**: gpui-kit (`default-features = false` → gpui-base) on the `gpui-pre` pin; tokio + Zed's
`gpui_tokio` (git rev); reqwest 0.13; tokio-tungstenite 0.30; serde/serde_json; typify (build); rust-i18n 4.2 (+ icu_plurals); pulldown-cmark;
tree-sitter; alacritty_terminal; image (jpeg); icu_plurals; gpui-tray; notify-rust; keyring 4; rfd; keepawake; Velopack.

**Storage**: none new. Engine keeps SQLite; the client keeps window state and team-server list in a JSON file in the app
data folder (same content as today's `servers.json`) and per-origin credentials in the keychain.

**Testing**: `cargo test` (unit: rpc envelope, schema round-trip, i18n plurals, token load, link checks); contract tests
against a live engine started by the test (`ZOREL_HOME` temp); prototype measurement script (quickstart.md); existing
`bun run test` stays green.

**Target Platform**: macOS 13+ (arm64, x64), Windows 10+ x64, Linux x64 (Wayland + X11).

**Project Type**: desktop app (new workspace member) + small contract additions in the TS monorepo.

**Performance Goals**: SC-001..SC-003 (≤180 MB idle, ≤50 MB growth over a 500-message scroll, ≤1% frames over 2
intervals, ≤0.5 s to chat list); browser panel shows 30 fps frames without UI stalls.

**Constraints**: Apache-2.0 compatible only (no Zed GPL crates); everything works on 3 OSes (constitution IV); one
contract source (constitution, Architecture Constraints); secret never on disk or in env.

**Scale/Scope**: ~22k lines of React UI to port across ~15 screens + shell features of `apps/desktop/src` (861 lines).

## Constitution Check

| Principle | Status |
|---|---|
| I. Scope and simplicity | New dependency set justified per item in research.md R3. Prototype gates before any migration. **Revises D11 and D20** → Complexity Tracking. Light-first holds: the shell gets lighter, still one engine process. |
| II. Security | Pass. All current trust boundaries kept (research R4.1–R4.5); updates gain signature verification; GPL and unknown git sources denied by cargo-deny. |
| III. Errors and boundary validation | Pass. Client decodes every wire message with generated types; decode failures are logged and shown, never dropped silently. Server validation unchanged. |
| IV. Cross-platform | Pass by design; per-OS gaps (tray on GNOME, notification clicks on macOS unsigned) listed. CI builds 3 OSes; what is not exercised live is stated in each release. |
| V. Language and attribution | Pass. UI text and accessible names from `packages/i18n` (exported to rust-i18n); code/comments/commits English. Vendored gpui-kit guides credited (CC BY 4.0) in NOTICE. |
| Contracts single source | Pass after Phase A: wire types missing from `packages/contracts` move there first; Rust types are generated, never hand-written. |

Post-design re-check: unchanged (data-model and contracts add no new wire surface beyond moving existing ad hoc
messages into contracts).

## Project Structure

### Documentation (this feature)

```text
specs/019-native-desktop/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md          # prototype measurement procedure + gates
├── contracts/
│   └── client-engine.md   # what the native client speaks, and what moves into packages/contracts
├── checklists/requirements.md
└── tasks.md               # /speckit-tasks
```

### Source Code (repository root)

```text
apps/native/                      # new: the GPUI desktop client (Cargo workspace member)
├── Cargo.toml
├── AGENTS.md                     # gpui-kit-shaped guide for agents (research R7)
├── build.rs                      # packages/contracts/schema/*.json → Rust types (typify); tokens include
├── locales/ui.yml                # generated from packages/i18n (rust-i18n format)
├── themes/zorel.json             # generated gpui-kit ThemeSet (light + dark)
├── deny.toml                     # cargo-deny policy (licences, advisories, sources, bans)
└── src/
    ├── main.rs                   # app start, single instance, window
    ├── engine/                   # spawn + supervise the Bun server (stdin secret, parent pid, restart, logs)
    ├── net/                      # http client, rpc envelope over WS, browser & terminal sockets
    ├── state/                    # entities mirroring engine state (chats, status, approvals)
    ├── theme/                    # tokens → Theme (light/dark, reduced motion)
    ├── i18n.rs                   # rust_i18n::i18n!, extend!(gpui_component), plural helper
    ├── ui/                       # Zorel components on gpui-base (button, card, row, face, ring, scene…)
    ├── screens/                  # sidebar, chat, home, needs-you, agents, routines, settings…
    └── shell/                    # tray, menus, notifications, updates, keep-awake, dialogs, team servers
Cargo.toml                        # workspace root (members: apps/native)
rust-toolchain.toml
packages/contracts/src/           # + browser.ts, terminal.ts, attachments, setup/invite/search/import schemas
packages/design-tokens/           # new: tokens source → generates apps/web CSS block + Rust theme data
scripts/export-schema.ts          # contracts → packages/contracts/schema/*.json (OpenApi.fromApi + Schema.toJsonSchemaDocument)
scripts/export-i18n.ts            # packages/i18n → apps/native/locales/ui.yml
.claude/skills/gpui-kit*/         # vendored gpui-kit skills, pinned (research R7)
apps/desktop/                     # Electron: unchanged until the switch, removed one release after
```

**Structure Decision**: stay a monorepo: one new app (`apps/native`) beside `apps/desktop`; the engine (`apps/server`)
and web (`apps/web`) unchanged except for contract additions and the token source move. Contracts, catalogs and tokens
have three consumers (server, web, native), so a contract change lands in one commit with a schema drift check instead
of versioned packages across repos. Generated schemas live with their owner in `packages/contracts/schema/`. The Cargo
workspace sits at the root with a single member until a second crate exists (no `crates/` folder ahead of need); Bun's
`apps/*` workspace glob skips `apps/native` (no `package.json`; checked 2026-11-12). CI uses path filters so Rust and Bun
jobs run only for their inputs, with `target/` cached. Revisit a split only for an independent release cadence, a
separate team, or publishing a crate.

## Phases

| Phase | Content | Exit |
|---|---|---|
| **A. Ground** | Missing wire types into `packages/contracts`; schema export + CI drift check; tokens package; i18n export; vendored gpui-kit skills + NOTICE credit; `apps/native/AGENTS.md`. Useful to web regardless. | `bun run test` green; schema JSON checked in |
| **B. Prototype** (≤ 2 weeks) | `apps/native`: engine spawn, rpc client, sidebar, one chat (history, streaming, composer, approval card), faces/ring/tokens, browser panel frames. Measured per quickstart.md. | Gate report: SC-001..SC-004 met → go; else no-go recorded, Electron path (virtualise + incremental markdown) taken instead |
| **C. Shell parity** | Tray, menus, notifications→deep link, updates (Velopack, signed), keep-awake, dialogs, single instance, team servers. Clean data folder (no migration, Zorel is in development). | Shell checklist passes on 3 OSes |
| **D. Screens** | Home, Needs you, Agents, Projects, Routines, Memory, Settings, onboarding, tasks, files/diffs, terminal, attachments, shortcuts. Parity checklist per screen. | Parity checklist 100% on 3 OSes (SC-007) |
| **E. Fluid identity** | Screen transitions, springs (`gpui_base::spring` with Zorel motion tokens), streaming text smoothing, reduced motion. | SC-008 review; recordings |
| **F. Switch** | Native becomes the shipped desktop; Playwright Chromium fetched on first use; `apps/desktop` deleted; ARCHITECTURE.md D11/D20 rewritten. | SC-005, SC-006 measured on release build |

## Risks

| Risk | Mitigation |
|---|---|
| `gpui-pre` published by one maintainer | exact pin; vendoring fallback (own fork of the same zed rev, as Zeron) |
| AccessKit bugs upstream | screen-reader pass in each phase; contribute fixes; block release only on Zorel-critical paths |
| Motion quality | `gpui_base::spring`/transitions (keyed, reduced-motion aware); prototype proves one springy panel and a screen transition |
| JPEG frame upload cost | prototype gate on browser panel at 30 fps |
| Two UIs drift | one contract, one token source, one i18n source, parity checklist in CI review |
| Velopack rollback/notarisation unverified | phase C spike; fallback gpui-updater-core |
| Effect rpc envelope undocumented | contract tests against a live engine on every CI run |

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Revises D11 (Electron desktop) | measured 530 MB idle shell vs ~80–180 MB native; 243 MB of the bundle | Optimised Electron keeps the ~530 MB floor; GPUIX not mature (research R1) |
| Revises D20 (no Rust as main stack) for the **desktop client only** | GPUI is Rust-only | D20's reasons still hold for the engine, which stays TS; recorded in ARCHITECTURE.md only after the prototype's go |
| A second UI codebase (Rust) beside the web app | browser/remote access must stay (FR-020) | Dropping the web app removes remote access; WASM build of the native app is unverified |
