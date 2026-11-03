// Segredos (chaves de API, variáveis de servidores MCP) ficam no chaveiro do sistema via Bun.secrets
// (Keychain no macOS, libsecret no Linux, Credential Manager no Windows), nunca no banco nem em arquivo.
// Variável de ambiente tem precedência: quem roda o server define o que vale.
import { Context, Effect, Layer } from "effect"
import { Store } from "./db.ts"

const SERVICE = "dev.zero.app"
export const API_KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY"] as const

export interface SecretStore {
  readonly get: (name: string) => string | undefined // síncrono: lido do cache carregado na partida
  readonly set: (name: string, value: string) => Promise<void> // vazio apaga
  readonly fromEnv: (name: string) => boolean
}

export class Secrets extends Context.Service<Secrets, SecretStore>()("Secrets") {
  // Chaveiro real. Pré-carrega as chaves de API e as variáveis de cada servidor MCP cadastrado.
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
  return {
    get: (name) => env(name) ?? cache.get(name),
    fromEnv: (name) => !!env(name),
    set: async (name, value) => {
      await persist(name, value)
      if (value) cache.set(name, value)
      else cache.delete(name)
    }
  }
}

// Variáveis de um servidor MCP, guardadas juntas como JSON.
export const mcpEnvName = (serverId: string) => `mcp:${serverId}`
export const mcpEnv = (s: SecretStore, serverId: string): Record<string, string> => {
  try {
    return JSON.parse(s.get(mcpEnvName(serverId)) ?? "{}")
  } catch {
    return {}
  }
}
