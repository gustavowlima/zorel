---
target: settings providers
total_score: 19
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-11-03T23-03-30Z
slug: apps-web-src-features-providers-tsx
---
# Critique: Settings > Providers (apps/web/src/features/providers.tsx)
Method: dual-agent. Score 19/40.
| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Status | 2 | no limits on the provider page; loading/error read as "Not signed in" |
| 2 | Real world | 2 | ChatGPT/Codex tautology; model named "Default" |
| 3 | Control | 2 | Delete key with no confirm |
| 4 | Consistency | 2 | surface cards vs row lists elsewhere |
| 5 | Error prevention | 2 | destructive actions ghost-styled |
| 6 | Recognition | 2 | no limits/agents per account |
| 7 | Efficiency | 1 | search over 5 items; rows not links |
| 8 | Minimalism | 3 | duplicate title |
| 9 | Error recovery | 1 | create/setKey failures silent |
| 10 | Help | 2 | no get-a-key link, no local check again |
Detector: 0 findings in providers/settings; page-level flat-type-hierarchy and Meter width transition.
## Priority issues
- [P1] secondary buttons invisible on surface cards (same #232323)
- [P1] limits/limitedUntil missing on provider page
- [P1] loading/error masquerade as not connected; silent mutation errors
- [P2] first-timer dead ends (orphan "Or paste", no key link, no check again, unknown id)
- [P2] ChatGPT/Codex identity copy, "Default" model
- [P3] layout grammar: cards vs rows, centred column, duplicate title
Applied in the same session: rows on canvas, primary Add key, LimitWindows per account, Checking…/error states, caught errors, confirm delete key, key links, Check again, unknown id redirect, back link + h1, document title, CLI default, column next to rail, search removed.
