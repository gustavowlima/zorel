---
target: memory page
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-11-09T03-47-52Z
slug: apps-web-src-features-memory-tsx
---
# Critique: Memory page (apps/web/src/features/memory.tsx)
Method: dual-agent (LLM design review + detector/browser). Date: 2026-11-09.

| # | Heuristic | Score |
|---|---|---|
| 1 | Visibility of system status | 3 |
| 2 | Match with the real world | 3 |
| 3 | User control and freedom | 1 |
| 4 | Consistency and standards | 2 |
| 5 | Error prevention | 2 |
| 6 | Recognition over recall | 3 |
| 7 | Flexibility and efficiency | 1 |
| 8 | Aesthetic and minimalist design | 2 |
| 9 | Error recovery | 2 |
| 10 | Help and documentation | 3 |
| | Total (before the layout pass) | 22/40 |

P1: frame changed between Facts/Map/Pages; rows did not scale (4 permanent actions, Move without search); Forget silent with no undo.
P2: setting (approval) in the header, accent misused; hand-made Group/Teach/waiting strip; h1→h3 skip.
Fixed by the layout pass: one header across views, approval as a SettingRow in Review, Section/Notice/Input primitives, h2 groups, accent only for action, pin + ⋯ menu per row, map tabs and filters on one row.
Open: undo receipt for Forget/Move (harden); per-group sort/limit and bulk (distill); Move search past 8 owners; narrow header subtitle truncates; DESIGN.md accent #007cf7 vs live #0071e3 (doc drift).
