import { expect, test } from "bun:test"
import { formatAge, formatBytes, formatCompact, formatDuration, formatPercent, t } from "./index.ts"

test("t: plain, placeholders and numbers formatted", () => {
  expect(t("nav.needsYou")).toBe("Notifications")
  expect(t("status.running", { agent: "Coder" })).toBe("Coder is working")
  expect(t("chat.tokens", { input: "1.2K", output: "340" })).toBe("1.2K in · 340 out")
})

test("t: plural picks by count", () => {
  expect(t("nav.showMore", { count: 1 })).toBe("Show 1 more")
  expect(t("nav.showMore", { count: 6 })).toBe("Show 6 more")
  expect(t("activity.usedTools", { count: 1200 })).toBe("Used 1,200 tools")
})

test("formatters", () => {
  expect(formatDuration(14_000)).toBe("14s")
  expect(formatDuration(130_000)).toBe("2m 10s")
  expect(formatDuration(6_000_000)).toBe("1h 40m")
  expect(formatCompact(42_300)).toBe("42.3K")
  expect(formatPercent(0.72)).toBe("72%")
  const now = Date.now()
  expect(formatAge(now - 20_000, now)).toBe("now")
  expect(formatAge(now - 2 * 3_600_000, now)).toBe("2h")
  expect(formatAge(now - 3 * 86_400_000, now)).toBe("3d")
  expect(formatAge(Date.UTC(2020, 0, 15), Date.UTC(2026, 10, 3))).toBe("Jan 15, 2020")
  expect([formatBytes(512), formatBytes(94_000), formatBytes(6_300_000_000)]).toEqual(["512 B", "94 kB", "6.3 GB"])
  expect(t("storage.categories.other")).toBe("Other") // a branch with an "other" key is not a plural
  expect(formatAge(0, now)).toBe("") // missing timestamps from old data have no age
  expect(formatAge(1, now)).toBe("")
})

test("pt-BR has exactly en's keys, plurals where en has them, and the same {placeholders}", async () => {
  const { en } = await import("./en.ts")
  const { ptBR } = await import("./pt-BR.ts")
  type Node = string | { readonly [k: string]: Node }
  const leaves = (n: Node, path = ""): Array<[string, string]> => (typeof n === "string" ? [[path, n]] : Object.entries(n).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k)))
  const a = new Map(leaves(en as Node))
  const b = new Map(leaves(ptBR as Node))
  expect([...b.keys()].filter((k) => !a.has(k))).toEqual([])
  expect([...a.keys()].filter((k) => !b.has(k))).toEqual([])
  const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
  const off = [...a].filter(([k, v]) => JSON.stringify(holes(v)) !== JSON.stringify(holes(b.get(k)!))).map(([k]) => k)
  expect(off).toEqual([])
})
