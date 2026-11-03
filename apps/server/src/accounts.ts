// Provider accounts (ARCHITECTURE §6.1): several logins per provider, each in its own CLI folder.
// Zero runs the official login/status/logout commands with that folder and only keeps what the CLI
// reports for display (e-mail, plan). It never reads or stores the token.
import type { AccountProvider, ProviderAccount } from "@zero/contracts"
import { Context, Effect, Layer } from "effect"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { join, resolve, sep } from "node:path"
import { DataDir } from "./chat.ts"
import { type AccountRow, Store } from "./db.ts"
import { splitModel } from "./engines.ts"

const STATUS_TTL_MS = 30_000
const URL_WAIT_MS = 8_000

// Which account provider serves a model provider.
const ACCOUNT_OF_MODEL: Record<string, AccountProvider> = { "claude-cli": "claude", "codex-cli": "codex" }
const defaultId = (p: AccountProvider) => `${p}-default`

interface Status {
  readonly loggedIn: boolean
  readonly identity: string | null
}

const envFor = (a: AccountRow): Record<string, string> => {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  if (a.home && a.provider === "claude") env.CLAUDE_CONFIG_DIR = a.home
  if (a.home && a.provider === "codex") env.CODEX_HOME = a.home
  return env
}

const COMMANDS: Record<AccountProvider, { bin: string; status: string[]; login: string[]; logout: string[] }> = {
  claude: { bin: "claude", status: ["auth", "status", "--json"], login: ["auth", "login", "--claudeai"], logout: ["auth", "logout"] },
  codex: { bin: "codex", status: ["login", "status"], login: ["login"], logout: ["logout"] }
}

async function run(a: AccountRow, args: string[]) {
  const bin = Bun.which(COMMANDS[a.provider as AccountProvider].bin)
  if (!bin) return { code: -1, out: "" }
  if (a.home) mkdirSync(a.home, { recursive: true })
  const proc = Bun.spawn([bin, ...args], { env: envFor(a), stdin: "ignore", stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  return { code, out: `${out}\n${err}` }
}

async function readStatus(a: AccountRow): Promise<Status> {
  const { code, out } = await run(a, COMMANDS[a.provider as AccountProvider].status)
  if (a.provider === "claude") {
    try {
      const s = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1))
      return { loggedIn: !!s.loggedIn, identity: [s.email, s.subscriptionType].filter(Boolean).join(" · ") || null }
    } catch {
      return { loggedIn: false, identity: null }
    }
  }
  const loggedIn = code === 0 && /logged in/i.test(out) && !/not logged in/i.test(out)
  return { loggedIn, identity: loggedIn ? (/using (\w+)/i.exec(out)?.[1] ?? null) : null }
}

export interface AccountsService {
  readonly list: Effect.Effect<ProviderAccount[]>
  readonly create: (provider: AccountProvider, label: string) => Effect.Effect<ProviderAccount>
  readonly rename: (id: string, label: string) => Effect.Effect<ProviderAccount | undefined>
  readonly remove: (id: string) => Effect.Effect<"ok" | "not-found" | "default">
  readonly login: (id: string) => Effect.Effect<{ url: string | null } | "not-found" | "busy">
  // The account a turn runs on: the chosen one if it serves this model, otherwise the provider's default.
  readonly resolve: (model: string, accountId: string | null) => Effect.Effect<AccountRow | undefined>
}

export class Accounts extends Context.Service<Accounts, AccountsService>()("Accounts") {
  static layer = Layer.effect(
    Accounts,
    Effect.gen(function* () {
      const store = yield* Store
      const dataDir = yield* DataDir
      const root = resolve(dataDir, "accounts")
      // Default accounts: Claude uses the CLI's own login; Codex always gets a Zero-owned folder (the
      // app-server would load the user's config.toml otherwise; see engines/codex.ts).
      yield* store.ensureAccount({ id: defaultId("claude"), label: "Claude", kind: "subscription", provider: "claude", home: null, secret: null, baseUrl: null, identity: null })
      yield* store.ensureAccount({ id: defaultId("codex"), label: "Codex", kind: "subscription", provider: "codex", home: join(root, defaultId("codex")), secret: null, baseUrl: null, identity: null })

      const cache = new Map<string, { at: number; status: Status }>()
      const logins = new Set<string>()
      const status = (a: AccountRow) =>
        Effect.promise(async () => {
          const hit = cache.get(a.id)
          if (hit && Date.now() - hit.at < STATUS_TTL_MS) return hit.status
          const s = await readStatus(a)
          cache.set(a.id, { at: Date.now(), status: s })
          return s
        })
      const toPublic = (a: AccountRow) =>
        Effect.map(status(a), (s): ProviderAccount => ({
          id: a.id, label: a.label, kind: a.kind, provider: a.provider, isDefault: a.id === defaultId(a.provider as AccountProvider),
          loggedIn: s.loggedIn, identity: s.identity ?? a.identity, loggingIn: logins.has(a.id), createdAt: a.createdAt
        }))
      // Only folders Zero created can be deleted.
      const owned = (home: string | null) => !!home && resolve(home).startsWith(root + sep)

      const service: AccountsService = {
        list: Effect.flatMap(store.accounts(), (rows) => Effect.forEach(rows, toPublic, { concurrency: "unbounded" })),
        create: (provider, label) =>
          Effect.gen(function* () {
            const id = crypto.randomUUID()
            mkdirSync(join(root, id), { recursive: true })
            yield* store.ensureAccount({ id, label, kind: "subscription", provider, home: join(root, id), secret: null, baseUrl: null, identity: null })
            return yield* toPublic((yield* store.account(id))!)
          }),
        rename: (id, label) => Effect.flatMap(store.updateAccount(id, { label }), (a) => (a ? toPublic(a) : Effect.succeed(undefined))),
        remove: (id) =>
          Effect.gen(function* () {
            const a = yield* store.account(id)
            if (!a) return "not-found" as const
            if (a.id === defaultId(a.provider as AccountProvider)) return "default" as const
            // Log out first so the CLI drops its stored credentials (e.g. the macOS keychain entry).
            yield* Effect.promise(() => run(a, COMMANDS[a.provider as AccountProvider].logout))
            if (owned(a.home) && existsSync(a.home!)) rmSync(a.home!, { recursive: true, force: true })
            cache.delete(id)
            yield* store.removeAccount(id)
            return "ok" as const
          }),
        login: (id) =>
          Effect.gen(function* () {
            const a = yield* store.account(id)
            if (!a) return "not-found" as const
            if (logins.has(id)) return "busy" as const
            const bin = Bun.which(COMMANDS[a.provider as AccountProvider].bin)
            if (!bin) return { url: null }
            if (a.home) mkdirSync(a.home, { recursive: true })
            // The CLI opens the provider's page in the browser itself; the URL is a fallback for the UI.
            const proc = Bun.spawn([bin, ...COMMANDS[a.provider as AccountProvider].login], { env: envFor(a), stdin: "ignore", stdout: "pipe", stderr: "pipe" })
            logins.add(id)
            let resolveUrl: (u: string | null) => void = () => {}
            const url = new Promise<string | null>((r) => {
              resolveUrl = r
            })
            const scan = async (s: ReadableStream) => {
              const decoder = new TextDecoder()
              for await (const chunk of s) {
                const m = /https?:\/\/\S+/.exec(decoder.decode(chunk as Uint8Array, { stream: true }))
                if (m) resolveUrl(m[0])
              }
            }
            void scan(proc.stdout)
            void scan(proc.stderr)
            void proc.exited.then(async () => {
              logins.delete(id)
              cache.delete(id)
              resolveUrl(null)
              const s = await readStatus(a)
              cache.set(id, { at: Date.now(), status: s })
              if (s.identity) await Effect.runPromise(store.updateAccount(id, { identity: s.identity }))
            })
            return { url: yield* Effect.promise(() => Promise.race([url, Bun.sleep(URL_WAIT_MS).then(() => null)])) }
          }),
        resolve: (model, accountId) =>
          Effect.gen(function* () {
            const provider = ACCOUNT_OF_MODEL[splitModel(model).provider]
            if (!provider) return undefined
            const chosen = accountId ? yield* store.account(accountId) : undefined
            return chosen?.provider === provider ? chosen : yield* store.account(defaultId(provider))
          })
      }
      return service
    })
  )
}
