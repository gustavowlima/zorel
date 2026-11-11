---
target: builder side panel agent profile
total_score: 24
max_score: 36
na_heuristics: 9
p0_count: 0
p1_count: 2
timestamp: 2026-11-11T15-09-59Z
slug: apps-web-src-features-builder-tsx
---
Method: dual-agent. Browser overlay skipped (browser MCP unavailable).

Heuristics: 1 Status 2 (no step cue) | 2 Real world 3 (untranslated "Workspace") | 3 Control 3 | 4 Consistency 2 (bordered ModelPicker field; chevron on CTA) | 5 Error prevention 3 | 6 Recognition 3 (reachesNothing repeats label) | 7 Flexibility 2 (access/reach read-only here) | 8 Minimalist 3 (dead bottom third) | 9 n/a | 10 Help 3. Total 24/36.

Detector: clean (0 findings).

Priority issues:
- P1 Scope/approval line stranded mid-panel; dead space above lone CTA. Move into footer left of CTA.
- P1 Bordered ModelPicker field = only frame in a frameless view. Show value as text + soft "Trocar" pill or borderless picker.
- P2 No destination cue: "Continuar" + chevron. Rename "Revisar permissões", drop chevron, optional "1 de 2".
- P2 Copy: "Workspace" untranslated; "Alcança / Alcança só a própria pasta"; "Web" vs "pergunta antes de… online" reads contradictory.
- P3 Empty h2 in profile view (a11y).

Questions: profile = identity only and facts on the permissions step? CTA "Criar" with permissions as optional detour? Risky agents look as calm as safe ones.
