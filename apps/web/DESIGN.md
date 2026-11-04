---
name: Zero
description: Workspace de agentes de IA para código, escuro, compacto e silencioso.
colors:
  frame: "#0d0d0d"
  canvas: "#171717"
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

A densidade é de ferramenta profissional: controles de 28 a 32px, texto base de 13px, nada de espaço decorativo. A referência é o OpenBot, só como direção (nenhum código ou CSS copiado). O tema escuro é o padrão. O claro existe e só troca valores dos mesmos tokens; nenhum componente sabe em qual tema está.

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

Janela inteira em quatro camadas: moldura; o **trilho de ícones** (60px) e a barra lateral de 248px direto sobre ela; e um único cartão de conteúdo (bancada) que ocupa toda a altura e vai até a borda direita da janela, com cantos de 16px e borda sutil só do lado esquerdo (voltado para a barra lateral). O cartão tem sempre o mesmo cabeçalho: título 15px semibold, uma descrição em text-muted ao lado e as ações à direita, com borda sutil embaixo.

- **Trilho de ícones** (como no OpenBot), separado da barra lateral por um fio sutil: o logo no topo; logo abaixo o botão de recolher/mostrar a barra lateral (também ⌘B / Ctrl+B, ou clicar de novo em Chats quando já está nele; lembrado neste computador; recolhida, o cartão de conteúdo ganha 12px de margem do trilho), um fio curto, e então os lugares do app, um ícone de 20px num botão de 40px com o nome no tooltip à direita — Chats (início, chat e projeto), Needs you (com o contador accent no canto), Agents, Routines, Knowledge; o lugar atual fica em `hover` com o texto em `fg` e `aria-current`. No pé, pausar todos os agentes (⏸; pausado, ▷ em warning e uma faixa no topo do conteúdo "All agents are paused…" com Resume), os anéis de consumo empilhados (um por assinatura, cada um com seu cartão no hover, abrem Usage; sem assinatura, o ícone de Usage) e a engrenagem de Settings. No app de desktop o trilho é região de arrastar a janela e começa abaixo dos botões dela.
- **Barra lateral:** só as seções Chats e Projects, que rolam (detalhes em Navigation).
- **Chat:** a timeline e o campo de mensagem ocupam toda a largura do painel (32px de respiro de cada lado); as bolhas das suas mensagens continuam com largura máxima própria, encostadas à direita. O painel lateral (Changes, Git, Files, Browser, Terminal) abre à direita e o chat cede o espaço.
- **Páginas** (configuração, conhecimento, contas) ficam numa coluna de até 672px colada à navegação da esquerda (não centralizada), com seções em linhas entre fios sutis direto no canvas, nunca em cartões: um botão secundário (`bg-control`) some sobre um cartão `surface`, que tem o mesmo tom. Título de seção em 12px muted, com uma dica opcional em `dim` embaixo. Cada área tem no máximo uma ação principal azul ("Add key" sem chave, "Sign in" desconectado). Uma página de detalhe abre com um link pequeno de volta ("‹ Providers") acima do cabeçalho de ícone e título (h1); não repete o título numa trilha. Enquanto a primeira leitura carrega, nada diz "não conectado": o resumo mostra "Checking…"; uma falha vira uma linha de erro com tentar de novo. Ações que apagam algo (chave, conta) pedem confirmação. As abas de Settings, nesta ordem: General (preferências deste computador; Appearance com o tema num controle segmentado, e o que vier depois), Providers, MCP servers, Skills, Storage, Audit log; a engrenagem da barra lateral abre General. Listas longas (Audit log) filtram no servidor (tipo, palavras, intervalo de dias num `DateRangeField`: o DateRangePicker do React Aria no estilo shadcn aria, dois campos digitáveis e um calendário de intervalo no popover; nunca o calendário nativo do navegador) e paginam de 50 em 50 com "1–50 de N" e Newer/Older; entradas agrupadas por dia (Today, Yesterday, data).

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

**A Regra do Plano.** Superfícies são planas. Se algo precisa se destacar, sobe um degrau de tom; não ganha sombra. Única exceção: o chat aberto na barra lateral, um chip elevado com `shadow-chip`.

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
- **Tons:** neutral (controle + muted), accent (azul translúcido), success (verde translúcido, só para estado: "Connected"), warning (controle + laranja), danger (vermelho translúcido).

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
- **Barra lateral:** 248px sobre a moldura, ao lado do trilho de ícones (que leva o logo, os lugares, o consumo e Settings; ver Layout). Só duas seções que rolam, empilhadas com 20px entre elas: Chats (os chats sem projeto) e Projects (a árvore, com arrastar e soltar). O título de cada seção é texto muted sem ícone, recolhe e expande (lembrado neste computador) e tem um + à direita (novo chat, novo projeto). **Cada chat com agentes são duas linhas, sem ícone** (52px; sem agente, só a linha do título, 32px, com o estado num ponto ao lado da hora): em cima o título e, à direita, há quanto tempo mexeu (girando enquanto roda); embaixo, em muted, quem está nele — mini avatares de 16px sobrepostos (até 3) e os nomes ("Dev, Rev +1") —, ou, enquanto algo acontece, o estado em palavras (azul quando espera você, vermelho quando falhou). Os chats de cada grupo vêm primeiro os que esperam você, depois os que trabalham, depois a ordem manual e a atividade; cada grupo mostra 5 e um "mostrar mais". Enquanto há lista escondida embaixo, ela some num esmaecimento de 24px. O consumo (anéis) fica no pé do trilho: um por assinatura (a mais em risco primeiro, até 3, empilhados), 34px, um arco por janela de limite (concêntricos, a mais longa por fora; o arco é o % usado: verde, amarelo se o ritmo esvazia a janela antes de renovar ou a partir de 80%, vermelho a partir de 95%), o logo no centro; cada anel abre Usage e tem o próprio cartão (anéis por janela, a frase do ritmo e cada janela com % e quando renova).
- **`NavLabel`:** 28px, 12px peso 500 muted, caixa normal. O ícone da seção (14px) ocupa a coluna de ícone; o título é um botão que recolhe e expande (seta de 12px depois do nome; lembrado neste computador); à direita um + de 24px.
- **`NavItem`:** 32px, cantos de 8px, ícone de 16px muted numa caixa de 20px (a coluna de ícone), texto a partir de x50; hover em `hover`, nunca azul.
- **Projeto:** um subtítulo de 32px alinhado com os chats (sem pasta, sem negrito): o nome em 500 `secondary`, logo depois uma seta pequena que gira ao abrir e fechar, e à direita, discreta (`dim`), quantos chats ele tem — ou o estado: ponto azul quando algum chat espera você, girando verde quando algum trabalha. Ajustes e novo chat aparecem no hover ou foco no lugar disso. Os chats do projeto (e o "mostrar mais") vêm com um recuo leve (24px), presos a um fio vertical sutil.
- **Chat:** duas linhas sem ícone (detalhadas no item Barra lateral); dentro de um projeto, recuadas sob o nome dele, no fio vertical. Ordem dentro de cada grupo: esperando você, trabalhando, depois a ordem manual e a atividade; 5 por grupo e "mostrar mais".

### Visualizador de imagem
- Uma imagem do chat abre dentro do Zero (`ImageViewer`), nunca numa aba nova: modal sobre o app escurecido, a imagem o maior que couber (object-contain, borda forte, cantos de 12px) e, acima, uma barra com o nome, "Open original" e o fechar. Esc, clique fora ou o botão fecham; o foco volta à miniatura.

### Movimento
- **Motion** (motion.dev, `motion/react`, em `ui/motion.tsx`) para o que o CSS não faz limpo: largura e altura de/para `auto` sem desmontar e uma forma deslizando entre lugares. Uma mola só no app (`spring`: sem quique, ~220ms visuais). `MotionConfig reducedMotion="user"` na raiz: com movimento reduzido no sistema, tudo troca de estado sem animar.
- Barra lateral: recolhe e abre animando a largura (`SlideWidth`), com o conteúdo montado (rolagem e estado ficam). Seções Chats e Projects: abrem e fecham pela altura (`Fold`). Trilho: o fundo do lugar atual desliza do anterior até o novo (`Marker`, `layoutId`).
- O resto continua em CSS (`transition-colors` 120–150ms nos hovers; setas giram 150ms).

### Painel lateral (padrão do T3 Code)
- O cabeçalho do chat não tem um botão por superfície: tem os atalhos fixados e **um** botão de painel (ícone de painel + o +N −M do que o chat mudou). Ele abre o painel lateral, à direita do chat, com as superfícies como abas em pílula: **Changes** (com o delta), **Git** (só em repositório), **Files**, **Browser** e **Terminal** (Files e Terminal só com pasta de projeto), e × para fechar. Abaixo de 768px de painel as abas mostram só o ícone (o nome fica no tooltip e no nome acessível).
- Largura ajustável pela borda esquerda (arraste, ou foco + setas), lembrada no computador: 560px por padrão, mín. 360px, máx. 70% da janela.
- **Fixar:** clique direito numa aba do painel ("Pin to the title bar") ou numa aba de shell do Terminal (também "Close") põe um atalho na linha do título, entre o Git e o botão do painel: pílula ghost com ícone e nome (o de uma aba fica `secondary` enquanto ela está aberta). Clicar abre o painel naquela aba (ou naquele shell); de novo, fecha. Clique direito no atalho: "Unpin". Abas fixadas valem para todos os chats (neste computador); shells, para o chat deles, e o atalho some quando o shell fecha. Um alfinete pequeno (dim) marca a aba fixada.
- Browser e Terminal ficam montados depois de abertos: trocar de aba não derruba a conexão. "View" de um turno abre em Changes; um servidor aberto do Terminal abre em Browser; `/terminal` e `/changes` no composer abrem a aba.

### Terminal
- Aba Terminal do painel lateral, ocupando a altura toda.
- A aba nunca fica sem shell: o único shell aberto não tem × (nem fecha por Delete ou pelo menu); se ele terminar sozinho, o × aparece e fechar abre um shell novo no lugar.
- Abrir a aba abre um shell (ou traz de volta os do chat): abas em pílula "Shell 1", "Shell 2"…, o + abre outra. Os comandos que os agentes rodaram ficam no chat, nos passos de cada resposta, não aqui.
- Cada shell vive no servidor (um shell de login num PTY na pasta onde os agentes do chat trabalham): fechar o painel ou recarregar só desconecta; ao voltar, as abas e o layout reaparecem e o fim da saída é reexibido. Fechar a aba (× ou Delete/Backspace nela) encerra o shell, perguntando antes se algo ainda roda nele; fechar a última aba fecha o painel.
- Uma aba divide em até 4 painéis, lado a lado ou empilhados (botões na barra); cada painel é um shell, com × no hover quando há mais de um.
- Links: URLs abrem numa aba nova; caminhos de arquivo (src/a.ts:12) abrem o arquivo no app padrão do computador, só dentro da pasta do chat.
- Selecionar texto mostra "Add to chat": o trecho vai para o campo de mensagem num bloco de código, depois do que já está digitado.
- **Rodar um script** (▷ na barra, só quando a pasta tem `package.json` com scripts): menu com nome e comando numa linha; escolher abre uma aba com o nome do script (ícone ▷) que roda `<gerenciador> run <nome>` (bun, pnpm, yarn ou npm, pelo lockfile). A aba é um shell como as outras: o processo segue rodando ao desconectar e fechar a aba o encerra.
- **Servidores** (ícone de servidor): popover com os processos que escutam uma porta TCP e cuja pasta de trabalho é a do chat (os dev servers que um agente ou um shell subiu), cada porta como link `localhost:N` que abre no Navegador do chat, e ■ para parar (SIGTERM). Lido de novo a cada abertura.
- xterm.js com as cores dos tokens (fundo `code`, texto secundário, seleção accent-soft) e a fonte mono; o tamanho segue o painel.

### Git no chat
- Aba **Git** do painel lateral (só quando a pasta do projeto é um repositório git). Fixada no título, ela aparece como o botão da branch: ícone de branch (pasta quando em worktree), o nome da branch, o número de arquivos mudados (warning) e os commits a enviar (↑N, accent). A aba mostra:
  - cabeçalho com a branch e uma linha de estado ("2 files changed · 1 commit to push · no remote");
  - os arquivos mudados (mono) e, mais abaixo, os últimos commits da branch (hash, assunto, hora; ícone accent nos que ainda não foram enviados);
  - com mudanças: campo da mensagem (mono), "Write it for me" (o modelo do chat escreve a partir do diff, no estilo dos commits recentes do repositório) e "Commit N files" (tudo o que está na pasta entra);
  - "Push N commits" ou "Publish branch" (sem upstream); o PR aberto da branch como link (#12 título ↗), ou "Create pull request" (fora da branch principal, com `gh` instalado): o modelo rascunha título e descrição, editáveis antes de abrir;
  - "New branch" leva o trabalho atual para uma branch nova;
  - "Work in a worktree" dá ao chat a própria pasta numa branch nova (nome vazio = `zero/<título>-<id>`): agentes, shells novos, checkpoints e desfazer passam a usar essa pasta, e a do projeto fica como está. No chat em worktree o botão mostra o ícone de pasta e o popover mostra o caminho e "Back to the project folder", que só remove a worktree sem nada por commitar (a branch fica). Apagar o chat remove a worktree limpa.
- Erros aparecem com as palavras do git, em mono e danger; cada passo concluído vira uma linha success. Commit, push, branch e PR entram no Audit log (tipo Projects).

### Retomar no reset
- Com todas as contas do chat no limite, acima do campo de mensagem: faixa em cartão de borda sutil com relógio em warning, "Every account is at its usage limit. This chat continues by itself at <hora>." e Cancel. Some quando o chat continua, quando você cancela ou quando você mesmo escreve.

### Comentar no diff
- Em Changes, selecionar linhas do diff (clique ou arraste nos números) marca o trecho e abre uma caixa embaixo dele: "What should change here?", Cancel (ou Esc) e "Add to chat" (ou ⌘Enter). O comentário vai para o campo de mensagem como texto: "Review comment on `arquivo` lines 12–14 (new): …", para o agente agir.

### Menu de contexto
- O menu nativo do navegador não aparece no app (só em campos de texto e no terminal, para copiar e colar). Onde há ações, o clique direito (ou a tecla Menu / Shift+F10) abre o `ContextMenu` do Zero, o mesmo visual do menu ⋯, ancorado no ponteiro (ou sob o item focado). Na barra lateral: chat → Open, Rename, Delete; projeto → Open, New chat in…, Settings of…, Delete project. Excluir sempre confirma.

### Navegador
- Aba Browser do painel lateral: abas em pílula com ×, +, depois voltar / avançar / recarregar e o endereço (Enter abre), uma faixa de quem segura o navegador e a página ao vivo (quadros JPEG do screencast, na proporção 1280×800).
- É o navegador dos agentes: um Chrome sem janela no servidor, num perfil persistente (logins ficam), com abas por chat. Clicar, rolar ou digitar na página, ou usar o endereço, toma o controle: a faixa fica azul ("You're using the browser…") com "Hand back"; enquanto isso as ferramentas do navegador dos agentes são recusadas.
- Ferramentas dos agentes: browser_navigate, browser_snapshot (a página como árvore de acessibilidade com [ref=eN]), browser_click e browser_type por ref, browser_press, browser_wait, browser_tabs, browser_back. Ler nunca pede aprovação; agir pede quando o acesso do agente é "ask". Cada uso aparece nos passos da resposta.

### Agents (tela da equipe)
- Item "Agents" na barra lateral, entre Needs you e Knowledge (fica ativo também na página de um agente). Uma tela com coluna central: **Global** (com a dica "Available in every project" e o vazio "No global agents yet") e depois cada projeto que tem agentes, cada um com um + discreto para criar ali. "New agent" no cabeçalho cria um global.
- Linha do agente (a mesma da aba Agents do projeto): avatar, nome com "● working" em accent quando um chat dele está rodando, título (ou descrição, ou a 1ª linha das instruções), modelo, acesso e ›.
- **Build with AI** (cabeçalho da tela Agents e aba Agents do projeto, ghost com ✦): abre um chat "Build agents" com o Builder; ele propõe a equipe inteira num cartão de aprovação (cada perfil sob o nome).
- Agentes também nascem no chat: um agente usa `zero_create_agent` / `zero_update_agent` e o pedido vira um **cartão de aprovação** com o perfil campo a campo; nada é criado sem o OK. A lista se atualiza ao fim do turno.

### Versões do agente
- Na página do agente, a seção **History** (só a partir de duas versões): uma linha por versão, a mais nova primeiro — `vN` em mono, os campos que mudaram em relação à anterior ("Instructions, model"; a primeira diz "Created"), quem mudou ("You" ou o nome do agente que propôs) e quando. A atual diz "Current"; as outras têm "Restore", que confirma antes e grava o perfil antigo como uma versão nova (nada se perde).
- Menu ⋯ do agente: **Export** baixa `<nome>.agent.json` (perfil sem conta: a conta é deste computador). Na tela Agents, **Import** lê esse arquivo e cria um agente global, que abre em seguida; um arquivo que não é de agente do Zero mostra o erro ao lado do botão.

### Rotinas
- Seção **Routines** na página do agente (fora do formulário do perfil): "New routine" abre um formulário em cartão (nome, "What to do each run", "When" com atalhos — toda hora, todo dia 9:00, dias úteis 9:00, segundas 9:00, só sob demanda, personalizado com padrão cron em mono — e um switch para o webhook local).
- Linha da rotina: nome; embaixo, em muted, "Next <quando>" (ou "On demand"/"Off"), o padrão cron e o último resultado ("ran 5m", "skipped … (chat was busy)", "failed …"); à direita abrir o chat dela, ▷ Run now, lixeira (confirma) e o switch liga/desliga. Com webhook, uma linha mono `POST <url>` com copiar.
- Cada rotina tem o próprio chat ("<nome> (routine)") na barra lateral; é ali que o agente responde cada execução.

### Página do agente
- Quem é: nome e título lado a lado (o papel em poucas palavras, mostrado no seletor `#`), depois a descrição (uma frase; os outros agentes do chat a leem para saber quando passar trabalho a ele).
- Quatro grupos: **Brain** (modelo padrão com conta e raciocínio; fallbacks), **Knows** (instruções; memórias e skills do agente, com contagem e até 5 de cada abrindo no Knowledge), **Does** (Usage já filtrado por ele), **Rules** (nível de acesso; ferramentas MCP que os chats alcançam).

### Seletor de modelo
- Popover com um trilho de ícones à esquerda (uma conta de assinatura ou provedor por botão) e, à direita, a busca em todos os modelos, os limites da conta escolhida e a lista dela.
- O trilho só mostra o que é de fato um caminho: cada conta de assinatura (com a inicial quando há mais de uma do mesmo provedor), provedores de API com chave e servidores locais (Ollama, LM Studio) só enquanto rodam. Um provedor de API com o logo de uma assinatura (Anthropic ↔ Claude, OpenAI ↔ Codex) só aparece com chave, para não parecer uma segunda conta.

### Mensagem de agente
- **Avatar:** quadrado de 28px, cantos de 8–9px, cor de identidade, inicial em branco. Nome em 13px semibold e, na mesma linha, a pílula de atividade.
- **Sequência:** respostas seguidas do mesmo agente (até 5 min, sem aviso entre elas) mostram avatar e nome só na primeira; as outras alinham o texto na mesma coluna.
- **Ações da mensagem:** embaixo de cada mensagem (sua à direita, do agente à esquerda), sobre o espaço entre as mensagens e sem ocupar altura: copiar, detalhes (um tooltip com modelo, tokens, conta e custo) e a hora. Aparecem no hover ou no foco, sempre no toque. Só o fim que importa (falhou, cancelado) fica sempre à vista. Ritmo de 28px entre mensagens.
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
- **Don't** copiar código ou CSS do OpenBot (licença PolyForm Noncommercial); só a direção.
- **Don't** usar Radix nem a paleta neutra e o `--radius` padrão do shadcn; as primitivas saem do shadcn `--base aria` já mapeadas para os tokens `--z-*`.
