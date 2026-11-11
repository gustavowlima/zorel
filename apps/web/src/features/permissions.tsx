// What an agent may reach, as plain choices in two parts. Access: files and commands (read / read and write /
// everything), the web (no access / read), its own browser, its own computer. Tools: each connector (no access /
// read / read and write; a new one starts read-only) and the computer's apps. Under them, the actions allowed for
// good from an approval card, each removable. Destructive actions always ask (server rule). Used by the agent page
// and by Build with AI.
import type { Access, AgentPermissions, Grant, McpServer } from "@zorel/contracts"
import { t } from "@zorel/i18n"
import type { ReactNode } from "react"
import { ComputerApps } from "./computer-apps.tsx"
import { OwnComputer } from "./own-computer.tsx"
import { Globe, IconButton, MousePointerClick, Plug, Rows, Segmented, SettingRow, SquareTerminal, X } from "@/ui"

// A connector the agent was given nothing for (a new one) is read-only, and a server in read mode caps it at
// reading (as on the server).
const grantOf = (p: AgentPermissions, s: McpServer): Grant => {
  const given = p.grants[s.id] ?? "read"
  return s.mode === "read" && given === "write" ? "read" : given
}

// Files and commands, in the words of the other rows: ask = reads, edits wait; workspace = reads and writes in its
// folder; full = everything, without asking.
const FILES: ReadonlyArray<{ id: Access; key: "read" | "write" | "full" }> = [
  { id: "ask", key: "read" },
  { id: "workspace", key: "write" },
  { id: "full", key: "full" }
]

// What an agent's permissions reach, counted once for every summary of them (the Builder's cards and profile).
export function summarizePowers(p: AgentPermissions) {
  const connectors = Object.values(p.grants).filter((g) => g !== "none").length
  return { web: p.web, browser: p.browser, connectors, count: Number(p.web) + Number(p.browser) + connectors }
}

export function PermissionsEditor({
  access,
  onAccess,
  value,
  onChange,
  servers,
  showAlways = true,
  agentId
}: {
  access: Access
  onAccess: (a: Access) => void
  value: AgentPermissions
  onChange: (p: AgentPermissions) => void
  servers: ReadonlyArray<McpServer>
  showAlways?: boolean
  agentId?: string | undefined // a saved agent: its computer can be erased
}) {
  const alwaysLabel = (key: string) => {
    if (key === "browser") return t("agent.perm.alwaysBrowser")
    const at = key.indexOf(":")
    return `${servers.find((s) => s.id === key.slice(0, at))?.name ?? key.slice(0, at)} · ${key.slice(at + 1)}`
  }
  return (
    // A container: in a narrow place (the builder's side panel) each control takes its own line under its text.
    <div className="@container flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted">{t("agent.perm.accessTitle")}</h2>
      <Rows className="rounded-sheet border-transparent">
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
        <OwnComputer value={value.computer ?? "none"} onChange={(computer) => onChange({ ...value, computer })} lent={value.lent ?? []} onLent={(lent) => onChange({ ...value, lent })} agentId={agentId} />
      </Rows>
      </section>
      <section className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium text-muted">{t("agent.perm.toolsTitle")}</h2>
          <p className="max-w-prose text-sm text-dim">{t("agent.perm.toolsHint")}</p>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{t("agent.perm.connectorsTitle")}</h3>
          {servers.length === 0 ? (
            <p className="text-sm text-muted">{t("agent.perm.noConnectors")}</p>
          ) : (
            <Rows className="rounded-sheet border-transparent">
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
                options={(s.mode === "read" ? (["none", "read"] as const) : (["none", "read", "write"] as const)).map((g) => ({ id: g, label: t(`agent.perm.level.${g}`) }))}
              />
            }
          />
        ))}
            </Rows>
          )}
        </div>
        <ComputerApps value={value.apps ?? []} onChange={(apps) => onChange({ ...value, apps })} />
      </section>
      {showAlways && value.always.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted">{t("agent.perm.always")}</h2>
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
    <SettingRow icon={icon} title={title} hint={warning ? <span className="text-warning">{hint}</span> : hint}>
      {control}
    </SettingRow>
  )
}
