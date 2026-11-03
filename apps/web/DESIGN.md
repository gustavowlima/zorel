---
name: Zero
description: Workspace de agentes de IA para código, escuro, compacto e silencioso.
colors:
  frame: "#0d0d0d"
  canvas: "#1a1a1a"
  sidebar: "#141414"
  surface: "#212121"
  raised: "#262626"
  control: "#212121"
  control-hover: "#262626"
  control-active: "#2c2c2c"
  border-subtle: "rgba(255, 255, 255, 0.05)"
  border-strong: "rgba(255, 255, 255, 0.09)"
  text: "#ffffff"
  text-secondary: "#dcdcdc"
  text-muted: "#979797"
  text-dim: "#6a6a6a"
  signal-blue: "#007cf7"
  signal-blue-hover: "#1f8fff"
  signal-blue-text: "#42a0ff"
  signal-blue-soft: "rgba(0, 124, 247, 0.16)"
  success: "#31cf76"
  warning: "#ff9412"
  danger: "#fd2f3b"
  danger-soft: "rgba(253, 47, 59, 0.16)"
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
    textColor: "{colors.text}"
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
    textColor: "{colors.text}"
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
    height: "{spacing.control-sm}"
    padding: "0 8px"
  sidebar-item-active:
    backgroundColor: "{colors.control-active}"
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
- **Moldura** (frame): o fundo da janela, atrás de tudo.
- **Bancada** (canvas): a área de trabalho principal, onde fica o chat.
- **Barra Lateral** (sidebar): navegação, um degrau mais escuro que a bancada.
- **Superfície** (surface) e **Elevado** (raised): cards, blocos de código e painéis por cima da bancada.
- **Controle** (control, control-hover, control-active): fundo de botões secundários, campos e itens selecionados, em três degraus.
- **Borda sutil** (border-subtle) e **Borda forte** (border-strong): separação mínima; a forte só em foco de campo, tabela e citação.
- **Texto** em quatro degraus: text (títulos e conteúdo), text-secondary, text-muted (rótulos, itens inativos), text-dim (dicas, placeholders, seções).

### Estados
- **success**, **warning**, **danger** (com danger-soft): só para estado real (ok, atenção, erro ou ação destrutiva). Nunca decoração.

### Named Rules
**A Regra da Voz Única.** O azul de sinal é o único acento. Se ele aparece em algo que não é ação, foco, seleção ou link, está errado.

**A Regra do Token.** Nenhuma cor literal fora de `styles.css`. Uma cor literal quebra o tema claro.

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

Aplicação de janela inteira em três camadas: moldura, barra lateral fixa à esquerda e bancada à direita. Páginas de configuração e listagem ficam centralizadas numa coluna de até 768px com 32px de respiro e 24px entre blocos. O ritmo interno usa a escala de 4px do Tailwind, quase sempre 4, 8 e 12px (8px é o espaçamento dominante entre elementos).

A altura dos controles segue a escala fixa: 24px (ícones e ações inline), 28px (itens de lista e da barra lateral, botões pequenos), 32px (padrão de botões e campos) e 36px (ação principal de destaque).

**A Regra da Escala.** Nenhuma altura de controle fora de 24 / 28 / 32 / 36px.

## Elevation & Depth

Sem sombras. A profundidade vem de camadas de tom: moldura → barra lateral → bancada → superfície → elevado, cada degrau um pouco mais claro no tema escuro. Bordas de 5% separam quando o tom sozinho não basta.

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
- **Estados:** foco visível com anel de 2px azul; desabilitado com 50% de opacidade e sem clique; `scale(0.97)` ao pressionar em 120ms; hover só com ponteiro fino.

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

### Navigation
- **Sidebar item:** 28px de altura, texto muted, hover com fundo de controle. O ativo usa control-active e texto cheio.
- **Section label:** 11px, caixa alta, text-dim, separando grupos da barra lateral.

### Chat (componente assinatura)
Respostas em markdown com ritmo de 0.6em entre blocos, títulos em 15px, links em signal-blue-text sublinhados, código inline em fundo de controle e blocos de código em superfície com borda sutil e cantos de 12px.

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
- **Don't** copiar código ou CSS do OpenBot (licença PolyForm Noncommercial); só a direção.
- **Don't** usar Radix nem a paleta neutra e o `--radius` padrão do shadcn; as primitivas saem do shadcn `--base aria` já mapeadas para os tokens `--z-*`.
