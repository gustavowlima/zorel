import { expect, test } from "bun:test"
import { billingOf, costOf, priceFor } from "./pricing.ts"

const catalog = {
  anthropic: {
    "claude-opus-5": { cost: { input: 5, output: 25, cache_read: 0.5 }, family: "claude-opus", release_date: "2026-07-24" },
    "claude-opus-5-5": { cost: { input: 4, output: 20, cache_read: 0.2 }, family: "claude-opus", release_date: "2026-09-22" }
  },
  openai: { "gpt-5.5": { cost: { input: 1, output: 8 } } }
}

test("subscription aliases price as the newest model of their family; API ids as themselves", () => {
  expect(priceFor(catalog, "claude-cli/opus")).toEqual({ input: 4, output: 20, cacheRead: 0.2 })
  expect(priceFor(catalog, "anthropic/claude-opus-5")).toEqual({ input: 5, output: 25, cacheRead: 0.5 })
  expect(priceFor(catalog, "openai/gpt-5.5")).toEqual({ input: 1, output: 8, cacheRead: 1 }) // no cache price: input price
  expect(priceFor(catalog, "codex-cli/default")).toBeUndefined() // the model Codex picks is unknown
  expect(priceFor(catalog, "ollama/llama3.3")).toEqual({ input: 0, output: 0, cacheRead: 0 })
})

test("cost: cached input at the cache price, the rest at input and output prices", () => {
  const price = { input: 4, output: 20, cacheRead: 0.2 }
  // 1M in (of which 500K cached) + 100K out = 0.5×4 + 0.5×0.2 + 0.1×20
  expect(costOf(price, { inputTokens: 1_000_000, cachedTokens: 500_000, outputTokens: 100_000 })).toBeCloseTo(4.1)
  expect(costOf(undefined, { inputTokens: 1, cachedTokens: 0, outputTokens: 1 })).toBeNull()
  expect([billingOf("claude-cli/opus"), billingOf("anthropic/x"), billingOf("ollama/y")]).toEqual(["subscription", "api", "local"])
})
