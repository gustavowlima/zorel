// An agent CLI on a provider's page (Claude Code, Codex, OpenCode, Antigravity): its version against the latest, and
// the one move that fits: install it, update it (Zorel's copy), or nothing (it updates itself, or the person's own
// copy from Homebrew or npm, updated where it came from). "Check now" asks the sources instead of the server's cache.
import type { CliState } from "@zorel/contracts"
import { t } from "@zorel/i18n"
import { useState } from "react"
import { cliAtom, mutations, useList, useMutation } from "../client.ts"
import { Button, Download, RefreshCw, Rows, Section, SettingRow } from "@/ui"

export type CliId = CliState["id"]

// What a CLI's line says, by its state.
function hintOf(s: CliState): string {
  if (!s.version) return t("cli.notInstalled")
  if (s.keeper === "self") return t("cli.selfUpdates")
  if (s.update) return t("cli.updateAvailable", { latest: s.latest ?? "" })
  if (s.keeper === "you") return s.behind ? t("cli.yoursBehind", { latest: s.latest ?? "" }) : t("cli.yours")
  return s.latest ? t("cli.upToDate") : t("cli.latestUnknown")
}

// Installing (or updating) a CLI from its official source: busy while it runs, the error if it fails; the CLI list,
// the sign-ins and the models are read again after.
export function useInstall(id: CliId, name: string) {
  const install = useMutation(mutations.installCli)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState<string>()
  const run = () => {
    setInstalling(true)
    setError(undefined)
    install({ params: { id }, reactivityKeys: ["cli", "accounts", "models"] })
      .catch((e: unknown) => setError((e as { message?: string })?.message || t("providers.installFailed", { name })))
      .finally(() => setInstalling(false))
  }
  return { installing, error, run }
}

export function CliVersion({ id }: { id: CliId }) {
  const state = useList(cliAtom).find((s) => s.id === id)
  const install = useInstall(id, state?.name ?? id)
  const check = useMutation(mutations.checkCli)
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState(false)
  if (!state) return null
  // The server reads the sources now; the list is read again after.
  const checkNow = () => {
    setChecking(true)
    setCheckError(false)
    check({ query: { fresh: "1" }, reactivityKeys: ["cli"] })
      .catch((e: unknown) => {
        console.warn("[cli] check failed", e)
        setCheckError(true)
      })
      .finally(() => setChecking(false))
  }
  const error = install.error ?? (checkError ? t("cli.checkFailed") : undefined)
  return (
    <Section title={t("cli.title")}>
      <Rows>
        <SettingRow title={state.version ? `${state.name} ${state.version}` : state.name} hint={<span className={state.update || state.behind ? "text-warning" : undefined}>{hintOf(state)}</span>}>
          {!state.version || state.update ? (
            <Button size="sm" variant="default" isPending={install.installing} onPress={install.run}>
              <Download />
              {state.version ? t("cli.update", { latest: state.latest ?? "" }) : t("providers.install")}
            </Button>
          ) : (
            <Button size="sm" variant="ghost" isPending={checking} onPress={checkNow}>
              <RefreshCw />
              {t("cli.checkNow")}
            </Button>
          )}
        </SettingRow>
      </Rows>
      {error && <p className="text-sm text-danger">{error}</p>}
    </Section>
  )
}

// The CLIs Zorel could update now (a dot on the providers list).
export const useCliUpdates = () => useList(cliAtom).filter((s) => s.update)
