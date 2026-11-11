// Secrets (API keys, MCP server variables) live in the system keychain via Bun.secrets
// (Keychain on macOS, libsecret on Linux, Credential Manager on Windows), never in the database. A server without a
// keychain (spec 014) keeps them in a file vault instead: each value sealed with AES-256-GCM under a key only the
// server's user can read. Environment variables take precedence: whoever runs the server decides what applies.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { join } from "node:path"
import { registerSecret } from "./observability.ts"
import { Context, Effect, Layer } from "effect"
import { Store } from "./db.ts"

const SERVICE = "dev.zorel.app"
const LEGACY_SERVICE = "dev.zero.app" // before the rename to Zorel: read once, copied to SERVICE
export const API_KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "TELEGRAM_BOT_TOKEN"] as const // the last: the Telegram channel (telegram.ts)
export const BROWSER_KEY = "browser-state-key" // the key the agents' saved browser logins are sealed with (browser.ts)

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
      const servers = yield* store.mcpServers()
      const names = [...API_KEYS, BROWSER_KEY, ...servers.map((s) => mcpEnvName(s.id)), ...servers.filter((s) => s.auth === "oauth").map((s) => oauthKey(s.id))]
      return yield* Effect.promise(async () => {
        const cache = new Map<string, string>()
        await Promise.all(
          names.map(async (name) => {
            let v = await Bun.secrets.get({ service: SERVICE, name }).catch(() => null)
            if (!v) {
              v = await Bun.secrets.get({ service: LEGACY_SERVICE, name }).catch(() => null)
              if (v) await Bun.secrets.set({ service: SERVICE, name, value: v }).catch(() => {})
            }
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

  // The file vault (a server without a keychain): every value is in it, so nothing needs preloading.
  static file = (dataDir: string) => Layer.sync(Secrets, () => fileVault(dataDir))
}

// <dataDir>/vault.json holds { name: base64(iv | tag | ciphertext) }; <dataDir>/vault.key the 32-byte key (0600). The
// key and the vault are backed up together (docs/server.md); without the key the vault can't be read.
export function fileVault(dataDir: string): SecretStore {
  mkdirSync(dataDir, { recursive: true })
  const keyFile = join(dataDir, "vault.key")
  const vaultFile = join(dataDir, "vault.json")
  if (!existsSync(keyFile)) writeFileSync(keyFile, randomBytes(32), { mode: 0o600 })
  chmodSync(keyFile, 0o600)
  const key = readFileSync(keyFile)
  if (key.length !== 32) throw new Error(`${keyFile} isn't a vault key (32 bytes).`)
  const sealed: Record<string, string> = existsSync(vaultFile) ? JSON.parse(readFileSync(vaultFile, "utf8")) : {}
  const cache = new Map(Object.entries(sealed).map(([name, box]) => [name, open(key, box)]))
  return memoryStore(cache, async (name, value) => {
    if (value) sealed[name] = seal(key, value)
    else delete sealed[name]
    const tmp = `${vaultFile}.tmp`
    writeFileSync(tmp, JSON.stringify(sealed), { mode: 0o600 })
    renameSync(tmp, vaultFile) // never half-written
  })
}
const seal = (key: Buffer, value: string) => {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64")
}
const open = (key: Buffer, box: string) => {
  const raw = Buffer.from(box, "base64")
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12))
  decipher.setAuthTag(raw.subarray(12, 28))
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8")
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
// An OAuth connector's client registration and tokens (oauth.ts).
export const oauthKey = (serverId: string) => `mcp-oauth:${serverId}`
export const mcpEnv = (s: SecretStore, serverId: string): Record<string, string> => {
  try {
    return JSON.parse(s.get(mcpEnvName(serverId)) ?? "{}")
  } catch {
    return {}
  }
}
