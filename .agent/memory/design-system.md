# design-system
keywords: ui, tailwind, tokens, theme, button, css
status: active
updated: 2026-11-02

## current

- tokens --z-* em apps/web/src/styles.css; dark padrão, light via [data-theme="light"]
- @theme inline expõe tokens como utilitários (bg-surface, text-muted, border-subtle, h-control*)
- escala de controle 24/28/32/36px (control-xs/sm/control/lg), inspirada no OpenBot
- primitivas em apps/web/src/ui.tsx (Button, Input, Textarea, SidebarItem, SectionLabel); features não estilizam controles na mão
- pressable: scale(0.97), <300ms, respeita prefers-reduced-motion

## avoid

- cor literal fora de styles.css: quebra tema light
- copiar CSS/código do OpenBot: licença PolyForm Noncommercial

## alvo (D19, ARCHITECTURE 10.3)

- autoridade: apps/web/PRODUCT.md (/impeccable init, modo Operate) + apps/web/DESIGN.md (/impeccable document, tokens YAML)
- primitivas em apps/web/src/ui/ como única API visual; complexos sobre lib headless (Base UI ou Radix, decidir no bloco 4 da fase 1); telas nunca importam headless/ícones direto
- fundação OpenBot (só ideias): escala 24/28/32/36, dark padrão + light só troca valores, só tokens, hover só ponteiro fino, scale 0.97, <300ms + reduced motion, estados obrigatórios + teclado + rótulo
- fluxo impeccable: shape antes de tela nova; detector ligado (hooks on); audit ao terminar tela; um passe de polish ao fechar fase; harden/clarify para erros e i18n; extract quando componente repete em 2+ telas
- check:ui no CI (literais, escala, botão/diálogo à mão, import direto de headless/ícones); galeria /dev/ui em dev no lugar de Storybook
- shadcn (CLI 4.x) como GERADOR das primitivas: `shadcn init --base base` (Base UI; Radix alternativa), código copiado para src/ui e nosso; tokens semânticos do shadcn mapeados uma vez para --z-*; nada da paleta neutra/--radius padrão; alturas na escala 24/28/32/36
