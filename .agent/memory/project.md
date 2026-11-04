# project
updated: 2026-11-04

## summary

Zorel: workspace open source de agentes de IA com Projetos (agentes de projeto) e Chats avulsos.
Contexto montado pelo app a cada turno (projeto → chat → memórias), não acumulado em sessão de CLI.
Aprendizado contínuo via memórias e skills aprovadas pelo usuário. Troca de modelo a qualquer turno,
usando assinaturas (CLI oficial: Claude Code, Codex, ACP) ou token de API (effect/ai).

## technical context

- stack: Bun 1.4 workspaces, Effect 4.1.2 (HttpApi + Schema), bun:sqlite, Vite + React 19 + Tailwind v4
- packages/contracts é a única fonte de tipos que cruza a rede; web usa HttpApiClient derivado dele
- assinaturas: sempre spawnar a CLI oficial; nunca ler/guardar token OAuth dela (termos dos providers)
- referências estudadas: tucano (Apache-2.0, pode copiar com atribuição), t3code (MIT, pode copiar com atribuição),
  openbot (PolyForm Noncommercial: só ideias, nunca código)
- decidido não fazer fork do t3code: núcleo dele depende de sessão nativa da CLI, ~1M LOC, ~150 commits/dia, Node/pnpm
- licença Apache-2.0 (compatível com o código derivado do Tucano; patentes); repositório git próprio em zero/ (antes ficava dentro do repo de dev/)
- assinatura macOS: usuário optou por sem assinatura por enquanto (2026-11-03); config liga sozinha se os segredos forem cadastrados
- CI: .github/workflows/ci.yml (typecheck, test, build; app macOS em push na main)
- lint: Biome só como linter (sem formatter), preset recommended; noNonNullAssertion e noBannedTypes desligadas com motivo em biome.json; any só como aviso
- docs/references.md: matriz prática → arquivo → teste para Tucano, T3 Code e OpenBot, com o que ficou de fora e por quê

## arquitetura alvo (2026-11-03)

- fonte da verdade: docs/ARCHITECTURE.md (decisões D1–D12, módulos, fases 1–7)
- Effect de ponta a ponta: HttpApi (CRUD) + effect/rpc via WebSocket (turnos) + átomos no front (AtomHttpApi/AtomRpc); oRPC, Zod, Mastra e LangGraph descartados
- engines alvo (harness primeiro): assinatura → harness do dono (Claude Agent SDK, Codex App Server, ACP da CLI); API key de QUALQUER provider (inclusive Anthropic/OpenAI) → OpenCode via ACP com config por OPENCODE_CONFIG_CONTENT; effect/ai só para tarefas internas e conversa rápida sem workspace; medição por turno decide se algum provider ganha rota nativa
- contexto híbrido: sessão nativa + contexto em camadas como ponto de retomada + marcação de leitura por sessão + passos de trabalho
- próxima fase: 1 (runtime em background)
- i18n (D13): todo texto de UI via packages/i18n (en.ts fonte, outros idiomas `satisfies Messages`); só inglês por enquanto; server manda código + parâmetros, não frase; prompts de modelo em inglês com "responda no idioma do usuário"; conteúdo do usuário não é traduzido; migração junto com a fase 1
- multicontas (D14, ARCHITECTURE 6.1): tabela provider_accounts (subscription com pasta de login gerenciada ~/.zorel/accounts/<id> via CLAUDE_CONFIG_DIR/CODEX_HOME/...; api-key com chave no chaveiro); accountId em agente e chat; troca manual = troca de provider (ponto de retomada), sem shadow home; failover automático OPCIONAL (lista ordenada de até 8 {conta, modelo}, pode cruzar providers; gatilhos limite/erro; só se o turno ainda não agiu; volta à principal após reset; aviso de termos ao pôr 2ª assinatura do mesmo provider; desligado por padrão) — fase 2b; pool com rodízio fica fora (proxy externo); assinaturas na fase 2, várias chaves na fase 5
- consumo (D15, ARCHITECTURE 10.2, fase 2c): dados de turns (tokens incl. cache, custo estimado via catálogo models.dev, latências, failover); janelas de limite por conta (Claude rate_limit_event, Codex account/rateLimits/read) lidas 1 por vez, cache 4 min, backoff 5/10/20/40 min até 1 h; alertas 80%; orçamento a 100% pede confirmação (não bloqueia em silêncio)
- validação da arquitetura (2026-11-03): Claude Agent SDK confirmado (setModel/interrupt só em streaming input; rewindFiles; trocar modelo zera cache); harness decidido pela conta, não pelo nome do modelo; projects.path novo; desktop com server em background na fase 7; aviso de termos para assinatura Claude via Agent SDK
- decisões 2026-11-03: D16 projeto próprio (sem fork do T3 Code; copiar packages/effect-acp e effect-codex-app-server com NOTICE); D17 portas abertas para hospedar (Actor, Drizzle+@effect/sql, Secrets, Workspace, memória owner/audience, agente versionado, Engine); D9 Drizzle 1.0 rc fixado sobre @effect/sql-sqlite-bun (Postgres depois via @effect/sql-pg; FTS5 em sql puro; contrato da API separado das tabelas)
- propósito: código agora; hospedado + automação depois (fase 8)
- D18 base de conhecimento (ARCHITECTURE 8.2, fase 3b): coleções por projeto/global ligadas a agentes; fontes upload/pasta local incremental/URL; busca híbrida FTS5+vetores com RRF; citações; embeddings Ollama ou API via effect/ai EmbeddingModel; modo tool (zero.knowledge_search) ou auto
- banco local: libSQL (@effect/sql-libsql) com vetores nativos (F32_BLOB, libsql_vector_idx, vector_top_k); validar no spike da fase 1 (nativo no Bun, FTS5); plano B bun:sqlite + força bruta
- gestão de memória (8.1): fixar/excluir do contexto, versões, retenção visível, exportar/importar, desligar por agente/projeto; inspetor de contexto "o que o modelo viu" por resposta
- 2026-11-03 revisão "leve": D0 leve primeiro (um processo, um arquivo de banco, nenhum serviço externo obrigatório; crescer só com medição); D18 virou conhecimento APRENDIDO no modelo ai-memory (captura→consolida→recupera→bastão), página única (fato/decisão/como-fazer/armadilha/referência/sessão) substitui memórias+skills; consolidação sem LLM sempre (página de sessão + handoff) e LLM opcional; resumo de entrada ~1.5k tokens + zorel.knowledge_search FTS; D7: conhecimento do projeto entra direto com versões/desfazer/feed, o que é sobre o usuário passa por aprovação; RAG por upload, libSQL, embeddings, grafo, mem0 → backlog com critério; banco volta a @effect/sql-sqlite-bun
- aprovações e interação entre agentes (ARCHITECTURE 9.2/9.3, fase 4, ideias do OpenBot): níveis por agente Workspace (padrão)/Perguntar antes/Acesso total mapeados por harness; cartão único p/ ferramenta nativa e MCP, vínculo por hash da chamada, aprovar uma vez/sempre permitir (regra revogável)/recusar com motivo; persistidas, expiram 30 min (=recusa); promover a Acesso total responde as pendentes; tela "Precisa de você"; rotina: recusar e reportar (padrão) ou esperar; agente só restringe, nunca amplia; criado herda limites do criador; send_message com resposta automática + espera de pedidos múltiplos + proteção de loop + idempotência; start_task (2 paralelas, até 4; 8 abertas); interrupt_agent só no que o chamador pediu; política de delegação (Status/Resultado/Evidência/Desbloqueio); canal: roteamento determinístico, depois líder sem ferramentas usando responsabilidades; bloco recolhido "conversa entre agentes"
- arquitetura fechada (2026-11-03): seção 12 Transversal (observabilidade com mascaramento, testes em 3 camadas, migração dos dados atuais + backup VACUUM INTO, exportar/importar workspace sem segredos, notificações, anexos 10×20 MB, atualização do app com canais e espera de turnos); seção 13 Fases; agente padrão por projeto; arquivos de contexto inject/link no backlog
- D20: sem Rust como stack principal; só peças pontuais com limite medido (2026-11-03)
- PRODUCT.md (apps/web, impeccable init 2026-11-03): usuários = dev + pequena equipe (2–5); diferenciais = contexto é do Zorel, aprende trabalhando, equipe de agentes, usa o que você já paga; nome "Zorel" (renomeado de "Zero" em 2026-11-04; o usuário é dono de zorel.dev); Apache-2.0; tom direto/técnico; visual inspirado no OpenBot; DECISÃO EM ABERTO: como a equipe compartilha antes do hospedado (server na rede da equipe vs adiantar login/papéis da fase 8)

## ordem (2026-11-03)

- engine primeiro: fase 1 (runtime) e fase 2 (engines) antes da interface; a fase UI redesenha tudo uma vez, com i18n e átomos, a partir do protótipo
- protótipo das telas: https://claude.ai/artifact/ERkKURix2bnKAqzi97emmw (privado do dono)
- novas fases: 3c painel de execução (terminal, tests, problems, processes, logs); catálogo de conectores com OAuth na fase 4
- fase 1 (runtime) e fase 2 (engines vivos) concluídas em 2026-11-03; próxima pela ordem da §13: fase UI (interface nova), ou 2b/2c (failover, consumo)

## convenções

- comentários de código em inglês (pedido do usuário em 2026-11-03; substitui o "comments in the project language" do AGENTS.md para este projeto). Textos de interface e prompts de modelo não são comentários: ficam como estão até o i18n da fase UI
- alias no server: `#server/*` (package.json "imports"), não `paths` do tsconfig: o desktop empacota o server e só o imports é resolvido pelo package.json do próprio server
- commits em inglês a partir de 2026-11-03 (pedido do usuário); comentários no código também em inglês; histórico anterior fica em português
- renomeado Zero → Zorel (2026-11-04): pacotes @zorel/*, env ZOREL_*, ferramentas zorel_*, gateway MCP "zorel", keychain dev.zorel.app, appId dev.zorel.app. Legado mantido: dados em ~/.zero/zero.db continuam sendo usados se existirem (não movidos: o banco guarda caminhos absolutos); keychain lê dev.zero.app e copia; localStorage zero.* copiado para zorel.*; backups zero-* ainda podados; import aceita "zero.agent". A pasta do repositório segue dev/zero
