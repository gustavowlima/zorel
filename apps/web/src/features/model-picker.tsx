// Model picker (prototype: "Choose model"): a rail with one button per subscription account and per API
// provider, the models of the selected one on the right, a search across all of them, and the reasoning level
// (a stepped slider) for engines that have one. Switching keeps the whole context (the runtime resends only the delta).
import type { Effort, ModelInfo, ProviderAccount } from "@zorel/contracts"
import { t } from "@zorel/i18n"
import { type ReactNode, useMemo, useState } from "react"
import { accountsAtom, modelsAtom, useList } from "../client.ts"
import { ACCOUNT_OF_MODEL, modelName, modelNote, providerLabel, splitModel } from "../labels.ts"
import { go } from "../state.ts"
import { LimitWindows } from "./limits.tsx"
import { providerPageOf } from "./providers.tsx"
import { Button, cn, FieldButton, IconButton, Input, OptionButton, Popover, ProviderIcon, RailButton, SearchInput, Settings, StepSlider } from "@/ui"

export interface ModelChoice {
  readonly model: string
  readonly accountId: string | null // null: the provider's default account
  readonly effort: Effort | null // null: the model's default
}

interface Entry {
  readonly key: string
  readonly provider: string // model provider: claude-cli, codex-cli, anthropic…
  readonly label: string
  readonly kind: "subscription" | "api" | "local" | "agent"
  readonly account: ProviderAccount | undefined
  readonly badge: string | undefined
  readonly available: boolean
  readonly models: ReadonlyArray<string> // suggestions; API providers also take any id
}

const LOCAL = new Set(["ollama", "lmstudio"])
const SAME_LOGO: Record<string, string> = { anthropic: "claude-cli", openai: "codex-cli" } // API provider → subscription with its logo
const EFFORT_PROVIDERS = new Set(["claude-cli", "codex-cli"])
const EFFORTS = ["default", "low", "medium", "high", "max"] as const
const VALID_ID = /^[a-z-]+\/\S+$/

function entriesOf(accounts: ReadonlyArray<ProviderAccount>, models: ReadonlyArray<ModelInfo>): Entry[] {
  const namesOf = (provider: string) => models.filter((m) => m.provider === provider && !m.id.endsWith("…")).map((m) => splitModel(m.id).model)
  const entries: Entry[] = []
  for (const provider of ["claude-cli", "codex-cli"]) {
    const mine = accounts.filter((a) => a.provider === ACCOUNT_OF_MODEL[provider])
    const info = models.find((m) => m.provider === provider)
    if (!mine.length && !info) continue
    // Accounts not loaded yet (or none): one entry for the provider itself.
    if (!mine.length) {
      entries.push({ key: provider, provider, label: providerLabel(provider), kind: "subscription", account: undefined, badge: undefined, available: !!info?.available, models: namesOf(provider) })
      continue
    }
    for (const a of mine)
      entries.push({
        key: a.id,
        provider,
        label: a.label,
        kind: "subscription",
        account: a,
        badge: mine.length > 1 ? a.label.trim().charAt(0).toUpperCase() : undefined,
        available: a.loggedIn && !a.limitedUntil,
        models: namesOf(provider)
      })
  }
  for (const provider of [...new Set(models.filter((m) => m.kind === "api").map((m) => m.provider))]) {
    const available = !!models.find((m) => m.provider === provider)?.available
    // An API provider with a subscription's logo (Anthropic, OpenAI) shows only when it is really another way
    // in (a key is set): otherwise the rail would show a second, dimmed Claude or Codex.
    const twin = SAME_LOGO[provider]
    if (!available && twin && entries.some((e) => e.provider === twin)) continue
    // A local server (Ollama, LM Studio) shows only while it is running.
    if (!available && LOCAL.has(provider)) continue
    entries.push({
      key: provider,
      provider,
      label: providerLabel(provider),
      kind: LOCAL.has(provider) ? "local" : "api",
      account: undefined,
      badge: undefined,
      available,
      models: namesOf(provider)
    })
  }
  // ACP agent CLIs (Gemini CLI, OpenCode, Antigravity): shown while installed; they use their own sign-in and models.
  for (const provider of ACP_PROVIDERS) {
    if (!models.find((m) => m.provider === provider)?.available) continue
    entries.push({ key: provider, provider, label: providerLabel(provider), kind: "agent", account: undefined, badge: undefined, available: true, models: namesOf(provider) })
  }
  return entries
}
const ACP_PROVIDERS = ["gemini-cli", "opencode", "antigravity"]

// The entry a choice belongs to: the chosen account, else the provider's default account, else the provider.
const entryOf = (entries: ReadonlyArray<Entry>, v: ModelChoice) => {
  const provider = splitModel(v.model).provider
  const mine = entries.filter((e) => e.provider === provider)
  return mine.find((e) => e.account && e.account.id === v.accountId) ?? mine.find((e) => e.account?.isDefault) ?? mine[0]
}

function useModelEntries() {
  const accounts = useList(accountsAtom)
  const models = useList(modelsAtom)
  return useMemo(() => entriesOf(accounts, models), [accounts, models])
}

export function ModelPicker({ value, onChange, variant = "chip", className }: { value: ModelChoice; onChange: (v: ModelChoice) => void; variant?: "chip" | "field"; className?: string }) {
  const entries = useModelEntries()
  const current = entryOf(entries, value)
  const provider = splitModel(value.model).provider
  const account = current?.account && entries.filter((e) => e.provider === provider).length > 1 ? current.label : undefined

  const face = (
    <>
      <ProviderIcon provider={provider} size={14} />
      <span className="truncate">{modelName(value.model)}</span>
      {account && <span className="truncate font-normal text-muted">{`· ${account}`}</span>}
    </>
  )
  const trigger =
    variant === "field" ? (
      <FieldButton aria-label={t("model.choose")} {...(className && { className })}>
        {face}
      </FieldButton>
    ) : (
      <Button size="sm" variant="ghost" aria-label={t("model.choose")} className={cn("max-w-60 font-normal text-muted", className)}>
        {face}
      </Button>
    )

  return (
    <Popover trigger={trigger} label={t("model.choose")} placement={variant === "field" ? "bottom start" : "top start"}>
      {(close) => <PickerBody entries={entries} value={value} current={current} onChange={onChange} close={close} />}
    </Popover>
  )
}

// One view: accounts on the rail, a search across all of them, the selected one's limits and models; below, for an
// engine with a reasoning level, that level as a stepped slider with its name.
function PickerBody({ entries, value, current, onChange, close }: { entries: ReadonlyArray<Entry>; value: ModelChoice; current: Entry | undefined; onChange: (v: ModelChoice) => void; close: () => void }) {
  const [railKey, setRailKey] = useState(current?.key ?? entries[0]?.key)
  const [query, setQuery] = useState("")
  const entry = entries.find((e) => e.key === railKey) ?? entries[0]

  const pick = (e: Entry, model: string) => {
    onChange({ model: `${e.provider}/${model}`, accountId: e.account && !e.account.isDefault ? e.account.id : null, effort: EFFORT_PROVIDERS.has(e.provider) ? value.effort : null })
    close()
  }
  const isSelected = (e: Entry, model: string) => value.model === `${e.provider}/${model}` && current?.key === e.key

  const q = query.trim().toLowerCase()
  const matches = q ? entries.flatMap((e) => e.models.filter((m) => `${e.label} ${m}`.toLowerCase().includes(q)).map((m) => ({ e, m }))) : []

  const level = value.effort ?? "default"
  return (
    <div className="flex min-h-0 w-md flex-1 flex-col">
    {/* One height for every provider (it still shrinks to the window): the rail always fits and the popover does
        not jump in size when another account is picked; the model list takes the room left. */}
    <div className="flex h-100 min-h-0 shrink">
      <div className="flex w-15 shrink-0 flex-col items-center border-r border-subtle py-2.5">
        <fieldset aria-label={t("model.accounts")} className="scroll-quiet m-0 flex min-h-0 min-w-0 flex-1 flex-col items-center gap-1.5 overflow-y-auto border-0 p-0">
          {entries.map((e) => (
            <RailButton key={e.key} selected={!q && e.key === entry?.key} label={e.label} dimmed={!e.available} onPress={() => {
                setQuery("")
                setRailKey(e.key)
              }} {...(e.badge && { badge: e.badge })}>
              <ProviderIcon provider={e.provider} size={20} />
            </RailButton>
          ))}
        </fieldset>
        {/* Adding or managing an account lives in Settings › Providers. */}
        <IconButton className="mt-1.5 shrink-0" label={t("settings.providers")} onPress={() => {
            close()
            go({ view: "settings", tab: "providers" })
          }}>
          <Settings />
        </IconButton>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-2.5">
        <SearchField value={query} onChange={setQuery} />
        {q ? (
          <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto">
            {matches.map(({ e, m }) => (
              <OptionButton key={`${e.key}/${m}`} selected={isSelected(e, m)} title={modelName(`${e.provider}/${m}`)} note={e.label} onPress={() => pick(e, m)} />
            ))}
            {VALID_ID.test(query.trim()) && <OptionButton selected={false} title={query.trim()} note={t("model.customHint")} onPress={() => {
                  onChange({ model: query.trim(), accountId: null, effort: null })
                  close()
                }} />}
            {!matches.length && !VALID_ID.test(query.trim()) && <p className="px-2.5 py-3 text-muted">{t("model.noMatch")}</p>}
          </div>
        ) : (
          entry && <EntryPane entry={entry} isSelected={isSelected} pick={pick} close={close} />
        )}
      </div>
    </div>
      {EFFORT_PROVIDERS.has(splitModel(value.model).provider) && (
        <div className="flex shrink-0 flex-col gap-2 border-t border-subtle px-4 pt-3 pb-3.5">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-muted">{t("model.effort")}</span>
            <span className="font-medium text-fg">{t(`model.effortLevel.${level}`)}</span>
          </div>
          <StepSlider
            label={t("model.effort")}
            value={level}
            steps={EFFORTS.map((e) => ({ id: e, label: t(`model.effortLevel.${e}`) }))}
            onChange={(e) => onChange({ ...value, effort: e === "default" ? null : e })}
          />
        </div>
      )}
    </div>
  )
}

function EntryPane({ entry, isSelected, pick, close }: { entry: Entry; isSelected: (e: Entry, m: string) => boolean; pick: (e: Entry, m: string) => void; close: () => void }) {
  const [custom, setCustom] = useState("")
  const kind =
    entry.kind === "subscription" ? (entry.account?.identity ?? t("model.subscription")) : entry.kind === "local" ? t("model.local") : entry.kind === "agent" ? t("model.agentCli") : t("model.apiKey")
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      <div className="flex items-center gap-2 px-2.5 pt-1">
        <ProviderIcon provider={entry.provider} size={14} />
        <span className="truncate font-semibold">{entry.label}</span>
        <span className="truncate text-sm text-muted">{kind}</span>
      </div>
      {entry.account && (
        <div className="px-2.5">
          <LimitWindows account={entry.account} compact />
        </div>
      )}
      {/* Not set up (signed out, no key, server not running): it just says so and opens that provider's page in
          Settings, where it is set up. No setup instructions here, and no models to pick until it works. */}
      {!entry.available && !entry.account?.limitedUntil && (
        <div className="flex items-center gap-2 px-2.5 py-1 text-sm">
          <span className="flex-1 text-muted">{entry.kind === "subscription" ? t("model.signedOut") : t("model.unavailable")}</span>
          <Button
            size="sm"
            variant="secondary"
            onPress={() => {
              close()
              const page = providerPageOf(entry.provider)
              go({ view: "settings", tab: "providers", ...(page && { provider: page }) })
            }}
          >
            {entry.kind === "subscription" ? t("model.signIn") : t("model.setUp")}
          </Button>
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto">
        {(entry.available || entry.account?.limitedUntil ? entry.models : []).map((m) => (
          <OptionButton key={m} selected={isSelected(entry, m)} title={modelName(`${entry.provider}/${m}`)} note={modelNote(`${entry.provider}/${m}`)} onPress={() => pick(entry, m)} />
        ))}
      </div>
      {entry.available && entry.kind !== "subscription" && (
        <form
          className="flex items-center gap-1.5 px-1 pt-1"
          onSubmit={(e) => {
            e.preventDefault()
            if (custom.trim()) pick(entry, custom.trim())
          }}
        >
          <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={t("model.customId")} aria-label={t("model.customId")} spellCheck={false} className="h-control-sm text-sm" />
          <Button type="submit" size="sm" isDisabled={!custom.trim()}>
            {t("model.use")}
          </Button>
        </form>
      )}
    </div>
  )
}

function SearchField({ value, onChange }: { value: string; onChange: (v: string) => void }): ReactNode {
  return (
    <SearchInput value={value} onChange={(e) => onChange(e.target.value)} placeholder={t("model.search")} aria-label={t("model.search")} autoFocus />
  )
}

