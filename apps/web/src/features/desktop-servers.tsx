// Settings › General › Servers (desktop app only, window.zorelDesktop.servers): this computer and the team servers the
// app opens, each in a window of its own. From this computer's window you connect by pasting a server's address or
// an invite link, and forget one; a team server's window can only switch.
import { t } from "@zorel/i18n"
import { useEffect, useState } from "react"
import { Button, Input, Rows, Section, SettingRow, Tag, Trash2 } from "@/ui"

export type ServerState = { state: "online" | "offline"; seenAt: number | null }
type Servers = {
  list: () => Promise<{ servers: Array<{ origin: string; name: string }>; current: string }>
  open: (target: string) => Promise<boolean>
  check?: () => Promise<Record<string, ServerState>> // spec 017: whether each answers now
  add?: (link: string) => Promise<boolean>
  forget?: (origin: string) => Promise<boolean>
}
// The desktop app's bridge (absent in a browser).
export const serversBridge = (window as { zorelDesktop?: { servers?: Servers } }).zorelDesktop?.servers
const bridge = serversBridge
export const LOCAL = "local"

export function ServersSetting() {
  const [state, setState] = useState<Awaited<ReturnType<Servers["list"]>>>()
  const [link, setLink] = useState("")
  const [error, setError] = useState(false)
  const load = () => void bridge?.list().then(setState)
  useEffect(load, [])
  if (!bridge || !state) return null
  const row = (target: string, title: string, hint: string, removable: boolean) => (
    <SettingRow key={target} title={title} hint={hint}>
      {state.current === target ? (
        <Tag>{t("servers.here")}</Tag>
      ) : (
        <Button size="sm" variant="secondary" onPress={() => void bridge.open(target)}>
          {t("servers.open")}
        </Button>
      )}
      {removable && bridge.forget && (
        <Button size="sm" variant="ghost" aria-label={t("servers.forget")} onPress={() => void bridge.forget?.(target).then(load)}>
          <Trash2 />
        </Button>
      )}
    </SettingRow>
  )
  return (
    <Section title={t("servers.title")} description={t("servers.hint")}>
      <Rows>
        {row(LOCAL, t("servers.thisComputer"), t("servers.thisComputerHint"), false)}
        {state.servers.map((s) => row(s.origin, s.name, s.origin, true))}
      </Rows>
      {bridge.add && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void bridge.add?.(link).then((ok) => {
              setError(!ok)
              if (ok) setLink("")
              load()
            })
          }}
        >
          <Input className="min-w-64 flex-1" value={link} onChange={(e) => setLink(e.target.value)} placeholder={t("servers.placeholder")} aria-label={t("servers.placeholder")} />
          <Button type="submit" isDisabled={!link.trim()}>
            {t("servers.connect")}
          </Button>
        </form>
      )}
      {error && <p className="text-sm text-danger">{t("servers.invalid")}</p>}
    </Section>
  )
}
