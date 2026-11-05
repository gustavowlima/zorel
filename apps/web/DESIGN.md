---
name: Zorel
description: An AI agent workspace for code, dark, compact and quiet.
colors:
  frame: "#0b0c0e"
  canvas: "#17181b"
  sidebar: "#0f1113"
  surface: "#1c1e21"
  raised: "#202225"
  float: "rgba(32, 34, 37, 0.86)"
  control: "rgba(255, 255, 255, 0.07)"
  control-hover: "rgba(255, 255, 255, 0.09)"
  control-active: "rgba(255, 255, 255, 0.12)"
  code: "#111315"
  border-subtle: "rgba(255, 255, 255, 0.06)"
  border-strong: "rgba(255, 255, 255, 0.1)"
  text: "#ffffff"
  text-secondary: "#dbdcdf"
  text-muted: "#96989c"
  text-dim: "#8a8c90"
  signal-blue: "#007cf7"
  signal-blue-hover: "#1f8fff"
  signal-blue-text: "#42a0ff"
  signal-blue-soft: "rgba(0, 124, 247, 0.16)"
  signal-blue-faint: "rgba(0, 124, 247, 0.08)"
  signal-blue-line: "rgba(0, 124, 247, 0.35)"
  success: "#31cf76"
  success-faint: "rgba(49, 207, 118, 0.07)"
  success-line: "rgba(49, 207, 118, 0.3)"
  warning: "#ff9412"
  danger: "#fd2f3b"
  danger-soft: "rgba(253, 47, 59, 0.16)"
  on-accent: "#ffffff"
  overlay: "rgba(0, 0, 0, 0.5)"
  diff-add: "rgba(49, 207, 118, 0.1)"
  diff-del: "rgba(255, 107, 115, 0.1)"
  agent-violet: "#918ddf"
  agent-teal: "#00afa9"
  agent-rose: "#d47795"
  agent-ochre: "#aa9935"
  agent-orchid: "#bd7dc1"
  agent-clay: "#d67d5e"
  on-agent: "#101419"
typography:
  title:
    fontFamily: "Inter Variable, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 600
  body:
    fontFamily: "Inter Variable, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 400
  body-medium:
    fontFamily: "Inter Variable, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 500
  small:
    fontFamily: "Inter Variable, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 400
  label:
    fontFamily: "Inter Variable, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    letterSpacing: "0.025em"
  code:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "12px"
rounded:
  inline: "4px"
  control: "8px"
  card: "12px"
  sheet: "16px"
  pill: "9999px"
spacing:
  control-xs: "24px"
  control-sm: "28px"
  control: "32px"
  control-lg: "36px"
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  6: "24px"
  8: "32px"
components:
  button-default:
    backgroundColor: "{colors.signal-blue}"
    textColor: "{colors.on-accent}"
    typography: "{typography.body-medium}"
    rounded: "{rounded.control}"
    height: "{spacing.control}"
    padding: "0 12px"
  button-default-hover:
    backgroundColor: "{colors.signal-blue-hover}"
  button-secondary:
    backgroundColor: "{colors.control}"
    textColor: "{colors.text}"
    typography: "{typography.body-medium}"
    rounded: "{rounded.control}"
    height: "{spacing.control}"
    padding: "0 12px"
  button-secondary-hover:
    backgroundColor: "{colors.control-hover}"
  button-secondary-active:
    backgroundColor: "{colors.control-active}"
  button-ghost:
    textColor: "{colors.text-muted}"
    typography: "{typography.body-medium}"
    rounded: "{rounded.control}"
    height: "{spacing.control}"
    padding: "0 12px"
  button-ghost-hover:
    backgroundColor: "{colors.control-hover}"
    textColor: "{colors.text}"
  button-destructive:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger}"
    typography: "{typography.body-medium}"
    rounded: "{rounded.control}"
    height: "{spacing.control}"
    padding: "0 12px"
  button-destructive-hover:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.on-accent}"
  input:
    backgroundColor: "{colors.control}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    height: "{spacing.control}"
    padding: "0 12px"
  sidebar-item:
    textColor: "{colors.text-muted}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    height: "{spacing.control}"
    padding: "0 10px"
  sidebar-item-active:
    backgroundColor: "{colors.canvas}"
    borderColor: "{colors.border-subtle}"
    textColor: "{colors.text}"
  badge-neutral:
    backgroundColor: "{colors.control}"
    textColor: "{colors.text-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    height: "20px"
    padding: "0 8px"
  badge-accent:
    backgroundColor: "{colors.signal-blue-soft}"
    textColor: "{colors.signal-blue-text}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    height: "20px"
    padding: "0 8px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
    padding: "16px"
---

# Design System: Zorel

## Overview

**Creative North Star: "The Night Workbench"**

Zorel is a workbench for people who spend hours with agents at the end of the day: dark, compact and quiet. The interface disappears behind the work. What speaks is the chat content, the code and the agents' decisions. The chrome is made of near-black grays that separate by tone, not by line, and a single signal blue marks what is actionable or needs attention.

The density is that of a professional tool: controls from 28 to 32px, 13px base text, no decorative space. The dark theme is the default. The light one exists and only swaps the values of the same tokens; no component knows which theme it is in.

Motion is short and physical: a 0.97 squeeze on press, transitions under 300ms, nothing when "reduce motion" is on.

**Key Characteristics:**
- Dark by default, depth through layers of tone.
- A single blue accent, rare and functional.
- Compact control scale: 24 / 28 / 32 / 36px.
- Nearly invisible borders (5% and 9% white).
- Primitives as the only visual API; screens do not style controls.

## Colors

Layered near-black neutral grays, one signal blue and three state colors. All values live in `src/styles.css` (`--z-*`); the light theme redefines the same names in `[data-theme="light"]`.

### Primary
- **Signal Blue** (signal-blue): primary button, focus, selection and links. It is the only brand color. Variants: lighter hover (signal-blue-hover), text readable on a dark background (signal-blue-text) and a translucent background for badges and focus rings (signal-blue-soft).

### Neutral
- **Frame** (frame): the window background, behind everything. The sidebar sits directly on it.
- **Workbench** (canvas): the single content card (chat, pages), with 16px corners.
- **Sidebar** (sidebar): same tone as the frame; the active item is a piece of the workbench (canvas + subtle border).
  - It behaves like the sidebar of a desktop app: the brand (in the desktop app it sits in the title bar, see below), the top shortcuts and Settings stay fixed; only the trees scroll, with no visible scrollbar, with a subtle hairline on the edge that has hidden content.
  - Projects and chats are a React Aria tree (one Tab, arrows, type-ahead search, `aria-level`). Projects reorder by dragging; chats only within their own group, never across projects. The ones without a project are in the **Chats** section.
  - Row actions (new chat, settings) appear on hover or focus in place of the count, never over the name or the arrow, and do not receive clicks while hidden.
- **Surface** (surface) and **Raised** (raised): cards, code blocks and panels on top of the workbench.
- **Control** (control, control-hover, control-active): background of secondary buttons, fields and selected items, in three steps. A translucent layer (white at 7/9/12%; black in the light theme), not a grey of its own, so a control reads on the frame, the canvas and a surface card alike.
- **Subtle border** (border-subtle) and **Strong border** (border-strong): minimal separation; the strong one only on field focus, tables and quotes.
- **Text** in four steps: text (titles and content), text-secondary, text-muted (labels, inactive items), text-dim (hints, placeholders, sections). All pass 4.5:1 on the workbench; text-dim is the lowest gray that still passes.
- **Code** (code): code blocks, terminal and diff, one step below the workbench.

### States
- **success**, **warning**, **danger** (with danger-soft): only for real state (ok, attention, error or destructive action). Never decoration.
- **On accent** (on-accent): white text on solid blue or red; the same in both themes.
- **Waiting for you** (signal-blue-faint + signal-blue-line): pending approval card. **Approved** (success-faint + success-line): receipt of what you approved.
- **Diff** (diff-add, diff-del): background of added and removed lines.

### Agent identity
- **Six colors** (agent-violet, agent-teal, agent-rose, agent-ochre, agent-orchid, agent-clay): each agent gets one, in the order it joins the project. They appear only in the avatar and never on a button, link or state. The avatar is a little object with eyes (Open Bot Avatar, MIT) inside a solid tile of the agent's color (22% of it mixed into the raised tone, so overlapping faces don't show through): the shape comes from the agent's id, so teammates differ by shape as well as color. Lists and the chat use still SVGs; the Builder's review shows them live (breathing, blinking), still under reduced motion. All six share one lightness and chroma (OKLCH 68% 0.12) and keep their hues clear of danger, warning, success and the blue, so an avatar never reads as a state or an action.

### Named Rules
**The One Voice Rule.** Signal blue is the only accent. If it appears on something that is not an action, focus, selection or link, it is wrong.

**The Token Rule.** No literal color outside `styles.css`. A literal color breaks the light theme.

**The Avatar Rule.** Agent color lives only in the avatar. If it paints a button, a link or a state, it is wrong: that is the job of the blue and the state colors.

## Typography

**Body Font:** Inter Variable (with -apple-system, BlinkMacSystemFont, Segoe UI)
**Mono Font:** ui-monospace (SFMono-Regular, Menlo)

**Character:** a single neutral family, readable at small sizes, with hierarchy through weight and tone, not size.

### Hierarchy
- **Title** (600, 15px): page title and headings inside markdown replies. It is the largest size in the system.
- **Body** (400, 13px): default text for the whole interface and the chat.
- **Body Medium** (500, 13px): buttons and emphasis in lists.
- **Small** (400, 12px): field labels, metadata, small buttons.
- **Label** (500, 11px, uppercase, 0.025em): sidebar section labels and badges.
- **Code** (12px, mono): inline code and blocks.

### Named Rules
**The Four Sizes Rule.** Only 11, 12, 13 and 15px. New hierarchy comes from weight (400/500/600) or text tone, never from a fifth size.

## Layout

The whole window in four layers: the frame; the **icon rail** (60px) and the 248px sidebar directly on it; and a single content card (workbench) that takes the full height and reaches the right edge of the window, with 16px corners and a subtle border only on the left side (facing the sidebar). The card always has the same header: 15px semibold title, a description in text-muted beside it and the actions on the right, with a subtle border below.

- **Icon rail**, separated from the sidebar by a subtle hairline: the logo at the top; right below it the button to collapse/show the sidebar (also ⌘B / Ctrl+B, or clicking Chats again when already on it; remembered on this computer; when collapsed, the content card gets a 12px margin from the rail), a short hairline, and then the app's places, a 20px icon in a 40px button with the name in a tooltip on the right — Chats (home, chat and project), Needs you (with the accent counter in the corner), Agents, Routines, Knowledge; the current place is in `hover` with the text in `fg` and `aria-current`. At the bottom, pause all agents (⏸; when paused, ▷ in warning and a strip at the top of the content "All agents are paused…" with Resume), the stacked usage rings (one per subscription, each with its own card on hover, they open Usage; with no subscription, the Usage icon) and the Settings gear. In the desktop app the rail starts below the title bar. **Update (desktop):** a card at the bottom of the sidebar, border only (no `surface` background, so the sidebar's `control` track shows): download icon and "Zorel {version}"; while downloading, the progress bar (`Meter` with `role="progressbar"`) and "Downloading… N%"; when ready, "Ready to install" and **Restart** in blue. The rail holds the download icon (dim while downloading; blue with a dot when ready) for when the sidebar is collapsed.
- **Sidebar:** only the Chats and Projects sections, which scroll (details in Navigation).
- **Chat (2026-11-04):** the timeline and the message field share a centered **reading column** (`max-w-chat`, 46rem, ~75 characters per line), with 32px of breathing room outside it, and align on the same edge. Message text uses `text-chat` (14/22), one step above the interface's 13px. The bubbles of your messages sit on the right with their own width. In a chat with only one agent (or none) the reply has no avatar or name (the header already says who it is); with several, the author appears once per sequence (same agent within 5 min). The side panel (Changes, Git, Files, Browser, Terminal) opens on the right and the chat gives up the space.
- **Chat components:** `ChatMarkdown` (features/chat-markdown.tsx) renders the text: code in `CodeBlock` (header with the language and Copy, scrolls sideways) and tables in `TableFrame` (`rounded-card` frame, header in `surface`, hairlines between rows), both in `@/ui`. While the agent works, the label of the current step passes with a shimmer (`ShimmerText`, token `--animate-shimmer`, still with reduced motion); before anything comes back, it says "Waiting for <provider>" without shimmer; the time only appears after 5 s. A teammate named with `@handle` (in a reply or in your own message) is a **mention chip**: a pill in the control tone with the agent's 16px avatar and name, in `secondary` 500; it is a link to that agent's page (hover `control-hover`, accent focus ring), for exactly what the server routes on (`MENTION_RE` in contracts: an `@` not glued to a letter, digit, `_`, `.` or `-`, so "(@tester)" calls and an e-mail does not, then a teammate's handle; outside code), so a chip always means someone was called. The queue's items carry "Send now" (ghost, with a tooltip that says the effect: joins the reply in progress, or stops it). A decision already taken stays in the reply as a **receipt**: a 28px ghost row (icon, "Allowed"/"Denied"/"Expired", what it was in one truncated line, chevron) that opens a `code` panel with the whole command in mono, its folder, every argument and Copy. When finished, the steps become one line: "3 steps · 1 failed · 12s". Approvals and questions stay **above the message field** (`PendingTray`) until you decide, never scrolling away with the conversation. Each one is a `TrayCard`: the same frame as the message field (`canvas`, `strong` border, `rounded-card`), so the two read as a single piece; the accent is only on the small line of who is waiting, with an icon ("Lead asks you" with `MessageCircleQuestion`, "Lead waits for your OK" with `ShieldAlert`); the text in `fg`; options, field and "Send" in the `control` family (blue is kept for the main action: Allow, and the message field's send).
- **Pages** (settings, knowledge, accounts) sit in a column of up to 672px flush against the left navigation (not centered), with each section a **group** (2026-11-05, replaces "rows on the canvas, never in cards"): its title in 12px muted outside and above, an optional hint in `dim` below it, then one `Rows` card (surface, subtle border, 12px corners, 16px inside) with hairlines between its rows. A setting is a `SettingRow`: title, a line of explanation, the control on the right (it wraps under the text on a narrow column). Groups are never nested and carry no shadow: the tone step is the depth. A page is still a list of settings, not a dashboard: no hero cards, no icon-plus-heading tiles. Each area has at most one blue primary action ("Add key" with no key, "Sign in" when disconnected). A detail page opens with a small back link ("‹ Providers") above the icon and title (h1) header; it does not repeat the title in a breadcrumb. While the first read is loading, nothing says "not connected": the summary shows "Checking…"; a failure becomes an error line with try again. Actions that delete something (key, account) ask for confirmation. The Settings tabs, in this order: General (preferences for this computer; Appearance with the theme in a segmented control, Notifications, Agents — "Agents working at once", a select from No limit to 12, default 4 —, Startup, About), Providers, Connectors, Skills, Storage, Audit log; the sidebar gear opens General. Long lists (Audit log) filter on the server (type, words, day range in a `DateRangeField`: React Aria's DateRangePicker in the shadcn aria style, two typeable fields and a range calendar in the popover; never the browser's native calendar) and paginate 50 at a time with "1–50 of N" and Newer/Older; entries grouped by day (Today, Yesterday, date).

The internal rhythm uses the 4px scale, almost always 4, 8, 12 and 16px; between messages, 24px.

Control height follows the fixed scale: 24px (icons and inline actions), 28px (list items, small buttons, single-line tooltip, segmented, tabs), 32px (default for buttons and fields; the sidebar's chat rows are 32px because they have an avatar) and 36px (prominent primary action). Text lines have whole-number heights (11 and 12px → 16px, 13px → 20px, 15px → 22px, tokens `--text-*--line-height`), so that no control or block lands on a half pixel.

**The Scale Rule.** No control height outside 24 / 28 / 32 / 36px.

### Charts

- Categorical series in a fixed order (`--z-series-1..7`, one per harness: Codex, Claude Code, Anthropic, OpenAI, OpenRouter, Ollama, LM Studio). The color follows the entity, never the position; validated for color blindness and contrast in both themes (in the light one, three fall below 3:1, which is why every chart has a legend with values and a table view).
- 2px lines, area at 14% opacity, 1px grid in the border color, axis with round values (1, 2 or 5 × 10ⁿ). Text never uses the series color; identity comes from the dot or stroke beside it.
- Hover and keyboard: a vertical line follows the nearest day and a single box lists all series; the chart is a slider (arrows change the day).
- Main number (hero) ≥48px, same font, proportional figures; `tabular-nums` only in columns.

## Elevation & Depth

No shadows. Depth comes from layers of tone: frame (and sidebar) → workbench → surface → raised, each step a little lighter in the dark theme. 6% borders separate when tone alone is not enough; popovers and dialogs use the strong border.

**The Dialog Rule.** Creating something with more than one field (a project, a custom MCP server) happens in a centred dialog, never in a popover hanging from its button or a form pushed into the page.

**The Flat Rule.** Surfaces are flat. If something needs to stand out, it goes up one step in tone; it does not get a shadow. Two exceptions: the open chat in the sidebar, a raised chip with `shadow-chip`; and floating layers (menus, popovers, selects, the composer's / @ $ # list, the command palette), which are `float`: the raised tone at 86% with blur and `shadow-float`, so they hover over the chat instead of covering it. Dialogs and tooltips stay solid.

**The Graphite Rule.** Neutrals are not dead grey: each carries a trace of the brand blue (OKLCH hue 260, chroma 0.005): rail/frame 15.5%, sidebar 17.5%, canvas 21%, surface 23.5%, raised 25% lightness, the graphite the landing shows. Selection speaks blue: the focused item in a menu or list gets `accent-soft` with its icon in `accent-text`, and the current place in the rail its icon in `accent-text` on `accent-faint`.

## Shapes

Softly rounded corners, growing with the size of the object: 4px on inline code, 8px on controls, 12px on cards and code blocks, 16px on sheets and dialogs, pill on badges. 1px borders, always with the border tokens.

## Components

### Buttons
Compact and direct, with a physical squeeze on press.
- **Shape:** control corners (8px), heights 28 / 32 / 36px (sm / md / lg).
- **Default:** signal blue with white text. One primary action per area.
- **Secondary (default):** control background, with steps on hover and on press.
- **Ghost:** muted text only; gets a control background and full text on hover.
- **Destructive:** translucent red background with red text; turns solid red on hover.
- **States:** visible focus with a 2px blue ring; disabled at 50% opacity and not clickable; `scale(0.97)` on press over 120ms; hover only with a pointer (React Aria does not fire hover on touch).

### Chips / Badges
- **Style:** 20px pill, 11px label at weight 500.
- **Tones:** neutral (control + muted), accent (translucent blue), success (translucent green, only for state: "Connected"), warning (control + orange), danger (translucent red).

### Cards / Containers
- **Corner Style:** 12px.
- **Background:** surface.
- **Shadow Strategy:** none (see Elevation & Depth).
- **Border:** 1px subtle.
- **Internal Padding:** 16px.

### Inputs / Fields
- **Style:** control background, subtle border, 8px corners, 32px height, placeholder in text-dim.
- **Focus:** strong border and a 2px translucent blue ring.
- **Disabled:** 50% opacity.
- **Field:** 12px muted label above, 11px dim hint below.
- **Input sizes:** `Input` takes `size` — `md` (32px, forms, the default) or `sm` (28px with 13px text: toolbars, filters, side panels). Screens never set a height class on a field.
- **SearchInput:** the search field everywhere (settings skills, knowledge, audit, the model picker, the file explorer): the magnifier inside on the left, 14px at `sm` and 16px at `md`, never drawn by a screen.
- **Rows / SettingRow / ListRow:** every list on a page is a `Rows` group; a setting row is `SettingRow` (an optional icon tile on the left; a hint in a state color passes its own span; `check:ui` rule `hand-setting-row` keeps hand-made ones out of screens), a row that opens something is `ListRow` (or a row with `RowHit` under its content, whose hover wash reaches 6px from the card's edge); screens don't write `divide-y` or full-bleed ghost buttons inside a group. An icon tile inside a group uses the translucent control tone, never `surface` on `surface`.
- **IconTile:** the square that holds an icon beside a row or a heading (connectors, git, inbox, processes, empty states): sm 28px, md 32px, lg 40px, on the translucent control tone.
- **Notice:** an alert card on a page (a usage limit reached, failover terms): the icon in the state color, the text in the page's own, an optional action under it. The app-wide offline strip is its own thing.
- **Builder (Build with AI):** a screen of its own, not a chat. The conversation sits on the right (416px); the middle first explains the flow in four steps, then, once a proposal arrives, holds the review (the team's faces, "Review the team", "N agents · scope · nothing is created until you approve", a card per agent with role, description, primary model, access, reach and instructions on demand, the decision in a bar that stays in view). The Describe → Powers stepper shows only for a single agent; Powers is the same editor as the agent's Tools and access tab. What was created there is a group of rows that open each agent. It starts on Claude Code's Sonnet when available, else the first available subscription model, else any; when none is available or the start fails, an empty state says so with "Open Providers" and "Try again". Each visit starts fresh; "Build it myself" opens the empty form.
- **Agents screen:** a reading column of groups (Global, then each project with agents), each titled with its count ("Global · 12"); every agent is a row (`AgentItem`, a `ListRow`): 28px face, name with "● working" in accent while a chat of theirs runs, title (or description) below, the model as the quiet text on the right, ⋯ (open, export, delete), the whole row opens the agent. Past 8 agents a search sits in the header (name, title, description). The project's Agents tab uses the same rows.
- **Needs you:** every open approval and proposed memory in one group of rows (reading column): face, who, "in <chat>" where the chat's name opens it, the age; the request; its decisions (Allow / Allow always / Deny, or Keep / Edit / Discard). The filter tabs in the header show a count only when it is above zero.
- **Archived agents:** an agent's ⋯ has Archive (Restore when archived). Archived agents leave the groups and every picker; at the end of the Agents screen an "Archived · N" section, folded (Show / Hide), lists them with their ⋯. Their page opens with a Notice ("This agent is archived", Restore).
- **Token limits (agent page › Model):** "Monthly token limit" and "Per-reply token limit", each a `SettingRow` with a select (No limit, then steps in tokens), applied at once (not part of the profile's Save).
- **A reply that ended early (chat):** on the last reply only, beside its ending: Continue after its reply limit, Try again after a failure or a stop, Raise the limit (opens the agent) when it was over its month's tokens.
- **Tag:** a quiet chip for a fact (an agent's model, access, reach); its `hint` explains it on hover. Facts are labelled ("Runs on …", "Access: …", "Reaches: …"), never bare values. In a list of agents a tag only marks what differs from the default (fallbacks, an access other than Workspace): the same tag on every row is noise.
- **Select with faces and search:** an option can carry an icon (an agent's 16px face), shown in the list and on the trigger. Past 8 options a search field (28px, magnifier inside) tops the list, the popover widens to 256px and an empty search says so.
- **Who answers on the home screen (2026-11-05):** no agent select. "#" in the message box calls an agent (the same list as in a chat: faces, filtered as you type, 8 at most, so it scales to hundreds) and leaves its blue chip in the text; when the message is sent, everyone it names joins the new chat (the first one named leads if no one was chosen); once someone answers (by "#" or the project's default) a chip beside the project shows their face and "<name> answers", with × back to a plain chat. The placeholder names only what the box does there ("Message · # call an agent").
- **Project overview:** the work first — Team (the faces who answer here as pills, the one who answers first leading with "answers first", Manage → Agents tab), then Chats, then "About this project" (name, folder, brief). A project page is not a settings form.
- **Narrow window:** under 900px the sidebar folds away on its own; opening it there is for the moment and never overwrites the choice made on a wide window.
- **OptionList / OptionRow:** options whose keyboard lives in a text field beside them (the composer's / @ $ # list, the folder browser): the field keeps the focus, a press selects a row without taking it, a double click opens a row that has something to open; selected = accent-soft with the icon in accent-text. A choice without a text field is a `Select` or a `Menu`.

### Select
- **Trigger:** same body as the field (32px, or 28px at size sm) with a muted chevron. `ghost` variant (28px, no border, muted text, optional icon on the left, 14px chevron) for choices next to a message box, the same as the model picker trigger — it is the one on the home screen (project and agent above the box).
- **List:** the same list surface as the Menu: `float` (with blur and `shadow-float`) and a strong border, 12px corners, 4px padding; 28px items with 6px corners (concentric: 12 − 4 − 1 ≈ 6), focus with accent-soft (icon in accent-text), selected with a blue check.
- **Floating lists, one language (polish 2026-11-05):** Menu, Select, ContextMenu, the command palette and OptionList share the `float` surface (blur + `shadow-float`, strong border, 12px corners, 4px padding, 0.98 zoom entry) and the same focus: `accent-soft` with the icon in `accent-text`; the chosen option keeps its blue check. Rows inside a 12px list are 6px (`rounded-md`); hover on a floating list is `control-hover`, never the frame wash `bg-hover`.
- **Open trigger:** while its menu, list or popover is open, the trigger stays lit (`popup-open` variant: a menu or select trigger by `aria-haspopup` + `aria-expanded`; a Popover's trigger, which React Aria does not mark as a popup, by the `[data-popup-open]` wrapper Popover puts around it; disclosure toggles never light): ghost → control-hover with full text, secondary → control-active, a field select → strong border; the select chevron turns 180°.
- **Popover body shrinks:** the Popover is a flex column that fits the room the window leaves; scroll areas inside take `min-h-0` and footers `shrink-0`, so a tall picker (models, team) scrolls instead of being cut.
- **Long lists search:** past 8 options a list gets a `SearchInput` (Select, the chat's team picker), and an empty search says "No agent matches".
- **Floating surfaces:** Select, Menu, Popover and Tooltip open 6px from the trigger (the context menu, at the pointer, 2px); Select, Menu and Popover enter with a fade + 0.98 zoom, the Tooltip with a fade only.
- **StepSlider:** a few named levels on one track (the model picker's reasoning): a 28px pill on the control tone, a dot per stop, a 20×36px thumb in the text color with 4px around it on every side (concentric with the pill), that follows the pointer freely while dragged (the level under it picked live), settles into the nearest stop on release and glides 200ms between stops on a press or a key (one level per key), squeezing to 0.95 while held; nothing moves under reduced motion; the level's name shown beside its label and announced by screen readers; arrows, Home/End, dragging and a press on the track move it. In the model picker it is the footer ("Reasoning · High"), only for engines with a level; the footer no longer carries tabs or the "switching keeps the context" line, and Settings › Providers is the gear at the foot of the account rail. The picker's body has one height (400px, shrinking to the window) for every provider, so the rail always fits and the popover never jumps in size; the model list takes the room left. A provider that is not set up (signed out, no key, server off) shows only "Not signed in" / "Not set up" and a Sign in / Set up button that opens its page in Settings: no setup instructions, no model list, no custom-id field until it works.
- **Segmented and tabs:** the segmented control is 28px in total (1px border, 2px inset, 22px pills with 6px corners inside the rail's 8px); tabs are 28px on a single line and scroll sideways when they do not fit, never wrap.
- **Header actions:** every button and field in a screen header is 28px (`size="sm"`); on desktop the header sits 16px from the right edge of the window.
- **IconButton:** same scale as Button — xs 24 (inline, sidebar rows), sm 28 (default: toolbars, headers), md 32 (next to a field, the composer's send/stop).
- **Pill shape:** `shape="pill"` on Button/IconButton for chips and round actions (pinned shortcuts, connector presets, send, usage rings, chat members); screens do not pass `rounded-full` through className.
- **Focus rings:** action controls (buttons, tabs, segmented) use the accent ring; text fields, accent-soft, because the caret already shows focus. Rings show only during keyboard navigation, as in a native app: Tab turns them on (`data-keyboard` on the root), the next pointer press turns them off; focus coming back to a trigger after a menu or select closes never draws one. Images and links never drag a ghost.

### Dialog / Tooltip
- **Dialog:** 16px-radius sheet in raised with a strong border over a dark overlay; 15px semibold title; actions on the right. A destructive action is always confirmed by a dialog (never `window.confirm`), with initial focus on the confirm button.
- **Tooltip:** raised with a strong border, 12px secondary text, appears after 500ms on hover and on keyboard focus; the trigger is a `Button`/`IconButton` (React Aria).
- **Popover** (`Popover`): 16px sheet in raised with a strong border for interactive content (model picker, who answers). Esc and clicking outside close it; focus returns to the trigger. `FieldButton` is the field-looking trigger inside forms.

### Navigation (redesign "Zorel — main screen", absorbed on 2026-11-03)
- **Sidebar:** 248px on the frame, next to the icon rail (which holds the logo, the places, usage and Settings; see Layout). A 28px **Search** button on top (opens the ⌘K palette; the sidebar has no filter of its own), then two scrolling sections, stacked with 20px between them: Chats (the chats without a project; its title's tooltip says "Conversations outside any project") and Projects (the tree, with drag and drop). Each section's title has an icon in the icon column, collapses and expands (remembered on this computer) and has a + on the right (new chat, new project). **Adding a project** opens a centred dialog that maps a folder to a project, as T3 Code does: a folder browser like Finder's (`GET /api/folders`): one block made of an address bar (back, forward, up, the path field, and in the desktop app the system's folder picker as an icon) and the list right under it; a click selects a folder (the name and "Adds …" follow it), a double click or the › of the selected or hovered row opens it; git repositories marked; keys in the path field: ↑↓ select, Enter opens, ← goes up, ⌘Enter adds. Then, after a larger gap, the name; the footer holds only the endings (Create without a folder, quiet, on the left; Cancel and Add project on the right). Home and the disk root can't be added (the button stays off with a hint).  and the name comes from the folder ("Create without a folder" stays possible). The brief is written later, in the overview. **Each chat is two lines** (52px): on top the title and, on the right, how long ago it was touched (spinning while it runs); below, in muted, who answers and the model ("Dev · Opus 4.7"; several agents: the lead and "+1"; no agent: only the model) — or, while something is happening, the state in words (blue when it is waiting for you, red when it failed). In each group, chats waiting for you come first, then the ones working, then manual order and activity; each group shows 5 and a "show more". While there is a hidden list below, it disappears into a 24px fade. Usage (rings) sits at the bottom of the rail: one per subscription (the most at risk first, up to 3, stacked), 34px, one arc per limit window (concentric, the longest on the outside; the arc is the % used: green, yellow if the pace empties the window before it renews or from 80%, red from 95%), the logo in the center; each ring opens Usage and has its own card (rings per window, the pace sentence and each window with % and when it renews).
- **`NavLabel`:** 28px, 12px weight 500 `secondary` in normal case, the same colour in every section. The section icon (14px) occupies the icon column; the title is a button that collapses and expands (12px arrow after the name; remembered on this computer) with a tooltip saying what the section holds; on the right a 24px +. While collapsed, a count in accent text shows how many chats wait for you.
- **Search:** 28px ghost button at the top of the sidebar: icon in the icon column, "Search", the shortcut (⌘K, Ctrl K elsewhere) in `dim`.
- **`NavItem`:** 32px, 8px corners, 16px muted icon in a 20px box (the icon column), text starting at x50; hover in `hover`, never blue.
- **Project:** a 32px row: a folder (open folder when open) in the icon column that turns into the opening arrow on hover or focus; the name in 500 `fg`; on the right, discreet (`dim`), how many chats it has — or the state: a blue 6px dot when some chat is waiting for you, spinning green when some chat is working. On hover or focus, + (new chat in it) and ⋯ (the menu: Open, New chat, Settings, Remove) take that place; always shown on touch. The project's chats come with a slight indent (24px), attached to a subtle vertical hairline; an empty project opens to one quiet row, "No chats in this project · Start one".
- **Chat:** two lines (detailed in the Sidebar item). The icon column holds the lead's 20px avatar (the model's logo with no agent, the channel icon with several); a status adds a dot on the avatar's corner (blue waiting, red failed) and its words on line 2. The open chat is the raised chip. ⋯ (Open, Rename, Delete; same as right-click) replaces the time on hover or focus, always shown on touch. Inside a project it is indented under the name, on the vertical hairline.
- **"Show more":** 28px, 12px muted, its text aligned with the titles above it.
- **Empty states:** muted 12px text in the text column with one secondary action ("New chat", "Add project"); never filler content.

### Image viewer
- An image in the chat opens inside Zorel (`ImageViewer`), never in a new tab: a modal over the dimmed app, the image as large as it fits (object-contain, strong border, 12px corners) and, above, a bar with the name, "Open original" and close. Esc, clicking outside or the button close it; focus returns to the thumbnail.

### Motion
- **Motion** (motion.dev, `motion/react`, in `ui/motion.tsx`) for what CSS does not do cleanly: width and height to/from `auto` without unmounting, and a shape sliding between places. A single spring in the app (`spring`: no bounce, ~220ms visual). `MotionConfig reducedMotion="user"` at the root: with reduced motion in the system, everything changes state without animating.
- Sidebar: collapses and opens by animating the width (`SlideWidth`), with the content mounted (scroll and state are kept). Chats and Projects sections: open and close by height (`Fold`). Rail: the current place's background slides from the previous one to the new one (`Marker`, `layoutId`).
- The rest stays in CSS (`transition-colors` 120–150ms on hovers; arrows rotate in 150ms).

### Side panel
- **Git** (side panel): header with the branch (mono), the upstream and where the PR goes, and ↑/↓ as a Badge; parts separated by a hairline with title and count: **Changes** (the message box like the chat field, "Write it for me" ghost and Commit in accent, then the files with an icon per format, name, folder in `text-dim` and A/M/D/R via `StatusMark`), **Ship** (push/publish and the PR as a card with state), **History** (timeline: accent dots for what has not been pushed) and the branch/worktree actions.
- **Settings:** a single column for all pages, `max-w-5xl` centered: it fills the space up to the reading width.
- **Files** (`FileTree` + `FileIcon` in `@/ui`): 28px rows, 12px indent per level, chevron, icon per format (the language's mark in its color; marks that are too dark use `text-muted` to read in both themes), name in `text-secondary` (in `text-fg` if it changed or is selected) and the letter A/M/D on the right. Selected: `bg-accent-soft`; drop target: `bg-accent-soft` + accent ring. A thin bar at the top with New file and Collapse folders; Undo for the delete in a strip at the bottom of the panel. Tabs like the terminal's: the first is always Files (with name search and the buttons), then one tab per open file (icon + name, ×), with the path, Show changes and "Open in its app" above the code.
- The chat header does not have one button per surface: it has the pinned shortcuts and **one** panel button (panel icon + the +N −M of what the chat changed). It opens the side panel, to the right of the chat, with the surfaces as pill tabs: **Changes** (with the delta), **Git** (only in a repository), **Files**, **Browser** and **Terminal** (Files and Terminal only with a project folder), and × to close. Below 768px of panel the tabs show only the icon (the name stays in the tooltip and the accessible name).
- Width adjustable from the left edge (drag, or focus + arrows), remembered on the computer: 560px by default, min. 360px, max. 70% of the window.
- **Pin:** right-clicking a panel tab ("Pin to the title bar") or a Terminal shell tab (also "Close") puts a shortcut in the title line, between Git and the panel button: a ghost pill with icon and name (a tab's shortcut is `secondary` while that tab is open). Clicking opens the panel on that tab (or that shell); clicking again closes it. Right-click on the shortcut: "Unpin". Pinned tabs apply to all chats (on this computer); shells, to their own chat, and the shortcut disappears when the shell closes. A small pin (dim) marks the pinned tab.
- Browser and Terminal stay mounted after being opened: switching tabs does not drop the connection. "View" on a turn opens on Changes; a server opened from the Terminal opens on Browser; `/terminal` and `/changes` in the composer open the tab.

### Terminal
- Terminal tab of the side panel, taking the full height.
- The tab is never without a shell: the only open shell has no × (and does not close via Delete or the menu); if it ends on its own, the × appears and closing opens a new shell in its place.
- Opening the tab opens a shell (or brings back the chat's shells): pill tabs "Shell 1", "Shell 2"…, the + opens another. The commands the agents ran stay in the chat, in each reply's steps, not here.
- Each shell lives on the server (a login shell in a PTY in the folder where the chat's agents work): closing the panel or reloading only disconnects; on return, the tabs and layout reappear and the end of the output is shown again. Closing the tab (× or Delete/Backspace on it) ends the shell, asking first if something is still running in it; closing the last tab closes the panel.
- A tab splits into up to 4 panes, side by side or stacked (buttons in the bar); each pane is a shell, with × on hover when there is more than one.
- Links: URLs open in a new tab; file paths (src/a.ts:12) open the file in the computer's default app, only inside the chat's folder.
- Selecting text shows "Add to chat": the excerpt goes to the message field in a code block, after what is already typed.
- **Run a script** (▷ in the bar, only when the folder has a `package.json` with scripts): a menu with name and command on one line; choosing one opens a tab with the script's name (▷ icon) that runs `<manager> run <name>` (bun, pnpm, yarn or npm, by the lockfile). The tab is a shell like the others: the process keeps running on disconnect and closing the tab ends it.
- **Servers** (server icon): a popover with the processes that listen on a TCP port and whose working folder is the chat's (the dev servers an agent or a shell started), each port as a `localhost:N` link that opens in the chat's Browser, and ■ to stop (SIGTERM). Read again on each open.
- xterm.js with the token colors (`code` background, secondary text, accent-soft selection) and the mono font; the size follows the panel.

### Git in the chat
- **Git** tab of the side panel (only when the project folder is a git repository). Pinned to the title, it appears as the branch button: branch icon (folder when in a worktree), the branch name, the number of changed files (warning) and the commits to push (↑N, accent). The tab shows:
  - a header with the branch and a state line ("2 files changed · 1 commit to push · no remote");
  - the changed files (mono) and, further down, the branch's latest commits (hash, subject, time; accent icon on the ones not yet pushed);
  - with changes: the message field (mono), "Write it for me" (the chat's model writes it from the diff, in the style of the repository's recent commits) and "Commit N files" (everything in the folder goes in);
  - "Push N commits" or "Publish branch" (no upstream); the branch's open PR as a link (#12 title ↗), or "Create pull request" (off the main branch, with `gh` installed): the model drafts title and description, editable before opening;
  - "New branch" takes the current work to a new branch;
  - "Work in a worktree" gives the chat its own folder on a new branch (empty name = `zorel/<title>-<id>`): agents, new shells, checkpoints and undo start using that folder, and the project's folder stays as it is. In a chat in a worktree the button shows the folder icon and the popover shows the path and "Back to the project folder", which only removes a worktree with nothing to commit (the branch stays). Deleting the chat removes the clean worktree.
- Errors appear in git's own words, in mono and danger; each completed step becomes a success line. Commit, push, branch and PR go into the Audit log (type Projects).

### Edit from here
- In your message's actions (hover), a pencil "Edit from here" (absent while a turn runs). It confirms in a dialog: the message and what came after leave the conversation and it goes back to the field for you to change and send again; if there were file changes afterwards, a switch (on) undoes them too. A file conflict appears in the dialog with the files.

### Cmd+K
- ⌘K / Ctrl+K opens the palette: a modal high on the screen (12% from the top), 576px, a 48px search field with a magnifier and a list in sections. Empty, it shows "Go to": new chat, Needs you, Agents, new agent, Routines, Knowledge, Usage, Settings and show/hide the sidebar. Typing filters that and finds chats, projects and agents by name; from 2 letters on, also "In messages": the excerpt around the word, with the chat and the age below. Arrows move, Enter opens, Esc clears and then closes.

### Resume on reset
- With every account of the chat at its limit, above the message field: a strip in a card with a subtle border, a clock in warning, "Every account is at its usage limit. This chat continues by itself at <time>." and Cancel. It disappears when the chat continues, when you cancel or when you write yourself.

### Comment on the diff
- In Changes, selecting diff lines (click or drag on the numbers) marks the excerpt and opens a box below it: "What should change here?", Cancel (or Esc) and "Add to chat" (or ⌘Enter). The comment goes to the message field as text: "Review comment on `file` lines 12–14 (new): …", for the agent to act on.

### Context menu
- The browser's native menu does not appear in the app (only in text fields and in the terminal, for copy and paste). Where there are actions, right-click (or the Menu key / Shift+F10) opens Zorel's `ContextMenu`, with the same look as the ⋯ menu, anchored at the pointer (or under the focused item). In the sidebar: chat → Open, Rename, Delete; project → Open, New chat in…, Settings of…, Delete project. Deleting always confirms.

### Browser
- Browser tab of the side panel: pill tabs with ×, +, then back / forward / reload and the address (Enter opens), a strip showing who holds the browser, and the live page (JPEG frames from the screencast, at a 1280×800 ratio).
- It is the agents' browser: a windowless Chromium on the server, with one context per agent (each with its own logins, which persist), with tabs per chat. Clicking, scrolling or typing on the page, or using the address, takes control: the strip turns blue ("You're using the browser…") with "Hand back"; meanwhile the agents' browser tools are refused.
- Agent tools: browser_navigate, browser_snapshot (the page as an accessibility tree with [ref=eN]), browser_click and browser_type by ref, browser_press, browser_wait, browser_tabs, browser_back, browser_hover, browser_select, browser_scroll, browser_upload (only files from the chat's folder), browser_dialog and browser_run (several steps in one call, the page returned once). Alert/confirm/prompt never block: they are refused (or accepted, if the agent asked) and counted in the next result. Reading never asks for approval; acting asks when the agent's access is "ask". Each use appears in the reply's steps.

### Agents (team screen)
- "Agents" item in the sidebar, between Needs you and Knowledge (it also stays active on an agent's page). A screen with a central column: **Global** (with the hint "Available in every project" and the empty state "No global agents yet") and then each project that has agents, each with a discreet + to create one there. "New agent" in the header creates a global one.
- Agent row: see **Agents screen** under Components (one `AgentItem` row, the same in the project's Agents tab).
- **Build with AI** (header of the Agents screen and the project's Agents tab, ghost with ✦): opens a "Build agents" chat with the Builder; it proposes the whole team in an approval card (each profile under the name).
- Agents are also born in the chat: an agent uses `zorel_create_agent` / `zorel_update_agent` and the request becomes an **approval card** with the profile field by field; nothing is created without the OK. The list updates at the end of the turn.

### Knowledge pages
- Knowledge screen rail: tabs for the kind only (All, Facts, Skills, Pages); below them a "Show" select (Active, To review · N, Forgotten) and the scope select (faces for agents, search past 8). `#/knowledge/in:<scope>[/fact|skill]` opens it filtered (an agent's memories from its page). With nothing learned or written yet, one empty state fills the screen (with New), never one per pane.
- Knowledge screen, **Pages** tab (next to Facts and Skills): a list with title (pin when pinned), scope and when it changed; "New" creates a page when the tab is open. The page opens rendered in Markdown (the same look as the chat), with "PAGE" in accent, scope and "updated …"; Pin/Unpin and Edit. Editing swaps it for title + Markdown text in mono, with Save, Cancel and Delete (confirms). Below, **Versions**: each version with who made it (You or the agent) and when; Restore brings back any one as a new version.

### Default agent and catalog
- The project's Agents tab: "New chats start with" (Select: Assistant or a global or project agent), saved immediately. A new chat in the project already comes with it selected (it can be changed before sending).
- **Connectors** (Settings): a two-column grid of cards (subtle hairline, `rounded-card`, no background), each with the service's mark (`simple-icons`, CC0, in a single color on a `bg-control` square; `Plug` when there is no mark), name, a line on what it gives access to, and one action: "Connect" (secondary), "Reconnect" with the line "Sign in again" in `warning` when the service rejected the credential or the login was left halfway (with ⋯ to disconnect), or "Connected". A connector's ⋯ has "Test connection", which connects and lists the tools: the line becomes "N tools working" in `success` or "Didn't connect" in `danger`. Connecting with a token or with no login already runs this test right away (a bad token shows up immediately, not on the agent's first turn) (green badge) with ⋯ › Disconnect. While the login is open in the browser, the line says "Finish signing in, in your browser…" and the button spins. GitHub opens the token field in the card itself, with "Create a token". Below, "Custom servers" with the usual list and form (without the old pill catalog).

### Agent versions
- **Settings: a single row** (`ListRow`): 56px between straight hairlines, content aligned with the section title (no indent), arrow on the right; the hover is a soft highlight inside the hairlines (inset, never a card on top of them). An action of the row's own (`trailing`) is an outlined button, readable on the highlight. In **Providers** each row states its state: connected with a green dot and the account (never repeating the provider's name), and the next step in the row itself ("Sign in", "Add key"); a stopped local server only says "Not running" (it is resolved outside Zorel). The active item of the Settings navigation has a `control` background (on the card, the sidebar's `canvas` would disappear). Empty lists use `EmptyState` with the primary action in blue. General separates **Appearance** and **Notifications**. The new MCP server form sits between hairlines, without a card. In the audit history, under the day, only the time; "by you" / "by Builder"; the arrow goes along with the new value.
- **Agents** (as a page): a single primary **New agent** button with a menu — Build with AI, Blank agent, Import from file — and, in each project, a "+" with the same menu already scoped to the project. 56px rows: avatar, name (and "working"), role, model; the ⋯ (appears on hover or focus) opens, exports or deletes. The Builder does not appear in the list or in the pickers (it belongs to Zorel).
- **Powers as simple choices** ("give tools, not keys"): one row per power with an icon in a tile, what it means in one sentence and a segmented control on the right — Files and commands (Read / Read and write / Everything, the hint in warning on Everything), The web (No access / Read), Its own browser (No access / Use it), each connector (No access / Read / Read and write). The same editor in the Tools and access tab and in the Powers step of Build with AI.
- **Sortable lists** (`SortableList`, `@/ui`): the order is changed by dragging each row's handle (`GripVertical`, dim, `fg` on hover), or with the keyboard (focus on the handle, Enter, arrows, Enter); the dragged row is at 50% and a 2px accent line shows where it lands. The row's controls keep working. Used in the fallbacks (the position number sits next to the handle).
- **Settings › Storage › Move to another computer**: two rows in the cleanup pattern (title, hint, secondary button with icon): Export (`Download`) and Import… (`Upload`, opens the picker and confirms in a `ConfirmDialog` that says what will be replaced). With an import ready, the hint is in accent ("comes in when Zorel restarts") and the button becomes "Cancel import". Invalid file: the hint in `danger`.
- **Settings › Processes** (trimmed on request: "it should be clean and informative"): a "Running now" section. At the top, a summary line, with no giant number or chart: CPU (`Cpu` icon) and memory (`MemoryStick` icon), each in a `bg-control` square with the value in semibold and the scale below ("100% is one of its 8 cores", "of 8.6 GB on this computer"), and "• Live" on the right. Then a single list: column header once (Process, CPU and Memory with icons), groups with a `text-xs` muted label and no paragraph (Agents working, Servers, Terminals, Agent sessions, Connections, Zorel), rows with icon, name and owner on a muted line, CPU and memory in fixed tabular columns (`w-16`, `w-20`), and the action as a quiet icon with a tooltip (`CircleStop` to stop, `X` to close), red on hover. The whole row opens what it is (`RowHit`). A remote connection and a turn show "–". The Zorel group (server, app, others) closes the sum with the total. No chevron, no cards, no bars.
- **Processes in the chat**: in the header, a pill button with `Activity` and the count, only when the chat has a server, terminal or live session; it opens a popover with the chat's total (`Cpu`/`MemoryStick` icons) and the same rows and columns as the page, plus "See all processes". It rereads every 5 s.
- **Question from an agent** (`zorel_ask_user`): a `TrayCard` above the message field, with the question in `text-chat` medium, the options as secondary pills (one click answers), an "Or type your own" field with Send (secondary) and Skip. In "Needs you", the same block (`QuestionAnswer`) under the question. The receipt says "Answered" or "Skipped".
- **Tasks between agents** (`zorel_start_task`): the task is an ordinary chat in the sidebar ("Mathcheck: …", the teammate's avatar, live status); the result enters the originating chat as a message from the teammate with the link "Open the task". The sidebar rereads the list when a status arrives for a chat it does not know.
- **Settings › General › Notifications and Startup:** with notifications on, the row gets "Send a test" (ghost) and, on desktop, "Open system settings" (secondary) with the hint in `dim` that the system also decides; "Play a sound" has "Listen" (ghost) and a switch, and the sound is a short chord generated on the fly (Web Audio, no file). In Startup, on desktop, "Keep this computer awake" right below "Open Zorel when you log in".
- **Settings › General › About** (last section): "Zorel {version}" (the version comes from `apps/desktop/package.json`, injected by Vite as `__ZOREL_VERSION__`) with the hint "The version of the app on this computer."; on desktop, "Check for updates" (secondary) checks right away and the hint becomes "Checking…", "Up to date", "A new version is on its way" (the sidebar card appears) or "Couldn't check…".
- **Essential memory** (Knowledge, active fact): the secondary button "Always in context" (with a pin; hint: it goes to every agent in every chat, before the most recent ones) toggles to "Not always in context"; when marked, the metadata line ends with "Always in context" in accent.
- **Fact update** (Knowledge and Needs you): a learned correction appears as "An update of a memory, from what you said", with the diff against the current memory and "Apply the change"; in Needs you, the text carries "· updates a memory" and only has "Review the change".
- **Skill improvement** (Knowledge): the notice at the top says "A better version of …" and the reason; in place of the text, the line-by-line diff (`LineDiff`: removed lines first in red with "−", then the new ones in green with "+", the rest muted, in mono on `code`); the primary button becomes "Apply the change". In Needs you, the improvement only has "Review the change" (it is never approved blindly). Below an active memory, "Earlier versions": who and when, opening one shows the diff against the current one, "Restore".
- **Tabs** never wrap the label (`whitespace-nowrap`, no shrinking); the list scrolls sideways.
- In Build with AI, the same discreet project picker from the home screen sits above the box ("Every project" or a project); switching restarts the conversation in that project. For code work without a project, the Builder asks to choose there before proposing.
- **Agent page in tabs:** **Profile** in three groups — *Who it is* (name and title side by side, the description), *Model* ("Primary model" with the picker on the right, then the fallbacks in the same group) and *Instructions* (one large field) —, **Tools and access** (one `SettingRow` per power with a segmented control; connectors; "Always allowed" chips with × to revoke; a dim line reminding that deleting, sending, publishing and paying always wait for you) and **Knowledge and activity** (Memories and Skills as rows with a count that open Knowledge filtered to this agent, Usage, Routines, History; only once the agent exists). One Save in the header saves every tab; edits not saved are kept on this computer, survive leaving the page and show "Unsaved changes" with Discard beside Save.
- In the approval card, **Always allow** (secondary, between Deny and Allow) only appears when the action can be permitted for good; the tooltip says where to undo it.
- On the agent's page, the **History** section (only from two versions on): one row per version, newest first — `vN` in mono, the fields that changed compared with the previous one ("Instructions, model"; the first says "Created"), who changed it ("You" or the name of the agent that proposed it) and when. The current one says "Current"; the others have "Restore", which confirms first and saves the old profile as a new version (nothing is lost).
- The agent's ⋯ menu: **Export** downloads `<name>.agent.json` (profile without the account: the account belongs to this computer). On the Agents screen, **Import** reads that file and creates a global agent, which opens right after; a file that is not a Zorel agent shows the error next to the button.

### Routines
- On the agent's page (Knowledge and activity) and on the Routines screen (one group per agent; its name opens the agent): a group of rows. Row: name; below, in muted, "Next <when>" (or "On demand"/"Off") and the last result ("ran 5m", "skipped … (chat was busy)", "failed …"); on the right ▷ Run now, ⋯ (open its chat, copy the webhook URL, delete — confirms) and the on/off switch. With a webhook, its `POST <url>` on a dim mono line. No routines: one muted line inside the group.
- "New routine" opens a centred dialog (Dialog Rule): from the Routines screen it first asks which agent (a select with faces and search); name, "What to do each run", "When" with shortcuts (every hour, every day 9:00, weekdays 9:00, Mondays 9:00, on demand only, custom with a cron pattern in mono) and a switch for the local webhook.
- Each routine has its own chat ("<name> (routine)") in the sidebar; that is where the agent answers each run.

### Agent page
- See **Agent page in tabs** above (Profile groups, Tools and access, Knowledge and activity, the kept draft).

### Model picker
- A popover with an icon rail on the left (one subscription account or provider per button) and, on the right, search across all models, the limits of the chosen account and its list.
- The rail only shows what is actually a path: each subscription account (with the initial when there is more than one for the same provider), API providers with a key, and local servers (Ollama, LM Studio) only while they are running. An API provider with a subscription's logo (Anthropic ↔ Claude, OpenAI ↔ Codex) only appears with a key, so it does not look like a second account.

### Agent message
- **Avatar:** 28px square, 8–9px corners, identity color, white initial. Name in 13px semibold and, on the same line, the activity pill.
- **Sequence:** consecutive replies from the same agent (within 5 min, with no notice between them) show the avatar and name only on the first; the others align the text in the same column.
- **Message actions:** below each message (yours on the right, the agent's on the left), over the space between messages and without taking up height: copy, details (a tooltip with model, tokens, account and cost) and the time. They appear on hover or focus, always on touch. Only the ending that matters (failed, canceled) stays always visible. 28px rhythm between messages.
- **Streaming reply:** no typing dots (the pill already spins); the text reveals frame by frame toward what arrived (about 6 frames to catch up; all at once with reduced motion), and only its last block re-renders.
- **Activity pill:** 24px, no background (hover in `hover`), 12px muted: state dot + summary ("3 steps", "Running the tests · 14 s") + chevron. The steps open on the line below, in a box with a subtle border and 12px corners with the time of each one.
- **Central notice:** 12px text-muted between two hairlines (task hand-off, model switch).
- **Approval card:** a single line, up to 520px: on the left what the agent wants to do in `accent-text` weight 500 and, below, the command in mono muted (pressing shows the arguments); on the right Deny (ghost) and Allow (blue, 28px). accent-faint background, accent-line border, 12px corners.
- **Decision made:** a 12px muted line: "Allowed" in green (or "Denied") · what it was.

### Message field
- A bar: 12px corners, strong border, canvas background. From left to right: attach (+), the text, the model (discreet button), the context meter (20px ring), stop (only during a turn) and a round 32px send in blue.
- The text is a Tiptap editor (one line that grows with Shift+Enter; Enter sends). Triggers, with the list above the bar (arrows, Enter or Tab choose, Esc closes):
  - `#` calls an agent: the same blue chip as `@`, sent as `@handle` (the lead and the model do not change; changing the lead is the header's team picker). The list shows every agent the chat can use: members first with their role, then the rest with "Add to chat"; picking only leaves the chip, and whoever the sent text names joins the chat at that moment (the send waits for it, and a failure keeps the text in the box with the reason), so taking a chip back leaves no stray member;
  - `@` mentions an agent the same way (same list) or a project file (neutral chip with the path, sent as `@path`; the agent reads it with its own tools). Agents first, then files; a file also matches by name;
  - `$` cites a skill: neutral chip, sent as `$handle`, and the turn carries its step-by-step;
  - `/` at the start of the line runs a Zorel command (compact, new chat, changes, terminal).
- **Queue:** what is sent during a turn waits in a card attached above the bar (one line per message: steer now, edit, delete) and goes out by itself when the chat is free. It is stored on this computer.
- **Context meter:** the ring shows how much of the model's window the next turn takes up (warning from 80%); the popover breaks it down into instructions, memories, skills, summary and messages (estimate), shows what the last reply actually read, when Zorel compacts on its own, and offers compact now or new chat.
- Who takes part in the chat (add, remove, lead) is in the header, on the members' avatars.

### Chat (signature component)
Markdown replies with a 0.6em rhythm between blocks, headings at 15px, links in signal-blue-text underlined, inline code on a control background and code blocks on surface with a subtle border and 12px corners.

### Avatar and provider logos
- `AgentAvatar` at 16, 20, 28 and 32px; pass `tone` = the agent's position in the project, so two agents never share a color (up to six). Without `tone`, a hash of the id keeps the color stable.
- `ProviderIcon`: official logos from Lobe Icons. Claude has the brand color; the others are monochrome (`currentColor`) and follow the text. Never on a white background.

### How the design system is maintained
- **No gallery:** the real screens are the reference; a new primitive is checked on the screen that uses it, in both themes.
- **`bun run check:ui`** (in CI): in the screens, outside `src/ui`, no literal color, arbitrary `[..]` value, raw HTML control, direct import of `lucide-react` or `react-aria-components`, or unicode glyph as an icon. It is a ratchet: the old debt is in `ui-baseline.json` and can only go down.
- **The impeccable detector** runs after every UI edit (local hook) and does a full pass at the end of the session.
- **`bun run check:i18n`** (in CI): no text in JSX or in user-facing props outside the `packages/i18n` catalog (`t()`). The interface is in English (D13); user content does not go through the catalog.

## Do's and Don'ts

### Do:
- **Do** use only the primitives from `src/ui` in the screens; they are the only visual API.
- **Do** use only tokens (`bg-surface`, `text-muted`, `border-subtle`, `h-control`…), never literal values.
- **Do** keep control heights at 24 / 28 / 32 / 36px.
- **Do** give every control visible focus, a disabled state, an accessible label and full keyboard use.
- **Do** respect "reduce motion" and keep transitions under 300ms.
- **Do** separate layers by tone before resorting to a border.

### Don't:
- **Don't** use a literal color outside `styles.css`: it breaks the light theme.
- **Don't** introduce a second accent or use state colors as decoration.
- **Don't** use shadows for depth.
- **Don't** create a fifth text size.
- **Don't** apply hover on devices without a fine pointer.
- **Don't** paint a button, link or state with an agent color.
- **Don't** put a card inside a card: inside the content card, separate with lines and space.
- **Don't** copy code or CSS from projects under non-commercial licenses.
- **Don't** use Radix, or shadcn's neutral palette and default `--radius`; the primitives come from shadcn `--base aria` already mapped to the `--z-*` tokens.

## Desktop title bar

In the desktop app (`?shell=desktop`), a 48px title bar spans the full width of the window above the rail, the sidebar and the content card: space for the macOS window buttons and ~15px of breathing room after them (`pl-24`), then back/forward — this group has the width of the rail + sidebar — and, starting at the card's edge (12px indent, the same as the items inside it), the header of the current page (title, subtitle and actions): `PageHeader` carries it through a portal to `#titlebar-slot`, and the card starts directly with the content. On the web, the same `PageHeader` is the bar at the top of the card. It drags the window (`.app-drag`; the controls inside remain clickable). The brand stays in the rail. With the sidebar collapsed, the header follows the arrows (the window buttons take the corner). Collapsing and showing the sidebar moves everything on the same spring (`spring`): the left group animates its width (`Width`, 308 ↔ auto) and the sidebar closes leaving a 12px groove (`SlideWidth closed`), so title and card slide together, without a jump. Nothing crosses the window buttons: the rail's hairline starts below the bar. On the web there is no title bar.
