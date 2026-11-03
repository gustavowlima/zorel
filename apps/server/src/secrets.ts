// Secrets (API keys, MCP server variables) live in the system keychain via Bun.secrets
// (Keychain on macOS, libsecret on Linux, Credential Manager on Windows), never in the database or a file.
// Environment variables take precedence: whoever runs the server decides what applies.
import { registerSecret } from "./observability.ts"
import { Context, Effect, Layer } from "effect"
import { Store } from "./db.ts"

const SERVICE = "dev.zero.app"
export const API_KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY"] as const

export interface SecretStore {
  readonly get: (name: string) => string | undefined // synchronous: read from the cache loaded at startup
  readonly set: (name: string, value: string) => Promise<void> // empty deletes
  readonly fromEnv: (name: string) => boolean
}

export class Secrets extends Context.Service<Secrets, SecretStore>()("Secrets") {
  // Real keychain. Preloads the API keys and the variables of each registered MCP server.
  static layer = Layer.effect(
    Secrets,
    Effect.gen(function* () {
      const store = yield* Store
      const names = [...API_KEYS, ...(yield* store.mcpServers()).map((s) => mcpEnvName(s.id))]
      return yield* Effect.promise(async () => {
        const cache = new Map<string, string>()
        await Promise.all(
          names.map(async (name) => {
            const v = await Bun.secrets.get({ service: SERVICE, name }).catch(() => null)
            if (v) cache.set(name, v)
          })
        )
        return memoryStore(cache, async (name, value) => {
          if (value) await Bun.secrets.set({ service: SERVICE, name, value })
          else await Bun.secrets.delete({ service: SERVICE, name }).catch(() => false)
        })
      })
    })
  )

  static memory = (initial: Record<string, string> = {}) => Layer.succeed(Secrets, memoryStore(new Map(Object.entries(initial))))
}

function memoryStore(cache: Map<string, string>, persist: (name: string, value: string) => Promise<unknown> = async () => {}): SecretStore {
  const env = (name: string) => process.env[name]?.trim() || undefined
  for (const v of cache.values()) registerSecret(v)
  for (const name of API_KEYS) registerSecret(env(name))
  return {
    get: (name) => env(name) ?? cache.get(name),
    fromEnv: (name) => !!env(name),
    set: async (name, value) => {
      registerSecret(value)
      await persist(name, value)
      if (value) cache.set(name, value)
      else cache.delete(name)
    }
  }
}

// An MCP server's variables, stored together as JSON.
export const mcpEnvName = (serverId: string) => `mcp:${serverId}`
export const mcpEnv = (s: SecretStore, serverId: string): Record<string, string> => {
  try {
    return JSON.parse(s.get(mcpEnvName(serverId)) ?? "{}")
  } catch {
    return {}
  }
}
