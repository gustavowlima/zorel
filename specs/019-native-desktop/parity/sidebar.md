# Parity checklist: Sidebar (apps/web/src/features/sidebar.tsx, sidebar-order.ts, ui/nav.tsx)

Inventory of the web sidebar (2026-11-12). S = features/sidebar.tsx, N = ui/nav.tsx, O = features/sidebar-order.ts.

## Structure
- Two modes: open 268px / folded rail 56px; width animated with a spring (bounce 0, 0.22 s). Hidden during first run.
  Content card to its right has a rounded left edge and left border. ⌘/Ctrl+B toggles; below 900px forced folded.
- Open, top to bottom: head 52px (logo 20 + ServerPicker or app.name + fold button PanelLeftClose); ServerLine
  (desktop, on a team server); SearchBar (secondary button, nav.searchOrGo, kbd ⌘K/Ctrl K → palette); places (NavItem
  36px): Home (House, nav.homeScreen, home without project), Pending (Inbox, nav.needsYou, badge = needsYou approvals +
  pending memories, accent pill), Agents (Bot; agents/agent/new-agent/builder), Routines (AlarmClock;
  routines/routine-flow/routine-run), Memory (Brain; memory/pages); scroll list with 24px top/bottom fades and hidden
  scrollbar: Chats section (loose chats) and Projects section; UpdateCard (desktop); foot row: Usage popover, spacer,
  Pause/Resume, Settings (32px buttons, tooltips on top).
- Folded: head only PanelLeftOpen (40px); rail items 40px: Search, 24px divider, the 5 places with corner badges;
  spacer; foot column UpdateItem, Usage, Pause, Settings; tooltips right; active rail item has a sliding marker
  (bg-accent-faint, shared layout).
- Chats section: NavLabel nav.chats (hint nav.chatsHint), chevron toggle, collapsed summary = waiting count (warning
  tone), "+" (nav.newChat → home); empty: nav.noChats + nav.newChat button.
- Projects section: NavLabel nav.projects, summary = waiting across projects, NewProjectButton (dialog project.addTitle;
  POST {name, brief:"", path}); empty: nav.emptyProjects + nav.addProject; tree project → its chats; expansion persisted,
  active project forced open; empty project shows nav.emptyProjectStart → home with project.
- Ordering (O:12-19): position null first by max(createdAt, lastAt, status.updatedAt) desc; then positioned ascending;
  then stable by turn (waiting < running < rest). Chats with parentId excluded; a child's waiting lifts to its parent.
- Show more: 5 per group, open chat always visible; nav.showMore {count} / nav.showLess; per group, in memory.

## Rows
- NavItem 36px: active = aria-current, bg-control-hover, medium; hover bg-hover; pressed bg-control-active.
- NavLabel 28px, text-sm medium secondary; chevron rotates 90° when open; summary only when collapsed.
- ProjectItem 36px medium: 20px tile with the initial (bg-control) that becomes a chevron on hover/focus; trailing =
  waiting count (warning) else spinner (nav.runningIn) else chat count (dim); on hover/focus trailing becomes "+"
  (nav.newChatIn → home with project) and ⋯ menu; active on project/:id or home with that project.
- ChatItem 40px (58 with detail): loose chats show a 20px lead-agent avatar when live (working/waiting/failed) else
  MessageCircle; title chatTitle, medium if waiting or active; trailing spinner while running (unless the avatar shows
  it) else formatAge(max(lastAt ?? createdAt, status.updatedAt)); detail line: running "who · statusLabel", waiting
  (warning), failed (danger), idle only "waits for"; tooltip nav.withModel; ⋯ replaces the time on hover.
- Nested chat rows: tree trunk + 8px rounded elbow at x=20, left padding 40; last row ends the trunk; tree-wash hover.
- Drag and drop: reorder before/after within the same group only; accent drop line; dragged row 0.98 scale, 40%
  opacity; rows animate to their place. PUT /api/projects/order {ids}; PUT /api/chats/order {projectId|null, ids}.
- Context menu (right click, Menu key, Shift+F10) = ⋯ menu (nav.moreFor). Chat: Open, Rename (dialog, ≤80, trimmed,
  non-empty; PATCH /api/chats/:id {title}), Delete (danger, confirm; DELETE /api/chats/:id; home if open). Project:
  Open (project overview), nav.newChatIn, nav.projectSettings, Delete (project.deleteAction; DELETE /api/projects/:id;
  home if active).

## Data
projects (id, name) · chats (id, projectId, parentId, agentIds, title, model, position, lastAt, createdAt) · agents
(id, name, projectId, builtin) · memories (state pending) · approvals RPC (tool, agentId) · accounts (loggedIn, kind,
provider, label, usage.windows{id, usedPercent, resetsAt}) · subscribeStatus · preferences (paused). A status for an
unknown chat invalidates chats once per id.

## Other interactions
- Pause: PUT /api/pause {paused}. Usage popover: logged-in accounts by worst risk; critical ≥95%, warning ≥80% or
  running out early; refresh POST /api/accounts/:id/limits?fresh=1 (subscriptions only, sequential); See all → usage.
- ⌘K palette; trees: Tab + arrows + type-ahead. Server picker: Ctrl+1-9 (non-Mac), ⌘1-9 menu on Mac.

## Persisted
zorel.sidebar.hidden, zorel.sidebar.expanded (project ids), zorel.sidebar.collapsed ("chats"/"projects").

## Desktop / team server
UpdateCard/UpdateItem (downloading meter + %, ready → Restart, installing spinner, error → retry); ServerPicker (≥2
places; online dot; ⌘n hints; "Add a server…" on local → settings); ServerLine "On {host}" + back to local; TitleBar
back/forward in the 268px area.

## i18n keys
nav.* (label, homeScreen, needsYou, agents, routines, memory, searchOrGo, showSidebar, hideSidebar, settings, chats,
chatsHint, noChats, newChat, projects, emptyProjects, addProject, emptyProjectStart, newProject, newChatIn,
projectSettings, showMore, showLess, waitingIn, runningIn, moreFor, reorder, withModel, usage, usageNone, usageSeeAll,
usageKey, usageNoLimits, back, forward), common.*, pause.all/resume, update.*, chat.untitled/renameTitle/titleField/
deleteTitle/deleteBody, project.deleteTitle/deleteBody/deleteAction/addTitle, status.*, usage.refresh/resets,
servers.*, palette.toggleSidebar.
