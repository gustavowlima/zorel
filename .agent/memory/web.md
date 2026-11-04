# web
keywords: web, files, explorer, file tree, react, ui, chat, sidebar, route, knowledge, inbox, needs you, usage, model picker, settings, i18n, atoms, atom, client
status: active
updated: 2026-11-03

## current
- Git panel (2026-11-04): GitStatus.files is now {path, status} (parsePorcelain); StatusMark lives in @/ui (status-mark.tsx); Settings uses one centered max-w-5xl column for all pages
- Files (2026-11-04): FileTree (React Aria Tree, no new dep) + FileIcon (simple-icons by extension, lucide for the rest) in @/ui; FilesTab in workspace.tsx calls mutations.fs (op create/rename/move/delete/restore/open/reveal) and invalidates "workspace"; delete asks no confirmation: goes to Zorel's trash and shows Undo; file tabs (1st is always the tree, state per chat in the openFiles Map), virtualized tree (rowHeight 28 in ListLayout: change together with h-control-sm), search filters by name
- sidebar (2026-11-03): brand, fixed pages (Needs you/Knowledge/Settings), stacked sections Chats (no project) and Projects with icon, collapse and +, no tabs (user asked); chats on 1 line of 32px; list with fade + bottom hairline only when there is more below; foot = usage per window (paceOf in labels.ts, card on hover); one icon column 20px at x20–40 and text at x50

- UI phase done (2026-11-03): all screens rewritten from the prototype, in English, with atoms
- routes in the hash (state.ts): #/ (home = new chat), #/new/:projectId, #/chat/:id, #/project/:id[/agents|tools], #/agent/:id, #/agent/new/:projectId|global, #/knowledge[/:id], #/inbox, #/usage, #/settings/:tab
- data = atoms (client.ts, D4): `Zorel` (AtomHttpApi) and `Live` (AtomRpc). Query per resource with reactivityKey; mutation passes `reactivityKeys` and reruns the queries. `useList(atom)` gives an array; `useMutation(atom)` gives a promise
- chat = Atom.family(subscribeChat) + Stream.scan(reduceChat); do NOT use AtomRpc's stream query (accumulates in PullResult batches)
- live status: statusAtom (keepAlive) over subscribeStatus; App invalidates chats/memories/usage/approvals when a chat leaves running (the server changes title and memories on its own)
- manual invalidation: invalidateAtom (Zorel.runtime.fn + Reactivity.invalidate); the runtimes share the memoMap, so a single Reactivity
- screens: sidebar.tsx (tree + status), home.tsx (creates the chat on the 1st send/attachment), chat.tsx (timeline, pill, approval, receipt, handoff), composer.tsx, model-picker.tsx (accounts rail + reasoning), people.tsx (author avatar, TeamPicker), inbox.tsx, knowledge.tsx, usage.tsx, settings.tsx, mcp.tsx, project.tsx, agent.tsx
- labels.ts: model/provider names, scope, title (legacy "Novo chat" becomes "New chat"), status, agentTone (position in the project)
- text only via t() from @zorel/i18n; check:i18n (AST with @babel/parser) in CI
- theme: preference in localStorage "zorel.theme" (system/dark/light), Settings › Appearance
- vite dev proxies /api and /rpc (ws) to 4317

- new project: popover on the sidebar "+" (NewProjectButton in project.tsx: name + optional brief), not a page; on create goes to the overview

- failover: features/failover.tsx (FailoverEditor + useTermsPending) on the agent and in the chat's "Fallbacks…" dialog; switch note in the chat (live failover event, message.switches stored); account usage/wait in Usage and in the model picker

- workspace in the chat: features/workspace.tsx (TurnChanges, WorkspacePanel Changes/Files, TerminalPanel), diff-view.tsx (@pierre/diffs FileDiff inside the diff worker pool of diff-pool.tsx, theme via useResolvedTheme, token colors via unsafeCSS, loaded on demand); project folder in the overview and in the new project popover; access level with ChoiceCards on the agent page
- App revalidates everything every 2s while offline (failed atoms do not retry on their own)

## avoid
- do not remove the `shadcn` devDependency: styles.css imports `shadcn/tailwind.css` (variants data-open/data-disabled…); vite dev keeps working from cache and only `bun run build` breaks (happened in 87abda4, fixed on 2026-11-04)

- @pierre/diffs without WorkerPoolContextProvider: with StrictMode + disableFileHeader the diff is empty, no error (lib bug)

- line-clamp inside a flex Button: height 0; use truncate
- global CSS rule outside @layer (e.g. `* { border-color }`): beats Tailwind v4 utilities
- Focusable around a React Aria button in Tooltip (console warning); TooltipTrigger accepts the Button directly
- formatAge for very old dates: above 8 weeks shows the date
- usage (phase 2c): usage.tsx (ranges, totals with cost, chart per UTC day, subscriptions, top turns, 80% alert; no CSV export (removed on request)); limits.tsx (LimitWindows, compact in the picker); FullestLimit in the sidebar; cost and account in the reply footer
- usage days are UTC: the month starts at Date.UTC and the day label uses noon (dayLabel) so it does not slip back a day in the local timezone
- useReadOnOpen reads limits one account at a time: the mutation atom is shared and a second call aborts the first (499)
- labels.rememberModels (called in App) stores the real model names; modelName/modelNote use them and fall back to the aliases
- usage.tsx (2026-11-03): total hero (cost or tokens), harness list = legend, AreaChart (own SVG, no lib; keyboard slider), Totals, Breakdown (Day tab = chart as table); series colors in --z-series-N per harness in fixed order (HARNESSES)
- connectors (2026-11-04): Settings "mcp" tab is called Connectors; mcp.tsx CONNECTORS (fixed catalog, matched to server by url or command) in cards; OAuth opens the URL with window.open and polls signedIn every 2 s for up to 5 min; connector servers disappear from the "Custom servers" list; logos via simple-icons 16.35.0 (per-icon import, ~10 in the bundle; Playwright/Context7 without a brand use Plug); attention state (refused or OAuth without token) shows Reconnect; ⋯ › Test connection (inspect) and automatic test after connecting with token/without login
- chat (2026-11-04): tokens --container-chat (max-w-chat) and --text-chat; ChatMarkdown (chat-markdown.tsx) uses CodeBlock/TableFrame/ShimmerText from ui/code-block.tsx; PendingTray above the composer; bare Reply in solo chat; Message.durationMs (column messages.duration_ms) in the turn summary
- processes.tsx (2026-11-04): Settings › Processes ("processes" tab between skills and storage) + ChatProcesses in the chat header (only with the chat's server/terminal/session); useRows joins GET /api/processes with useStatuses
- settings: tabs providers (providers.tsx: Connected/Other list + per-provider page at #/settings/providers/<id> with sign-ins, API key, local server, models), mcp, skills, appearance; old links #/settings/accounts|keys fall into providers; providerPageOf(harness) takes the model picker to the right page
- i18n: no catalog branch may have an `other` key with text (lookup treats it as plural); plurals only one/other in English
- audit.tsx: Settings › Audit log (filter by type + search, phrase per action in audit.actions.*, fields before → after with model and access labels); reloads on open (mutations from other screens do not invalidate "audit")
- storage.tsx: Settings › Storage (hero ≥48px, segmented bar + legend, projects, largest chats, clear with confirmation)
- lib/utils.ts: cn = createCn with the theme tokens (spacing control*, radius inline/control/card/sheet); without it h-control and h-auto do not cancel each other
- i18n lookup: plural only when there are `one` and `other` as text; a branch with an `other` key is a branch
- dev: the development Vite sometimes does not generate classes from new files; restarting fixes it (the build generates them)
- composer.tsx: Tiptap (ComposerSources: # leads, @ agents, $ skills, / commands; chips become text @handle/$handle via renderText); queue.tsx (local queue per chat in localStorage, drains on its own when !busy; steer/edit/delete); context-meter.tsx (GET /api/chats/:id/context); TeamPicker in the header
- browser testing: do not clear the editor with execCommand (leaves garbage in ProseMirror); use Meta+A and Backspace
- shell.tsx: socket unmounted before the "s" frame (StrictMode mounts 2x in dev) sends {"t":"k"} when the id arrives; without it each new tab left an orphan shell (and a script running twice)
- TerminalPanel: ▷ Run a script (tab labeled with the script) and Servers (opens localhost:N in BrowserPanel via chat.openInBrowser → openUrl prop, which sends newtab+nav)
- git.tsx: GitControl in the chat header (git repo only); popover with commit (Write it for me → gitDraft), push/publish, PR (editable draft; hidden on the base branch), New branch
- side panel (user request): workspace.tsx SidePanel with tabs changes/files/browser/terminal (type SideTab); chat.tsx keeps only `panel: SideTab | undefined`; header = GitControl + one panel button (no Changes/Browser/Terminal buttons). BrowserPanel and TerminalPanel no longer have their own aside/height/close; the last closed shell remounts the terminal (shellKey)
- pin (usePins in workspace.tsx): localStorage zorel.pins.side (global) and zorel.pins.shell.<chat>; ContextMenu on SidePanel tabs (data-side-tab) and Terminal tabs (data-shell-tab); shortcuts in ChatHeader (data-pin "side:x"/"shell:id"); closing the shell removes the pin. Chat ⋯ menu lost "Summarize and learn" (duplicated Compact now from the context meter)
- Git is the SidePanel "git" tab (GitPanel in git.tsx; useIsRepo); GitControl in the header only opens that tab. GitStatus.commits (last 15, pushed = outside ahead). Panel tabs: sr-only label below container @3xl (aside @container)
- diff-view.tsx: enableLineSelection + onLineSelectionEnd → controlled selectedLines + lineAnnotations with CommentBox (renderAnnotation); onComment → plain text in the composer (SidePanel.onAddToChat is plain text; the Terminal wraps with ``` itself). Test selection by script: pointerdown/up on the parent of [data-line-number-content] inside the diffs-container shadowRoot
- GitControl only shows in the title when the git tab is pinned (pins.side includes "git")
- Terminal: closable(tab) = more than one tab or shell ended; drop() that empties creates a new shell (no remount: the cached server list brought the closed shell back → "The shell ended")
- agents.tsx: route #/agents (AgentsView, AgentRow, useWorking); chat invalidates "agents" when the message count changes (agent may have created a colleague)
- routines.tsx: AgentRoutines on the agent page, OUTSIDE the profile <form> (nested form broke submit)
- icon rail (user request): Rail in sidebar.tsx (places + vertical UsageFoot + Settings), Sidebar only with Chats/Projects; App.tsx renders Rail + Sidebar; route #/routines (RoutinesView); Tooltip gained placement
- ChatItem in the sidebar: 2 lines without icon (NavTreeItem detail; nested uses pl-10): title + age/spinner; below 16px avatars + member names, or model, or live state. Section NavLabel without icon (user request: less cluttered)
- project in the sidebar: aligned subtitle (no folder/bold), chevron slot="chevron" after the name, dim count on the right; nested chats pl-6 with hairline at left-3
- collapsible sidebar: useSidebar in state.ts (localStorage zorel.sidebar.hidden, ⌘B); Rail has a PanelLeftClose/Open button and active Chats toggles; rail with border-r
- motion 12.43.0 (user request: animate the sidebar): ui/motion.tsx exports spring, Fold (auto height with AnimatePresence), SlideWidth (width, stays mounted, inert when closed), Marker (layoutId) and MotionConfig (reducedMotion user in main.tsx). Do not mix transition-* classes on motion elements
- notify.tsx: useNotifications(route) in App (Notification API, transitions via noteworthy() in labels.ts), NotifySetting in Settings › General (localStorage zorel.notify). Pause: button on the rail + strip in App
- Cmd+K: ui/command.tsx (CommandPalette with RAC Autocomplete+Menu, no internal filter) and features/palette.tsx (places, chats/projects/agents filtered on the client, messages via GET /api/search with 180ms debounce)
- edit from here: MessageActions onEdit (user msg only, no live turn) → RewindDialog → mutations.rewind → useAtomRefresh(chatAtom) + setDraft with the text
- mcp.tsx CATALOG (presets that fill NewServer; no OAuth). project.tsx Agents: default agent Select
- pages.tsx (PageView with prose-chat Markdown, editing, Versions; NewPage); knowledge.tsx gained a "page" filter
- 2026-11-04: Agents with one New agent button (menu: Build with AI, Blank, Import) and ⋯ per row (open, export, delete); NewAgentMenu/useDeleteAgent in agents.tsx also in the project's Agents tab. Build with AI screen = features/builder.tsx (route builder, #/build/<p>): Timeline exported from chat.tsx + Composer, preview parsing zorel_create_agent args (draftsOf). Builder (a.builtin) excluded from lists and pickers. Agent page in tabs (Profile, Tools and access = features/permissions.tsx, Knowledge and activity)
- web tests now run in the root bun test (apps/web included)
