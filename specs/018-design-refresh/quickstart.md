# Quickstart: validating the Design Refresh

## Prerequisites

`bun install` at the root; a copy of a data folder for screenshots (memory: isolated server with
`PORT=4318 ZOREL_HOME=<copy> ZOREL_WEB_DIR=<build> ZOREL_SESSION=<secret>`, open `/api/login?t=<secret>#/route`).

## Per phase

1. **Tokens**: `bun test apps/web/src/tokens.test.ts` passes (contrast floors in both themes, agent hues share L/C).
   Set `preferences.theme = { accent: "#d9480f" }`: every primary button, focus ring and selection turns orange;
   agent faces and states don't. Set an action colour with poor contrast: Settings shows why it was refused.
2. **Type/size/shape**: `bun run check:ui` passes with no new baseline; a screenshot of Settings and a list shows
   32px controls, 16px cards with 6px inset, 10px rows.
3. **Agent identity**: an agent working shows the flat ring with a moving dot in the sidebar, chat header and
   Agentes; waiting shows the amber dot; with "reduce motion" on in the OS, nothing moves and the marks stay.
   `open-bot-avatar` is gone from `package.json` and NOTICE.
4. **Início**: with one pending approval, one working agent and two routine results, the four sections appear in
   order; approving from Início clears it in Precisa de você; with none pending the section is absent.
5. **Builder**: ask for an agent, ask one change, create: one collapsed card, one created card, the agent in Agentes.
6. **Screens**: each screen of the spec matches its prototype board (canvas link in spec.md) and uses only library
   components (`check:ui` hand-* rules at zero).
7. **First run**: a fresh profile goes opening → connect → first agent → ready; with reduced motion the same steps
   show still.

Always: `bun run test`, `bun run typecheck`, `bun run check:ui`, screenshots in dark and light.
