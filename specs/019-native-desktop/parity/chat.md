# Parity checklist: Chat and its side panel (apps/web/src/features/chat.tsx, composer.tsx, workspace.tsx, …)

Inventory of the web screens (2026-11-12). F = apps/web/src/features/. run-trace.tsx is routines only; task-panel.tsx is
a separate drawer (mutually exclusive with the side panel, chat.tsx:98). Side panel tabs: Changes, Pull request
("git"), Files, Browser, Terminal (workspace.tsx:88,120-123).

## A. Chat screen
- Layout (170-310): header; row = [timeline + bottom stack | Drawer (SidePanel or TaskDrawer)]. Task links in the
  transcript open the task drawer.
- Header (335-463): title (chatTitle → chat.untitled); project ghost button (name or common.general → project or
  home); pinned shortcuts with right-click Unpin (side tabs; files/terminal/git hidden without a folder; pinned git =
  GitControl: branch or detached, worktree icon, changed count warning, ↑ahead; pinned shells); RunControl (folder
  only: package.json scripts + "Run a command…" ≤1000 chars with {port} hint → opens Browser at the URL; failure dialog
  with <pre>; "starting"); ChatProcesses pill (servers/shells/engine sessions of this chat, polled 5s while visible;
  popover with CPU/memory and stop/close per row, "See all" → settings processes); TeamPicker (overlapping avatars,
  lead's face shows working/waiting/failed; members with lead badge, Make lead (also sets the chat model), remove when
  >1; add agent (search when >8); add team (overflow warning); mention hint when >1 members); side-panel toggle pill
  (PanelRight + Delta +added −removed of non-reverted turns; opens Changes or closes); More menu: Rename (≤80, trimmed,
  non-empty), Failover (use agent's list switch, FailoverEditor, Save disabled while terms pending; failover list|null),
  Delete (confirm → home, project kept).
- Timeline (550-647): messages + notes (not remembered) + this chat's auto fact memories (MemoryChip: keep / move scope /
  undo or discard) sorted by at; `remembered` invalidates memories; summary disclosure when chat.summary; messages with
  at ≤ summaryUntil at 55% opacity with tooltip; spinner until ready; empty chat.empty / emptyHint (+ team.mentionHint
  with >1 members); follows new content only within 120px of the bottom (re-pin on items, live text/step lengths,
  approvals); deep link at=messageId scrolls, highlights accent-faint 1.8s, unpins.
- Solo chat (≤1 agent) is bare (no avatar/name on replies). A reply continues the previous (no avatar/name) when same
  agent, within 5 minutes, no switches.
- User row: right bubble max-w 500; MentionText (@handle → agent chip link; not inside backticks); attachments (images
  as thumbnails → ImageViewer with "open original"; files as chips → /api/attachments/:id); hover: copy (✓ 1.2s), Edit
  from here (hidden while a turn is live), time with full-date tooltip.
- Rewind dialog: body + "also undo files" switch when a later message has non-reverted changes; POST rewind
  {messageId, files} → text back into the composer; conflict → workspace.undoConflict with files; else
  chat.rewindFailed.
- Assistant row: each switch first as a separator (failover.switched / why.*); avatar 28 + name in the agent tint
  (model in tooltip); StoredReply = text interleaved with step groups by step.at (thoughts at top of first group; one
  group shows turn duration); StoredActivity folded sentence (ListFormat of activity.did.*, "· N failed" not later
  fixed, "· N refused", "· duration" ≥1s) expanding to StepList (thought notes ≥1s; StoredStep: kind glyph, title,
  hover hint, facts, expandable command <pre>, output clamped 3 lines with Show all/less when >240 chars or >3 lines);
  BrowserCard when browser_* steps (last action, host, Take over / full screen, live picture GET
  /api/browser/picture?chat&owner every 4s on each agent's latest browser reply); TurnChanges ("N files +a −r · View ·
  Undo" with confirm, or "Undone"; View focuses the turn in Changes); ending: cancelled, server_restarted, reply_limit,
  monthly_limit, interruptions as warning; else danger "Failed" + <pre>; last reply action: monthly_limit → Raise the
  limit (agent page), else Retry / Continue (reply_limit) via retry {chatId, messageId}; hover details tooltip: model,
  tokens in/out compact, duration ≥1s, account, cost ("API equivalent" for subscriptions).
- Live turns (several can run): text revealed smoothly over ~6 frames (instant under reduced motion), only the last
  block re-renders; LiveSteps open by default (zorel.steps.open), spinner/clock leading; receipts 28px
  (Allowed/Denied/Expired or Answered/Skipped, reason quoted, expands to command with copy, folder, args; cleared at turn
  end); status line: spinner or warning clock; label = current step title, between steps "Working" / "Waiting for
  {provider}" held 700ms; waiting: status.asking (zorel_ask_user) or approval.waitsFor; shimmer; elapsed after 5s (not
  while waiting); per-turn Stop when several live turns or pending ≤1.
- Notes: failover → switchText; worktree → chat.ownCopy; handoff via limit → chainStopped, reply → handedBack, route →
  routed/routedWhy, else handoff. Ignored by the reducer: reasoning, model-switched, learned, context-usage.
- Bottom stack: PendingTray (approval: who waits, title, command toggles JSON args, Deny / Always allow if alwaysKey /
  Allow; question: QuestionAnswer with option pills from args.options, free text ≤2000, Send, Skip=denied; errors
  chat.approvalGone); AgentCopies (per agent worktree: Merge / Discard with confirm); resumeAt banner + Cancel
  (resumeAt null); agent waits (waitLabel + "Open the task"); "sent" note 6s (queue.sentJoined/sentStopped);
  QueuePanel; WhoContinues (orphan chat, ≤8 agents: sets agentIds, model, accountId); Composer.

## B. Composer
- Tiptap with mention chips; placeholder composer.placeholder or placeholderTeam (follow-up agent); dropHere.
- Triggers (≤8 options, ranked): @ agents (members first, outsiders hinted "Add to chat"), teams, project files; # agents
  and teams (inserts @ chip); $ active skill memories in scope (skillHandle(title)); / at line start: built-ins compact,
  new, changes, terminal (folder only) run locally; engine commands insert "/name ". Chips serialize @id / $id; agent
  chips wear the agent tint.
- Keys: Enter sends unless a menu is open; Shift+Enter newline; menus ↑/↓ wrap, Enter/Tab pick, Esc; undo/redo.
- Attachments: +, paste, drop; ≤10, 20 MB each; POST /api/chats/:id/attachments; chips (image thumb or file icon, ×);
  "Attaching…".
- Send: allowed with text or files and nothing uploading; empty text → "See the attachments."; clears at once; failure
  restores text + error (SendError or chat.sendFailed). New mentions → updateChat agentIds first (chat.addFailed);
  orphan chat without mention → chat.needsAgent; idle + empty queue → send, else queue.
- Stop pill when busy → interrupt {chatId}; submit tooltip Send / "Add to the queue".
- Tools: ModelPicker (rail of accounts/providers, settings gear, search, custom provider/model id, LimitWindows,
  sign-in/set-up prompt, effort slider default/low/medium/high/max for claude-cli/codex-cli, accountId null for
  default); AccessChip (own/ask/workspace/full; full needs one-time confirm); ContextMeter (20px ring, warning ≥80%,
  popover refetches: stacked bar of parts, used of window, parts + free, last read, auto-compact info, Compact now / New
  chat).
- External insert (terminal selection, diff line comment, Files "Add to chat") appends a paragraph and focuses.
- Queue (localStorage per chat): drains one at a time when idle; "N replies ahead", "Send now" → steer (joins the
  running reply for claude-cli/codex-cli without attachments, else stops it), Edit, Remove; failures re-queue.

## C. Side panel (workspace.tsx:137-355)
- Opens from: header toggle, pinned tabs, /changes, /terminal, "View" on a turn, Run or a server link (Browser), a
  browser card (full screen; leaving it closes the panel if opened for it), a finished zorel_preview step (Browser,
  once per step). Closes with × or closing the last tab.
- Resize: left-edge separator, drag or ←/→ (±32px); min 360, max 70% of the window, default 560; persisted.
- Tab bar: only tabs opened this session; Changes only once a turn changed files; empty Changes shows the next tab or
  an empty state with buttons; + menu (Browser/Terminal again = new tab/shell); right-click pin/unpin; icon only when
  narrow, label at wider widths; Changes shows its delta; pinned tabs show a pin.
- Folder-only tabs: git, files, terminal; git shows "not a repo" unless repo.
- Changes: turns newest first, accordion "turn by {agent} {time}" + delta or Undone; files (status mark, delta);
  diff from GET /api/turns/:id/diff in DiffView (unified, wrapped, line selection → comment box, Cmd/Ctrl+Enter sends
  to the composer, Esc); binary → workspace.binary.
- Pull request: milestones branch → commit (message, "Write it for me" gitDraft commit, Commit (N), files) → push /
  publish / no remote ("updates PR #") → PR (open on GitHub or Create PR: gitDraft pr → title/body → gitPr); first
  pending step's button primary; commits timeline; worktree box with Leave; new branch / new worktree form; error or
  success line.
- Files: tree (folders first, changed top folders expanded), search (Esc clears), collapse all, new file; selection
  Shift/Cmd; F2 (and Enter on Mac) rename, Delete (Backspace on Mac) to trash with Undo bar; drag to move; context menu
  Open, Open in app, Show changes, Reveal, Add to chat, Copy path / relative, New file here, Rename, Delete;
  double-click opens a file tab (path, Show changes, Open in app, read-only FileView or "can't show").
- Browser: socket /api/browser?chat (state, previews, act, error, JPEG frames); cards grid for several owners
  (previews every 4s); toolbar (all browsers, owner's tabs, new tab, full screen); address bar back/forward/reload/go;
  status bar (you hold it + Hand back, agent action cleared 3s after, watch-only); page 16:10: click, wheel, keys,
  paste; agent pointer overlay; masked blurred; Esc leaves full screen unless on the page.
- Terminal: tabs from GET terminals + saved layout, at least one shell; split right/down ≤4 panes; run-script menu;
  LocalServers popover (open localhost:port in Browser, stop); close asks when busy; right-click pin/close;
  font 12, scrollback 5000; socket /api/terminals (i/r/k up; {t:"s",id,n} then bytes; 4000 = ended; 5 retries); URL
  links external, file paths → openFile; selection "Add to chat" as a code block.
- Task drawer (w 480): avatar, title, "Open full screen", close; the task's timeline (stop = interrupt); PendingTray.

## D. Data
RPC: subscribeChat, subscribeStatus, send, steer → {joined}, interrupt {chatId, turnId?}, retry {chatId, messageId},
decide. HTTP: PATCH/DELETE /api/chats/:id; context; commands; POST consolidate; POST rewind → {text}; git (get, draft,
commit, push, pr, branch, worktree); agent copies worktree/merge; terminals; scripts; servers (+ DELETE :pid); preview
{script|command} → {url}; open {path}; file?path → {contents|null, size}; fs {op, path, to, paths, id} → {trashId};
GET /api/turns/:id/diff; POST /api/turns/:id/undo (409 UndoConflict); GET /api/projects/:id/files?chatId; lists
(agents, teams, chats, projects, memories + PATCH, accounts, models, processes + stop/close).

## E. i18n areas (≈380 keys)
chat.*, activity.*, approval.*, question.*, status.*, composer.*, queue.*, context.*, model.*, chatAccess.*, access.*,
team.*, teams.*, agents.search/noMatch, failover.*, task.*, copies.*, memory chip keys, workspace.*, explorer.*, diff.*,
git.*, browser.*, processes.*, common.*, mention.open, usage.apiEquivalent.

## F. Persisted
zorel.queue.<chatId>, zorel.pins.side, zorel.pins.shell.<chatId>, zorel.side.width, zorel.terminal.layout.<chatId>,
zorel.steps.open, zorel.fullAccessConfirmed. In memory: open file tabs per chat, opened side tabs, browser full-screen
state, composer text.
