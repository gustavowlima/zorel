// Settings (prototype "Settings"): sections on the left, one at a time on the right. Providers (subscription
// sign-ins and API keys, providers.tsx), MCP servers, skills, the audit log (audit.tsx), appearance.
import { formatAge, t } from "@zero/i18n"
import { type ReactNode, useState } from "react"
import { agentsAtom, memoriesAtom, mutations, projectsAtom, useList, useMutation } from "../client.ts"
import { scopeLabel } from "../labels.ts"
import { go, SETTINGS_TABS, type SettingsTab, setThemePref, themePref, type ThemePref } from "../state.ts"
import { AuditSection } from "./audit.tsx"
import { McpSection } from "./mcp.tsx"
import { ProvidersSection } from "./providers.tsx"
import { BookOpen, Button, Field, NavItem, History, Palette, Plug, Plus, Screen, Section, Select, Sparkles, Switch } from "@/ui"

const ICONS: Record<SettingsTab, ReactNode> = { providers: <Sparkles />, mcp: <Plug />, skills: <BookOpen />, audit: <History />, appearance: <Palette /> }

export function SettingsView({ tab, provider }: { tab: SettingsTab; provider?: string | undefined }) {
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
          {tab === "providers" && <ProvidersSection provider={provider} />}
          {tab === "audit" && <AuditSection />}
          {tab === "mcp" && <McpSection projectId={null} />}
          {tab === "skills" && <Skills />}
          {tab === "appearance" && <Appearance />}
        </div>
      </div>
    </Screen>
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
