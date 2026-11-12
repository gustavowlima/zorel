# Parity checklist: Home (apps/web/src/features/home.tsx)

Inventory of the web screen the native Home must match (2026-11-12). Paths under apps/web/src unless noted.

## Layout
- Root (home:99): column, centred, scrolls; px-7 (28), pt-14 (56), pb-10 (40).
- OrbitBackdrop (ui/orbit.tsx:17): absolute top, h-96 (384), opacity .6, no pointer events. SVG rings r 110/200/300/410/530
  in --z-border, two diagonal spokes, two accent dots .35 opacity, 4 accent dots orbiting 140/200/260/200 s (stopped
  under reduced motion), radial mask fade.
- Top block (home:102): max-w-2xl (672), gap-6 (24).
  - Header centred gap-1: greeting (text-sm, muted) + h1 home.title (26/32px, semibold, -0.03em).
  - Composer area gap-1.5: row gap-1 [project Select][crew pill | "who answers" Select], then the Composer.
- Feed (home:160): mt-10 (40), max-w-2xl, gap-7 (28): NeedsYouNow, WorkingNow, TodayBrief.
- Section (ui/layout.tsx:50): gap-3; h2 text-sm medium muted; action on the right (-my-1.5).
- Rows (layout:69): divided list, rounded-card, border subtle, bg-surface, px-4.
- ListRow (layout:202): min-h-14 (56), py-2.5, gap-3.5; icon slot ≥20; title medium truncate; hint text-sm muted
  truncate; ChevronRight 16 muted; whole row one button with hover wash.
- QuietCard (layout:239): row gap-4, rounded-card, border, bg-surface, px-4 py-3: Scene + title medium + hint sm muted.

## Data
| Source | Endpoint | Fields |
|---|---|---|
| projects | GET /api/projects | id, name, agentIds, teamIds |
| agents | GET /api/agents | id, name, title, model, accountId, effort, projectId, builtin, archivedAt |
| teams | GET /api/teams | id, name, handle, agentIds, projectId |
| chats | GET /api/chats | id, title, agentIds, lastAt, createdAt, projectId, model |
| routines | GET /api/routines | id, name, agentId, chatId, enabled, nextRunAt, version |
| today | GET /api/today | {from, found: RoutineRun[] (id, routineId, summary, createdAt), quiet} |
| approvals | RPC approvals | Approval |
| statuses | RPC subscribeStatus | chatId, state, agentId, agentIds, label, waits |
| createChat | POST /api/chats | {projectId, model, accountId, effort, agentIds≤8} |
| updateChat | PATCH /api/chats/:id | {agentIds, model?} |
| send | RPC send | {chatId, clientId, text, attachmentIds?} |
| decide | RPC decide | {approvalId, outcome, reason?} |
| upload | POST /api/chats/:id/attachments | raw body; ≤20 MB (composer.tooBig) |
| model picker | GET /api/accounts, GET /api/models | — |

## States
- No loading/error UI (lists are empty until loaded); TodayBrief renders nothing until /api/today answers.
- Needs you: approvals minus the builtin builder's zorel_create_agent (labels.ts:209 needsYou). None → QuietCard
  scene allClear (home.allClear / allClearHint). Some → title "Needs you · N", first 2 as ApprovalItem (gap-3),
  "See all" (→ inbox) only when N > 2.
- Working now: statuses running whose chat is known. None → scene resting (home.nobodyWorking / Hint). Row: icon =
  agent of chat.agentIds[0] (avatar 28, working) or WorkingRing 20; title chatTitle (empty → chat.untitled); hint
  statusLabel (status.running / runningMany with list format / waiting / asking / failed / waitsFor). Click → chat.
- Today: action "since {time}" (home.todaySince, formatTime(today.from)). found empty and quiet 0 → scene calmDay
  (home.todayQuiet / todayQuietHint); rows hidden only if also no next run. Rows: each found run (avatar 20, title
  summary or routines.runs.outcome.something, hint "routine · time"; → routine-run if run.version != null else the
  routine's chat), a quiet row if quiet > 0 (today.quiet plural; → routines), next run (earliest enabled routine with
  nextRunAt, AlarmClock icon, home.nextRun "Next: {name}, {time}"; → routines).
- Greeting: hour < 12 morning, < 18 afternoon, else evening; " · " + weekday long, day numeric, month long (locale).
- Project scope: projectId from the route (#/new/<id>), reset when it changes; changing clears chosen agent and picked
  model. callable = not builtin, not archived, global or this project (agent-options.ts:11); teamsIn same rule.
  Feed sections are always global.
- Crew/model: crew = project's agents + its teams' members, deduped, callable, ≤8. single = chosen, else last-used
  (most recent chat by lastAt ?? createdAt, its first callable agent), else callable[0]. members = crew or [single];
  lead = members[0]. Model = picked, else lead's {model, accountId, effort}, else claude-cli/sonnet.

## Interactions
- Project Select (ghost, Folder icon, max-w 256): "No project" + projects; search when > 8 options.
- Crew pill (crew > 0): h-control-sm, rounded-full, border, px-1.5, text-sm; ≤3 overlapping avatars 20; 1 member →
  tinted with its hue, "{name} answers" (home.answers); else bg-control, home.crew plural. Label max-w 192 truncate.
- "Who answers" Select (no crew, a single agent): callable agents with avatar 16.
- Composer: autofocus; Enter sends, Shift+Enter newline; `#` opens leads (agents as @handle chips with tint, hint
  title || model label; then teams with Users icon, teams.option); ≤8 options, arrows/Enter/Tab/Escape; paste/drop/+
  files ≤10 (composer.dropHere); disabled when empty and no files or uploading; empty text + files sends
  composer.seeAttachments; on failure text returns + error line (danger).
- Submit: members + newly @-named (≤8) → ensureChat once per draft (upload creates it early) → updateChat if new agents
  (failure: chat.addFailed) → send → open the chat.
- ModelPicker in the composer's tools (popover; settings button → settings/providers).
- ApprovalItem (inbox.tsx:113) for Needs you rows (same as the Needs you screen).

## i18n keys
home.morning/afternoon/evening, home.title, home.project, home.noProject, home.searchProjects, home.answers, home.crew,
home.whoAnswers, home.searchAgents, home.placeholder, home.needsYou, home.seeAll, home.allClear, home.allClearHint,
home.workingNow, home.nobodyWorking, home.nobodyWorkingHint, home.today, home.todaySince, home.todayQuiet,
home.todayQuietHint, home.nextRun, today.quiet, teams.option, routines.runs.outcome.something, chat.addFailed,
chat.sendFailed, chat.untitled, status.*, common.assistant, composer.*, model.choose, inbox/approval/question keys.
