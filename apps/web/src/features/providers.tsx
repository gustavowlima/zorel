// Settings › Providers: every way Zorel reaches a model, one place. The list splits Connected from Other providers
// (row lists on the canvas, like every Settings tab; "Checking…" while the first reading loads, an error with a
// retry when it fails). A provider's page gathers its subscription sign-ins (the official CLI, several accounts,
// each with its limit windows), its API key (system keychain, with where to get one), or whether its local server
// is running, and the models it offers. Zorel never reads or stores a CLI's login: it only shows who is connected.
import type { AccountProvider, KeyInfo as KeyInfoSchema, ModelInfo, ProviderAccount } from "@zorel/contracts"
import { formatTime, t } from "@zorel/i18n"
import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import { type ReactNode, useEffect, useState } from "react"
import { accountsAtom, agentsAtom, keysAtom, modelsAtom, mutations, useInvalidate, useList, useMutation } from "../client.ts"
import { LimitWindows } from "./limits.tsx"
import { modelName, modelNote, providerLabel, splitModel } from "../labels.ts"
import { go } from "../state.ts"
import { Badge, Button, ChevronRight, ConfirmButton, cn, Dot, Fold, Input, ListRow, Plus, ProviderIcon, Rows, Section, SettingRow } from "@/ui"

type KeyInfo = typeof KeyInfoSchema.Type

type Provider = {
  readonly id: "claude" | "chatgpt" | "openrouter" | "ollama" | "lmstudio" | "gemini" | "opencode" | "antigravity"
  readonly icon: string
  readonly account?: AccountProvider // signs in with an official CLI
  readonly key?: string // takes an API key
  readonly harnesses: ReadonlyArray<string> // model id prefixes it serves
  readonly keyUrl?: string // where to get an API key
  readonly cli?: true // an agent CLI (ACP): installed on this computer, signed in with its own command
}

const PROVIDERS: ReadonlyArray<Provider> = [
  { id: "claude", icon: "claude", account: "claude", key: "ANTHROPIC_API_KEY", harnesses: ["claude-cli", "anthropic"], keyUrl: "https://console.anthropic.com/settings/keys" },
  { id: "chatgpt", icon: "codex", account: "codex", key: "OPENAI_API_KEY", harnesses: ["codex-cli", "openai"], keyUrl: "https://platform.openai.com/api-keys" },
  { id: "openrouter", icon: "openrouter", key: "OPENROUTER_API_KEY", harnesses: ["openrouter"], keyUrl: "https://openrouter.ai/keys" },
  { id: "ollama", icon: "ollama", harnesses: ["ollama"] },
  { id: "lmstudio", icon: "lmstudio", harnesses: ["lmstudio"] },
  { id: "gemini", icon: "gemini-cli", harnesses: ["gemini-cli"], cli: true },
  { id: "opencode", icon: "opencode", harnesses: ["opencode"], cli: true },
  { id: "antigravity", icon: "antigravity", harnesses: ["antigravity"], cli: true }
]

// The provider page that sets up a model's harness ("claude-cli" → claude).
export const providerPageOf = (harness: string) => PROVIDERS.find((p) => p.harnesses.includes(harness))?.id

type State = { accounts: ReadonlyArray<ProviderAccount>; key: KeyInfo | undefined; models: ReadonlyArray<ModelInfo>; running: boolean }

// The three readings a provider's state comes from, and whether they are still loading or failed: an empty list
// must not read as "not connected" before the first answer.
function useReadings() {
  const results: ReadonlyArray<AsyncResult.AsyncResult<unknown, unknown>> = [useAtomValue(accountsAtom), useAtomValue(keysAtom), useAtomValue(modelsAtom)]
  return { loading: results.some((r) => AsyncResult.isInitial(r)), failed: results.some((r) => AsyncResult.isFailure(r)) }
}

function useStates() {
  const accounts = useList(accountsAtom)
  const keys = useList(keysAtom)
  const models = useList(modelsAtom)
  return (p: Provider): State => {
    const mine = models.filter((m) => p.harnesses.includes(m.provider) && !m.id.endsWith("/…"))
    return {
      accounts: p.account ? accounts.filter((a) => a.provider === p.account) : [],
      key: p.key ? keys.find((k) => k.name === p.key) : undefined,
      models: mine,
      running: !p.account && !p.key && mine.some((m) => m.available)
    }
  }
}

const connected = (s: State) => s.accounts.some((a) => a.loggedIn) || !!s.key?.set || s.running

// One line under the name: who is signed in, that a key is saved, or what is missing.
function summary(p: Provider, s: State): { text: string; warning?: boolean } {
  const limited = s.accounts.find((a) => a.limitedUntil)
  if (limited?.limitedUntil) return { text: `${limited.identity ?? limited.label} · ${t("failover.limitedUntil", { time: formatTime(limited.limitedUntil) })}`, warning: true }
  return { text: summaryText(p, s) }
}
function summaryText(p: Provider, s: State) {
  const signedIn = s.accounts.filter((a) => a.loggedIn)
  if (signedIn.length) {
    // An identity that only repeats the provider's name ("ChatGPT") says nothing: "Signed in" instead.
    const id = signedIn[0]!.identity
    const first = id && id !== t(`providers.names.${p.id}`) ? id : t("accounts.signedIn")
    return signedIn.length > 1 ? t("providers.andMore", { name: first, count: signedIn.length - 1 }) : first
  }
  if (s.key?.set) return t("providers.keySaved")
  if (s.running) return p.cli ? t("providers.installed") : t("providers.running")
  if (p.cli) return t("providers.notInstalled")
  return p.account ? t("accounts.signedOut") : p.key ? t("providers.noKey") : t("providers.notRunning")
}

export function ProvidersSection({ provider }: { provider: string | undefined }) {
  const page = PROVIDERS.find((p) => p.id === provider)
  // An unknown provider in the address goes back to the list instead of keeping a wrong URL.
  useEffect(() => {
    if (provider && !page) go({ view: "settings", tab: "providers" })
  }, [provider, page])
  return page ? <ProviderPage provider={page} /> : <ProviderList />
}

function ProviderList() {
  const stateOf = useStates()
  const { loading, failed } = useReadings()
  const invalidate = useInvalidate()
  const open = (p: Provider) => go({ view: "settings", tab: "providers", provider: p.id })
  // One row per provider: who is connected (with a green dot), or what is missing and the next step right there
  // (sign in, add a key); a local server that isn't running is started outside Zorel, so it only says so.
  const row = (p: Provider, hint: { text: string; warning?: boolean }, state?: State) => {
    const on = !!state && connected(state)
    const action = state && !on ? (p.account ? t("providers.signInAction") : p.key ? t("providers.addKey") : undefined) : undefined
    return (
      <ListRow
        key={p.id}
        label={`${t(`providers.names.${p.id}`)}: ${hint.text}`}
        icon={<ProviderIcon provider={p.icon} size={20} />}
        title={t(`providers.names.${p.id}`)}
        hint={
          on && !hint.warning ? (
            <span className="inline-flex items-center gap-1.5">
              <Dot tone="success" />
              {hint.text}
            </span>
          ) : (
            hint.text
          )
        }
        {...(hint.warning && { hintTone: "warning" as const })}
        trailing={
          action && (
            // Outlined: readable over the row's hover wash as well as at rest.
            <Button size="sm" variant="ghost" className="border border-strong text-fg" onPress={() => open(p)}>
              {action}
            </Button>
          )
        }
        onPress={() => open(p)}
      />
    )
  }
  if (failed)
    return (
      <Group title={t("settings.providers")}>
        <Row title={t("providers.loadFailed")} hint={t("providers.loadFailedHint")} tone="warning">
          <Button size="sm" variant="secondary" onPress={() => invalidate(["accounts", "keys", "models"])}>
            {t("common.retry")}
          </Button>
        </Row>
      </Group>
    )
  if (loading) return <Group title={t("settings.providers")}>{PROVIDERS.map((p) => row(p, { text: t("providers.checking") }))}</Group>
  const on = PROVIDERS.filter((p) => connected(stateOf(p)))
  const off = PROVIDERS.filter((p) => !connected(stateOf(p)))
  return (
    <>
      {on.length > 0 && <Group title={t("providers.connected")}>{on.map((p) => row(p, summary(p, stateOf(p)), stateOf(p)))}</Group>}
      {off.length > 0 && <Group title={t("providers.others")}>{off.map((p) => row(p, summary(p, stateOf(p)), stateOf(p)))}</Group>}
    </>
  )
}

type CliId = "gemini" | "opencode" | "antigravity"
// Antigravity and OpenCode ship one program per system: Zorel installs it from the official source, checked.
// Gemini CLI is an npm package (it needs Node.js): its page gives the command instead.
const INSTALLABLE: ReadonlySet<CliId> = new Set(["antigravity", "opencode"])

function CliInstall({ id, name, installed }: { id: CliId; name: string; installed: boolean }) {
  const install = useMutation(mutations.installCli)
  const invalidate = useInvalidate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const doInstall = () => {
    if (id === "gemini") return
    setBusy(true)
    setError(undefined)
    install({ params: { id }, reactivityKeys: ["models"] })
      .catch((e: unknown) => setError((e as { message?: string })?.message || t("providers.installFailed", { name })))
      .finally(() => setBusy(false))
  }
  return (
    <Group title={t("providers.cli")}>
      <Row title={installed ? t("providers.installed") : t("providers.notInstalled")} hint={installed ? t(`providers.cliHints.${id}`) : t(`providers.cliInstallHints.${id}`)}>
        {!installed && INSTALLABLE.has(id) ? (
          <Button size="sm" variant="default" isPending={busy} onPress={doInstall}>
            {t("providers.install")}
          </Button>
        ) : (
          <Button size="sm" variant="secondary" onPress={() => invalidate(["models"])}>
            {t("providers.checkAgain")}
          </Button>
        )}
      </Row>
      {error && <p className="text-sm text-danger">{error}</p>}
    </Group>
  )
}

function ProviderPage({ provider: p }: { provider: Provider }) {
  const s = useStates()(p)
  const agents = useList(agentsAtom).filter((a) => p.harnesses.includes(splitModel(a.model).provider))
  const isConnected = connected(s)
  const { loading } = useReadings()
  const invalidate = useInvalidate()
  const name = t(`providers.names.${p.id}`)
  useEffect(() => {
    const before = document.title
    document.title = `${name} · ${t("app.name")}`
    return () => {
      document.title = before
    }
  }, [name])
  return (
    <>
      <div className="-mb-4">
        <Button size="sm" variant="ghost" className="-ml-2.5 text-muted" onPress={() => go({ view: "settings", tab: "providers" })}>
          <ChevronRight className="size-3.5 rotate-180" />
          {t("settings.providers")}
        </Button>
      </div>

      <div className="flex items-center gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-card bg-surface">
          <ProviderIcon provider={p.icon} size={26} />
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-2.5">
            <h2 className="text-lg font-semibold">{name}</h2>
            {!loading && <Badge tone={isConnected ? "success" : "neutral"}>{isConnected ? t("providers.isConnected") : t("providers.notConnected")}</Badge>}
          </span>
          <span className="text-sm text-muted">{agents.length ? t("providers.agentsUse", { count: agents.length }) : t("providers.noAgentsUse")}</span>
        </span>
      </div>

      {p.account && <SignIns provider={p.account} accounts={s.accounts} />}
      {s.key && <ApiKey info={s.key} name={name} url={p.keyUrl} alternative={!!p.account} />}
      {p.cli && <CliInstall id={p.id as CliId} name={name} installed={s.running} />}
      {!p.account && !p.key && !p.cli && (
        <Group title={t("providers.server")}>
          <Row title={s.running ? t("providers.running") : t("providers.notRunning")} hint={t(`model.hints.${p.id === "ollama" ? "ollama" : "lmstudio"}`)}>
            <Button size="sm" variant="secondary" onPress={() => invalidate(["models"])}>
              {t("providers.checkAgain")}
            </Button>
          </Row>
        </Group>
      )}
      <Models models={s.models} keySet={!!s.key?.set} />
    </>
  )
}

// A provider page's section: the shared group (Section over Rows).
const Group = ({ title, hint, action, children }: { title: string; hint?: string; action?: ReactNode; children: ReactNode }) => (
  <Section title={title} description={hint} action={action}>
    <Rows>{children}</Rows>
  </Section>
)

const Row = ({ title, hint, tone, children }: { title: ReactNode; hint?: ReactNode; tone?: "warning"; children?: ReactNode }) => (
  <SettingRow title={<span className="block truncate">{title}</span>} hint={tone === "warning" && hint ? <span className="text-warning">{hint}</span> : hint}>
    {children}
  </SettingRow>
)

// Subscription sign-ins through the official CLI; each extra account gets its own folder.
function SignIns({ provider, accounts }: { provider: AccountProvider; accounts: ReadonlyArray<ProviderAccount> }) {
  const invalidate = useInvalidate()
  const create = useMutation(mutations.createAccount)
  const login = useMutation(mutations.login)
  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState("")
  const [error, setError] = useState<string>()

  // A sign-in finishes in the browser; poll until the CLI reports it.
  const pending = accounts.some((a) => a.loggingIn)
  useEffect(() => {
    if (!pending) return
    const id = setInterval(() => invalidate(["accounts", "models"]), 2000)
    return () => clearInterval(id)
  }, [pending, invalidate])

  return (
    <Group
      title={t("providers.signIn")}
      hint={t("accounts.intro")}
      action={
        !adding && (
          <Button size="sm" variant="ghost" onPress={() => setAdding(true)}>
            <Plus />
            {t("accounts.add")}
          </Button>
        )
      }
    >
      {accounts.map((a) => (
        <AccountRow key={a.id} account={a} />
      ))}
      <Fold open={adding}>
        <form
          className="flex flex-wrap items-center gap-3 py-3.5"
          onSubmit={(e) => {
            e.preventDefault()
            setError(undefined)
            void create({ payload: { provider, label: label.trim() }, reactivityKeys: ["accounts"] })
              .then((a) => {
                setLabel("")
                setAdding(false)
                // The CLI opens the provider's sign-in page in the browser.
                return login({ params: { id: a.id }, reactivityKeys: ["accounts"] })
              })
              .catch(() => setError(t("accounts.addFailed")))
          }}
        >
          <Input
            className="min-w-48 flex-1"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t("accounts.namePlaceholder")}
            aria-label={t("accounts.name")}
            maxLength={80}
            autoFocus
          />
          <Button type="submit" variant="default" isDisabled={!label.trim()}>
            {t("accounts.addAndSignIn")}
          </Button>
          <Button variant="ghost" onPress={() => setAdding(false)}>
            {t("common.cancel")}
          </Button>
        </form>
      </Fold>
      {error && <p className="py-3 text-sm text-danger">{error}</p>}
    </Group>
  )
}

function AccountRow({ account: a }: { account: ProviderAccount }) {
  const login = useMutation(mutations.login)
  const remove = useMutation(mutations.removeAccount)
  const [link, setLink] = useState<string>()
  const [error, setError] = useState<string>()
  const signIn = () => {
    setError(undefined)
    login({ params: { id: a.id }, reactivityKeys: ["accounts"] }).then(
      (r) => r.url && setLink(r.url),
      () => setError(t("accounts.busy"))
    )
  }
  const status = a.loggingIn ? t("accounts.signingIn") : a.loggedIn ? (a.identity ?? t("accounts.signedIn")) : t("accounts.signedOut")
  return (
    <div className="flex flex-col gap-1.5 py-3.5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-2">
            <span className="truncate font-medium">{a.loggedIn ? (a.identity ?? t("accounts.signedIn")) : a.label}</span>
            {a.isDefault && <Badge>{t("accounts.default")}</Badge>}
          </span>
          <span className={cn("truncate text-sm", a.loggedIn ? "text-muted" : "text-warning")}>{a.loggedIn ? a.label : status}</span>
        </span>
        <Button size="sm" variant={a.loggedIn ? "secondary" : "default"} isPending={a.loggingIn} isDisabled={a.loggingIn} onPress={signIn}>
          {a.loggedIn ? t("providers.reconnect") : t("accounts.signIn")}
        </Button>
        {!a.isDefault && (
          <ConfirmButton
            size="sm"
            variant="ghost"
            title={t("accounts.removeTitle", { name: a.label })}
            description={t("accounts.removeBody")}
            confirmLabel={t("common.remove")}
            onConfirm={() => void remove({ params: { id: a.id }, reactivityKeys: ["accounts", "agents", "chats"] }).catch(() => setError(t("accounts.removeFailed")))}
          >
            {t("common.remove")}
          </ConfirmButton>
        )}
      </div>
      {a.loggedIn && (
        <div className="pt-1.5">
          <LimitWindows account={a} compact />
        </div>
      )}
      {link && a.loggingIn && (
        <a className="text-sm text-accent-text underline" href={link} target="_blank" rel="noreferrer">
          {t("accounts.openLogin")}
        </a>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  )
}

// The provider's API key, kept in the system keychain (or set in the server's environment).
function ApiKey({ info, name, url, alternative }: { info: KeyInfo; name: string; url: string | undefined; alternative: boolean }) {
  const setKey = useMutation(mutations.setKey)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [error, setError] = useState<string>()
  const save = (value: string) => {
    setError(undefined)
    void setKey({ params: { name: info.name }, payload: { value }, reactivityKeys: ["keys", "models"] }).then(
      () => {
        setDraft("")
        setEditing(false)
      },
      () => setError(t("keys.saveFailed"))
    )
  }
  return (
    <Group title={t("providers.apiKey")}>
      {info.fromEnv ? (
        <Row title={t("keys.fromEnv")} hint={<code className="font-mono text-sm">{info.name}</code>} />
      ) : editing ? (
        <form
          className="flex flex-wrap items-center gap-3 py-3.5"
          onSubmit={(e) => {
            e.preventDefault()
            if (draft.trim()) save(draft.trim())
          }}
        >
          <Input
            type="password"
            autoComplete="off"
            className="min-w-48 flex-1"
            placeholder={t("keys.paste")}
            aria-label={info.name}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
          />
          <Button type="submit" variant="default" isDisabled={!draft.trim()}>
            {t("common.save")}
          </Button>
          <Button variant="ghost" onPress={() => setEditing(false)}>
            {t("common.cancel")}
          </Button>
        </form>
      ) : (
        <Row
          title={info.set ? t("providers.keySaved") : t("providers.noKey")}
          hint={
            info.set ? (
              t("keys.intro")
            ) : (
              <>
                {alternative ? t("providers.keyInstead", { name }) : t("providers.pasteKey", { name })}
                {url && (
                  <>
                    {" "}
                    <a className="text-accent-text underline" href={url} target="_blank" rel="noreferrer">
                      {t("providers.getKey")}
                    </a>
                  </>
                )}
              </>
            )
          }
        >
          <Button size="sm" variant={info.set ? "secondary" : "default"} onPress={() => setEditing(true)}>
            {info.set ? t("providers.replaceKey") : t("providers.addKey")}
          </Button>
          {info.set && (
            <ConfirmButton size="sm" variant="ghost" title={t("keys.clearTitle", { name })} description={t("keys.clearBody")} confirmLabel={t("keys.clear")} onConfirm={() => save("")}>
              {t("keys.clear")}
            </ConfirmButton>
          )}
        </Row>
      )}
      {error && <p className="py-3 text-sm text-danger">{error}</p>}
    </Group>
  )
}

// The models the provider offers today, by harness (Claude Code and the Anthropic API are both Claude).
function Models({ models, keySet }: { models: ReadonlyArray<ModelInfo>; keySet: boolean }) {
  const harnesses = [...new Set(models.map((m) => m.provider))]
  if (!models.length) return null
  return (
    <Group title={t("providers.models")}>
      {harnesses.map((h) => {
        const list = models.filter((m) => m.provider === h)
        return (
          <div key={h} className="flex flex-col gap-2 py-3.5">
            <span className="flex items-center gap-2 text-sm text-muted">
              {providerLabel(h)}
              {!list.some((m) => m.available) && <Badge>{list[0]?.kind === "api" && !keySet ? t("providers.needsKey") : t("model.unavailable")}</Badge>}
            </span>
            <ul className="grid grid-cols-2 gap-x-6 gap-y-2">
              {list.map((m) => (
                <li key={m.id} className="flex min-w-0 flex-col">
                  <span className="truncate">{modelName(m.id)}</span>
                  {modelNote(m.id) && <span className="truncate text-sm text-muted">{modelNote(m.id)}</span>}
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </Group>
  )
}
