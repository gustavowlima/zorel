// Settings (prototype "Settings"): sections on the left, one at a time on the right. Accounts (subscription
// logins through the official CLIs), API keys, MCP servers, skills, appearance.
import type { AccountProvider, ProviderAccount } from "@zero/contracts"
import { formatAge, t } from "@zero/i18n"
import { type ReactNode, useEffect, useState } from "react"
import { accountsAtom, agentsAtom, keysAtom, memoriesAtom, mutations, projectsAtom, useInvalidate, useList, useMutation } from "../client.ts"
import { scopeLabel } from "../labels.ts"
import { go, SETTINGS_TABS, type SettingsTab, setThemePref, themePref, type ThemePref } from "../state.ts"
import { McpSection } from "./mcp.tsx"
import {
  Badge, BookOpen, Button, ConfirmButton, Field, Input, KeyRound, NavItem, Palette, Plug, Plus, ProviderIcon, Screen, Section, Select, Switch, User
} from "@/ui"

const ICONS: Record<SettingsTab, ReactNode> = { accounts: <User />, keys: <KeyRound />, mcp: <Plug />, skills: <BookOpen />, appearance: <Palette /> }

export function SettingsView({ tab }: { tab: SettingsTab }) {
  return (
    <Screen title={t("settings.title")} subtitle={t(`settings.hint.${tab}`)} bodyClassName="flex">
      <nav aria-label={t("settings.sections")} className="flex w-56 shrink-0 flex-col gap-0.5 border-r border-subtle p-3">
        {SETTINGS_TABS.map((s) => (
          <NavItem key={s} icon={ICONS[s]} active={s === tab} onPress={() => go({ view: "settings", tab: s })}>
            {t(`settings.${s}`)}
          </NavItem>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-8 py-7">
          {tab === "accounts" && <Accounts />}
          {tab === "keys" && <Keys />}
          {tab === "mcp" && <McpSection projectId={null} />}
          {tab === "skills" && <Skills />}
          {tab === "appearance" && <Appearance />}
        </div>
      </div>
    </Screen>
  )
}

// ---------- accounts ----------

function Accounts() {
  const accounts = useList(accountsAtom)
  const invalidate = useInvalidate()
  const create = useMutation(mutations.createAccount)
  const login = useMutation(mutations.login)
  const [adding, setAdding] = useState(false)
  const [provider, setProvider] = useState<AccountProvider>("claude")
  const [label, setLabel] = useState("")

  // A sign-in finishes in the browser; poll until the CLI reports it.
  const pending = accounts.some((a) => a.loggingIn)
  useEffect(() => {
    if (!pending) return
    const id = setInterval(() => invalidate(["accounts", "models"]), 2000)
    return () => clearInterval(id)
  }, [pending, invalidate])

  return (
    <>
      <p className="text-muted">{t("accounts.intro")}</p>
      <Section
        title={t("settings.accounts")}
        action={
          !adding && (
            <Button size="sm" variant="secondary" onPress={() => setAdding(true)}>
              <Plus />
              {t("accounts.add")}
            </Button>
          )
        }
      >
        {adding && (
          <form
            className="flex flex-wrap items-end gap-3 rounded-card border border-subtle p-4"
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
            <Field label={t("accounts.provider")} className="w-60">
              <Select
                value={provider}
                onChange={(v) => setProvider(v as AccountProvider)}
                aria-label={t("accounts.provider")}
                options={(["claude", "codex"] as const).map((p) => ({ value: p, label: t(`accounts.providers.${p}`) }))}
              />
            </Field>
            <Field label={t("accounts.name")} className="min-w-48 flex-1">
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("accounts.namePlaceholder")} maxLength={80} autoFocus />
            </Field>
            <Button type="submit" variant="default" isDisabled={!label.trim()}>
              {t("accounts.addAndSignIn")}
            </Button>
            <Button variant="ghost" onPress={() => setAdding(false)}>
              {t("common.cancel")}
            </Button>
          </form>
        )}
        <div className="flex flex-col divide-y divide-subtle border-y border-subtle">
          {accounts.map((a) => (
            <AccountRow key={a.id} account={a} />
          ))}
        </div>
      </Section>
    </>
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
    <div className="flex flex-col gap-2 py-3.5">
      <div className="flex items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-card bg-surface">
          <ProviderIcon provider={a.provider} size={18} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-2 font-medium">
            <span className="truncate">{a.label}</span>
            {a.isDefault && <Badge>{t("accounts.default")}</Badge>}
          </span>
          <span className={a.loggedIn ? "truncate text-sm text-muted" : "truncate text-sm text-warning"}>{status}</span>
        </span>
        {!a.loggedIn && (
          <Button size="sm" variant="default" isPending={a.loggingIn} isDisabled={a.loggingIn} onPress={signIn}>
            {t("accounts.signIn")}
          </Button>
        )}
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
        <a className="ml-11 text-sm text-accent-text underline" href={link} target="_blank" rel="noreferrer">
          {t("accounts.openLogin")}
        </a>
      )}
      {error && <p className="ml-11 text-sm text-danger">{error}</p>}
    </div>
  )
}

// ---------- API keys ----------

function Keys() {
  const keys = useList(keysAtom)
  const setKey = useMutation(mutations.setKey)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const save = (name: string, value: string) =>
    void setKey({ params: { name }, payload: { value }, reactivityKeys: ["keys", "models"] }).then(() => setDrafts((d) => ({ ...d, [name]: "" })))
  return (
    <>
      <p className="text-muted">{t("keys.intro")}</p>
      <div className="flex flex-col divide-y divide-subtle border-y border-subtle">
        {keys.map((k) => (
          <form
            key={k.name}
            className="flex flex-wrap items-center gap-3 py-3"
            onSubmit={(e) => {
              e.preventDefault()
              const v = drafts[k.name]?.trim()
              if (v) save(k.name, v)
            }}
          >
            <code className="w-56 shrink-0 font-mono text-sm">{k.name}</code>
            {k.fromEnv ? (
              <span className="text-sm text-muted">{t("keys.fromEnv")}</span>
            ) : (
              <>
                <Input
                  type="password"
                  autoComplete="off"
                  className="min-w-40 flex-1"
                  placeholder={k.set ? t("keys.saved") : t("keys.paste")}
                  aria-label={k.name}
                  value={drafts[k.name] ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [k.name]: e.target.value }))}
                />
                <Button type="submit" size="sm" variant="default" isDisabled={!drafts[k.name]?.trim()}>
                  {t("common.save")}
                </Button>
                {k.set && (
                  <Button size="sm" variant="ghost" onPress={() => save(k.name, "")}>
                    {t("keys.clear")}
                  </Button>
                )}
              </>
            )}
          </form>
        ))}
      </div>
    </>
  )
}

// ---------- skills ----------

function Skills() {
  const skills = useList(memoriesAtom).filter((m) => m.kind === "skill")
  const projects = useList(projectsAtom)
  const agents = useList(agentsAtom)
  const update = useMutation(mutations.updateMemory)
  return (
    <>
      <p className="text-muted">{t("skills.intro")}</p>
      <Section
        title={t("settings.skills")}
        action={
          <Button size="sm" variant="secondary" onPress={() => go({ view: "knowledge" })}>
            <Plus />
            {t("skills.new")}
          </Button>
        }
      >
        {skills.length === 0 && <p className="text-muted">{t("skills.empty")}</p>}
        {skills.length > 0 && (
          <div className="flex flex-col divide-y divide-subtle border-y border-subtle">
            {skills.map((s) => (
              <div key={s.id} className="flex items-center gap-3 py-3">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{s.title}</span>
                  <span className="truncate text-sm text-muted">
                    {[s.state === "pending" ? t("skills.pending") : s.origin === "auto" ? t("skills.learned") : t("skills.added"), formatAge(s.createdAt)].join(" · ")}
                  </span>
                </span>
                <span className="shrink-0 text-sm text-muted">{scopeLabel(s.scope, projects, agents)}</span>
                {s.state === "pending" ? (
                  <Button size="sm" variant="secondary" onPress={() => go({ view: "knowledge", id: s.id })}>
                    {t("skills.review")}
                  </Button>
                ) : (
                  <Switch
                    isSelected={s.state === "active"}
                    aria-label={t("skills.active", { name: s.title })}
                    onChange={(on) => void update({ params: { id: s.id }, payload: { state: on ? "active" : "forgotten" }, reactivityKeys: ["memories"] })}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </Section>
    </>
  )
}

// ---------- appearance ----------

function Appearance() {
  const [pref, setPref] = useState<ThemePref>(themePref)
  return (
    <Field label={t("appearance.theme")} className="w-64">
      <Select
        value={pref}
        aria-label={t("appearance.theme")}
        onChange={(v) => {
          setPref(v as ThemePref)
          setThemePref(v as ThemePref)
        }}
        options={(["system", "dark", "light"] as const).map((p) => ({ value: p, label: t(`appearance.${p}`) }))}
      />
    </Field>
  )
}
