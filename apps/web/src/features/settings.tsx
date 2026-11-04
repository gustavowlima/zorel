// Settings (prototype "Settings"): sections on the left, one at a time on the right. Providers (subscription
// sign-ins and API keys, providers.tsx), MCP servers, skills, storage (storage.tsx), the audit log
// (audit.tsx), what runs in the background (processes.tsx), General (the theme and the preferences to come).
import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import { formatAge, t } from "@zorel/i18n"
import { type ReactNode, useEffect, useState } from "react"
import { agentsAtom, fileSkillsAtom, memoriesAtom, mutations, preferencesAtom, projectsAtom, useInvalidate, useList, useMutation, useReading } from "../client.ts"
import { scopeLabel } from "../labels.ts"
import { go, SETTINGS_TABS, type SettingsTab, setThemePref, themePref, type ThemePref } from "../state.ts"
import { AuditSection } from "./audit.tsx"
import { NotifySetting } from "./notify.tsx"
import { McpSection } from "./mcp.tsx"
import { ProvidersSection } from "./providers.tsx"
import { ReadingState } from "./reading.tsx"
import { ProcessesSection } from "./processes.tsx"
import { StorageSection } from "./storage.tsx"
import { Activity, ArrowRight, BookOpen, Button, EmptyState, FolderOpen, HardDrive, History, Input, NavItem, Plug, Settings, Rows, Screen, Search, Section, Segmented, Sparkles, Switch } from "@/ui"

const ICONS: Record<SettingsTab, ReactNode> = { general: <Settings />, providers: <Sparkles />, mcp: <Plug />, skills: <BookOpen />, processes: <Activity />, storage: <HardDrive />, audit: <History /> }

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
        {/* One column for every page: it fills the space up to a reading width, then stays centered. */}
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-8 py-7">
          {tab === "providers" && <ProvidersSection provider={provider} />}
          {tab === "processes" && <ProcessesSection />}
          {tab === "storage" && <StorageSection />}
          {tab === "audit" && <AuditSection />}
          {tab === "mcp" && <McpSection projectId={null} />}
          {tab === "skills" && (
            <>
              <NativeSkills />
              <Skills />
              <FileSkills />
            </>
          )}
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

// ---------- the harnesses' own skills ----------

// Claude Code and Codex come with skills of their own (the person's ~/.claude/skills, plugins, Codex's). Off by
// default (Zorel gives the context); on, they use them as in their own app. Takes effect in each chat's next session.
function NativeSkills() {
  const prefs = AsyncResult.getOrElse(useAtomValue(preferencesAtom), () => undefined)
  const set = useMutation(mutations.nativeSkills)
  return (
    <Section title={t("skills.nativeTitle")}>
      <Rows>
        <div className="flex items-center gap-3 py-3.5">
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="font-medium">{t("skills.native")}</span>
            <span className="text-sm text-muted">{t("skills.nativeHint")}</span>
          </span>
          <Switch aria-label={t("skills.native")} isSelected={!!prefs?.nativeSkills} isDisabled={!prefs} onChange={(enabled) => void set({ payload: { enabled }, reactivityKeys: ["preferences"] })} />
        </div>
      </Rows>
    </Section>
  )
}

// ---------- skills on this computer ----------

// The SKILL.md files already here (Claude Code, Codex, other agents, plugins): pick which ones Zorel's agents use.
// A picked skill shows in their list of skills and is read from its file when they need it (always current).
const SOURCES = ["claude", "agents", "codex", "plugin"] as const
function FileSkills() {
  const reading = useReading(fileSkillsAtom)
  const pick = useMutation(mutations.pickFileSkill)
  const invalidate = useInvalidate()
  const [query, setQuery] = useState("")
  const [only, setOnly] = useState<"all" | "on">("all")
  const all = reading.items
  const q = query.trim().toLowerCase()
  const shown = all.filter((s) => (only === "all" || s.enabled) && (!q || `${s.name} ${s.description} ${s.plugin ?? ""}`.toLowerCase().includes(q)))
  const inUse = all.filter((s) => s.enabled).length
  return (
    <Section
      title={t("skills.files")}
      description={<span className="block max-w-prose">{t("skills.filesHint")}</span>}
      action={all.length > 0 && <span className="text-sm text-muted tabular-nums">{t("skills.inUse", { count: inUse })}</span>}
    >
      <ReadingState loading={reading.loading} failed={reading.failed} onRetry={() => invalidate(["fileSkills"])} />
      {!reading.loading && !reading.failed && all.length === 0 && <EmptyState icon={<FolderOpen />} title={t("skills.noFiles")} hint={t("skills.noFilesHint")} />}
      {all.length > 0 && (
        <div className="flex items-center gap-2">
          <label className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted" aria-hidden="true" />
            <Input className="h-control-sm pl-8 text-sm" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("skills.search", { count: all.length })} aria-label={t("common.search")} />
          </label>
          <Segmented
            label={t("skills.show")}
            value={only}
            onChange={setOnly}
            options={[
              { id: "all", label: t("skills.showAll") },
              { id: "on", label: t("skills.showInUse") }
            ]}
          />
        </div>
      )}
      {SOURCES.map((src) => {
        const list = shown.filter((s) => s.source === src)
        if (!list.length) return null
        return (
          <div key={src} className="flex flex-col gap-1.5 pt-2">
            <h3 className="text-sm font-medium text-muted">{`${t(`skills.source.${src}`)} · ${list.length}`}</h3>
            <Rows>
              {list.map((s) => (
                <div key={s.path} className="flex items-center gap-3 py-2.5">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium">{s.name}</span>
                      {s.plugin && <span className="shrink-0 text-sm text-muted">{s.plugin}</span>}
                    </span>
                    {s.description && <span className="line-clamp-1 text-sm text-muted">{s.description}</span>}
                  </span>
                  <Switch
                    aria-label={t("skills.use", { name: s.name })}
                    isSelected={s.enabled}
                    onChange={(enabled) => void pick({ payload: { path: s.path, enabled }, reactivityKeys: ["fileSkills"] })}
                  />
                </div>
              ))}
            </Rows>
          </div>
        )
      })}
      {all.length > 0 && shown.length === 0 && <p className="text-sm text-muted">{t("skills.noMatch")}</p>}
    </Section>
  )
}

// ---------- general ----------

// Desktop only: open Zorel when you log in, without a window, so routines run after a restart.
type LoginItem = { get: () => Promise<boolean>; set: (on: boolean) => Promise<boolean> }
const loginItem = (window as { zorelDesktop?: { openAtLogin?: LoginItem } }).zorelDesktop?.openAtLogin
function StartupSetting() {
  const [on, setOn] = useState<boolean>()
  useEffect(() => {
    void loginItem?.get().then(setOn)
  }, [])
  if (!loginItem) return null
  return (
    <Section title={t("appearance.startup")}>
      <Rows>
        <div className="flex items-center gap-3 py-3.5">
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="font-medium">{t("appearance.openAtLogin")}</span>
            <span className="text-sm text-muted">{t("appearance.openAtLoginHint")}</span>
          </span>
          <Switch aria-label={t("appearance.openAtLogin")} isSelected={!!on} isDisabled={on === undefined} onChange={(v) => void loginItem.set(v).then(setOn)} />
        </div>
      </Rows>
    </Section>
  )
}

// The app's version and, in the desktop app, a check for a new one right now.
type Check = "checking" | "latest" | "available" | "failed" | "unsupported"
const updates = (window as { zorelDesktop?: { update?: { check: () => Promise<Exclude<Check, "checking">> } } }).zorelDesktop?.update
const CHECK_TEXT = { checking: "appearance.checking", latest: "appearance.upToDate", available: "appearance.updateFound", failed: "appearance.checkFailed", unsupported: "appearance.checkUnsupported" } as const
function AboutSetting() {
  const [check, setCheck] = useState<Check>()
  return (
    <Section title={t("appearance.about")}>
      <Rows>
        <div className="flex flex-wrap items-center gap-3 py-3.5">
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="font-medium tabular-nums">{t("appearance.version", { version: __ZOREL_VERSION__ })}</span>
            <span className="text-sm text-muted">{check ? t(CHECK_TEXT[check]) : t("appearance.versionHint")}</span>
          </span>
          {updates && (
            <Button
              size="sm"
              variant="secondary"
              isDisabled={check === "checking"}
              onPress={() => {
                setCheck("checking")
                void updates.check().then(setCheck, () => setCheck("failed"))
              }}
            >
              {t("appearance.checkUpdates")}
            </Button>
          )}
        </div>
      </Rows>
    </Section>
  )
}

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
    <StartupSetting />
    <AboutSetting />
    </>
  )
}
