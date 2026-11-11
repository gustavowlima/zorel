---
target: New routine dialog
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-11-10T20-51-28Z
slug: src-features-new-routine-tsx
---
Method: dual-agent (A: design review · B: detector + rendered measurements). Second run after the layout pass.

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility | 3 | Footer says what happens or what's missing; tabs used to scroll away (fixed after this run) |
| 2 | Match | 3 | Plain language; "Day start" unclear |
| 3 | Control | 2 | ToolPicker "Fix" navigates away and drops the draft; Cancel discards a written prompt silently |
| 4 | Consistency | 2 | Watch tool picker still a dialog over the dialog; destination picker inline |
| 5 | Error prevention | 3 | Half-added destination lets Create drop it |
| 6 | Recognition | 3 | Raw snake_case tool names |
| 7 | Efficiency | 2 | ⌘Enter hidden; no hourly/cron |
| 8 | Minimal | 3 | Watch fields before a tool is picked; destination list noisy |
| 9 | Recovery | 3 | Errors not tied to their part |
| 10 | Help | 3 | Hints well placed |
| **Total** | | **27/40** | Acceptable (was 23) |

Detector: 0 static findings; in-page: 1 nested-cards in the Result card. Rendered: 24px sheet padding, label→control 9, gaps 16/24, footer always visible, sheet height swings 371–697px between tabs; at 390px the tab list collapsed to 0px (fixed after this run: tabs outside the scroll area).

Priority: [P1] Fix buttons leave the dialog and lose the draft · [P1] half-added destination / Create · [P2] watch picker inline like destinations · [P2] watch fields only after a tool is picked · [P2] destination picker: only tools whose text field is found · [P2] ChoiceCards hover vs selected too close · [P2] summary mentions destinations · [P3] to-do in muted until touched · [P3] show ⌘↵ · Sam: aria-live on the footer, labels for Repeats/On.
