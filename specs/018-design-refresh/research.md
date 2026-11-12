# Research: Design Refresh

## R1 — Token layers in the current stack

- **Decision**: three layers in `styles.css`: `--z-base-*` (hex, the only literals) → existing `--z-*` role names →
  component tokens (`--z-control-h`, `--z-radius-card`…); Tailwind `@theme inline` keeps exposing roles and component
  tokens as utilities.
- **Rationale**: the app already has one role layer (`--z-*`) aliased by `@theme`; adding base below and component
  above changes no screen class names, so the migration is token-only for most screens.
- **Alternatives**: tokens in a TS module generating CSS (adds a build step, two sources of truth); a design-token
  JSON + Style Dictionary (new dependency for one consumer). Both rejected (Constitution I).

## R2 — Agent hues at one lightness and chroma

- **Decision**: six hues at OKLCH L 0.76, C 0.11, hues spread to avoid the action blue (~262°), waiting amber
  (~70°), done green (~155°) and failed red (~25°): starting points coral (~40°), lime (~115°), aqua (~200°),
  lavender (~290°), orchid (~330°) and a sixth around ~0°/rose or ~95°/sand chosen in phase 1 by contrast and
  separation; exact hex values computed and checked in `tokens.test.ts` (same L/C within 0.01; ≥7:1 for text in the
  hue on canvas).
- **Rationale**: the prototype hues were picked by eye (contrast 7.5–10.7:1); equal L/C makes no agent louder than
  another and keeps them apart from state colours.
- **Alternatives**: keep today's six (68% 0.12) — they sit too close to the new action/state hues in places; free
  per-agent colours — breaks harmony and contrast guarantees.

## R3 — Personalisation scope

- **Decision**: overrides are a preferences object of role → colour, validated server-side; UI exposes only the action
  colour now; light/dark stays the mode switch.
- **Rationale**: the spec asks for themeability (one change retunes everything) without growing Settings; the object
  allows more later without migration.
- **Alternatives**: full theme editor (scope creep); CSS file import (unsafe, unvalidated).

## R4 — Face motion cost

- **Decision**: eyes and ring are CSS keyframes on transform/opacity; the ring is a static 1.5px ring plus one rotating
  dot (a transformed element); faces in lists animate only when `alive` (working/waiting), idle faces are static.
- **Rationale**: dozens of faces on a screen stay on the compositor; JS animators per avatar (today's live figures)
  are what made animation opt-in before.
- **Alternatives**: SVG SMIL or JS per face — main-thread cost, rejected.

## R5 — Builder proposals in the chat timeline

- **Decision**: render proposals as cards inside the Builder chat's own timeline from the existing proposal messages
  (spec 010 shapes), computing "replaced" from a newer proposal in the same chat.
- **Rationale**: conversation-first creation is clearer than a split review (user decision); the data already
  exists, only the view changes.
- **Alternatives**: keep the side review with a slimmer layout — rejected by the user ("muito aglomerada").

## R6 — Phone app

- **Decision**: no phone code here; DESIGN.md gains the phone patterns and the pairing screens map to spec 014's
  existing flow and strings (`team.pair*`).
- **Rationale**: the app is a separate build (Expo per `docs/research/server-mobile.md`); designing it now keeps one
  system.
