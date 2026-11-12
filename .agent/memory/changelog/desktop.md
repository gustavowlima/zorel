2026-11-04 | desktop moves from Electrobun to Electron (server stays Bun as a child process; native WebContentsView tabs driven over CDP) | native in-app browser controllable by agents; WKWebView has no CDP
2026-11-04 | Electrobun replaced by Electron; server as compiled child process | D11, desktop phase request
2026-11-04 | agents' native browser via WebContentsView + CDP, partition per agent | D11
2026-11-04 | full-width title bar on desktop, instead of the adjusted divider | user request
2026-11-04 | open at login, automatic update and release in CI | item 1 (Developer ID still missing)
2026-11-04 | CI and release for Windows and Linux besides macOS | rule: everything on the three systems
2026-11-04 | menu/context/zoom/permissions/fuses, icon on Apple's grid, update notice in the rail | request: Electron best practices and updated icon
2026-11-04 | version 0.2.0; install.sh + ad hoc signing + manual update on macOS; macOS 27 rejects ad hoc | request: strategy without certificate (tested: does not run on macOS 27)
2026-11-04 | session secret via header from main; navigation by origin | audit: API without credential; prefix accepted http://127.0.0.1:PORT@other
2026-11-04 | removed browser-host.ts and remote-debugging-port; agents use the server's Chrome over pipe | Electron CDP without authentication
2026-11-04 | no clipboard-read in the window; keep awake on AC power; shortcut to notification settings | review of the window's permissions
2026-11-04 | no keychain identity discovery; ad hoc signs the bundled Chromium | a revoked Apple Development cert made macOS flag the app as malware and trash it
2026-11-11 | quit question in Zorel's own dialog, native as fallback | user: native dialog off the design system
2026-11-11 | electron-vite for build and dev (HMR, main restart) | user: desktop is the focus
2026-11-11 | own computer: host option, lent folders, live state, start/restart/open; Podman always when installed; app icons | user request
2026-11-11 | no bundled Chromium: Chrome/Edge first, else one download into the data folder; idle browser closes after 15 min | smaller app, less memory
2026-11-11 | desktop connects to team servers (own window and partition each); local server starts only when needed | user request
2026-11-11 | spec 017 P1: server picker, window swap in place, on-demand check | user request
2026-11-12 | spec 019 planned: native GPUI client proposed to replace Electron, gated by a measured prototype | Electron shell measured at ~530 MB idle and 243 MB of a 571 MB app
2026-11-12 | D11/D20 rewritten: the desktop client is native (GPUI, apps/native), the engine stays Bun | owner waived the prototype gate after the 73 MB vs ~530 MB idle measurement
2026-11-12 | native client uses gpui-component too, themed from styles.css | owner: use gpui-kit's components; tokens drive the kit's 99 colour keys
2026-11-12 | native Home built (composer, Needs you, Working now, Today); crew rules in state/crew.rs | parity with apps/web home.tsx and the prototype
