# design-system
keywords: ui, tailwind, tokens, theme, button, css
status: active
updated: 2026-11-02

## current

- tokens --z-* em apps/web/src/styles.css; dark padrão, light via [data-theme="light"]
- @theme inline expõe tokens como utilitários (bg-surface, text-muted, border-subtle, h-control*)
- escala de controle 24/28/32/36px (control-xs/sm/control/lg), inspirada no a reference app
- primitivas em apps/web/src/ui.tsx (Button, Input, Textarea, SidebarItem, SectionLabel); features não estilizam controles na mão
- pressable: scale(0.97), <300ms, respeita prefers-reduced-motion

## avoid

- cor literal fora de styles.css: quebra tema light
- copiar CSS/código do a reference app: licença PolyForm Noncommercial
