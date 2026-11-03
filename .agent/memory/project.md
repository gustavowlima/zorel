# project
updated: 2026-11-02

## summary

Zero: workspace open source de agentes de IA com Projetos (agentes de projeto) e Chats avulsos.
Contexto montado pelo app a cada turno (projeto → chat → memórias), não acumulado em sessão de CLI.
Aprendizado contínuo via memórias e skills aprovadas pelo usuário. Troca de modelo a qualquer turno,
usando assinaturas (CLI oficial: Claude Code, Codex, ACP) ou token de API (effect/ai).

## technical context

- stack: Bun 1.4 workspaces, Effect 4.1.2 (HttpApi + Schema), bun:sqlite, Vite + React 19 + Tailwind v4
- packages/contracts é a única fonte de tipos que cruza a rede; web usa HttpApiClient derivado dele
- assinaturas: sempre spawnar a CLI oficial; nunca ler/guardar token OAuth dela (termos dos providers)
- referências estudadas: a reference app (Apache-2.0, pode copiar com atribuição), t3code (MIT, pode copiar com atribuição),
  a reference app (PolyForm Noncommercial: só ideias, nunca código)
- decidido não fazer fork do t3code: núcleo dele depende de sessão nativa da CLI, ~1M LOC, ~150 commits/dia, Node/pnpm
- licença Apache-2.0 (compatível com o código derivado do a reference app; patentes); repositório git próprio em zero/ (antes ficava dentro do repo de dev/)
- assinatura macOS: usuário optou por sem assinatura por enquanto (2026-11-03); config liga sozinha se os segredos forem cadastrados
- CI: .github/workflows/ci.yml (typecheck, test, build; app macOS em push na main)
