// Provider accounts (ARCHITECTURE §6.1): several logins per provider, each in its own CLI folder.
// Zorel runs the official login/status/logout commands with that folder and only keeps what the CLI
// reports for display (e-mail, plan). It never stores the token; for an extra Antigravity account it reads
// only the e-mail field of the login file agy wrote (agy has no status command).
import type { AccountProvider, AccountUsage, AccountWindow, ProviderAccount } from "@zorel/contracts"
import { Context, Effect, Layer, Semaphore } from "effect"
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { join, resolve, sep } from "node:path"
import { DataDir } from "./chat.ts"
import { type AccountRow, Store } from "./db.ts"
import { ANTIGRAVITY_FILE_LOGIN, antigravityDir, antigravityGeminiDir, antigravityLoginFile, type CliModel, parseAntigravityModels, readAntigravityLimits, readAntigravityModels, splitModel } from "./engines.ts"
import { readClaudeLimits, readClaudeModels } from "./engines/claude-sdk.ts"
import { readCodexLimits, readCodexModels } from "./engines/codex.ts"
import { which } from "./cli/index.ts"

const STATUS_TTL_MS = 30_000
// Limit readings (ARCHITECTURE §10.2): cached 4 min; a failure waits 5, 10, 20, 40 min, then 1 h.
const LIMITS_TTL_MS = 4 * 60_000
const LIMITS_BACKOFF_MS = 5 * 60_000
const LIMITS_BACKOFF_MAX_MS = 60 * 60_000

// The stored reading; older rows kept a single { usedPercent, resetsAt } and read as nothing.
const usageOf = (a: AccountRow): AccountUsage | null => (a.usage && Array.isArray((a.usage as AccountUsage).windows) ? (a.usage as AccountUsage) : null)
const URL_WAIT_MS = 8_000
const SERVER = process.env.ZOREL_SERVER === "1"
const SCREEN_MAX = 4000
const SCREEN_SETTLE_MS = 600
// A terminal's text without its colors and cursor moves, for the web to show as is.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching terminal escapes is the point
const plain = (s: string) => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*(\x07|\x1b\\)|\r/g, "").trim()

// Which account provider serves a model provider.
const ACCOUNT_OF_MODEL: Record<string, AccountProvider> = { "claude-cli": "claude", "codex-cli": "codex", antigravity: "antigravity" }
const defaultId = (p: AccountProvider) => `${p}-default`

interface Status {
  readonly loggedIn: boolean
  readonly identity: string | null
}
const SIGNED_OUT: Status = { loggedIn: false, identity: null }

const processEnv = () => {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  return env
}

// What each provider's CLI needs: the account's environment, and its status, login and logout commands.
interface Cli {
  readonly bin: string
  readonly env: (a: AccountRow) => Record<string, string>
  readonly status: (a: AccountRow) => Promise<Status>
  readonly login: (a: AccountRow) => string[]
  readonly logout: string[] | null // null: deleting the account's folder signs it out
  readonly pastesCode?: true // the sign-in always waits for a code pasted back (on a desktop too)
  readonly limits?: (a: AccountRow) => Promise<ReadonlyArray<AccountWindow>> // absent: the CLI reports no limits
}

async function run(a: AccountRow, args: string[]) {
  const cli = CLIS[a.provider as AccountProvider]
  const bin = which(cli.bin)
  if (!bin) return { code: -1, out: "" }
  if (a.home) mkdirSync(a.home, { recursive: true })
  const proc = Bun.spawn([bin, ...args], { env: cli.env(a), stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 30_000, killSignal: "SIGKILL", windowsHide: true })
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  return { code, out: `${out}\n${err}` }
}

// An extra Antigravity account is signed in when its .gemini holds agy's login file; who it is, that file's e-mail.
export function antigravityFileStatus(geminiDir: string): Status {
  const file = antigravityLoginFile(geminiDir)
  if (!existsSync(file)) return SIGNED_OUT
  try {
    const email = (JSON.parse(readFileSync(file, "utf8")) as { id_token_email?: unknown }).id_token_email
    return { loggedIn: true, identity: typeof email === "string" && email ? email : null }
  } catch (e) {
    console.warn(`[accounts] unreadable Antigravity login file in ${geminiDir}:`, e instanceof Error ? e.message : e)
    return SIGNED_OUT
  }
}

const CLIS: Record<AccountProvider, Cli> = {
  claude: {
    bin: "claude",
    env: (a) => ({ ...processEnv(), ...(a.home && { CLAUDE_CONFIG_DIR: a.home }) }),
    status: async (a) => {
      const { out } = await run(a, ["auth", "status", "--json"])
      try {
        const s = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1))
        return { loggedIn: !!s.loggedIn, identity: [s.email, s.subscriptionType].filter(Boolean).join(" · ") || null }
      } catch {
        return SIGNED_OUT
      }
    },
    login: () => ["auth", "login", "--claudeai"],
    logout: ["auth", "logout"],
    limits: (a) => readClaudeLimits(a.home ?? undefined)
  },
  codex: {
    bin: "codex",
    env: (a) => ({ ...processEnv(), ...(a.home && { CODEX_HOME: a.home }) }),
    status: async (a) => {
      const { code, out } = await run(a, ["login", "status"])
      const loggedIn = code === 0 && /logged in/i.test(out) && !/not logged in/i.test(out)
      return { loggedIn, identity: loggedIn ? (/using (\w+)/i.exec(out)?.[1] ?? null) : null }
    },
    login: () => ["login", ...(SERVER ? ["--device-auth"] : [])],
    logout: ["logout"],
    limits: (a) => readCodexLimits(a.home!)
  },
  // agy signs in with a link and a code pasted back. The default account is its keychain login (who it is isn't
  // printed); an extra one keeps its login in its folder (ANTIGRAVITY_FILE_LOGIN).
  antigravity: {
    bin: "agy",
    env: (a) => ({ ...processEnv(), ...(a.home && ANTIGRAVITY_FILE_LOGIN) }),
    status: async (a) => (a.home ? antigravityFileStatus(antigravityGeminiDir(a.home)) : { loggedIn: parseAntigravityModels((await run(a, ["models"])).out).length > 0, identity: null }),
    login: (a) => ["acp", "--disable-telemetry", "--gemini-dir", antigravityDir(a.home ? antigravityGeminiDir(a.home) : undefined), "--login"],
    logout: null,
    pastesCode: true,
    limits: (a) => readAntigravityLimits(a.home)
  }
}

interface AccountsService {
  readonly list: Effect.Effect<ProviderAccount[]>
  readonly create: (provider: AccountProvider, label: string) => Effect.Effect<ProviderAccount>
  readonly rename: (id: string, label: string) => Effect.Effect<ProviderAccount | undefined>
  readonly remove: (id: string) => Effect.Effect<"ok" | "not-found" | "default">
  readonly login: (id: string) => Effect.Effect<{ url: string | null; output?: string } | "not-found" | "busy">
  // On a server (spec 014): what the person pasted back from the provider's page, typed into the waiting CLI.
  readonly answer: (id: string, code: string) => Effect.Effect<boolean>
  // The account a turn runs on: the chosen one if it serves this model, otherwise the provider's default.
  readonly resolve: (model: string, accountId: string | null) => Effect.Effect<AccountRow | undefined>
  // Failover (§6.1): a subscription that hit its limit waits until `until`; the last limit reading is kept.
  readonly hold: (id: string, until: number) => Effect.Effect<void>
  // A reading from a running session: its windows replace the ones with the same id.
  readonly observe: (id: string, windows: ReadonlyArray<AccountWindow>) => Effect.Effect<void>
  // Reads all windows now from the CLI (§10.2): one reading at a time, cached 4 min (`fresh`: read anyway), failures back off.
  readonly refreshLimits: (id: string, fresh?: boolean) => Effect.Effect<ProviderAccount | undefined>
  // The models the default logins offer, with their real names ("opus" → "Opus 5.5"). Kept in preferences,
  // served at once and re-read in the background after an hour; a failed read keeps the last list.
  readonly cliModels: Effect.Effect<CliModels>
  readonly forgetCliModels: Effect.Effect<void> // a CLI was just installed: read its models again
}

type CliModels = Partial<Record<"claude-cli" | "codex-cli" | "antigravity", ReadonlyArray<CliModel>>>
const CLI_MODELS_KEY = "cliModels"
const CLI_MODELS_TTL_MS = 60 * 60_000
const CLI_MODELS_RETRY_MS = 5 * 60_000

export class Accounts extends Context.Service<Accounts, AccountsService>()("Accounts") {
  static layer = Layer.effect(
    Accounts,
    Effect.gen(function* () {
      const store = yield* Store
      const dataDir = yield* DataDir
      const root = resolve(dataDir, "accounts")
      // Default accounts: Claude and Antigravity use the CLI's own login; Codex always gets a Zorel-owned folder (the
      // app-server would load the user's config.toml otherwise; see engines/codex.ts).
      yield* store.ensureAccount({ id: defaultId("claude"), label: "Claude", kind: "subscription", provider: "claude", home: null, secret: null, baseUrl: null, identity: null })
      yield* store.ensureAccount({ id: defaultId("antigravity"), label: "Antigravity", kind: "subscription", provider: "antigravity", home: null, secret: null, baseUrl: null, identity: null })
      yield* store.ensureAccount({ id: defaultId("codex"), label: "Codex", kind: "subscription", provider: "codex", home: join(root, defaultId("codex")), secret: null, baseUrl: null, identity: null })

      const cache = new Map<string, { at: number; status: Status }>()
      const readingLock = yield* Semaphore.make(1) // one limit reading at a time, across accounts
      const failures = new Map<string, { count: number; next: number }>()
      const logins = new Set<string>()
      const terminals = new Map<string, ReturnType<typeof Bun.spawn>>() // server sign-ins waiting for a pasted code
      const screens = new Map<string, string>() // what each of those CLIs printed (the tail)
      const links = new Map<string, string>() // the sign-in link each of them printed
      const status = (a: AccountRow) =>
        Effect.promise(async () => {
          const hit = cache.get(a.id)
          if (hit && Date.now() - hit.at < STATUS_TTL_MS) return hit.status
          const s = await CLIS[a.provider as AccountProvider].status(a)
          cache.set(a.id, { at: Date.now(), status: s })
          return s
        })
      const toPublic = (a: AccountRow) =>
        Effect.map(status(a), (s): ProviderAccount => ({
          id: a.id, label: a.label, kind: a.kind, provider: a.provider, isDefault: a.id === defaultId(a.provider as AccountProvider),
          installed: !!which(CLIS[a.provider as AccountProvider].bin), loggedIn: s.loggedIn, identity: s.identity ?? a.identity, loggingIn: logins.has(a.id),
          limitedUntil: a.limitedUntil && a.limitedUntil > Date.now() ? a.limitedUntil : null, usage: usageOf(a), createdAt: a.createdAt
        }))
      // Only folders Zorel created can be deleted.
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
            const logout = CLIS[a.provider as AccountProvider].logout
            if (logout) yield* Effect.promise(() => run(a, logout))
            if (owned(a.home) && existsSync(a.home!)) rmSync(a.home!, { recursive: true, force: true })
            cache.delete(id)
            yield* store.removeAccount(id)
            return "ok" as const
          }),
        login: (id) =>
          Effect.gen(function* () {
            const a = yield* store.account(id)
            if (!a) return "not-found" as const
            // A sign-in already waiting for its pasted code shows again (the screen that asked for it was left).
            if (logins.has(id)) return terminals.has(id) ? { url: links.get(id) ?? null, output: plain(screens.get(id) ?? "") } : ("busy" as const)
            const cli = CLIS[a.provider as AccountProvider]
            const bin = which(cli.bin)
            if (!bin) return { url: null }
            if (a.home) mkdirSync(a.home, { recursive: true })
            let resolveUrl: (u: string | null) => void = () => {}
            const url = new Promise<string | null>((r) => {
              resolveUrl = r
            })
            const seen = (text: string) => {
              const m = /https?:\/\/\S+/.exec(text)
              if (m) {
                if (!links.has(id)) links.set(id, m[0])
                resolveUrl(m[0])
              }
            }
            const decoder = new TextDecoder()
            const args = [bin, ...cli.login(a)]
            // On a server there's no browser to open: the CLI runs in a terminal of its own, shows the link (and a
            // device code), and reads the code the person pastes back (answer). On a desktop it opens the browser
            // itself, unless its sign-in always takes a pasted code (agy): then it runs in a terminal there too.
            const pasted = SERVER || !!cli.pastesCode
            const proc = pasted
              ? Bun.spawn(args, { env: { ...cli.env(a), TERM: "dumb", BROWSER: "none" }, terminal: { cols: 200, rows: 50, data: (_t, data) => {
                  const text = decoder.decode(new Uint8Array(data), { stream: true })
                  screens.set(id, ((screens.get(id) ?? "") + text).slice(-SCREEN_MAX))
                  seen(text)
                } } })
              : Bun.spawn(args, { env: cli.env(a), stdin: "ignore", stdout: "pipe", stderr: "pipe" })
            logins.add(id)
            if (pasted) terminals.set(id, proc)
            const scan = async (s: ReadableStream) => {
              for await (const chunk of s) seen(decoder.decode(chunk as Uint8Array, { stream: true }))
            }
            if (!pasted) {
              void scan(proc.stdout as ReadableStream)
              void scan(proc.stderr as ReadableStream)
            }
            void proc.exited.then(async () => {
              logins.delete(id)
              terminals.delete(id)
              screens.delete(id)
              links.delete(id)
              cache.delete(id)
              resolveUrl(null)
              const s = await cli.status(a)
              cache.set(id, { at: Date.now(), status: s })
              if (s.identity) await Effect.runPromise(store.updateAccount(id, { identity: s.identity }))
            })
            const link = yield* Effect.promise(() => Promise.race([url, Bun.sleep(URL_WAIT_MS).then(() => null)]))
            if (pasted) yield* Effect.promise(() => Bun.sleep(SCREEN_SETTLE_MS)) // the device code comes just after the link
            return pasted ? { url: link, output: plain(screens.get(id) ?? "") } : { url: link }
          }),
        answer: (id, code) =>
          Effect.sync(() => {
            const t = terminals.get(id)?.terminal
            if (!t) return false
            t.write(`${code.trim()}\r`)
            return true
          }),
        resolve: (model, accountId) =>
          Effect.gen(function* () {
            const provider = ACCOUNT_OF_MODEL[splitModel(model).provider]
            if (!provider) return undefined
            const chosen = accountId ? yield* store.account(accountId) : undefined
            return chosen?.provider === provider ? chosen : yield* store.account(defaultId(provider))
          }),
        hold: (id, until) => Effect.asVoid(store.updateAccount(id, { limitedUntil: until })),
        observe: (id, windows) =>
          Effect.gen(function* () {
            const a = yield* store.account(id)
            if (!a) return
            const kept = (usageOf(a)?.windows ?? []).filter((w) => !windows.some((n) => n.id === w.id))
            yield* store.updateAccount(id, { usage: { windows: [...kept, ...windows], readAt: Date.now() } })
          }),
        refreshLimits: (id, force = false) =>
          Effect.gen(function* () {
            const a = yield* store.account(id)
            if (!a) return undefined
            const cached = usageOf(a)
            const backoff = failures.get(id)
            const fresh = !force && cached && Date.now() - cached.readAt < LIMITS_TTL_MS
            const limits = CLIS[a.provider as AccountProvider].limits
            if (limits && !fresh && (!backoff || Date.now() >= backoff.next)) {
              const windows = yield* readingLock.withPermits(1)(Effect.tryPromise(() => limits(a)).pipe(Effect.option))
              if (windows._tag === "Some") {
                failures.delete(id)
                yield* store.updateAccount(id, { usage: { windows: windows.value, readAt: Date.now() } })
              } else {
                const n = (backoff?.count ?? 0) + 1
                failures.set(id, { count: n, next: Date.now() + Math.min(LIMITS_BACKOFF_MAX_MS, LIMITS_BACKOFF_MS * 2 ** (n - 1)) })
              }
            }
            return yield* toPublic((yield* store.account(id))!)
          }),
        cliModels: Effect.gen(function* () {
          const raw = yield* store.preference(CLI_MODELS_KEY)
          let saved: { at: number; models: CliModels } | undefined
          try {
            saved = raw ? JSON.parse(raw) : undefined
          } catch {
            saved = undefined // re-read below
          }
          if (saved && Date.now() - saved.at < CLI_MODELS_TTL_MS) return saved.models
          const previous = saved?.models ?? {}
          const read = Effect.promise(async () => {
            const [claude, codex, antigravity] = await Promise.allSettled([readClaudeModels(undefined), readCodexModels(join(root, defaultId("codex"))), readAntigravityModels()])
            const models: CliModels = { ...previous }
            if (claude.status === "fulfilled" && claude.value.length) models["claude-cli"] = claude.value
            if (codex.status === "fulfilled" && codex.value.length) models["codex-cli"] = codex.value
            if (antigravity.status === "fulfilled" && antigravity.value.length) models.antigravity = antigravity.value
            const failed = claude.status === "rejected" || codex.status === "rejected" || antigravity.status === "rejected"
            return { models, at: failed ? Date.now() - CLI_MODELS_TTL_MS + CLI_MODELS_RETRY_MS : Date.now() }
          }).pipe(Effect.tap((s) => store.setPreference(CLI_MODELS_KEY, JSON.stringify(s))))
          if (saved) {
            yield* Effect.forkDetach(read)
            return previous
          }
          return (yield* read).models
        }),
        forgetCliModels: store.setPreference(CLI_MODELS_KEY, "")
      }
      return service
    })
  )
}
