// An agent CLI on a provider's page (Claude Code, Codex, OpenCode, Antigravity): its version against the latest, and
// the one move that fits: install it, update it (Zorel's copy), or nothing (it updates itself, or the person's own
// copy from Homebrew or npm, updated where it came from). "Check now" asks the sources instead of the server's cache.
import type { CliState } from "@zorel/contracts"
import { t } from "@zorel/i18n"
import { useState } from "react"
import { cliAtom, mutations, useInvalidate, useList, useMutation } from "../client.ts"
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

export function CliVersion({ id }: { id: CliId }) {
  const state = useList(cliAtom).find((s) => s.id === id)
  const install = useMutation(mutations.installCli)
  const invalidate = useInvalidate()
  const [busy, setBusy] = useState<"install" | "check">()
  const [error, setError] = useState<string>()
  if (!state) return null
  const run = () => {
    setBusy("install")
    setError(undefined)
    install({ params: { id }, reactivityKeys: ["cli", "accounts", "models"] })
      .catch((e: unknown) => setError((e as { message?: string })?.message || t("providers.installFailed", { name: state.name })))
      .finally(() => setBusy(undefined))
  }
  // The server reads the sources now, then the list is read again.
  const checkNow = () => {
    setBusy("check")
    void fetch("/api/cli?fresh=1", { credentials: "same-origin" })
      .catch(() => undefined)
      .finally(() => {
        invalidate(["cli"])
        setBusy(undefined)
      })
  }
  return (
    <Section title={t("cli.title")}>
      <Rows>
        <SettingRow title={state.version ? `${state.name} ${state.version}` : state.name} hint={<span className={state.update || state.behind ? "text-warning" : undefined}>{hintOf(state)}</span>}>
          {!state.version || state.update ? (
            <Button size="sm" variant="default" isPending={busy === "install"} onPress={run}>
              <Download />
              {state.version ? t("cli.update", { latest: state.latest ?? "" }) : t("providers.install")}
            </Button>
          ) : (
            <Button size="sm" variant="ghost" isPending={busy === "check"} onPress={checkNow}>
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

// How many CLIs Zorel could update now (a dot on the providers list).
export const useCliUpdates = () => useList(cliAtom).filter((s) => s.update)
