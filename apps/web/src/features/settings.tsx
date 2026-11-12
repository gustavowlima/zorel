// Settings (prototype "Settings"): sections on the left, one at a time on the right. Providers (subscription
// sign-ins and API keys, providers.tsx), MCP servers, skills, storage (storage.tsx), the audit log
// (audit.tsx), what runs in the background (processes.tsx), General (the theme and the preferences to come).
import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import { type LanguagePref, languagePref, setLanguagePref, t } from "@zorel/i18n"
import { MAX_RUNNING_CHOICES, MAX_RUNNING_DEFAULT, type MemoryApproval } from "@zorel/contracts"
import { type ReactNode, useEffect, useId, useState } from "react"
import { mutations, preferencesAtom, useMutation } from "../client.ts"
import { useServer } from "./sign-in.tsx"
import { TeamSection } from "./team.tsx"
import { ServersSetting } from "./desktop-servers.tsx"
import { accentPref, go, liveStepsOpen, SETTINGS_TABS, type SettingsTab, setAccentPref, setLiveStepsOpen, setThemePref, themePref, type ThemePref } from "../state.ts"
import { AuditSection } from "./audit.tsx"
import { SkillsBody } from "./skills.tsx"
import { ChannelsSection } from "./channels.tsx"
import { NotifySetting, SoundSetting } from "./notify.tsx"
import { YourDaySetting } from "./your-day.tsx"
import { McpSection } from "./mcp.tsx"
import { ModelPicker } from "./model-picker.tsx"
import { ProvidersSection } from "./providers.tsx"
import { ProcessesSection } from "./processes.tsx"
import { StorageSection } from "./storage.tsx"
import { Activity, Button, ColorField, Column, cn, DisclosurePill, Fold, HardDrive, History, Layers, MessageCircle, NavItem, Plug, Rows, Screen, Section, Segmented, Select, SettingRow, Settings, Sparkles, Switch, SETTLE, Users } from "@/ui"

const ICONS: Record<SettingsTab, ReactNode> = { general: <Settings />, team: <Users />, providers: <Sparkles />, mcp: <Plug />, skills: <Layers />, channels: <MessageCircle />, processes: <Activity />, storage: <HardDrive />, audit: <History /> }

// skill: Skills is a section here (2026-11-09); its own links (#/skills/<id>, #/skills/file/<path>) open it with these.
export function SettingsView({ tab, provider, skill }: { tab: SettingsTab; provider?: string | undefined; skill?: { selected?: string | undefined; file?: string | undefined } }) {
  const server = useServer() // Team only on a team server
  return (
    <Screen title={t("settings.title")} subtitle={t(`settings.hint.${tab}`)} bodyClassName="flex flex-col md:flex-row">
      {/* A column of sections beside the page; in a narrow window, a row above it that scrolls sideways. */}
      <nav aria-label={t("settings.sections")} className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-subtle p-2 md:w-56 md:flex-col md:overflow-x-visible md:border-r md:border-b-0 md:p-3">
        {SETTINGS_TABS.filter((s) => s !== "team" || server).map((s) => (
          // On the canvas the active item needs a fill of its own (bg-canvas, the sidebar's, would vanish here).
          <NavItem key={s} icon={ICONS[s]} active={s === tab} className={cn("w-auto shrink-0 md:w-full", s === tab && "border-transparent bg-control")} onPress={() => go({ view: "settings", tab: s })}>
            {t(`settings.${s}`)}
          </NavItem>
        ))}
      </nav>
      {/* Skills has a list and a reader side by side: the whole width, scrolling inside. */}
      {tab === "skills" ? (
        <SkillsBody selected={skill?.selected} file={skill?.file} />
      ) : (
      <div className="gutter-stable relative min-w-0 flex-1 overflow-y-auto">
        {/* One column for every page: it fills the space up to the wide width, then stays centered. */}
        <Column wide key={tab} className={SETTLE}>
          {tab === "providers" && <ProvidersSection provider={provider} />}
          {tab === "processes" && <ProcessesSection />}
          {tab === "storage" && <StorageSection />}
          {tab === "audit" && <AuditSection />}
          {tab === "mcp" && <McpSection projectId={null} />}
          {tab === "channels" && <ChannelsSection />}
          {tab === "general" && <General />}
          {tab === "team" && server && <TeamSection />}
        </Column>
      </div>
      )}
    </Screen>
  )
}

// ---------- memory ----------

// The model that learns from chats (automatic: each chat's provider's small model) and what a new fact becomes.
function MemorySettings() {
  const prefs = AsyncResult.getOrElse(useAtomValue(preferencesAtom), () => undefined)
  const setMemory = useMutation(mutations.memoryModel)
  const setApproval = useMutation(mutations.memoryApproval)
  // The memory model stays automatic for nearly everyone: tucked under Advanced, open when one was chosen.
  const [advanced, setAdvanced] = useState(false)
  const advancedId = useId()
  const showModel = advanced || !!prefs?.memoryModel
  return (
    <Section title={t("settings.modelsTitle")} description={<span className="block max-w-prose">{t("settings.memoryHint")}</span>}>
      <Rows>
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
        <Fold open={showModel}>
          <div id={advancedId}>
            <BackgroundModel
              title={t("settings.memoryModel")}
              model={prefs?.memoryModel ?? ""}
              auto={t("settings.memoryModelAuto")}
              chosen={t("settings.memoryModelChosen")}
              onChange={(model) => void setMemory({ payload: { model }, reactivityKeys: ["preferences"] })}
            />
          </div>
        </Fold>
      </Rows>
      {!prefs?.memoryModel && (
        <div>
          <DisclosurePill expanded={advanced} onToggle={() => setAdvanced(!advanced)} controls={advancedId}>
            {t("settings.advanced")}
          </DisclosurePill>
        </div>
      )}
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

// How many agents may work at once, across chats (the server's limit): over it an agent waits for a free place. Each
// agent is a CLI process and spends from the subscription, so a few at a time keeps the limits and the computer in check.
// And how many of one chat's agents may work together (spec 016): no limit by default.
const PER_CHAT_CHOICES = [0, 1, 2, 3, 4, 6, 8] as const
function AgentsSetting() {
  const prefs = AsyncResult.getOrElse(useAtomValue(preferencesAtom), () => undefined)
  const set = useMutation(mutations.maxRunning)
  const setPerChat = useMutation(mutations.maxPerChat)
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
        <SettingRow title={t("agentsLimit.perChat")} hint={t("agentsLimit.perChatHint")}>
          <Select
            size="sm"
            className="w-36"
            aria-label={t("agentsLimit.perChat")}
            value={String(prefs?.maxPerChat ?? 0)}
            onChange={(v) => void setPerChat({ payload: { value: Number(v) }, reactivityKeys: ["preferences"] })}
            options={PER_CHAT_CHOICES.map((n) => ({ value: String(n), label: n === 0 ? t("agentsLimit.noLimit") : String(n) }))}
          />
        </SettingRow>
      </Rows>
    </Section>
  )
}

// The action colour (spec 018): the system colour picker; a colour white can't be read on is refused with why.
// The theme's own blue, read from the base token (no colour literal in a screen).
const defaultAccent = () => getComputedStyle(document.documentElement).getPropertyValue("--z-base-blue").trim()
function AccentRow() {
  const [accent, setAccent] = useState(accentPref)
  const [refused, setRefused] = useState(false)
  return (
    <SettingRow title={t("appearance.accent")} hint={refused ? <span className="text-warning">{t("appearance.accentContrast")}</span> : t("appearance.accentHint")}>
      <div className="flex items-center gap-2">
        {accent && (
          <Button size="sm" variant="ghost" onPress={() => {
              setAccentPref(null)
              setAccent(null)
              setRefused(false)
            }}>
            {t("appearance.accentReset")}
          </Button>
        )}
        <ColorField
          label={t("appearance.accent")}
          value={accent ?? defaultAccent()}
          onChange={(hex) => {
            const check = setAccentPref(hex)
            setRefused(check?.ok === false)
            if (check?.ok) setAccent(check.hex)
          }}
        />
      </div>
    </SettingRow>
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
        <AccentRow />
        <SettingRow title={t("appearance.language")} hint={t("appearance.languageHint")}>
          <Select
            aria-label={t("appearance.language")}
            value={languagePref()}
            onChange={(v) => {
              setLanguagePref(v as LanguagePref)
              location.reload() // the language is read once per page load
            }}
            options={[
              { value: "system", label: t("appearance.languageSystem") },
              // Each language in its own words, so it can be found whatever the current one is.
              { value: "en", label: "English" },
              { value: "pt-BR", label: "Português (Brasil)" }
            ]}
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
    <YourDaySetting />
    <AgentsSetting />
    <ServersSetting />
    <StartupSetting />
    <AboutSetting />
    </>
  )
}
