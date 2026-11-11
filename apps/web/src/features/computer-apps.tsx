// Computer apps (spec 008): the apps on the person's computer an agent may use, each read only or read and use,
// through agent-desktop, which the person installs here (downloaded from its release and checked, no Node.js).
// The chosen apps are rows; "Add apps" opens the apps installed on this computer (the open ones marked), with a
// search, and a name typed that isn't listed can be added as it is. On macOS it needs the Accessibility permission.
import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import type { DesktopApp, InstalledApp } from "@zorel/contracts"
import { t } from "@zorel/i18n"
import { useEffect, useState } from "react"
import { desktopAtom, desktopRunningAtom, installedAppsAtom, mutations, useMutation } from "../client.ts"
import { AppWindow, Button, Check, IconButton, Plus, Popover, Rows, SearchInput, Segmented, SettingRow, Tag, X } from "@/ui"

// The apps' own icons (name → image), drawn by the desktop app from each app's path; none outside it (a plain icon).
const bridge = (window as { zorelDesktop?: { appIcons?: (paths: ReadonlyArray<string>) => Promise<Record<string, string>> } }).zorelDesktop
function useAppIcons() {
  const installed = AsyncResult.getOrElse(useAtomValue(installedAppsAtom), () => [] as ReadonlyArray<InstalledApp>)
  const [byPath, setByPath] = useState<Record<string, string>>({})
  useEffect(() => {
    const paths = installed.flatMap((a) => a.path ?? [])
    if (!bridge?.appIcons || !paths.length) return
    let live = true
    void bridge.appIcons(paths).then((icons) => live && setByPath(icons), () => undefined)
    return () => {
      live = false
    }
  }, [installed])
  const icon = (name: string) => {
    const path = installed.find((a) => a.name.toLowerCase() === name.toLowerCase())?.path
    return path ? byPath[path] : undefined
  }
  return { installed, icon }
}
const AppIcon = ({ src }: { src: string | undefined }) => (src ? <img src={src} alt="" className="size-5 shrink-0 rounded-sm object-contain" /> : <AppWindow className="size-4 shrink-0 text-muted" />)

export function ComputerApps({ value, onChange }: { value: ReadonlyArray<DesktopApp>; onChange: (apps: ReadonlyArray<DesktopApp>) => void }) {
  const status = AsyncResult.getOrElse(useAtomValue(desktopAtom), () => undefined)
  const install = useMutation(mutations.installDesktop)
  const guide = useMutation(mutations.desktopGuide)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const icons = useAppIcons()
  if (!status) return null
  const has = (name: string) => value.some((a) => a.name.toLowerCase() === name.trim().toLowerCase())
  const toggle = (name: string) => onChange(has(name) ? value.filter((a) => a.name.toLowerCase() !== name.toLowerCase()) : [...value, { name, level: "read" }])
  const doInstall = () => {
    setBusy(true)
    setError(undefined)
    void install({ reactivityKeys: ["desktop"] }).then(
      () => setBusy(false),
      // The server says why (a checksum, the system, a busy file); otherwise, the general reason.
      (e: { message?: unknown }) => {
        setBusy(false)
        setError(typeof e?.message === "string" && e.message ? e.message : t("computer.installFailed"))
      }
    )
  }
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{t("computer.title")}</h3>
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
            {/* Anything short of granted (denied, not asked yet, unknown) means clicks won't go through: say so. */}
            {status.accessibility !== null && status.accessibility !== "granted" && (
              <SettingRow icon={<AppWindow />} title={<span className="text-warning">{t("computer.noPermission")}</span>} hint={status.suggestion ?? undefined}>
                <Button size="sm" variant="secondary" onPress={() => void guide({ reactivityKeys: [] })}>
                  {t("computer.guide")}
                </Button>
              </SettingRow>
            )}
            {value.map((a) => (
              <SettingRow key={a.name} icon={<AppIcon src={icons.icon(a.name)} />} title={a.name}>
                <Segmented
                  label={a.name}
                  value={a.level}
                  onChange={(level) => onChange(value.map((x) => (x.name === a.name ? { ...x, level } : x)))}
                  options={[
                    { id: "read", label: t("computer.read") },
                    { id: "use", label: t("computer.use") }
                  ]}
                />
                <IconButton label={t("computer.remove", { name: a.name })} size="sm" onPress={() => toggle(a.name)}>
                  <X className="size-4" />
                </IconButton>
              </SettingRow>
            ))}
            <div className="flex items-center gap-3 py-3">
              <span className="flex-1 text-sm text-muted">{value.length ? t("computer.chosen", { count: value.length }) : t("computer.none")}</span>
              <AppPicker has={has} onToggle={toggle} installed={icons.installed} icon={icons.icon} />
            </div>
          </>
        )}
      </Rows>
      {error && <p className="text-sm text-danger">{error}</p>}
    </section>
  )
}

// The apps installed here, the open ones first and marked, with a search; pressing one adds or removes it. A name
// typed that isn't listed (an app in another folder) can be added as it is.
function AppPicker({ has, onToggle, installed: apps, icon }: { has: (name: string) => boolean; onToggle: (name: string) => void; installed: ReadonlyArray<InstalledApp>; icon: (name: string) => string | undefined }) {
  const installed = apps.map((a) => a.name)
  const running = AsyncResult.getOrElse(useAtomValue(desktopRunningAtom), () => [] as ReadonlyArray<string>)
  const [query, setQuery] = useState("")
  const q = query.trim().toLowerCase()
  const open = new Set(running.map((n) => n.toLowerCase()))
  const all = [...new Map([...running, ...installed].map((n) => [n.toLowerCase(), n])).values()].sort((a, b) => Number(open.has(b.toLowerCase())) - Number(open.has(a.toLowerCase())) || a.localeCompare(b))
  const shown = q ? all.filter((n) => n.toLowerCase().includes(q)) : all
  const typed = query.trim()
  const unlisted = typed && !all.some((n) => n.toLowerCase() === typed.toLowerCase())
  return (
    <Popover
      label={t("computer.add")}
      placement="bottom end"
      className="w-80"
      trigger={
        <Button size="sm" variant="secondary">
          <Plus />
          {t("computer.add")}
        </Button>
      }
    >
      <div className="flex min-h-0 flex-col gap-1 p-2">
        <SearchInput size="sm" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("computer.search")} aria-label={t("computer.search")} className="mb-1" />
        <div className="scroll-quiet flex max-h-72 min-h-0 flex-col gap-0.5 overflow-y-auto">
          {shown.map((name) => (
            <Button key={name} variant="ghost" className="h-auto justify-start gap-2.5 px-2 py-1.5 text-left font-normal text-fg" onPress={() => onToggle(name)}>
              <AppIcon src={icon(name)} />
              <span className="min-w-0 flex-1 truncate">{name}</span>
              {open.has(name.toLowerCase()) && <Tag>{t("computer.open")}</Tag>}
              {has(name) ? <Check className="size-4 text-accent-text" /> : <Plus className="size-4 text-dim" />}
            </Button>
          ))}
          {unlisted && (
            <Button variant="ghost" className="h-auto justify-start gap-2.5 px-2 py-1.5 text-left font-normal" onPress={() => onToggle(typed)}>
              <Plus className="size-4 text-muted" />
              <span className="min-w-0 flex-1 truncate">{t("computer.addTyped", { name: typed })}</span>
            </Button>
          )}
          {!shown.length && !unlisted && <p className="px-2 py-1.5 text-sm text-muted">{t("computer.noApps")}</p>}
        </div>
      </div>
    </Popover>
  )
}
