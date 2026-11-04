# desktop
keywords: desktop, electron, app, build, dmg, signing, path, macos, window, tray
status: active
updated: 2026-11-04

## current
- system (2026-11-04): window permissions only notifications, clipboard-sanitized-write, fullscreen (clipboard-read removed: nothing reads); IPC notifications:settings opens the system notification settings (macOS x-apple.systempreferences:com.apple.Notifications-Settings.extension, Windows ms-settings:notifications); awake:get/set stores keepAwake in userData/desktop.json and holds powerSaveBlocker "prevent-app-suspension" only on AC power (powerMonitor on-ac/on-battery). No Computer Use: no microphone, screen recording, accessibility or Apple Events
- security (2026-11-04): main generates the session secret (randomBytes), passes it to the server via ZOREL_SESSION and injects the x-zorel-token header via session.defaultSession.webRequest.onBeforeSendHeaders (only for the server host; agent tabs use other partitions); will-navigate and setWindowOpenHandler compare by origin (ours()), same-origin link becomes downloadURL; health check accepts any response.
- best practices (2026-11-04): appMenu() without Reload/DevTools outside dev, edit-only context-menu, setVisualZoomLevelLimits(1,1), permissions() only for the window, electronFuses in electron-builder.yml (verified with `bunx @electron/fuses read`), dock icon in dev, update via IPC update:get/update:install/update:check (check: "latest"|"available"|"failed"|"unsupported" in dev) + "update" event {version, ready, percent} (percent from download-progress, integer) → UpdateCard at the foot of the sidebar (progress and Restart) and UpdateItem in the rail (sidebar.tsx); checkForUpdates (not ...AndNotify: the notice is in the app)
- icon: assets/icon.svg on Apple's grid; scripts/icons.sh uses headless Chrome with --default-background-color=00000000 (qlmanage paints the margin white)

- CI/release in a macOS, Windows, Linux matrix (2026-11-04); binary zorel-server(.exe); CSC_LINK only on the macOS runner (Windows would use WIN_CSC_LINK); repo still without remote

- D11 implemented (2026-11-04): apps/desktop is Electron 45 (main in src/main.ts, cjs bundle by `bun build --target=node`); the server runs as a child process: `bun apps/server/src/main.ts` in dev, `bun build --compile` binary (build/zorel-server, ~95 MB) bundled in Resources, with web/ and drizzle/ (ZOREL_WEB_DIR, ZOREL_MIGRATIONS)
- chromium-bidi stays external in the compile (playwright-core requires it only in BiDi mode, which Zorel does not use)
- closing the window destroys the renderer but keeps app + server (routines and turns continue); Dock (macOS) or tray (others) reopens; Quit kills the server (SIGTERM)
- server exits by itself if the parent dies: ZOREL_PARENT_PID checked every 5 s (main.ts watchParent)
- single instance; external links go to the default browser; window only navigates within its own origin; sandbox + contextIsolation
- few resources: disable-features SpareRendererForSitePerProcess, HardwareMediaKeyHandling, MediaRouter; electronLanguages en + pt-BR; measured ~215 MB Electron + ~80 MB server with window open
- login shell PATH read at startup (Finder apps do not inherit PATH)
- web: `?shell=desktop` → data-shell; `.app-drag` (CSS -webkit-app-region) on the rail, sidebar top and screen/chat headers; controls inside stay no-drag via selector
- signing: Developer ID only (CSC_LINK/CSC_KEY_PASSWORD; APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID to notarize). Ad hoc and "Apple Development" are rejected by AMFI on this macOS (tested). Without Developer ID: `bun run desktop`

## avoid

- Playwright newPage/newContext in Electron: Target.createTarget not supported; tabs are created by main
- detecting a human via before-mouse-event/input-event: input via CDP also fires them (tested); use the transparent layer

- letting electron-builder pick a certificate from the keychain: it took an Apple Development one and produced an app macOS kills (SIGKILL without message)
- server inside Electron's main: dies with the window and would require Node instead of Bun
- agents' browser: there is NO native browser nor remote-debugging-port (removed 2026-11-04: unauthenticated CDP gave control of the window to any local process); the server uses its own Chromium over pipe and the panel streams frames; the build embeds Playwright's chromium-headless-shell (script "browser", extraResources browsers, PLAYWRIGHT_BROWSERS_PATH in the bundled server's env)
- __dirname is pinned by bun build to the src path: use app.getAppPath() (preload, icon, root in dev)
- desktop title bar (TitleBar in sidebar.tsx, h-12, pl-21, like a reference app): macOS buttons (trafficLightPosition 18,18), back/forward (brand lives in the rail, no + button); page header (Screen and chat) uses ui PageHeader: on desktop it portals into #titlebar-slot, title 12px from the card edge (left group w-77 = rail + sidebar; when collapsed, follows the arrows). Flag read inside App (main.tsx sets data-shell after the imports)
- 2026-11-04: open at login (ipc login:get/set only from the app window; opened by login does not open a window) and electron-updater 6.8.11 (checkForUpdatesAndNotify on open and every 6 h; publish github with fixed owner/repo of owner/repo in electron-builder.yml; mac target dmg+zip); release script (electron-builder --publish always) and release job in CI on tag v*. Test the desktop with another instance: --user-data-dir=<folder> (single instance per userData)
- version: `version` in apps/desktop/package.json (0.2.0 on 2026-11-04); tag v<version> triggers the release job
- without Developer ID: afterSign signs ad hoc and the update on macOS runs the release's install.sh (runInstaller); BUT macOS 27 blocks ad hoc apps (syspolicyd "Evaluating blocked code", and the .app vanished from the folder) even without quarantine — only Developer ID runs bundled; Windows/Linux update by themselves without signing
