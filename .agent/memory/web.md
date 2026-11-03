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

- failover: features/failover.tsx (FailoverEditor + useTermsPending) no agente e no diálogo "Fallbacks…" do chat; nota de troca no chat (evento failover ao vivo, message.switches gravado); uso/espera da conta em Usage e no seletor de modelo

- workspace no chat: features/workspace.tsx (TurnChanges, WorkspacePanel Changes/Files, TerminalPanel), diff-view.tsx (@pierre/diffs FileDiff dentro do pool de workers de diff-pool.tsx, tema por useResolvedTheme, cores dos tokens via unsafeCSS, carregado sob demanda); pasta do projeto no overview e no popover de novo projeto; nível de acesso com ChoiceCards na página do agente
- App revalida tudo a cada 2s enquanto offline (átomos que falharam não tentam de novo sozinhos)

## avoid

- @pierre/diffs sem WorkerPoolContextProvider: com StrictMode + disableFileHeader o diff fica vazio, sem erro (bug da lib)

- line-clamp dentro de Button flex: altura 0; usar truncate
- regra CSS global fora de @layer (ex.: `* { border-color }`): vence os utilitários do Tailwind v4
- Focusable em volta de botão React Aria no Tooltip (aviso no console); o TooltipTrigger aceita o Button direto
- formatAge para datas muito antigas: acima de 8 semanas mostra a data
- consumo (fase 2c): usage.tsx (intervalos, totais com custo, gráfico por dia UTC, assinaturas, top turnos, alerta 80%; sem export CSV (removido a pedido)); limits.tsx (LimitWindows, compacto no seletor); FullestLimit na sidebar; custo e conta no rodapé da resposta
- dias de uso são UTC: o mês começa em Date.UTC e o rótulo do dia usa meio-dia (dayLabel) para não voltar um dia no fuso local
- useReadOnOpen lê os limites uma conta por vez: o átomo de mutação é compartilhado e uma segunda chamada aborta a primeira (499)
- labels.rememberModels (chamado no App) guarda os nomes reais dos modelos; modelName/modelNote usam e caem nos apelidos
- usage.tsx (2026-11-03, inspirado no a reference app): hero do total (custo ou tokens), lista de harness = legenda, AreaChart (SVG próprio, sem lib; slider por teclado), Totals, Breakdown (aba Day = gráfico em tabela); cores das séries em --z-series-N por harness em ordem fixa (HARNESSES)
- settings: abas providers (providers.tsx: lista Connected/Other + página por provider em #/settings/providers/<id> com sign-ins, API key, servidor local, modelos), mcp, skills, appearance; links antigos #/settings/accounts|keys caem em providers; providerPageOf(harness) leva o seletor de modelo à página certa
- i18n: nenhum ramo do catálogo pode ter uma chave `other` com texto (o lookup trata como plural); plurais só one/other em inglês
- audit.tsx: Settings › Audit log (filtro por tipo + busca, frase por ação em audit.actions.*, campos antes → depois com rótulos de modelo e acesso); recarrega ao abrir (as mutações das outras telas não invalidam "audit")
- storage.tsx: Settings › Storage (hero ≥48px, barra segmentada + legenda, projetos, maiores chats, limpar com confirmação)
- lib/utils.ts: cn = createCn com os tokens do tema (spacing control*, radius inline/control/card/sheet); sem isso h-control e h-auto não se anulam
- i18n lookup: plural só quando há `one` e `other` como texto; um ramo com chave `other` é ramo
- dev: o Vite de desenvolvimento às vezes não gera classes de arquivos novos; reiniciar resolve (o build gera)
- composer.tsx: Tiptap (ComposerSources: # leads, @ agents, $ skills, / commands; chips viram texto @handle/$handle via renderText); queue.tsx (fila local por chat em localStorage, sai sozinha quando !busy; steer/editar/apagar); context-meter.tsx (GET /api/chats/:id/context); TeamPicker no cabeçalho
- teste no navegador: não limpar o editor com execCommand (deixa lixo no ProseMirror); use Meta+A e Backspace
