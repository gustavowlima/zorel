// The design tokens for the native client (spec 019 FR-008): apps/web/src/styles.css stays the only source (DESIGN.md:
// `--z-*` are the only colours, sizes, radii and durations). This reads its dark `:root` block and the light override,
// resolves var() and color-mix(in srgb, …), and writes apps/native/src/theme/tokens.rs (a Palette per theme, sizes in px,
// fractions, durations in ms) and apps/native/themes/zorel.json (gpui-component's theme, light and dark). A token whose value it can't read fails the run, so a new kind of value is noticed.
// Run: bun run tokens (--check to only compare; CI does).
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..")
const CSS = join(ROOT, "apps/web/src/styles.css")
const OUT = join(ROOT, "apps/native/src/theme/tokens.rs")
const THEME_OUT = join(ROOT, "apps/native/themes/zorel.json")

type Rgba = [number, number, number, number] // 0..1
type Value = { kind: "color"; rgba: Rgba } | { kind: "px"; n: number } | { kind: "fraction"; n: number } | { kind: "ms"; n: number } | { kind: "number"; n: number }

// The declarations of one block (`selector {` … `}` at column 0), comments stripped.
function block(css: string, selector: string): Map<string, string> {
  const start = css.indexOf(`\n${selector} {`)
  if (start < 0) throw new Error(`no ${selector} block in styles.css`)
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("\n}", start)).replace(/\/\*[\s\S]*?\*\//g, "")
  const out = new Map<string, string>()
  for (const m of body.matchAll(/(--z-[\w-]+)\s*:\s*([^;]+);/g)) out.set(m[1]!, m[2]!.trim())
  return out
}

const hex = (h: string): Rgba => {
  const s = h.length === 4 ? [...h.slice(1)].map((c) => c + c).join("") : h.slice(1)
  const n = (i: number) => Number.parseInt(s.slice(i, i + 2), 16) / 255
  return [n(0), n(2), n(4), s.length === 8 ? n(6) : 1]
}

function resolve(name: string, vars: Map<string, string>, seen: string[] = []): Value {
  const raw = vars.get(name)
  if (raw === undefined) throw new Error(`${name} is not defined (via ${seen.join(" → ")})`)
  if (seen.includes(name)) throw new Error(`cycle: ${[...seen, name].join(" → ")}`)
  return parse(raw, vars, [...seen, name], name)
}

function color(raw: string, vars: Map<string, string>, seen: string[]): Rgba {
  const v = parse(raw, vars, seen, raw)
  if (v.kind !== "color") throw new Error(`${raw} is not a colour`)
  return v.rgba
}

function parse(raw: string, vars: Map<string, string>, seen: string[], name: string): Value {
  const s = raw.trim()
  const ref = /^var\((--z-[\w-]+)\)$/.exec(s)
  if (ref) return resolve(ref[1]!, vars, seen)
  if (/^#[0-9a-f]{3,8}$/i.test(s)) return { kind: "color", rgba: hex(s) }
  if (s === "transparent") return { kind: "color", rgba: [0, 0, 0, 0] }
  const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s)
  if (rgba) return { kind: "color", rgba: [Number(rgba[1]) / 255, Number(rgba[2]) / 255, Number(rgba[3]) / 255, rgba[4] === undefined ? 1 : Number(rgba[4])] }
  // color-mix(in srgb, A p%, B): p% of A over B, mixed with premultiplied alpha (the CSS rule).
  const mix = /^color-mix\(in srgb,\s*(.+?)\s+([\d.]+)%,\s*(.+)\)$/.exec(s)
  if (mix) {
    const p = Number(mix[2]) / 100
    const a = color(mix[1]!, vars, seen)
    const b = color(mix[3]!, vars, seen)
    const alpha = a[3] * p + b[3] * (1 - p)
    const ch = (i: number) => (alpha === 0 ? 0 : (a[i]! * a[3] * p + b[i]! * b[3] * (1 - p)) / alpha)
    return { kind: "color", rgba: [ch(0), ch(1), ch(2), alpha] }
  }
  const unit = /^(-?[\d.]+)(px|%|s|ms)?$/.exec(s)
  if (unit) {
    const n = Number(unit[1])
    const kinds = { px: { kind: "px", n }, "%": { kind: "fraction", n: n / 100 }, s: { kind: "ms", n: n * 1000 }, ms: { kind: "ms", n }, "": { kind: "number", n } } as const
    return kinds[(unit[2] ?? "") as keyof typeof kinds]
  }
  throw new Error(`${name}: can't read "${s}"`)
}

// Not drawn by the native client yet, or not a single value (a multi-layer shadow): named here on purpose.
const SKIPPED = new Set(["--z-shadow-float"])

const css = readFileSync(CSS, "utf8")
const dark = block(css, ":root")
const light = new Map([...dark, ...block(css, ':root[data-theme="light"]')])
const names = [...dark.keys()].filter((n) => !n.startsWith("--z-base-") && !SKIPPED.has(n))

const field = (n: string) => n.slice(4).replace(/-/g, "_")
const f = (n: number) => {
  const r = Math.round(n * 10000) / 10000
  return Number.isInteger(r) ? `${r}.0` : String(r)
}
// What floats (menus, selects, popovers) is translucent on the web only because the browser blurs what is behind it.
// GPUI has no backdrop blur, so the native client gets these opaque: text behind a menu must never show through.
const OPAQUE = new Set(["--z-bg-float"])
const solid = (n: string, [r, g, b, a]: Rgba): Rgba => (OPAQUE.has(n) ? [r, g, b, 1] : [r, g, b, a])
const rgbaRs = ([r, g, b, a]: Rgba) => `Rgba { r: ${f(r)}, g: ${f(g)}, b: ${f(b)}, a: ${f(a)} }`

const colours = names.filter((n) => resolve(n, dark).kind === "color")
const scalars = names.filter((n) => resolve(n, dark).kind !== "color")
for (const n of scalars) if (JSON.stringify(resolve(n, dark)) !== JSON.stringify(resolve(n, light))) throw new Error(`${n} differs between themes: only colours may`)
const unitOf = { px: "px", fraction: "fraction of the box", ms: "ms", number: "" } as const

const rs = `// Generated by scripts/export-tokens.ts from apps/web/src/styles.css: do not edit. Run \`bun run tokens\`.
// Colours per theme (the light block overrides the dark :root); sizes and durations are the same in both.
#![allow(dead_code)]

use gpui_kit::Rgba;

pub struct Palette {
${colours.map((n) => `    pub ${field(n)}: Rgba,`).join("\n")}
}

pub const DARK: Palette = Palette {
${colours.map((n) => `    ${field(n)}: ${rgbaRs(solid(n, (resolve(n, dark) as { rgba: Rgba }).rgba))},`).join("\n")}
};

pub const LIGHT: Palette = Palette {
${colours.map((n) => `    ${field(n)}: ${rgbaRs(solid(n, (resolve(n, light) as { rgba: Rgba }).rgba))},`).join("\n")}
};

${scalars
  .map((n) => {
    const v = resolve(n, dark) as Exclude<Value, { kind: "color" }>
    const unit = unitOf[v.kind]
    return `${unit ? `/// ${unit}\n` : ""}pub const ${field(n).toUpperCase()}: f32 = ${f(v.n)};`
  })
  .join("\n")}
`

// The same roles as gpui-component's theme (its 99 colour keys), so the kit's ready-made components (tables, menus,
// dialogs, pickers…) wear Zorel's identity. Keys: gpui-component src/theme/default-theme.json.
const ROLE: Record<string, string> = {
  background: "bg-canvas", foreground: "text", border: "border", caret: "accent", ring: "accent", overlay: "overlay",
  "accent.background": "bg-control-hover", "accent.foreground": "text", "accordion.background": "bg-surface",
  "group_box.background": "bg-surface", "group_box.foreground": "text", "description_list_label.foreground": "text-secondary",
  "chart.1": "series-1", "chart.2": "series-2", "chart.3": "series-3", "chart.4": "series-4", "chart.5": "series-5",
  "chart.bullish": "success", "chart.bearish": "danger", "chart.grid": "border",
  "danger.background": "danger", "danger.foreground": "on-accent", "drag_border": "accent", "drop_target.background": "accent-soft",
  "info.background": "accent", "info.foreground": "on-accent", "input.border": "border-strong",
  "link.foreground": "link", "link.active.foreground": "link-hover", "link.hover.foreground": "link-hover",
  "list.background": "bg-canvas", "list.active.background": "bg-control-active", "list.active.border": "accent-line",
  "list.even.background": "bg-canvas", "list.head.background": "bg-surface", "list.hover.background": "bg-hover",
  "muted.background": "bg-control", "muted.foreground": "text-muted", "popover.background": "bg-surface", "popover.foreground": "text",
  "primary.background": "accent", "primary.active.background": "accent-hover", "primary.foreground": "on-accent", "primary.hover.background": "accent-hover",
  "progress_bar.background": "accent", "scrollbar.background": "bg-canvas", "scrollbar.thumb.background": "border-strong",
  "scrollbar.thumb.hover.background": "text-dim", "secondary.background": "bg-control", "secondary.active.background": "bg-control-active",
  "secondary.foreground": "text", "secondary.hover.background": "bg-control-hover", "selection.background": "accent-soft",
  "sidebar.background": "bg-sidebar", "sidebar.accent.background": "bg-control-active", "sidebar.accent.foreground": "text",
  "sidebar.border": "border", "sidebar.foreground": "text-secondary", "sidebar.primary.background": "accent", "sidebar.primary.foreground": "on-accent",
  "skeleton.background": "bg-control", "slider.bar.background": "accent", "slider.thumb.background": "on-accent",
  "success.background": "success", "success.foreground": "on-accent", "switch.background": "bg-control-active",
  "tab.background": "bg-canvas", "tab.active.background": "bg-control-active", "tab.active.foreground": "text", "tab_bar.background": "bg-canvas",
  "tab_bar.segmented.background": "bg-control", "tab.foreground": "text-muted", "table.background": "bg-canvas",
  "table.active.background": "bg-control-active", "table.active.border": "accent-line", "table.even.background": "bg-canvas",
  "table.head.background": "bg-surface", "table.head.foreground": "text-secondary", "table.hover.background": "bg-hover", "table.row.border": "border",
  "title_bar.background": "bg-frame", "title_bar.border": "border", "status_bar.background": "bg-frame", "status_bar.border": "border",
  "warning.background": "warning", "warning.foreground": "on-agent", "window.border": "border-strong",
  "base.red": "danger", "base.red.light": "danger-soft", "base.green": "success", "base.green.light": "done-soft",
  "base.blue": "accent", "base.blue.light": "accent-soft", "base.yellow": "warning", "base.yellow.light": "wait-soft",
  "base.magenta": "agent-5", "base.magenta.light": "agent-3", "base.cyan": "agent-2", "base.cyan.light": "series-1"
}
const hex8 = ([r, g, b, a]: Rgba) => `#${[r, g, b, a].map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("")}`
const px = (name: string) => (resolve(name, dark) as { n: number }).n
const themeOf = (mode: "light" | "dark", vars: Map<string, string>) => ({
  name: `Zorel ${mode === "dark" ? "Dark" : "Light"}`,
  mode,
  "font.size": 13.5, // the web's body size (styles.css body)
  "mono_font.family": "Menlo",
  radius: px("--z-radius-control"),
  "radius.lg": px("--z-radius-card"),
  colors: Object.fromEntries(Object.entries(ROLE).map(([key, role]) => [key, hex8(solid(`--z-${role}`, color(`var(--z-${role})`, vars, [])))]))
})
const theme = `${JSON.stringify({ name: "Zorel", author: "Zorel", themes: [themeOf("light", light), themeOf("dark", dark)] }, null, 2)}\n`
const themeCurrent = (() => {
  try {
    return readFileSync(THEME_OUT, "utf8")
  } catch {
    return undefined
  }
})()
if (themeCurrent !== theme) {
  if (process.argv.includes("--check")) {
    console.error("apps/native/themes/zorel.json is out of date: run bun run tokens")
    process.exit(1)
  }
  writeFileSync(THEME_OUT, theme)
}

// Formatted the way `cargo fmt` would (.rustfmt.toml), so formatting the crate never makes this file stale.
const fmt = Bun.spawnSync(["rustfmt", "--edition", "2024", "--emit", "stdout"], { cwd: ROOT, stdin: new TextEncoder().encode(rs) })
if (fmt.exitCode !== 0) throw new Error(`rustfmt failed: ${fmt.stderr.toString()}`)
const formatted = fmt.stdout.toString()

const current = (() => {
  try {
    return readFileSync(OUT, "utf8")
  } catch {
    return undefined
  }
})()
if (current !== formatted) {
  if (process.argv.includes("--check")) {
    console.error("apps/native/src/theme/tokens.rs is out of date: run bun run tokens")
    process.exit(1)
  }
  writeFileSync(OUT, formatted)
}
