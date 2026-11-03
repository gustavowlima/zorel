2026-11-02 | adicionados agentes, chats, mensagens, memórias (FTS5), engines CLI/API, contexto em camadas, consolidação | MVP
2026-11-02 | canais (chat_members, @menção, repasse até 3), skills (memories.kind), MCP (hub + gateway + aprovação), chaves no chaveiro (Bun.secrets), índice FTS próprio com título | pedido "implemente tudo"
2026-11-03 | guarda LocalOnly (Host\/Origin), esquecidas na consolidação + teto de pendentes, restaurar memória | auditoria de boas práticas das referências
2026-11-03 | D5 revista: API key vira credencial de harness (Claude SDK, Codex, OpenCode ACP); effect/ai só interno | loop próprio sobre effect/ai é fraco frente a harnesses como OpenCode
2026-11-03 | API key de qualquer provider (inclusive Anthropic/OpenAI) → OpenCode; assinatura → harness do dono | um caminho só para chaves, comportamento igual entre modelos
2026-11-03 | failover automático de conta\/modelo passa a ser suportado, opcional e com aviso de termos (fase 2b) | pedido do usuário; antes era só troca manual
2026-11-03 | banco: bun:sqlite direto → Drizzle 1.0 rc sobre @effect/sql (fase 1) | integração nativa Effect 4, portabilidade SQLite→Postgres, migrations geradas
2026-11-03 | driver local: @effect/sql-sqlite-bun → @effect/sql-libsql; RAG entra no desenho (D18) | vetores nativos sem extensão; pedido do usuário
2026-11-03 | memórias+skills → páginas de conhecimento aprendido; RAG por upload e libSQL saem; driver volta a sqlite-bun | pedido: leve, simples, eficiente; base de conhecimento = aprendizado (ai-memory)
2026-11-03 | base headless do shadcn: React Aria (--base aria), não Radix nem Base UI | decisão do usuário; a11y e i18n embutidos
2026-11-03 | contrato de eventos dos turnos (events.ts) e subscribeStatus | engine primeiro; protótipo vira especificação dos eventos
2026-11-03 | banco migrado para Drizzle (effect-sqlite-bun), repositório em Effect, adoção do banco do MVP com backup | D9, fase 1
2026-11-03 | runtime de turnos (fila no banco, RPC WebSocket, recuperação no boot); SSE removido | fase 1, ARCHITECTURE §5
2026-11-03 | fecho da fase 1: logs mascarados + spans, Actor e dono/público nas memórias, primeiro token, erros como código, backup diário com 7 | ARCHITECTURE §12, §13
2026-11-03 | comentários passam a ser em inglês | pedido do usuário
2026-11-03 | sessão nativa do Claude (Agent SDK) com marcação por sessão | fase 2, etapa 1
2026-11-03 | sessão nativa do Codex (cliente mínimo, CODEX_HOME isolado); D16 revisada | fase 2, etapa 2
2026-11-03 | multicontas: provider_accounts, conta por chat/agente, login/status pela CLI | fase 2, etapa 4
2026-11-03 | steering real no Codex, nível de raciocínio, tokens de cache por turno | fase 2, etapa 5
2026-11-03 | anexos e imagens; sessão por provider (volta ao Claude manda só o delta); fase 2 concluída | §12, §13
2026-11-03 | GET /api/usage e RPC approvals | telas Usage e Needs you
2026-11-03 | failover por agente/chat, espera por limite, leitura de uso por conta | fase 2b
2026-11-03 | workspace com git sombra, acesso por agente, ferramentas nativas, diff/desfazer, vigia de turno | fase 3
2026-11-03 | consumo (custo, janelas de limite) e nomes reais dos modelos das CLIs | fase 2c
2026-11-03 | position em projects e chats + endpoints de reordenação | drag and drop na sidebar
2026-11-03 | audit log com evlog gravando em SQLite | pedido do usuário
2026-11-03 | endpoint de contexto, janela no catálogo, $skill no turno | composer novo
