# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Desenvolvedores e pequenas equipes (2–5 pessoas)** que trabalham com agentes de IA em projetos de código.

**Situação:** cada pessoa tem as próprias assinaturas (Claude, ChatGPT) e chaves de API e coordena vários agentes em vários projetos. Hoje cada CLI fica numa sessão isolada e é preciso reexplicar o contexto ao trocar de ferramenta, de modelo ou de colega.

**Trabalho a ser feito:** levar uma tarefa de código do pedido ao resultado com agentes que conhecem o projeto, continuar de onde parou (qualquer pessoa, qualquer modelo) e manter controle sobre o que os agentes fazem.

**Decisão em aberto:** como a equipe compartilha o Zorel antes do modo hospedado (fase 8 da arquitetura). Opções: um server do Zorel acessado pela rede da equipe ou adiantar parte da fase 8 (login e papéis simples). Nada desta decisão está implementado.

## Product Purpose

O Zorel é um workspace de agentes de IA organizado em **projetos**, com uma **equipe de agentes** por projeto e **chats** avulsos. Ele roda os harnesses que a pessoa já usa (Claude Code, Codex, OpenCode e outras CLIs via ACP) e guarda o contexto e o conhecimento do trabalho.

**Sucesso:** abrir um chat novo, ou trocar de modelo, e o agente já sabe o que foi decidido, o que falhou e como as coisas são feitas no projeto, sem ninguém reexplicar. Tudo que um agente faz que muda algo fica visível e passa pelo nível de aprovação escolhido.

## Positioning

O que T3 Code, OpenBot e Claude Code não podem dizer com verdade:

1. **O contexto é do Zorel, não da sessão da CLI.** Trocar de modelo ou de provider a qualquer momento não perde nada. O contexto é montado em camadas pelo Zorel e serve de ponto de retomada para qualquer harness.
2. **Aprende trabalhando.** O trabalho vira conhecimento do projeto (decisões, armadilhas, como-fazer, sessões) com versões e desfazer. O que é sobre a pessoa passa pela aprovação dela.
3. **Equipe de agentes com responsabilidades.** Os agentes delegam entre si, com aprovações claras e a troca entre eles visível no chat.
4. **Usa o que você já paga.** Assinaturas pela CLI oficial e chaves de API (via OpenCode), com várias contas por provider, troca automática opcional quando o limite acaba e consumo visível.

## Operating Context

- **Uso:** no desktop (app Electrobun) e no navegador local. O modo hospedado vem depois.
- **Rotina:** abrir um projeto, falar com o agente líder ou mencionar um colega com `@`, aprovar ações, revisar o que o Zorel aprendeu e alternar modelo ou conta conforme custo e limite.
- **Ferramentas ao redor:** git, editor, terminal e servidores MCP (GitHub, Linear, Notion…), sempre escolhidos por projeto.

## Capabilities and Constraints

- **Projetos:** brief, pasta no disco, agente padrão, agentes, chats e conhecimento.
- **Chats avulsos e canais** com vários agentes.
- **Engines:** assinatura → harness do dono (Claude Agent SDK, Codex App Server, ACP); API key → OpenCode via ACP.
- **Aprovações em três níveis por agente** (Workspace, Perguntar antes, Acesso total) e tela "Precisa de você".
- **Ferramentas:** MCP por projeto, com política leitura / aprovação / automático.
- **Interface só em inglês por enquanto**, com i18n desde o início. O conteúdo do usuário nunca é traduzido.
- **Leve:** um processo, um arquivo de banco, nenhum serviço externo obrigatório.
- **Termos dos providers:** o Zorel nunca lê nem guarda o login das CLIs. Assinatura via app de terceiros é zona cinzenta e é avisada.
- **Detalhes técnicos e fases:** `docs/ARCHITECTURE.md` na raiz do repositório.

## Brand Commitments

- **Nome: Zorel** (trocado de "Zero" em 2026-11-04: "Zero" colidia com outros produtos e não tinha domínio). Domínio próprio: zorel.dev.
- **Open source, Apache-2.0.**
- **Tom:** direto, técnico, sem jargão vazio.
- **Direção visual:** escolhida pelo usuário como compromisso, **inspirada no OpenBot** (só referência; nenhum código ou CSS copiado). Os detalhes vivem no `DESIGN.md`.

## Evidence on Hand

- **O que existe:** código do MVP em `apps/`, testes ponta a ponta em `apps/server/src/*.test.ts`, ícone em `apps/desktop/assets/icon.svg` e documentação em `docs/`.
- **O que não existe, e não deve ser inventado:** usuários, depoimentos, métricas de uso, preços, comparativos de desempenho publicados.

## Product Principles

1. **Continuidade acima de tudo.** Ninguém deve precisar reexplicar o projeto: nem para outro modelo, nem para outro agente, nem para outra pessoa.
2. **Controle visível.** Toda ação que muda algo tem dono, aparece no chat e respeita o nível de aprovação. Todo aprendizado pode ser visto, desfeito ou esquecido.
3. **Leve primeiro.** Começar no mínimo útil e crescer só com evidência medida.
4. **Neutro de provider.** Funciona com as assinaturas e chaves que a pessoa já tem, sem prender a nenhum modelo.

## Accessibility & Inclusion

- Navegação completa por teclado, foco visível e rótulos acessíveis (base React Aria).
- Respeito a "reduzir movimento".
- Contraste adequado nos temas escuro (padrão) e claro.
