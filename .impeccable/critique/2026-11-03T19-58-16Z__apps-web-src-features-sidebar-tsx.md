---
target: sidebar
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
timestamp: 2026-11-03T19-58-16Z
slug: apps-web-src-features-sidebar-tsx
---
Method: dual-agent (A: design review · B: detector + browser)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of status | 3 | Live status lines good; empty age span on bad timestamps |
| 2 | Match real world | 3 | General (bubble icon) under PROJECTS reads as a different kind |
| 3 | User control | 2 | "Show more" resets; fixed width; can't collapse sidebar |
| 4 | Consistency | 2 | 32px rows vs 28px in DESIGN.md; chat titles misaligned with project names |
| 5 | Error prevention | 3 | Invisible hover actions catch clicks over the name (pointer-events) |
| 6 | Recognition | 2 | Truncated titles without tooltip; parent header scrolls away |
| 7 | Efficiency | 1 | Every row a Tab stop, no arrows/type-ahead, no context menu |
| 8 | Aesthetic | 3 | Quiet, good rhythm |
| 9 | Error recovery | 2 | No retry from failed chat row |
| 10 | Help | 2 | No tooltips on hover actions; project gear vs global gear |
| Total | | 23/40 | Acceptable |

Priority issues
- [P0] Desktop title bar not integrated: hiddenInset window, no drag region, traffic lights overlap the brand row.
- [P1] Group-row keyboard focus: grey overlay block detached from row, clips focus ring; invisible actions intercept clicks.
- [P1] Rows 32px vs 28px spec (DESIGN.md Scale Rule); DESIGN.md contradicts itself on active row.
- [P2] Chevron disappears on hover (actions replace it).
- [P2] No tree keyboard model (roving focus, arrows, type-ahead, aria-level) and no sticky group headers.

Detector: static clean (0). Live: 3 page-wide findings, none in the sidebar (flat-type-hierarchy page-wide, layout-transition in ui/layout.tsx meter, nested-cards in composer).
Fixed since last run: no scrollbar, pinned brand/Settings with edge hairlines, rows never shrink, no Dec 1969, % only at 80%+.
