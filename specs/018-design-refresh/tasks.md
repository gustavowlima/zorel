# Tasks: Design Refresh

**Input**: specs/018-design-refresh/ (spec.md, plan.md, research.md, data-model.md, contracts/components.md)
**Tests**: the spec asks for measurable contrast floors and zero hand-made controls, so the contrast test and the
check:ui rules are included; screen behaviour is checked by screenshots (quickstart.md).

## Phase 1: Setup

- [x] T001 Read apps/web/DESIGN.md, apps/web/src/styles.css, scripts/check-ui.ts and apps/web/src/ui/index.tsx to map current tokens and primitives to spec 018 roles (no file change)

## Phase 2: Foundational (blocks every story)

- [x] T002 Split tokens into base (`--z-base-*`, the only literals) → roles (`--z-*`, existing names) → component tokens (`--z-control-h`, `--z-radius-card`, …) for dark and light in apps/web/src/styles.css
- [x] T003 Set the spec's dark role values (FR-002) and derive light roles meeting the same floors in apps/web/src/styles.css
- [x] T004 Re-derive the six agent hues at one OKLCH L/C (research R2) as base tokens in apps/web/src/styles.css
- [x] T005 Contrast + hue test for both themes in apps/web/src/tokens.test.ts
- [x] T006 Type scale 11.5/12.5/13.5/14.5/17/26 with line heights and tracking, `num` utility, optical sizing in apps/web/src/styles.css
- [x] T007 Size/shape tokens: control 32 / sm 26 / xs 24 / lg 36, radius control 10 / sm 8, card 16, row 10, inset 6 in apps/web/src/styles.css
- [x] T008 Links use the text tone (`--z-link`), hover brighter; replace link uses of accent-text in apps/web/src (screens)
- [x] T009 Retune primitives to the new tokens: apps/web/src/ui/button.tsx, input.tsx, select.tsx, segmented.tsx, switch.tsx, tabs.tsx, pill.tsx, layout.tsx, nav.tsx
- [x] T010 One icon stroke (1.6, round) default in apps/web/src/ui/icons.tsx

## Phase 3: User Story 1 — themeable tokens (P1)

- [ ] T011 [US1] `preferences.theme` overrides (role → colour) with server-side validation in packages/contracts and apps/server (preferences boundary)
- [x] T012 [US1] Apply overrides as CSS variables on :root, refuse an action colour under 4.5:1 with white, in apps/web/src/theme.ts (+ main.tsx hook-up)
- [x] T013 [US1] Settings › Aparência "Cor de ação" picker with reset and refusal reason in apps/web/src/features/settings.tsx (+ i18n)

## Phase 4: User Story 3 — agent identity (P1)

- [x] T014 [US3] AgentFace, WorkingRing, PersonAvatar in apps/web/src/ui/face.tsx (states, alive glance/blink, reduced motion)
- [x] T015 [US3] AgentAvatar renders AgentFace (API unchanged + `state`), drop open-bot-avatar in apps/web/src/ui/avatar.tsx, apps/web/package.json, NOTICE
- [ ] T016 [US3] Pass `state` where status is known (sidebar chat rows, chat header, agents list) in apps/web/src/features/*.tsx
- [x] T017 [US3] check:ui rules hand-face / hand-ring / blue-link in scripts/check-ui.ts

## Phase 5: User Story 2 — one component per pattern (P1)

- [ ] T018 [US2] Library additions per contracts/components.md (DefinitionList, BriefList, ProgressBar sheen, ApprovalCard shell) in apps/web/src/ui/*.tsx and exports in apps/web/src/ui/index.tsx

## Phase 6: User Story 4 — Início (P1)

- [x] T019 [US4] Sidebar: no New chat, search "Buscar ou ir para… ⌘K", Início first, + on Projetos/Chats in apps/web/src/features/sidebar.tsx
- [x] T020 [US4] Início sections (start, needs you ≤2, working now, today brief) in apps/web/src/features/home.tsx (+ i18n)

## Phase 7: User Story 5 — Builder conversation (P1)

- [x] T021 [US5] ProposalCard (open/replaced/created) in apps/web/src/ui/proposal.tsx
- [x] T022 [US5] Builder pane = conversation with proposal cards; side review removed; "Criar à mão" in apps/web/src/features/builder.tsx

## Phase 8: User Story 6 — screens restyled (P2)

- [x] T023 [P] [US6] Rotinas week: outcome fills, faces, legend + counts, no side panel in apps/web/src/features/routine-week.tsx, routines.tsx
- [ ] T024 [P] [US6] Precisa de você, Projeto, Agentes, Memória, Configurações restyle with library components in apps/web/src/features/{inbox,project,agents,memory,knowledge,settings,team}.tsx
- [x] T025 [P] [US6] Chat: status line with WorkingRing, approval tray look in apps/web/src/features/chat.tsx

## Phase 9: User Story 7 — first run (P2)

- [x] T026 [US7] MarkDraw, OrbitSet faces, StepBand progress in apps/web/src/ui/onboarding.tsx; ready step in apps/web/src/features/first-run.tsx

## Phase 10: User Story 8 — phone design (P3)

- [x] T027 [US8] DESIGN.md "Phone" section (tab bar, large titles, pushed screens, sheets, agenda, QR pairing) in apps/web/DESIGN.md

## Phase 11: Polish

- [ ] T028 DESIGN.md + .impeccable/design.json updated to the new tokens and rules in apps/web/
- [x] T029 bun run test, typecheck, check:ui (baseline never loosened); memory + changelog in .agent/memory/

## Dependencies

Phase 2 blocks all. US1 and US3 next (tokens, faces), then US2, US4, US5 (use faces), US6/US7 (use everything), US8
docs anytime after Phase 2. Within US6, T023–T025 are parallel (different files).

## Implementation strategy

MVP = Phase 2 + US1 + US3: the whole app takes the new look and agent identity through tokens and components; later
phases reshape screens one by one, each shippable.

## Status (2026-11-12)

- Done: tokens in three layers with the new dark/light values and re-derived agent hues (tokens.test.ts holds the
  floors), type/size/shape tokens, one icon stroke, quiet links, the personal action colour, the agent face/ring/person
  components (open-bot-avatar removed), the sidebar and Home, the Builder proposal card, the week without a side panel,
  waiting in amber, the first-run "how" line and ready step, DESIGN.md's spec 018 section and phone patterns.
- T011 changed: the action colour is stored per browser (like the theme), validated in theme.ts — no server field.
- T016 partial: state on faces in the sidebar chat rows and the Agents list; the chat header still shows the plain face.
- T018 partial: ColorField added; ApprovalCard/ProposalCard live in their features (inbox.tsx, builder.tsx) and are
  reused from there (Home reuses ApprovalItem) rather than moved to src/ui.
- T024 inherited: Needs you, Project, Memory and Settings take the new tokens, faces and amber waiting without layout
  changes; their layouts stay as they were.
- T028 partial: DESIGN.md updated; `.impeccable/design.json` not regenerated (run /impeccable document).
