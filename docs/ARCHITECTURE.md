# Arquitetura do Zorel

Este documento registra o estado atual, a arquitetura alvo e as decisões tomadas, com o motivo e as alternativas descartadas.

Ele vem antes do código: ao mudar uma decisão, atualize aqui e em `.agent/memory/`. Para saber de onde veio cada prática (a reference app, T3 Code, a reference app, Zeron, ai-memory), consulte [references.md](references.md).

Revisado em 2026-11-04.

**Processos em segundo plano (2026-11-04):** Settings › Processes e o botão do cabeçalho do chat leem `GET /api/processes`: servidores escutando portas dentro da pasta de algum chat (um `lsof` para todas as pastas; a pasta do projeto é de todos os chats dele, uma worktree é de um), terminais vivos, sessões de engine guardadas entre turnos e conexões MCP abertas. Parar um servidor só aceita um pid dessa lista (nunca um processo qualquer); fechar uma sessão nunca acontece sob um turno rodando. Os turnos rodando vêm dos status ao vivo que o web já recebe.

**Windows, macOS e Linux (2026-11-04, regra do usuário: todo recurso nos três):** o terminal abre o PowerShell no Windows (`pwsh` quando instalado) e o `$SHELL` como login shell nos outros; o binário do server sai `zorel-server.exe` no Windows e o empacotamento leva os dois nomes; agentes ACP abaixo de "Acesso total" rodam confinados no Seatbelt (macOS) ou no bubblewrap (Linux, quando instalado: o sistema todo só leitura e as mesmas pastas graváveis), testado de verdade num container; no Windows ainda não há sandbox equivalente e o turno é recusado com a explicação. O CI tem um job por sistema para o que depende dele (processos, terminal, sandbox) e gera o app para os três (dmg/zip, instalador do Windows, AppImage); o certificado Developer ID só entra no job de macOS. O repositório ainda não tem remote, então o CI não rodou.

**Consumo em tempo real e os três sistemas (2026-11-04):** `server/procs.ts` lê a tabela de processos no Windows (um PowerShell aberto durante a vida do server, consultado a cada leitura: `Get-CimInstance Win32_Process`), no Linux (`/proc`, sem processo novo) e no macOS (`ps`), as portas em escuta (`netstat`, `ss`, `lsof`) e a pasta de trabalho onde o sistema diz (Linux e macOS). A CPU sai da diferença do tempo de CPU entre duas leituras (100% = um núcleo). A árvore do Zorel parte do app desktop (`ZOREL_PARENT_PID`) ou do server e soma tudo o que eles iniciaram; cada linha conta o próprio processo e os filhos, e as partes não se repetem (sessões de agente, terminais, conexões, servidor, outros, app). Um servidor pertence a um chat pela pasta (Linux e macOS) ou por ter nascido de um terminal ou sessão do chat (os três; é como o Windows os acha). O pid das sessões vem do próprio engine (Claude: `spawnClaudeCodeProcess` igual ao do SDK; Codex: o app-server; MCP local: o transporte). Os parsers têm testes com saída de exemplo de cada sistema; o Linux foi rodado de verdade num container; o Windows só pelos testes.

**Mudar de computador (2026-11-04, fase 7):** Settings › Storage › "Move to another computer". Exportar (`GET /api/workspace/export`) gera um `.tar.gz` (`Bun.Archive`, sem dependência) com uma cópia consistente do banco (`VACUUM INTO`), os anexos e um manifesto com a pasta de origem. Importar (`POST /api/workspace/import`) confere o arquivo (manifesto e tabelas do Zorel), guarda como `import-pending.tar.gz` e aplica na próxima inicialização, antes de o banco abrir: banco e anexos atuais vão para `backups/before-import-<data>/`, os importados entram no lugar e os caminhos dos anexos são reescritos para a pasta nova (desembrulhado dentro da pasta de dados, para não mover arquivos entre discos). Não viajam: segredos do keychain (chaves de API, logins de conectores), logins das CLIs (`accounts/`), pontos de restauração (`workspaces/`), perfis do navegador e backups. `server/transfer.ts`, com teste de ida e volta.

**Idioma dos prompts (2026-11-04):** tudo o que vai ao modelo (prompt base, consolidação, resultados de ferramentas, erros dos engines) é em inglês, e nada manda responder num idioma: o modelo segue o idioma de quem escreve.

**Nome (2026-11-04):** o projeto se chamava **Zero** e passou a **Zorel** ("Zero" colidia com outros produtos e não tinha domínio; zorel.dev é do autor). O que já existia continua funcionando: a pasta `~/.zero` (com `zero.db`) segue em uso quando existe e `~/.zorel` não, sem ser movida, porque o banco guarda caminhos absolutos de anexos e contas; segredos do keychain são lidos do serviço antigo `dev.zero.app` e copiados para `dev.zorel.app`; preferências `zero.*` do navegador são copiadas para `zorel.*`; backups `zero-*.db` continuam sendo podados; agentes exportados como `zero.agent` ainda são importados. O app desktop muda de appId (`dev.zorel.app`), então a pasta de dados do Electron é nova (logins das abas dos agentes recomeçam).

**Propósito:** o Zorel é, **agora**, uma plataforma de agentes **para código**: desktop e web local, projetos, equipe de agentes, memória e contexto próprios. **Depois**, evolui para **hospedado e automação**, sem reescrever, porque as portas para isso ficam abertas desde já (D17).

---

## 1. Decisões

| # | Decisão | Por quê | Descartado |
|---|---|---|---|
| D0 | **Leve primeiro**: um processo, um arquivo de banco, **nenhum serviço externo obrigatório** (nada de Qdrant, Ollama, Redis ou mem0 para funcionar). Cada recurso começa no mínimo útil e só cresce quando uma medição (latência, recall, custo) mostra que precisa; o resto vai para o backlog com critério de entrada | Pedido explícito: simples, leve e eficiente. Menos peças = menos falhas e instalação trivial (desktop e, depois, hospedado) | Recursos completos desde o início (tiers, grafo, RAG de documentos, várias fontes): mais código e mais dependências antes de provar valor |
| D1 | **Effect de ponta a ponta**: server, contrato e front | Um schema, um modelo de erro, um modelo de stream, do banco até o componente. É a mesma escolha do T3 Code, que tem ~490 átomos no front e usa `effect/rpc` em web, desktop e mobile | **oRPC**: a integração com Effect é experimental, traduz erros e streams nas duas pontas e não tem referência desse porte. **tRPC/Hono**: abandonaria o `HttpApi` |
| D2 | **Effect Schema**, sem Zod | O `HttpApi`/`effect/rpc` geram validação, codificação, erros e client a partir dele. É bidirecional | Zod. Ele só entra como dependência interna do Claude Agent SDK, restrito ao adaptador do Claude |
| D3 | **Transporte**: `HttpApi` para o CRUD; `effect/rpc` sobre WebSocket para turnos e eventos | O turno sai da requisição HTTP. Comandos e assinatura ficam separados | SSE preso ao `POST` (o modelo atual). oRPC |
| D4 | **Front com átomos** (`effect/reactivity` + `@effect/atom-react`): `AtomHttpApi` no CRUD, `AtomRpc` no chat | Cache, stale-while-revalidate, invalidação por chave e otimismo, gerados do mesmo contrato | TanStack Query. Exigiria oRPC ou um client paralelo |
| D5 | **Harness primeiro, com uma regra por credencial**. **Assinatura → harness do dono**: Claude Agent SDK, Codex App Server ou ACP da CLI. **API key → OpenCode via ACP, para todos os providers**, inclusive Anthropic e OpenAI. O `effect/ai` fica só para tarefas internas (consolidação, títulos, roteamento, revisão de memória) e para a conversa rápida sem workspace | Sessão viva, steering, interrupção e troca de modelo ao vivo, com ferramentas de código maduras (arquivos, shell, edição, LSP, compactação, permissões). No modo chave há um só caminho: injeção de credenciais, catálogo de modelos (models.dev) e permissões, com o mesmo comportamento ao trocar entre modelos. Os adaptadores de assinatura não precisam tratar chave. É o desenho de a reference app, T3 Code e Zeron. **Custo aceito:** os modelos da Anthropic e da OpenAI podem render um pouco menos no OpenCode do que nos harnesses dos donos. A medição por turno decide se algum provider ganha rota nativa | `claude -p` / `codex exec` por turno (3–7 s por turno, perde o trabalho entre turnos). Loop de ferramentas próprio sobre `effect/ai` para agentes com API key (reinventaria um harness, pior). ACP também para Claude/Codex (fica atrás do nativo). Mastra/LangGraph (dois runtimes, estado e memória duplicados, Zod) |
| D6 | **Contexto híbrido**: sessão nativa quando o engine permite, com o **contexto em camadas do Zorel como ponto de retomada** | Mantém o diferencial (contexto curado, memórias aprovadas, troca livre de modelo) e ganha latência, cache e continuidade das ferramentas | Só sessão nativa (perde o controle do contexto; handoff cru de 32k como no a reference app). Só sem sessão (custo de processo por turno; perde o trabalho entre turnos) |
| D7 | **Aprendizado contínuo com controle**: o Zorel aprende sozinho enquanto trabalha (D18). **O conhecimento do projeto entra direto**, com histórico de versões, desfazer e um feed "o que o Zorel aprendeu". **O que é sobre você** (preferências, jeito de trabalhar, que vale em todos os projetos) **passa pela sua aprovação** | Aprovar cada página de conhecimento vira trabalho demais em aprendizado contínuo; versão + desfazer + feed dão controle com custo baixo (como o ai-memory). O que é pessoal e atravessa projetos continua sob aprovação | Aprovar tudo (trava o aprendizado). Gravar tudo sem revisão nem histórico (a reference app) |
| D8 | **Ferramentas só pelo gateway do Zorel** | Política e aprovação valem para todo engine | Ferramentas configuradas direto em cada CLI |
| D9 | **Drizzle ORM 1.0 (rc, versão fixada) sobre `@effect/sql`**: **`@effect/sql-sqlite-bun`** (o SQLite do próprio Bun) agora e `@effect/sql-pg` quando hospedado. Tabelas simples, mais recibos idempotentes onde há retentativa. Migrations geradas pelo `drizzle-kit`. FTS5 e triggers em SQL puro (`sql`). Tipos do repositório derivados por `drizzle-orm/effect-schema`; **o contrato da API continua separado das tabelas** | Consultas tipadas e schema em TypeScript sem sair do Effect: o Drizzle roda sobre o cliente do `@effect/sql`, então erros, transações e traces continuam no Effect. Trocar de banco é trocar o driver do Effect. Integração nativa com Effect 4 a partir do `drizzle-orm@1.0.0-beta.24`; no `rc.5`, com os drivers `sqlite-bun`, `pg` e outros. O SQLite do Bun não exige módulo nativo extra (D0) | `bun:sqlite` direto (o estado atual: tudo à mão, sem portabilidade). libSQL (vetores nativos): só se justificava com RAG de documentos, que saiu do escopo (D18); se embeddings vierem a ser necessários, começam por força bruta no próprio SQLite. `@effect/sql-drizzle` (só Effect 3). Event sourcing completo (a reference app, T3 Code): só com sincronização entre dispositivos. **Risco aceito:** a 1.0 ainda é release candidate, e o schema é por banco (`sqliteTable` → `pgTable` exige portar uma vez ao hospedar) |
| D10 | **Rotinas e fluxos duráveis com `effect/workflow`** (fase futura) | Já está no pacote `effect` | LangGraph, Temporal |
| D11 | **Desktop com Electron** (decidido em 2026-11-04; antes Electrobun). O processo principal (Node) só cuida da janela e do navegador nativo; **o server continua Bun**, compilado num binário (`bun build --compile`) e iniciado pelo Electron como **processo separado**: fechar a janela não para turnos nem rotinas, e a janela só se conecta (como o Zeron faz). O navegador dos agentes no desktop são `WebContentsView` nativas que o server controla por CDP (Playwright `connectOverCDP` na porta de depuração do Electron, só nos alvos das abas); na web, o mesmo serviço usa um Chrome sem janela e o painel transmite quadros | Navegador nativo dentro do app com controle por CDP, como o a reference app: página de verdade na janela (rolagem e digitação instantâneas), as mesmas ferramentas `browser_*` nos dois casos. O WKWebView do Electrobun não fala CDP, e o CEF do Electrobun pesa tanto quanto o Electron sem o ecossistema | Electrobun (sem CDP no WebKit; CEF como opção pesada). Server dentro do processo principal (exigiria portar o server do Bun para Node e morre com a janela). **Custo aceito:** dois runtimes no app (Node do Electron + o binário do server) **Hoje (2026-11-04):** shell feito — `apps/desktop` em Electron 45, server como processo filho (binário compilado no pacote, `bun` em dev), janela fechada mantém app e server, watchdog do pai no server, tray fora do macOS, ~215 MB Electron + ~80 MB server. **Navegador nativo (2026-11-04):** o Electron recusa `Target.createTarget`, então o processo principal cria as abas (`WebContentsView`) a pedido do server por um endpoint local com token, e o server as adota pelo CDP (porta livre em 127.0.0.1, lida de `DevToolsActivePort`). Uma partição `persist:agent-<id>` por agente (logins próprios, `you` para abas abertas pela pessoa); permissões negadas, downloads bloqueados, popups na mesma aba, sem preload nas abas, no máximo 24 vivas. As views moram numa janela oculta (o agente navega com a janela fechada) e o painel as empresta no seu retângulo pelo preload (`window.zorelDesktop`). "Assumir": uma camada transparente por cima recebe o clique humano (o input por CDP vai direto à página e também dispara os eventos de mouse do Electron, por isso não dá para distinguir de outro jeito). Na web segue o Chrome sem janela com perfil único **Distribuição (2026-11-04):** "Open Zorel when you log in" em Settings › General (só no desktop; aberto pelo login sobe sem janela, `wasOpenedAtLogin` no macOS, `--hidden` no Windows); atualização automática com `electron-updater` (GitHub Releases; confere ao abrir e a cada 6 h, instala ao sair; destino em `ZOREL_RELEASE_OWNER`/`ZOREL_RELEASE_REPO`); job `release` no CI por tag `v*`. Falta só o certificado Developer ID (segredos `CSC_LINK`…): sem ele o macOS não roda nem atualiza o app empacotado |
| D12 | **Licença Apache-2.0**. Código derivado só de projetos MIT/Apache, com `NOTICE` | — | Código do a reference app (PolyForm Noncommercial) |
| D13 | **i18n desde já, com inglês como único idioma por enquanto**. Todo texto visível ao usuário sai de um catálogo tipado (`packages/i18n`). O inglês é a fonte da verdade, e um idioma novo só entra completo | Adicionar idiomas depois vira só traduzir, sem caçar texto no código. Chave faltando não compila | Texto fixo nos componentes (o estado atual, em português). Libs pesadas (i18next, FormatJS) enquanto houver um só idioma: `Intl` cobre plural, datas e números |
| D14 | **Multicontas por provider**: cada conta é um registro com credencial isolada (pasta de login própria da CLI para assinaturas; chave própria no chaveiro para API keys). Agente e chat escolhem a conta. Trocar de conta funciona como trocar de provider (o ponto de retomada entra na sessão nova). **Troca automática (failover) opcional**: lista ordenada de alternativas por agente/chat, acionada por limite ou erro do provider, **ligada só por escolha explícita** e com aviso de termos para assinaturas | Separar conta de trabalho e pessoal e dividir limites é um pedido comum, e a troca automática evita parar o trabalho no meio. T3 Code e a reference app suportam multicontas, e o a reference app faz o failover automático. Com o nosso contexto, a troca não precisa do "shadow home" do T3 Code e pode ir até para outro provider | Failover ligado por padrão: alternar contas de assinatura para contornar limite pode violar os termos dos providers (o T3 Code recusa por isso), então o risco precisa ser assumido explicitamente pelo usuário. Pool com rodízio de contas no Zorel: fica com proxy externo |
| D15 | **Área de consumo**: tokens, custo estimado e tempo por turno, agregados por agente, projeto, conta e modelo, mais as janelas de limite de cada assinatura e alertas configuráveis | Saber quanto cada agente e projeto consome, quanto falta da assinatura e quando ela reseta. É a base do failover e da decisão de rota nativa vs OpenCode. a reference app e a reference app têm | Só tokens por mensagem (o estado atual). Bloqueio rígido por orçamento sem aviso prévio |
| D16 | **Projeto próprio, sem fork do T3 Code**. Do T3 Code (MIT) **copiamos** `packages/effect-acp`, com atribuição no `NOTICE`. **Revisado em 2026-11-03:** o `effect-codex-app-server` não é copiado (cerca de 61 mil linhas, quase todas schema gerado do protocolo inteiro); o Zorel tem um cliente mínimo próprio (`engines/codex.ts`) só com os métodos e campos que usa, como o a reference app faz (só ideia), e usa o pacote do T3 Code como referência do protocolo. Os adaptadores do Claude e do OpenCode, os leitores de uso e o padrão de átomos e RPC servem de **referência** | O diferencial do Zorel (contexto, memória, equipe) fica no centro do desenho, e não enxertado em 94 mil linhas de orquestração. O trabalho de código é feito pelos harnesses, então a interface de código que precisamos é moderada. O server em Bun é enxuto e vira binário único para hospedar | Fork rígido do T3 Code: traria git, terminal e acesso remoto prontos, mas também Node + pnpm + Electron, ~600 mil linhas para manter e nenhum i18n. **Critério para rever:** se a experiência completa de git dele (worktrees, PRs, revisão, terminal) virar prioridade de curto prazo |
| D17 | **Portas abertas para hospedar**, sem construir a hospedagem agora: (1) toda requisição resolve um `Actor` (hoje, sempre o dono local; `LocalOnly` vira uma forma de acesso); (2) banco via `@effect/sql` + Drizzle (D9); (3) segredos só pelo serviço `Secrets` (chaveiro agora, cofre no banco depois); (4) serviço `Workspace` (pasta local + sandbox do harness agora, container depois); (5) memória com **de quem é** e **quem ouve** desde a primeira migration; (6) agente como dado versionado; (7) motores atrás da interface `Engine` (um runtime leve para automação entra depois como mais um motor) | Cada item custa pouco agora e muito depois, principalmente dados (memória sem dono/público, banco preso ao driver) | Construir a hospedagem já (login, equipe, cofre, Postgres, containers): fica para a fase 8. Ignorar a hospedagem: obrigaria a reescrever acesso, banco e memória |
| D18 | **Conhecimento aprendido, no modelo do ai-memory**: **captura → consolida → recupera → passa o bastão**. Um único modelo, a **página de conhecimento** (fato, decisão, como-fazer, armadilha, referência, sessão), substitui as tabelas de memórias e skills. A captura sai do próprio runtime; a consolidação funciona **sem LLM** (página de sessão extraída dos passos) e, opcionalmente, com uma chamada de modelo barato; a recuperação é um **resumo de entrada curto** no contexto + busca FTS sob demanda | O agente continua o trabalho sem reexplicações: o que foi decidido, o que falhou, como se faz aqui. Um modelo só é mais simples que memórias + skills + base de documentos. Sem LLM obrigatório, sem serviço externo (D0) | RAG de documentos por upload (fica no backlog). mem0 (grava sem controle, exige banco vetorial externo no SDK TS; disponível via MCP para quem quiser). Grafo, entidades e tiers de decaimento (backlog) |
| D19 | **Design system próprio inspirado no a reference app, mantido com a skill impeccable**: `DESIGN.md` (tokens + regras) e `PRODUCT.md` (verdade do produto) na raiz do app web como autoridade; tokens `--z-*` como única fonte de cor, tamanho, raio e duração; primitivas em `apps/web/src/ui/` como a única API visual das telas, **geradas pelo shadcn (CLI 4.x, `--base aria` = React Aria Components) e reestilizadas com os nossos tokens**; detector do impeccable ligado nas edições de UI e `audit` + `polish` ao fechar cada fase | Consistência que não depende de memória de quem codifica: o padrão está escrito (DESIGN.md), é verificado mecanicamente (detector e `check:ui`) e é refinado em passes curtos e com limite. As regras de fundação do a reference app (escala de controles, só tokens, interações) são boas e testadas | Copiar CSS ou componentes do a reference app (licença: só ideias). Usar o shadcn **com a aparência padrão dele** (paleta neutra, `--radius` dele): viraria a cara de todo app. MUI e afins como dependência visual. Escrever os componentes complexos do zero (acessibilidade e teclado são caros). Storybook ou página de galeria (peso e uma tela a mais para manter; as telas reais são a referência) |
| D20 | **Sem Rust como stack principal** (como o Zeron usa). Rust só para **peças pontuais** com limite medido (ex.: supervisor de processos ou sandbox no modo hospedado, embeddings locais pesados), chamadas pelo server | O tempo de um turno é do modelo e da CLI, não do server. O ecossistema de agentes é TypeScript primeiro (Claude Agent SDK, `effect-acp`, `effect-codex-app-server`). As decisões D1–D19 (Effect, Drizzle, shadcn + React Aria, i18n) continuam valendo. A lógica de produto muda rápido | Reescrever em Rust + gpui: refaz o design system e a acessibilidade, reimplementa à mão o que o Agent SDK dá. Tauri: só se interface nativa virar prioridade |

---

## 2. Visão geral (alvo)

```
 apps/web (React + átomos)          apps/desktop (Electron: janela + server filho)
   │ AtomHttpApi ──── HTTP ────┐       │
   │ AtomRpc ─── WebSocket ────┤       │ sobe o mesmo server numa porta livre
   ▼                           ▼       ▼
 apps/server ── LocalOnly (Host/Origin) ───────────────────────────────────
   ├─ HttpApi (CRUD: projetos, agentes, chats, memórias, MCP, contas, consumo, settings)
   ├─ Rpc (send, steer, interrupt, decide, subscribeChat)
   ├─ Runtime de turnos ── fila por chat · estado persistido · recuperação no boot
   │     ├─ Contexto ─── camadas + marcação de leitura por sessão + passos de trabalho
   │     ├─ Engines ──── ClaudeSdk │ CodexAppServer │ Acp(*) │ Api(effect/ai)
   │     └─ Gateway MCP ─ zorel.* (ferramentas internas) + MCP do usuário · política · aprovação
   ├─ Conhecimento ── captura (passos + mensagens) → consolidação → páginas versionadas → resumo de entrada + busca FTS
   ├─ Contas e consumo ── provider_accounts · failover · janelas de limite · custo
   ├─ Actor (acesso) · Workspace (onde o agente trabalha)
   └─ Store (Drizzle sobre @effect/sql: SQLite do Bun agora, Postgres depois) · Secrets (chaveiro agora, cofre depois)
```

---

## 3. Módulos

| Módulo | Hoje | Alvo |
|---|---|---|
| `packages/contracts` | Entidades + `Api` (HttpApi) + `SendEvent` | + `ZorelRpc` (`RpcGroup`) com `ChatEvent` tipado. O `SendEvent` sai |
| `server/db.ts` | 3 migrations; repositório síncrono sobre `bun:sqlite` | `db/schema.ts` (Drizzle) + `db/migrations/` (`drizzle-kit`) + repositórios em Effect sobre `@effect/sql-sqlite-bun`. Novas tabelas: `turns`, `approvals`, `provider_sessions`, `provider_accounts`, `usage_windows`, passos de trabalho estruturados, `projects.path`, lista de failover em agente e chat, `observations`, `pages` (+ `page_versions`, FTS5) com dono/público, versões de agente |
| `server/access.ts`, `server/workspace.ts` | — | `Actor` (quem faz a requisição) e `Workspace` (onde o agente trabalha): portas da D17 |
| `server/usage/` | Tokens por mensagem | `pricing.ts` (preço por modelo, do catálogo do OpenCode/models.dev, com fallback manual), `windows.ts` (leitura das janelas de limite por conta, com cache e espaçamento), `aggregate.ts` (consultas da área de consumo) |
| `server/engines.ts` | Wrappers de CLI + `effect/ai` num arquivo só | Pasta `engines/`: `types.ts` (interface + capacidades), `claude-sdk.ts`, `codex-app-server.ts`, `acp.ts` (sobre `packages/effect-acp`, copiado do T3 Code), `api.ts`. O Codex usa `packages/effect-codex-app-server`, também copiado |
| `server/chat.ts` | Turno dentro do stream da requisição | `runtime/`: `queue.ts` (fila por chat), `turn.ts` (execução de uma resposta), `recovery.ts` (boot), `events.ts` (PubSub por chat) |
| `server/context.ts` | Montagem completa a cada turno | + `deltaSince(sessão)` (só o que a sessão não viu); a montagem completa vira o ponto de retomada |
| `server/tools.ts` | Hub + gateway + política | + ferramentas internas `zorel.*`; ponte de permissões das ferramentas nativas |
| `server/knowledge/` | Memórias e skills espalhadas em `chat.ts`/`db.ts`/`context.ts` | `capture.ts` (observações por turno, sem segredos), `consolidate.ts` (página de sessão sem LLM + propostas com LLM opcional), `brief.ts` (resumo de entrada), `search.ts` (FTS), `redact.ts` |
| `web/api.ts`, `state.ts` | `call()` + `useState` + `reload()` | `client.ts` (`AtomHttpApi.Service` + `AtomRpc`) e átomos por recurso |

Regra: o domínio (contexto, engines, aprendizado, ferramentas) não importa nada de transporte. `main.ts` e `rpc.ts` só traduzem.

---

## 4. Contrato e transporte

**CRUD (`HttpApi`, já existe):** projetos, agentes, chats (sem envio), memórias, servidores MCP, chaves, modelos. **Novos:** contas (`provider_accounts`, login, failover) e consumo (agregados, janelas, orçamentos).

**Turnos (`effect/rpc` em `/rpc`, WebSocket):**

```ts
RpcGroup.make(
  Rpc.make("send",          { payload: { chatId, clientId, text, model? }, success: { turnId } }),  // clientId: idempotência
  Rpc.make("steer",         { payload: { chatId, text } }),
  Rpc.make("interrupt",     { payload: { chatId } }),
  Rpc.make("decide",        { payload: { approvalId, approve } }),
  Rpc.make("subscribeChat", { payload: { chatId }, success: ChatEvent, stream: true }),
  Rpc.make("subscribeStatus", { success: ChatStatus, stream: true })
)
```

- `subscribeChat` sempre começa com um `snapshot` (mensagens desde o resumo, turno em andamento, aprovações abertas, fila) e segue com eventos ao vivo. **Reconectar é assinar de novo.**
- `ChatEvent` (em `packages/contracts/src/events.ts`): `snapshot | message | queued | turn-started | text (agrupado) | reasoning | step-started | step-finished | approval | approval-resolved | handoff | model-switched | learned | context-usage | turn-completed | turn-failed | interrupted | status`. Os passos (`WorkStep`) trazem tipo, título, arquivos, duração e mudanças por arquivo: é o que a pílula de atividade do chat mostra.
- `subscribeStatus`: status de todos os chats (rodando, esperando você, falhou), para a barra lateral e "Precisa de você".
- **Deltas de texto agrupados a cada 100 ms** ou 8 KiB (referência: a reference app 100 ms, Zeron 120 ms).
- `LocalOnly` cobre HTTP e WebSocket.

---

## 5. Runtime de turnos

**Estados** (tabela `turns`): `queued → running → completed | failed | interrupted`. As colunas são `chat_id`, `agent_id`, `model`, `client_id UNIQUE`, `started_at`, `ended_at`, `error`, `usage`.

- **Fila por chat**, com um turno por vez. O encadeamento de agentes (@menção, até 3 repasses) gera novos turnos na mesma fila.
- **Mensagem com o agente ocupado:** vai para a fila por padrão. Vira `steer` se o engine suportar e você pedir.
- **Interromper:** pelo engine (`interrupt`/`turn/interrupt`). O texto parcial é gravado como `interrupted`.
- **Aprovações** ficam persistidas (`approvals`) e não mais só em memória. Ao fechar o turno, as abertas viram recusa.
- **Idempotência:** `send` com o mesmo `clientId` devolve o mesmo `turnId`, então reenviar não duplica.
- **Recuperação no boot:** um turno `running` sem processo vira `interrupted`, e a mensagem parcial é preservada. Nunca repete efeito colateral incerto (regra do a reference app).
- **O turno não depende do cliente.** Fechar a aba não para nada.
- **Proteções do turno** (ideias do a reference app; `runawayGuard` em runtime.ts):
  - **travado:** 10 min sem nenhum evento do engine, fora de aprovação esperando, encerra o turno e reabre a sessão no próximo;
  - **loop:** o mesmo passo (tipo, título e começo da saída) 4 vezes seguidas encerra o turno dizendo qual;
  - **falhas:** 6 passos seguidos com erro encerram o turno.
  
- **Retomar no reset** (ideia do T3 Code, automática): quando o turno falha sem ter agido e **todas** as rotas do chat estão no limite de uso, o chat grava `resumeAt` = o reset mais próximo. O tick de 30 s das rotinas manda nessa hora "The usage limit has reset. Continue where you left off." (clientId `resume:<chat>:<hora>`, idempotente; com tudo pausado, fica na fila). O chat mostra a faixa com Cancel; escrever você mesmo também cancela.
- **Editar daqui** (ideia do T3 Code): `POST /api/chats/:id/rewind {messageId, files}` com o chat parado. Com `files`, primeiro desfaz pelos checkpoints os turnos posteriores ainda não desfeitos, do mais novo para o mais velho (um conflito para tudo, sem tocar na conversa). Depois apaga a mensagem e o que veio depois, zera o resumo se ele cobria o trecho e fecha as sessões nativas do chat (`runtime.forget`), para o próximo turno começar do que o Zorel guarda e o provider não lembrar o que saiu. O texto volta para o campo de mensagem.
- **Busca** (Cmd+K, ideia do T3 Code): `GET /api/search?q=` procura nas mensagens (LIKE com escape, as 30 mais novas; FTS5 como o `memory_index` quando o volume pedir) e devolve chat, mensagem, hora e o trecho em volta. Lugares, chats, projetos e agentes são filtrados no cliente.
- **Pausar tudo** (ideia do a reference app): `PUT /api/pause` grava a preferência `paused`; pausar interrompe os turnos rodando, e enquanto pausado os turnos novos ficam `queued` (o worker do chat não começa) e as rotinas não disparam (seguem devidas); despausar acorda a fila de cada chat. Sobrevive a reiniciar o servidor.
- **Notificações** (no cliente): o fluxo `subscribeStatus` que já alimenta a barra dispara uma notificação do sistema quando um chat passa a esperar você, falha ou termina enquanto você olha outro lugar; ligada em Settings › General.

  Loop e falhas valem para os passos nativos e para as ferramentas do gateway. Não são falha de provider, então não disparam failover. O failover em si só troca de rota se o turno ainda não agiu (editou, rodou ou chamou ferramenta que escreve), para nunca repetir um efeito.

---

## 6. Engines

```ts
interface Engine {
  readonly capabilities: {
    session: "native" | "none"          // native: mantém sessão viva entre turnos
    steer: boolean
    interrupt: boolean
    liveModelSwitch: boolean            // troca de modelo sem nova sessão
    images: boolean
    reasoningEffort: ReadonlyArray<"low" | "medium" | "high" | "max">
    nativeTools: boolean                // shell/edição próprios da CLI
  }
  open(input: { chatId; agentId; model; cwd; resume?: ProviderSessionId; tools?: TurnTools; permissions }): Effect<EngineSession>
}
interface EngineSession {
  readonly id: ProviderSessionId
  turn(input: { system?: string; messages: TurnMessage[]; images?; effort? }): Stream<EngineEvent>
  steer(text: string): Effect<void>
  interrupt: Effect<void>
  setModel(model: string, effort?: string): Effect<void>
  close: Effect<void>
}
```

| Adaptador | Base | Sessão | Observações |
|---|---|---|---|
| `claude-sdk` | `@anthropic-ai/claude-agent-sdk` (roda a CLI oficial **instalada**, via `pathToClaudeCodeExecutable`: o binário de ~300 MB que o pacote traz nunca é usado nem empacotado) | nativa: um processo por (chat, agente) com entrada em streaming; `persistSession: false` (retomar usa o ponto de retomada do Zorel) | `setModel` ao vivo. Gateway do turno trocado com `setMcpServers`. Ferramentas próprias desligadas (`tools: []`). Login nunca é lido |
| `codex-app-server` | `codex app-server` (JSON-RPC), cliente mínimo próprio | nativa: um processo e uma thread por (chat, agente), `ephemeral` (retomar usa o ponto de retomada). `CODEX_HOME` próprio do Zorel por conta: o `config.toml` do usuário (MCP, `AGENTS.md`, memórias) nunca chega aos agentes, e o `app-server` não tem `--ignore-user-config` | Modelo por `turn/start`. `turn/steer`, `turn/interrupt`, `thread/compact/start`, `model/list`, `account/rateLimits/read`. Sandbox `read-only`/`workspace-write` |
| `acp` | `effect-acp` (T3 Code, MIT) | nativa quando o agente suporta | **OpenCode** (harness de **todas** as API keys), Gemini CLI, Cursor, Kimi, Cline, Grok, Hermes |
| `api` | `effect/ai` | `none` | **Não é agente de projeto.** Só para consolidação, títulos, roteamento, revisão de memória e conversa rápida sem workspace. Marcadores de cache, uma mensagem por bloco |

**Credencial → harness:**

| Credencial | Harness | Como a credencial chega |
|---|---|---|
| Assinatura Claude (Pro/Max) | `claude-sdk` | Login da própria CLI (nunca lido pelo Zorel) |
| Assinatura ChatGPT | `codex-app-server` | Login da própria CLI |
| Outras CLIs com assinatura própria (Gemini CLI, Cursor, Kimi…) | `acp` | Login da própria CLI |
| **Qualquer API key**: Anthropic, OpenAI, OpenRouter, Gemini, DeepSeek, Groq; ou servidor local (Ollama, LM Studio, base OpenAI-compatível) | `acp` → `opencode acp` | Config injetada por `OPENCODE_CONFIG_CONTENT` (provider, modelo, `baseURL`, `apiKey` vinda do chaveiro). O `opencode.json` do usuário nunca é tocado. A permissão vem do nível de acesso do Zorel (seção 9) |

**Quem decide o harness é a conta, não o nome do modelo.** A escolha é o par `{ accountId, model }`: uma conta `subscription/claude` usa o Claude Agent SDK, e uma conta `api-key/anthropic` usa o OpenCode, mesmo que o modelo seja o mesmo. O seletor mostra os dois ("Sonnet · Claude pessoal" e "Sonnet · chave Anthropic"). Trocar entre eles equivale a trocar de provider: o ponto de retomada entra na sessão nova.

*Migração do estado atual:* os ids `claude-cli/…`, `codex-cli/…` e `anthropic/…` viram a conta padrão do provider correspondente mais o nome do modelo.

- **Mesmas garantias para todos:** contexto em camadas e ponto de retomada, conhecimento aprendido, gateway MCP com política e aprovação, fila, interrupção e troca de modelo. O harness só faz o trabalho de agente de código.
- **Várias contas por provider:** ver 6.1.
- **Modelos** listados pelo próprio harness (`model/list`, catálogo do OpenCode via models.dev), e não por lista fixa. Cada conta tem a sua lista, porque contas diferentes podem ter modelos diferentes.

### 6.1 Multicontas (D14)

**Modelo de dados.** Tabela `provider_accounts`:

| coluna | descrição |
|---|---|
| `id`, `label` | ex.: "Claude trabalho", "Claude pessoal" |
| `kind` | `subscription` \| `api-key` |
| `provider` | `claude`, `codex`, `gemini-cli`… (assinatura) ou `anthropic`, `openai`, `openrouter`… (chave) |
| `home` | assinatura: pasta de login gerenciada pelo Zorel, `~/.zorel/accounts/<id>`, ou `null` para o login padrão da CLI |
| `secret` | chave: nome no chaveiro (`account:<id>`). O valor nunca vai para o banco |
| `base_url` | chave: opcional (Ollama, LM Studio, base OpenAI-compatível) |
| `identity` | o que o harness reportar (e-mail ou plano), só para exibição |

A conta "padrão" de cada CLI aparece sem cadastro. **Claude:** é o login que já está no seu computador (`home = null`). **Codex:** é uma pasta do próprio Zorel (`~/.zorel/accounts/codex-default`), com login feito uma vez pelo Zorel, porque o `codex app-server` sempre carrega o `config.toml` do usuário (servidores MCP, `AGENTS.md`, memórias) e não tem como ignorá-lo (implementado em 2026-11-03).

**Como a credencial chega ao harness:**

| Tipo | Isolamento |
|---|---|
| Claude (assinatura) | `CLAUDE_CONFIG_DIR=<home>` no processo do SDK. Não muda `HOME` nem o chaveiro do sistema (mesmo cuidado do T3 Code) |
| Codex (assinatura) | `CODEX_HOME=<home>`. Se a CLI usar o chaveiro do sistema para o login, a conta extra precisa de armazenamento em arquivo (limitação do Codex, também documentada pelo T3 Code) |
| CLIs ACP (assinatura) | A variável de pasta de cada CLI (`GEMINI_HOME`, `GROK_HOME`…), declarada no adaptador |
| API key (OpenCode) | A chave da conta vai na config injetada daquela sessão. Duas contas Anthropic são dois providers distintos na config |

**Login dentro do Zorel.**
- O Zorel roda o comando de login oficial da CLI com a pasta da conta. Por exemplo: `CLAUDE_CONFIG_DIR=… claude auth login`, `CODEX_HOME=… codex login`.
- O fluxo acontece no navegador do provider. O Zorel nunca vê nem guarda o token.
- Depois, o Zorel lê do harness só a identidade, para exibir.
- Remover a conta apaga a pasta, com confirmação.

**Escolha da conta:**
- Agente e chat têm `accountId`. O id do modelo continua `provider/modelo`.
- O seletor de modelo lista modelos por conta ("Sonnet · Claude pessoal").
- Os membros de um canal podem usar contas diferentes.
- **Trocar de conta no meio do chat** encerra a sessão da conta antiga e abre outra na conta nova com o ponto de retomada, igual a uma troca de provider. Não reaproveita a sessão nativa entre contas, então não há "shadow home": é mais simples e não depende de como cada CLI guarda sessões.

**Troca automática (failover).**

*Configuração:* cada agente (e cada chat, quando sobrescreve) tem uma lista ordenada de até 8 alternativas `{ conta, modelo }`. As alternativas podem ser de outro provider, por exemplo: assinatura Claude pessoal → assinatura Claude trabalho → chave da Anthropic via OpenCode → chave do OpenRouter. Como o contexto é nosso, qualquer alternativa continua o trabalho. A lista começa vazia, e o failover fica desligado até você montá-la.

*Aviso:* ao incluir uma **segunda conta de assinatura do mesmo provider** na lista, o Zorel mostra uma vez, e grava que você aceitou: "Alternar contas de assinatura para contornar limites pode violar os termos do provider e levar a bloqueio da conta. O risco é seu." Alternativas por API key não têm esse aviso, mas mostram que passam a ter custo por token.

*Gatilhos* (classificados pelo adaptador a partir do sinal de cada harness: `rate_limit_event` do Claude, erros e `account/rateLimits` do Codex, erros do OpenCode):

| Gatilho | O que acontece |
|---|---|
| **Limite da assinatura** (com horário de volta) | A conta fica em espera até o reset. O turno vai para a primeira alternativa pronta. **Volta sozinho** para a conta principal quando o reset passa |
| **Erro do provider**: `rate_limit`, `billing`, `unavailable`, `auth`, `network`, `timeout` | **Só se o turno ainda não agiu**: nenhuma ferramenta que escreve foi executada. A mensagem volta para a fila e roda na próxima alternativa. A conta que falhou é pulada por 10 min |
| Erro depois de o turno ter agido | **Não troca.** Falha com a explicação e oferece retomar manualmente; nunca repete efeito colateral incerto |
| Erro de conteúdo / pedido inválido | Não troca: outro modelo daria o mesmo erro |

*Limites:* cada mensagem tenta cada alternativa no máximo uma vez. Se todas falharem, o turno falha e lista o motivo de cada tentativa.

*Visibilidade:*
- Toda troca aparece no chat ("Limite da Claude pessoal até 14:30, continuando com Claude trabalho").
- A mensagem guarda conta e modelo que de fato responderam.
- A medição por turno registra as trocas.

*Leitura de uso por conta:* as janelas de limite da assinatura (Claude, Codex) entram junto com o failover. Assim o Zorel sabe quando a conta volta e pode avisar antes de chegar ao limite.

*Como ficou (2026-11-03):*
- Lista em `agents.failover` e `chats.failover` (null = a do agente líder), editada na página do agente e em "Fallbacks…" no menu do chat. O aviso de termos é aceito uma vez (`preferences`).
- Classificação: o parser do Claude lê `rate_limit_event` (`rejected` + `resetsAt` vira `limit`) e o código de erro das mensagens do assistente; o Codex lê `codexErrorInfo` do `turn/completed` e `account/rateLimits` (pede a leitura no início de cada turno e ouve as atualizações); API e processos usam heurística sobre a mensagem (`classifyMessage`).
- "Já agiu" = o gateway executou uma ferramenta de classe `write` ou `sensitive` (mesmo que tenha falhado).
- Espera por limite fica em `provider_accounts.limited_until` (sobrevive a reinício); os outros erros pulam a rota por 10 min, em memória. A última leitura de uso fica em `provider_accounts.usage` e aparece em Usage e no seletor de modelo.
- Trocas: evento `failover` ao vivo, `messages.switches` e `turns.switches`; o turno guarda o modelo e a conta que responderam.

*Pool com rodízio* de várias contas para distribuir carga continua fora do Zorel (proxy externo como API key de base compatível). O failover só troca quando há falha ou limite, não para balancear.

---

## 7. Contexto (D6)

**Ponto de retomada**, sempre atualizado e guardado no Zorel:

```
base → agente → canal → sobre você (aprovado) → projeto (brief) → resumo de entrada do conhecimento
     → resumo do chat → passos de trabalho (compactados) → últimas 30 mensagens
```

**Regras por situação:**

| Situação | Enviado |
|---|---|
| Sessão viva, mesmo provider | Só as mensagens após a marcação da sessão (`provider_sessions.seen_message_id`), mais as camadas que mudaram desde o último envio (identificadas por hash) |
| Troca de modelo no mesmo provider | `setModel` ao vivo (Claude: só no modo de entrada em streaming, que é o que usamos), então igual à linha de cima. **Cada modelo tem seu próprio cache de prompt**, e a primeira chamada depois da troca paga a conversa sem cache |
| Troca de provider / sessão nova / retomada falhou | **Ponto de retomada completo** |
| Volta a um provider já usado | Retoma a sessão dele e envia só o que ele ainda não viu (ideia do Zeron) |
| Engine `api` | Ponto de retomada a cada turno, com cache de prompt |

- **Passos de trabalho:** de cada turno ficam guardadas as ferramentas usadas, os comandos e os arquivos alterados. Entram compactados no ponto de retomada; o detalhe fica disponível por `zorel.history_read`.
- **Handoff tipado:** `{ feito, falhou, em aberto, próximo passo, arquivos }`, gerado sem LLM a partir dos passos de trabalho. Fica preso ao chat e é **oferecido**, nunca consumido automaticamente (lição do ai-memory).
- **Compactação nativa** da CLI pode acontecer à vontade: o ponto de retomada não depende dela.
- **Medição em todo turno:** latência até o primeiro token, latência total, tokens de entrada, tokens lidos do cache e tokens de saída. As decisões de contexto se baseiam nesses números.

---

## 8. Conhecimento aprendido (D18, D7)

**Hoje (implementado, 2026-11-03):** memórias (`fact`) e skills em SQLite, com escopo você/projeto/agente. **Skills como no a reference app (2026-11-04):** o contexto lista os títulos e traz o passo a passo das mais relevantes; o agente lê qualquer outra com `zorel_read_skill` e propõe uma nova ou uma **melhoria** com `zorel_propose_skill` (título, passos, motivo, `improves`), que fica pendente (no máximo 5 por chat). A melhoria aponta para a skill que substitui (`memories.replaces`) e guarda o motivo; em Knowledge a pessoa vê o diff linha a linha e "Apply the change" grava o texto novo na skill, com o anterior em `memory_versions` (toda edição também vira versão, com restaurar). **Skills do computador (2026-11-04):** Settings › Skills lista as SKILL.md já existentes (Claude Code `~/.claude/skills`, plugins do Claude Code na versão mais nova, Codex `~/.codex/skills`, `~/.agents/skills`; uma pasta ligada em dois lugares conta uma vez) e a pessoa escolhe quais os agentes do Zorel usam (preferência `fileSkills`, só caminhos achados pela varredura). As escolhidas entram na lista de skills do contexto (título e para que serve) e `zorel_read_skill` lê o arquivo na hora (`server/file-skills.ts`). À parte, **"Let Claude Code and Codex use their own skills"** (preferência `nativeSkills`, desligada por padrão): o Claude ganha a ferramenta `Skill` (lê as skills do usuário e dos plugins) e o Codex deixa de desligar a descoberta e as skills que encontra; vale a partir da próxima sessão de cada chat. Testado ao vivo: skill de arquivo lida pelo agente; com as nativas ligadas o Claude enxergou 119 skills.
- **Consolidação** com LLM quando o chat passa de 50 mensagens além do resumo: o trecho que sai da janela vira resumo e **propostas** de memória e skill, pendentes até você aprovar em "Precisa de você". O que você mandou esquecer vai no prompt para não voltar.
- **Regra da evidência humana** (ideia do a reference app): o trecho chega numerado e cada memória proposta cita os números das mensagens que a provam. Só vale mensagem sua: palpite, plano ou suposição de agente nunca vira memória. Skills não exigem (procedimento pode nascer do trabalho do agente).
- **Confirmação:** a consolidação devolve os ids das memórias existentes que o trecho confirmou de novo, e repetir uma memória ativa (por qualquer caminho) também a confirma. `confirmedAt` ordena o orçamento.
- **Recuperação em três níveis:** até 8.000 caracteres das mais recentemente confirmadas vão fixas no contexto; a cada turno, a busca FTS5 (BM25) traz as 5 que mais casam com a mensagem; e o agente busca o resto quando precisa com a ferramenta `zorel_search_memories` (até 10, sempre nos escopos do chat). Sem embeddings: o a reference app mostra que busca por palavra basta.
- **Próximo (fase 3b):** as páginas abaixo. A wiki do a reference app (arquivos Markdown como verdade, índice FTS5 com links, versões, pacotes de mudança com hash e rebase, curador ao fim da conversa, fontes citadas, revisão periódica de contradições) é a referência de desenho; só ideias, a licença dele é Apache-2.0 mas não copiamos código.

**Modelo único: a página.**

```
página = { escopo: projeto | agente | você, tipo, título, resumo (1 linha), corpo,
           estado: ativa | pendente (só "você") | aposentada, versão anterior,
           usos, último uso, origem: turnos que a geraram, dono e público (D17) }

tipo: fato · decisão · como-fazer · armadilha · referência · sessão
```

As memórias e skills de hoje migram para páginas: memória → `fato`, skill → `como-fazer`.

**1. Captura.** O runtime já vê cada turno. Ele grava as **observações**: o pedido, os passos de trabalho (ferramentas, arquivos, comandos, erros) e a resposta, **com segredos removidos antes de gravar**. Não há hooks nem processo extra.

**2. Consolidação**, disparada ao fechar um bloco de trabalho (fração da janela de contexto atingida, fim do chat ou botão):
- **Sem LLM, sempre:** página `sessão` extraída das observações (o que foi pedido, feito, alterado, o que falhou e o que ficou aberto) e o **handoff tipado** do chat.
- **Com LLM, opcional** (um modelo barato, uma chamada por bloco): propõe criar ou atualizar páginas de `decisão`, `armadilha`, `como-fazer` e `fato`, e **aposentar** a página que a conversa mostrou estar desatualizada.
  - O que é do **projeto ou do agente** entra direto, como nova versão.
  - O que é **sobre você** fica pendente até aprovação.
  - Teto de pendentes: 20.

**3. Recuperação:**
- **Resumo de entrada** (camada do contexto, seção 7): título + resumo de 1 linha das páginas **fixadas** e das mais relevantes (recência + usos), dentro de um orçamento de ~1.500 tokens. O corpo não entra.
- **`zorel.knowledge_search`**: busca FTS5 (BM25) no título, resumo e corpo, devolvendo trechos com o link da página. **`zorel.knowledge_read`**: abre a página inteira.
- Cada página entregue ao modelo conta um uso. O que é usado sobe no resumo de entrada; o que não é, desce sozinho.
- **Embeddings só com medição:** se a avaliação mostrar que a busca por palavra perde recall em paráfrases, entra um modelo local pequeno no processo, por força bruta no SQLite (sem índice vetorial nem serviço externo).

**4. Passar o bastão.** O handoff tipado (`feito, falhou, em aberto, próximo passo, arquivos`) fica preso ao chat. Ele é **oferecido** na retomada e nunca consumido sozinho (lição do ai-memory).

### 8.1 Gerenciar o conhecimento

| Ação | Onde |
|---|---|
| **Feed "o que o Zorel aprendeu"**: páginas criadas, atualizadas e aposentadas, por projeto e por dia | Tela Conhecimento |
| Ler, editar, **fixar**, aposentar e restaurar uma página | Tela Conhecimento |
| **Histórico de versões e desfazer** de cada página | Página |
| Aprovar, editar ou descartar o que é **sobre você** | Fila "Para revisar" |
| Ver de onde a página veio (turnos de origem, com link) | Página |
| **"O que o modelo viu"**: por resposta, as camadas enviadas e os tokens de cada uma (gravado no turno) | Chat |
| Desligar o aprendizado de um agente ou de um projeto | Configurações do agente ou do projeto |
| Exportar o conhecimento do projeto em Markdown | Tela Conhecimento |

**Backlog com critério de entrada:**

| Item | Entra quando |
|---|---|
| Embeddings locais | A avaliação mostrar perda de recall em paráfrases |
| Detecção de quase-duplicata e contradição | Duplicatas aparecerem no feed com frequência |
| Feedback "ajudou / errada" | O resumo de entrada trouxer páginas inúteis com frequência |
| Espelho em Markdown na pasta do projeto | Pedido de versionar o conhecimento junto com o código |
| RAG de documentos por upload | Necessidade real de buscar em documentos que não nasceram do trabalho |
| Grafo, entidades, tiers de decaimento | Mais de ~5 mil páginas por projeto ou recall insuficiente |
| Integração mem0 | Via MCP, para quem quiser, já funciona sem código novo |

## 9. Ferramentas, aprovações e interação entre agentes

Referência: a reference app (`docs/architecture/agents.md` "Agent communication policy" e `structure.md` sobre permissões). Só ideias: a licença é PolyForm Noncommercial. O a reference app entra no vínculo da aprovação à chamada exata e na recusa com motivo.

### 9.1 Ferramentas

- **Gateway MCP por turno** (já existe): URL secreta, lista fechada, modos `read`/`approve`/`auto` por servidor e escopo global ou por projeto.
- **Ferramentas internas `zorel.*`** no mesmo gateway: conhecimento (`knowledge_search`, `knowledge_read`), histórico (`history_search`, `history_read`), equipe (`list_agents`, `send_message`, `start_task`, `interrupt_agent`) e `ask_user`. Quando passarem de cerca de 15, entram por busca sob demanda (`tool_search`), como no a reference app.
- **Agente padrão do projeto:** o chat novo no projeto começa com ele; qualquer membro pode responder depois (ideia do AgenticOS).
- **Workspace do projeto:** o projeto ganha `path` (pasta no disco, opcional). Ela é o `cwd` dos agentes do projeto; sem pasta, o agente roda numa pasta vazia do Zorel, como hoje. **O agente nunca acrescenta pastas a si mesmo** (só você), e o Zorel recusa a raiz do disco, a home e a pasta de dados do Zorel.
- **Desfazer edições:** o Claude Agent SDK tem `rewindFiles` (checkpoint por mensagem). Os outros harnesses dependem de git: o Zorel sugere commitar ou usar uma worktree antes de trabalho em nível Workspace.
- **Conectores com OAuth (feito em 2026-11-04):** Settings › Connectors traz serviços prontos. Os remotos que seguem a especificação de autorização do MCP (Notion, Linear, Jira e Confluence, Sentry, Vercel, Supabase, Stripe) conectam com um clique: o SDK faz a descoberta, o registro dinâmico do cliente, o PKCE e a renovação (`server/oauth.ts`, `McpOAuth`). O registro do cliente, os tokens e o verificador ficam no keychain (`mcp-oauth:<id>`), nunca no banco. Conectar (`POST /api/mcp/:id/sign-in`) devolve a URL de autorização, que abre no navegador; o serviço volta para `GET /api/oauth/callback`, que só aceita um `state` emitido pelo Zorel, uma vez, por 10 minutos. `mcp_servers.auth` (`none`/`oauth`) diz se o Hub passa o `authProvider`. O GitHub não registra clientes, então pede um token pessoal (vira o cabeçalho `Authorization`). Context7, Figma (app desktop) e Playwright não pedem nada. Quando o serviço recusa a credencial (401, ou token OAuth revogado sem renovação), o Hub marca o servidor como recusado (`hub.refused`, limpo ao conectar ou trocar a credencial) e Settings pede "Reconnect"; um token novo entra pelo `PATCH /api/mcp/:id` com `env`, sem recriar o servidor (as permissões por agente, presas ao id, continuam). Conectores entram em modo `approve`; a lista de servidores próprios ("Custom servers") continua para qualquer outro.

**Como ficou (2026-11-03):**
- `projects.path` validado pelo serviço `Workspace` (absoluto, real, pasta; recusa raiz, home e a pasta de dados). Sem pasta, o agente trabalha em `<dataDir>/runs/<chat>`.
- **Pontos de restauração iguais para todos os harnesses** (decisão revisada: em vez de `rewindFiles` no Claude e git só nos outros): um repositório git **sombra** por projeto em `<dataDir>/workspaces/<id>.git` (`GIT_DIR` lá, `GIT_WORK_TREE` = a pasta). Antes e depois de cada turno o Zorel grava a árvore (`git add -A` + `write-tree`, respeitando o `.gitignore` do projeto, mais `node_modules`). O diff do turno e o desfazer saem dessas duas árvores; o desfazer recusa se um arquivo do turno mudou depois (`UndoConflict`). O repositório git do próprio projeto nunca é tocado.
- Claude: `tools` = Read, Glob, Grep, Edit, Write, Bash; `canUseTool` aplica o nível (`engines/policy.ts`: comandos que apagam, publicam ou usam a rede sempre perguntam em Workspace). Codex: `sandbox`/`approvalPolicy` por nível, shell ligado no app-server, `item/commandExecution/requestApproval` e `item/fileChange/requestApproval` respondidos pelo cartão do Zorel. Skills da máquina desligadas no `CODEX_HOME` do Zorel (`skills/config/write`), nunca no do usuário.
- Passos nativos (`tool_use`/`tool_result` do Claude, itens `commandExecution`/`fileChange` do Codex) viram `WorkStep`; leitura e busca não contam como "agiu" para o failover, edição e comando contam.
- Handoff: cada resposta leva para o próximo turno uma nota do que fez ("[Feito neste turno: editou a.ts (+2 −1); rodou `bun test` (ok)]"), então outro agente ou outro provider sabe o que mudou.
- Vigia: um engine sem nenhum sinal por 10 min, sem aprovação esperando, falha como `unavailable` (o processo pode ter morrido sem o SDK perceber) e a sessão é fechada.
- **Files como o explorer de um editor** (2026-11-04): `POST /api/chats/:id/fs {op, path?, to?, paths?, id?}` com `op` = create | rename | move | delete | restore | open | reveal, sobre a pasta do chat (`chatRoot`: a worktree ou a pasta do projeto). `fs-ops.ts` confere que todo caminho fica dentro da pasta (`relative()`, vale no Windows), move entre discos (EXDEV → copia e apaga) e manda o apagado para a lixeira do Zorel (`<dataDir>/trash/<id>/`, mantendo os caminhos; `restore` desfaz; some depois de 7 dias). Abrir e mostrar na pasta usam o comando de cada sistema (`open`/`open -R`, `cmd /c start`/`explorer /select,`, `xdg-open`). Na interface, React Aria `Tree` (já instalado, em vez do @headless-tree): seleção múltipla, F2 renomeia no lugar, Delete apaga com Undo, arrastar move para a pasta, duplo clique abre (o arquivo mudado abre o diff), menu de contexto. Ícones por formato: a marca da linguagem do `simple-icons` (já instalado) na cor dela, formas do lucide para o resto.
- Interface: resumo de mudanças sob cada resposta (ver, desfazer), painel direito Changes/Files e terminal só leitura com os comandos dos agentes. O diff usa o `@pierre/diffs` 1.6.1 (`FileDiff`, realce de sintaxe, mudança dentro da linha, linhas inalteradas recolhidas) **dentro de um pool de workers** (`diff-pool.tsx`, como o T3 Code faz). Sem o pool, um bug da lib aparece: com o `StrictMode` do React 19 e `disableFileHeader`, a remontagem acha o `<pre>` vazio da primeira montagem, trata como já renderizado e nunca desenha (sem erro). As cores vêm dos tokens `--z-*` via `unsafeCSS` (variáveis CSS atravessam o shadow DOM) e o tema segue o claro/escuro do Zorel. O painel carrega o visualizador sob demanda.

### 9.2 Aprovações

**Nível de acesso por agente**, escolhido só por você, os mesmos três do a reference app:

| Nível | O que faz sem perguntar | O que pergunta | Claude SDK | Codex | OpenCode/ACP |
|---|---|---|---|---|---|
| **Workspace** (padrão) | Ler; editar e rodar comandos **dentro** do workspace (pasta do projeto + pastas que você adicionou) | Escrever fora dele; rede; comandos destrutivos; ferramentas MCP de escrita conforme o modo do servidor | `canUseTool` decide por caminho e comando | sandbox `workspace-write` + `approvalPolicy: on-request` | `session/request_permission` + permissões injetadas na config |
| **Perguntar antes** | Só ler | Toda escrita e todo comando | `canUseTool` pergunta tudo que não é leitura | `read-only` + `on-request` | tudo em `ask` |
| **Acesso total** | Tudo | Nada (só o que o modo do servidor MCP exigir) | tudo permitido | `danger-full-access` | tudo em `allow` |

**Permissões por agente (feito em 2026-11-04, ideias do a reference app, código próprio):** além do nível de acesso (pasta e shell), cada agente tem `permissions` (coluna JSON): `web` (busca e leitura de páginas pelas ferramentas do próprio engine: `WebSearch`/`WebFetch` no Claude, `web_search` no Codex, pedidos `fetch` no ACP), `browser` (as ferramentas `browser_*` do Zorel), `grants` por servidor MCP — `none` esconde, `read` expõe só ferramentas de leitura, `write` todas; sem entrada segue o modo do servidor — e `always`, as regras do "Sempre permitir" (`<servidor>:<ferramenta>` ou `browser`). Ferramentas destrutivas (classe `sensitive`: apagar, enviar, publicar, pagar…) sempre pedem, salvo servidor em `auto` ou regra `always`; cliques no navegador cujo rótulo compromete algo (comprar, publicar, enviar, apagar…) pedem sempre e não aceitam "sempre". O agente pede mais com `zorel_request_access` (web, browser ou um conector com nível), aprovado num cartão. A regra pura fica em `server/permissions.ts`; a página do agente tem a aba **Tools and access**. Padrão: web e browser ligados, conectores pelo modo do servidor.

**Criar agente com IA (2026-11-04):** o Builder é um agente do próprio Zorel (`agents.builtin = "builder"`), fora das listas e dos seletores e das ferramentas de equipe; conversa-se com ele só na tela **Build with AI** (`#/build[/projeto]`), num chat oculto (`chats.hidden`) recriado a cada visita. A proposta (`zorel_create_agent`) aparece como prévia ao lado, com Criar e Agora não (o mesmo cartão de aprovação). Como no a reference app, a proposta já traz os poderes (`web`, `browser`, `connectors` por nome com nível, `reason`); o Builder propõe o mínimo (navegador só se pedido, conectores listados, o resto sem acesso) e seu teto é workspace (não o "ask" dele, que não age); a tela segue em dois passos (Describe, Powers) e termina criando o agente com os poderes ajustados e abrindo a página dele (sem primeira tarefa, por decisão do usuário). Testado ao vivo com Claude: proposta em ~10 s. O prompt do Builder é do Zorel e se atualiza ao abrir a tela; para trabalho de código sem projeto ele pede para escolher o projeto no seletor da tela antes de propor. As ferramentas do gateway têm prazo maior que o do cartão de aprovação (Claude `MCP_TOOL_TIMEOUT`, Codex `tool_timeout_sec`: 31 min), senão uma aprovação demorada derrubava a chamada (~60 s no Claude).

**O cartão de aprovação**, igual para ferramenta nativa e MCP:
- Mostra o agente, a ferramenta, os argumentos (com segredos mascarados) e a pasta.
- **Vínculo à chamada exata:** um hash da ferramenta mais os argumentos canônicos. Uma aprovação não vale para outra chamada.
- Respostas possíveis:
  - **Aprovar uma vez.**
  - **Sempre permitir** esta ferramenta, neste agente. Isso grava uma regra visível e revogável (feito em 2026-11-04 para ferramentas MCP e o navegador: o cartão só mostra o botão quando a aprovação traz `alwaysKey`; ferramentas nativas do engine ainda aprovam uma vez).
  - **Recusar com motivo.** O agente lê o motivo e não tenta de novo sem pedir.
- **Persistido no banco** (`approvals`): sobrevive a reinício e fechamento da aba.
- **Expira** (padrão 30 min), e a expiração vale como recusa.
- **Promover um agente a Acesso total responde sozinho** as aprovações que ele tem esperando (como `answerGrantedRequests` do a reference app).

**Tela "Precisa de você":** reúne aprovações, perguntas (`ask_user`) e logins pendentes de todos os chats, tarefas e rotinas, com link para a origem e notificação do desktop.
- A aprovação de uma tarefa delegada aparece **também** no chat de quem delegou.
- **Rotina não tem ninguém olhando.** Cada rotina define o que fazer quando precisar de aprovação:
  - **recusar e reportar** (padrão);
  - **esperar** até X horas, avisando.

**Regras de segurança** (do a reference app, mantidas):
- **Um agente só pode restringir acesso** (o próprio ou de um colega), nunca ampliar. Só você amplia.
- **Agente criado por outro herda os limites do criador.** Um agente em Workspace não escapa do sandbox criando um colega.
- **Mudança em servidor MCP feita por agente** (só quando você pede) sempre passa por aprovação. As ferramentas nunca recebem nem devolvem valores de cabeçalho ou variável: chave você digita na tela de MCP.
- **Ferramentas de canal** recusam pedidos que não vieram de uma pessoa.

### 9.3 Interação entre agentes

**Implementado (2026-11-03):** delegação por `@menção` (handoff com teto de 3 respostas seguidas) e as ferramentas próprias do Zorel, oferecidas a todo turno ao lado das MCP:
- `zorel_list_agents` e `zorel_read_agent`: leem a equipe (globais + do projeto; agente por id ou `@handle`). Livres.
- `zorel_create_agent` e `zorel_update_agent`: viram **cartão de aprovação** com o perfil campo a campo e só gravam no seu OK; auditadas em nome do agente e registradas como versão do agente. O novo agente nunca tem acesso acima de quem propõe (ask < workspace < full) e um agente só estreita o acesso de outro. Sem modelo, herda o de quem propõe; modelo inválido volta como erro com os providers válidos (sem uma `list_models` à parte).
- `zorel_create_agent` aceita **uma equipe inteira** (`agents: [...]`, até 8, nomes distintos): um cartão só com cada perfil sob o nome dele; aprovar cria todos.
- **Builder** (ideia do "Tuca" do a reference app, para equipes): um agente global de sistema (título "Designs agents and teams", acesso `ask`), criado na primeira vez que você usa **Build with AI** (tela Agents ou aba Agents do projeto), que abre um chat com ele no projeto. Ele entende o objetivo (no máximo 3 perguntas), lê a equipe para não duplicar (melhora um agente existente com `zorel_update_agent` em vez de criar um quase igual), propõe a equipe num cartão e, se o trabalho for recorrente, as rotinas. É um agente comum: dá para editar as instruções dele.
- `zorel_search_memories`: busca na memória além do orçamento do contexto (seção 8).
- **Navegador** (ideias do a reference app, mais enxutas): além de abrir, ler e clicar, `browser_hover`, `browser_select`, `browser_scroll`, `browser_upload` (só arquivos da pasta do chat, por input ou pelo seletor de arquivos), `browser_dialog` (alert/confirm/prompt são recusados por padrão e relatados no próximo resultado; aceitar o próximo é pedido explícito) e `browser_run` — até 20 passos declarativos numa chamada, devolvendo a página uma vez (o `run_script` do a reference app sem executar JavaScript arbitrário). Perfis separados por agente ficam de fora: cada perfil é outro processo do Chrome; entram se logins separados virarem necessidade.
- `zorel_routines`: lista, propõe e cancela rotinas (seção 13, fase 7), sempre com cartão.
- Cada perfil de agente guarda **versões** (quem mudou, quando) com restaurar, e exporta/importa como `.agent.json` sem a conta.

- **`zorel_start_task` (2026-11-04)**, a delegação com retorno: o colega trabalha num **chat próprio** (aparece na barra lateral com status ao vivo; título "<agente>: <tarefa>"), com a tarefa como primeira mensagem; quando a fila desse chat esvazia, a última resposta volta ao chat de origem como mensagem do colega, com o link "Open the task", e quem pediu faz o próximo turno ali. `reply: false` entrega sem retorno (cobre o `send_message` sem resposta). Limites: 4 tarefas abertas por chat, 2 níveis de aninhamento; colega com acesso maior que o de quem pede só trabalha com cartão de aprovação. `chats.task_of` (o chat que espera o resultado, zerado ao entregar) e `chats.task_by` (quem pediu). Testado ao vivo com Claude Haiku: delegar, responder e continuar em ~6 s.

- **Conversa entre agentes (2026-11-04, ideias do a reference app e do a reference app, código próprio):**
  - **Roteador (2026-11-04, ideias do a reference app e do a reference app):** numa equipe, a mensagem sem menção (e que não é complemento) vai para um turno marcado `route`; quando ele começa, uma chamada curta a um modelo barato (`ZOREL_ROUTER_MODEL`, ou o Haiku da assinatura Claude, ou o modelo do chat) lê os papéis da equipe e as últimas 10 mensagens e escolhe **um** agente: o especialista quando o pedido é de um colega, o líder quando é coordenação, vago ou de várias áreas (o líder então divide e fecha). Falha ou resposta ilegível: o líder. Linha "Sent to Tester · <motivo>". `server/router.ts`. Ao vivo: testes → Tester e README → Docsync direto (21 s cada); "lançar a v1" → Tech Lead, que dividiu e fechou.
  - **Gateway em SSE (2026-11-04):** as chamadas de ferramenta respondem em SSE com um ping a cada 30 s; antes, a resposta JSON só saía no fim, e o cliente HTTP dos engines (undici: 300 s até o primeiro byte) derrubava qualquer aprovação ou pergunta que esperasse mais de 5 minutos.
  - **Quem responde sem menção (antes do roteador):** o líder (que roteia pelas descrições dos colegas, ver prompt do canal); mas uma mensagem sem menção logo depois de você ter falado com um colega pelo @handle, e ele ter respondido, continua com esse colega (complemento, como no a reference app). O placeholder do campo diz para quem vai.
  - **Fechamento:** quem passa trabalho por @menção ganha um turno depois que **todos** os chamados respondem (as respostas chegam juntas, como as respostas retidas do a reference app), salvo se um deles já o chamou de volta; uma resposta que falhou também conta, para nada esperar para sempre. Linha "X handed back to Y".
  - **Formato de quem recebe trabalho:** Status: done | partial | blocked · Result · Evidence (curto, conferível; do a reference app). Quem pede não repete a resposta, só fecha; nunca menciona alguém só para agradecer.
  - **Uma entrega, um repasse:** um colega que recebeu `zorel_start_task` no turno não é chamado de novo pela menção dele na resposta.
  - **Limite:** 3 respostas seguidas sem mensagem sua; ao parar, a linha "The agents stopped here so they don't talk in circles. Send a message to go on." (como no a reference app).
  - **Steer** só aparece quando o motor do turno aceita correção no meio (Codex).
  - Testado ao vivo com Claude Haiku (Tech Lead + Tester + Docsync no demo-app): pedido sem menção → líder passa ao Tester com briefing → Tester responde em Status/Result/Evidence → líder fecha; complemento sem menção fica com o Tester; pedido de README + testes → líder divide entre os dois e fecha uma vez com as duas entregas.

- **`zorel_ask_user` (2026-11-04)**: o agente pergunta e espera. A pergunta é um cartão do tipo `question` no mesmo mecanismo das aprovações (chat, "Precisa de você", notificação, 30 min e depois segue): até 6 opções de um clique, resposta livre ou "Skip". A resposta viaja no `reason` do `decide` e volta como resultado da ferramenta ("The user answered: …"); sem resposta, o agente segue com o melhor palpite e diz o que assumiu. O status do chat diz "asks you something" (rótulo `question`). Testado ao vivo com Claude Haiku.

**Planejado — ferramentas** (`zorel.*`):

| Ferramenta | Comportamento |
|---|---|
| `list_agents` | Agentes visíveis com **responsabilidades**, status (`working`/`idle`), fila e última atividade. É o primeiro passo antes de delegar |
| `send_message(to[], text, expectsReply = true, replyTo?)` | Entrega na fila de cada destinatário. Com `expectsReply`, **a resposta final do destinatário volta sozinha** para quem pediu, como mensagem sem pedido de resposta. Há proteção contra loop de repasse (a origem da cadeia é carregada) e idempotência por chave, para reenvio não duplicar |
| `start_task(agent, text)` | **Feito como `zorel_start_task`** (acima). Planejado original: abre uma **tarefa paralela**: thread lateral com sessão própria e o resultado de volta. No máximo 2 tarefas rodando por agente (configurável até 4) e 8 abertas por iniciativa do próprio agente |
| `interrupt_agent(agent)` | Só interrompe trabalho **que o próprio chamador pediu**. Nunca trabalho seu, de rotina ou de outro agente. Cancela primeiro os pedidos dele que estão na fila e deixa um aviso ao alvo do motivo da parada |
| `ask_user` | **Feito como `zorel_ask_user`** (acima). Planejado original: pergunta a você (aparece em "Precisa de você"). No Claude, usa o `AskUserQuestion` nativo |

**Semântica:**
- **Pedido para vários agentes:** as respostas esperam na fila de quem pediu até **todas** as cópias terminarem, e então entram num turno só, que diz quem não respondeu. Uma mensagem sua não espera: entra na hora e leva o que já chegou.
- **Agente ocupado:** a mensagem de outro agente segue o modo do destinatário (fila por padrão, ou steering se o harness suportar). Respostas de pedido múltiplo e trabalho de canal ficam sempre na fila, para chegarem juntas.
- **Política de delegação no prompt base:**
  - consultar `list_agents` antes de dizer que não consegue;
  - delegar a quem tem a responsabilidade;
  - nunca devolver a tarefa a quem a passou;
  - não narrar preparação nem trocar confirmações em loop;
  - resposta delegada no formato **Status / Resultado / Evidência / Desbloqueio**;
  - a síntese para você começa com o nome do colega;
  - nunca dizer que verificou algo sem resultado de ferramenta ou resposta que mostre isso;
  - pode oferecer criar um especialista, mas só cria se você aceitar.

**Canais:**
- **Roteamento determinístico primeiro:** destinatário explícito, `@menção` ou `@todos`, resposta a uma tarefa, membro único.
- **Sem isso, o líder decide** numa chamada sem ferramentas, lendo o resumo do canal e as **responsabilidades** dos membros.
- Cada membro escolhido recebe a sua tarefa.
- Limites: até 8 atribuições automáticas por pedido e 2 em paralelo por canal.
- O repasse por `@menção` entre agentes continua com teto de 3 respostas seguidas sem mensagem sua.

**Visibilidade (onde o Zorel vai além):**
- A troca entre agentes aparece no chat como um bloco **recolhido** "conversa entre agentes": quem pediu o quê, a quem, e o resultado.
- O **consumo por delegação** (tokens e custo de cada colega) entra na área de consumo.
- O **"o que o modelo viu"** de cada colega também fica acessível.

## 10. Front

- **Runtime da página:** `ZorelClient = AtomHttpApi.Service(...)` + `AtomRpc` sobre WebSocket com reconexão.
- **CRUD:** `ZorelClient.query(..., { reactivityKeys })` + `Atom.swr`. Mutations com as mesmas chaves revalidam sozinhas, e o `reload()` some.
- **Chat:** `Atom.family(chatId → subscribeChat)`. O componente lê o estado (snapshot + eventos) e renderiza a resposta ao vivo agrupada.
- **Como ficou (2026-11-03, `apps/web/src/client.ts`):** `Zorel` (`AtomHttpApi`) e `Live` (`AtomRpc`, um WebSocket). Uma query por recurso com a chave dele (`projects`, `agents`, `chats`, `memories`, `servers`, `accounts`, `keys`, `models`, `usage`, `approvals`). O chat é `Atom.family` sobre `subscribeChat` dobrado por `reduceChat` com `Stream.scan`; não usa a query de stream do `AtomRpc` porque ela acumula em lotes (`PullResult`). Os status de todos os chats vêm de um átomo mantido vivo sobre `subscribeStatus`. Quando um chat sai de "rodando", o `App` invalida `chats`, `memories`, `usage` e `approvals`, porque o server muda título, memórias propostas e consumo sozinho. Sem `Atom.swr` por enquanto: a invalidação por chave basta.
- **Design system:** ver 10.3.

## 10.3 Design system (D19)

**Fundação (regras inspiradas no `ui-foundation.md` do a reference app, implementação nossa):**
- **Escala de controles:** 24 px (apoio), 28 px (barras), **32 px (padrão)**, 36 px (ação importante). Já existe em `styles.css` (`--spacing-control-*`).
- **Tema:** dark por padrão, light por `data-theme`, seguindo o sistema. O tema light só **troca valores** de tokens, nunca cria tokens.
- **Só tokens:** cor, tamanho de texto, raio, sombra e duração vêm dos tokens `--z-*`. Literal de cor fora do arquivo de tokens é erro.
- **Interação:** hover só com ponteiro fino (`@media (hover: hover) and (pointer: fine)`); pressionar = `scale(0.97)`; animações abaixo de 300 ms e respeitando `prefers-reduced-motion`.
- **Estados obrigatórios** em todo componente: padrão, hover, `focus-visible`, ativo, desabilitado, carregando/vazio quando se aplica. Teclado completo e rótulo acessível (`IconButton` sempre com `label`).

**Primitivas** (`apps/web/src/ui/`, a única API visual das telas):
- **Simples:** `Text`, `Heading`, `Button` (`default` para a ação principal do contexto, `secondary`, `ghost` em barras, `destructive`, `link`), `IconButton`, `Badge`, `Card`, `Separator`, `Spinner`, `Skeleton`, `Kbd`.
- **Formulário:** `Field` (rótulo, descrição, erro, `aria-describedby`) envolvendo `Input`, `Textarea` e `Select`. `Switch` só para mudança imediata.
- **Origem: shadcn.** O CLI (`shadcn init --base aria`, depois `shadcn add <componente>`) copia o código para `ui/`. **O código é nosso**: sem dependência do shadcn em runtime, editável à vontade. Base headless: **React Aria Components** (Adobe). É referência em acessibilidade (teclado, foco, leitores de tela) e traz internacionalização embutida (datas, números, direita-para-esquerda por locale), o que reforça a D13. **Radix e Base UI não são usados.**
- **Tema:** o `styles.css` mapeia uma vez os tokens semânticos do shadcn (`background`, `foreground`, `primary`, `border`, `input`, `ring`, `popover`…) para os `--z-*`. A paleta neutra e o `--radius` padrão do shadcn não são usados. Alturas ajustadas à escala 24/28/32/36.
- **Complexos, sobre React Aria via shadcn**: `Dialog`, `AlertDialog`, `DropdownMenu`, `Popover`, `Tooltip`, `Tabs`, `RadioGroup`, `Combobox`. As telas **nunca importam a biblioteca headless nem os ícones direto**, só as primitivas. Assim, trocar ou atualizar a biblioteca não toca nenhuma tela (mesmo princípio do a reference app com o Kobalte).
- **Do Zorel:** bolha de mensagem, bloco de passos de ferramenta, cartão de aprovação, cartão de proposta, chip de membro, seletor de modelo e conta, inspetor "o que o modelo viu".

**Artefatos do impeccable** (na raiz de `apps/web`):
- **`PRODUCT.md`** (`/impeccable init`): o que é o Zorel, para quem, modo **Operate** (app de trabalho: legibilidade, consistência e expectativas nativas acima de expressão; a marca vive nos detalhes) e tom.
- **`DESIGN.md`** (`/impeccable document`): os tokens em YAML e as regras acima, gerados do código atual. É a referência que todo agente (e todo dev) consulta antes de criar tela.

**Fluxo por tela ou fase:**

| Momento | Comando | Saída |
|---|---|---|
| Antes de uma tela ou fluxo novo | `/impeccable shape` | Plano de UX/UI antes do código |
| Durante as edições de UI | detector ligado (`/impeccable hooks on`) | Problemas mecânicos na hora: contraste, overflow, literais, fontes |
| Ao terminar a tela | `/impeccable audit` | Acessibilidade, desempenho, responsivo |
| Ao fechar a fase | `/impeccable polish` (um passe, com limite) | Acabamento final |
| Textos, erros e i18n | `/impeccable harden` e `clarify` | Estados de erro, casos de borda, textos curtos e claros |
| Componente repetido em 2+ telas | `/impeccable extract` | Vira primitiva |

**Verificação mecânica no CI:** `check:ui` falha com cor literal fora dos tokens, tamanho, raio ou duração fora da escala, `<button>` ou diálogo feito à mão nas telas, ou import direto da biblioteca headless ou de ícones fora de `ui/`. É o equivalente leve do `check:ui` do a reference app. Funciona como catraca (`scripts/check-ui.ts`): a dívida que já existe fica congelada em `apps/web/ui-baseline.json` por arquivo e regra, e só pode cair; `bun run check:ui --update` trava a melhora. `src/ui/` e `src/dev/` ficam de fora, porque são o próprio design system.

**Protótipo das telas** (fonte do redesenho, fase UI): chat com pílulas expansíveis e painéis direito e de baixo, "Precisa de você", conhecimento, agente, consumo e configurações (conectores, MCP, skills). Link no `.agent/memory/design-system.md`.

**Sem galeria (decisão do usuário, 2026-11-03):** não há página de primitivas nem Storybook. As telas reais são a referência visual; as primitivas são verificadas pelo `check:ui`, pelo detector e pela revisão das telas nos dois temas.

---

## 10.1 Internacionalização (D13)

**Hoje (2026-11-03):** feito na web. `packages/i18n` tem o catálogo `en.ts`, `t()` com plural por `Intl.PluralRules` e formatadores (números, porcentagem, duração, idade, data). O `check:i18n` (`scripts/check-i18n.ts`) lê a AST de cada `.tsx` com `@babel/parser` e falha com texto em JSX ou em props lidas pela pessoa (`placeholder`, `aria-label`, `title`…). Falta no server: as dicas de modelo (`listModels`) e o rótulo do status ainda saem como texto; a web ignora os dois e monta o texto pelo catálogo.

**Alvo:**

- **`packages/i18n`:** `en.ts` é o catálogo fonte, um objeto aninhado por área (`chat.send`, `knowledge.approve`…). Os outros idiomas são `satisfies Messages`, então chave faltando ou sobrando quebra o typecheck.
- **API de uso:** `t("chat.send")` e `t("knowledge.pending", { count })`.
  - Plural com `Intl.PluralRules`.
  - Datas e números com `Intl.DateTimeFormat` / `Intl.NumberFormat`.
  - Interpolação simples (`{count}`), sem HTML no catálogo.
- **Idioma:** só `en` por enquanto. A escolha (`navigator.language`, preferência salva) já passa por uma função única, para não mudar quando houver outros idiomas.
- **Server:** erros e avisos ao usuário saem como **código + parâmetros** (`{ code: "chat.busy" }`, `{ code: "agents.chain_stopped", max: 3 }`) no contrato, e o front traduz. O server não manda frase pronta para a interface.
- **Prompts dos modelos:** em inglês (prompt base, consolidação, protocolo de canal). A instrução "responda no idioma do usuário" continua valendo, então o idioma da conversa não depende do idioma da interface.
- **Conteúdo do usuário** (brief, memórias, mensagens, nomes) **não é traduzido**: fica como foi escrito.
- **Verificação:** um script no CI acusa texto literal em JSX (`check:i18n`, como o `i18n-check` do a reference app), com exceções explícitas.

## 10.2 Área de consumo (D15)

**Hoje (2026-11-03, fase 2c concluída):**
- **Custo:** `pricing.ts` lê o catálogo do models.dev (USD por 1M de tokens), guarda em `<dataDir>/pricing.json` e atualiza uma vez por dia; offline usa a última cópia. Cada turno e mensagem grava `cost` e `account_id`. Apelidos das CLIs (`claude-cli/opus`) usam o modelo mais novo da família.
- **Janelas de limite:** `POST /api/accounts/:id/limits` lê todas as janelas da conta pela própria CLI (Claude: `usage_EXPERIMENTAL…` do Agent SDK; Codex: `account/rateLimits/read` num app-server curto). Cache de 4 min, uma leitura por vez, falhas com espera crescente (5 a 60 min). Os eventos `limits` dos turnos também atualizam as janelas.
- **Tela Usage** (layout inspirado no Usage do a reference app): filtros de agente, métrica (custo ou tokens) e período no cabeçalho; número principal com o total; harnesses com participação (a legenda do gráfico); área empilhada por dia e harness com leitura por hover e teclado; totais de tokens (com e sem cache); detalhamento por modelo, agente, projeto, conta ou dia; um cartão por assinatura com as janelas e o reset; turnos mais caros (`GET /api/usage/top`); aviso a partir de 80% (`LIMIT_ALERT`). A barra lateral mostra a janela mais cheia ao lado de Usage, e cada resposta mostra conta e custo.
- **Nomes reais dos modelos:** o seletor usa a lista que cada CLI oferece hoje (`supportedModels()` do Agent SDK, `model/list` do Codex), com nome e descrição ("Opus 5.5"). Fica em `preferences` (`cliModels`), é servida na hora e relida em segundo plano depois de 1 h; sem CLI, voltam os apelidos fixos.

**Fonte dos dados:** a tabela `turns`, que a fase 1 já grava. Cada turno registra conta, modelo, harness, tokens (entrada, cache lido, cache escrito, saída), custo estimado, tempo até o primeiro token, tempo total e trocas de failover.

**Custo:**
- **API key:** custo estimado = tokens × preço do modelo. O preço vem do catálogo do OpenCode/models.dev, com a possibilidade de corrigir à mão.
- **Assinatura:** o custo por token não se aplica. Mostra o "equivalente em API", só como referência, e o que importa: as janelas de limite.

**Janelas de limite por conta**, lidas do harness:
- Claude: `rate_limit_event` com janela de 5 h e janela semanal.
- Codex: `account/rateLimits/read`.
- Outras: quando o harness reportar.

A leitura acontece **uma por vez, com cache de 4 min e espaçamento crescente em falha** (5/10/20/40 min, até 1 h), mesma cadência do a reference app e do T3 Code, para não gastar limite só para medir.

**Tela:**
- Mês atual por agente, projeto, conta e modelo, com gráfico diário.
- Cartão por conta de assinatura: uso das janelas e horário de reset.
- Os turnos mais caros, com link para o chat.

**Alertas e orçamento** (opcionais):
- Aviso ao atingir 80% de uma janela de assinatura ou de um orçamento mensal (por agente ou por conta de API key).
- Ao atingir 100% do orçamento: o turno pede confirmação para continuar. Não bloqueia em silêncio.
- O limite de assinatura alimenta o failover (seção 6.1).

**No chat:** cada mensagem já mostra tokens. Passa a mostrar também o custo estimado, ou "assinatura", e a conta usada.

## 11. Segurança

- **Server só local:** escuta em `127.0.0.1` e o `LocalOnly` exige Host e Origin locais.
- **Segredos:** chaves de API e variáveis MCP no chaveiro do sistema, nunca no banco nem devolvidas pela API.
- **Login das CLIs de assinatura:** nunca é lido nem guardado.
- **Termos:** usar a assinatura do Claude via Agent SDK num app de terceiros é zona cinzenta. O a reference app documenta que a Anthropic não confirmou que é permitido e recomenda API key. O T3 Code faz o mesmo que nós: a CLI oficial com o login do próprio usuário. O Zorel mostra esse aviso ao conectar uma conta de assinatura Claude. Com API key, o caminho é o OpenCode, sem esse risco.
- **Ferramentas** só pelo gateway, com política e aprovação.
- **Armazenamento** (Settings › Storage, 2026-11-03): mede a pasta de dados sob demanda (workspaces, anexos, banco, backups, pastas de chat, contas), por projeto e os maiores chats. Limpar só remove backups antigos (fica o mais recente) e pastas de chats e projetos apagados; nunca roda `git gc` nos snapshots, porque as árvores não têm refs e o gc apagaria o histórico do diff e do desfazer. Cada limpeza vai para o audit log.
- **Audit log** (Settings › Audit log, 2026-11-03): cada mudança em providers (contas, chaves por nome, nunca o valor), projetos, agentes, servidores MCP, termos de failover, cada aprovação ou negação e cada turno desfeito. Feito com os helpers de auditoria do evlog (`defineAuditAction`, `audit`, `auditDiff` com campos sensíveis redigidos) e gravado na tabela `audit_events` dentro do mesmo Effect da mudança; falha ao gravar só loga, nunca desfaz a mudança. Só SQLite por enquanto: sem diário com cadeia de hash.
- **Sanitização de segredos** antes de gravar observações e páginas (seção 8, captura).
- **Conteúdo não confiável:** saída de ferramenta, páginas e memórias são tratadas como não confiáveis no prompt base.

---

## 12. Transversal

Pela régua da D0, cada tema na forma mínima.

**Observabilidade:**
- Logs estruturados do Effect (`Effect.log*` com anotações de chat, turno, agente e conta), sempre passando pelo **mascaramento de segredos**: os valores do `Secrets` são registrados como sensíveis, como no `registerSecretValue` do a reference app.
- Spans do Effect por turno, chamada de engine e chamada de ferramenta.
- **"Exportar diagnóstico"** gera um JSON com versões, status dos harnesses e contas (sem e-mail nem token), contagens e erros recentes. Nunca inclui conteúdo de conversa.

**Testes**, em três camadas:
1. **Unitários** de funções puras: montagem de contexto, política e classificação de ferramentas, parsers, consolidação sem LLM e menções.
2. **Ponta a ponta com engine falso**: server real, banco em memória e client tipado. É o padrão de hoje (`main.test.ts`). Cobre cada critério de pronto das fases.
3. **Smoke com CLIs reais** (Claude Code, Codex, OpenCode): manual ou agendado, nunca obrigatório no CI, porque gasta assinatura.

No CI rodam lint, typecheck, i18n e as camadas 1 e 2. **Cada migration tem teste** que parte do schema anterior com dados.

**Migração dos dados atuais** (fase 1):
- Uma migration do Drizzle traz o schema de hoje inteiro: projetos, agentes, chats, membros, mensagens, memórias, servidores MCP.
- Na fase 3b, memória vira página `fato` e skill vira `como-fazer`, mantendo estado, escopo e datas.
- **Backup automático** do arquivo antes de migrar. Teste com um banco real copiado.

**Backup e exportação:**
- Backup do arquivo SQLite com `VACUUM INTO`: diário e antes de cada migration, guardando os últimos 7.
- **Exportar e importar o workspace** em `.zip` (projetos, agentes, chats, conhecimento e configurações), **sem segredos**. Servidores MCP voltam desligados.

**Notificações** (desktop):
- Disparam em: aprovação ou pergunta esperando, tarefa ou rotina concluída ou com falha, limite de conta atingido, failover acionado.
- Ligam e desligam por tipo, agente e projeto. Não notificam a janela que está em foco.

**Anexos e imagens** (fase 2):
- Arrastar ou colar no chat. Limites de 10 por mensagem, 20 MB cada.
- Guardados em `ZOREL_HOME/attachments/<chat>`.
- Imagem vai como imagem para o harness que suporta (Claude SDK, Codex `--image`/item local, OpenCode). Outros arquivos vão como **caminho**, para o agente ler com as ferramentas dele.
- Apagar o chat apaga os anexos.

**Atualização do app** (fase 7):
- O electron-builder gera o pacote (dmg; `electron-updater` com canais `stable` e `beta` quando houver Developer ID — o macOS só atualiza app assinado).
- **A troca espera os turnos em andamento terminarem.** As migrations rodam na subida, depois do backup.
- O server em background reinicia na versão nova.

## 13. Fases

**Ordem:** engine primeiro (fases 1 e 2), depois a interface nova (fase UI), desenhada a partir do protótipo e sobre os eventos reais. Cada fase termina com lint, typecheck e testes verdes e um teste real com Claude Code e Codex. A partir da fase UI, também `check:ui` e `check:i18n` verdes e, nas telas que mudaram, **detector limpo + `/impeccable audit` + um passe de `/impeccable polish`**.

| Fase | Entrega | Pronto quando |
|---|---|---|
| **1. Runtime** (concluída em 2026-11-03) | **Contrato de eventos** (`ChatEvent`, `ZorelRpc`, feito); **banco migrado para Drizzle + `@effect/sql-sqlite-bun`, com a migração dos dados atuais e backup** (seção 12); logs com mascaramento e spans; testes nas camadas 1 e 2 no CI; (com dono/público nas tabelas que guardam conhecimento), **`Actor`**, `turns`, fila, `ZorelRpc` + `subscribeChat`, interrupt, recuperação no boot, deltas agrupados, medição por turno gravada em `turns`, erros do server como código. **A tela de chat atual só passa a consumir o `subscribeChat`** (sem redesenho) | Fechar a aba no meio de um turno e reabrir mostra o turno continuando. `kill -9` no server marca o turno `interrupted` com o texto parcial. Reenviar o mesmo `clientId` não duplica |
| **2. Engines vivos** (concluída em 2026-11-03) | Claude Agent SDK + Codex App Server com sessão, marcação por sessão, steering, `setModel`, esforço de raciocínio, imagens. **Só assinaturas** (API keys são da fase 5). **Multicontas de assinatura** (`provider_accounts`, login dentro do Zorel, `accountId` em agente e chat); **anexos e imagens** (seção 12) | O segundo turno no mesmo chat não sobe processo. Trocar Claude → Codex → Claude envia só o delta ao voltar. Os números de latência e cache estão registrados |
| **UI. Interface nova** (concluída em 2026-11-03) | Design system completo: `DESIGN.md` atualizado pelo protótipo, tokens, primitivas que faltam, `check:ui` no CI, detector ligado; estrutura do app (barra lateral em árvore com status ao vivo) e **todas as telas reescritas uma vez**, já com **`packages/i18n` (en) e `t()`** e **átomos no chat e no CRUD**; pílula de atividade expansível, cartões de aprovação, seletor de modelo com contas | Nenhum texto literal em JSX fora do catálogo (`check:i18n` verde), `check:ui` verde, detector limpo e `/impeccable audit` em cada tela |
| **2b. Failover** (concluída em 2026-11-03) | Lista de alternativas por agente e chat, classificação de erros por adaptador, espera por limite com retorno automático, regra "só se ainda não agiu", aviso de termos, leitura de uso por conta, trocas visíveis no chat | Com a conta principal em limite, o turno continua na alternativa e volta sozinho após o reset. Um erro depois de uma ferramenta de escrita não repete o turno. Sem lista configurada, nada troca |
| **2c. Consumo** (concluída em 2026-11-03) | Área de consumo (seção 10.2): agregados por agente, projeto, conta e modelo; custo estimado; janelas de limite por conta; alertas | A tela mostra o consumo do mês por agente e o quanto falta de cada assinatura com o horário de reset. Um alerta de 80% aparece antes do limite |
| **3. Workspace de código** (fase central, concluída em 2026-11-03) | `projects.path`, serviço `Workspace`, `cwd` do projeto, níveis de acesso, aprovação das ferramentas nativas, **diff das mudanças de cada turno** no painel direito (Changes e Files, com `@pierre/diffs`) e o terminal só leitura com os comandos dos agentes, **checkpoint e desfazer** (`rewindFiles` no Claude, git nos outros), passos de trabalho e handoff tipado | Um agente lê, edita e roda os testes do projeto com aprovação. O diff do turno aparece no chat e dá para desfazer. Depois de trocar de provider, o novo agente sabe o que foi feito |
| **3b. Conhecimento aprendido** (base feita em 2026-11-03, enxuta: tabela `pages` à parte das memórias — escopo você/projeto/agente, Markdown até 100k, FTS5 `page_index` por gatilhos, toda edição vira `page_versions` com restaurar, fixar põe só o título no contexto; agentes com `zorel_knowledge_search`/`read`/`write`, escrita no projeto ou no agente direto como versão e sobre você só com aprovação; aba Pages na tela Knowledge. Fica para depois, na ordem do valor: curador automático ao fim da conversa (hoje o agente escreve quando decide), links entre páginas, espelho em Markdown na pasta, ingestão de documentos e a revisão periódica de contradições — tudo com a wiki do a reference app como referência) | Seção 8: páginas (migração de memórias e skills), captura por turno com segredos removidos, consolidação sem LLM (página de sessão + handoff) e com LLM opcional, resumo de entrada, `zorel.knowledge_search`/`read`, tela Conhecimento com feed, versões e desfazer, fila de aprovação do que é sobre você, "o que o modelo viu" | Depois de um chat de trabalho, a página de sessão e o handoff existem sem nenhuma chamada de LLM. Um chat novo no projeto recebe o resumo de entrada e acha por busca a decisão tomada antes. Desfazer uma atualização de página restaura a versão anterior |
| **3c. Painel de execução** (concluída em 2026-11-03, enxuta: scripts do `package.json` em abas do terminal e Servidores com abrir no navegador e parar; Tests e Problems são os scripts `test`/`typecheck`/`lint` rodando ali, com a saída indo ao agente por "Add to chat" e os caminhos clicáveis. Listas próprias de testes e problemas entram se esse fluxo não bastar) | Painel de baixo: terminal interativo na pasta do projeto (sujeito às aprovações), Tests (rodar de novo as falhas, mandar para um agente), Problems (`tsc` e Biome), Processes (servidores com parar e reiniciar) e Logs | Um teste quebrado aparece em Tests e um agente o corrige a partir dali. Um servidor iniciado por um agente aparece em Processes e pode ser parado |
| **4. Equipe** (feita em 2026-11-03, enxuta: tela Agents; criar/editar agentes e equipes pela conversa com cartão de proposta, acesso nunca acima de quem propõe; Builder; versões com restaurar; exportar/importar sem segredos; agente padrão por projeto; catálogo de conectores MCP pré-preenchidos (GitHub, Notion, Context7, Figma, Playwright, Filesystem, Postgres) com token, sem OAuth no app; notificações e pausar tudo. "Responsabilidades" ficam na descrição do agente, que é o que os outros leem para rotear — um campo à parte entra se a descrição não bastar. Fica para depois: OAuth dos conectores, construtor com chat de teste, "sempre permitir" persistido) | Agente como dado versionado (versões, publicação, voltar versão, exportar sem segredos); campo de **responsabilidades**; criar e configurar agentes pela conversa (`zorel.create_agent`/`update_agent`/`read_agent`/`list_models`) com **cartão de proposta**; construtor com chat de teste; **interação da seção 9.3** (`list_agents`, `send_message` com resposta automática e espera de pedidos múltiplos, `start_task`, `interrupt_agent`, `ask_user`, política de delegação, roteamento do líder); **aprovações da 9.2** (três níveis, "sempre permitir", recusa com motivo, persistidas, "Precisa de você", regras de restrição e herança); tela de equipe com status, fila e consumo; **catálogo de conectores** (GitHub, Notion, Figma… como servidores MCP já configurados, com login OAuth); **notificações** (seção 12); agente padrão por projeto | Um agente delega a dois colegas, as duas respostas voltam juntas num turno só, e a aprovação de um deles aparece no chat de origem e em "Precisa de você". Um agente em Workspace não consegue criar um colega com Acesso total. Restaurar uma versão anterior do perfil funciona |
| **5. ACP** (começou em 2026-11-03, enxuto: `engines/acp.ts` próprio, um cliente JSON-RPC por stdio só com o que o Zorel usa — `initialize`, `session/new` com o gateway de ferramentas como MCP HTTP quando o agente aceita, `session/set_model`, `session/prompt`, `session/update` virando texto e passos, `session/request_permission` respondido pelo nível de acesso (em "Perguntar antes" recusa e avisa na resposta; cartão de aprovação fica para a versão com sessão viva). Sem estado entre turnos, como o fallback de CLI. Providers **OpenCode** (`opencode acp`, testado ponta a ponta) e **Gemini CLI** (`gemini --acp`; o Google desligou o cliente para contas individuais, então só funciona com conta Workspace/chave). No seletor aparecem quando o binário está instalado. **Confinamento (2026-11-04):** abaixo de "Acesso total", o processo inteiro do agente ACP roda no sandbox do macOS (`sandbox-exec`, Seatbelt): escrita só na pasta do chat (em Workspace, mais o `.git` principal de uma worktree), temporárias, caches e as pastas de estado da própria CLI; leitura, rede e processos ficam abertos. Fora do macOS, abaixo de "Acesso total" o turno é recusado (Linux com bubblewrap entra quando houver uso). Ideia do a reference app, código próprio. **Chaves de API pelo OpenCode (2026-11-04):** um turno de chat com modelo de chave (Anthropic, OpenAI, OpenRouter, Ollama, LM Studio) roda no `opencode acp` quando ele está instalado: config em `OPENCODE_CONFIG_CONTENT` (modelo `provedor/modelo`; locais como provedor OpenAI-compatível com a URL), a chave numa variável que a config referencia (`{env:ZOREL_PROVIDER_KEY}`), sem `.claude`, skills externas nem config do projeto do usuário; mesmo sandbox e permissões dos agentes ACP. Tarefas internas e máquinas sem OpenCode seguem no motor direto (`ZOREL_API_ENGINE=direct` força). Testado ao vivo o caminho de injeção (config + sandbox) com o provedor gratuito do próprio OpenCode; com uma chave paga real ainda não. Os tokens vêm na resposta de `session/prompt` (`usage`) e entram no consumo. Falta: sessão viva, modelos lidos do harness (o OpenCode os lista em `configOptions` ao abrir a sessão)) | `effect-acp`, **primeiro com OpenCode como harness de todas as API keys**, inclusive Anthropic e OpenAI (config injetada), **com várias chaves por provider**; depois Gemini CLI, Cursor, Kimi…; várias contas; modelos lidos de cada harness. O engine `api` deixa de aparecer como agente de projeto | Um agente de projeto com uma chave do OpenRouter lê, edita e roda testes igual a um com Claude |
| **6. Conhecimento 2** | Itens do backlog da seção 8.1 que tiverem batido o critério de entrada, mais a avaliação de recall rodando no CI | Cada item entra com o número que justificou a entrada registrado |
| **7. Automação local** (em andamento: server do desktop em processo próprio, que segue com a janela fechada, feito em 2026-11-04 (falta abrir no login e atualização do app); rotinas feitas em 2026-11-03 — cada rotina é de um agente e tem o próprio chat; cada execução é uma mensagem nele pelo runtime normal; cron com `croner` (fuso e horário de verão) checado a cada 30 s, alcançando uma vez o que perdeu dormindo; "Run now"; webhook local `POST /api/hooks/:token` com o corpo na mensagem; execução idempotente por horário (clientId) e pulada se o chat estiver ocupado; agentes listam, propõem e cancelam com `zorel_routines`, sempre com cartão de aprovação. Falta: server em background, atualização do app, exportar/importar workspace) | Server do desktop em background separado da janela; rotinas (cron, horário de verão) com agente responsável, rodando uma **versão publicada** do agente; webhooks com HMAC sobre `effect/workflow`; **atualização do app** com canais e espera de turnos (seção 12); exportar e importar workspace | Uma rotina diária roda com o app fechado (server/desktop em background) |
| **8. Hospedado** | Sobre as portas da D17: login (e-mail + senha ou OIDC) e `Actor` real; equipe e papéis simples; memória por público aplicada; cofre de segredos no banco com criptografia envelope; Postgres (`@effect/sql-pg` + schema Drizzle portado); container por projeto ou agente; imagem Docker + binário único; API para rodar agentes; runtime leve para agentes de automação (sem harness); canais (Slack, Telegram) | O mesmo Zorel roda num servidor com login, duas pessoas usam projetos diferentes, uma memória privada nunca aparece no projeto da outra, e o shell do agente roda isolado em container |

**Fora do escopo atual:** sincronização entre dispositivos, **app mobile e interface nativa** (gpui, SwiftUI, Tauri com tela nativa; o desktop é Electron com a interface web, D11/D20), router por LLM, pool com rodízio de contas e assinatura macOS.

**Backlog avaliado (sem fase ainda):** **loja de agentes prontos** (agentes publicados com instruções, poderes, skills e rotinas, instaláveis em um clique; a ideia do usuário em 2026-11-04, no lugar de modelos fixos no formulário; o a reference app tem um marketplace parecido); arquivos de contexto compartilhados com modo `inject`/`link` (AgenticOS; hoje o brief e as páginas fixadas cobrem: entra se o mesmo texto começar a ser repetido entre agentes); detector de loop de ferramentas, monitor de quebra de cache de prompt por run, revisor durante o run e auditoria encadeada por hash (ideias do AgenticOS); respostas visuais salvas como páginas; o Zorel como servidor MCP para outros clientes (Claude Code, Cursor). Os motivos estão em [references.md](references.md).
