# Zero

Workspace open source de agentes de IA com **projetos**, **agentes de projeto**, **canais com vários agentes** e **chats**. O contexto é otimizado e o aprendizado é contínuo (memórias e skills). Os agentes usam **ferramentas MCP** com a sua aprovação. Você troca de modelo a qualquer mensagem, usando sua **assinatura** (Claude Code, Codex) ou um **token de API** (Anthropic, OpenAI, OpenRouter, Ollama, LM Studio). Roda como app web ou desktop.

## Por que

Ferramentas como o a reference app mantêm uma sessão longa por agente, e o contexto acumula ali dentro. No Zero, nenhuma sessão de CLI guarda estado. Cada turno é montado do zero, em camadas e com orçamento:

```
base → agente → canal → memórias do usuário → projeto (brief + memórias) → memórias do agente
     → skills → resumo do chat → memórias recuperadas pela mensagem atual → últimas mensagens
```

- **Janela curta:** quando passam de 50 mensagens desde o último resumo, as antigas são resumidas e as 30 últimas seguem literais. O botão **Compactar** faz isso na hora.
- **Aprendizado:** a cada consolidação, o modelo propõe **memórias** (fatos duráveis) e **skills** (procedimentos que valem repetir), com escopo de usuário, projeto ou agente. Elas **só entram no contexto depois que você aprova**.
- **Orçamento:** as memórias mais recentes ocupam até 8k caracteres. O resto e o passo a passo das skills ficam pesquisáveis (FTS5/BM25) e voltam quando a mensagem atual é relevante.
- **Troca de modelo:** como o contexto é nosso, trocar de modelo não exige handoff. O próximo turno só usa outro engine.

## Canais

Um chat pode ter vários agentes membros. O primeiro (★) é o líder e responde quando ninguém é mencionado. `@handle` escolhe quem responde. Um agente passa a vez mencionando outro, até 3 respostas seguidas sem mensagem sua. O líder usa o modelo do chat, e os outros membros usam o modelo de cada um. Assim um canal pode ter Claude escrevendo e Codex revisando.

## Ferramentas (MCP)

Cadastre servidores MCP locais (comando) ou remotos (URL), globais ou por projeto. Cada servidor tem um modo:

| Modo | O agente vê | Pede aprovação |
|---|---|---|
| Só leitura | só as ferramentas de leitura | — |
| Tudo, escrita com aprovação | todas | ferramentas que escrevem ou são sensíveis |
| Tudo, sem perguntar | todas | nada |

Ferramenta é classificada pelas anotações MCP e, sem elas, pelo nome (`delete`, `send`, `deploy`… são sensíveis).

Cada turno abre uma sessão própria num **gateway MCP local** com URL secreta. Essa é a única fonte de ferramentas de qualquer engine, e uma chamada fora da lista nunca roda. Os pedidos de aprovação aparecem no chat. Uma recusa volta ao modelo como resultado, e o modelo não tenta de novo.

As variáveis e cabeçalhos dos servidores (tokens) ficam no **chaveiro do sistema**, nunca no banco.

## Rodar

Requer [Bun](https://bun.sh) 1.4+.

```bash
bun install
bun run dev            # server em :4317 e web em http://localhost:5173
bun run start          # build do web + um processo só em http://127.0.0.1:4317
bun run desktop        # app desktop (Electrobun) em modo dev
bun run desktop:build  # gera .app, .dmg e pacote de atualização em apps/desktop/artifacts
bun run lint            # Biome
bun run test
bun run typecheck
```

Os dados ficam em `~/.zero` (mude com `ZERO_HOME`). O server escuta só em `127.0.0.1`.

## Modelos

O id é `<provider>/<modelo>`, e qualquer modelo pode ser digitado no seletor.

| Provider | Tipo | Como habilitar |
|---|---|---|
| `claude-cli/sonnet` | assinatura | `claude auth login` |
| `codex-cli/default` | assinatura | `codex login` (`default` usa o modelo padrão do Codex) |
| `anthropic/claude-sonnet-5-5` | API | chave em Configurações ou `ANTHROPIC_API_KEY` |
| `openai/<modelo>` | API | chave em Configurações ou `OPENAI_API_KEY` (`OPENAI_BASE_URL` opcional) |
| `openrouter/<modelo>` | API | chave em Configurações ou `OPENROUTER_API_KEY` |
| `ollama/<modelo>` | local | Ollama rodando (`OLLAMA_URL`). Os modelos são listados dele |
| `lmstudio/<modelo>` | local | LM Studio rodando (`LMSTUDIO_URL`) |

As chaves salvas pela interface vão para o chaveiro do sistema (`Bun.secrets`). Uma variável de ambiente tem precedência.

As assinaturas sempre rodam a **CLI oficial** que você já tem logada. O Zero nunca lê nem guarda o login OAuth dela. A CLI roda sem sessão salva, sem shell nem arquivos, sem seus hooks ou plugins, e só com as ferramentas do gateway. Cada provider tem termos próprios para uso por apps de terceiros. Usar uma assinatura de várias pessoas por um único Zero é arriscado.

`ZERO_MEMORY_MODEL` define o modelo da consolidação. Sem ela, usa o modelo do chat.

## Estrutura

```
packages/contracts   API e entidades (Effect Schema): fonte única de tipos do server e do web
apps/server          Bun + Effect HttpApi + bun:sqlite
  db.ts              migrations, repositório, índice FTS5 de memórias e skills
  engines.ts         engines de CLI (Claude Code, Codex) e de API (effect/ai, com loop de ferramentas)
  context.ts         montagem do turno em camadas, menções, prompt e parser da consolidação
  chat.ts            turno com streaming, canal (encadeamento), ferramentas com aprovação, consolidação
  tools.ts           hub de servidores MCP, política e gateway MCP por turno
  secrets.ts         chaves e variáveis no chaveiro do sistema
  main.ts            rotas (HttpApi + SSE em POST /api/chats/:id/send) e serviço do build web
apps/web             Vite + React 19 + Tailwind v4
  styles.css, ui/     design system (tokens --z-*, primitivas sobre React Aria via shadcn)
  state.ts           dados, rota (hash) e contexto
  features/          chat/canal, projeto e agentes, memórias e skills, ferramentas e configurações, seletor de modelo
apps/desktop         Electrobun: processo principal em Bun sobe o server e abre a janela nativa
```

## Distribuição

O CI (`.github/workflows/ci.yml`) roda typecheck, testes e build em todo push e PR. Num push na `main`, ele também gera o app macOS como artefato. A assinatura e a notarização ligam sozinhas quando estes segredos existem no repositório: `ELECTROBUN_DEVELOPER_ID`, `ELECTROBUN_APPLEID`, `ELECTROBUN_APPLEIDPASS` e `ELECTROBUN_TEAMID`. Sem eles, o app sai sem assinatura e serve para uso local. O app estável é um autoextrator: na primeira execução ele se instala no lugar onde está. Rode-o a partir de `/Applications` (arraste pelo `.dmg`). Rodado de dentro de um volume externo, a instalação falha. O ícone tem como fonte `apps/desktop/assets/icon.svg`, e `bun run --cwd apps/desktop icons` gera os tamanhos.

## Arquitetura

Decisões, estado atual, alvo e fases: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Referências

O que foi aproveitado do a reference app, do T3 Code e do a reference app, onde está e como é verificado: [docs/references.md](docs/references.md).

## Licença

[Apache-2.0](LICENSE).

## Créditos

Partes derivam do [a reference app](https://github.com/eduwxyz/a reference app) (Apache-2.0) e do [T3 Code](https://github.com/pingdotgg/t3code) (MIT). Detalhes em [NOTICE](NOTICE).
