// Estimated cost (ARCHITECTURE §10.2): token prices from the models.dev catalog (the one OpenCode uses),
// kept on disk and refreshed once a day; offline, the last copy is used and unknown models cost null.
// The same catalog gives each model's context window (the composer's context meter).
// API keys pay per token. Subscriptions don't: for them the same number is shown as the "API equivalent".
import { Context, Effect, Layer } from "effect"
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { DataDir } from "./chat.ts"
import { splitModel } from "./engines.ts"

const CATALOG_URL = "https://models.dev/api.json"
const MAX_AGE_MS = 24 * 60 * 60_000
const PROVIDERS = ["anthropic", "openai", "openrouter"] as const // the only ones Zero prices today

// USD per million tokens.
export interface Price {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
}
type Model = {
  readonly cost?: { input?: number; output?: number; cache_read?: number }
  readonly limit?: { context?: number }
  readonly family?: string
  readonly release_date?: string
}
export type Catalog = Partial<Record<(typeof PROVIDERS)[number], Record<string, Model>>>

const priceOf = (m: Model | undefined): Price | undefined =>
  m?.cost?.input === undefined || m.cost.output === undefined ? undefined : { input: m.cost.input, output: m.cost.output, cacheRead: m.cost.cache_read ?? m.cost.input }

// The newest model of a family ("claude-opus" → the latest Opus): what a subscription alias runs today.
const newestOf = (models: Record<string, Model> | undefined, family: string) =>
  Object.values(models ?? {})
    .filter((m) => m.family === family && m.cost)
    .sort((a, b) => (b.release_date ?? "").localeCompare(a.release_date ?? ""))[0]

// The catalog entry a Zero model id runs today (subscription aliases resolve to the newest of the family).
function entryOf(catalog: Catalog, model: string): Model | undefined {
  const { provider, model: id } = splitModel(model)
  if (provider === "claude-cli") return catalog.anthropic?.[id] ?? newestOf(catalog.anthropic, `claude-${id}`)
  if (provider === "codex-cli") return id === "default" ? undefined : catalog.openai?.[id]
  if (provider === "anthropic" || provider === "openai" || provider === "openrouter") return catalog[provider]?.[id]
  return undefined
}

export function priceFor(catalog: Catalog, model: string): Price | undefined {
  const { provider } = splitModel(model)
  if (provider === "ollama" || provider === "lmstudio") return { input: 0, output: 0, cacheRead: 0 }
  return priceOf(entryOf(catalog, model))
}

// Context window in tokens, or null when the catalog doesn't know the model.
export const windowFor = (catalog: Catalog, model: string): number | null => entryOf(catalog, model)?.limit?.context ?? null

// Our input counts include the cached tokens (they are read at the cache price).
export function costOf(price: Price | undefined, t: { inputTokens: number; outputTokens: number; cachedTokens: number }): number | null {
  if (!price) return null
  const fresh = Math.max(0, t.inputTokens - t.cachedTokens)
  return (fresh * price.input + t.cachedTokens * price.cacheRead + t.outputTokens * price.output) / 1_000_000
}

export const billingOf = (model: string): "subscription" | "api" | "local" => {
  const { provider } = splitModel(model)
  return provider === "claude-cli" || provider === "codex-cli" ? "subscription" : provider === "ollama" || provider === "lmstudio" ? "local" : "api"
}

export interface PricingService {
  readonly cost: (model: string, tokens: { inputTokens: number; outputTokens: number; cachedTokens: number }) => number | null
  readonly contextWindow: (model: string) => number | null
}

export class Pricing extends Context.Service<Pricing, PricingService>()("Pricing") {
  // Tests: a fixed catalog, no network.
  static fixed = (catalog: Catalog) =>
    Layer.succeed(Pricing, { cost: (model, tokens) => costOf(priceFor(catalog, model), tokens), contextWindow: (model) => windowFor(catalog, model) })

  static layer = Layer.effect(
    Pricing,
    Effect.gen(function* () {
      const file = join(yield* DataDir, "pricing.json")
      let catalog: Catalog = {}
      try {
        if (existsSync(file)) catalog = JSON.parse(readFileSync(file, "utf8"))
      } catch {
        catalog = {} // a broken copy is replaced on the next refresh
      }
      // A copy saved before windows were kept has no `limit`: read it again.
      const hasWindows = Object.values(catalog.anthropic ?? {}).some((m) => m.limit)
      const stale = !existsSync(file) || !hasWindows || Date.now() - statSync(file).mtimeMs > MAX_AGE_MS
      if (stale)
        yield* Effect.forkDetach(
          Effect.tryPromise(async () => {
            const all = (await (await fetch(CATALOG_URL, { signal: AbortSignal.timeout(20_000) })).json()) as Record<string, { models?: Record<string, Model> }>
            const kept: Catalog = {}
            for (const p of PROVIDERS)
              kept[p] = Object.fromEntries(
                Object.entries(all[p]?.models ?? {}).map(([id, m]) => [id, { cost: m.cost, limit: m.limit && { context: m.limit.context }, family: m.family, release_date: m.release_date } as Model])
              )
            writeFileSync(file, JSON.stringify(kept))
            catalog = kept
          }).pipe(Effect.catch((e) => Effect.logWarning("pricing catalog not refreshed", { error: String(e) })))
        )
      return { cost: (model, tokens) => costOf(priceFor(catalog, model), tokens), contextWindow: (model) => windowFor(catalog, model) }
    })
  )
}
