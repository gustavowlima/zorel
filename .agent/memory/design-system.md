# design-system
keywords: ui, tailwind, tokens, theme, button, css
status: active
updated: 2026-11-03

## current

- tokens --z-* em apps/web/src/styles.css; dark padrão, light via [data-theme="light"]
- @theme inline expõe tokens como utilitários (bg-surface, text-muted, border-subtle, h-control*)
- escala de controle 24/28/32/36px (control-xs/sm/control/lg), inspirada no a reference app
- primitivas em apps/web/src/ui/ (index.tsx reexporta; button.tsx); features importam de "@/ui" e não estilizam controles na mão
- shadcn inicializado: components.json (style aria-nova, ícones lucide, alias ui → @/ui); `bunx shadcn add X` gera em src/ui e o componente é adaptado aos tokens antes de usar
- Button = React Aria (onPress, isDisabled; estados data-hovered/data-pressed/data-focus-visible); sem prop title, usar <Tooltip content>
- primitivas React Aria em src/ui: button, input (Input, Textarea, `field` compartilhado), select (API por options; "" vira chave "v:"), tooltip, dialog (Dialog + ConfirmButton)
- ação destrutiva usa ConfirmButton, nunca window.confirm
- title nativo segue ok em elementos não interativos (badges, linhas); Tooltip só em gatilho focável
- bundle web ~827 KB min / 261 KB gzip após React Aria (era 605 KB); code-split por rota se pesar
- tokens do shadcn (background, foreground, card, popover, primary, destructive, border, input, ring, *-foreground) apontam para --z-* em :root; raio sm/md/lg/xl/2xl = 4/6/8/12/16; `dark:` = tema padrão (sem classe .dark)
- cx = cn (pacote `cn`, merge de classes Tailwind)
- pressable: scale(0.97), <300ms, respeita prefers-reduced-motion

- apps/web/DESIGN.md escrito (/impeccable document, scan): north star "A Bancada Noturna"; frontmatter YAML é normativo (valores do tema escuro); sidecar em apps/web/.impeccable/design.json
- regras nomeadas: Voz Única (só um acento azul), Token, Quatro Tamanhos (11/12/13/15px), Escala (24/28/32/36), Plano (sem sombras, profundidade por tom)
- mudou token em styles.css → atualizar DESIGN.md e o sidecar juntos

- protótipo das telas (canvas): https://claude.ai/artifact/ERkKURix2bnKAqzi97emmw — moldura + cartão raio 16, barra lateral em árvore (pasta, linha de árvore sem fundo, status em 2ª linha com ícone girando/relógio), General = chats sem projeto, pílula de atividade expansível, aprovação pendente/recibo, seletor de modelo com trilho de contas e logos (@lobehub/icons-static-svg 1.102.0, MIT), painel direito Changes/Files (@pierre/diffs), painel de baixo Terminal/Tests/Problems/Processes/Logs, configurações com conectores/MCP/skills
- decisões em aberto (fase UI): tema claro neutro ou quente; paleta de identidade dos agentes como exceção ao acento único; text-dim #6a6a6a reprova contraste; seção Agents da barra lateral = projeto aberto ou todos
- DESIGN.md ainda descreve o MVP; atualizar na fase UI

## avoid

- bg-muted / bg-accent / bg-secondary do shadcn: esses nomes são nossos (texto apagado, azul, texto secundário). Ao adotar componente, trocar por bg-control/bg-control-hover
- fonte Geist e paleta neutra do preset Nova: removidas; a fonte é Inter

- cor literal fora de styles.css: quebra tema light
- copiar CSS/código do a reference app: licença PolyForm Noncommercial

## alvo (D19, ARCHITECTURE 10.3)

- autoridade: apps/web/PRODUCT.md (/impeccable init, modo Operate) + apps/web/DESIGN.md (/impeccable document, tokens YAML)
- primitivas em apps/web/src/ui/ como única API visual; complexos sobre React Aria Components (via shadcn --base aria); telas nunca importam headless/ícones direto
- fundação a reference app (só ideias): escala 24/28/32/36, dark padrão + light só troca valores, só tokens, hover só ponteiro fino, scale 0.97, <300ms + reduced motion, estados obrigatórios + teclado + rótulo
- fluxo impeccable: shape antes de tela nova; detector ligado (hooks on); audit ao terminar tela; um passe de polish ao fechar fase; harden/clarify para erros e i18n; extract quando componente repete em 2+ telas
- check:ui no CI (literais, escala, botão/diálogo à mão, import direto de headless/ícones); galeria /dev/ui em dev no lugar de Storybook
- shadcn (CLI 4.x) como GERADOR das primitivas: `shadcn init --base aria` (React Aria Components; Radix e Base UI NÃO, decisão do usuário 2026-11-03), código copiado para src/ui e nosso; tokens semânticos do shadcn mapeados uma vez para --z-*; nada da paleta neutra/--radius padrão; alturas na escala 24/28/32/36
