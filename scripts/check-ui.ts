// UI ratchet (DESIGN.md, "Como o design system se mantém"): screens use the primitives in apps/web/src/ui
// and the theme tokens, never literal colors, arbitrary sizes, raw controls or icon glyphs.
// Existing debt is frozen in apps/web/ui-baseline.json: a file may only go down, never up.
//   bun scripts/check-ui.ts            check (CI)
//   bun scripts/check-ui.ts --update   rewrite the baseline after paying debt down
import { Glob } from "bun"
import { relative } from "node:path"

const ROOT = new URL("../apps/web/", import.meta.url).pathname
const BASELINE = `${ROOT}ui-baseline.json`
// The design system itself (src/ui) may use what screens can't.
const EXEMPT = [/^src\/ui\//]

interface Rule {
  readonly id: string
  readonly hint: string
  readonly pattern: RegExp
}

const RULES: ReadonlyArray<Rule> = [
  { id: "literal-color", hint: "use a theme token (bg-surface, text-muted…)", pattern: /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch)\(/g },
  { id: "arbitrary-value", hint: "use the Tailwind scale or a token, not [..]", pattern: /\b[a-z][\w-]*-\[[^\]\s]+\]/g },
  { id: "raw-control", hint: "use Button/IconButton/Input/Select/Textarea/Switch from @/ui", pattern: /<(?:button|input|select|textarea)\b/g },
  { id: "direct-import", hint: "import icons and controls from @/ui", pattern: /from\s+["'](?:lucide-react|react-aria-components)["']/g },
  { id: "glyph-icon", hint: "use an icon from @/ui, not a unicode glyph", pattern: /[×✕✓✔▸▾▶◀►▼●○]/g },
  { id: "hand-list", hint: "use Rows (and ListRow) from @/ui for a list between hairlines", pattern: /divide-y divide-subtle border-y border-subtle/g },
  { id: "hand-notice", hint: "use Notice from @/ui for an alert card on a page", pattern: /role="alert"[^>]*\brounded-card\b/g },
  { id: "hand-search", hint: "use SearchInput from @/ui (the magnifier in one place and size)", pattern: /<Search\b[^>]*\babsolute\b/g },
  { id: "hand-listbox", hint: "use OptionList/OptionRow (or Select, Menu) from @/ui", pattern: /role="(?:listbox|option)"/g },
  { id: "input-height", hint: "use the Input size prop (size=\"sm\"), not a height class", pattern: /<(?:Input|SearchInput)\b[^>]*className="[^"]*\bh-control/g }
]

type Counts = Record<string, Record<string, number>> // file → rule → count

async function scan(): Promise<Counts> {
  const counts: Counts = {}
  for await (const abs of new Glob("src/**/*.{ts,tsx}").scan({ cwd: ROOT, absolute: true })) {
    const file = relative(ROOT, abs)
    if (EXEMPT.some((r) => r.test(file)) || file.endsWith(".test.ts")) continue
    // Comments may mention anything; only code counts.
    const code = (await Bun.file(abs).text()).replace(/\/\*[\s\S]*?\*\/|(^|[^:"'`])\/\/.*$/gm, "$1")
    for (const rule of RULES) {
      const n = code.match(rule.pattern)?.length ?? 0
      if (n) (counts[file] ??= {})[rule.id] = n
    }
  }
  return counts
}

const sorted = (c: Counts): Counts =>
  Object.fromEntries(Object.keys(c).sort().map((f) => [f, Object.fromEntries(Object.entries(c[f]!).sort(([a], [b]) => a.localeCompare(b)))]))

const now = await scan()
if (process.argv.includes("--update")) {
  await Bun.write(BASELINE, `${JSON.stringify(sorted(now), null, 2)}\n`)
  console.log(`ui-baseline.json atualizado (${Object.keys(now).length} arquivos com dívida).`)
  process.exit(0)
}

const base: Counts = (await Bun.file(BASELINE).exists()) ? await Bun.file(BASELINE).json() : {}
const worse: string[] = []
const better: string[] = []
for (const file of new Set([...Object.keys(now), ...Object.keys(base)])) {
  for (const rule of RULES) {
    const was = base[file]?.[rule.id] ?? 0
    const is = now[file]?.[rule.id] ?? 0
    if (is > was) worse.push(`  ${file}: ${rule.id} ${was} → ${is} (${rule.hint})`)
    else if (is < was) better.push(`  ${file}: ${rule.id} ${was} → ${is}`)
  }
}
if (better.length) console.log(`Dívida de UI paga, rode \`bun run check:ui --update\` para travar:\n${better.join("\n")}`)
if (worse.length) {
  console.error(`check:ui falhou, a UI piorou:\n${worse.join("\n")}`)
  process.exit(1)
}
console.log("check:ui ok")
