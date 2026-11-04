# desktop
keywords: desktop, electron, app, build, dmg, signing, path, macos, janela, tray
status: active
updated: 2026-11-04

## current

- D11 implementado (2026-11-04): apps/desktop é Electron 45 (main em src/main.ts, bundle cjs por `bun build --target=node`); o server roda como processo filho: `bun apps/server/src/main.ts` em dev, binário `bun build --compile` (build/zero-server, ~95 MB) empacotado em Resources, com web/ e drizzle/ (ZERO_WEB_DIR, ZERO_MIGRATIONS)
- chromium-bidi fica external no compile (playwright-core o requer só no modo BiDi, que o Zero não usa)
- fechar a janela destrói o renderer mas mantém app + server (rotinas e turnos seguem); Dock (macOS) ou tray (outros) reabre; Quit mata o server (SIGTERM)
- server sai sozinho se o pai morre: ZERO_PARENT_PID checado a cada 5 s (main.ts watchParent)
- single instance; links externos vão para o navegador padrão; janela só navega no próprio origin; sandbox + contextIsolation
- poucos recursos: disable-features SpareRendererForSitePerProcess, HardwareMediaKeyHandling, MediaRouter; electronLanguages en + pt-BR; medido ~215 MB Electron + ~80 MB server com janela aberta
- PATH do shell de login lido na partida (apps do Finder não herdam PATH)
- web: `?shell=desktop` → data-shell; `.app-drag` (CSS -webkit-app-region) no rail, topo da sidebar e cabeçalhos de tela/chat; controles dentro ficam no-drag por seletor
- assinatura: só Developer ID (CSC_LINK/CSC_KEY_PASSWORD; APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID para notarizar). Ad hoc e "Apple Development" são recusados pelo AMFI neste macOS (testado). Sem Developer ID: `bun run desktop`

## avoid

- Playwright newPage/newContext no Electron: Target.createTarget not supported; quem cria abas é o main
- detectar humano por before-mouse-event/input-event: input via CDP também dispara (testado); usar a camada transparente

- deixar o electron-builder escolher certificado do keychain: pegou um Apple Development e gerou app que o macOS mata (SIGKILL sem mensagem)
- server dentro do main do Electron: morre com a janela e exigiria Node no lugar de Bun
- navegador nativo: src/browser-host.ts (POST/DELETE /tabs com Bearer; views em BaseWindow oculta; ipc "browser:show" {tab, rect, overlay} só do app window; overlay transparente + before-mouse-event → "browser:take" → painel manda {t:"take"}); server browser.ts modo nativo por ZERO_DESKTOP_CDP/CONTROL/TOKEN, aba achada por url about:blank#zero-tab-<id>; profileOf(agentId) = partição
- __dirname é fixado pelo bun build no caminho de src: usar app.getAppPath() (preload, ícone, raiz em dev)
- barra de título do desktop (TitleBar em sidebar.tsx, h-12, pl-21, como OpenBot): botões do macOS (trafficLightPosition 18,18), marca, voltar/avançar, novo chat; rail sem logo (.rail-logo). Cabeçalho das páginas (Screen e chat) usa ui PageHeader: no desktop faz portal para #titlebar-slot, alinhado ao cartão (grupo esquerdo w-77 = trilho + sidebar). Flag lida dentro do App (main.tsx define data-shell depois dos imports)
