import { expect, test } from "bun:test"
import { formatAge, formatCompact, formatDuration, formatPercent, t } from "./index.ts"

test("t: plain, placeholders and numbers formatted", () => {
  expect(t("nav.needsYou")).toBe("Needs you")
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
  expect(formatAge(0, now)).toBe("") // missing timestamps from old data have no age
  expect(formatAge(1, now)).toBe("")
})
