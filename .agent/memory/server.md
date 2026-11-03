# server
keywords: server, api, sqlite, db, engine, chat, context, memory, consolidation, mcp, tools, approval, channel, mention, secrets, skills
status: active
updated: 2026-11-03

## current

- main.ts: HttpApi (contracts) + SSE POST /api/chats/:id/send + serve apps/web/dist; start() exportado (usado pelo desktop); escuta só 127.0.0.1
- LocalOnly (middleware global): Host precisa ser localhost/127.0.0.1/::1 (DNS rebinding) e Origin, se houver, também local (CSRF); 403 caso contrário
- serviços: Store → Secrets → (Engines, Tools) + DataDir; testes trocam Secrets.layer por Secrets.memory()
- db.ts: migrations em array (nunca editar publicada); chat_members (ordem = position; primeiro é líder); messages.agent_id/steps; memories.kind fact|skill + title; índice FTS próprio memory_index (title + text); mcp_servers
- lista vazia em IN/NOT IN vira (''); NULL faria NOT IN filtrar tudo
- engines.ts: id "<provider>/<modelo>"; CLIs sem sessão nem ferramentas próprias, MCP só via gateway (claude --mcp-config + --allowedTools mcp__zero; codex -c mcp_servers.zero.*); API via effect/ai com loop de ferramentas até MAX_TOOL_STEPS
- tools.ts: Hub (clientes MCP stdio/http reaproveitados), Gateway (Bun.serve, sessão por turno com token), classify (anotação > nome; sensível vence leitura); modos read | approve | auto
- chat.ts: turno = mensagem do usuário → chain(mencionados || [líder]); cada resposta abre sessão de ferramentas, aprovações por Promise com timeout 10 min (recusa ao fechar o turno); grava parcial como "interrompido"; MAX_DEPTH 3 repasses
- consolidação recebe as esquecidas (forgottenMemories) e respeita MAX_PENDING 20 propostas pendentes por escopo
- memories() devolve também as esquecidas: a UI oferece Restaurar (via de volta)
- context.ts: camadas estável → volátil; outros agentes chegam como user "[Nome]"; skills: títulos de todas + corpo das 2 mais relevantes
- secrets.ts: Bun.secrets (service dev.zero.app); env tem precedência; variáveis MCP em "mcp:<id>" como JSON
- testes: main.test.ts (E2E: canal, MCP real via gateway com aprovação, skills, chaves), engines.test.ts (parsers, args, contexto, menções, política, API com tool loop contra mock), db.test.ts (FTS, migração 2→3)

- contrato de turnos em packages/contracts/src/events.ts (import "@zero/contracts/events", não reexportado no index para evitar import circular): Turn, WorkStep, Approval, ChatStatus, ChatEvent (TaggedUnion por _tag), ZeroRpc (send, steer, interrupt, decide, subscribeChat, subscribeStatus)
- WorkStep é a fonte da pílula de atividade: kind read/edit/run/search/tool/delegate, título curto, arquivos, duração, mudanças por arquivo; status waiting = aprovação pendente

- banco: Drizzle 1.0.0-rc.5 (drizzle-orm/effect-sqlite-bun) + @effect/sql-sqlite-bun 4.1.2; schema em src/schema.ts, migrations em apps/server/drizzle (drizzle-kit generate, script db:generate)
- repositório (db.ts) devolve Effect em todo método; erro de banco vira defeito (orDie); chamadores usam yield*; código async (gateway MCP) usa Effect.runPromise
- PRAGMA foreign_keys = ON é ligado ao abrir (cascatas dependem disso); FTS5 memory_index + gatilhos ficam na migration à mão (Drizzle não modela)
- migrate.ts: antes de abrir, se houver migration pendente, faz backup (VACUUM INTO ~/.zero/backups/zero-<ts>.db); banco do MVP (sem __drizzle_migrations) sobe para user_version 3 com LEGACY_MIGRATIONS e a linha de base (IF NOT EXISTS) o adota sem cópia
- desktop: prebuild copia apps/server/drizzle e define ZERO_MIGRATIONS (migrationsDir() lido na hora, não no import)

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
- backup: antes de migration pendente e um por dia; mantém os 7 mais novos em ~/.zero/backups

- sessões nativas (fase 2): Engines.open(model, system estável, cwd) → EngineSession (engines/session.ts); hoje só claude-cli (engines/claude-sdk.ts, Agent SDK 0.3.317 com o `claude` instalado); runtime guarda uma por (chat, agente), marcação `seen` = at da última mensagem que a sessão tem; turno manda <context>dinâmico</context> + transcript só do que é novo; reabre se o contexto estável, provider ou sessão morta mudar; máx. 8 sessões (LRU)
- buildTurn devolve system (estável + dinâmico, para engines sem sessão), stable e dynamic; mensagens do turno levam `at`

- Codex: engines/codex.ts, cliente JSON-RPC mínimo (D16 revisada); CODEX_HOME = <dataDir>/accounts/codex-default (isola config.toml do usuário: -c mcp_servers={} NÃO remove os servidores dele); account/read antes da thread → sem login, erro com `CODEX_HOME=… codex login`; pedidos de aprovação do Codex são recusados (sandbox read-only, shell off, ações só pelo gateway); teste contra engines/fixtures/fake-codex-app-server.ts
- sessões nativas usam URL fixa do gateway (GatewayHandle.update troca as ferramentas por turno); nomes das ferramentas entram na chave do contexto estável (lista nova = sessão nova); Engines.hasSession decide
- smoke contra o server: script precisa rodar de dentro de apps/server (bun --no-install), senão o Bun instala outro effect e o RPC trava

- contas (§6.1): accounts.ts (serviço Accounts) + tabela provider_accounts; padrão claude-default (home null = login da CLI) e codex-default (home Zero); extra = <dataDir>/accounts/<id>; status pela CLI (claude auth status --json, codex login status) com cache de 30 s; login roda a CLI e devolve a URL se impressa; remover = logout + apaga a pasta (só pastas do Zero) + agentes/chats voltam à padrão
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
- Codex: skills da máquina desligadas via skills/list + skills/config/write no CODEX_HOME do Zero; --disable skill_search --enable skip_host_skill_discovery

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
