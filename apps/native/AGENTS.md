# apps/native — AGENTS.md

Zorel's native desktop client (spec 019): a GPUI window on gpui-kit's unstyled `gpui-base`, drawing Zorel's own
components. It is a pure client of the Bun engine (`apps/server`): no product logic lives here. Plan, research and
tasks: `specs/019-native-desktop/`.

## Read first

1. Load the **`gpui-kit`** skill and read its Coding Guides (`.claude/skills/gpui-kit/references/coding-guides.md`):
   "Architecture at a glance" and "Rules for coding agents" always, then the section for the change.
2. For anything visible, load **`gpui-kit-design-guides`** for desktop conventions (keyboard, overlays, states,
   copy), and `apps/web/DESIGN.md` + `apps/web/PRODUCT.md` for Zorel's identity. **Zorel's files win** on colour, faces,
   scenes and tone; the kit's guides win on desktop conventions.
3. Search the pinned source for signatures (`~/.cargo/registry/src/*/gpui-pre-0.3.12`, `gpui-base-0.9.1`) instead of
   translating React, CSS or old GPUI examples by analogy.

For each change, name: behaviour owner and presentation owner; retained identity and state lifecycle; pointer,
keyboard, focus and accessibility contract; layout and overflow owner; theme tokens used; the test that fails if it
regresses.

## Commands

```bash
bun run native            # cargo run -p zorel-native
bun run native:hot        # hot-patch function bodies (~2.6s) with dx serve; `r` rebuilds
bun run native:dev -- --engine http://127.0.0.1:4319 --token <t>   # rebuild + relaunch on save (watchexec)
bun run native:check      # fmt, clippy -D warnings, typos, cargo machete, cargo deny
cargo test -p zorel-native
MTL_HUD_ENABLED=1 bun run native   # FPS on macOS
samply record cargo run -p zorel-native --release
```

## Architecture constraints

- **Engine boundary.** Every wire type is generated from `packages/contracts/schema/*.json` (never hand-written).
  Missing a type? Add it to `packages/contracts` first, regenerate, then use it here.
- **Layers.** `src/net` (HTTP, effect/rpc over WebSocket, sockets) → `src/state` (entities mirroring engine state) →
  `src/ui` (Zorel components on `gpui_kit::base`) → `src/screens`. `src/shell` holds OS integration (tray, menus,
  notifications, updates). Lower layers never import higher ones.
- **Units.** `RenderOnce` for stateless components; `Entity<T>` when state outlives a frame (lists, composer, panels).
  Custom `Element` only for measured drawing (frames, terminal grid).
- **Own components on gpui-base.** The look is Zorel's: build on `gpui_kit::base` behaviour (Button, Popover and
  positioner, Input/Textarea, focus, a11y, spring/transition) and draw with our `src/ui` components. gpui-component
  stays only where it solves something heavy and invisible (MessageScroller, the input editor, the dialog host,
  tooltips) until we own it; never for buttons, selects, menus, tabs or surfaces (its one radius, stroke-2 icons and
  20/24/32 heights miss the prototype). Docs: https://gpui-kit.com/llms.txt.
- **Scales.** Sizes and radii from `theme/tokens.rs`, spacing from `ui/space` (the web's 4px grid), icons through
  `ui/icon` (16/15/13, stroke 1.6), durations from the `ui/motion` catalog. No literal px for spacing.
- **Hot reload.** `bun run native:hot` (Subsecond). Every `impl Render` delegates to `fn view(..) -> impl IntoElement +
  use<>` through `crate::hot::call`, or it won't hot-patch.
- **Reuse.** Screens compose `src/ui/` components (Button, NavRow, AgentFace, card, code_block, markdown…); look there
  first, extend a component for a variant, and extract a shared one the second time a style or behaviour repeats.
  Motion lives in the component (`ui/motion`), so every use moves the same way.
- **Identity.** Repeated elements get stable domain ids (`ElementId` from chat/message/agent ids), never indexes.
- **Behaviour vs presentation.** Focus, selection, overlays, virtualisation, springs come from `gpui-base`;
  colours, sizes and motion values come from the theme (`src/theme/tokens.rs`, generated from `apps/web/src/styles.css`). No raw
  hex or pixel literals outside the theme.
- **Async.** Network on the tokio runtime (`src/runtime.rs`); results reach views through entity updates; never block
  the UI thread (markdown parsing and image decoding run off-thread).

## Theme and motion

`src/theme/tokens.rs` (our components) and `themes/zorel.json` (gpui-component's theme) are generated from the `--z-*`
roles in `apps/web/src/styles.css` by `bun run tokens` (never
edit it; change the CSS). A new token kind the script can't read fails the run.
Motion uses `gpui_base::spring` / transitions with Zorel's motion tokens and always honours reduced motion.

## i18n

Text comes from `packages/i18n` only, exported to `locales/<lang>.json` (rust-i18n format) by `scripts/export-i18n.ts`.
Never edit `locales/<lang>.json`. Accessible names come from the catalog too (unlike gpui-kit's own crates). Plurals go
through the helper in `src/i18n.rs`. `bun run check:i18n` fails on a `t!` key missing from the catalog.

## Dependencies

- `gpui-kit` pinned exactly with `default-features = false`. **Bump the whole `gpui-pre-*` family together** with
  exact pins, refresh `Cargo.lock`, build default and `gpui-fast`, then refresh the vendored skills in
  `.claude/skills/gpui-kit*` (see their `SOURCE.md`).
- Every new crate needs a reason in the commit and must pass `cargo deny` (Apache-2.0-compatible licences, crates.io
  or the pinned Zed git rev only). Never Zed's GPL crates (ui, theme, editor, terminal, markdown, auto_update) — use
  them as reference only.

## Security

The per-launch secret is created here, given to the engine on stdin, kept only in memory and sent as `x-zorel-token`
to the local engine only; team servers use their own credential from the keychain. Links open only if http(s);
markdown never renders raw HTML. See `specs/019-native-desktop/research.md` R4.

## Platforms

macOS (arm64, x64), Windows x64, Linux x64 (Wayland + X11). CI: `.github/workflows/native.yml` on all three. State
plainly what could not be exercised live.

## Testing

Test behaviour, state transitions and data flow, not pixel sizes. One builder test per Zorel component. UI
integration tests (`#[gpui_kit::test]`, `TestAppContext`) assert state, focus, layout and accessibility. Contract
tests run against a real engine in a temp `ZOREL_HOME`.
