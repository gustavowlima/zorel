# server
keywords: server, api, sqlite, db, engine, chat, context, memory, consolidation, mcp, tools, approval, channel, mention, secrets, skills
status: active
updated: 2026-11-02

## current

- main.ts: HttpApi (contracts) + SSE POST /api/chats/:id/send + serve apps/web/dist; start() exportado (usado pelo desktop); escuta só 127.0.0.1
- serviços: Store → Secrets → (Engines, Tools) + DataDir; testes trocam Secrets.layer por Secrets.memory()
- db.ts: migrations em array (nunca editar publicada); chat_members (ordem = position; primeiro é líder); messages.agent_id/steps; memories.kind fact|skill + title; índice FTS próprio memory_index (title + text); mcp_servers
- lista vazia em IN/NOT IN vira (''); NULL faria NOT IN filtrar tudo
- engines.ts: id "<provider>/<modelo>"; CLIs sem sessão nem ferramentas próprias, MCP só via gateway (claude --mcp-config + --allowedTools mcp__zero; codex -c mcp_servers.zero.*); API via effect/ai com loop de ferramentas até MAX_TOOL_STEPS
- tools.ts: Hub (clientes MCP stdio/http reaproveitados), Gateway (Bun.serve, sessão por turno com token), classify (anotação > nome; sensível vence leitura); modos read | approve | auto
- chat.ts: turno = mensagem do usuário → chain(mencionados || [líder]); cada resposta abre sessão de ferramentas, aprovações por Promise com timeout 10 min (recusa ao fechar o turno); grava parcial como "interrompido"; MAX_DEPTH 3 repasses
- context.ts: camadas estável → volátil; outros agentes chegam como user "[Nome]"; skills: títulos de todas + corpo das 2 mais relevantes
- secrets.ts: Bun.secrets (service dev.zero.app); env tem precedência; variáveis MCP em "mcp:<id>" como JSON
- testes: main.test.ts (E2E: canal, MCP real via gateway com aprovação, skills, chaves), engines.test.ts (parsers, args, contexto, menções, política, API com tool loop contra mock), db.test.ts (FTS, migração 2→3)

## avoid

- Zod ou segundo lib de schema: só Effect Schema
- ler/guardar token OAuth das CLIs de assinatura: termos dos providers
- reaproveitar sessão nativa da CLI: quebra a troca de modelo e o contexto otimizado (decisão central)
- dar ferramentas às CLIs por fora do gateway: perde política e aprovação
- valores de segredo no banco: só nomes (envKeys); valores no chaveiro
