2026-11-03 | screens rewritten from the prototype, atoms (AtomHttpApi/AtomRpc), i18n en, api.ts/accounts/memories/tools removed | UI phase steps 2 and 3
2026-11-03 | changes panel, undo, terminal, project folder, access level | phase 3
2026-11-03 | diff back to @pierre/diffs with worker pool | the failure was the StrictMode + disableFileHeader bug without a pool
2026-11-03 | Usage screen rewritten, limits in the picker and the sidebar, real model names | phase 2c
2026-11-03 | Usage screen redesigned (hero, harnesses, stacked area, totals, breakdown) | OpenBot inspiration requested by the user
2026-11-03 | Accounts + API keys become Settings › Providers (list and per-provider page) | user request, inspired by OpenBot
2026-11-03 | Settings › Storage; cn with theme tokens; plural lookup fixed | user request + bugs found
2026-11-03 | composer in Tiptap with # @ $ /, message queue, context meter; agent picker left the field | user request
2026-11-03 | sidebar: icon tabs replaced by named Chats|Projects switch; Knowledge/Settings back as fixed rows; usage foot as per-window bars | impeccable critique 21/36 (consistency 1)
2026-11-03 | sidebar: tabs and Chats|Projects switch removed; stacked sections with icons; chats on one line | user: too cluttered, prefers no tabs
2026-11-03 | terminal: Run a script, Servers; orphan shell fix in StrictMode | phase 3c
2026-11-03 | GitControl in the chat header | gap vs T3 Code
2026-11-03 | Changes/Files/Browser/Terminal become tabs of a resizable side panel; header with a single button | user request, like T3 Code
2026-11-03 | pin panel tabs and shells to the title row (right click); ⋯ without Summarize and learn | user request
2026-11-03 | Git leaves the popover and becomes a side panel tab, with files and commits; icon-only tabs in the narrow panel | user request
2026-11-03 | comment diff lines → composer; last shell does not close; Git in the title only when pinned | user requests + gap vs T3 Code
2026-11-03 | Agents screen in the sidebar | phase 4, user request
2026-11-03 | icon rail on the left with the app's places; sidebar only with chats and projects; Routines screen | user request (OpenBot)
2026-11-03 | sidebar chats in 2 lines without icon, with participating agents; sections without icon and more spaced | user request
2026-11-03 | projects in the sidebar as subtitles aligned to the chats | user request
2026-11-03 | divider between rail and sidebar; collapsible sidebar (button, ⌘B, Chats) | user request
2026-11-03 | content card at 100% height, flush right, radius only on the left | user request
2026-11-03 | Motion (motion.dev) in the sidebar: collapse, sections and rail highlight | user request; dependency: animate auto width/height and layoutId without unmounting
2026-11-03 | chat at full panel width (no 720px column) | user request
2026-11-03 | Cmd+K with message search | item 3 of the list (T3 Code)
2026-11-04 | Build with AI becomes a fixed screen; internal Builder; Agents page with a single menu | user request (Tucano/OpenBot)
2026-11-04 | Build with AI in three steps like Tucano (powers, first task); Builder ceiling = workspace; browser only if requested | live test showed wrong access and duplicated card
2026-11-04 | Build with AI without the first task step (Describe → Powers → agent page) | user request
2026-11-04 | ready-made agent templates, project picker in Build with AI, gateway deadline longer than the approval's | items 4 and the 60 s timeout bug
2026-11-04 | ready-made templates removed from the agent form; agent store goes to the backlog | user decision
2026-11-04 | Settings › Connectors in cards; form pill catalog removed | user asked for connectors like GitHub/Notion
2026-11-04 | connectors with logos (simple-icons) and Reconnect state | user asked for logos and the OpenBot pattern
2026-11-04 | Test connection on connectors + test on connect | user asked for a connection test
2026-11-04 | renamed Zero → Zorel (texts, packages, localStorage migrated) | user chose the name Zorel
2026-11-04 | ponytail review+audit: removed signOut, AvatarStack, Card, windowShort, SessionAccess, TeamToolName, MODEL_OF_ACCOUNT/accountProviderOf, shadcn dep | unused code
2026-11-04 | Zorel Z logo; sidebar rereads chats created by the server | rename and tasks between agents
2026-11-04 | Settings › Processes and process count in the chat header | user asked for a background processes page, also per conversation
2026-11-04 | lean Processes: summary with CPU/memory icons, one list with columns, icon actions; no hero, sparkline or bars | user found the page cluttered
2026-11-04 | chat: max-w-chat reading column, text-chat 14px, no avatar in single-agent chat, turn summary with duration, ShimmerText, PendingTray, ChatMarkdown with CodeBlock/TableFrame | OpenBot ideas, user request
2026-11-04 | "handed back"/"agents stopped" notes, placeholder with the follow-up target, Steer only in Codex | conversation between agents
2026-11-04 | SortableList (drag and keyboard) in fallbacks; Changes groups expand and collapse | user requests
2026-11-04 | Files becomes an explorer (FileTree, FileIcon, mutations.fs) | user asked to rename/select/delete like in VS Code
2026-11-04 | Git panel redesigned, StatusMark in @/ui, Settings in a max-w-5xl column | request: flawless PR screen; Settings pages misaligned and narrow
