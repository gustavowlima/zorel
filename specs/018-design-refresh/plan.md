# Implementation Plan: Design Refresh

**Branch**: `feat/agents-only-tools` (spec folder `018-design-refresh`) | **Date**: 2026-11-12 | **Spec**: [spec.md](spec.md)

## Summary

Seven phases, each testable and committed on its own, foundation first so every later screen only composes. No new
dependency; one is removed (the avatar figures). The phone app's screens are design only here (spec US8); its build is
a later spec.

1. **Tokens in three layers + themes** (US1): `styles.css` split into base palette → roles → component tokens; the new
   dark values; light derived; user overrides from preferences; a contrast test over every role pair.
2. **Type, size, shape** (FR-007…FR-011): the six-step type scale, 32/26 controls, concentric radii, one icon stroke;
   primitives retuned through tokens only.
3. **Agent identity** (US3): `AgentFace` (circle, white pill eyes, alive glance/blink) and `WorkingRing` replace the
   avatar internals behind the same `AgentAvatar` API; state marks; `PersonAvatar`.
4. **Shell and Início** (US4, FR-021, FR-022): sidebar without New chat, search on top, Início first; Início's four
   sections.
5. **Builder as a conversation** (US5): proposals render as `ProposalCard`s in the Builder chat; the side review goes.
6. **Screens restyled** (US6, FR-024…FR-026, FR-028): Chat, Precisa de você, Projeto, Agentes, Rotinas week,
   Memória, Configurações (Provedores, Celulares).
7. **First run motion** (US7): `MarkDraw`, `OrbitSet`, `StepBand` on spec 015's steps.

Docs travel with each phase: `apps/web/DESIGN.md` and `.impeccable/design.json` change together with the tokens
(memory rule), phone patterns get a DESIGN.md section in phase 7.

## Technical Context

- **Language/Version**: TypeScript, Bun 1.4.4; React 19, Tailwind v4 (`@theme inline`), React Aria primitives in
  `apps/web/src/ui`.
- **Dependencies**: none new. `open-bot-avatar` is removed in phase 3 (only `ui/avatar.tsx` uses it); NOTICE entry
  removed with it. Motion keeps the existing `motion` package only where CSS can't (width/height auto, layout).
- **Storage**: the action-colour override is stored per browser (`zorel.accent`), like the theme preference, and
  validated in `theme.ts` before it is applied (changed during implementation: no server field was needed).
- **Testing**: `bun test` for the contrast test (parses role values from `styles.css` for both themes and checks the
  floors of spec US1 #1), the override validator, the face's state reducer; `bun run check:ui` with new rules;
  screenshots of each screen in both themes and with reduced motion via the isolated-server method recorded in
  memory (`PORT=4318 ZOREL_HOME=<copy> …`).
- **Constraints**: transform/opacity motion only; no literal colours/sizes in screens; every string through
  `packages/i18n` (pt-BR and en); `check:ui` ratchet never loosens.
- **Scale**: ~40 primitives, ~60 feature files; each phase touches the primitives first, then only the screens of its
  stories.

## Constitution Check

| Principle | Status |
|---|---|
| I. Scope and simplicity | Pass: no new dependency, one removed; existing files edited (`styles.css`, `src/ui/*`, the named features); new files only for new components (`ui/face.tsx`, `ui/proposal.tsx`, `ui/week.tsx` if the current week can't be reshaped, `features/home.tsx` reused for Início). Each phase delivers whole. |
| II. Security | Pass: theme overrides are validated on the server (known role names, colour syntax, length caps); no secrets; pairing (spec 014) unchanged. |
| III. Explicit errors | Pass: an invalid or low-contrast override is refused with a reason and falls back to the default role (spec edge case). |
| IV. Cross-platform | Pass: UI only; fonts bundled (`@fontsource-variable/inter`); no OS calls. Reduced motion read from the OS on all three. Visual checks run on macOS; Windows/Linux rendering not exercised live (stated in the final report). |
| V. Language | Pass: copy through i18n in both catalogs; voice rules (FR-018) applied to new strings only, existing strings reworded only where a screen in this spec shows them. |

No violation; Complexity Tracking empty.

## Phase 1: tokens in three layers + themes

- `styles.css`:
  - **base**: `--z-base-*` (neutral steps n0…n9 at hue ~260, the blue, the state hues, the six agent hues), the only
    place hex values live;
  - **role**: the existing `--z-*` names kept (frame, canvas, surface, raised, text, text-secondary, muted, accent,
    warning, success, danger, agent-1…6, line/line-strong…) now pointing at base tokens; renames only where the spec's
    role has no current name (`--z-wait-soft`, `--z-done-soft`, `--z-failed-soft`, `--z-link`);
  - **component**: `--z-control-h` 32, `--z-control-h-sm` 26, `--z-radius-control` 10, `--z-radius-control-sm` 8,
    `--z-radius-card` 16, `--z-inset-card` 6, `--z-radius-row` 10, `--z-ring-w` 1.5, `--z-ring-turn` 1.6s,
    `--z-eye-*`, `--z-icon-stroke` 1.6…
  - `[data-theme="light"]` overrides base/role only; component tokens are theme-free.
- Links: `--z-link` = text-secondary, hover text; every `text-accent-text` used on a link moves to the link token
  (check:ui rule `blue-link`).
- Overrides: `preferences.theme` (`{ [role]: colour }`), applied as CSS variables on `:root` at start and on change;
  server validates names and colours; the client refuses an action colour under 4.5:1 with white and says why.
- Settings › Aparência: "Cor de ação" (blue default, reset) — the only override with UI in this spec; others via the
  same object (documented in DESIGN.md).
- Test `apps/web/src/tokens.test.ts`: parse both themes' role values; assert the floors (text 16, secondary 10, muted
  5.5, link 7, white on action 4.5) on canvas, surface and raised; assert the six agent hues share OKLCH L and C within
  0.01.
- Agent hues re-derived here (research R2) and written as base tokens.

## Phase 2: type, size, shape

- `@theme`: `--text-*` steps to 11.5/12.5/13.5/14.5/17/26 with line heights 16/18/20/22/24/32 and tracking tokens;
  `font-variant-numeric` default normal; a `num` utility for tabular figures; `font-optical-sizing: auto`.
- Spacing: `control-sm` 28 → 26, `control` stays 32, `control-lg` 36 (phone/first-run CTAs use 40–52 via component
  tokens); `control-xs` 24 stays for in-row icon buttons only.
- Radii: control 8 → 10, card 12 → 16, `row` 10 new; shadcn scale re-pinned.
- Primitives retuned (Button, IconButton, Input/Field, Select, Segmented, Switch, Tabs, Tag/Badge, Chip, Rows,
  SettingRow): heights/radii/inset from the new tokens; no screen edits expected beyond fixing overrides check:ui
  reports.
- Icons: lucide stroke 1.6 via one wrapper prop default in `ui/icons.tsx`.

## Phase 3: agent identity

- `ui/face.tsx`: `AgentFace({ tone, size, state?: "idle"|"working"|"waiting"|"done"|"failed", alive?, solid? })`;
  eyes are two spans; glance/blink and ring are CSS keyframes on transform/opacity, off under reduced motion.
- `AgentAvatar` keeps its props (id, name, tone, size, live) and renders `AgentFace`; `live` maps to `alive`; callers
  that know a status pass `state` (sidebar chat rows, chat header, agents list, home, inbox).
- `WorkingRing` standalone (for steps and status lines) replaces `Spinner` where it means "an agent is working";
  `Spinner` stays for plain loading.
- `PersonAvatar` (rounded square, initial) for people (team, comments, sessions).
- Remove `open-bot-avatar` and its NOTICE entry; ModelAvatar unchanged (provider logo).

## Phase 4: shell and Início

- Sidebar (`features/sidebar.tsx`): drop New chat; search field "Buscar ou ir para… ⌘K" (opens the command palette);
  nav: Início, Precisa de você (count), Agentes, Conhecimento, Rotinas; `+` on Projetos/Chats labels (⌘N keeps the
  new-chat route); chat rows show `AgentFace` with state on the second line.
- Início (`features/home.tsx`): greeting line, title, project/answers chips, Composer; then `NeedsYou` (first two,
  inline actions, hidden when empty), `WorkingNow`, `TodayBrief` (reuses `todayAtom`). Existing new-chat logic kept.

## Phase 5: Builder as a conversation

- `features/builder.tsx`: the conversation takes the whole pane; the side review and "How it works" go.
- `ui/proposal.tsx` `ProposalCard` (agent and team variants; open / replaced / created states) rendered for each
  proposal message; actions call the existing create/apply mutations; "Editar antes" opens the agent form prefilled;
  "Criar à mão" in the header.
- Replaced proposals collapse (computed: a newer proposal in the same chat).

## Phase 6: screens restyled

- Chat: approval tray joined to the composer (exists; restyle), status line with `WorkingRing`, side panel tabs
  restyled.
- Precisa de você (`inbox.tsx`): `ApprovalCard`, question quick replies, memory proposals; friendly end of list.
- Projeto, Agentes: cards/rows from the library; state on faces; Builder invitation.
- Rotinas (`routine-week.tsx`, `routines.tsx`): remove the side panel and anything month-like; runs coloured by
  outcome with the face; legend and counts line; list view unchanged.
- Memória (`memory.tsx`, `knowledge.tsx`): list pattern, owner tabs, Novas, update diff, Ensinar, pin.
- Configurações: Provedores rows with usage rings; Celulares section (QR, countdown, waiting device with
  Confirmar/Recusar) restyled from `team.tsx`'s pairing UI.

## Phase 7: first run motion and phone patterns

- `ui/onboarding.tsx`: `MarkDraw` (stroke draw + pops), `OrbitSet` (rings, riding faces, dimmable), `StepBand`
  (mark, progress bars, Configurar depois); first-run steps keep spec 015 logic; the "ready" step added after
  creation (Começar a conversar / Chamar mais alguém).
- DESIGN.md "Phone" section: tab bar, large titles, pushed screens, bottom sheet approvals, agenda, QR pairing screens
  — the reference for the app's spec.

## Project Structure

```text
apps/web/src/styles.css            base / role / component tokens, themes
apps/web/src/tokens.test.ts        contrast + hue checks (new)
apps/web/src/ui/face.tsx           AgentFace, WorkingRing, PersonAvatar (new)
apps/web/src/ui/proposal.tsx       ProposalCard (new)
apps/web/src/ui/avatar.tsx         AgentAvatar → AgentFace; open-bot-avatar removed
apps/web/src/ui/onboarding.tsx     MarkDraw, OrbitSet, StepBand
apps/web/src/features/{sidebar,home,builder,chat,inbox,project,agents,routines,routine-week,memory,knowledge,settings,team,first-run}.tsx
scripts/check-ui.ts                new rules: blue-link, hand-face, hand-ring
apps/web/DESIGN.md, apps/web/.impeccable/design.json
packages/i18n/src/{en.ts,pt-BR/*}  new strings
```

## Complexity Tracking

None.
