# Referências: o que foi aproveitado e o que não foi

Mapa de rastreabilidade. Para cada boa prática das três referências estudadas, diz onde ela está aplicada no Zero, com o arquivo e o teste que a cobre, ou por que ficou de fora. Atualize ao mudar a decisão.

Licenças: Tucano é Apache-2.0 e o código derivado tem atribuição no `NOTICE`. T3 Code é MIT, e dele vieram ideias de arquitetura, não código. OpenBot é PolyForm Noncommercial: **só ideias, nenhum código**.

## Tucano

| Prática | No Zero | Verificação |
|---|---|---|
| CLI sem sessão: o contexto é montado pelo app a cada turno | `engines.ts` (`--no-session-persistence`, `--ephemeral`), `context.ts` | `engines.test.ts` (args), turno real com 658 tokens de entrada |
| CLI isolada: sem ferramentas próprias, sem config, hooks ou plugins do usuário | `claudeArgs`, `codexArgs` | `engines.test.ts` |
| Resumo contínuo: janela de 30 mensagens literais, consolida acima de 50 | `context.ts` (`WINDOW`, `MAX_AFTER`), `chat.ts` (`consolidate`) | `main.test.ts` |
| Memórias com escopo e aprovação humana | `db.ts` (state pending/active/forgotten), `memories.tsx` | `main.test.ts` |
| Orçamento de memórias no prompt e o resto buscável (BM25) | `pinned()`, `searchMemories` (FTS5) | `engines.test.ts`, `db.test.ts` |
| Consolidação recebe o que foi esquecido | `consolidationPrompt` (`forgotten`) | `main.test.ts` (aprendizado) |
| Teto de propostas pendentes | `chat.ts` (`MAX_PENDING`) | `main.test.ts` (aprendizado) |
| Skills propostas pelo agente e aprovadas | `parseConsolidation` (skills), `memory_index` | `main.test.ts`, `engines.test.ts` |
| @menção e repasse com limite de profundidade | `mentioned()`, `chain()`, `MAX_DEPTH` | `main.test.ts` (canal), teste real Claude → Codex |
| Gateway MCP por turno com URL secreta, única fonte de ferramentas | `tools.ts` (`Gateway`) | `main.test.ts`, teste real com Claude e Codex |
| Classificação de ferramentas: anotação > nome, sensível vence leitura | `classify()` | `engines.test.ts` |
| Aprovação da chamada exata e recusa devolvida ao modelo | `openTools()` em `chat.ts` | `main.test.ts`, teste real |
| Resultado de ferramenta truncado | `MAX_RESULT_CHARS` | — |
| Segredos no chaveiro do sistema | `secrets.ts` (`Bun.secrets`) | `main.test.ts` (chaves, com o armazenamento em memória) |
| PATH do shell de login no app desktop | `apps/desktop/src/bun/index.ts` | `.app` real encontrou `claude` e `codex` |
| **Fora:** router por LLM quando ninguém é mencionado | quem responde é o líder (★) | Decisão: custo e latência a cada mensagem. O OpenBot também começa pelo líder. Adicionar se os canais crescerem. |
| **Fora:** limites de tokens por agente, "pausar tudo", rotinas, horário de silêncio | tokens já são gravados por mensagem | Não pedidos. Os dados para limites já existem (`input_tokens`/`output_tokens`). |
| **Fora:** "sempre permitir" uma ferramenta | o modo do servidor (`auto`) cobre o caso | — |

## T3 Code

| Prática | No Zero | Verificação |
|---|---|---|
| Contrato único com Effect Schema; server e clientes seguem o schema | `packages/contracts` + `HttpApiClient` no web | `tsc` nos dois lados, 400 na fronteira (`main.test.ts`) |
| Effect services e Layers, com teste trocando a implementação | `Store`, `Secrets`, `Engines`, `Tools`, `DataDir` | `main.test.ts` (Secrets.memory, engine falso) |
| "Toda entrada tem saída" (reverse states) | apagar projeto/agente/chat/servidor; esquecer → **restaurar** memória; desligar → ligar servidor | `main.test.ts` (aprendizado) |
| Não fixar origens no bundle | o web usa `location.origin` e o proxy do Vite | — |
| Single origin em produção | o server serve `apps/web/dist` (`WebRoute`) | `.app` estável testado |
| Troca de provider sem perder contexto | trivial: contexto é do Zero, não da sessão | `main.test.ts` (troca), teste real Claude → Codex |
| **Fora:** checkpoints de git, worktrees, mobile, túnel remoto, integrações de source control | — | Foco em coding remoto. Fora do escopo do Zero. |
| **Fora:** compactação antes do cache expirar | — | Não se aplica: não há sessão nativa para compactar. |

## OpenBot (só ideias)

| Prática | No Zero | Verificação |
|---|---|---|
| Fronteira de confiança estrita no server local | `LocalOnly`: Host local contra DNS rebinding, Origin local contra CSRF; escuta só 127.0.0.1 | `main.test.ts` (só local) |
| Segredo nunca em arquivo nem log; redigido | valores no chaveiro; `envKeys` guarda só nomes; chaves nunca voltam na API | `main.test.ts` (chaves) |
| Um único sistema de schema | só Effect Schema (o OpenBot sofre com Zod + Effect Schema) | — |
| Linter no CI | Biome (`biome.json`, `bun run lint` no CI) | CI |
| Memória em duas camadas: essencial no prompt, resto buscável | `pinned()` + FTS5 | `engines.test.ts`, `db.test.ts` |
| Gatilhos de revisão de memória | consolidação por janela cheia ou manual (Compactar) | `main.test.ts` |
| Mensagem salva mesmo se o turno é interrompido | `reply()` → `onExit` grava como "interrompido" | — |
| Detecção de Ollama / LM Studio local | `probe()` em `engines.ts` | teste com mock compatível com OpenAI |
| Assinatura de CLI de assinatura: nunca tocar no login | só a CLI oficial; nada de OAuth | — |
| **Fora:** event sourcing com recibos idempotentes | a trava por chat (`Busy`, 409) evita turnos duplicados; tabelas simples | Adicionar se houver vários processos ou sincronização entre dispositivos. |
| **Fora:** fila FIFO com recuperação após crash | — | Hoje um turno por chat, síncrono com o cliente. Necessário quando houver rotinas e agentes em background. |
| **Fora:** lista de modelos de backup | — | Adicionar se as falhas de provider aparecerem no uso. |

## Outras referências avaliadas

| Projeto | Licença | O que veio para o Zero | O que não veio |
|---|---|---|---|
| [Zeron](https://github.com/zeronsh/zeron) (Rust) | MIT | Marcação "até onde cada sessão leu" por provider: na troca, só o delta é reenviado (ARCHITECTURE §7). Server do desktop em background separado da janela (D11) | Sincronização por CRDT e relay; interface em gpui |
| [ai-memory](https://github.com/akitaonrails/ai-memory) (Rust) | MIT | Handoff tipado oferecido, não consumido; retenção por uso sem LLM; contexto L0/L1; limpeza de segredos; versões; avaliação de recall (§8, memória 2) | Markdown em git como fonte da verdade; captura por hooks; servidor multiusuário |
| [AgenticOS](https://github.com/vstorm-co/agenticos) (Python) | Apache-2.0 | Agente como dado versionado com referências; construtor com teste e agente que rascunha agentes para aprovação; caixa de ferramentas por agente; escopo de memória por dono e público (fase 4, D17). Backlog: detector de loop, monitor de cache, revisor durante o run, auditoria encadeada | FastAPI, Pydantic AI, Postgres + pgvector + Redis; modelo multiempresa (fase 8 decide o que trazer) |
| [T3 Code](https://github.com/pingdotgg/t3code) | MIT | `effect-acp` e `effect-codex-app-server` copiados (D16); RPC sobre WebSocket e átomos no front (D3, D4); multicontas com pasta de login por conta (D14) | Fork completo (D16: Node, Electron, ~600 mil linhas, sem i18n) |

**Descartados como dependência**, com o motivo na decisão citada:
- **Mastra e LangGraph** (D5): dois runtimes, estado e memória duplicados, Zod.
- **oRPC** (D1): integração experimental com Effect.
- **Zod** (D2).
- **`@effect/sql-drizzle`** (D9): só Effect 3. Usamos o `drizzle-orm` 1.0, que integra nativamente com o Effect 4.
