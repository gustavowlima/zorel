---
target: New routine dialog
total_score: 28
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-11-10T21-05-59Z
slug: src-features-new-routine-tsx
---
Method: dual-agent (A: design review · B: detector + rendered measurements). Third run.

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility | 3 | Footer names another tab's gap first |
| 2 | Match | 3 | "Day start", "webhook" unexplained |
| 3 | Control | 3 | Start over resets only part of the form |
| 4 | Consistency | 2 | Two blue primaries on When (Pick a tool + Create); three selected looks; 9:00 AM vs 09:00 |
| 5 | Error prevention | 3 | Guards hold |
| 6 | Recognition | 3 | Footer todo has no way to its tab |
| 7 | Efficiency | 3 | ⌘↵ tooltip hidden on a disabled Create |
| 8 | Minimal | 3 | Sheet height jumps per tab (371–928px at 1440) |
| 9 | Recovery | 2 | Warnings not actionable; bare error line |
| 10 | Help | 3 | Nothing for "Day start" |
| **Total** | | **28/40** | Good (70%) |

Detector: 0 static; in-page (dialog): cramped-padding on the Repeat rail, nested-cards on the choice list and the Result card. Rendered: tabs 28px and clickable everywhere, footer always visible, 32px buttons, pt-BR fits every 22px segmented item.

Priority: [P1] sheet height jumps per tab: anchor the dialog top or a min height · [P1] footer todo: current tab first, a link to the part · [P1] Pick a tool blue next to blue Create · [P2] weekday toggles barely show selection · [P2] Start over partial · [P2] "Tell me here" looks like a missing control · [P3] ⌘↵ visible when ready · [P3] phone footer actions right-aligned · minor: Intl.ListFormat for days, one time format.
