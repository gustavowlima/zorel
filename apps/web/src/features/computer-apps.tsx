// Computer apps (spec 008): the apps on the person's computer an agent may use, each read only or read and use,
// through agent-desktop, which the person installs here (downloaded from its release and checked, no Node.js).
// On macOS it needs the Accessibility permission; the guide opens System Settings.
import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import type { DesktopApp } from "@zorel/contracts"
import { t } from "@zorel/i18n"
import { useId, useState } from "react"
import { desktopAtom, desktopRunningAtom, mutations, useMutation } from "../client.ts"
import { AppWindow, Button, IconButton, Input, Rows, Segmented, SettingRow, X } from "@/ui"

export function ComputerApps({ value, onChange }: { value: ReadonlyArray<DesktopApp>; onChange: (apps: ReadonlyArray<DesktopApp>) => void }) {
  const status = AsyncResult.getOrElse(useAtomValue(desktopAtom), () => undefined)
  const running = AsyncResult.getOrElse(useAtomValue(desktopRunningAtom), () => [] as ReadonlyArray<string>)
  const install = useMutation(mutations.installDesktop)
  const guide = useMutation(mutations.desktopGuide)
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const listId = useId()
  if (!status) return null
  const has = (name: string) => value.some((a) => a.name.toLowerCase() === name.trim().toLowerCase())
  const add = () => {
    const name = draft.trim()
    if (name && !has(name)) onChange([...value, { name, level: "read" }])
    setDraft("")
  }
  const doInstall = () => {
    setBusy(true)
    setError(undefined)
    void install({ reactivityKeys: ["desktop"] }).then(
      () => setBusy(false),
      () => {
        setBusy(false)
        setError(t("computer.installFailed"))
      }
    )
  }
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-muted">{t("computer.title")}</h3>
      <p className="max-w-prose text-sm text-dim">{t("computer.intro")}</p>
      <Rows>
        {!status.supported ? (
          <SettingRow icon={<AppWindow />} title={t("computer.unsupported")} />
        ) : !status.installed ? (
          <SettingRow icon={<AppWindow />} title={t("computer.needs")} hint={t("computer.needsHint", { version: status.version })}>
            <Button size="sm" variant="secondary" isPending={busy} onPress={doInstall}>
              {t("computer.install")}
            </Button>
          </SettingRow>
        ) : (
          <>
            {status.accessibility === "denied" && (
              <SettingRow icon={<AppWindow />} title={<span className="text-warning">{t("computer.noPermission")}</span>} hint={status.suggestion ?? undefined}>
                <Button size="sm" variant="secondary" onPress={() => void guide({ reactivityKeys: [] })}>
                  {t("computer.guide")}
                </Button>
              </SettingRow>
            )}
            {value.map((a) => (
              <SettingRow key={a.name} icon={<AppWindow />} title={a.name}>
                <Segmented
                  label={a.name}
                  value={a.level}
                  onChange={(level) => onChange(value.map((x) => (x.name === a.name ? { ...x, level } : x)))}
                  options={[
                    { id: "read", label: t("computer.read") },
                    { id: "use", label: t("computer.use") }
                  ]}
                />
                <IconButton label={t("computer.remove", { name: a.name })} size="sm" onPress={() => onChange(value.filter((x) => x.name !== a.name))}>
                  <X className="size-4" />
                </IconButton>
              </SettingRow>
            ))}
            <form
              className="flex flex-wrap items-center gap-3 py-3.5"
              onSubmit={(e) => {
                e.preventDefault()
                add()
              }}
            >
              <Input className="min-w-48 flex-1" list={listId} placeholder={t("computer.addPlaceholder")} aria-label={t("computer.add")} value={draft} onChange={(e) => setDraft(e.target.value)} />
              <datalist id={listId}>
                {running.filter((n) => !has(n)).map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
              <Button type="submit" size="sm" variant="secondary" isDisabled={!draft.trim() || has(draft)}>
                {t("computer.add")}
              </Button>
            </form>
          </>
        )}
      </Rows>
      {error && <p className="text-sm text-danger">{error}</p>}
    </section>
  )
}
