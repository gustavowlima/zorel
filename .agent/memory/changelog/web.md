2026-11-03 | screens rewritten from the prototype, atoms (AtomHttpApi/AtomRpc), i18n en, api.ts/accounts/memories/tools removed | UI phase steps 2 and 3
2026-11-03 | changes panel, undo, terminal, project folder, access level | phase 3
2026-11-03 | diff back to @pierre/diffs with worker pool | the failure was the StrictMode + disableFileHeader bug without a pool
2026-11-03 | Usage screen rewritten, limits in the picker and the sidebar, real model names | phase 2c
2026-11-03 | Usage screen redesigned (hero, harnesses, stacked area, totals, breakdown) | user request: usage readable at a glance
2026-11-03 | Accounts + API keys become Settings › Providers (list and per-provider page) | user request: one place per provider
2026-11-03 | Settings › Storage; cn with theme tokens; plural lookup fixed | user request + bugs found
2026-11-03 | composer in Tiptap with # @ $ /, message queue, context meter; agent picker left the field | user request
2026-11-03 | sidebar: icon tabs replaced by named Chats|Projects switch; Knowledge/Settings back as fixed rows; usage foot as per-window bars | impeccable critique 21/36 (consistency 1)
2026-11-03 | sidebar: tabs and Chats|Projects switch removed; stacked sections with icons; chats on one line | user: too cluttered, prefers no tabs
2026-11-03 | terminal: Run a script, Servers; orphan shell fix in StrictMode | phase 3c
2026-11-03 | GitControl in the chat header | git actions without leaving the chat
2026-11-03 | Changes/Files/Browser/Terminal become tabs of a resizable side panel; header with a single button | user request: one panel instead of scattered buttons
2026-11-03 | pin panel tabs and shells to the title row (right click); ⋯ without Summarize and learn | user request
2026-11-03 | Git leaves the popover and becomes a side panel tab, with files and commits; icon-only tabs in the narrow panel | user request
2026-11-03 | comment diff lines → composer; last shell does not close; Git in the title only when pinned | user requests: review diffs in the chat flow
2026-11-03 | Agents screen in the sidebar | phase 4, user request
2026-11-03 | icon rail on the left with the app's places; sidebar only with chats and projects; Routines screen | user request
2026-11-03 | sidebar chats in 2 lines without icon, with participating agents; sections without icon and more spaced | user request
2026-11-03 | projects in the sidebar as subtitles aligned to the chats | user request
2026-11-03 | divider between rail and sidebar; collapsible sidebar (button, ⌘B, Chats) | user request
2026-11-03 | content card at 100% height, flush right, radius only on the left | user request
2026-11-03 | Motion (motion.dev) in the sidebar: collapse, sections and rail highlight | user request; dependency: animate auto width/height and layoutId without unmounting
2026-11-03 | chat at full panel width (no 720px column) | user request
2026-11-03 | Cmd+K with message search | item 3 of the list
2026-11-04 | Build with AI becomes a fixed screen; internal Builder; Agents page with a single menu | user request
2026-11-04 | Build with AI in three steps (powers, first task); Builder ceiling = workspace; browser only if requested | live test showed wrong access and duplicated card
2026-11-04 | Build with AI without the first task step (Describe → Powers → agent page) | user request
2026-11-04 | ready-made agent templates, project picker in Build with AI, gateway deadline longer than the approval's | items 4 and the 60 s timeout bug
2026-11-04 | ready-made templates removed from the agent form; agent store goes to the backlog | user decision
2026-11-04 | Settings › Connectors in cards; form pill catalog removed | user asked for connectors like GitHub/Notion
2026-11-04 | connectors with logos (simple-icons) and Reconnect state | user asked for logos and a visible reconnect state
2026-11-04 | Test connection on connectors + test on connect | user asked for a connection test
2026-11-04 | renamed Zero → Zorel (texts, packages, localStorage migrated) | user chose the name Zorel
2026-11-04 | ponytail review+audit: removed signOut, AvatarStack, Card, windowShort, SessionAccess, TeamToolName, MODEL_OF_ACCOUNT/accountProviderOf, shadcn dep | unused code
2026-11-04 | Zorel Z logo; sidebar rereads chats created by the server | rename and tasks between agents
2026-11-04 | Settings › Processes and process count in the chat header | user asked for a background processes page, also per conversation
2026-11-04 | lean Processes: summary with CPU/memory icons, one list with columns, icon actions; no hero, sparkline or bars | user found the page cluttered
2026-11-04 | chat: max-w-chat reading column, text-chat 14px, no avatar in single-agent chat, turn summary with duration, ShimmerText, PendingTray, ChatMarkdown with CodeBlock/TableFrame | user request: more readable chat
2026-11-04 | "handed back"/"agents stopped" notes, placeholder with the follow-up target, Steer only in Codex | conversation between agents
2026-11-04 | SortableList (drag and keyboard) in fallbacks; Changes groups expand and collapse | user requests
2026-11-04 | Files becomes an explorer (FileTree, FileIcon, mutations.fs) | user asked to rename/select/delete like in VS Code
2026-11-04 | Git panel redesigned, StatusMark in @/ui, Settings in a max-w-5xl column | request: flawless PR screen; Settings pages misaligned and narrow
2026-11-05 | sidebar: section icons, search button, project folder + ⋯, chat avatar and 'Agent · model' line, empty states (reverts earlier no-icon rows) | user asked for a more intuitive chats list (designer spec)
2026-11-05 | '#' in the composer calls an agent (@handle chip, outside agents join the chat) instead of changing the lead | user could not call an agent from the box; lead stays in the header team picker
2026-11-05 | Work tab and live status on Agents screen; row opens Work, gear opens Profile | user asked for agents' activity on the Agents screen
2026-11-05 | live work pill moved below the streaming text; label held between steps | it flickered on every new step and sat above the text
2026-11-05 | live steps list opens by default and shows title + detail per step | the user should see the steps without opening "Working"; contract got `detail`
2026-11-05 | live steps open/folded is a per-browser switch in Settings > General (default open) | the user wanted it open but customizable
2026-11-05 | StoredStep with a title is a collapsed summary row that opens to command and output | stored Step now carries title/detail; old steps keep the previous layout
2026-11-05 | finished steps: "Done ·" prefix, per-step duration, Thought/Replied rows without chevron; Stop button beside the live pill | match the a reference app summary; timing now saved by the server (Step.ms, thought/reply steps)
2026-11-05 | Stop beside the live pill is wired (chat and builder) and only shown when one turn is running; "Done" only on replies without error | review: Stop was dead code, and Done showed on stopped/failed replies
2026-11-05 | Send now says what happened (joined or stopped) and the queue shows replies ahead | the server now returns { joined } and the wait looked like a hang
2026-11-05 | agent page tab "Memory & skills" (memory mode, knowledge access, skills by agent), "Used by" field in Knowledge and Settings, "Remembered N things" line with Undo; the "Knows" section left Activity | the server now gates memory, knowledge and skills per agent; the prototype HTML did not follow the design system, so the screen was built with the real components
2026-11-05 | Knowledge split into Memory (memory.tsx: tabs by owner, review strip, teach field, Move, Still true?, delete for good), Pages (PagesView) and Skills (skills.tsx, with the computer's skills moved from Settings); routes #/memory, #/pages, #/skills, old #/knowledge links redirect (OldKnowledgeLink); server: MemoryPatch.scope (scopeExists, audience follows), DELETE /api/memories/:id only for forgotten | phase 2 of the memory work (a reference app prototype approved): one place per job
2026-11-05 | MemoryChip in the chat timeline from memoriesAtom (chatId, origin auto, not forgotten), with Keep / Move / Undo; the client-only "remembered" note only triggers a refresh now; MoveMenu shared with Memory | the note vanished on reload and didn't say which agent kept what
2026-11-05 | Memory › Map (memory-map.tsx): canvas force map of GET /api/memories/map with type chips, zoom, hover-lit links and a point panel (facts + links); MapPoint.memoryIds | stage A3 of the memory map
2026-11-08 | 12 connectors beyond code (Todoist, ClickUp, monday, Airtable, Intercom, Canva, Gamma, Webflow, Wix, PayPal, Square, Hugging Face) | general platform: the store was nearly all dev tools
2026-11-08 | Settings › Channels (Telegram token, pairing) | spec 007
2026-11-08 | connector "Desktop apps" (npx -y agent-desktop@1.2.0 mcp) | computer use, optional download
2026-11-08 | Computer apps section in agent permissions; npx Desktop apps connector removed | spec 008
2026-11-08 | routing model setting removed (UI, endpoint, preference); memory model moved under Advanced | the user asked whether they were needed: automatic covers both, the memory model only matters for privacy or API cost
2026-11-05 | one sidebar: Rail + Sidebar merged (Head, Places rows, trees, Foot with one usage ring), folded = 56px icon column; chat rows 40px without avatar or dots, second line only when waiting/failed/waiting on a teammate, muted spinners; tree elbows + trunk (NavTreeItem last/tooltip) and .tree-wash; project tiles; TitleBar width 268 | the user chose a single Zeron-like sidebar (prototype approved, Clean)
2026-11-05 | processes list shows only running/waiting chats (a failed one has nothing to stop) | the server now rests a failed chat as "failed"
2026-11-05 | chat steps as a tree (ui/step-tree.tsx: StepHead/StepList/StepRow/StepNote; features/steps.ts summarize + test): sentence summary, standing failures only, glyph per kind, command on hover, output line by line; live turns use the same tree with muted spinners; StoredActivity moved above the reply text | the pill + bordered list with green checks read like a log (prototype approved, polished with impeccable)
2026-11-05 | side panel Overview (was Git, id stays "git"): Ship as Milestones (ui/milestones.tsx: branch → commit box → push/publish → PR; first pending step gets the blue action), Run (RunPart: running servers + package.json scripts), History, branch/worktree; first tab with a folder, the panel opens on it; Part titles quiet, no hairlines | the Git tab showed every action at once; the prototype's step-by-step was approved
2026-11-05 | sidebar on one grid: places 36px (were 28) 2px apart, groups 16px apart, loose chats get the chat glyph so every row's words start at x 49, the current place has the chat's control-hover wash (no border), head/foot icons on the + and icon columns | heights and spacing differed between the places and the trees (impeccable polish, measured in the browser)
2026-11-05 | Overview on one column: Run icons and History dots in a 20px slot centred with Ship's marks (x 26), every word from x 48; History rows 32px | three left columns and three text starts in one panel
2026-11-06 | interleaved replies: interleave() in features/steps.ts (+tests), StoredReply and LiveSteps groups per run of steps, LiveTurn.stepAt, live footer as a status line | chat v2 (Zeron-like): words and work in the order they happened
2026-11-06 | Pages becomes Memory's third view (MemorySwitch: Facts | Map | Pages; #/pages kept), the sidebar loses its Pages row; the sidebar list fades at its top edge when scrolled | the user chose option A: everything Zorel knows in one place
2026-11-06 | tree lines drawn unbroken: the sidebar's reach 2px past the row (its 1px border + 1px gap; offsets count inside the border), and in both trees the trunk runs straight through each row with an 8px arc branching off (the last row keeps the full elbow) | the user saw cuts: 2px gaps between rows and an 8px notch where each elbow left the trunk
2026-11-06 | one page rhythm: every header 56px (HEADER, chat included), every page body a centered Column (reading 768 / wide 1024, 28px around), sections 40px apart, tabs 32px above content, section titles 12px above their card with actions that add no height, scrollbar room kept so columns never shift; Memory and Skills › On this computer centered like the rest, the agent page at reading width | the user asked for an impeccable pass on every page: columns, margins and gaps differed screen to screen
2026-11-06 | the page rhythm reaches the rest: page and skill readers/editors and the Builder take the same column (column() in ui/layout.tsx), 28px around instead of 40/32 and one width for both readers | the user asked whether every screen had it; three still kept their own margins
2026-11-09 | Own computer row in agent permissions | spec 009
2026-11-09 | Skills moved into Settings; Needs you/Agents/Routines/Memory as an icon row; side panel toggle after the agents in the chat header | user request
2026-11-09 | sidebar: New chat and Search as icons in the head row; the places back as named rows | user preferred names over an icon row
2026-11-09 | Memory page: one header across views, approval moved into Review, rows use pin + ⋯ menu | impeccable layout/critique pass
2026-11-09 | Memory: undo receipt for Forget/Discard/Move; 8 per group in All with See all; DESIGN.md accent #0071e3 | critique follow-ups chosen by the user
2026-11-09 | audit+polish: AgentView keyed, missing connector/audit strings, settings nav row on narrow, headings | impeccable audit
2026-11-09 | narrow-window adaptation across screens; connector ids typed by their descriptions | impeccable adapt + harden
2026-11-09 | side panel: Home/Overview tab became the Pull request tab, Run list removed, panel opens on Changes | user: no need for a home, wants PR and Changes areas
2026-11-09 | side panel tabs opened from a + menu and closable; Browser/Terminal again = new page/shell | user: choose what to open instead of fixed tabs
2026-11-09 | providers page lists Gemini CLI, OpenCode, Antigravity | user thought Antigravity was not set up: it was only in the model picker
2026-11-10 | Install button for agent CLIs; Gemini/Antigravity/LM Studio logos | user: no icons in the picker, wanted in-app install
2026-11-10 | Teams section, agent form teams, Add a team in pickers, @team joins members; project label Team → Agents | spec 010
2026-11-10 | Routines Week view, routine History and Settings dialogs, Today page, Your day settings, routine notices | spec 012
2026-11-10 | spec 013 P1-b: flow editor (lazy React Flow canvas + List), step panels, schema form, tool picker, Run view, Needs you rows for uncertain writes and Ask me; Dialog scrolls its body | the routine flows UI; long dialogs overflowed the window
2026-11-10 | New routine rebuilt on the flow model (a reference app's fields, no JSON); canvas drag flicker fixed (keep RF measured nodes) | the user saw the old form and the canvas flickered
2026-11-10 | pt-BR interface (catalog + language setting, system default) | user request; PRODUCT.md said English only for now
