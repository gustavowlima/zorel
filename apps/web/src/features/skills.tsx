// Skills: the recipes agents follow, in one list, each saying where it comes from: Zorel's (written here or proposed
// by the agents: proposals first, the reader with its diff and versions) and the SKILL.md files already on this
// computer (Claude Code, Codex, other agents, plugins), turned on for Zorel's agents from their own pane. At the foot,
// the switch that lets Claude Code and Codex use their own skills.
import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import type { FileSkill, Memory } from "@zorel/contracts"
import { formatAge, t } from "@zorel/i18n"
import { type ReactNode, useState } from "react"
import { agentsAtom, fileSkillsAtom, memoriesAtom, mutations, preferencesAtom, projectsAtom, useInvalidate, useList, useMutation, useReading } from "../client.ts"
import { scopeLabel } from "../labels.ts"
import { go } from "../state.ts"
import { NewMemory, Reader } from "./knowledge.tsx"
import { ReadingState } from "./reading.tsx"
import { UsedBy, UsedByBadge, useUsedBy } from "./used-by.tsx"
import { Button, ChevronRight, Code, column, cn, Dialog, EmptyState, Layers, Plus, Rows, SearchInput, SettingRow, Switch, SETTLE } from "@/ui"

// Where a skill on this computer comes from: its harness, and the plugin when it came with one.
const sourceOf = (s: FileSkill) => [t(`skills.source.${s.source}`), s.plugin].filter(Boolean).join(" · ")

// The skills' page lives in Settings (its "Skills" section, 2026-11-09): this is its body, without a screen header.
// selected: a Zorel skill's id; file: the path of a skill on this computer.
export function SkillsBody({ selected, file }: { selected?: string | undefined; file?: string | undefined }) {
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
  const shownFiles = files.filter((s) => !q || `${s.name} ${s.description} ${s.plugin ?? ""}`.toLowerCase().includes(q))
  const current = skills.find((m) => m.id === selected)
  const currentFile = files.find((s) => s.path === file)
  const open = !!(current || currentFile || creating)
  const agentName = (m: Memory) => agents.find((a) => `agent:${a.id}` === m.scope)?.name
  const pick = (to: { id: string } | { file: string }) => {
    setCreating(false)
    go({ view: "skills", ...to })
  }

  const zorelRow = (m: Memory) => (
    <SkillRow
      key={m.id}
      onPress={() => pick({ id: m.id })}
      title={m.title}
      from={[t("skills.zorel"), scopeLabel(m.scope, projects, agents), m.origin === "auto" ? (agentName(m) ? t("skills.proposedBy", { name: agentName(m)! }) : t("skills.fromChat")) : t("skills.added"), formatAge(Math.max(m.createdAt, m.confirmedAt))].join(" · ")}
      usedBy={m.agents ?? []}
    />
  )
  const fileRow = (s: FileSkill) => <SkillRow key={s.path} onPress={() => pick({ file: s.path })} title={s.name} from={sourceOf(s)} usedBy={s.enabled ? (s.agents ?? []) : []} />
  const group = (title: string, items: ReadonlyArray<ReactNode>, tone?: "accent") =>
    items.length > 0 && (
      <div className="flex flex-col gap-1">
        <h3 className={cn("px-3 text-sm font-medium", tone === "accent" ? "text-secondary" : "text-muted")}>{title}</h3>
        <ul className="flex flex-col gap-0.5">{items}</ul>
      </div>
    )
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)
  const inUse = [
    ...shown.filter((m) => m.state === "active").map((m) => ({ name: m.title, node: zorelRow(m) })),
    ...shownFiles.filter((s) => s.enabled).map((s) => ({ name: s.name, node: fileRow(s) }))
  ].sort(byName)
  const pending = shown.filter((m) => m.state === "pending")
  const nothing = !reading.loading && !skills.length && !files.length

  // One pane: the list, or the open skill (or a new one) in its place with a way back to the list.
  const back = () => (creating ? setCreating(false) : go({ view: "skills" }))
  if (open)
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="px-4 pt-3">
          <Button size="sm" variant="ghost" className="-ml-2.5 text-muted" onPress={back}>
            <ChevronRight className="size-3.5 rotate-180" />
            {t("skills.title")}
          </Button>
        </div>
        {creating ? (
          <NewMemory
            kind="skill"
            onDone={(id) => {
              setCreating(false)
              if (id) go({ view: "skills", id })
            }}
          />
        ) : current ? (
          <div key={current.id} className={SETTLE}>
            <Reader memory={current} />
          </div>
        ) : (
          currentFile && (
            <div key={currentFile.path} className={SETTLE}>
              <FileSkillView skill={currentFile} />
            </div>
          )
        )}
      </div>
    )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-end gap-2 border-b border-subtle px-4 py-2">
        <SearchInput size="sm" className="w-40 flex-1 sm:max-w-72" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("skills.search", { count: skills.length + files.length })} aria-label={t("common.search")} />
        <Button size="sm" variant="secondary" onPress={() => setCreating(true)}>
          <Plus />
          {t("skills.new")}
        </Button>
      </div>
      <nav aria-label={t("skills.title")} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4">
          <ReadingState loading={reading.loading} failed={reading.failed} onRetry={() => invalidate(["memories", "fileSkills"])} />
          {group(t("skills.waiting", { count: pending.length }), pending.map(zorelRow), "accent")}
          {group(t("skills.inUseGroup"), inUse.map((x) => x.node))}
          {group(t("skills.available"), shownFiles.filter((s) => !s.enabled).sort(byName).map(fileRow))}
          {group(t("skills.archived"), shown.filter((m) => m.state === "forgotten").map(zorelRow))}
          {q && !shown.length && !shownFiles.length && <p className="px-2 py-6 text-center text-muted">{t("skills.noMatch")}</p>}
          {nothing && <EmptyState inset scene="notebook" icon={<Layers />} title={t("skills.noneYet")} hint={t("skills.noneYetHint")} />}
          <NativeSkills />
        </div>
      </nav>
    </div>
  )
}

// One skill in the list: its name, where it comes from, and who uses it (none: no badge).
function SkillRow({ onPress, title, from, usedBy }: { onPress: () => void; title: string; from: string; usedBy: ReadonlyArray<string> }) {
  return (
    <li>
      <Button
        variant="ghost"
        onPress={onPress}
        className="h-auto w-full flex-col items-start gap-0.5 rounded-card px-3 py-2.5 text-left font-normal whitespace-normal text-fg"
      >
        <span className="flex w-full items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
          {usedBy.length > 0 && <UsedByBadge ids={usedBy} />}
        </span>
        <span className="block w-full truncate text-sm text-muted">{from}</span>
      </Button>
    </li>
  )
}

// Claude Code and Codex come with skills of their own (the person's ~/.claude/skills, plugins, Codex's). Off by
// default (Zorel gives the context); on, they use them as in their own app. Takes effect in each chat's next session.
function NativeSkills() {
  const prefs = AsyncResult.getOrElse(useAtomValue(preferencesAtom), () => undefined)
  const set = useMutation(mutations.nativeSkills)
  return (
    <Rows className="mt-auto">
      <SettingRow title={t("skills.native")} hint={t("skills.nativeHint")}>
        <Switch aria-label={t("skills.native")} isSelected={!!prefs?.nativeSkills} isDisabled={!prefs} onChange={(enabled) => void set({ payload: { enabled }, reactivityKeys: ["preferences"] })} />
      </SettingRow>
    </Rows>
  )
}

// A skill on this computer: where it comes from and its file, whether Zorel's agents use it (read from the file each
// time, so edits show up right away), and which of them.
function FileSkillView({ skill: s }: { skill: FileSkill }) {
  const pick = useMutation(mutations.pickFileSkill)
  const [limiting, setLimiting] = useState(false)
  return (
    <article className={cn(column(), "gap-5")}>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted">{sourceOf(s)}</span>
        <h2 className="text-lg font-semibold">{s.name}</h2>
        {s.enabled && (
          <div>
            <UsedByBadge ids={s.agents} />
          </div>
        )}
        <Code className="self-start break-all">{s.path}</Code>
      </div>
      {s.description && <p className="text-pretty text-secondary">{s.description}</p>}
      <Rows>
        <SettingRow title={t("skills.useHere")} hint={t("skills.useHereHint")}>
          <span className="flex items-center gap-2">
            {s.enabled && (
              <Button size="sm" variant="ghost" aria-label={t("usedBy.edit", { name: s.name })} onPress={() => setLimiting(true)}>
                {t("usedBy.title")}
              </Button>
            )}
            <Switch aria-label={t("skills.use", { name: s.name })} isSelected={s.enabled} onChange={(enabled) => void pick({ payload: { path: s.path, enabled }, reactivityKeys: ["fileSkills"] })} />
          </span>
        </SettingRow>
      </Rows>
      <Dialog title={t("usedBy.edit", { name: s.name })} size="lg" isOpen={limiting} onOpenChange={setLimiting}>
        {(close) => <FileSkillAgents skill={s} close={close} />}
      </Dialog>
    </article>
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

