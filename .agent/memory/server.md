# server
keywords: server, api, sqlite, db, engine, chat, context, memory, consolidation, mcp, tools, approval, channel, mention, secrets, skills
status: active
updated: 2026-11-04

## current

- main.ts: HttpApi (contracts) + SSE POST /api/chats/:id/send + serve apps/web/dist; start() exportado (usado pelo desktop); escuta só 127.0.0.1
- LocalOnly (middleware global): Host precisa ser localhost/127.0.0.1/::1 (DNS rebinding) e Origin, se houver, também local (CSRF); 403 caso contrário
- serviços: Store → Secrets → (Engines, Tools) + DataDir; testes trocam Secrets.layer por Secrets.memory()
- db.ts: migrations em array (nunca editar publicada); chat_members (ordem = position; primeiro é líder); messages.agent_id/steps; memories.kind fact|skill + title; índice FTS próprio memory_index (title + text); mcp_servers
- lista vazia em IN/NOT IN vira (''); NULL faria NOT IN filtrar tudo
- engines.ts: id "<provider>/<modelo>"; CLIs sem sessão nem ferramentas próprias, MCP só via gateway (claude --mcp-config + --allowedTools mcp__zorel; codex -c mcp_servers.zorel.*); API via effect/ai com loop de ferramentas até MAX_TOOL_STEPS
- tools.ts: Hub (clientes MCP stdio/http reaproveitados), Gateway (Bun.serve, sessão por turno com token), classify (anotação > nome; sensível vence leitura); modos read | approve | auto
- chat.ts: turno = mensagem do usuário → chain(mencionados || [líder]); cada resposta abre sessão de ferramentas, aprovações por Promise com timeout 10 min (recusa ao fechar o turno); grava parcial como "interrompido"; MAX_DEPTH 3 repasses
- consolidação recebe as esquecidas (forgottenMemories) e respeita MAX_PENDING 20 propostas pendentes por escopo
- memories() devolve também as esquecidas: a UI oferece Restaurar (via de volta)
- context.ts: camadas estável → volátil; outros agentes chegam como user "[Nome]"; skills: títulos de todas + corpo das 2 mais relevantes
- oauth.ts (2026-11-04): conectores OAuth via SDK do MCP (auth(): descoberta, registro dinâmico, PKCE, refresh); McpOAuth por servidor guarda {client,tokens,verifier} no keychain "mcp-oauth:<id>"; mcp_servers.auth none|oauth; rotas POST/DELETE /api/mcp/:id/sign-in, GET /api/mcp/signed-in, GET /api/oauth/callback (state emitido pelo Zorel, uso único, 10 min; HTML com texto escapado); redirect = ZOREL_ORIGIN (start() define) + /api/oauth/callback. GitHub (api.githubcopilot.com) não aceita registro dinâmico: token PAT; Hub.refused marca servidores que responderam 401/UnauthorizedError (limpo em close/conexão ok); PATCH /api/mcp/:id aceita env (troca o token sem recriar); hub.test.ts cobre 401 → refused e servidor fora do ar ≠ refused
- transfer.ts (2026-11-04): export/import do workspace (.tar.gz via Bun.Archive; ler bytes na hora, Bun.file vira vazio no Archive; VACUUM INTO precisa conexão de escrita); import pendente aplicado em start() antes do Store; DbPath service em chat.ts
- equipe (2026-11-04): runtime.chain recebe também turnos que falharam; wraps (chat → asker/waiting/covered) dá turno de fechamento ao agente que repassou por menção; followUp em enqueueFor (sem menção, logo após você falar com um colega que respondeu → ele); handoff via "reply"/"limit" no contrato; prompt do canal com formato Status/Result/Evidence e regra de fechamento; migração esconde chats legados do Builder
- ask_user (2026-11-04): ASK_TOOL em team.ts; runtime waitFor (askApproval usa) + answers map preenchido no decide (kind question, reason = resposta); ApprovalKind ganhou "question"; status label "question" (QUESTION_LABEL) vira "asks you something" no web
- tarefas (2026-11-04): zorel_start_task (team.ts TASK_TOOL; runtime taskCall/startTask/reportTask); chat próprio com chats.task_of/task_by; reportTask roda quando a fila do chat da tarefa esvazia (worker), uma vez (closeTask); acesso maior que o de quem pede → cartão; limites MAX_OPEN_TASKS 4, MAX_TASK_DEPTH 2; reply:false = sem retorno
- prompts e todo texto que vai ao modelo (prompt base, consolidação, resultados de ferramentas, erros dos engines) em inglês, sem mandar responder num idioma: o modelo segue o idioma de quem escreve (2026-11-04, pedido do usuário)
- ACP confinado: Seatbelt (mac) ou bubblewrap (linux, se bwrap instalado; bwrapArgs); windows recusa abaixo de full. terminals.shellCommand: pwsh/powershell no windows, $SHELL -l nos outros (2026-11-04)
- procs.ts (2026-11-04): tabela de processos/portas/pasta nos 3 sistemas (win: PowerShell persistente + netstat; linux: /proc + ss; mac: ps + lsof); sample() faz CPU por delta; terminals.ts não usa mais lsof/pgrep; EngineSession.pid (claude via spawnClaudeCodeProcess, codex rpc.pid), Hub.pidOf; GET /api/processes traz usage (total e partes) e cpu/memory por linha; servers.nested evita contar em dobro
- processos (2026-11-04): GET /api/processes (settings group) = serversUnder(pastas dos chats) + liveTerminals + runtime.liveSessions + hub.connected; stopProcess só pid da lista; closeSession ignora chat com turno rodando; closeConnection = hub.close
- secrets.ts: Bun.secrets (service dev.zorel.app); env tem precedência; variáveis MCP em "mcp:<id>" como JSON
- testes: main.test.ts (E2E: canal, MCP real via gateway com aprovação, skills, chaves), engines.test.ts (parsers, args, contexto, menções, política, API com tool loop contra mock), db.test.ts (FTS, migração 2→3)

- contrato de turnos em packages/contracts/src/events.ts (import "@zorel/contracts/events", não reexportado no index para evitar import circular): Turn, WorkStep, Approval, ChatStatus, ChatEvent (TaggedUnion por _tag), ZorelRpc (send, steer, interrupt, decide, subscribeChat, subscribeStatus)
- WorkStep é a fonte da pílula de atividade: kind read/edit/run/search/tool/delegate, título curto, arquivos, duração, mudanças por arquivo; status waiting = aprovação pendente

- banco: Drizzle 1.0.0-rc.5 (drizzle-orm/effect-sqlite-bun) + @effect/sql-sqlite-bun 4.1.2; schema em src/schema.ts, migrations em apps/server/drizzle (drizzle-kit generate, script db:generate)
- repositório (db.ts) devolve Effect em todo método; erro de banco vira defeito (orDie); chamadores usam yield*; código async (gateway MCP) usa Effect.runPromise
- PRAGMA foreign_keys = ON é ligado ao abrir (cascatas dependem disso); FTS5 memory_index + gatilhos ficam na migration à mão (Drizzle não modela)
- migrate.ts: antes de abrir, se houver migration pendente, faz backup (VACUUM INTO ~/.zorel/backups/zorel-<ts>.db (zero-* antigos também podados)); banco do MVP (sem __drizzle_migrations) sobe para user_version 3 com LEGACY_MIGRATIONS e a linha de base (IF NOT EXISTS) o adota sem cópia
- desktop: prebuild copia apps/server/drizzle e define ZOREL_MIGRATIONS (migrationsDir() lido na hora, não no import)

- Bun primeiro onde há API própria (Bun.file/Bun.write, Bun.serve, bun:sqlite, Bun.secrets, Bun.spawn); node:fs para diretórios (mkdir/readdir/exists: o Bun implementa nativo e recomenda), node:path e node:os ficam (só texto/trivial)

- runtime de turnos em runtime.ts (serviço Runtime): fila por chat no banco (tabela turns, um worker por chat com flag kicked contra corrida), clientId UNIQUE = idempotência, texto parcial gravado a cada lote (partial_text) para kill -9; boot: running → interrupted + mensagem com o parcial, aprovações abertas → expired, filas retomadas
- eventos: PubSub por chat + PubSub de status; subscribeChat assina antes do snapshot (nada se perde); deltas agrupados com Stream.groupedWithin(512, 100 ms)
- aprovações persistidas (tabela approvals), espera por Deferred com timeout de 30 min; fim do turno expira as abertas; "always" ainda aprova só a chamada (regra persistente é fase 4)
- passos (tabela steps) emitidos como step-started/step-finished; Message.steps (legado) continua para o histórico
- RPC: RpcServer.layerHttp em /rpc (websocket, RpcSerialization.layerJson); handlers em main.ts; steer cai na fila até a fase 2; SSE /send removido
- encadeamento por @menção cria turnos com depth+1; no limite (MAX_DEPTH) só loga

- observabilidade: observability.ts registra todo valor do Secrets (inclusive cada valor do JSON de env MCP) e o LoggerLive (logfmt) troca por ***; spans "turn", "engine.run", "tool.call" com anotações chatId/turnId
- Actor (access.ts): sempre LOCAL_ACTOR hoje; memories.owner e memories.audience (user → owner, projeto/agente → project) existem no banco mas não no contrato público (D17)
- medição: turns.started_at, first_token_at, ended_at e tokens; erros do turno como código (ErrorCode em events.ts; isInterruption cobre o legado "interrompido")
- backup: antes de migration pendente e um por dia; mantém os 7 mais novos em ~/.zorel/backups

- sessões nativas (fase 2): Engines.open(model, system estável, cwd) → EngineSession (engines/session.ts); hoje só claude-cli (engines/claude-sdk.ts, Agent SDK 0.3.317 com o `claude` instalado); runtime guarda uma por (chat, agente), marcação `seen` = at da última mensagem que a sessão tem; turno manda <context>dinâmico</context> + transcript só do que é novo; reabre se o contexto estável, provider ou sessão morta mudar; máx. 8 sessões (LRU)
- comandos do Claude Code (como T3 Code): sessões claude-cli carregam settingSources user/project/local com managedSettings {allowManagedPermissionRulesOnly, disableAllHooks} — Zorel continua decidindo permissões (canUseTool) e nenhum hook roda; GET /api/chats/:id/commands = supportedCommands() no cwd (cache 10 min, sem compact/clear/model/... que o Zorel faz); mensagem nova que abre com /nome conhecido vai como último bloco de texto (só assim o CLI expande); Codex não tem API de listagem de comandos
- buildTurn devolve system (estável + dinâmico, para engines sem sessão), stable e dynamic; mensagens do turno levam `at`

- Codex: engines/codex.ts, cliente JSON-RPC mínimo (D16 revisada); CODEX_HOME = <dataDir>/accounts/codex-default (isola config.toml do usuário: -c mcp_servers={} NÃO remove os servidores dele); account/read antes da thread → sem login, erro com `CODEX_HOME=… codex login`; pedidos de aprovação do Codex são recusados (sandbox read-only, shell off, ações só pelo gateway); teste contra engines/fixtures/fake-codex-app-server.ts
- sessões nativas usam URL fixa do gateway (GatewayHandle.update troca as ferramentas por turno); nomes das ferramentas entram na chave do contexto estável (lista nova = sessão nova); Engines.hasSession decide
- smoke contra o server: script precisa rodar de dentro de apps/server (bun --no-install), senão o Bun instala outro effect e o RPC trava

- contas (§6.1): accounts.ts (serviço Accounts) + tabela provider_accounts; padrão claude-default (home null = login da CLI) e codex-default (home Zorel); extra = <dataDir>/accounts/<id>; status pela CLI (claude auth status --json, codex login status) com cache de 30 s; login roda a CLI e devolve a URL se impressa; remover = logout + apaga a pasta (só pastas do Zorel) + agentes/chats voltam à padrão
- agents.account_id e chats.account_id (null = padrão); turns.account_id gravado no enqueue; Accounts.resolve cai na padrão se a conta é de outro provider; conta entra na chave da sessão (trocar = sessão nova)
- web: features/accounts.tsx (AccountsSection nas configurações, AccountSelect no chat; agente ainda sem seletor de conta: fase UI)
- server manda cache-control: no-cache no index.html e immutable nos assets com hash

- steering: EngineSession.steer só existe onde é real (Codex: turn/steer com expectedTurnId); runtime.steer grava a mensagem e, se a sessão rodando aceita, ela entra no turno; senão vira o próximo turno. Claude não tem steer (o SDK só enfileira depois do turno e misturaria saídas)
- effort (low/medium/high/max) em chats e agents; líder usa o do chat; Claude troca ao vivo com applyFlagSettings({effortLevel}); Codex manda por turno (max → xhigh)
- tokens de cache: Usage.cachedTokens (Claude cache_read_input_tokens, Codex cachedInputTokens) gravado em turns.cached_tokens

- sessões guardadas por (chat, agente, provider): Claude → Codex → Claude mantém a do Claude e manda só o delta ao voltar (critério da fase 2)
- anexos: tabela attachments, arquivo em <dataDir>/attachments/<chat>/<id>; POST /api/chats/:id/attachments (corpo cru, x-file-name, 20 MB, 413), GET /api/attachments/:id (inline, nosniff); send/steer com attachmentIds (máx. 10); Message.attachments montado na leitura; imagens nativas (Claude base64, Codex localImage); texto ≤64 KB inline na transcrição; resto pelo nome até a fase 3; apagar chat apaga a pasta; steer com anexo vira próximo turno
- fase 2 concluída em 2026-11-03

- GET /api/usage (settings.usage): turnos terminados dos últimos USAGE_DAYS (30) somados por dia UTC, projeto, agente, modelo e conta (db.usage); RPC `approvals` lista as aprovações abertas de todos os chats ("Needs you")
- status.label e hints de listModels ainda saem em texto; a web ignora e usa o catálogo i18n

- consumo (fase 2c, 2026-11-03): pricing.ts (models.dev → <dataDir>/pricing.json, diário; Pricing.fixed nos testes); runtime.save grava cost + account_id em message e turn; billingOf(model) = subscription | api | local
- limites: accounts.refreshLimits(id) lê pela CLI (readClaudeLimits / readCodexLimits), cache 4 min, semáforo, backoff 5→60 min; AccountUsage = { windows[{id, usedPercent, resetsAt}], readAt }; ids five_hour, seven_day, model:<Nome>, <n>m
- nomes de modelo: accounts.cliModels → readClaudeModels (supportedModels, sem "default") + readCodexModels (model/list); guardado em preferences "cliModels", stale-while-revalidate 1 h, falha tenta de novo em 5 min; listModels(secrets, cli) usa a lista quando existe
- failover (fase 2b, 2026-11-03): runtime.ts runTurn é um laço de rotas (primária + agents.failover ou chats.failover); troca só com EngineFailure e sem ação de escrita (onWrite do gateway); limit → accounts.hold (limited_until persistido), outros → skipped 10 min em memória; cada rota uma vez; todas falham → erro lista as tentativas
- EngineEvent ganhou `failure` no erro e o evento `limits` (uso da conta → accounts.observe); classificação: claudeParser (rate_limit_event, error das mensagens), codexFailure/usageOf (codexErrorInfo, account/rateLimits), classifyMessage (heurística)
- preferences (tabela chave/valor): failover_terms_accepted_at; GET /api/preferences, POST /api/preferences/failover-terms
- colunas JSON tipadas com text({ mode: "json" }).$type<...>() (sem JSON.parse manual)

- workspace (fase 3, 2026-11-03): workspace.ts (validate, cwdOf, snapshot/changes/diff/restore/files via git sombra em <dataDir>/workspaces/<projectId>.git, semáforo por projeto); runTurn tira árvore antes/depois → messages.changes/turn_id, turns.tree_before/after; GET /api/turns/:id/diff, POST /api/turns/:id/undo (409 UndoConflict), GET /api/projects/:id/files?chatId, RPC runs
- acesso por agente (workspace/ask/full): engines/policy.ts; Claude canUseTool + tools nativas; Codex sandbox/approvalPolicy + pedidos de aprovação → askApproval (cartão único para MCP e nativo); approvers por sessionKey
- vigia STALL_MS 10 min sem eventos (sem aprovação esperando) → erro unavailable + fecha a sessão
- Codex: skills da máquina desligadas via skills/list + skills/config/write no CODEX_HOME do Zorel; --disable skill_search --enable skip_host_skill_discovery

## avoid

- subir o server de teste com `nohup … &` no shell com sandbox: os filhos (CLI do Claude) morrem e o turno pendura; usar o modo de segundo plano da ferramenta
- constante de módulo em engines/codex.ts que lê algo de engines.ts (import circular): calcular dentro da função

- teste que chama os CLIs reais (contas) precisa de timeout maior que 5s

- Bun.$ para operação simples de arquivo (mkdir etc.): abre um shell; usar node:fs

- editar migration já aplicada: gerar outra com db:generate
- tirar o IF NOT EXISTS da linha de base: quebra a adoção de bancos do MVP

- Zod ou segundo lib de schema: só Effect Schema
- ler/guardar token OAuth das CLIs de assinatura: termos dos providers
- reaproveitar sessão nativa da CLI: quebra a troca de modelo e o contexto otimizado (decisão central)
- dar ferramentas às CLIs por fora do gateway: perde política e aprovação
- valores de segredo no banco: só nomes (envKeys); valores no chaveiro
- ordem da sidebar: projects.position e chats.position (null = ainda não posicionado: no topo, por recência); PUT /api/projects/order e /api/chats/order gravam a ordem do grupo; reorderChats só atualiza chats do mesmo projectId (nunca muda de projeto)
- audit log: audit.ts (Audit service, Actions via defineAuditAction do evlog, record(action, {target, before, after, reason, actor}); changed(before, after, keys) guarda só o que mudou); tabela audit_events com id próprio (a idempotencyKey do evlog colide para duas mudanças iguais no mesmo instante); GET /api/audit = últimas 500; aprovações gravadas em runtime.decide (HTTP e RPC passam por ali); chaves de API só pelo nome
- storage.ts: measure(dataDir, …) e clean(backups|orphans); GET /api/storage, POST /api/storage/clean/:id; NUNCA git gc nos workspaces (write-tree sem refs: o gc apagaria o histórico)
- Chat.preview (primeiros 140 caracteres da última mensagem, uma linha) e Chat.lastAt vêm do withMembers (db.ts) em toda leitura de chat
- contexto: buildTurn devolve parts (chars por parte); GET /api/chats/:id/context estima tokens (chars/4) + janela do modelo (Pricing.contextWindow, models.dev limit.context) + lastInputTokens real; skills citadas com $handle (contracts namedSkills/skillHandle) entram com o passo a passo no turno
- terminals.ts também é o painel de execução: scriptsOf/runLine (package.json scripts, nome validado por regex e contra a lista, gerenciador pelo lockfile) e serversIn (lsof LISTEN + lsof -d cwd dentro da pasta do chat). GET /api/chats/:id/scripts, /servers, DELETE /servers/:pid (só pid da lista). GET /api/terminals?run=nome abre a sessão já rodando o script; TerminalSession.label = nome do script
- git.ts: status (porcelain -b, base = origin/HEAD ou main/master, PR via `gh pr view`), commit (add -A), push (-u origin quando sem upstream), createPr (push + gh pr create), switchToNewBranch (check-ref-format). Rascunhos: commitDraftPrompt lê diff HEAD + arquivos novos sem tocar no índice; chat.ask(model, text) = uma pergunta sem ferramentas. Erros viram GitFailed (400) com a mensagem do git. Auditoria: git.committed/pushed/branched/pr_created (alvo = projeto)
- worktree por chat: chats.worktree (pasta em dataDir/worktrees/<projeto>/<chat>). projectFor(chat, project) em chat.ts troca project.path pela worktree; usado em runtime (cwd + checkpoints), prepare (contexto), terminals, files, commands e undo. O repositório sombra é o do projeto (árvores são conteúdo). A chave da sessão do motor inclui #cwd, então entrar/sair reabre a sessão. Entrar/sair recusa com turno rodando (runtime.busy); sair e apagar o chat só removem worktree limpa; addWorktree reusa a branch se já existe
- team.ts (fase 4): ferramentas próprias zorel_list_agents/zorel_read_agent (leitura livre) e zorel_create_agent/zorel_update_agent (sempre cartão de aprovação; auditado com actor agent). Visíveis = globais + do projeto do chat; agente por id ou @handle. Acesso do novo ≤ acesso de quem propõe (ask<workspace<full); update só estreita acesso. Modelo validado pelo provider (PROVIDERS); sem modelo herda o do chamador. Testes que listam ferramentas usam zorelOwn (browser_ ou zorel_)
- versões de agente: tabela agent_versions (n por agente, profile json, by "you" ou nome do agente). store.createAgent/updateAgent(…, by) gravam a versão (update só quando o perfil muda; agente antigo sem versões ganha v1 = estado anterior). GET /api/agents/:id/versions, POST /api/agents/:id/versions/:n/restore (auditado com reason). Export/import são do cliente (kind "zorel.agent", sem accountId)
- memória: consolidação numera o trecho (#n) e exige "evidence" com mensagem do usuário (parseConsolidation fromUser); "confirm" (m1…) chama store.confirmMemories; addMemory duplicada bumpa confirmedAt. Ferramenta zorel_search_memories (team.ts MEMORY_TOOL) busca nos scopesOf do chat. ARCHITECTURE §8 "Hoje" e §9.3 "Implementado" descrevem o estado real — manter atualizados a cada entrega (pedido do usuário)
- proteções do turno: runawayGuard (SAME_STEP_MAX=4, ERRORS_MAX=6) observa steps nativos (onStep) e do gateway (openTools onFinished) → Deferred runaway interrompe o stream, acc.error com o motivo, sem failover. STALL_MS=10min já existia
- rotinas: tabela routines; schedule.ts (croner nextRun, newToken, runText, createRoutineFor — sem runtime, usado pela API e pelo runtime); routines.ts (runRoutine com clientId routine:<id>:<key>, pula se runtime.busy; RoutineScheduler tick 30s no AppLive). API /api/routines (+/run) e /api/hooks/:token. Ferramenta zorel_routines (list/create/cancel com aprovação) em team.ts ROUTINES_TOOL
- Builder: team.ts BUILDER (instruções/título); POST /api/agents/builder {projectId, model} cria o agente global na 1ª vez (achado por título) e abre chat "Build agents". zorel_create_agent aceita agents[] (createInputs, MAX_TEAM 8) → um cartão só (texto com ## por agente)
- pausar: runtime.paused/setPaused (preferência "paused"; ensureWorker não inicia; setPaused(true) interrompe fibers rodando; false acorda queued); tick das rotinas pula. PUT /api/pause; Preferences.paused
- retomar no reset: chats.resume_at; runtime grava quando todas as rotas estão em limit (held reason limit) e o turno não agiu; routines.ts `resumes` no mesmo tick envia RESUME_TEXT (clientId resume:…) e limpa; send manual limpa; ChatPatch aceita resumeAt null
- editar daqui: POST /api/chats/:id/rewind (Conflict se runtime.busy; files → restore dos turnos posteriores do mais novo ao mais velho, UndoConflict para tudo; deleteMessagesFrom; zera resumo se summaryUntil >= corte; runtime.forget fecha sessões chatId:*)
- projects.default_agent_id (validado: global ou do projeto); home pré-seleciona. Responsabilidades = description do agente (decisão: sem campo novo)
- navegador: browser_hover/select/scroll/upload(root = cwd do chat)/dialog/run (stepOf mapeia passos; sem JS arbitrário); diálogos via page.on("dialog") → dismiss ou nextDialog, relatados em runBrowserTool. Perfis por agente: adiado (custo de processo)
- páginas (3b): tabelas pages/page_versions + FTS page_index (migração custom com gatilhos); store.savePage grava versão a cada mudança; pinnedPages → títulos no contexto estável (context.ts pageList). Ferramentas KNOWLEDGE_TOOLS em team.ts (search/read/write; escopo user pede aprovação). snippet() agora em context.ts. Fake engine do main.test aceita `tool:nome {json}`
- ACP (fase 5): engines/acp.ts, cliente JSON-RPC mínimo por stdio (sem copiar effect-acp); providers gemini-cli e opencode em PROVIDERS + mapa ACP de args; turno sem estado (prompt = system + transcript); permissão: allow_once salvo access "ask" (cancela e avisa); MCP HTTP "zorel" só se agentCapabilities.mcpCapabilities.http. Web: entriesOf mostra os dois com kind "agent" quando available
- ACP confinado (Seatbelt): engines/acp.ts commandFor/writableRoots/seatbeltProfile; access full = sem sandbox; workspace = cwd + git common dir + tmp/caches/state da CLI (ACP map `state`); ask = só tmp/caches/state; fora do macOS abaixo de full → erro. Testado ao vivo com opencode (escrita fora: Operation not permitted)
- permissões por agente (2026-11-04): agents.permissions JSON {web, browser, grants{serverId: none|read|write}, always[]}; regra pura server/permissions.ts (mcpRoute, browserRoute, accessChange, withAlways); runtime filtra MCP por grant, browser só se permitido, web vai aos engines (claude WebSearch/WebFetch, codex web_search live, acp fetch); approvals.always_key → decide("always") grava a regra no agente; ferramenta zorel_request_access (cartão) só para agentes
- skills (2026-11-04): SKILL_TOOLS em team.ts (zorel_read_skill, zorel_propose_skill com improves/reason/scope); memories.replaces/reason; memory_versions (updateMemory grava a anterior quando texto/título muda); PATCH state active numa pendente com replaces → applyImprovement (apaga a pendente, versão da antiga, texto novo na alvo); GET versions, POST restore {versionId}
- chave de API → OpenCode (2026-11-04): engines.run, provider kind api + turno com tools + opencode instalado → acpRun com opencodeEnv (OPENCODE_CONFIG_CONTENT, ZOREL_PROVIDER_KEY, desliga .claude/skills externas/config do projeto); ZOREL_API_ENGINE=direct força o motor direto (engines.test usa). Tokens vêm de session/prompt usage (OpenCode informa)
- skills de arquivo (2026-11-04): server/file-skills.ts (discover com dedupe por realpath e plugins na versão mais nova, cache 30 s, picked(pref "fileSkills"), asMemory, readSkill); GET/PATCH /api/skills/files (PATCH só aceita caminho da varredura); chat.ts junta as escolhidas à lista; zorel_read_skill lê o arquivo. Pref "nativeSkills": Claude ganha tool Skill + canUseTool permite; Codex sem skip_host_skill_discovery e reabilita as skills; runtime lê a pref por turno (chave estável #skills)
