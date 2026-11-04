// What an agent may reach, as plain choices (as in Tucano: "give tools, not keys"): one row per power, an icon,
// what it means in a sentence, and a selector — files and commands (read / read and write / everything), the web
// (no access / read), its own browser (no access / use it), and each connector (no access / read / read and
// write). Under them, the actions allowed for good from an approval card, each removable. Destructive actions
// always ask (server rule). Used by the agent page and by Build with AI.
import type { Access, AgentPermissions, Grant, McpServer } from "@zero/contracts"
import { t } from "@zero/i18n"
import type { ReactNode } from "react"
import { cx, Globe, IconButton, MousePointerClick, Plug, Segmented, SquareTerminal, X } from "@/ui"

// A server the agent was given nothing for follows the server's own mode (as on the server).
export const grantOf = (p: AgentPermissions, s: McpServer): Grant => p.grants[s.id] ?? (s.mode === "read" ? "read" : "write")

// Files and commands, in the words of the other rows: ask = reads, edits wait; workspace = reads and writes in its
// folder; full = everything, without asking.
const FILES: ReadonlyArray<{ id: Access; key: "read" | "write" | "full" }> = [
  { id: "ask", key: "read" },
  { id: "workspace", key: "write" },
  { id: "full", key: "full" }
]

export function PermissionsEditor({
  access,
  onAccess,
  value,
  onChange,
  servers,
  showAlways = true
}: {
  access: Access
  onAccess: (a: Access) => void
  value: AgentPermissions
  onChange: (p: AgentPermissions) => void
  servers: ReadonlyArray<McpServer>
  showAlways?: boolean
}) {
  const alwaysLabel = (key: string) => {
    if (key === "browser") return t("agent.perm.alwaysBrowser")
    const at = key.indexOf(":")
    return `${servers.find((s) => s.id === key.slice(0, at))?.name ?? key.slice(0, at)} · ${key.slice(at + 1)}`
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col divide-y divide-subtle border-y border-subtle">
        <Power
          icon={<SquareTerminal />}
          title={t("agent.perm.files")}
          hint={t(`agent.perm.filesHint.${FILES.find((f) => f.id === access)!.key}`)}
          warning={access === "full"}
          control={<Segmented label={t("agent.perm.files")} value={access} onChange={onAccess} options={FILES.map((f) => ({ id: f.id, label: t(`agent.perm.level.${f.key}`) }))} />}
        />
        <Power
          icon={<Globe />}
          title={t("agent.perm.web")}
          hint={t("agent.perm.webHint")}
          control={
            <Segmented
              label={t("agent.perm.web")}
              value={value.web ? "read" : "none"}
              onChange={(v) => onChange({ ...value, web: v === "read" })}
              options={[
                { id: "none", label: t("agent.perm.level.none") },
                { id: "read", label: t("agent.perm.level.read") }
              ]}
            />
          }
        />
        <Power
          icon={<MousePointerClick />}
          title={t("agent.perm.browser")}
          hint={t("agent.perm.browserHint")}
          control={
            <Segmented
              label={t("agent.perm.browser")}
              value={value.browser ? "use" : "none"}
              onChange={(v) => onChange({ ...value, browser: v === "use" })}
              options={[
                { id: "none", label: t("agent.perm.level.none") },
                { id: "use", label: t("agent.perm.level.use") }
              ]}
            />
          }
        />
        {servers.map((s) => (
          <Power
            key={s.id}
            icon={<Plug />}
            title={s.name}
            hint={s.enabled ? t("agent.perm.connectorHint") : t("agent.perm.off")}
            control={
              <Segmented
                label={s.name}
                value={grantOf(value, s)}
                onChange={(g) => onChange({ ...value, grants: { ...value.grants, [s.id]: g } })}
                options={(["none", "read", "write"] as const).map((g) => ({ id: g, label: t(`agent.perm.level.${g}`) }))}
              />
            }
          />
        ))}
      </div>
      {servers.length === 0 && <p className="text-sm text-muted">{t("agent.perm.noConnectors")}</p>}
      {showAlways && value.always.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-muted">{t("agent.perm.always")}</h3>
          <div className="flex flex-wrap gap-1.5">
            {value.always.map((key) => (
              <span key={key} className="flex h-control-sm items-center gap-1 rounded-full border border-subtle bg-surface pr-0.5 pl-3 text-sm">
                <span className="max-w-64 truncate">{alwaysLabel(key)}</span>
                <IconButton label={t("agent.perm.removeAlways", { name: alwaysLabel(key) })} size="xs" shape="pill" onPress={() => onChange({ ...value, always: value.always.filter((k) => k !== key) })}>
                  <X className="size-3" />
                </IconButton>
              </span>
            ))}
          </div>
        </section>
      )}
      <p className="text-sm text-dim">{t("agent.perm.guard")}</p>
    </div>
  )
}

function Power({ icon, title, hint, warning, control }: { icon: ReactNode; title: string; hint: string; warning?: boolean; control: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-card bg-surface text-secondary [&_svg]:size-4.5">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-medium">{title}</span>
        <span className={cx("text-sm", warning ? "text-warning" : "text-muted")}>{hint}</span>
      </span>
      {control}
    </div>
  )
}
