# UI Contract: Component Library (spec 018)

Screens import these from `@/ui` and never restyle them. Every component: both themes, keyboard focus (visible only
after keyboard use), an accessible name, reduced-motion behaviour, tokens only.

| Component | Props (public) | Variants / states | Tokens it reads |
|---|---|---|---|
| Button | `variant`, `size`, `shape`, `onPress`, `isDisabled` | primary · secondary · ghost · danger · icon · round; default 32 / sm 26 | control-h(-sm), radius-control(-sm), action |
| Field / SearchInput / Textarea | `label`, `value`, `onChange`, `size` | default · focus · invalid | control-h, radius-control, field, line-2 |
| Chip | `icon?`, `tint?` | plain · agent-tinted | chip-h 26, radius pill |
| Tag | `tone` | waiting · done · failed · info · plain | tag-h 20 |
| Segmented / Tabs | `items`, `selected` | track 3px inset, item 24 | wash, wash-3 |
| Switch | `isSelected` | on · off | action |
| ProgressBar | `value`, `tone`, `working?` | sheen while working | bar-h 4 |
| Card / Rows / DefinitionList / SettingRow | `children`, `action?` | — | radius-card 16, inset-card 6, radius-row 10, line |
| AgentFace | `tone`, `size` (12–80), `state`, `alive`, `solid` | idle · working · waiting · done · failed | agent-1…6, eye-*, ring-w, ring-turn |
| AgentAvatar | `id`, `name`, `tone`, `size`, `live`, `state?` | wraps AgentFace (API unchanged) | — |
| PersonAvatar | `name`, `size` | — | radius 30% |
| WorkingRing | `tone`, `size` | — | ring-w, ring-turn |
| PageHeader | `title`, `meta?`, `actions?` | — | text-title/display |
| Composer | `sources`, `tools`, `onSubmit`, `pending?` | plain · with approval joined | radius-card, raised |
| ApprovalCard | `who`, `command`, `why?`, `onAllow`, `onDeny`, `always?` | inline · joined · sheet (phone) | wait-soft |
| ProposalCard | `draft` / `team`, `state`, actions | open · replaced · created | surface, line-2 |
| BriefList | `items`, `quietCount`, `next?` | — | — |
| WeekGrid | `runs`, `week`, `dayStart`, `quiet` | runs: needs · something · nothing · planned | wait-soft, wash-3, wash |
| SidePanel | `tabs`, `onClose` | — | — |
| Dialog / Popover / Menu | existing | — | float, shadow-float |
| OrbitSet | `faces`, `dim?` | — | line, line-2 |
| MarkDraw | `size` | — | text |
| StepBand | `step`, `of`, `onLater` | — | — |

Phone-only (design reference for the app spec): TabBar, LargeTitle, Sheet, Agenda.
