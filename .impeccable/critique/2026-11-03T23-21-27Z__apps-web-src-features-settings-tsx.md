---
target: settings tabs
total_score: 115
max_score: 180
na_heuristics: 
p0_count: 1
p1_count: 7
timestamp: 2026-11-03T23-21-27Z
slug: apps-web-src-features-settings-tsx
---
# Critique: Settings tabs (MCP 25/40, Skills 24/40, Storage 24/40, Audit 22/36, Appearance 20/32)
Method: dual-agent. Shared root cause: useList hid AsyncResult (false empty states, no error rows); Storage/Audit used surface cards; three ways of writing section headers; silenced mutation errors.
Applied: useReading + ReadingState (Checking…/error+retry), Rows instead of cards, Section titles with hints, caught mutation errors, Storage meter = share of total and blank page fixed, Audit by day with server-side filters (kind, words, date range) and pagination, Appearance moved into a General tab with a segmented theme control, MCP quoted arguments.
