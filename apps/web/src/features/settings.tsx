// Settings (prototype "Settings"): sections on the left, one at a time on the right. Providers (subscription
// sign-ins and API keys, providers.tsx), MCP servers, skills, storage (storage.tsx), the audit log
// (audit.tsx), General (the theme and the preferences to come).
import { formatAge, t } from "@zero/i18n"
import { type ReactNode, useState } from "react"
import { agentsAtom, memoriesAtom, mutations, projectsAtom, useInvalidate, useList, useMutation, useReading } from "../client.ts"
import { scopeLabel } from "../labels.ts"
import { go, SETTINGS_TABS, type SettingsTab, setThemePref, themePref, type ThemePref } from "../state.ts"
import { AuditSection } from "./audit.tsx"
import { NotifySetting } from "./notify.tsx"
import { McpSection } from "./mcp.tsx"
import { ProvidersSection } from "./providers.tsx"
import { ReadingState } from "./reading.tsx"
import { StorageSection } from "./storage.tsx"
import { ArrowRight, BookOpen, Button, EmptyState, HardDrive, History, NavItem, Plug, Settings, Rows, Screen, Section, Segmented, Sparkles, Switch } from "@/ui"

const ICONS: Record<SettingsTab, ReactNode> = { general: <Settings />, providers: <Sparkles />, mcp: <Plug />, skills: <BookOpen />, storage: <HardDrive />, audit: <History /> }

export function SettingsView({ tab, provider }: { tab: SettingsTab; provider?: string | undefined }) {
  return (
    <Screen title={t("settings.title")} subtitle={t(`settings.hint.${tab}`)} bodyClassName="flex">
      <nav aria-label={t("settings.sections")} className="flex w-56 shrink-0 flex-col gap-0.5 border-r border-subtle p-3">
        {SETTINGS_TABS.map((s) => (
          // On the canvas the active item needs a fill of its own (bg-canvas, the sidebar's, would vanish here).
          <NavItem key={s} icon={ICONS[s]} active={s === tab} className={s === tab ? "border-transparent bg-control" : ""} onPress={() => go({ view: "settings", tab: s })}>
            {t(`settings.${s}`)}
          </NavItem>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="flex w-full max-w-2xl flex-col gap-8 px-8 py-7">
          {tab === "providers" && <ProvidersSection provider={provider} />}
          {tab === "storage" && <StorageSection />}
          {tab === "audit" && <AuditSection />}
          {tab === "mcp" && <McpSection projectId={null} />}
          {tab === "skills" && <Skills />}
          {tab === "general" && <General />}
        </div>
      </div>
    </Screen>
  )
}

// ---------- skills ----------

function Skills() {
  const reading = useReading(memoriesAtom)
  const skills = reading.items.filter((m) => m.kind === "skill")
  const invalidate = useInvalidate()
  const [failed, setFailed] = useState<string>()
  const projects = useList(projectsAtom)
  const agents = useList(agentsAtom)
  const update = useMutation(mutations.updateMemory)
  return (
    <Section
        title={t("skills.listTitle")}
        description={<span className="block max-w-prose">{t("skills.intro")}</span>}
        action={
          skills.length > 0 && (
            <Button size="sm" variant="secondary" onPress={() => go({ view: "knowledge" })}>
              {t("skills.newInKnowledge")}
              <ArrowRight />
            </Button>
          )
        }
      >
        <ReadingState loading={reading.loading} failed={reading.failed} onRetry={() => invalidate(["memories"])} />
        {failed && <p className="text-sm text-danger">{failed}</p>}
        {!reading.loading && !reading.failed && skills.length === 0 && (
          <EmptyState
            icon={<BookOpen />}
            title={t("skills.empty")}
            hint={t("skills.emptyHint")}
            action={
              <Button size="sm" variant="default" onPress={() => go({ view: "knowledge" })}>
                {t("skills.newInKnowledge")}
              </Button>
            }
          />
        )}
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
                    onChange={(on) => {
                      setFailed(undefined)
                      update({ params: { id: s.id }, payload: { state: on ? "active" : "forgotten" }, reactivityKeys: ["memories"] }).catch(() => setFailed(t("skills.updateFailed", { name: s.title })))
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </Section>
  )
}

// ---------- general ----------

// Preferences of this computer, one section per topic: Appearance (the theme), then Notifications.

function General() {
  const [pref, setPref] = useState<ThemePref>(themePref)
  return (
    <>
    <Section title={t("appearance.title")}>
      <Rows>
        <div className="flex flex-wrap items-center gap-3 py-3.5">
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="font-medium">{t("appearance.theme")}</span>
            <span className="text-sm text-muted">{t("appearance.themeHint")}</span>
          </span>
          <Segmented
            label={t("appearance.theme")}
            value={pref}
            onChange={(v) => {
              setPref(v)
              setThemePref(v)
            }}
            options={(["system", "dark", "light"] as const).map((p) => ({ id: p, label: t(`appearance.${p}`) }))}
          />
        </div>
      </Rows>
    </Section>
    <Section title={t("appearance.notifications")}>
      <Rows>
        <NotifySetting />
      </Rows>
    </Section>
    </>
  )
}
