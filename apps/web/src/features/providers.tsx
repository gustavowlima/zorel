// Settings › Providers (inspired by OpenBot's Providers): every way Zero reaches a model, one place. The list
// splits Connected from Other providers; a provider's page gathers its subscription sign-ins (the official CLI,
// several accounts), its API key (system keychain), or whether its local server is running, and the models it
// offers. Zero never reads or stores a CLI's login: it only shows who is connected.
import type { AccountProvider, KeyInfo as KeyInfoSchema, ModelInfo, ProviderAccount } from "@zero/contracts"
import { t } from "@zero/i18n"
import { type ReactNode, useEffect, useState } from "react"
import { accountsAtom, agentsAtom, keysAtom, modelsAtom, mutations, useInvalidate, useList, useMutation } from "../client.ts"
import { modelName, modelNote, providerLabel, splitModel } from "../labels.ts"
import { go } from "../state.ts"
import { Badge, Button, ChevronRight, ConfirmButton, Input, Plus, ProviderIcon, Search, cx } from "@/ui"

type KeyInfo = typeof KeyInfoSchema.Type

type Provider = {
  readonly id: "claude" | "chatgpt" | "openrouter" | "ollama" | "lmstudio"
  readonly icon: string
  readonly account?: AccountProvider // signs in with an official CLI
  readonly key?: string // takes an API key
  readonly harnesses: ReadonlyArray<string> // model id prefixes it serves
}

const PROVIDERS: ReadonlyArray<Provider> = [
  { id: "claude", icon: "claude", account: "claude", key: "ANTHROPIC_API_KEY", harnesses: ["claude-cli", "anthropic"] },
  { id: "chatgpt", icon: "codex", account: "codex", key: "OPENAI_API_KEY", harnesses: ["codex-cli", "openai"] },
  { id: "openrouter", icon: "openrouter", key: "OPENROUTER_API_KEY", harnesses: ["openrouter"] },
  { id: "ollama", icon: "ollama", harnesses: ["ollama"] },
  { id: "lmstudio", icon: "lmstudio", harnesses: ["lmstudio"] }
]

// The provider page that sets up a model's harness ("claude-cli" → claude).
export const providerPageOf = (harness: string) => PROVIDERS.find((p) => p.harnesses.includes(harness))?.id

type State = { accounts: ReadonlyArray<ProviderAccount>; key: KeyInfo | undefined; models: ReadonlyArray<ModelInfo>; running: boolean }

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
function summary(p: Provider, s: State) {
  const signedIn = s.accounts.filter((a) => a.loggedIn)
  if (signedIn.length) {
    const first = signedIn[0]!.identity ?? signedIn[0]!.label
    return signedIn.length > 1 ? t("providers.andMore", { name: first, count: signedIn.length - 1 }) : first
  }
  if (s.key?.set) return t("providers.keySaved")
  if (s.running) return t("providers.running")
  return p.account ? t("accounts.signedOut") : p.key ? t("providers.noKey") : t("providers.notRunning")
}

export function ProvidersSection({ provider }: { provider: string | undefined }) {
  const page = PROVIDERS.find((p) => p.id === provider)
  return page ? <ProviderPage provider={page} /> : <ProviderList />
}

function ProviderList() {
  const stateOf = useStates()
  const [query, setQuery] = useState("")
  const shown = PROVIDERS.filter((p) => t(`providers.names.${p.id}`).toLowerCase().includes(query.trim().toLowerCase()))
  const on = shown.filter((p) => connected(stateOf(p)))
  const off = shown.filter((p) => !connected(stateOf(p)))
  const group = (title: string, list: ReadonlyArray<Provider>, action?: ReactNode) =>
    (list.length > 0 || action) && (
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-sm font-medium text-muted">{title}</h2>
          {action}
        </div>
        {list.length > 0 && (
          <div className="flex flex-col divide-y divide-subtle overflow-hidden rounded-card bg-surface">
            {list.map((p) => (
              <Button
                key={p.id}
                variant="ghost"
                className="h-auto justify-start gap-3.5 rounded-none px-4 py-3.5 text-left font-normal text-fg"
                onPress={() => go({ view: "settings", tab: "providers", provider: p.id })}
              >
                <ProviderIcon provider={p.icon} size={20} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">{t(`providers.names.${p.id}`)}</span>
                  <span className="truncate text-sm text-muted">{summary(p, stateOf(p))}</span>
                </span>
                <ChevronRight className="size-4 text-muted" />
              </Button>
            ))}
          </div>
        )}
      </section>
    )
  return (
    <>
      {group(
        t("providers.connected"),
        on,
        <label className="relative w-56">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" />
          <Input className="pl-8" placeholder={t("providers.search")} aria-label={t("providers.search")} value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      )}
      {group(t("providers.others"), off)}
    </>
  )
}

function ProviderPage({ provider: p }: { provider: Provider }) {
  const s = useStates()(p)
  const agents = useList(agentsAtom).filter((a) => p.harnesses.includes(splitModel(a.model).provider))
  const isConnected = connected(s)
  return (
    <>
      <nav aria-label={t("providers.breadcrumb")} className="flex items-center gap-2 text-lg font-semibold">
        <Button variant="ghost" className="h-auto px-0 text-lg font-semibold text-muted hover:bg-transparent" onPress={() => go({ view: "settings", tab: "providers" })}>
          {t("settings.providers")}
        </Button>
        <ChevronRight className="size-4 text-muted" />
        <span aria-current="page">{t(`providers.names.${p.id}`)}</span>
      </nav>

      <div className="flex items-center gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-card bg-surface">
          <ProviderIcon provider={p.icon} size={26} />
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-2.5">
            <span className="text-lg font-semibold">{t(`providers.names.${p.id}`)}</span>
            <Badge tone={isConnected ? "success" : "neutral"}>{isConnected ? t("providers.isConnected") : t("providers.notConnected")}</Badge>
          </span>
          <span className="text-sm text-muted">{t("providers.agentsUse", { count: agents.length })}</span>
        </span>
      </div>

      {p.account && <SignIns provider={p.account} accounts={s.accounts} />}
      {s.key && <ApiKey info={s.key} name={t(`providers.names.${p.id}`)} />}
      {!p.account && !p.key && (
        <Group title={t("providers.server")}>
          <Row title={s.running ? t("providers.running") : t("providers.notRunning")} hint={t(`model.hints.${p.id === "ollama" ? "ollama" : "lmstudio"}`)} />
        </Group>
      )}
      <Models models={s.models} />
    </>
  )
}

const Group = ({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) => (
  <section className="flex flex-col gap-3">
    <div className="flex items-center justify-between gap-4">
      <h2 className="text-sm font-medium text-muted">{title}</h2>
      {action}
    </div>
    <div className="flex flex-col divide-y divide-subtle rounded-card bg-surface px-4">{children}</div>
  </section>
)

const Row = ({ title, hint, tone, children }: { title: ReactNode; hint?: ReactNode; tone?: "warning"; children?: ReactNode }) => (
  <div className="flex flex-wrap items-center gap-3 py-3.5">
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="truncate font-medium">{title}</span>
      {hint && <span className={cx("text-sm", tone === "warning" ? "text-warning" : "text-muted")}>{hint}</span>}
    </span>
    {children}
  </div>
)

// Subscription sign-ins through the official CLI; each extra account gets its own folder.
function SignIns({ provider, accounts }: { provider: AccountProvider; accounts: ReadonlyArray<ProviderAccount> }) {
  const invalidate = useInvalidate()
  const create = useMutation(mutations.createAccount)
  const login = useMutation(mutations.login)
  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState("")

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
      {adding && (
        <form
          className="flex flex-wrap items-center gap-3 py-3.5"
          onSubmit={(e) => {
            e.preventDefault()
            void create({ payload: { provider, label: label.trim() }, reactivityKeys: ["accounts"] }).then((a) => {
              setLabel("")
              setAdding(false)
              // The CLI opens the provider's sign-in page in the browser.
              return login({ params: { id: a.id }, reactivityKeys: ["accounts"] })
            })
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
      )}
      <p className="py-3 text-sm text-muted">{t("accounts.intro")}</p>
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
            <span className="truncate font-medium">{a.loggedIn ? (a.identity ?? a.label) : a.label}</span>
            {a.isDefault && <Badge>{t("accounts.default")}</Badge>}
          </span>
          <span className={cx("truncate text-sm", a.loggedIn ? "text-muted" : "text-warning")}>{a.loggedIn ? a.label : status}</span>
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
function ApiKey({ info, name }: { info: KeyInfo; name: string }) {
  const setKey = useMutation(mutations.setKey)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const save = (value: string) =>
    void setKey({ params: { name: info.name }, payload: { value }, reactivityKeys: ["keys", "models"] }).then(() => {
      setDraft("")
      setEditing(false)
    })
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
        <Row title={info.set ? t("providers.keySaved") : t("providers.noKey")} hint={info.set ? t("keys.intro") : t("providers.pasteKey", { name })}>
          <Button size="sm" variant="secondary" onPress={() => setEditing(true)}>
            {info.set ? t("providers.replaceKey") : t("providers.addKey")}
          </Button>
          {info.set && (
            <Button size="sm" variant="ghost" onPress={() => save("")}>
              {t("keys.clear")}
            </Button>
          )}
        </Row>
      )}
    </Group>
  )
}

// The models the provider offers today, by harness (Claude Code and the Anthropic API are both Claude).
function Models({ models }: { models: ReadonlyArray<ModelInfo> }) {
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
              {!list.some((m) => m.available) && <Badge>{t("model.unavailable")}</Badge>}
            </span>
            <ul className="flex flex-wrap gap-x-6 gap-y-2">
              {list.map((m) => (
                <li key={m.id} className="flex flex-col" title={modelNote(m.id) || undefined}>
                  <span>{modelName(m.id)}</span>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </Group>
  )
}
