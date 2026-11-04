# design-system
keywords: ui, tailwind, tokens, theme, button, css, check:ui, avatar, provider icon, detector
status: active
updated: 2026-11-03

## current

- --z-* tokens in apps/web/src/styles.css; dark default, light via [data-theme="light"]
- @theme inline exposes tokens as utilities (bg-surface, text-muted, border-subtle, h-control*)
- control scale 24/28/32/36px (control-xs/sm/control/lg), inspired by a reference app
- primitives in apps/web/src/ui/ (index.tsx re-exports; button.tsx); features import from "@/ui" and do not style controls by hand
- shadcn initialized: components.json (style aria-nova, lucide icons, alias ui → @/ui); `bunx shadcn add X` generates into src/ui and the component is adapted to the tokens before use
- Button = React Aria (onPress, isDisabled; states data-hovered/data-pressed/data-focus-visible); no title prop, use <Tooltip content>
- React Aria primitives in src/ui: button, input (Input, Textarea, shared `field`), select (API by options; "" becomes key "v:"), tooltip, dialog (Dialog + ConfirmButton)
- destructive action uses ConfirmButton, never window.confirm
- native title still ok on non-interactive elements (badges, rows); Tooltip only on a focusable trigger
- web bundle ~827 KB min / 261 KB gzip after React Aria (was 605 KB); code-split per route if it gets heavy
- shadcn tokens (background, foreground, card, popover, primary, destructive, border, input, ring, *-foreground) point to --z-* in :root; radius sm/md/lg/xl/2xl = 4/6/8/12/16; `dark:` = default theme (no .dark class)
- cx = cn (`cn` package, Tailwind class merge)
- pressable: scale(0.97), <300ms, respects prefers-reduced-motion

- apps/web/DESIGN.md written (/impeccable document, scan): north star "The Night Workbench"; YAML frontmatter is normative (dark theme values); sidecar in apps/web/.impeccable/design.json
- named rules (as in DESIGN.md): Single Voice (only one blue accent), Token, Four Sizes (11/12/13/15px), Scale (24/28/32/36), Flat (no shadows, depth by tone)
- changed a token in styles.css → update DESIGN.md and the sidecar together

- screens prototype (canvas): https://claude.ai/artifact/ERkKURix2bnKAqzi97emmw — frame + card radius 16, tree sidebar (folder, tree row without background, status on 2nd line with spinning icon/clock), General = chats without project, expandable activity pill, pending approval/receipt, model picker with account rail and logos (@lobehub/icons-static-svg 1.102.0, MIT), right panel Changes/Files (@pierre/diffs), bottom panel Terminal/Tests/Problems/Processes/Logs, settings with connectors/MCP/skills
- decided (2026-11-03): the prototype's dark theme is the default (light only swaps values, neutral); agent identity palette (6 colors, --z-agent-1..6) only on avatars (A Regra do Avatar / The Avatar Rule); text-dim #8a8a8a (5.0:1) and in light muted #666/dim #757575; Agents section = agents of the open project
- DESIGN.md and tokens updated from the prototype (sidebar = frame tone, surface #232323, borders 6%/10%, tokens accent-faint/line, success-faint/line, diff-add/del, code)

- UI phase step 1 (2026-11-03): primitives Switch, Tabs (pills), Menu, IconButton (label required), AgentAvatar (16/20/28/32; `tone` = agent order in the project, else hash of the id), ProviderIcon (lobehub; Claude in color, the rest mono currentColor; aliases claude-cli/anthropic, codex-cli/openai), Spinner (currentColor, stops in reduced motion), ChatStatusIcon (running/waiting/failed); lucide icons re-exported by ui/icons.tsx
- no /dev/ui gallery (removed 2026-11-03, user decision): check primitives on the real screens, in both themes
- `bun run check:ui` (scripts/check-ui.ts) in CI: per file/rule ratchet in apps/web/ui-baseline.json (literal-color, arbitrary-value, raw-control, direct-import, glyph-icon); src/ui exempt; `--update` locks in improvement. Debt zeroed in step 3
- impeccable detector: .impeccable/config.json (hook on; ignore 9px = initial of the 16px avatar); local manifest in .claude/settings.local.json points to $HOME/.claude/skills/impeccable (skill is global, the installer did not find a folder in the project)
- NOTICE attributes Lobe Icons (MIT)

- UI phase steps 2 and 3 (2026-11-03): new primitives NavItem, NavLabel, GroupRow, TreeItem (nav.tsx), Popover, ConfirmDialog/controlled Dialog, FieldButton/RailButton/OptionButton (picker.tsx), DisclosurePill/Dot (pill.tsx), Screen/Column/Section/Rows/EmptyState/Meter/Code (layout.tsx), BareTextarea, pickFiles, ModelAvatar; Meter only warns with warnAt
- `* { border-color }` lives in @layer base: outside a layer it overrode Tailwind's border-* (all colored borders)
- ui-baseline.json zeroed: screens without check:ui debt
- token --font-mono (ui-monospace)

## avoid

- shadcn's bg-muted / bg-accent / bg-secondary: those names are ours (dimmed text, blue, secondary text). When adopting a component, swap for bg-control/bg-control-hover
- Geist font and Nova preset neutral palette: removed; the font is Inter

- literal color outside styles.css: breaks light theme
- provider logo on white background (Codex color variant had a white tile): use the mono one
- a11y props via conditional spread on the svg: biome does not see them (noSvgWithoutTitle)
- copying CSS/code from a reference app: PolyForm Noncommercial license

## target (D19, ARCHITECTURE 10.3)

- authority: apps/web/PRODUCT.md (/impeccable init, Operate mode) + apps/web/DESIGN.md (/impeccable document, YAML tokens)
- primitives in apps/web/src/ui/ as the only visual API; complex ones on top of React Aria Components (via shadcn --base aria); screens never import headless/icons directly
- a reference app foundation (ideas only): scale 24/28/32/36, dark default + light only swaps values, tokens only, hover only on fine pointer, scale 0.97, <300ms + reduced motion, required states + keyboard + label
- impeccable flow: shape before a new screen; detector on (hooks on); audit when finishing a screen; one polish pass when closing a phase; harden/clarify for errors and i18n; extract when a component repeats in 2+ screens
- check:ui in CI (literals, scale, hand-made button/dialog, direct import of headless/icons); neither Storybook nor gallery
- shadcn (CLI 4.x) as GENERATOR of the primitives: `shadcn init --base aria` (React Aria Components; NOT Radix nor Base UI, user decision 2026-11-03), code copied into src/ui and ours; shadcn semantic tokens mapped once to --z-*; nothing from the neutral palette/default --radius; heights on the 24/28/32/36 scale
- scrollbars: no scrollbar-color/scrollbar-width on :root (inherits and makes Chrome/WebKit ignore ::-webkit-scrollbar); only in @supports not selector(::-webkit-scrollbar). Desktop-style areas use .scroll-quiet (no bar) + hairline on the edges with hidden content
- sidebar: brand (= title bar on desktop: class electrobun-webkit-app-region-drag, .title-inset gives 84px to the window buttons with data-shell=desktop), Needs you/Knowledge/Usage and Settings fixed; only the trees scroll; 28px rows (h-control-sm) and shrink-0; projects/chats are NavTree/NavTreeItem (React Aria Tree); actions overlay the count on hover/focus with pointer-events-none when hidden; chats without project in the Chats section
- loose numbers in navigation only when actionable: Usage % shows from LIMIT_ALERT on, with aria-label/title naming account and window
- drag and drop: useNavReorder (ui/nav.tsx) on top of React Aria's useDragAndDrop; only reorders within a group (getDropOperation cancels 'on' and other groups); no new lib
- I18nProvider with Zorel's locale() in main.tsx: React Aria strings (drag, collapse) follow the interface language, not the browser's
- cn knows the theme tokens (lib/utils.ts): when creating a new spacing/radius token in styles.css, add it there too
- 2026-11-03: redesign "Zorel — main screen" (user's artifact) absorbed: 264px sidebar without brand, sections in normal case, project = arrow + state (dot/spinning), chat = wide row with avatar 32, title+age, status or preview (Chat.preview/lastAt), raised chip (shadow-chip), icon bar at the foot; activity pill without background next to the name; approval in one line; composer in one bar with round send; token bg-hover (#222)
- sidebar: Needs you first and fixed; no agents section (they live in the project settings); chat with 2+ agents shows the row of 16px avatars before the preview
- motion: Motion only where CSS cannot do it (width/height auto, layoutId); one spring (spring in ui/motion.tsx); reduced motion respected via MotionConfig
- polish 2026-11-04 (impeccable critique+polish): integer line-heights (--text-*--line-height 16/16/20/22); Select popup = Menu surface (rounded-card, p-1, items rounded-md); offset 6 on Select/Menu/Popover/Tooltip; entry fade+zoom 0.98; tooltip min-h-control-sm; segmented 28 (pill h-5.5 rounded-md); TabList nowrap with scroll; Select variant "ghost" + icon (home screen: project and agent above the box, box only with model as in chat)
- 2026-11-04: colors — accent #0071e3 (white 4.7:1), hover darkens #0062c4; light: muted #5a5a5a, dim #6b6b6b (≥4.5 on the frame). IconButton xs/sm/md = 24/28/32 (default sm); Button/IconButton shape="pill" instead of rounded-full; header actions always size sm; document never scrolls (html/body overflow hidden; card and screen body relative because of React Aria's hidden <select>). Sweep of all screens: Select/Menu popups r12 p4 items 28/r6 gap 6
