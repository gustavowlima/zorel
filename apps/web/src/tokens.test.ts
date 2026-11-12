// Spec 018: the role tokens meet their contrast floors in both themes, and the agent hues share one lightness and
// chroma. Reads styles.css itself, so a token edit that breaks a floor fails here.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const css = readFileSync(join(import.meta.dir, "styles.css"), "utf8")

// The declarations of the first block that opens with `selector {` (no nesting inside these blocks).
const block = (selector: string) => {
  const start = css.indexOf(`${selector} {`)
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("\n}", start))
  return Object.fromEntries([...body.matchAll(/(--z-[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2]!.trim()]))
}
const dark = block(":root")
const light = { ...dark, ...block(':root[data-theme="light"]') }

// A role's final hex, following var() references inside one theme.
const hex = (theme: Record<string, string>, name: string): string => {
  const v = theme[name]
  if (!v) throw new Error(`missing ${name}`)
  const ref = v.match(/^var\((--z-[\w-]+)\)$/)
  if (ref) return hex(theme, ref[1]!)
  if (!/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`${name} is not a hex: ${v}`)
  return v
}
const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const luminance = (h: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => channel(Number.parseInt(h.slice(i, i + 2), 16) / 255))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x! + 0.05) / (y! + 0.05)
}
// OKLCH lightness and chroma of a hex.
const oklch = (h: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => channel(Number.parseInt(h.slice(i, i + 2), 16) / 255))
  const l = Math.cbrt(0.4122214708 * r! + 0.5363325363 * g! + 0.0514459929 * b!)
  const m = Math.cbrt(0.2119034982 * r! + 0.6806995451 * g! + 0.1073969566 * b!)
  const s = Math.cbrt(0.0883024619 * r! + 0.2817188376 * g! + 0.6299787005 * b!)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return { L, C: Math.hypot(A, B) }
}

const floors: Array<[string, number]> = [
  ["--z-text", 16],
  ["--z-text-secondary", 10],
  ["--z-text-muted", 5.5],
  ["--z-link", 7]
]

describe.each([
  ["dark", dark],
  ["light", light]
] as const)("%s theme", (_, theme) => {
  // The spec's floors are measured on the canvas; on surface and raised every text role still reads (≥ 4.5:1).
  test.each(floors)("%s on the canvas", (fg, floor) => {
    expect(contrast(hex(theme, fg), hex(theme, "--z-bg-canvas"))).toBeGreaterThanOrEqual(floor)
  })
  for (const bg of ["--z-bg-surface", "--z-bg-raised"]) {
    test.each(floors)(`%s on ${bg}`, (fg) => {
      expect(contrast(hex(theme, fg), hex(theme, bg))).toBeGreaterThanOrEqual(4.5)
    })
  }
  test("white on the action colour", () => {
    expect(contrast(hex(theme, "--z-on-accent"), hex(theme, "--z-accent"))).toBeGreaterThanOrEqual(4.5)
  })
  test("dim text still reads on the canvas", () => {
    expect(contrast(hex(theme, "--z-text-dim"), hex(theme, "--z-bg-canvas"))).toBeGreaterThanOrEqual(4.5)
  })
})

test("the six agent hues share one OKLCH lightness and chroma", () => {
  const hues = [1, 2, 3, 4, 5, 6].map((n) => oklch(hex(dark, `--z-agent-${n}`)))
  for (const h of hues) {
    expect(Math.abs(h.L - hues[0]!.L)).toBeLessThan(0.01)
    expect(Math.abs(h.C - hues[0]!.C)).toBeLessThan(0.01)
  }
})

test("agent hues read on the dark canvas", () => {
  for (const n of [1, 2, 3, 4, 5, 6]) expect(contrast(hex(dark, `--z-agent-${n}`), hex(dark, "--z-bg-canvas"))).toBeGreaterThanOrEqual(7)
})

// Nested shapes are concentric: the inner radius is the outer one minus the gap between them (spec 018, FR-009).
const px = (name: string) => Number.parseFloat(dark[name]!)
test("a card's rows sit concentric in it (card − inset = row)", () => {
  expect(px("--z-radius-card") - px("--z-inset-card")).toBe(px("--z-radius-row"))
})
test("a segmented item sits concentric in its track (control − 3px = item)", () => {
  expect(px("--z-radius-control") - 3).toBe(px("--z-radius-seg"))
})
