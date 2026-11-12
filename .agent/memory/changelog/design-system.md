2026-11-03 | DESIGN.md + sidecar created from the current tokens | /impeccable document (D19)
2026-11-03 | shadcn init --base aria; shadcn tokens → --z-*; primitives in src/ui; Button on React Aria | D19, user decision (aria, not Radix)
2026-11-03 | Input/Textarea/Select/Tooltip/Dialog on React Aria; native confirm() → ConfirmButton | D19
2026-11-03 | design moves to the UI phase, after phases 1 and 2 | user decision: start with the engine
2026-11-03 | tokens and DESIGN.md from the prototype; agent palette; text-dim contrast | start of the UI phase
2026-11-03 | missing primitives, /dev/ui gallery, check:ui (ratchet) in CI, detector on | UI phase step 1
2026-11-03 | navigation, popover, pill and layout primitives; default border in @layer base | UI phase steps 2 and 3
2026-11-03 | /dev/ui gallery removed | user decision: must not exist
2026-11-03 | desktop sidebar: only the tree scrolls without bar, fixed rows, overlaid actions, usage % only on alert | impeccable critique 24/40
2026-11-03 | sidebar on React Aria Tree with drag and drop, 28px rows, Chats section, desktop title bar | critique 23/40 + drag request
2026-11-03 | main screen redesign absorbed (sidebar, chat, composer) | user's choice in the artifact
2026-11-04 | polish of global components (concentric radii, offsets, integer line-heights) and home screen with ghost pickers outside the box | impeccable critique + user request
2026-11-04 | contrast (accent and light-theme grays), IconButton xs/sm/md, pill shape, header actions sm, document without scrolling | sweep of all screens + critical bug
2026-11-04 | Settings refined by impeccable critique: ListRow, status with action on providers, visible active nav, empty states, General split, storage with the browser | user request
2026-11-04 | Build with AI in full-screen steps and powers as pickers (no access / read / read and write) | user found it corporate; simpler, guided creation
2026-11-05 | agent colors: one lightness/chroma, hues clear of states and the blue, dark initial | old ones read as states (rose=danger, green=success, sky=blue) and white initials failed contrast
2026-11-05 | control tokens translucent instead of opaque greys | a secondary button vanished on surface cards
2026-11-05 | neutrals tinted toward the brand blue; floating layers translucent with shadow; selection in blue | the app read as dull grey and menus covered the chat like slabs (user: "muito opaco")
2026-11-05 | dark neutrals to the landing's graphite (chroma 0.005, sidebar a step above the rail) | user preferred the landing's tone over the stronger blue tint
2026-11-05 | New project and Add custom server open centred dialogs; projects are added by browsing folders | user: the project picker should be a centred modal that maps folders like T3 Code
2026-11-05 | Input size prop, SearchInput, OptionList/OptionRow; check:ui rules hand-search, hand-listbox, input-height | five hand-built search fields with different icon offsets and sizes; two hand-rolled listboxes; height classes on fields
2026-11-05 | IconTile, Notice; hairline lists through Rows; check:ui hand-list, hand-notice | ideas from the old design-system-pass worktree, rewritten on current main
2026-11-05 | agent avatars from open-bot-avatar in a tinted tile; Builder review takes the middle | user asked for friendlier avatars and a clearer proposal panel
2026-11-05 | project agent picker as avatar tiles, Builder chat fixed right, model per card | user: too compact, Assistant label, customize before create
2026-11-05 | FacePicker on home, project overview Team→Chats→About, sidebar folds under 900px | user asked for a more intuitive, fluid UI
2026-11-05 | FacePicker removed; Select gets option icons + search past 8 options | user: a row of faces does not scale to hundreds of agents
2026-11-05 | floating lists unified (focus blue, float surface, 6px rows), open triggers lit, popover body shrinks, team picker search | user asked for layout+polish of menus, inputs, selects, dropdowns
2026-11-05 | Popover triggers light while open (data-popup-open wrapper); context menu checked on screen | leftover items from the menus/selects polish
2026-11-05 | page sections become grouped cards (Rows) with SettingRow; replaces "rows on the canvas, never in cards" | user preferred the grouped-inset settings style
2026-11-05 | grouped settings adopted as the standard; check:ui hand-setting-row | user approved after seeing it in dev
2026-11-05 | focus rings only during keyboard navigation; home picks who answers with # (agent select removed) | user: blue ring after closing a select felt like a web page; # already does what the select did
2026-11-05 | model picker reasoning tabs → StepSlider footer; footer text removed, Providers gear on the rail | user found the picker cluttered
2026-11-05 | picker: fixed body height, unavailable providers just point to their settings page | user: squeezed rail, no "Add key" instructions in the picker
2026-11-05 | agent pages: rows instead of cards, grouped profile with kept drafts, filtered Knowledge route, routines dialog, Builder recovery; DESIGN.md one spec per surface | impeccable critique of agent pages, user: apply all
2026-11-10 | fields use bg-field (faint veil + border-strong), not bg-control | grey slab on dialogs
2026-11-10 | Team Desk redesign (spec 014: Onest/JetBrains Mono, soft-night palette, 14px scale, continuity spine, settings search) prototyped, partly applied, then fully reverted | user decided to keep the existing design
2026-11-10 | EmptyState gains inset (dashed row card) for empties inside a Section; MCP modes legend sm:grid-cols-4 | plain EmptyState in sections left the project Tools tab sparse
2026-11-10 | subtle motion across the app: sliding tab/segment pill, Fold cards, overlay exits, check fade, page crossfade | /impeccable animate
2026-11-10 | title bar drag note: .app-drag (Electron), not Electrobun | stale name
2026-11-10 | agent colors allowed beyond the avatar as the identity tint (chosen/live things about one agent) | user: the app felt lifeless
2026-11-10 | darker neutral scale, settling content swaps, per-tab tint, orbit backdrop, page editor toolbar + page headings | user requests
2026-11-10 | SETTLE moved from ui/tabs.tsx to ui/motion.tsx | motion primitives in one place
2026-11-10 | logo: blue core removed, one color | user request
2026-11-11 | logo core back, white like the rest (removing it was a misread) | user: the dot should be white
2026-11-11 | app-full: full-screen layers start under the desktop title bar | user: tabs hidden behind the macOS window buttons
2026-11-11 | soft button variant, onboarding patterns (opaque cards over the set, transform-only motion, core cut in the mark) | user feedback
2026-11-12 | spec 018 implemented: three token layers, new neutrals/blue #2a6af0/states/agent hues, 6-step type, 32/26 controls, radius 10/16, faces with white pill eyes + flat working ring, amber waiting, quiet links, personal action colour, Home first, search field, no New chat button, Builder card, week without side panel, first-run ready step | user asked for the design refresh spec and its implementation
