// Theme overrides (spec 018): a person may change a role token — today the action colour — and every screen follows.
// Pure checks here (tested in theme.test.ts); state.ts stores the choice per browser and applies it on :root.

export type AccentCheck = { ok: true; hex: string } | { ok: false; reason: "format" | "contrast" }

const HEX = /^#([0-9a-f]{6})$/i
const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => channel(Number.parseInt(hex.slice(i, i + 2), 16) / 255))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

export const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x! + 0.05) / (y! + 0.05)
}

// White text sits on the action colour (primary buttons), so it must reach 4.5:1 against white.
export const MIN_ACCENT_CONTRAST = 4.5

export function checkAccent(value: string): AccentCheck {
  const v = value.trim().toLowerCase()
  if (!HEX.test(v)) return { ok: false, reason: "format" }
  return contrast(v, "#ffffff") >= MIN_ACCENT_CONTRAST ? { ok: true, hex: v } : { ok: false, reason: "contrast" }
}

// The role tokens an accent override sets: the colour, its hover (deeper, so white keeps its contrast) and the
// readable text tone of it (lighter in dark, the colour itself in light).
export function accentTokens(hex: string, theme: "dark" | "light"): Record<string, string> {
  return {
    "--z-accent": hex,
    "--z-accent-hover": `color-mix(in oklab, ${hex} 86%, black)`,
    "--z-accent-text": theme === "dark" ? `color-mix(in oklab, ${hex} 55%, white)` : hex
  }
}
