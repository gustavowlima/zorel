# web
keywords: web, react, ui, chat, sidebar, route, knowledge, inbox, needs you, usage, model picker, settings, i18n, atoms, átomos, client
status: active
updated: 2026-11-03

## current
- sidebar (2026-11-03): marca, páginas fixas (Needs you/Knowledge/Settings), seções empilhadas Chats (sem projeto) e Projects com ícone, dobra e +, sem abas (usuário pediu); chats em 1 linha de 32px; lista com fade + fio no pé só quando há mais embaixo; pé = consumo por janela (paceOf em labels.ts, cartão no hover); uma coluna de ícone 20px x20–40 e texto em x50

- fase UI concluída (2026-11-03): todas as telas reescritas pelo protótipo, em inglês, com átomos
- rotas no hash (state.ts): #/ (home = novo chat), #/new/:projectId, #/chat/:id, #/project/:id[/agents|tools], #/agent/:id, #/agent/new/:projectId|global, #/knowledge[/:id], #/inbox, #/usage, #/settings/:tab
- dados = átomos (client.ts, D4): `Zorel` (AtomHttpApi) e `Live` (AtomRpc). Query por recurso com reactivityKey; mutation passa `reactivityKeys` e refaz as queries. `useList(atom)` dá array; `useMutation(atom)` dá promise
- chat = Atom.family(subscribeChat) + Stream.scan(reduceChat); NÃO usar a query de stream do AtomRpc (acumula em lotes PullResult)
- status ao vivo: statusAtom (keepAlive) sobre subscribeStatus; App invalida chats/memories/usage/approvals quando um chat sai de running (o server muda título e memórias sozinho)
- invalidação manual: invalidateAtom (Zorel.runtime.fn + Reactivity.invalidate); os runtimes dividem o memoMap, então um Reactivity só
- telas: sidebar.tsx (árvore + status), home.tsx (cria o chat no 1º envio/anexo), chat.tsx (timeline, pílula, aprovação, recibo, handoff), composer.tsx, model-picker.tsx (trilho de contas + raciocínio), people.tsx (avatar do autor, TeamPicker), inbox.tsx, knowledge.tsx, usage.tsx, settings.tsx, mcp.tsx, project.tsx, agent.tsx
- labels.ts: nomes de modelo/provider, escopo, título ("Novo chat" legado vira "New chat"), status, agentTone (posição no projeto)
- texto só por t() de @zorel/i18n; check:i18n (AST com @babel/parser) no CI
- tema: preferência em localStorage "zorel.theme" (system/dark/light), Settings › Appearance
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
- connectors (2026-11-04): aba "mcp" de Settings se chama Connectors; mcp.tsx CONNECTORS (catálogo fixo, casado com servidor por url ou comando) em cartões; OAuth abre a URL com window.open e consulta signedIn a cada 2 s por até 5 min; servidores de conector somem da lista "Custom servers"; logos via simple-icons 16.35.0 (import por ícone, ~10 no bundle; Playwright/Context7 sem marca usam Plug); estado attention (refused ou OAuth sem token) mostra Reconnect; ⋯ › Test connection (inspect) e teste automático após conectar com token/sem login
- chat (2026-11-04): tokens --container-chat (max-w-chat) e --text-chat; ChatMarkdown (chat-markdown.tsx) usa CodeBlock/TableFrame/ShimmerText de ui/code-block.tsx; PendingTray acima do composer; Reply bare em chat solo; Message.durationMs (coluna messages.duration_ms) no resumo do turno
- processes.tsx (2026-11-04): Settings › Processes (aba "processes" entre skills e storage) + ChatProcesses no cabeçalho do chat (só com servidor/terminal/sessão do chat); useRows junta GET /api/processes com useStatuses
- settings: abas providers (providers.tsx: lista Connected/Other + página por provider em #/settings/providers/<id> com sign-ins, API key, servidor local, modelos), mcp, skills, appearance; links antigos #/settings/accounts|keys caem em providers; providerPageOf(harness) leva o seletor de modelo à página certa
- i18n: nenhum ramo do catálogo pode ter uma chave `other` com texto (o lookup trata como plural); plurais só one/other em inglês
- audit.tsx: Settings › Audit log (filtro por tipo + busca, frase por ação em audit.actions.*, campos antes → depois com rótulos de modelo e acesso); recarrega ao abrir (as mutações das outras telas não invalidam "audit")
- storage.tsx: Settings › Storage (hero ≥48px, barra segmentada + legenda, projetos, maiores chats, limpar com confirmação)
- lib/utils.ts: cn = createCn com os tokens do tema (spacing control*, radius inline/control/card/sheet); sem isso h-control e h-auto não se anulam
- i18n lookup: plural só quando há `one` e `other` como texto; um ramo com chave `other` é ramo
- dev: o Vite de desenvolvimento às vezes não gera classes de arquivos novos; reiniciar resolve (o build gera)
- composer.tsx: Tiptap (ComposerSources: # leads, @ agents, $ skills, / commands; chips viram texto @handle/$handle via renderText); queue.tsx (fila local por chat em localStorage, sai sozinha quando !busy; steer/editar/apagar); context-meter.tsx (GET /api/chats/:id/context); TeamPicker no cabeçalho
- teste no navegador: não limpar o editor com execCommand (deixa lixo no ProseMirror); use Meta+A e Backspace
- shell.tsx: socket desmontado antes do frame "s" (StrictMode monta 2x em dev) manda {"t":"k"} quando o id chega; sem isso cada aba nova deixava um shell órfão (e um script rodando em dobro)
- TerminalPanel: ▷ Run a script (aba com label do script) e Servers (abre localhost:N no BrowserPanel via chat.openInBrowser → prop openUrl, que envia newtab+nav)
- git.tsx: GitControl no cabeçalho do chat (só repo git); popover com commit (Write it for me → gitDraft), push/publish, PR (rascunho editável; escondido na branch base), New branch
- painel lateral (pedido do usuário, padrão T3 Code): workspace.tsx SidePanel com abas changes/files/browser/terminal (type SideTab); chat.tsx guarda só `panel: SideTab | undefined`; cabeçalho = GitControl + um botão de painel (sem botões Changes/Browser/Terminal). BrowserPanel e TerminalPanel não têm mais aside/altura/fechar próprios; o último shell fechado remonta o terminal (shellKey)
- fixar (usePins em workspace.tsx): localStorage zorel.pins.side (global) e zorel.pins.shell.<chat>; ContextMenu nas abas do SidePanel (data-side-tab) e do Terminal (data-shell-tab); atalhos no ChatHeader (data-pin "side:x"/"shell:id"); fechar o shell tira o pin. Menu ⋯ do chat perdeu "Summarize and learn" (duplicava o Compact now do medidor de contexto)
- Git é aba "git" do SidePanel (GitPanel em git.tsx; useIsRepo); GitControl no cabeçalho só abre essa aba. GitStatus.commits (últimos 15, pushed = fora do ahead). Abas do painel: rótulo sr-only abaixo de @3xl do container (aside @container)
- diff-view.tsx: enableLineSelection + onLineSelectionEnd → selectedLines controlado + lineAnnotations com CommentBox (renderAnnotation); onComment → texto simples no composer (SidePanel.onAddToChat é texto puro; o Terminal cerca com ``` ele mesmo). Testar seleção por script: pointerdown/up no pai de [data-line-number-content] dentro do shadowRoot de diffs-container
- GitControl só aparece no título quando a aba git está fixada (pins.side inclui "git")
- Terminal: closable(tab) = mais de uma aba ou shell terminado; drop() que esvazia cria um shell novo (sem remontar: a lista do servidor em cache trazia de volta o shell fechado → "The shell ended")
- agents.tsx: rota #/agents (AgentsView, AgentRow, useWorking); chat invalida "agents" quando muda o nº de mensagens (agente pode ter criado um colega)
- routines.tsx: AgentRoutines na página do agente, FORA do <form> do perfil (form aninhado quebrava o envio)
- trilho de ícones (pedido do usuário, como a reference app): Rail em sidebar.tsx (lugares + UsageFoot vertical + Settings), Sidebar só com Chats/Projects; App.tsx renderiza Rail + Sidebar; rota #/routines (RoutinesView); Tooltip ganhou placement
- ChatItem na barra: 2 linhas sem ícone (NavTreeItem detail; nested usa pl-10): título + idade/spinner; embaixo avatares 16px + nomes dos membros, ou modelo, ou estado ao vivo. NavLabel das seções sem ícone (pedido do usuário: menos aglomerado)
- projeto na barra: subtítulo alinhado (sem pasta/negrito), seta slot="chevron" depois do nome, contagem dim à direita; chats aninhados pl-6 com fio em left-3
- barra lateral recolhível: useSidebar em state.ts (localStorage zorel.sidebar.hidden, ⌘B); Rail tem botão PanelLeftClose/Open e Chats ativo alterna; trilho com border-r
- motion 12.43.0 (pedido do usuário: animar a sidebar): ui/motion.tsx exporta spring, Fold (altura auto com AnimatePresence), SlideWidth (largura, mantém montado, inert quando fechado), Marker (layoutId) e MotionConfig (reducedMotion user em main.tsx). Não misturar classes transition-* em elementos motion
- notify.tsx: useNotifications(route) em App (Notification API, transições via noteworthy() em labels.ts), NotifySetting em Settings › General (localStorage zorel.notify). Pausa: botão no trilho + faixa no App
- Cmd+K: ui/command.tsx (CommandPalette com RAC Autocomplete+Menu, sem filtro interno) e features/palette.tsx (lugares, chats/projetos/agentes filtrados no cliente, mensagens via GET /api/search com debounce 180ms)
- editar daqui: MessageActions onEdit (só msg do usuário, sem turno vivo) → RewindDialog → mutations.rewind → useAtomRefresh(chatAtom) + setDraft com o texto
- mcp.tsx CATALOG (presets que preenchem o NewServer; sem OAuth). project.tsx Agents: Select de agente padrão
- pages.tsx (PageView com Markdown prose-chat, edição, Versions; NewPage); knowledge.tsx ganhou filtro "page"
- 2026-11-04: Agents com um botão New agent (menu: Build with AI, Blank, Import) e ⋯ por linha (abrir, exportar, apagar); NewAgentMenu/useDeleteAgent em agents.tsx também na aba Agents do projeto. Tela Build with AI = features/builder.tsx (rota builder, #/build/<p>): Timeline exportada do chat.tsx + Composer, prévia parseando args do zorel_create_agent (draftsOf). Builder (a.builtin) excluído de listas e pickers. Página do agente em abas (Profile, Tools and access = features/permissions.tsx, Knowledge and activity)
- testes da web agora rodam no bun test raiz (apps/web incluído)
