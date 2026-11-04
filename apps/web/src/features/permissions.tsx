// An agent's Tools and access (ideas from Tucano): what it may do in its folder (access), whether it may use the
// web and its own browser, what it may do with each connector (none / read / read and write), and the actions the
// person allowed for good from an approval card, each removable. Destructive actions always ask (server rule).
import { type Access, type AgentPermissions, type Grant, type McpServer } from "@zero/contracts"
import { t } from "@zero/i18n"
import { ChoiceCards, IconButton, Rows, Section, Segmented, Switch, X } from "@/ui"

const GRANTS: ReadonlyArray<Grant> = ["none", "read", "write"]
// A server the agent was given nothing for follows the server's own mode (as on the server).
export const grantOf = (p: AgentPermissions, s: McpServer): Grant => p.grants[s.id] ?? (s.mode === "read" ? "read" : "write")

export function PermissionsEditor({
  access,
  onAccess,
  value,
  onChange,
  servers
}: {
  access: Access
  onAccess: (a: Access) => void
  value: AgentPermissions
  onChange: (p: AgentPermissions) => void
  servers: ReadonlyArray<McpServer>
}) {
  const alwaysLabel = (key: string) => {
    if (key === "browser") return t("agent.perm.alwaysBrowser")
    const [id, tool] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)]
    return `${servers.find((s) => s.id === id)?.name ?? id} · ${tool}`
  }
  return (
    <div className="flex flex-col gap-8">
      <Section title={t("agent.perm.computer")} description={t("agent.perm.computerHint")}>
        <ChoiceCards
          label={t("access.title")}
          value={access}
          onChange={onAccess}
          options={(["workspace", "ask", "full"] as const).map((a) => ({ value: a, title: t(`access.${a}`), description: t(`access.${a}Hint`) }))}
        />
      </Section>

      <Section title={t("agent.perm.reach")}>
        <Rows>
          <Toggle label={t("agent.perm.web")} hint={t("agent.perm.webHint")} on={value.web} onChange={(web) => onChange({ ...value, web })} />
          <Toggle label={t("agent.perm.browser")} hint={t("agent.perm.browserHint")} on={value.browser} onChange={(browser) => onChange({ ...value, browser })} />
        </Rows>
      </Section>

      <Section title={t("agent.perm.connectors")} description={t("agent.perm.connectorsHint")}>
        {servers.length === 0 ? (
          <p className="text-muted">{t("agent.perm.noConnectors")}</p>
        ) : (
          <Rows>
            {servers.map((s) => (
              <div key={s.id} className="flex min-h-12 items-center gap-3 py-2">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{s.name}</span>
                  {!s.enabled && <span className="text-sm text-muted">{t("agent.perm.off")}</span>}
                </span>
                <Segmented
                  label={s.name}
                  value={grantOf(value, s)}
                  onChange={(g) => onChange({ ...value, grants: { ...value.grants, [s.id]: g } })}
                  options={GRANTS.map((g) => ({ id: g, label: t(`agent.perm.${g}`) }))}
                />
              </div>
            ))}
          </Rows>
        )}
      </Section>

      <Section title={t("agent.perm.always")} description={t("agent.perm.alwaysHint")}>
        {value.always.length === 0 ? (
          <p className="text-sm text-muted">{t("agent.perm.noAlways")}</p>
        ) : (
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
        )}
        <p className="text-sm text-dim">{t("agent.perm.guard")}</p>
      </Section>
    </div>
  )
}

function Toggle({ label, hint, on, onChange }: { label: string; hint: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="flex min-h-14 items-center gap-3 py-2.5">
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span>{label}</span>
        <span className="text-sm text-muted">{hint}</span>
      </span>
      <Switch aria-label={label} isSelected={on} onChange={onChange} />
    </div>
  )
}
