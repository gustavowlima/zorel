import { expect, test } from "bun:test"

// state.ts reads the browser (theme, storage) when it loads: just enough of one for the routes.
const g = globalThis as Record<string, unknown>
g.matchMedia ??= () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
g.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} }
const { hrefOf, parseRoute } = await import("./state.ts")

test("Memory, Pages and Skills routes round-trip; links from before the split land where the item lives now", () => {
  for (const hash of ["#/routine/r1/flow", "#/routine/r1/run/x9", "#/memory", "#/memory/review", "#/memory/agent%3Aa1", "#/pages", "#/pages/p1", "#/skills", "#/skills/s1", "#/skills/file/%2Fhome%2Fme%2Fskill"]) expect(hrefOf(parseRoute(hash))).toBe(hash)
  expect(parseRoute("#/knowledge/in:agent:a1/fact")).toEqual({ view: "memory", tab: "agent:a1" })
  expect(parseRoute("#/knowledge/in:user/skill")).toEqual({ view: "skills" })
  expect(parseRoute("#/knowledge/x9")).toEqual({ view: "knowledge", id: "x9" }) // App sends it to its screen
  expect(parseRoute("#/knowledge")).toEqual({ view: "memory" })
  expect(parseRoute("#/settings/skills")).toEqual({ view: "skills" })
  expect(parseRoute("#/skills/computer")).toEqual({ view: "skills" })
})
