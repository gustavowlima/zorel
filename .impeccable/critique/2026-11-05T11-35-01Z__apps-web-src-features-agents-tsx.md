---
target: agent pages
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-11-05T11-35-01Z
slug: apps-web-src-features-agents-tsx
---
Method: dual-agent (A: design review · B: detector + browser)
Target: agent-related pages (Agents, agent page tabs, Builder, Knowledge, Needs you, Routines, project Agents tab)

Score 23/40 — H1 3, H2 3, H3 2, H4 2, H5 3, H6 2, H7 2, H8 2, H9 1, H10 3.

Detector: CLI clean on 9 files. Browser: nested-cards x106 on #/agents, cramped-padding, clipped-overflow, flat-type-hierarchy = false positives (the shell sheet; the four-sizes rule). Real: line-length ~101ch on the failover intro (agent.tsx:150). Greps: agents.tsx:25 AgentRow rounded-none ghost row (unused); builder.tsx:450 native title on an interactive wrapper; [&_svg] variants agent.tsx:302/317, project.tsx:353.

P1 Agents screen is a card gallery that doesn't scale (agents.tsx:189-231): rows in Rows, search past 8, count in section title, tags only for deviations.
P1 Builder failure is a dead end and the model is hardcoded (builder.tsx:33,39): EmptyState with Open Providers / Try again; start on the first available model.
P1 Agent Profile is the old flat form (agent.tsx:131-156): groups (identity, model + fallbacks, instructions), Role→Instructions, one fallbacks sentence, unsaved marker + leave guard.
P2 Knowledge & activity tab hand rows (agent.tsx:300-334; routines.tsx): ListRow, Routines as Section+Rows, row actions into a menu.
P2 Knowledge rail: six tabs clip in 384px, double empty state (knowledge.tsx:65-76,141).
P2 DESIGN.md contradicts itself on these surfaces (rows vs cards, Builder steps, agent page tabs).

Minor: tablist labelled "New agent" on an existing agent (agent.tsx:125); agentTone by position recolors on delete; Builder draft avatars use name as id; Needs you hand border-b rows (inbox.tsx:55), header tabs with 0 counts; Routines empty-state button "Agents"; dashed empty card on project Agents tab; Builder intro tile on accent-soft; CreatedRow hand row; Knowledge scope Select without faces; "Primary" vs "Default model".

Questions: at 100+ agents is Global a flat pool or should agents live under projects? Should the profile autosave per row with History as undo, instead of Save?
