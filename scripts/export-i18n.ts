// The interface text for the native client (spec 019): packages/i18n stays the only catalog. This writes one file per
// language, apps/native/locales/<lang>.json (rust-i18n reads the language from the file name), with `{name}`
// placeholders as rust-i18n's `%{name}` and plural leaves { one, other } as two keys (`….one`, `….other`) that the
// native client picks with the language's plural rules (src/i18n.rs). Run: bun run i18n:native (--check to only
// compare; CI does).
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { en } from "../packages/i18n/src/en.ts"
import { ptBR } from "../packages/i18n/src/pt-BR.ts"

const DIR = join(import.meta.dir, "..", "apps/native/locales")
const CATALOGS = { en, "pt-BR": ptBR } as const

type Tree = { readonly [key: string]: string | Tree }
const convert = (node: Tree): Record<string, unknown> =>
  Object.fromEntries(Object.entries(node).map(([k, v]) => [k, typeof v === "string" ? v.replace(/\{(\w+)\}/g, "%{$1}") : convert(v)]))

let stale = false
for (const [lang, catalog] of Object.entries(CATALOGS)) {
  const path = join(DIR, `${lang}.json`)
  const json = `${JSON.stringify(convert(catalog as Tree), null, 2)}\n`
  const current = (() => {
    try {
      return readFileSync(path, "utf8")
    } catch {
      return undefined
    }
  })()
  if (current === json) continue
  if (process.argv.includes("--check")) {
    console.error(`apps/native/locales/${lang}.json is out of date: run bun run i18n:native`)
    stale = true
  } else writeFileSync(path, json)
}
if (stale) process.exit(1)
