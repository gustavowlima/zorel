# design-system
keywords: ui, tailwind, tokens, theme, button, css, check:ui, avatar, provider icon, detector
status: active
updated: 2026-11-03

## current

- tokens --z-* em apps/web/src/styles.css; dark padrão, light via [data-theme="light"]
- @theme inline expõe tokens como utilitários (bg-surface, text-muted, border-subtle, h-control*)
- escala de controle 24/28/32/36px (control-xs/sm/control/lg), inspirada no OpenBot
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
- decidido (2026-11-03): tema escuro do protótipo é o padrão (claro só troca valores, neutro); paleta de identidade dos agentes (6 cores, --z-agent-1..6) só em avatares (A Regra do Avatar); text-dim #8a8a8a (5,0:1) e no claro muted #666/dim #757575; seção Agents = agentes do projeto aberto
- DESIGN.md e tokens atualizados pelo protótipo (sidebar = tom da moldura, surface #232323, bordas 6%/10%, tokens accent-faint/line, success-faint/line, diff-add/del, code)

- fase UI passo 1 (2026-11-03): primitivas Switch, Tabs (pílulas), Menu, IconButton (label obrigatório), AgentAvatar (16/20/28/32; `tone` = ordem do agente no projeto, senão hash do id), ProviderIcon (lobehub; Claude em cor, resto mono currentColor; aliases claude-cli/anthropic, codex-cli/openai), Spinner (currentColor, para em reduced motion), ChatStatusIcon (running/waiting/failed); ícones lucide reexportados por ui/icons.tsx
- sem galeria /dev/ui (removida 2026-11-03, decisão do usuário): conferir primitivas nas telas reais, nos dois temas
- `bun run check:ui` (scripts/check-ui.ts) no CI: catraca por arquivo/regra em apps/web/ui-baseline.json (literal-color, arbitrary-value, raw-control, direct-import, glyph-icon); src/ui isento; `--update` trava melhora. Dívida zerada no passo 3
- detector impeccable: .impeccable/config.json (hook on; ignore 9px = inicial do avatar 16px); manifest local em .claude/settings.local.json aponta para $HOME/.claude/skills/impeccable (skill é global, o instalador não achou pasta no projeto)
- NOTICE atribui Lobe Icons (MIT)

- fase UI passos 2 e 3 (2026-11-03): primitivas novas NavItem, NavLabel, GroupRow, TreeItem (nav.tsx), Popover, ConfirmDialog/Dialog controlado, FieldButton/RailButton/OptionButton (picker.tsx), DisclosurePill/Dot (pill.tsx), Screen/Column/Section/Rows/EmptyState/Meter/Code (layout.tsx), BareTextarea, pickFiles, ModelAvatar; Meter só avisa com warnAt
- `* { border-color }` mora em @layer base: fora de layer anulava border-* do Tailwind (todas as bordas coloridas)
- ui-baseline.json zerado: telas sem dívida de check:ui
- token --font-mono (ui-monospace)

## avoid

- bg-muted / bg-accent / bg-secondary do shadcn: esses nomes são nossos (texto apagado, azul, texto secundário). Ao adotar componente, trocar por bg-control/bg-control-hover
- fonte Geist e paleta neutra do preset Nova: removidas; a fonte é Inter

- cor literal fora de styles.css: quebra tema light
- logo de provider sobre fundo branco (variante colorida do Codex tinha tile branco): usar a mono
- props a11y por spread condicional no svg: o biome não enxerga (noSvgWithoutTitle)
- copiar CSS/código do OpenBot: licença PolyForm Noncommercial

## alvo (D19, ARCHITECTURE 10.3)

- autoridade: apps/web/PRODUCT.md (/impeccable init, modo Operate) + apps/web/DESIGN.md (/impeccable document, tokens YAML)
- primitivas em apps/web/src/ui/ como única API visual; complexos sobre React Aria Components (via shadcn --base aria); telas nunca importam headless/ícones direto
- fundação OpenBot (só ideias): escala 24/28/32/36, dark padrão + light só troca valores, só tokens, hover só ponteiro fino, scale 0.97, <300ms + reduced motion, estados obrigatórios + teclado + rótulo
- fluxo impeccable: shape antes de tela nova; detector ligado (hooks on); audit ao terminar tela; um passe de polish ao fechar fase; harden/clarify para erros e i18n; extract quando componente repete em 2+ telas
- check:ui no CI (literais, escala, botão/diálogo à mão, import direto de headless/ícones); nem Storybook nem galeria
- shadcn (CLI 4.x) como GERADOR das primitivas: `shadcn init --base aria` (React Aria Components; Radix e Base UI NÃO, decisão do usuário 2026-11-03), código copiado para src/ui e nosso; tokens semânticos do shadcn mapeados uma vez para --z-*; nada da paleta neutra/--radius padrão; alturas na escala 24/28/32/36
- scrollbars: nada de scrollbar-color/scrollbar-width no :root (herda e faz o Chrome/WebKit ignorar ::-webkit-scrollbar); só em @supports not selector(::-webkit-scrollbar). Áreas estilo desktop usam .scroll-quiet (sem barra) + hairline nas bordas com conteúdo escondido
- sidebar: marca (= barra de título no desktop: classe electrobun-webkit-app-region-drag, .title-inset dá 84px aos botões da janela com data-shell=desktop), Needs you/Knowledge/Usage e Settings fixos; só as árvores rolam; linhas de 28px (h-control-sm) e shrink-0; projetos/chats são NavTree/NavTreeItem (React Aria Tree); ações sobrepõem a contagem no hover/foco com pointer-events-none quando escondidas; chats sem projeto na seção Chats
- números soltos na navegação só quando acionáveis: o % de Usage aparece a partir de LIMIT_ALERT, com aria-label/title dizendo conta e janela
- drag and drop: useNavReorder (ui/nav.tsx) sobre useDragAndDrop do React Aria; só reordena dentro de um grupo (getDropOperation cancela 'on' e outros grupos); nenhuma lib nova
- I18nProvider com locale() do Zero em main.tsx: as strings do React Aria (arrastar, recolher) seguem o idioma da interface, não o do navegador
- cn conhece os tokens do tema (lib/utils.ts): ao criar um token de spacing/radius novo em styles.css, adicione-o ali também
