# Feature Specification: Design Refresh

**Feature Branch**: `feat/agents-only-tools` | **Created**: 2026-11-12 | **Status**: Draft

**Input**: "crie a spec da mudança de design; seja preciso e consistente; sempre personalizável, bem componentizável,
modular" (2026-11-12). The look and the main screens were redesigned in a prototype canvas
(https://claude.ai/artifact/Sk5n7GD69YCQgCi5mKYCfB, boards: Guia, Início, Chat, Precisa de você, Projeto, Agentes,
Builder, Rotinas, Memória, Configurações, onboarding, mobile, pairing) through a series of user decisions recorded in
`.agent/memory/design-system.md`. This spec turns that prototype into the app's design system and screens: one set of
tokens anyone can retheme, one component per pattern, and screens composed only from those components.

## Baseline (2026-11-12)

| What | Today | After this spec |
|---|---|---|
| Neutrals | Graphite, hue 260, chroma 0.005 (frame #0b0c0e … raised #1c1e21) | Same family, pulled to the blue's hue (frame #0b0c10, canvas #121419, surface #191b21, raised #202229) |
| Action colour | Blue #0071e3, white text 4.7:1 | Blue stays the only action colour; harmonised value #2a6af0, white text 4.75:1, hover #2259d6 |
| Links | Blue text | Text tone; blue only on the main action |
| Agent identity | Six hues (OKLCH 68% 0.12) on a rounded-square tile with an object figure | Six hues at one lightness and chroma, re-derived; the agent is a circle with two white pill eyes |
| Working state | Spinner / arc | A flat ring in the agent's hue with one dot travelling round it; no gradient, no glow |
| Type | Inter, body 13px, 11/12/13/15 | Inter with optical sizing, six steps 26/17/14.5/13.5/12.5/11.5, tabular numbers only where numbers align |
| Controls | 24/28/32/36 scale | 32 default, 26 small; radius 10 (small 8); cards 16 with 6 inset, rows 10 (concentric) |
| Home | New-chat box over orbits | Início answers four questions (start, needs you, working now, today) |
| Builder | Review panel beside a chat | A conversation; each proposal is a card under the Builder's message |
| Routines | Week grid with side panel | One clean week grid (desktop) / agenda (phone), runs filled by outcome |
| Knowledge | Memory, Skills, Pages screens | Unchanged features; the Memory screen restyled to the new list pattern |
| Phone | No app; server-side pairing exists (spec 014) | App screens and the QR pairing flow designed (app build is a later spec) |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One themeable set of tokens (Priority: P1)

Every colour, size, radius, shadow, duration and easing the app uses comes from named tokens in three layers: base
values (the palette), roles (canvas, surface, text, muted, action, waiting, done, failed, agent-1…6), and component
tokens (button height, card radius, row inset, ring width…). A theme is a set of overrides of base or role tokens.
Changing the action colour, the neutrals or an agent hue in one place changes every screen, in both light and dark.

**Why this priority**: Everything else is built on it; without it the redesign drifts screen by screen and can't be
personalised.

**Independent Test**: Override the action role with another colour and the neutral base with a warmer grey in one
theme file; every screen (desktop and phone prototypes' equivalents) follows, with no literal colour left in any
screen (check:ui stays at zero).

**Acceptance Scenarios**:

1. **Given** the default dark theme, **When** text is measured on canvas, **Then** text is ≥16:1, secondary ≥10:1,
   muted ≥5.5:1, the link tone ≥7:1, and white on the action colour ≥4.5:1.
2. **Given** a theme that overrides only `action`, **When** any screen renders, **Then** only main actions, focus
   and selection change; agent faces and states don't.
3. **Given** the light theme, **When** the same contrasts are measured on its canvas, **Then** they meet the same
   floors.
4. **Given** a screen file, **When** check:ui runs, **Then** it finds no literal colour, size or radius outside the
   token files and `src/ui`.

---

### User Story 2 - One component per pattern (Priority: P1)

Screens never style controls, rows or agents by hand. Each repeated pattern of the prototype is one component in the
shared library with a small, documented set of variants, and screens compose them. The guide board ("Componentes,
estados e voz") is the catalogue of record.

**Why this priority**: The redesign must stay consistent as screens are added; modular components are what make that
cheap and make a rethemed or reshaped component change everywhere at once.

**Independent Test**: Grep the screens: no hand-made button, row, chip, tag, segmented control, switch, avatar, ring
or sheet; each comes from the library. Changing a component's token (e.g. row inset) changes every list.

**Acceptance Scenarios**:

1. **Given** the component inventory (Key Entities), **When** a screen needs one of those patterns, **Then** it uses
   the component; a new pattern enters the library before a screen uses it.
2. **Given** a component, **Then** it supports both themes, keyboard focus, an accessible name, and reduced motion.

---

### User Story 3 - Agents have one identity everywhere (Priority: P1)

An agent is always the same round face: a circle in its hue (14% tint on surfaces, solid on the brand orbit) with two
white pill eyes slightly above centre. Its state lives on the face: idle (still), working (a flat ring in its hue with
one dot travelling round), waiting for you (a breathing amber dot at the top right), done (green dot), failed (red
dot). Alive faces glance left, back, right and blink in between, one eye a beat after the other. People are rounded
squares and never wear an agent hue.

**Why this priority**: Agents are the product; their identity is the brand's personality.

**Independent Test**: Put the same agent in the sidebar, a chat header, a list row, a mention chip and the phone tab
screens: same hue, same eyes, same state marks; switch on reduced motion and every face is still and still legible.

**Acceptance Scenarios**:

1. **Given** an agent working, **Then** its face shows the ring and travelling dot, with no gradient, glow or coloured
   shadow.
2. **Given** an agent waiting for the person, **Then** its face shows the amber dot and its line says so in amber.
3. **Given** two agents in one project, **Then** they never share a hue (up to six).
4. **Given** reduced motion, **Then** eyes, rings and dots stop and the state stays readable from the marks and text.

---

### User Story 4 - Início answers four questions (Priority: P1)

The home screen, first in the sidebar, shows in this order: start something (greeting, "No que vamos trabalhar?",
project and who-answers chips, the message box), what needs you (the first two items with their actions inline, "Ver
todas"), who is working now (rows with the working ring, current step and progress), and today (the routines' brief
since the day started, one line each, "Mais N execuções não encontraram nada novo", the next run). Recent chats stay
in the sidebar.

**Independent Test**: With one approval pending, one agent working and two routine results, Início shows each in its
section; approving from Início clears it from Precisa de você.

**Acceptance Scenarios**:

1. **Given** nothing pending, **Then** the "Precisa de você" section is absent (not an empty box).
2. **Given** more than two pending, **Then** two show and "Ver todas" opens Precisa de você.

---

### User Story 5 - The Builder is a conversation (Priority: P1)

Creating an agent is a chat with the Builder. Each proposal is a card under its message: face (40) + name + role +
"proposta do Builder", instructions clamped to three lines, one facts line (model · effort, what it may do, browser,
tools), the first task, and Criar e testar / Editar antes / Descartar. Asking for a change produces a new card; the
replaced one collapses to one faded line. After creating: "<nome> entrou no time" with Abrir conversa. "Criar à mão"
opens the plain form.

**Independent Test**: Ask for an agent, ask for one change, create it: two cards (one collapsed), one created state,
and the agent appears in Agentes with its face.

**Acceptance Scenarios**:

1. **Given** a proposal, **When** the person asks for a change, **Then** the old card shows "Trocada por uma proposta
   mais nova" and the new card is the only one with actions.
2. **Given** a team proposal, **Then** each agent is a row in one card with "Criar todos" (sequence as in spec 010).

---

### User Story 6 - Work screens restyled to the new patterns (Priority: P2)

Chat (approval joined to the message box; the side panel with Alterações/Arquivos/Terminal; working status line),
Precisa de você (cards with inline actions, quick replies for questions, memory proposals, a friendly end of list),
Projeto (about, chats waiting first, team, repository), Agentes (state on the face, one action per card, Builder
invitation), Rotinas (one week grid 07–22, runs filled by outcome — pendência / algo novo / nada novo — planned ones
dashed, quiet hours hatched, the day-start line, a legend and the week's counts in one line; no side rail or mini
month), Memória (Fatos / Mapa / Páginas, owner tabs, Novas with Guardar/Descartar and update diffs with Aplicar,
Ensinar field, Sempre no contexto pin, Ainda vale?), Configurações › Provedores (usage rings, keys and local models).

**Independent Test**: Each screen in the prototype has its counterpart built only from library components and the
same real features it has today (no invented ones).

**Acceptance Scenarios**:

1. **Given** any screen, **Then** there is at most one primary (blue) action per area, and links use the text tone.
2. **Given** Rotinas, **Then** colour says how a run ended and the face says who ran it; no agent-coloured blocks.

---

### User Story 7 - First run is animated and short (Priority: P2)

Desktop first run keeps its steps (spec 015): opening (the mark draws itself, orbits open, faces arrive), connect an
AI (Claude ready with a check, ChatGPT Entrar, Gemini installing with the working ring), your first agent (request
field, suggestion chips, "1 Você diz · 2 O Builder propõe · 3 Você revisa e cria", Montar à mão), and ready (the agent
lands on its orbit; Começar a conversar / Chamar mais alguém; three tips). Steps sit on opaque cards over the dimmed
orbit set; every step has Voltar and "Configurar depois".

**Independent Test**: A fresh profile goes from opening to a created agent in four screens, with reduced motion
showing the same screens still.

---

### User Story 8 - The phone app's screens and QR sign-in (Priority: P3)

The phone app (to be built in a later spec) follows the same tokens and components with native patterns: a tab bar
(Início, Chats, Para você with its count, Agentes, Mais), 30px large titles on top-level screens, pushed screens
(Chat, Builder) without the tab bar, approvals in a bottom sheet with full-width 50px buttons, Rotinas as an agenda
(Hoje / Amanhã / Quando algo acontecer). Sign-in is QR pairing exactly as the server does it (spec 014): welcome,
scan (Configurações › Celulares › Parear um celular, 5 minutes), "Confirme no computador" (phone name, "Servidor
conferido"), then connected (Face ID to approve, notifications for pending items only). The desktop side lists phones
with Confirmar for the waiting one.

**Independent Test**: The phone designs and the desktop Celulares screen use only shared tokens/components (the phone
variants of them); pairing copy matches the i18n strings already in the app.

### Edge Cases

- A seventh agent in a project: hues repeat by order, and the face's position in lists keeps them apart; never two
  equal hues side by side in one chat.
- A very long agent or chat name: truncates with ellipsis; the full name in the tooltip and accessible name.
- An agent working and waiting at once: waiting wins on the face (amber dot), the line says both.
- Light theme over the orbit set: rings use the line token; faces keep their hue; eyes stay white.
- Reduced motion: no orbit rotation, no eye movement, no ring dot travel, no entrance rise; states still readable.
- A custom theme with a low-contrast action colour: the app warns in Settings and falls back to the default for that
  role.
- Small windows (< 900px): the sidebar folds (as today); Início stacks its sections in one column.

## Requirements *(mandatory)*

### Functional Requirements

**Tokens and theming**

- **FR-001**: All colours, type sizes, line heights, spacing, radii, borders, shadows, durations and easings MUST come
  from tokens in three layers: base (palette), role (semantic), component. Screens MUST use role or component tokens
  only.
- **FR-002**: Default dark role values MUST be: frame #0b0c10, canvas #121419, surface #191b21, raised #202229;
  text #f3f3f6, text-2 #c4c4ce, muted #8e8f9b; action #2a6af0 (hover #2259d6, soft 16%, text #7aa9ff); waiting
  #eea95e (soft 12%); done #62cf9b; failed #f27d7d; lines at 7% and 11% of the near-white.
- **FR-003**: A theme MUST be a set of token overrides (any layer) and MUST cover light and dark. The light theme MUST
  derive from the same roles and meet the same contrast floors (US1 #1).
- **FR-004**: The action colour MUST be blue by default (user decision) and the only colour used for primary actions,
  focus and selection; links MUST use the text tone with underline or brighter text on hover.
- **FR-005**: Agent hues MUST be six values at one OKLCH lightness and chroma, clear of the action, waiting, done and
  failed hues; the prototype's coral #ef9480, aqua #57c3cf, lime #b9c86c, orchid #d48cd6 and lavender #a99cf0 are
  starting points to re-derive (their contrast spreads 7.5–10.7:1 today).
- **FR-006**: Changing a token MUST be the only change needed to retheme; check:ui MUST keep literal colours, sizes
  and radii at zero outside the token files and the component library.

**Type, size and shape**

- **FR-007**: Type MUST use six steps: display 26/32 (600, −0.03em), title 17/24 (600, −0.018em), lead 14.5/22,
  body 13.5/20 (−0.006em), small 12.5/18, label 11.5/16 (500, +0.01em); numbers that line up (times, counts, deltas)
  MUST use tabular figures, and other text MUST NOT.
- **FR-008**: Controls MUST be 32px (small 26px), radius 10 (small 8); fields 32px radius 10; tags 20px; chips 26px;
  segmented items 24px in a 3px-inset track.
- **FR-009**: Containers MUST be concentric: card radius 16 with a 6px inset, rows radius 10; a 24px face inside a
  6px-padded chip makes the chip a pill (radius 18).
- **FR-010**: Depth MUST come from tone first; borders only where they separate, at the 7% or 11% line tokens.
- **FR-011**: Icons MUST use one stroke width (1.6) with round caps and joins, at 16 or 13px (18–23px on the phone).

**Agent identity and states**

- **FR-012**: An agent MUST render as one face component: a circle (14% tint of its hue, or solid on the brand
  orbit) with two white pill eyes (12% wide, 30% tall, 14% apart, 6% above centre).
- **FR-013**: The face MUST carry the agent's state: working = a 1.5px ring in the hue at 35% with one solid dot
  travelling round it (1.6s a turn); waiting = an amber dot top-right that breathes; done = green dot; failed = red
  dot; idle = none. No gradients, glows or coloured shadows on agents.
- **FR-014**: Alive faces MUST glance and blink (7s cycle, one eye 60ms after the other); all of it MUST stop under
  reduced motion.
- **FR-015**: People MUST render as rounded squares (30% radius), never in an agent hue.
- **FR-016**: Circles MUST be reserved for what is alive (agents, the mark, send, states); everything else uses the
  concentric rounded rectangles.

**Motion and voice**

- **FR-017**: Motion MUST animate transform and opacity only (the mark's own stroke drawing excepted); entrances rise
  10px over ≤700ms in 60ms steps; continuous motion only where something is alive; all of it off under reduced
  motion.
- **FR-018**: Copy MUST speak like a teammate: the agent's name first, present tense, no exclamation marks or jargon
  (e.g. "Nova quer rodar docker push. Aprova?"), through `packages/i18n` in every language.

**Components (library)**

- **FR-019**: The library MUST provide the components in Key Entities, each with its variants, both themes, keyboard
  support, an accessible name and reduced-motion behaviour; screens MUST NOT recreate them.
- **FR-020**: Components MUST take tokens, not values, so a theme or a component-token change reaches every use.

**Screens**

- **FR-021**: Início MUST show, in order: start box, Precisa de você (≤2 + Ver todas, hidden when empty), Trabalhando
  agora, Hoje (brief since day start, quiet-run count, next run). It MUST be first in the sidebar.
- **FR-022**: The sidebar MUST have no "New chat" button: search "Buscar ou ir para… ⌘K" full width, then Início,
  Precisa de você (with count), Agentes, Conhecimento, Rotinas, then Projetos and Chats with a + on their labels
  (⌘N); live chats show the agent face and state on their second line.
- **FR-023**: The Builder MUST be a conversation with proposal cards as in US5; the plain form stays reachable from
  "Criar à mão".
- **FR-024**: Chat MUST keep approvals joined to the message box until decided, and the side panel MUST open on the
  chat's changes with its tabs.
- **FR-025**: Rotinas (desktop) MUST be one week grid as in US6, without a side rail or month picker; Rotinas
  (phone) MUST be an agenda.
- **FR-026**: Memória MUST keep its real features (Fatos/Mapa/Páginas, owner tabs, Novas, update diffs, Ensinar,
  Sempre no contexto, Ainda vale?, Esquecidas) in the new list pattern.
- **FR-027**: First run MUST keep spec 015's steps with the motion of US7; steps sit on opaque cards over the dimmed
  orbit set.
- **FR-028**: Configurações MUST have a Celulares section with "Parear um celular" (QR, countdown, one use) and the
  paired list with Confirmar/Recusar for a waiting phone (spec 014 pairing, unchanged).

### Key Entities

- **Token**: name, layer (base / role / component), value per theme.
- **Theme**: name, the overrides it sets, which mode (light / dark).
- **Component inventory** (each: variants · states):
  - Button (primary, secondary, ghost, danger, icon, round · default/sm) · Field (text, search, multi-line) · Chip ·
    Tag (waiting, done, failed, info, plain) · Segmented · Switch · Progress bar (with sheen while working) · Kbd
  - Card · RowList (card + rows + hairlines) · DefinitionList (label / value / one action) · SettingRow · Notice
  - AgentFace (sizes 12–80 · idle/working/waiting/done/failed · alive) · PersonAvatar · WorkingRing (standalone)
  - Sidebar · NavItem · SectionLabel (with +) · ChatRow (face + title + state line)
  - PageHeader (title + meta + actions) · Composer (chips, attach, model, round send) · ApprovalCard (inline and
    joined to the composer) · ProposalCard (agent / team · open/replaced/created) · BriefList (today)
  - WeekGrid (runs by outcome, planned dashed, quiet hours, day start, now line) · Agenda (phone)
  - SidePanel (tabs, diff) · Dialog · Popover/Menu · Sheet (phone bottom sheet) · TabBar (phone)
  - OrbitSet (brand decoration: rings, riding faces, dimmable) · MarkDraw (the mark drawing itself) · StepBand
    (first run: mark, progress, later)

## Success Criteria *(mandatory)*

- **SC-001**: Retheming the action colour, the neutrals or one agent hue takes one token change and zero screen
  edits.
- **SC-002**: check:ui reports zero literal colours, sizes or radii in screens, and zero hand-made controls.
- **SC-003**: Every text/background pair in both themes meets its floor (US1 #1); 100% of interactive elements have
  an accessible name and a visible keyboard focus.
- **SC-004**: In a five-person review, each person can say within 5 seconds of opening Início what needs them and
  which agent is working.
- **SC-005**: A new agent can be created from the Builder in three actions or fewer after the first request (ask,
  optionally adjust, Criar e testar).
- **SC-006**: With reduced motion on, no element moves and no state is lost (every state still has a mark and text).
- **SC-007**: The same agent looks identical (hue, eyes, state marks) in every place it appears, desktop and phone.

## Assumptions

- The prototype canvas is the visual reference; where it and this spec disagree, this spec wins.
- Light theme values are derived from the dark roles during planning; only dark was prototyped.
- Lavender (#a99cf0) and the four other prototype hues are re-derived to one OKLCH L/C before shipping; a sixth hue
  is chosen in the same pass.
- The real agent avatars' figures (open-bot-avatar shapes) are replaced by the face component; the dependency can be
  dropped when nothing else uses it.
- The phone app itself is built in a later spec; here only its design and the pairing screens it needs.
- Inter stays the only typeface; JetBrains-style monospace for code stays as the mono token.

## Decisions (2026-11-11/12, the user)

1. Own identity: harmonious, no clutter, eye-catching through one signature (the orbit with the agents).
2. Primary colour is blue; never propose another primary.
3. Agents are round, with white pill eyes that glance and blink; the working ring is flat (no glow).
4. Links are not blue; blue is only the main action.
5. Home exists and answers four questions; no "New chat" button in the sidebar.
6. The Builder is a conversation with proposal cards, not a form.
7. Routines must be simple: no month picker or side rail; colour by outcome.
8. Knowledge follows the app's real features; nothing invented.
9. No text that changes by itself (rotating words) on screens.
10. The phone signs in by QR pairing, as the server already does.
