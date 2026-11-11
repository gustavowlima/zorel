---
target: New routine dialog
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-11-10T20-32-35Z
slug: src-features-new-routine-tsx
---
Method: dual-agent (A: design review · B: detector + rendered measurements)

## Design Health Score
| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of status | 3 | Live summary good; disabled Create gives no reason; missing dot hidden on current tab |
| 2 | Match real world | 2 | "A script", "Look first: a small model…", "marked as from outside" are internal words |
| 3 | User control | 2 | Tool picker = dialog over dialog, no back |
| 4 | Consistency | 2 | Two selected styles (grey Segmented vs blue MultiSegmented); 28px buttons vs 32px elsewhere |
| 5 | Error prevention | 3 | Past dates blocked, no-day weekly handled |
| 6 | Recognition | 3 | Repeat rail has no visible label |
| 7 | Flexibility | 2 | No ⌘Enter, no cron, long unfiltered picker |
| 8 | Aesthetic/minimal | 1 | Result = 3 paragraphs around 1 button; 4 hints for 3 controls on New item |
| 9 | Error recovery | 2 | One red line, silent rollback |
| 10 | Help | 3 | Hints everywhere, always on |
| **Total** | | **23/40** | Acceptable |

## Verdict
Built from the system's parts but no layout of its own: label 12 / control / hint 12, repeated, then a fixed void (min-h-80: 88–146px empty), footer. Cramped is misallocation, not lack of space: label→control 6px, control→hint 6px (hint same 12px as label), groups 12px, panels 20px (off-scale), sheet padding 20px (off-scale). Detector: 0 static findings; runtime: 2× cramped-padding on the segmented rails. Mobile: every "What starts it" label wraps to 2 lines inside a 22px pill (scrollHeight 27).

## Priority issues
- [P1] Space misallocated (void below, 6/12px above): Field gap 8, hint 11px dim, groups 24 / inside 12, sheet p-6, drop min-h-80, prompt 5 rows. /impeccable layout
- [P1] Two stacked segmented rails (5 + 4 options), three selection styles, mobile wrap: "What starts it" as a vertical option list with one-line explanations; Repeat labelled; one selected style. /impeccable layout
- [P1] Footer: summary reads as a hint; disabled Create silent: one bordered footer row, summary 13px secondary left, first missing item in warning; buttons 32px. /impeccable clarify
- [P2] Result tab is prose: one Rows card (Tell me · destinations · Add), one dim line. /impeccable distill
- [P2] Destination picker lists every write tool with a Writes badge on each row, nested dialog: only tools with a text field, no badge when filtered, step inside the same dialog with back. /impeccable distill

## Personas
Alex: no ⌘Enter, long picker. Jordan: jargon, silent disabled Create. Sam: hint inside the label's accessible name; missing dot aria-hidden.

## Questions
Tabs or one scrolling sheet? Trigger first? Full watch config in the dialog or only the tool?
