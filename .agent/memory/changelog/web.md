2026-11-03 | telas reescritas pelo protótipo, átomos (AtomHttpApi/AtomRpc), i18n en, api.ts/accounts/memories/tools removidos | fase UI passos 2 e 3
2026-11-03 | painel de mudanças, desfazer, terminal, pasta do projeto, nível de acesso | fase 3
2026-11-03 | diff volta ao @pierre/diffs com pool de workers | a falha era o bug StrictMode + disableFileHeader sem pool
2026-11-03 | tela Usage reescrita, limites no seletor e na sidebar, nomes reais dos modelos | fase 2c
2026-11-03 | tela Usage redesenhada (hero, harnesses, área empilhada, totais, detalhamento) | inspiração OpenBot pedida pelo usuário
2026-11-03 | Accounts + API keys viram Settings › Providers (lista e página por provider) | pedido do usuário, inspirado no OpenBot
2026-11-03 | Settings › Storage; cn com tokens do tema; lookup de plural corrigido | pedido do usuário + bugs achados
2026-11-03 | composer em Tiptap com # @ $ /, fila de mensagens, medidor de contexto; seletor de agente saiu do campo | pedido do usuário
2026-11-03 | sidebar: icon tabs replaced by named Chats|Projects switch; Knowledge/Settings back as fixed rows; usage foot as per-window bars | impeccable critique 21/36 (consistency 1)
2026-11-03 | sidebar: tabs and Chats|Projects switch removed; stacked sections with icons; chats on one line | user: too cluttered, prefers no tabs
2026-11-03 | terminal: Run a script, Servers; fix de shell órfão no StrictMode | fase 3c
2026-11-03 | GitControl no cabeçalho do chat | lacuna vs T3 Code
2026-11-03 | Changes/Files/Browser/Terminal viram abas de um painel lateral redimensionável; cabeçalho com um botão só | pedido do usuário, como no T3 Code
2026-11-03 | fixar abas do painel e shells na linha do título (clique direito); ⋯ sem Summarize and learn | pedido do usuário
2026-11-03 | Git sai do popover e vira aba do painel lateral, com arquivos e commits; abas só com ícone no painel estreito | pedido do usuário
2026-11-03 | comentar linhas do diff → composer; último shell não fecha; Git no título só quando fixado | pedidos do usuário + lacuna vs T3 Code
2026-11-03 | tela Agents na barra lateral | fase 4, pedido do usuário
2026-11-03 | trilho de ícones à esquerda com os lugares do app; barra lateral só com chats e projetos; tela Routines | pedido do usuário (OpenBot)
2026-11-03 | chats na barra em 2 linhas sem ícone, com agentes participantes; seções sem ícone e mais espaçadas | pedido do usuário
2026-11-03 | projetos na barra como subtítulos alinhados aos chats | pedido do usuário
2026-11-03 | divisória entre trilho e barra; barra lateral recolhível (botão, ⌘B, Chats) | pedido do usuário
2026-11-03 | cartão de conteúdo com 100% da altura, colado à direita, raio só à esquerda | pedido do usuário
2026-11-03 | Motion (motion.dev) na barra lateral: recolher, seções e destaque do trilho | pedido do usuário; dependência: animar width/height auto e layoutId sem desmontar
2026-11-03 | chat em toda a largura do painel (sem coluna de 720px) | pedido do usuário
2026-11-03 | Cmd+K com busca nas mensagens | item 3 da lista (T3 Code)
2026-11-04 | Build with AI vira tela fixa; Builder interno; página Agents com menu único | pedido do usuário (Tucano/OpenBot)
2026-11-04 | Build with AI em três passos como no Tucano (poderes, primeira tarefa); teto do Builder = workspace; navegador só se pedido | teste ao vivo mostrou acesso errado e cartão duplicado
2026-11-04 | Build with AI sem o passo de primeira tarefa (Describe → Powers → página do agente) | pedido do usuário
2026-11-04 | modelos prontos de agente, seletor de projeto no Build with AI, prazo do gateway maior que o da aprovação | itens 4 e bug do timeout de 60 s
2026-11-04 | modelos prontos removidos do formulário de agente; loja de agentes vai para o backlog | decisão do usuário
2026-11-04 | Settings › Connectors em cartões; catálogo de pílulas do formulário removido | usuário pediu conectores tipo GitHub/Notion
2026-11-04 | conectores com logos (simple-icons) e estado Reconnect | usuário pediu logos e o padrão do OpenBot
2026-11-04 | Test connection nos conectores + teste ao conectar | usuário pediu teste na conexão
2026-11-04 | renomeado Zero → Zorel (textos, pacotes, localStorage migrado) | usuário escolheu o nome Zorel
2026-11-04 | ponytail review+audit: removidos signOut, AvatarStack, Card, windowShort, SessionAccess, TeamToolName, MODEL_OF_ACCOUNT/accountProviderOf, dep shadcn | código sem uso
2026-11-04 | logo Z do Zorel; barra lateral relê chats criados pelo servidor | renomeação e tarefas entre agentes
2026-11-04 | Settings › Processes e contagem de processos no cabeçalho do chat | usuário pediu página de processos em segundo plano, também por conversa
