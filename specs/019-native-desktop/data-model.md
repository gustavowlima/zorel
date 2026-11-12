# Data Model: Native Desktop Client (spec 019)

No new engine tables. The client holds only connection state and a mirror of what the engine streams.

## EngineConnection

| Field | Notes |
|---|---|
| kind | `local` \| `team` |
| origin | `http://127.0.0.1:<port>` for local; `https://…` for team |
| credential | local: per-launch secret in memory only; team: keychain entry keyed by origin |
| state | `starting` → `ready` → `reconnecting` ⇄ `ready`; any → `down` (with reason, log path) |
| apiVersion | from `/api/server`; mismatch with the client's schema version → team server opens in the system browser |

Transitions: `starting` times out after 30 s → `down`; socket close → `reconnecting` with backoff (0.5 s → 10 s);
resubscribing replays a `snapshot` (engine rule: reconnecting is subscribing again).

## Mirror state (per window)

- **ChatList / Status**: from `subscribeStatus` + chats REST; source for sidebar, Home "Working now", Needs you counts.
- **ChatView**: from `subscribeChat` (snapshot then events); rows have stable ids, cached heights; streaming tail kept
  separately so only it is re-parsed.
- **Approvals / Notices**: from `approvals` query + `notices` stream; drive system notifications.
- **Drafts**: composer text per chat, kept in memory and in the window-state file so a crash or reconnect loses nothing.

## Local files (app data folder)

No migration from Electron's files: Zorel is in development and the native app starts clean.

| File | Content |
|---|---|
| `servers.json` | team servers `{ origin, name }`, `last` |
| `prefs.json` | open at login, keep awake, window bounds |
| `window-state.json` | drafts, last route |

## DesignTokens (packages/design-tokens)

One source: `{ themes: { light, dark }, color.*, type.*, radius.*, space.*, motion.* }` → generates the `--z-*` block
in `apps/web/src/styles.css` and `apps/native` theme data. The 252 current `--z-*` declarations are the seed.

## ParityItem

`{ area, item, web_ref (file:line), native_state: todo|done|n/a, os: {mac, win, linux} }` kept as a table in tasks.md.

## PrototypeReport

`{ machine, os, build, procedure_version, metrics: {idle_mb, scroll_growth_mb, slow_frame_pct, launch_s,
frames_fps_browser}, electron_baseline: {...}, screen_build_hours: {native, web}, decision: go|no-go, notes }` saved as
`specs/019-native-desktop/prototype-report.md`.
