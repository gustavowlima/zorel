// Skills: the recipes agents follow, in one place. "Zorel's skills" are the ones written here or proposed by the
// agents (a list, proposals first, and the reader with its diff and versions); "On this computer" are the SKILL.md
// files of Claude Code, Codex and plugins, turned on for Zorel's agents, and the switch for the models' own skills.
import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import type { FileSkill, Memory } from "@zorel/contracts"
import { formatAge, t } from "@zorel/i18n"
import { useState } from "react"
import { agentsAtom, fileSkillsAtom, memoriesAtom, mutations, preferencesAtom, projectsAtom, useInvalidate, useList, useMutation, useReading } from "../client.ts"
import { scopeLabel } from "../labels.ts"
import { go } from "../state.ts"
import { NewMemory, Reader } from "./knowledge.tsx"
import { ReadingState } from "./reading.tsx"
import { UsedBy, UsedByBadge, useUsedBy } from "./used-by.tsx"
import { Button, Column, cx, Dialog, EmptyState, FolderOpen, Layers, Plus, Rows, SearchInput, Section, Segmented, SettingRow, Switch, Tab, TabList, Tabs } from "@/ui"

// The skills' page lives in Settings (its "Skills" section, 2026-11-09): this is its body, without a screen header.
export function SkillsBody({ selected, computer }: { selected?: string | undefined; computer?: boolean | undefined }) {
  const reading = useReading(memoriesAtom)
  const files = useList(fileSkillsAtom)
  const projects = useList(projectsAtom)
  const agents = useList(agentsAtom)
  const invalidate = useInvalidate()
  const [query, setQuery] = useState("")
  const [creating, setCreating] = useState(false)
  const skills = reading.items.filter((m) => m.kind === "skill")
  const q = query.trim().toLowerCase()
  const shown = skills.filter((m) => !q || `${m.title} ${m.text}`.toLowerCase().includes(q))
  const pending = shown.filter((m) => m.state === "pending")
  const active = shown.filter((m) => m.state === "active")
  const archived = shown.filter((m) => m.state === "forgotten")
  const current = skills.find((m) => m.id === selected)
  const onComputer = files.filter((s) => s.enabled).length
  const agentName = (m: Memory) => agents.find((a) => `agent:${a.id}` === m.scope)?.name

  const item = (m: Memory) => (
    <li key={m.id}>
      <Button
        variant="ghost"
        onPress={() => {
          setCreating(false)
          go({ view: "skills", id: m.id })
        }}
        className={cx("h-auto w-full flex-col items-start gap-0.5 rounded-card border px-3 py-2.5 text-left font-normal whitespace-normal", m.id === selected ? "border-subtle bg-surface text-fg" : "border-transparent text-fg")}
      >
        <span className="flex w-full items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-medium">{m.title}</span>
          {m.agents?.length ? <UsedByBadge ids={m.agents} /> : null}
        </span>
        <span className="block w-full truncate text-sm text-muted">
          {[scopeLabel(m.scope, projects, agents), m.origin === "auto" ? (agentName(m) ? t("skills.proposedBy", { name: agentName(m)! }) : t("skills.fromChat")) : t("skills.added"), formatAge(Math.max(m.createdAt, m.confirmedAt))].join(" · ")}
        </span>
      </Button>
    </li>
  )
  const group = (title: string, list: Memory[], tone?: "accent") =>
    list.length > 0 && (
      <div className="flex flex-col gap-1">
        <h3 className={cx("px-3 text-sm font-medium", tone === "accent" ? "text-accent-text" : "text-muted")}>{title}</h3>
        <ul className="flex flex-col gap-0.5">{list.map(item)}</ul>
      </div>
    )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-end gap-3 border-b border-subtle px-4 pt-2">
        <div className="min-w-0 flex-1">
        <Tabs selectedKey={computer ? "computer" : "zorel"} onSelectionChange={(k) => go(k === "computer" ? { view: "skills", computer: true } : { view: "skills" })}>
          <TabList label={t("skills.title")}>
            <Tab id="zorel">{pending.length ? `${t("skills.tabZorel")} · ${pending.length}` : t("skills.tabZorel")}</Tab>
            <Tab id="computer">{onComputer ? `${t("skills.tabComputer")} · ${t("skills.inUse", { count: onComputer })}` : t("skills.tabComputer")}</Tab>
          </TabList>
        </Tabs>
        </div>
        {!computer && (
          <div className="flex items-center gap-2 pb-2">
            <SearchInput size="sm" className="w-56" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("common.search")} aria-label={t("common.search")} />
            <Button size="sm" variant="secondary" onPress={() => setCreating(true)}>
              <Plus />
              {t("skills.new")}
            </Button>
          </div>
        )}
      </div>
      {computer ? (
        <div className="gutter-stable min-h-0 flex-1 overflow-y-auto">
          <Column wide>
            <NativeSkills />
            <FileSkills />
          </Column>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <nav aria-label={t("skills.tabZorel")} className="flex w-96 shrink-0 flex-col gap-4 overflow-y-auto border-r border-subtle py-4 pr-3 pl-4">
            <ReadingState loading={reading.loading} failed={reading.failed} onRetry={() => invalidate(["memories"])} />
            {group(t("skills.waiting", { count: pending.length }), pending, "accent")}
            {group(t("skills.inUseGroup"), active)}
            {group(t("skills.archived"), archived)}
            {!reading.loading && skills.length > 0 && shown.length === 0 && <p className="px-2 py-6 text-center text-muted">{t("skills.noMatch")}</p>}
          </nav>
          <div className="min-w-0 flex-1 overflow-y-auto">
            {creating ? (
              <NewMemory kind="skill" onDone={(id) => {
                setCreating(false)
                if (id) go({ view: "skills", id })
              }} />
            ) : current ? (
              <Reader key={current.id} memory={current} />
            ) : (
              <EmptyState icon={<Layers />} title={skills.length ? t("skills.selectOne") : t("skills.noneYet")} {...(!skills.length && { hint: t("skills.noneYetHint") })} />
            )}
          </div>
        </div>
      )}
    </div>
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
        <SettingRow title={t("skills.native")} hint={t("skills.nativeHint")}>
          <Switch aria-label={t("skills.native")} isSelected={!!prefs?.nativeSkills} isDisabled={!prefs} onChange={(enabled) => void set({ payload: { enabled }, reactivityKeys: ["preferences"] })} />
        </SettingRow>
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
  const [limiting, setLimiting] = useState<FileSkill>() // the skill whose agents are being chosen
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
          <SearchInput size="sm" className="flex-1" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("skills.search", { count: all.length })} aria-label={t("common.search")} />
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
                      {s.enabled && <UsedByBadge ids={s.agents} />}
                    </span>
                    {s.description && <span className="line-clamp-1 text-sm text-muted">{s.description}</span>}
                  </span>
                  {s.enabled && (
                    <Button size="sm" variant="ghost" aria-label={t("usedBy.edit", { name: s.name })} onPress={() => setLimiting(s)}>
                      {t("usedBy.title")}
                    </Button>
                  )}
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
      <Dialog title={limiting ? t("usedBy.edit", { name: limiting.name }) : ""} size="lg" isOpen={!!limiting} onOpenChange={(open) => !open && setLimiting(undefined)}>
        {(close) => limiting && <FileSkillAgents skill={limiting} close={close} />}
      </Dialog>
    </Section>
  )
}

// Which agents use a skill from this computer: the same "Used by" field as in Knowledge; saved with its path.
function FileSkillAgents({ skill, close }: { skill: FileSkill; close: () => void }) {
  const pick = useMutation(mutations.pickFileSkill)
  const usedBy = useUsedBy(skill.agents)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        setBusy(true)
        setFailed(false)
        pick({ payload: { path: skill.path, enabled: true, agents: usedBy.value }, reactivityKeys: ["fileSkills"] }).then(close, () => setFailed(true)).finally(() => setBusy(false))
      }}
    >
      <UsedBy state={usedBy} />
      {failed && (
        <p role="alert" className="text-sm text-danger">
          {t("agent.skillsTab.errorTitle")}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onPress={close}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" variant="default" isPending={busy} isDisabled={!usedBy.valid || !usedBy.changed || busy}>
          {t("common.save")}
        </Button>
      </div>
    </form>
  )
}

