// i18n check (ARCHITECTURE §10.1, D13): no literal interface text in JSX outside the catalog
// (packages/i18n). Parses every .tsx and flags JSX text with letters, and string literals in the props a
// person reads or hears (placeholder, aria-label, title…). Run: bun scripts/check-i18n.ts
import { parse } from "@babel/parser"
import { Glob } from "bun"
import { relative } from "node:path"

const ROOT = new URL("../apps/web/", import.meta.url).pathname
const PROPS = new Set(["placeholder", "aria-label", "title", "label", "description", "confirmLabel", "hint", "content", "alt", "subtitle"])
const HAS_WORD = /\p{L}{2}/u

type Node = { type: string; loc?: { start: { line: number } }; [key: string]: unknown }

function* walk(node: unknown): Generator<Node> {
  if (!node || typeof node !== "object") return
  if (Array.isArray(node)) {
    for (const n of node) yield* walk(n)
    return
  }
  const n = node as Node
  if (typeof n.type === "string") yield n
  for (const [k, v] of Object.entries(n)) if (k !== "loc" && k !== "start" && k !== "end" && v && typeof v === "object") yield* walk(v)
}

const problems: string[] = []
for await (const abs of new Glob("src/**/*.tsx").scan({ cwd: ROOT, absolute: true })) {
  const file = relative(ROOT, abs)
  const ast = parse(await Bun.file(abs).text(), { sourceType: "module", plugins: ["typescript", "jsx"] })
  for (const n of walk(ast.program)) {
    const line = n.loc?.start.line ?? 0
    if (n.type === "JSXText" && HAS_WORD.test(String(n.value))) problems.push(`  ${file}:${line} text: ${JSON.stringify(String(n.value).trim().slice(0, 60))}`)
    if (n.type === "JSXAttribute") {
      const name = (n.name as Node).name as string
      const value = n.value as Node | null
      const literal = value?.type === "StringLiteral" ? String(value.value) : undefined
      if (literal !== undefined && PROPS.has(name) && HAS_WORD.test(literal)) problems.push(`  ${file}:${line} ${name}: ${JSON.stringify(literal.slice(0, 60))}`)
    }
  }
}

if (problems.length) {
  console.error(`check:i18n falhou, texto fora do catálogo (use t() de @zero/i18n):\n${problems.join("\n")}`)
  process.exit(1)
}
console.log("check:i18n ok")
