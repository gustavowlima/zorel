// Settings (prototype "Settings"): sections on the left, one at a time on the right. Providers (subscription
// sign-ins and API keys, providers.tsx), MCP servers, skills, storage (storage.tsx), the audit log
// (audit.tsx), what runs in the background (processes.tsx), General (the theme and the preferences to come).
import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import { t } from "@zorel/i18n"
import { MAX_RUNNING_CHOICES, MAX_RUNNING_DEFAULT, type MemoryApproval } from "@zorel/contracts"
import { type ReactNode, useEffect, useState } from "react"
import { mutations, preferencesAtom, useMutation } from "../client.ts"
import { go, liveStepsOpen, SETTINGS_TABS, type SettingsTab, setLiveStepsOpen, setThemePref, themePref, type ThemePref } from "../state.ts"
import { AuditSection } from "./audit.tsx"
import { ChannelsSection } from "./channels.tsx"
import { NotifySetting, SoundSetting } from "./notify.tsx"
import { McpSection } from "./mcp.tsx"
import { ModelPicker } from "./model-picker.tsx"
import { ProvidersSection } from "./providers.tsx"
import { ProcessesSection } from "./processes.tsx"
import { StorageSection } from "./storage.tsx"
import { Activity, Button, HardDrive, History, MessageCircle, NavItem, Plug, Rows, Screen, Section, Segmented, Select, SettingRow, Settings, Sparkles, Switch } from "@/ui"

const ICONS: Record<SettingsTab, ReactNode> = { general: <Settings />, providers: <Sparkles />, mcp: <Plug />, channels: <MessageCircle />, processes: <Activity />, storage: <HardDrive />, audit: <History /> }

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
      <div className="relative min-w-0 flex-1 overflow-y-auto">
        {/* One column for every page: it fills the space up to a reading width, then stays centered. */}
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-8 py-7">
          {tab === "providers" && <ProvidersSection provider={provider} />}
          {tab === "processes" && <ProcessesSection />}
          {tab === "storage" && <StorageSection />}
          {tab === "audit" && <AuditSection />}
          {tab === "mcp" && <McpSection projectId={null} />}
          {tab === "channels" && <ChannelsSection />}
          {tab === "general" && <General />}
        </div>
      </div>
    </Screen>
  )
}

// ---------- memory ----------

// The model that learns from chats (automatic: each chat's provider's small model) and what a new fact becomes.
function MemorySettings() {
  const prefs = AsyncResult.getOrElse(useAtomValue(preferencesAtom), () => undefined)
  const setMemory = useMutation(mutations.memoryModel)
  const setRouter = useMutation(mutations.routerModel)
  const setApproval = useMutation(mutations.memoryApproval)
  return (
    <Section title={t("settings.modelsTitle")} description={<span className="block max-w-prose">{t("settings.memoryHint")}</span>}>
      <Rows>
        <BackgroundModel
          title={t("settings.memoryModel")}
          model={prefs?.memoryModel ?? ""}
          auto={t("settings.memoryModelAuto")}
          chosen={t("settings.memoryModelChosen")}
          onChange={(model) => void setMemory({ payload: { model }, reactivityKeys: ["preferences"] })}
        />
        <BackgroundModel
          title={t("settings.routerModel")}
          model={prefs?.routerModel ?? ""}
          auto={t("settings.routerModelAuto")}
          chosen={t("settings.routerModelChosen")}
          onChange={(model) => void setRouter({ payload: { model }, reactivityKeys: ["preferences"] })}
        />
        <SettingRow title={t("memory.approval")} hint={t("memory.approvalHint")}>
          <Select
            size="sm"
            aria-label={t("memory.approval")}
            value={prefs?.memoryApproval ?? "review"}
            onChange={(v) => void setApproval({ payload: { approval: v as MemoryApproval }, reactivityKeys: ["preferences"] })}
            options={[
              { value: "review", label: t("memory.approvalReview") },
              { value: "undo", label: t("memory.approvalUndo") }
            ]}
          />
        </SettingRow>
      </Rows>
    </Section>
  )
}

// A model that works in the background: automatic (each chat's provider's small model) or one chosen for all chats.
function BackgroundModel({ title, model, auto, chosen, onChange }: { title: string; model: string; auto: string; chosen: string; onChange: (model: string) => void }) {
  return (
    <SettingRow title={title} hint={model ? chosen : auto}>
      <div className="flex items-center gap-2">
        {model ? (
          <>
            <ModelPicker variant="field" value={{ model, accountId: null, effort: null }} onChange={(v) => onChange(v.model)} />
            <Button size="sm" variant="ghost" onPress={() => onChange("")}>
              {t("settings.memoryModelUseAuto")}
            </Button>
          </>
        ) : (
          <Button size="sm" variant="secondary" aria-label={`${t("settings.memoryModelChoose")}: ${title}`} onPress={() => onChange("claude-cli/haiku")}>
            {t("settings.memoryModelChoose")}
          </Button>
        )}
      </div>
    </SettingRow>
  )
}

// ---------- general ----------

// Desktop only: open Zorel when you log in, without a window, so routines run after a restart.
type LoginItem = { get: () => Promise<boolean>; set: (on: boolean) => Promise<boolean> }
const loginItem = (window as { zorelDesktop?: { openAtLogin?: LoginItem } }).zorelDesktop?.openAtLogin
const keepAwake = (window as { zorelDesktop?: { keepAwake?: LoginItem } }).zorelDesktop?.keepAwake
// A desktop switch kept by the main process: its value, then what the main process confirms.
function DesktopSwitch({ item, title, hint }: { item: LoginItem; title: string; hint: string }) {
  const [on, setOn] = useState<boolean>()
  useEffect(() => {
    void item.get().then(setOn)
  }, [item])
  return (
    <SettingRow title={title} hint={hint}>
      <Switch aria-label={title} isSelected={!!on} isDisabled={on === undefined} onChange={(v) => void item.set(v).then(setOn)} />
    </SettingRow>
  )
}
function StartupSetting() {
  if (!loginItem) return null
  return (
    <Section title={t("appearance.startup")}>
      <Rows>
        <DesktopSwitch item={loginItem} title={t("appearance.openAtLogin")} hint={t("appearance.openAtLoginHint")} />
        {keepAwake && <DesktopSwitch item={keepAwake} title={t("appearance.keepAwake")} hint={t("appearance.keepAwakeHint")} />}
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
        <SettingRow title={<span className="tabular-nums">{t("appearance.version", { version: __ZOREL_VERSION__ })}</span>} hint={check ? t(CHECK_TEXT[check]) : t("appearance.versionHint")}>
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
        </SettingRow>
      </Rows>
    </Section>
  )
}

// How many chats may have an agent working at once (the server's limit): over it a chat waits for a free slot. Each
// agent is a CLI process and spends from the subscription, so a few at a time keeps the limits and the computer in check.
function AgentsSetting() {
  const prefs = AsyncResult.getOrElse(useAtomValue(preferencesAtom), () => undefined)
  const set = useMutation(mutations.maxRunning)
  return (
    <Section title={t("agentsLimit.title")}>
      <Rows>
        <SettingRow title={t("agentsLimit.atOnce")} hint={t("agentsLimit.atOnceHint")}>
          <Select
            size="sm"
            className="w-36"
            aria-label={t("agentsLimit.atOnce")}
            value={String(prefs?.maxRunning ?? MAX_RUNNING_DEFAULT)}
            onChange={(v) => void set({ payload: { value: Number(v) }, reactivityKeys: ["preferences"] })}
            options={MAX_RUNNING_CHOICES.map((n) => ({ value: String(n), label: n === 0 ? t("agentsLimit.noLimit") : String(n) }))}
          />
        </SettingRow>
      </Rows>
    </Section>
  )
}

// Preferences of this computer, one section per topic: Appearance (the theme), then Notifications.

function General() {
  const [pref, setPref] = useState<ThemePref>(themePref)
  const [stepsOpen, setStepsOpen] = useState(liveStepsOpen)
  return (
    <>
    <Section title={t("appearance.title")}>
      <Rows>
        <SettingRow title={t("appearance.theme")} hint={t("appearance.themeHint")}>
          <Segmented
            label={t("appearance.theme")}
            value={pref}
            onChange={(v) => {
              setPref(v)
              setThemePref(v)
            }}
            options={(["system", "dark", "light"] as const).map((p) => ({ id: p, label: t(`appearance.${p}`) }))}
          />
        </SettingRow>
        <SettingRow title={t("appearance.liveSteps")} hint={t("appearance.liveStepsHint")}>
          <Switch
            aria-label={t("appearance.liveSteps")}
            isSelected={stepsOpen}
            onChange={(v) => {
              setStepsOpen(v)
              setLiveStepsOpen(v)
            }}
          />
        </SettingRow>
      </Rows>
    </Section>
    <MemorySettings />
    <Section title={t("appearance.notifications")}>
      <Rows>
        <NotifySetting />
        <SoundSetting />
      </Rows>
    </Section>
    <AgentsSetting />
    <StartupSetting />
    <AboutSetting />
    </>
  )
}
