# Data Model: Design Refresh

## Token

| Field | Rule |
|---|---|
| name | `--z-base-*` (base), `--z-<role>` (role), `--z-<component>-<prop>` (component) |
| layer | base · role · component; screens may read role and component only |
| value | base: hex or rgba literal; role: `var(--z-base-*)` or a mix; component: length, time or role reference |
| theme | base and role differ per theme; component tokens are theme-free |

## Theme

| Field | Rule |
|---|---|
| mode | `dark` (default) · `light` |
| overrides | `{ [role]: colour }` from `preferences.theme`; role names from a fixed list; colour as `#rgb`, `#rrggbb` or `oklch(...)`; at most 40 entries |
| validation | server: unknown role or bad colour → refused; client: action colour with white under 4.5:1 → refused with reason, default kept |

## AgentFace state

`idle → working | waiting | done | failed`; `waiting` wins over `working` when both are true; `done`/`failed` shown
until the chat is opened. `alive` = working or waiting (eyes glance/blink). Reduced motion: no animation, marks stay.

## Proposal (view state, from existing proposal messages)

`open → created | dismissed`; `open → replaced` when a newer proposal exists in the same chat. Only `open` shows
actions.
