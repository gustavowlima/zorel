// THIRD_PARTY_LICENSES.md: the license of every package that ships inside the app (the web bundle, the server
// binary, the desktop shell) with the packages they pull in, in full, as their licenses ask of copies we distribute.
// An Apache-2.0 package's NOTICE goes along too. Development tools are left out: nothing of them ships.
//   bun scripts/third-party-licenses.ts <out.md>      (the desktop build writes it next to the app's resources)
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

const ROOT = join(import.meta.dir, "..")
const SHIPPED = ["apps/web", "apps/server", "apps/desktop"] // their `dependencies` end up in what people download
const LICENSE_FILE = /^(licen[cs]e|copying)(\.|-|$)/i
const NOTICE_FILE = /^notice(\.|$)/i

type Pkg = { name: string; version: string; license: string; dir: string }

const read = (dir: string) => JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))
const licenseOf = (p: { license?: unknown; licenses?: Array<{ type?: string }> }) =>
  typeof p.license === "string" ? p.license : (p.licenses?.map((l) => l.type).join(" OR ") ?? "UNKNOWN")

// Node's lookup: node_modules/<name> in this folder or any above it (Bun's isolated layout keeps a package's
// dependencies next to it, so the walk starts at the package's real folder).
function find(name: string, from: string): string | undefined {
  for (let d = from; ; d = dirname(d)) {
    const candidate = join(d, "node_modules", name)
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate)
    if (dirname(d) === d) return undefined
  }
}

const found = new Map<string, Pkg>() // by name@version
function walk(dir: string, workspace: boolean) {
  const p = read(dir)
  const deps = { ...p.dependencies, ...p.optionalDependencies }
  if (!workspace) {
    const key = `${p.name}@${p.version}`
    if (found.has(key)) return
    found.set(key, { name: p.name, version: p.version, license: licenseOf(p), dir })
  }
  for (const [name, spec] of Object.entries(deps)) {
    const at = find(name, dir)
    if (!at) continue // an optional one for another system
    walk(at, String(spec).startsWith("workspace:"))
  }
}
for (const app of SHIPPED) walk(join(ROOT, app), true)

const files = (dir: string, re: RegExp) =>
  readdirSync(dir)
    .filter((f) => re.test(f))
    .sort()
    .map((f) => readFileSync(join(dir, f), "utf8").trim())

const pkgs = [...found.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
const missing: string[] = []
const sections = pkgs.map((p) => {
  const texts = files(p.dir, LICENSE_FILE)
  if (!texts.length) missing.push(`${p.name}@${p.version}`)
  const notices = /apache/i.test(p.license) ? files(p.dir, NOTICE_FILE) : []
  const body = [...texts, ...notices].join("\n\n") || `License: ${p.license} (the package ships no license file).`
  return `## ${p.name} ${p.version}\n\nLicense: ${p.license}\n\n~~~~\n${body}\n~~~~\n`
})

const out = process.argv[2] ?? "THIRD_PARTY_LICENSES.md"
writeFileSync(
  out,
  `# Third-party licenses\n\nZorel ships the packages below inside the app, under their own licenses. Electron and Chromium bring their\nown license files (LICENSE.electron.txt, LICENSES.chromium.html), and the agents' browser its own\n(browsers/…/LICENSE.headless_shell). Attributions for code Zorel derives from are in NOTICE.\n\n${pkgs.length} packages.\n\n${sections.join("\n")}`
)
console.log(`${out}: ${pkgs.length} packages${missing.length ? `; no license file in ${missing.length} (their license is named): ${missing.join(", ")}` : ""}`)
