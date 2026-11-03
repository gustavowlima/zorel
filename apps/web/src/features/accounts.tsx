// Provider accounts (ARCHITECTURE §6.1): list with login status, add, sign in, remove; and the picker
// a chat uses. Minimal on purpose: the redesign comes in the UI phase.
import type { AccountProvider, ProviderAccount } from "@zero/contracts"
import { useEffect, useState } from "react"
import { call } from "../api.ts"
import { Badge, Button, Card, ConfirmButton, Input, Select } from "@/ui"

const PROVIDER_OF_MODEL: Record<string, AccountProvider> = { "claude-cli": "claude", "codex-cli": "codex" }
const PROVIDER_LABEL: Record<string, string> = { claude: "Claude (assinatura)", codex: "ChatGPT / Codex (assinatura)" }

export const accountProviderOf = (model: string) => PROVIDER_OF_MODEL[model.slice(0, model.indexOf("/"))]

export function useAccounts() {
  const [accounts, setAccounts] = useState<ReadonlyArray<ProviderAccount>>([])
  const load = () => call((c) => c.accounts.list()).then(setAccounts)
  // biome-ignore lint/correctness/useExhaustiveDependencies: loads once
  useEffect(() => void load(), [])
  return { accounts, load }
}

export function AccountsSection() {
  const { accounts, load } = useAccounts()
  const [provider, setProvider] = useState<AccountProvider>("claude")
  const [label, setLabel] = useState("")
  const [links, setLinks] = useState<Record<string, string>>({})
  const [error, setError] = useState<string>()

  // A login runs in the browser; poll until the CLI reports it finished.
  const pending = accounts.some((a) => a.loggingIn)
  // biome-ignore lint/correctness/useExhaustiveDependencies: polls only while a login is open
  useEffect(() => {
    if (!pending) return
    const t = setInterval(() => void load(), 2000)
    return () => clearInterval(t)
  }, [pending])

  const login = (a: ProviderAccount) =>
    call((c) => c.accounts.login({ params: { id: a.id } }))
      .then((r) => {
        if (r.url) setLinks((l) => ({ ...l, [a.id]: r.url! }))
        return load()
      })
      .catch(() => setError("Já há um login aberto para essa conta."))
  const add = () =>
    call((c) => c.accounts.create({ payload: { provider, label: label.trim() } })).then((a) => {
      setLabel("")
      return load().then(() => login(a))
    })
  const remove = (a: ProviderAccount) => call((c) => c.accounts.remove({ params: { id: a.id } })).then(load, () => setError("Não deu para remover essa conta."))

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-semibold">Contas</h2>
      <p className="text-sm text-muted">
        Cada conta usa o login oficial da CLI numa pasta própria. O Zero nunca lê nem guarda o login: só mostra quem está conectado. Usar várias assinaturas para contornar limites pode violar os termos do provider.
      </p>
      {accounts.map((a) => (
        <Card key={a.id} className="flex flex-wrap items-center gap-2 py-2">
          <div className="mr-auto flex min-w-0 flex-col">
            <span className="font-medium">
              {a.label} {a.isDefault && <Badge>padrão</Badge>}
            </span>
            <span className="text-sm text-muted">
              {PROVIDER_LABEL[a.provider] ?? a.provider} · {a.loggingIn ? "entrando no navegador…" : a.loggedIn ? (a.identity ?? "conectada") : "não conectada"}
            </span>
            {links[a.id] && a.loggingIn && (
              <a className="text-sm text-accent-text underline" href={links[a.id]} target="_blank" rel="noreferrer">
                Abrir a página de login
              </a>
            )}
          </div>
          {!a.loggedIn && (
            <Button size="sm" variant="default" isDisabled={a.loggingIn} onPress={() => void login(a)}>
              Entrar
            </Button>
          )}
          {!a.isDefault && (
            <ConfirmButton size="sm" variant="ghost" title={`Remover ${a.label}?`} description="Sai da conta e apaga a pasta de login dela. Agentes e chats que a usavam voltam para a conta padrão." confirmLabel="Remover" onConfirm={() => void remove(a)}>
              Remover
            </ConfirmButton>
          )}
        </Card>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Select className="w-64" value={provider} onChange={(v) => setProvider(v as AccountProvider)} options={Object.entries(PROVIDER_LABEL).map(([value, label]) => ({ value, label }))} aria-label="Provider" />
        <Input className="w-56" placeholder="Nome, ex.: Claude trabalho" value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Nome da conta" />
        <Button variant="default" isDisabled={!label.trim()} onPress={() => void add()}>
          Adicionar e entrar
        </Button>
      </div>
      {error && <div className="text-sm text-danger">{error}</div>}
    </section>
  )
}

// Account for a chat's lead: only accounts that serve the chosen model; "" = the provider's default.
export function AccountSelect({ model, value, onChange, className }: { model: string; value: string | null; onChange: (id: string | null) => void; className?: string }) {
  const { accounts } = useAccounts()
  const provider = accountProviderOf(model)
  const mine = accounts.filter((a) => a.provider === provider)
  if (!provider || mine.length < 2) return null // one account: nothing to pick
  const def = mine.find((a) => a.isDefault)
  return (
    <Select
      {...(className && { className })}
      value={value ?? ""}
      onChange={(v) => onChange(v || null)}
      options={[{ value: "", label: `${def?.label ?? "Padrão"} (padrão)` }, ...mine.filter((a) => !a.isDefault).map((a) => ({ value: a.id, label: a.label }))]}
      aria-label="Conta"
    />
  )
}
