import type { ElectrobunConfig } from "electrobun"

// App desktop: o processo principal (Bun) sobe o mesmo server do Zero e abre uma janela nativa para ele.
// `web/` é o build de apps/web e `drizzle/` as migrations do banco, copiados pelo prebuild (o Electrobun só copia caminhos dentro do projeto).
// Assinatura e notarização (macOS) ligam sozinhas quando as credenciais estão no ambiente (segredos do CI):
//   ELECTROBUN_DEVELOPER_ID, e ELECTROBUN_APPLEID + ELECTROBUN_APPLEIDPASS + ELECTROBUN_TEAMID.
// Ícone: assets/icon.svg é a fonte; icon.iconset e assets/icon.png são gerados por `bun run icons`.
const env = process.env
const sign = !!env.ELECTROBUN_DEVELOPER_ID
const notarize = sign && !!(env.ELECTROBUN_APPLEID && env.ELECTROBUN_APPLEIDPASS && env.ELECTROBUN_TEAMID)

export default {
  app: {
    name: "Zero",
    identifier: "dev.zero.app",
    version: "0.1.0"
  },
  build: {
    mainProcess: "bun",
    bun: { entrypoint: "src/bun/index.ts" },
    copy: { web: "web", drizzle: "drizzle" },
    mac: { icons: "icon.iconset", codesign: sign, notarize, createDmg: true },
    win: { icon: "assets/icon.png" },
    linux: { icon: "assets/icon.png" }
  },
  runtime: { exitOnLastWindowClosed: true }
} satisfies ElectrobunConfig
