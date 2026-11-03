# web
keywords: web, react, ui, chat, sidebar, route, knowledge, inbox, needs you, usage, model picker, settings, i18n, atoms, átomos, client
status: active
updated: 2026-11-03

## current

- fase UI concluída (2026-11-03): todas as telas reescritas pelo protótipo, em inglês, com átomos
- rotas no hash (state.ts): #/ (home = novo chat), #/new/:projectId, #/chat/:id, #/project/:id[/agents|tools], #/agent/:id, #/agent/new/:projectId|global, #/knowledge[/:id], #/inbox, #/usage, #/settings/:tab
- dados = átomos (client.ts, D4): `Zero` (AtomHttpApi) e `Live` (AtomRpc). Query por recurso com reactivityKey; mutation passa `reactivityKeys` e refaz as queries. `useList(atom)` dá array; `useMutation(atom)` dá promise
- chat = Atom.family(subscribeChat) + Stream.scan(reduceChat); NÃO usar a query de stream do AtomRpc (acumula em lotes PullResult)
- status ao vivo: statusAtom (keepAlive) sobre subscribeStatus; App invalida chats/memories/usage/approvals quando um chat sai de running (o server muda título e memórias sozinho)
- invalidação manual: invalidateAtom (Zero.runtime.fn + Reactivity.invalidate); os runtimes dividem o memoMap, então um Reactivity só
- telas: sidebar.tsx (árvore + status), home.tsx (cria o chat no 1º envio/anexo), chat.tsx (timeline, pílula, aprovação, recibo, handoff), composer.tsx, model-picker.tsx (trilho de contas + raciocínio), people.tsx (avatar do autor, TeamPicker), inbox.tsx, knowledge.tsx, usage.tsx, settings.tsx, mcp.tsx, project.tsx, agent.tsx
- labels.ts: nomes de modelo/provider, escopo, título ("Novo chat" legado vira "New chat"), status, agentTone (posição no projeto)
- texto só por t() de @zero/i18n; check:i18n (AST com @babel/parser) no CI
- tema: preferência em localStorage "zero.theme" (system/dark/light), Settings › Appearance
- vite dev faz proxy de /api e /rpc (ws) para 4317

- novo projeto: popover no "+" da barra lateral (NewProjectButton em project.tsx: nome + brief opcional), não página; ao criar vai para o overview

## avoid

- line-clamp dentro de Button flex: altura 0; usar truncate
- regra CSS global fora de @layer (ex.: `* { border-color }`): vence os utilitários do Tailwind v4
- Focusable em volta de botão React Aria no Tooltip (aviso no console); o TooltipTrigger aceita o Button direto
- formatAge para datas muito antigas: acima de 8 semanas mostra a data
