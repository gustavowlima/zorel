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

## avoid

- Bun.$ para operação simples de arquivo (mkdir etc.): abre um shell; usar node:fs

- editar migration já aplicada: gerar outra com db:generate
- tirar o IF NOT EXISTS da linha de base: quebra a adoção de bancos do MVP

- Zod ou segundo lib de schema: só Effect Schema
- ler/guardar token OAuth das CLIs de assinatura: termos dos providers
- reaproveitar sessão nativa da CLI: quebra a troca de modelo e o contexto otimizado (decisão central)
- dar ferramentas às CLIs por fora do gateway: perde política e aprovação
- valores de segredo no banco: só nomes (envKeys); valores no chaveiro
