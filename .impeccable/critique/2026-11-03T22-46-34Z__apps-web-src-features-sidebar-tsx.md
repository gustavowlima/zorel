---
target: sidebar
total_score: 21
max_score: 36
na_heuristics: 5
p0_count: 0
p1_count: 3
timestamp: 2026-11-03T22-46-34Z
slug: apps-web-src-features-sidebar-tsx
---
# Critique: Zorel sidebar (apps/web/src/features/sidebar.tsx)
Method: dual-agent. Score 21/36 (H5 n/a).

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of status | 3 | cut-off last row hides waiting chats below |
| 2 | Real world | 3 | "7d" row has no account |
| 3 | Control | 3 | list tab from Settings jumps home |
| 4 | Consistency | 1 | tab row mixes list-switch and page-nav; + changes meaning; 5 icon centres |
| 5 | Error prevention | n/a | |
| 6 | Recognition | 2 | 3 icon-only tabs; folder vs book |
| 7 | Efficiency | 2 | no search/filter, no shortcuts |
| 8 | Minimalism | 2 | one-word previews, repeated 32px avatars |
| 9 | Error recovery | 3 | failed chats red |
| 10 | Help | 2 | foot meaning only on hover |

Specificity: content authored (whose-turn, live status, pace); chrome generic (18/18/6 gaps).
Detector: 0 in sidebar files; browser: layout-transition true positive at sidebar.tsx:310 (width transition); flat-type-hierarchy and nested-cards are page-level/composer.

## Priority issues
- [P1] List collides with foot: last row always sliced (58.6px rows over 459px), permanent border-t, no hidden-content cue. Fix: bottom fade or conditional hairline, 56px rows, scroll-snap proximity. /impeccable layout
- [P1] Columns misaligned: icon centres 26/28/30/31/37, text starts 43/48/65 (NavTab px-2, brand logo no glyphBox, foot 14px icon, 32px avatar). Fix: one 20px icon column centred x30, text x50; avatar as deliberate 2nd column. /impeccable layout
- [P1] Tab row carries two behaviours (Chats/Projects switch list; Knowledge/Settings navigate). Fix: labelled 2-segment Chats|Projects; Knowledge/Settings as NavItems next to Needs you. /impeccable layout
- [P2] Low-information chat rows (one-word previews, repeated provider avatars, identical titles). Fix: single line when preview adds nothing; Your turn/Running/Earlier groups. /impeccable distill
- [P2] Usage foot attribution and weight (7d under a once-shown logo; 87px always). Fix: dim logo per row or worst window only; weight only on warning; scaleX instead of width transition. /impeccable layout

## Personas
- Power user: no search, no new-chat shortcut, tabs not a tablist, Show N more not persisted, identical titles.
- First-timer: unlabeled icons, empty Needs you looks inert, foot bars without legend.

## Minor
- gaps 18/18/6 off scale (16/16/8); foot hover washes whole box; waiting relies on colour; DESIGN.md stale (248 vs 264px, "no shadows" vs shadow-chip, old sections).
