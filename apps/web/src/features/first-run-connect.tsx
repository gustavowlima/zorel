// The first run's "Connect an AI" (first-run.tsx): the AI subscriptions people have, each with where it stands on
// this computer and its one next move. Claude (Claude Code) and ChatGPT (Codex) are accounts: install the CLI
// (official build, checked), then sign in on the provider's page. Antigravity (a Google account) signs in inside its
// own CLI: install it, then run `agy` once in a terminal. API keys, OpenRouter and local models: the providers'
// screens, in a dialog. Also the AIs found (useAi) and the "connect one" control the later steps use.
import type { ProviderAccount } from "@zorel/contracts"
import { t } from "@zorel/i18n"
import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import { useEffect, useState } from "react"
import { accountsAtom, cliAtom, modelsAtom, mutations, useInvalidate, useList, useMutation } from "../client.ts"
import { useRoute } from "../state.ts"
import { builderModel } from "./builder.tsx"
import { ProvidersSection } from "./providers.tsx"
import { ArrowRight, Button, Check, Copy, Dialog, Download, EngineLine, KeyRound, ProviderIcon, RefreshCw, Spinner, StepColumn } from "@/ui"

// The AIs found on this computer, and the one the Builder starts on.
export function useAi() {
  const result = useAtomValue(modelsAtom)
  const models = useList(modelsAtom)
  // Finding the AIs takes a few seconds (the CLIs are asked): until then it says so, not "none connected".
  const looking = AsyncResult.isInitial(result) || (AsyncResult.isSuccess(result) && result.waiting)
  return { looking, model: builderModel(models), models: models.filter((m) => m.available) }
}

// No AI yet: connect one without leaving (the providers' own screens, in a dialog).
export function AiMissing({ looking }: { looking: boolean }) {
  const [open, setOpen] = useState(false)
  if (looking) return <Looking />
  return (
    <>
      <Button variant="secondary" onPress={() => setOpen(true)}>
        {t("firstRun.connect")}
      </Button>
      <ProvidersDialog open={open} onOpenChange={setOpen} title={t("firstRun.connect")} />
    </>
  )
}

const Looking = () => (
  <span className="flex h-control items-center gap-2 text-sm text-muted">
    <Spinner className="size-4" />
    {t("firstRun.looking")}
  </span>
)

function ProvidersDialog({ open, onOpenChange, title }: { open: boolean; onOpenChange: (open: boolean) => void; title: string }) {
  const route = useRoute()
  return (
    <Dialog title={title} size="xl" isOpen={open} onOpenChange={onOpenChange}>
      {() => <ProvidersSection provider={route.view === "settings" ? route.provider : undefined} />}
    </Dialog>
  )
}

// Installing a CLI from its official source: the busy state, the error, and the lists to read again after.
function useInstall(cli: "claude" | "codex" | "antigravity", name: string) {
  const install = useMutation(mutations.installCli)
  const invalidate = useInvalidate()
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState<string>()
  const run = () => {
    setInstalling(true)
    setError(undefined)
    install({ params: { id: cli }, reactivityKeys: ["accounts", "models", "cli"] })
      .then(() => invalidate(["accounts", "models", "cli"]))
      .catch((e: unknown) => setError((e as { message?: string })?.message || t("providers.installFailed", { name })))
      .finally(() => setInstalling(false))
  }
  return { installing, error, run }
}

const InstallButton = ({ installing, onPress }: { installing: boolean; onPress: () => void }) => (
  <Button variant="secondary" size="sm" isDisabled={installing} onPress={onPress}>
    {installing ? <Spinner className="size-3.5" /> : <Download />}
    {t("providers.install")}
  </Button>
)

// ---------- the step ----------
export function Connect({ back, later, onNext }: { back: { label: string; onPress: () => void }; later: { label: string; onPress: () => void; busy?: boolean }; onNext: () => void }) {
  const ai = useAi()
  const accounts = useList(accountsAtom)
  const invalidate = useInvalidate()
  const [others, setOthers] = useState(false)
  // A sign-in finishes in the browser (or a terminal, for Antigravity): read again until it shows.
  const pending = accounts.some((a) => a.loggingIn)
  useEffect(() => {
    if (!pending) return
    const timer = setInterval(() => invalidate(["accounts", "models"]), 2000)
    return () => clearInterval(timer)
  }, [pending, invalidate])
  const account = (provider: string) => accounts.find((a) => a.provider === provider && a.isDefault)
  return (
    <StepColumn back={back} later={later}>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{t("firstRun.connectTitle")}</h1>
        <p className="max-w-prose text-muted">{t("firstRun.connectLede")}</p>
      </div>
      <div className="flex flex-col divide-y divide-subtle overflow-hidden rounded-card border border-subtle bg-surface shadow-lg">
        <SubscriptionRow provider="claude" cli="claude" icon="claude" account={account("claude")} />
        <SubscriptionRow provider="codex" cli="codex" icon="codex" account={account("codex")} />
        <AntigravityRow />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" onPress={() => setOthers(true)}>
          <KeyRound />
          {t("firstRun.otherAi")}
        </Button>
        {ai.model ? (
          <Button variant="default" onPress={onNext}>
            {t("firstRun.continue")}
            <ArrowRight />
          </Button>
        ) : ai.looking ? (
          <Looking />
        ) : null}
      </div>
      <ProvidersDialog open={others} onOpenChange={setOthers} title={t("firstRun.otherAi")} />
    </StepColumn>
  )
}

// Claude or ChatGPT: install the CLI, then sign in to the subscription on the provider's page.
function SubscriptionRow({ provider, cli, icon, account }: { provider: "claude" | "codex"; cli: "claude" | "codex"; icon: string; account: ProviderAccount | undefined }) {
  const name = t(`firstRun.engines.${provider}`)
  const install = useInstall(cli, name)
  const login = useMutation(mutations.login)
  const [link, setLink] = useState<string>()
  const [error, setError] = useState<string>()
  const signIn = () => {
    if (!account) return
    setError(undefined)
    login({ params: { id: account.id }, reactivityKeys: ["accounts"] }).then(
      (r) => r.url && setLink(r.url),
      () => setError(t("accounts.busy"))
    )
  }
  const state = !account ? "reading" : account.loggedIn ? "ready" : account.loggingIn ? "signingIn" : account.installed ? "signedOut" : "missing"
  const STATUS = { ready: account?.identity ?? t("accounts.signedIn"), reading: t("firstRun.engineState.reading"), missing: t("firstRun.engineState.missing"), signedOut: t("firstRun.engineState.signedOut"), signingIn: t("firstRun.engineState.signingIn") }
  const ACTION = {
    ready: <Check className="size-4 text-success" />,
    reading: <Spinner className="size-4 text-muted" />,
    missing: <InstallButton installing={install.installing} onPress={install.run} />,
    signedOut: (
      <Button variant="secondary" size="sm" onPress={signIn}>
        {t("accounts.signIn")}
      </Button>
    ),
    signingIn: (
      <Button variant="secondary" size="sm" isDisabled>
        <Spinner className="size-3.5" />
        {t("accounts.signIn")}
      </Button>
    )
  }
  return (
    <EngineLine icon={<ProviderIcon provider={icon} size={24} />} name={name} ready={state === "ready"} status={install.installing ? t("firstRun.installing") : STATUS[state]} action={ACTION[state]}>
      {link && state === "signingIn" && (
        <a className="text-sm text-accent-text underline" href={link} target="_blank" rel="noreferrer">
          {t("accounts.openLogin")}
        </a>
      )}
      {(error ?? install.error) && <p className="text-sm text-danger">{error ?? install.error}</p>}
    </EngineLine>
  )
}

// Antigravity (Google): no sign-in command; it asks for the Google account the first time `agy` runs in a terminal.
// Signed in = its models show up.
const AGY = "agy"
function AntigravityRow() {
  const name = t("firstRun.engines.antigravity")
  const cli = useList(cliAtom).find((c) => c.id === "antigravity")
  const ready = useList(modelsAtom).some((m) => m.provider === "antigravity" && m.available)
  const install = useInstall("antigravity", name)
  const invalidate = useInvalidate()
  const [copied, setCopied] = useState(false)
  const state = ready ? "ready" : !cli ? "reading" : cli.version ? "terminal" : "missing"
  const STATUS = { ready: t("firstRun.engineState.ready"), reading: t("firstRun.engineState.reading"), missing: t("firstRun.engineState.missing"), terminal: t("firstRun.engineState.terminal") }
  const copy = () =>
    void navigator.clipboard.writeText(AGY).then(
      () => setCopied(true),
      () => undefined
    )
  const ACTION = {
    ready: <Check className="size-4 text-success" />,
    reading: <Spinner className="size-4 text-muted" />,
    missing: <InstallButton installing={install.installing} onPress={install.run} />,
    terminal: (
      <Button variant="secondary" size="sm" onPress={() => invalidate(["models", "cli"])}>
        <RefreshCw />
        {t("firstRun.checkAgain")}
      </Button>
    )
  }
  return (
    <EngineLine icon={<ProviderIcon provider="antigravity" size={24} />} name={name} ready={state === "ready"} status={install.installing ? t("firstRun.installing") : STATUS[state]} action={ACTION[state]}>
      {state === "terminal" && (
        <span className="flex items-center gap-2 text-sm text-muted">
          <code className="rounded-inline bg-control px-1.5 py-0.5 font-mono text-xs text-fg">{AGY}</code>
          <Button size="sm" variant="ghost" onPress={copy}>
            <Copy />
            {copied ? t("firstRun.copied") : t("firstRun.copy")}
          </Button>
        </span>
      )}
      {install.error && <p className="text-sm text-danger">{install.error}</p>}
    </EngineLine>
  )
}
