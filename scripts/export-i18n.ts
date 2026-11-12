// The interface text for the native client (spec 019): packages/i18n stays the only catalog. This writes
// apps/native/locales/app.json in rust-i18n's v2 shape (key → { en, pt-BR }), with `{name}` placeholders as rust-i18n's
// `%{name}` and plural leaves { one, other } as two keys (`….one`, `….other`) that the native client picks with the
// locale's plural rules (src/i18n.rs). Run: bun run i18n:native (--check to only compare; CI does).
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { en } from "../packages/i18n/src/en.ts"
import { ptBR } from "../packages/i18n/src/pt-BR.ts"

const OUT = join(import.meta.dir, "..", "apps/native/locales/app.json")
const CATALOGS = { en, "pt-BR": ptBR } as const

type Tree = { readonly [key: string]: string | Tree }
const placeholders = (s: string) => s.replace(/\{(\w+)\}/g, "%{$1}")

// Walks English (the source) and reads the same path in every language; the typecheck already keeps them equal.
function walk(node: Tree, path: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node)) {
    const at = [...path, key]
    out[key] =
      typeof value === "string"
        ? Object.fromEntries(Object.entries(CATALOGS).map(([lang, cat]) => [lang, placeholders(at.reduce<unknown>((n, k) => (n as Tree)[k], cat) as string)]))
        : walk(value, at)
  }
  return out
}

const json = `${JSON.stringify({ _version: 2, ...walk(en as Tree, []) }, null, 2)}\n`
const current = (() => {
  try {
    return readFileSync(OUT, "utf8")
  } catch {
    return undefined
  }
})()
if (current !== json) {
  if (process.argv.includes("--check")) {
    console.error("apps/native/locales/app.json is out of date: run bun run i18n:native")
    process.exit(1)
  }
  writeFileSync(OUT, json)
}
