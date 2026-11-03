---
target: sidebar
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
timestamp: 2026-11-03T19-50-11Z
slug: apps-web-src-features-sidebar-tsx
---
Method: dual-agent (A: design review · B: detector + browser)

## Design Health Score
| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | Status dots are good; bare "33%" says nothing |
| 2 | Match system / real world | 2 | "Dec 31, 1969" (epoch 0); "General · no project" redundant |
| 3 | User control and freedom | 3 | Collapse persists; "Show more" does not |
| 4 | Consistency and standards | 2 | Top rows shrink 32→22px under overflow; two buttons named "New chat" |
| 5 | Error prevention | 3 | Little to break |
| 6 | Recognition rather than recall | 3 | Identical truncated titles ("Without using any t…" x3) |
| 7 | Flexibility and efficiency | 1 | No shortcuts, no arrow-key tree, no filter |
| 8 | Aesthetic and minimalist | 3 | Quiet and dense; scrollbar track and hint add noise |
| 9 | Error recovery | 2 | Bad timestamp shown raw |
| 10 | Help and documentation | 2 | "33%" with no tooltip or label |
| **Total** | | **24/40** | Acceptable |

## Priority issues
- [P0] Whole sidebar scrolls with a 15px classic scrollbar; brand and Settings scroll away. sidebar.tsx:46 overflow on nav; styles.css:183 sets scrollbar-color on :root (inherited), which makes Chrome/WebKit ignore the ::-webkit-scrollbar rules; scrollbar-width thin does not inherit. Fix: fixed header + nav block, only the tree scrolls (min-h-0 flex-1), Settings pinned, scrollbar hidden/overlay, no global scrollbar-color.
- [P1] NavItem/Settings rows shrink 32→22px when content overflows (flex-shrink). Fix: shrink-0 in the row base (nav.tsx:8).
- [P1] Hidden hover actions (opacity-0) still take 24–48px, so names truncate ("Gene…"). Fix: actions overlay/replace trailing on hover/focus; drop the "no project" hint.
- [P1] Epoch-0 chat shows "Dec 31, 1969". Fix: guard in formatAge, fix legacy createdAt at source.
- [P2] Bare "33%" next to Usage. Fix: show only from 80% in warning tone, with tooltip and aria-label naming account and window.

## Persona red flags
- Power user: no ⌘N/⌘K, no arrow-key tree, no filter; hover-only actions.
- First-timer: "33%" unexplained; "Assistant" chip in composer means "no agent".
- Accessibility: flat buttons with no tree roles (~30 tab stops); duplicate "New chat" names; collapsed status dot unlabeled.

## Minor
- Chat age text-sm and ragged right edge; no drag region for Electrobun hidden titlebar; "Show more" state resets on remount.

## Questions
- Should Needs you / Knowledge / Usage stay as rows, or move to a footer/toolbar?
- Is a project a folder, or should recents lead?
