# desktop
keywords: desktop, electrobun, app, build, path, macos
status: active
updated: 2026-11-02

## current

- apps/desktop: Electrobun 2.0.5 (toolchain Hutch baixado no primeiro build); processo principal Bun importa start() do server, porta livre, janela nativa
- prebuild copia apps/web/dist para apps/desktop/web (Electrobun só copia caminhos dentro do projeto); webDir em runtime = PATHS.VIEWS_FOLDER/../web
- PATH do shell de login lido na partida (apps do Finder não herdam PATH; sem isso claude/codex somem)

- ícone: assets/icon.svg (fonte, full-bleed; macOS aplica a máscara) → scripts/icons.sh gera icon.iconset e assets/icon.png (qlmanage + sips)
- assinatura/notarização: ligam só com ELECTROBUN_DEVELOPER_ID (+ APPLEID/APPLEIDPASS/TEAMID) no ambiente; CI usa segredos do repo
- build stable gera artifacts/ (dmg, tar.zst, update.json); build/, artifacts/, web/, .hutch/ ignorados

- build stable é autoextrator: instala no lugar na 1ª execução; falha rodando de volume externo (testado), funciona em disco interno (testado ponta a ponta com claude-cli)

## avoid

- caminhos com ".." em build.copy: o Electrobun rejeita
