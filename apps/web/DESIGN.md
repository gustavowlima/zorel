---
name: Zero
description: Workspace de agentes de IA para código, escuro, compacto e silencioso.
colors:
  frame: "#0d0d0d"
  canvas: "#1a1a1a"
  sidebar: "#0d0d0d"
  surface: "#232323"
  raised: "#262626"
  control: "#232323"
  control-hover: "#292929"
  control-active: "#2c2c2c"
  code: "#141414"
  border-subtle: "rgba(255, 255, 255, 0.06)"
  border-strong: "rgba(255, 255, 255, 0.1)"
  text: "#ffffff"
  text-secondary: "#dcdcdc"
  text-muted: "#979797"
  text-dim: "#8a8a8a"
  signal-blue: "#007cf7"
  signal-blue-hover: "#1f8fff"
  signal-blue-text: "#42a0ff"
  signal-blue-soft: "rgba(0, 124, 247, 0.16)"
  signal-blue-faint: "rgba(0, 124, 247, 0.08)"
  signal-blue-line: "rgba(0, 124, 247, 0.35)"
  success: "#31cf76"
  success-faint: "rgba(49, 207, 118, 0.07)"
  success-line: "rgba(49, 207, 118, 0.3)"
  warning: "#ff9412"
  danger: "#fd2f3b"
  danger-soft: "rgba(253, 47, 59, 0.16)"
  on-accent: "#ffffff"
  overlay: "rgba(0, 0, 0, 0.5)"
  diff-add: "rgba(49, 207, 118, 0.1)"
  diff-del: "rgba(255, 107, 115, 0.1)"
  agent-violet: "#6d5df6"
  agent-teal: "#12a594"
  agent-rose: "#e5484d"
  agent-amber: "#d6851e"
  agent-sky: "#3a8ee6"
  agent-green: "#46a758"
typography:
  title:
    fontFamily: "Inter Variable, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 600
  body:
    fontFamily: "Inter Variable, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 400
  body-medium:
    fontFamily: "Inter Variable, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 500
  small:
    fontFamily: "Inter Variable, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 400
  label:
    fontFamily: "Inter Variable, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    letterSpacing: "0.025em"
  code:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "12px"
rounded:
  inline: "4px"
  control: "8px"
  card: "12px"
  sheet: "16px"
  pill: "9999px"
spacing:
  control-xs: "24px"
  control-sm: "28px"
  control: "32px"
  control-lg: "36px"
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  6: "24px"
  8: "32px"
components:
  button-default:
    backgroundColor: "{colors.signal-blue}"
    textColor: "{colors.on-accent}"
    typography: "{typography.body-medium}"
    rounded: "{rounded.control}"
    height: "{spacing.control}"
    padding: "0 12px"
  button-default-hover:
    backgroundColor: "{colors.signal-blue-hover}"
  button-secondary:
    backgroundColor: "{colors.control}"
    textColor: "{colors.text}"
    typography: "{typography.body-medium}"
    rounded: "{rounded.control}"
    height: "{spacing.control}"
    padding: "0 12px"
  button-secondary-hover:
    backgroundColor: "{colors.control-hover}"
  button-secondary-active:
    backgroundColor: "{colors.control-active}"
  button-ghost:
    textColor: "{colors.text-muted}"
    typography: "{typography.body-medium}"
    rounded: "{rounded.control}"
    height: "{spacing.control}"
    padding: "0 12px"
  button-ghost-hover:
    backgroundColor: "{colors.control-hover}"
    textColor: "{colors.text}"
  button-destructive:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger}"
    typography: "{typography.body-medium}"
    rounded: "{rounded.control}"
    height: "{spacing.control}"
    padding: "0 12px"
  button-destructive-hover:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.on-accent}"
  input:
    backgroundColor: "{colors.control}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    height: "{spacing.control}"
    padding: "0 12px"
  sidebar-item:
    textColor: "{colors.text-muted}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    height: "{spacing.control}"
    padding: "0 10px"
  sidebar-item-active:
    backgroundColor: "{colors.canvas}"
    borderColor: "{colors.border-subtle}"
    textColor: "{colors.text}"
  badge-neutral:
    backgroundColor: "{colors.control}"
    textColor: "{colors.text-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    height: "20px"
    padding: "0 8px"
  badge-accent:
    backgroundColor: "{colors.signal-blue-soft}"
    textColor: "{colors.signal-blue-text}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    height: "20px"
    padding: "0 8px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
    padding: "16px"
---

# Design System: Zero

## Overview

**Creative North Star: "A Bancada Noturna"**

O Zero é uma bancada de trabalho para quem passa horas com agentes no fim do dia: escura, compacta e silenciosa. A interface some atrás do trabalho. Quem fala é o conteúdo do chat, o código e as decisões dos agentes. O cromo é feito de cinzas quase pretos que se separam por tom, não por linha, e um único azul de sinal marca o que é acionável ou exige atenção.

A densidade é de ferramenta profissional: controles de 28 a 32px, texto base de 13px, nada de espaço decorativo. A referência é o a reference app, só como direção (nenhum código ou CSS copiado). O tema escuro é o padrão. O claro existe e só troca valores dos mesmos tokens; nenhum componente sabe em qual tema está.

O movimento é curto e físico: um aperto de 0.97 ao pressionar, transições abaixo de 300ms, nada quando "reduzir movimento" está ligado.

**Key Characteristics:**
- Escuro por padrão, profundidade por camadas de tom.
- Um único acento azul, raro e funcional.
- Escala compacta de controles: 24 / 28 / 32 / 36px.
- Bordas quase invisíveis (5% e 9% de branco).
- Primitivas como única API visual; telas não estilizam controles.

## Colors

Cinzas neutros quase pretos em camadas, um azul de sinal e três cores de estado. Todos os valores vivem em `src/styles.css` (`--z-*`); o tema claro redefine os mesmos nomes em `[data-theme="light"]`.

### Primary
- **Azul de Sinal** (signal-blue): botão principal, foco, seleção e links. É a única cor de marca. Variantes: hover mais claro (signal-blue-hover), texto legível sobre fundo escuro (signal-blue-text) e fundo translúcido para badges e anéis de foco (signal-blue-soft).

### Neutral
- **Moldura** (frame): o fundo da janela, atrás de tudo. A barra lateral fica direto sobre ela.
- **Bancada** (canvas): o cartão único de conteúdo (chat, páginas), de cantos 16px.
- **Barra Lateral** (sidebar): mesmo tom da moldura; o item ativo é um pedaço da bancada (canvas + borda sutil).
  - Comporta-se como a barra lateral de um app de desktop: marca (que é a barra de título no app, região de arrastar a janela, com espaço para os botões dela), atalhos do topo e Settings ficam fixos; só as árvores rolam, sem barra visível, com um fio sutil na borda que tem conteúdo escondido.
  - Projetos e chats são uma árvore do React Aria (um Tab, setas, busca por digitação, `aria-level`). Projetos reordenam arrastando; chats só dentro do próprio grupo, nunca de projeto. Os sem projeto ficam na seção **Chats**.
  - Ações da linha (novo chat, ajustes) aparecem no hover ou foco no lugar da contagem, nunca sobre o nome ou a seta, e não recebem clique enquanto escondidas.
- **Superfície** (surface) e **Elevado** (raised): cards, blocos de código e painéis por cima da bancada.
- **Controle** (control, control-hover, control-active): fundo de botões secundários, campos e itens selecionados, em três degraus.
- **Borda sutil** (border-subtle) e **Borda forte** (border-strong): separação mínima; a forte só em foco de campo, tabela e citação.
- **Texto** em quatro degraus: text (títulos e conteúdo), text-secondary, text-muted (rótulos, itens inativos), text-dim (dicas, placeholders, seções). Todos passam 4,5:1 sobre a bancada; o text-dim é o cinza mais baixo que ainda passa.
- **Código** (code): blocos de código, terminal e diff, um degrau abaixo da bancada.

### Estados
- **success**, **warning**, **danger** (com danger-soft): só para estado real (ok, atenção, erro ou ação destrutiva). Nunca decoração.
- **Sobre o acento** (on-accent): texto branco sobre azul ou vermelho cheio; igual nos dois temas.
- **Esperando você** (signal-blue-faint + signal-blue-line): cartão de aprovação pendente. **Aprovado** (success-faint + success-line): recibo do que você aprovou.
- **Diff** (diff-add, diff-del): fundo das linhas adicionadas e removidas.

### Identidade dos agentes
- **Seis cores** (agent-violet, agent-teal, agent-rose, agent-amber, agent-sky, agent-green): cada agente recebe uma, na ordem em que entra no projeto. Aparecem só no avatar (quadrado com a inicial) e nunca em botão, link ou estado.

### Named Rules
**A Regra da Voz Única.** O azul de sinal é o único acento. Se ele aparece em algo que não é ação, foco, seleção ou link, está errado.

**A Regra do Token.** Nenhuma cor literal fora de `styles.css`. Uma cor literal quebra o tema claro.

**A Regra do Avatar.** Cor de agente vive só no avatar. Se ela pinta um botão, um link ou um estado, está errado: isso é papel do azul e das cores de estado.

## Typography

**Body Font:** Inter Variable (com -apple-system, BlinkMacSystemFont, Segoe UI)
**Mono Font:** ui-monospace (SFMono-Regular, Menlo)

**Character:** uma única família neutra e legível em tamanhos pequenos, com hierarquia por peso e tom, não por tamanho.

### Hierarchy
- **Title** (600, 15px): título de página e títulos dentro de respostas em markdown. É o maior tamanho do sistema.
- **Body** (400, 13px): texto padrão de toda a interface e do chat.
- **Body Medium** (500, 13px): botões e ênfase em listas.
- **Small** (400, 12px): rótulos de campo, metadados, botões pequenos.
- **Label** (500, 11px, caixa alta, 0.025em): rótulos de seção da barra lateral e badges.
- **Code** (12px, mono): código inline e blocos.

### Named Rules
**A Regra dos Quatro Tamanhos.** Só 11, 12, 13 e 15px. Hierarquia nova vem de peso (400/500/600) ou tom de texto, nunca de um quinto tamanho.

## Layout

Janela inteira em três camadas: moldura; barra lateral de 248px direto sobre ela; e um único cartão de conteúdo (bancada, cantos 16px, borda sutil) com 12px de margem da moldura. O cartão tem sempre o mesmo cabeçalho: título 15px semibold, uma descrição em text-muted ao lado e as ações à direita, com borda sutil embaixo.

- **Barra lateral em árvore:** atalhos (Precisa de você, Conhecimento, Consumo), depois PROJECTS com cada projeto como pasta. O projeto aberto mostra os chats embaixo, ligados por uma linha vertical que sai do centro do ícone; o texto do chat alinha com o nome do projeto. Chats sem projeto ficam em **General**. Status do chat numa segunda linha: ícone girando (rodando), relógio azul (esperando você); parado mostra só o tempo desde a última atividade. Depois, AGENTS do projeto aberto.
- **Chat:** mensagens numa coluna de leitura, campo de mensagem largo embaixo. Painel direito (Changes, Files) e painel inferior (Terminal, Tests, Problems, Processes, Logs) abrem e fecham, sem tirar o chat do lugar.
- **Páginas** (configuração, conhecimento, contas) ficam numa coluna de até 720–760px, com seções em linhas separadas por borda sutil em vez de cards dentro de cards.

O ritmo interno usa a escala de 4px, quase sempre 4, 8, 12 e 16px; entre mensagens, 24px.

A altura dos controles segue a escala fixa: 24px (ícones e ações inline), 28px (itens de lista e da barra lateral, botões pequenos), 32px (padrão de botões e campos) e 36px (ação principal de destaque).

**A Regra da Escala.** Nenhuma altura de controle fora de 24 / 28 / 32 / 36px.

### Charts

- Séries categóricas em ordem fixa (`--z-series-1..7`, uma por harness: Codex, Claude Code, Anthropic, OpenAI, OpenRouter, Ollama, LM Studio). A cor segue a entidade, nunca a posição; validadas para daltonismo e contraste nos dois temas (no claro, três ficam abaixo de 3:1, por isso todo gráfico tem legenda com valores e uma visão em tabela).
- Linhas de 2px, área a 14% de opacidade, grade de 1px na cor da borda, eixo com valores redondos (1, 2 ou 5 × 10ⁿ). Texto nunca usa a cor da série; a identidade vem do ponto ou traço ao lado.
- Hover e teclado: uma linha vertical acompanha o dia mais próximo e um único quadro lista todas as séries; o gráfico é um slider (setas mudam o dia).
- Número principal (hero) ≥48px, mesma fonte, algarismos proporcionais; `tabular-nums` só em colunas.

## Elevation & Depth

Sem sombras. A profundidade vem de camadas de tom: moldura (e barra lateral) → bancada → superfície → elevado, cada degrau um pouco mais claro no tema escuro. Bordas de 6% separam quando o tom sozinho não basta; popovers e diálogos usam a borda forte.

**A Regra do Plano.** Superfícies são planas. Se algo precisa se destacar, sobe um degrau de tom; não ganha sombra.

## Shapes

Cantos suavemente arredondados, crescendo com o tamanho do objeto: 4px em código inline, 8px em controles, 12px em cards e blocos de código, 16px em folhas e diálogos, pílula em badges. Bordas de 1px, sempre com os tokens de borda.

## Components

### Buttons
Compactos e diretos, com aperto físico ao pressionar.
- **Shape:** cantos de controle (8px), alturas 28 / 32 / 36px (sm / md / lg).
- **Default:** azul de sinal com texto branco. Uma ação principal por área.
- **Secondary (padrão):** fundo de controle, com degraus em hover e ao pressionar.
- **Ghost:** só texto muted; ganha fundo de controle e texto cheio no hover.
- **Destructive:** fundo vermelho translúcido com texto vermelho; vira vermelho cheio no hover.
- **Estados:** foco visível com anel de 2px azul; desabilitado com 50% de opacidade e sem clique; `scale(0.97)` ao pressionar em 120ms; hover só com ponteiro (o React Aria não dispara hover no toque).

### Chips / Badges
- **Style:** pílula de 20px, rótulo de 11px em peso 500.
- **Tons:** neutral (controle + muted), accent (azul translúcido), warning (controle + laranja), danger (vermelho translúcido).

### Cards / Containers
- **Corner Style:** 12px.
- **Background:** superfície.
- **Shadow Strategy:** nenhuma (ver Elevation & Depth).
- **Border:** 1px sutil.
- **Internal Padding:** 16px.

### Inputs / Fields
- **Style:** fundo de controle, borda sutil, cantos de 8px, 32px de altura, placeholder em text-dim.
- **Focus:** borda forte e anel de 2px azul translúcido.
- **Disabled:** 50% de opacidade.
- **Field:** rótulo de 12px muted acima, dica de 11px dim abaixo.

### Select
- **Gatilho:** mesmo corpo do campo (32px, ou 28px no tamanho sm) com chevron muted.
- **Lista:** popover em raised com borda forte, cantos de 8px, sem sombra; itens de 28px, foco com control-hover, selecionado com check azul.

### Dialog / Tooltip
- **Dialog:** folha de 16px de raio em raised com borda forte sobre overlay escuro; título 15px semibold; ações à direita. Ação destrutiva sempre confirmada por diálogo (nunca `window.confirm`), com foco inicial no botão de confirmar.
- **Tooltip:** raised com borda forte, 12px de texto secondary, aparece após 500ms no hover e no foco do teclado; o gatilho é um `Button`/`IconButton` (React Aria).
- **Popover** (`Popover`): folha de 16px em raised com borda forte para conteúdo interativo (seletor de modelo, quem responde). Esc e clique fora fecham; o foco volta ao gatilho. `FieldButton` é o gatilho com cara de campo dentro de formulários.

### Navigation (redesign "Zero — main screen", absorvido em 2026-11-03)
- **Barra lateral:** 264px sobre a moldura. No topo, a marca em 28px: o logo (um só traço arredondado que é ao mesmo tempo um zero e um Z: tudo na cor do texto; o ícone do app desenha o mesmo em branco sobre o azul) e "Zero" em semibold. No app desktop essa linha é a barra de título: arrasta a janela e anda para a direita dos botões dela. Needs you logo abaixo, fixo. Depois, uma linha de abas de ícone: as outras mostram o nome no tooltip; a ativa ganha o fundo de hover e o nome em texto claro, que desliza para fora ao lado do ícone e empurra as abas seguintes (240ms, sem animação com reduced motion) troca a lista que rola embaixo: Chats (padrão; todos os chats, primeiro os que esperam você, depois os que trabalham, depois a última atividade) e Projects (a árvore, com arrastar e soltar); Knowledge e Settings também são abas, mas abrem a página delas (e ficam selecionadas enquanto ela está aberta). No fim da linha, o + cria na aba aberta (chat ou projeto); a aba escolhida fica lembrada. Os agentes de um projeto ficam nos ajustes dele, não na barra. No pé, com fio no topo, só o consumo: uma linha por assinatura (a mais em risco primeiro, até 3) com o logo, uma barra fina do % usado da janela mais em risco e o número; verde, amarelo se o ritmo esvazia a janela antes de renovar ou a partir de 80%, vermelho a partir de 95%. Passar o mouse (ou focar) abre um cartão com o resto: por conta, o mini gráfico de queima da janela em risco (borda esquerda = janela abrindo cheia, direita = renovação; diagonal tracejada = ritmo uniforme; linha colorida até um ponto em "agora" = o que sobra; tracejado depois = projeção; × vermelho onde zera antes de renovar), uma frase sobre o ritmo ("sobram ~26% na renovação" ou "acaba por volta de 20:15") e cada janela com % e quando renova. Sem projeção no primeiro décimo da janela. Clicar abre Usage.
- **`NavLabel`:** 12px, peso 500, muted, caixa normal ("Projects"), 26px de altura, ação "+" de 22px à direita. Em Projects e Chats o título é um botão que recolhe e expande a seção, com uma seta de 12px logo depois do nome (para baixo aberta, para a direita fechada); a escolha fica salva neste computador.
- **`NavItem`:** 32px, cantos de 8px, ícone de 16px muted, hover em `hover` (#222 no escuro), nunca azul.
- **Projeto:** uma linha de 32px. Seta à esquerda que gira 90° ao abrir; nome em 500 (600 aberto); à direita só o estado: ponto azul (`accent-text`) quando algum chat espera você, girando verde quando algum trabalha, nada parado. Ajustes e novo chat aparecem no hover ou foco no lugar do estado.
- **Chat:** ocupa a largura toda da barra. Avatar de 32px (o líder, ou o logo do modelo), título e quando mexeu por último na primeira linha, e na segunda, quando há mais de um agente, todos em avatares redondos de 16px sobrepostos (quem age primeiro), seguidos do que acontece agora (azul esperando você, girando verde trabalhando) ou, parado, o começo da última mensagem. Ordem: esperando você, trabalhando, depois o resto (ordem manual ou recência). O chat aberto é um chip elevado: fundo `surface`, anel de 1px `border-strong` e sombra `shadow-chip`. Cinco por grupo, depois "Show N more"; o chat aberto nunca some.

### Mensagem de agente
- **Avatar:** quadrado de 28px, cantos de 8–9px, cor de identidade, inicial em branco. Nome em 13px semibold e, na mesma linha, a pílula de atividade; modelo, tokens, conta e custo vão para a linha de rodapé em 12px.
- **Pílula de atividade:** 24px, sem fundo (hover em `hover`), 12px muted: ponto de estado + resumo ("3 steps", "Running the tests · 14 s") + chevron. Os passos abrem na linha de baixo, num quadro de borda sutil e cantos de 12px com o tempo de cada um.
- **Aviso central:** 12px text-muted entre dois fios (passagem de tarefa, troca de modelo).
- **Cartão de aprovação:** uma linha só, até 520px: à esquerda o que o agente quer fazer em `accent-text` peso 500 e, embaixo, o comando em mono muted (pressionar mostra os argumentos); à direita Deny (ghost) e Allow (azul, 28px). Fundo accent-faint, borda accent-line, cantos de 12px.
- **Decisão tomada:** uma linha de 12px muted: "Allowed" em verde (ou "Denied") · o que foi.

### Campo de mensagem
- Uma barra: cantos de 12px, borda forte, fundo do canvas. Da esquerda para a direita: anexar (+), o texto, o modelo (botão discreto), o medidor de contexto (anel de 20px), parar (só durante um turno) e enviar redondo de 32px em azul.
- O texto é um editor Tiptap (uma linha que cresce com Shift+Enter; Enter envia). Gatilhos, com a lista acima da barra (setas, Enter ou Tab escolhem, Esc fecha):
  - `#` escolhe quem responde (vira o líder do chat; entra no chat se não estava) e não deixa nada no texto;
  - `@` menciona um membro (chip azul, enviado como `@handle`) ou um arquivo do projeto (chip neutro com o caminho, enviado como `@caminho`; o agente lê com as ferramentas dele). Membros primeiro, depois os arquivos; um arquivo casa também pelo nome;
  - `$` cita uma skill: chip neutro, enviado como `$handle`, e o turno leva o passo a passo dela;
  - `/` no começo da linha roda um comando do Zero (compactar, novo chat, changes, terminal).
- **Fila:** o que se envia durante um turno espera num cartão colado acima da barra (uma linha por mensagem: orientar agora, editar, apagar) e sai sozinho quando o chat fica livre. Fica guardada neste computador.
- **Medidor de contexto:** o anel mostra o quanto da janela do modelo o próximo turno ocupa (aviso a partir de 80%); o popover divide em instruções, memórias, skills, resumo e mensagens (estimativa), mostra o que a última resposta leu de verdade, quando o Zero compacta sozinho, e oferece compactar agora ou novo chat.
- Quem participa do chat (adicionar, remover, líder) fica no cabeçalho, nos avatares dos membros.

### Chat (componente assinatura)
Respostas em markdown com ritmo de 0.6em entre blocos, títulos em 15px, links em signal-blue-text sublinhados, código inline em fundo de controle e blocos de código em superfície com borda sutil e cantos de 12px.

### Avatar e logos de provider
- `AgentAvatar` em 16, 20, 28 e 32px; passe `tone` = posição do agente no projeto, para dois agentes nunca dividirem cor (até seis). Sem `tone`, um hash do id mantém a cor estável.
- `ProviderIcon`: logos oficiais do Lobe Icons. O Claude tem a cor da marca; os outros são monocromáticos (`currentColor`) e seguem o texto. Nunca sobre fundo branco.

### Como o design system se mantém
- **Sem galeria:** as telas reais são a referência; primitiva nova é conferida na tela que a usa, nos dois temas.
- **`bun run check:ui`** (no CI): nas telas, fora de `src/ui`, nada de cor literal, valor arbitrário `[..]`, controle HTML cru, import direto de `lucide-react` ou `react-aria-components` ou glifo unicode como ícone. É uma catraca: a dívida antiga está em `ui-baseline.json` e só pode cair.
- **Detector do impeccable** roda depois de cada edição de UI (hook local) e faz um passe completo ao fim da sessão.
- **`bun run check:i18n`** (no CI): nenhum texto em JSX nem em props lidas pela pessoa fora do catálogo `packages/i18n` (`t()`). A interface é em inglês (D13); conteúdo do usuário não passa pelo catálogo.

## Do's and Don'ts

### Do:
- **Do** usar só as primitivas de `src/ui` nas telas; elas são a única API visual.
- **Do** usar só tokens (`bg-surface`, `text-muted`, `border-subtle`, `h-control`…), nunca valores literais.
- **Do** manter alturas de controle em 24 / 28 / 32 / 36px.
- **Do** dar a todo controle foco visível, estado desabilitado, rótulo acessível e uso completo por teclado.
- **Do** respeitar "reduzir movimento" e manter transições abaixo de 300ms.
- **Do** separar camadas por tom antes de recorrer a borda.

### Don't:
- **Don't** usar cor literal fora de `styles.css`: quebra o tema claro.
- **Don't** introduzir um segundo acento ou usar cores de estado como decoração.
- **Don't** usar sombras para profundidade.
- **Don't** criar um quinto tamanho de texto.
- **Don't** aplicar hover em dispositivos sem ponteiro fino.
- **Don't** pintar botão, link ou estado com cor de agente.
- **Don't** pôr card dentro de card: dentro do cartão de conteúdo, separe por linha e espaço.
- **Don't** copiar código ou CSS do a reference app (licença PolyForm Noncommercial); só a direção.
- **Don't** usar Radix nem a paleta neutra e o `--radius` padrão do shadcn; as primitivas saem do shadcn `--base aria` já mapeadas para os tokens `--z-*`.
