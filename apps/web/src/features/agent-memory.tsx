// Agent page, "Memory & skills" tab: what the agent keeps from its chats (Agent.memory), whether it can use Knowledge
// (Agent.knowledge) and which skills it sees (Memory.agents, FileSkill.agents). Memory and Knowledge apply at once
// (a guard, not a draft): the control shows "Saving…", then "Saved" only after the server answered, and goes back
// if it refused. The server enforces all of it; this screen only shows and changes it.
import type { Agent, AgentPatch, FileSkill, Memory } from "@zorel/contracts"
import { t } from "@zorel/i18n"
import { useEffect, useState } from "react"
import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import { agentsAtom, chatsAtom, fileSkillsAtom, memoriesAtom, mutations, preferencesAtom, projectsAtom, useInvalidate, useList, useMutation, useReading } from "../client.ts"
import { go } from "../state.ts"
import { ScopeIcon } from "./knowledge.tsx"
import { ReadingState } from "./reading.tsx"
import { sees, teamOf, withAgent, withoutAgent } from "./skill-agents.ts"
import { UsedByBadge } from "./used-by.tsx"
import { Button, cn, Info, ListRow, Notice, Rows, Section, Segmented, SettingRow, ShieldAlert, Switch } from "@/ui"

type Field = "memory" | "knowledge"
type Status = "idle" | "saving" | "saved" | "error"

// A setting that applies on press: the shown value is the one asked for until the server answers, and falls back
// to the saved one if it fails.
function useInstant<F extends Field>(agent: Agent, field: F) {
  const update = useMutation(mutations.updateAgent)
  const [asked, setAsked] = useState<Agent[F]>()
  const [status, setStatus] = useState<Status>("idle")
  useEffect(() => {
    if (asked !== undefined && status === "saved" && agent[field] === asked) setAsked(undefined) // the list caught up
  }, [agent, field, asked, status])
  const set = (value: Agent[F]) => {
    setAsked(value)
    setStatus("saving")
    update({ params: { id: agent.id }, payload: { [field]: value } as typeof AgentPatch.Type, reactivityKeys: ["agents"] }).then(
      () => setStatus("saved"),
      () => {
        setAsked(undefined)
        setStatus("error")
      }
    )
  }
  return { value: asked ?? agent[field], status, set, retry: () => asked !== undefined && set(asked) }
}

// "Saving… / Saved / Not saved. Try again", announced politely. Always in the page so the change is read out.
function SaveStatus({ status, onRetry }: { status: Status; onRetry: () => void }) {
  return (
    <span role="status" className={cn("flex items-center gap-1 text-sm", status === "error" ? "text-danger" : "text-muted")}>
      {status === "saving" && t("agent.mem.saving")}
      {status === "saved" && t("agent.mem.saved")}
      {status === "error" && (
        <>
          {t("agent.mem.failed")}
          <Button size="sm" variant="ghost" onPress={onRetry}>
            {t("common.retry")}
          </Button>
        </>
      )}
    </span>
  )
}

// A chat learns only if every agent in it does (the server's rule): the agents this one shares a chat with that don't.
function notLearning(agent: Agent, chats: ReadonlyArray<{ agentIds: ReadonlyArray<string> }>, team: ReadonlyArray<Agent>) {
  return team.find((a) => a.id !== agent.id && a.memory === "read" && chats.some((c) => c.agentIds.includes(agent.id) && c.agentIds.includes(a.id)))
}

const KNOW_HINT = { none: "agent.know.noneHint", read: "agent.know.readHint", write: "agent.know.writeHint" } as const

export function AgentMemory({ agent }: { agent: Agent }) {
  const team = teamOf(useList(agentsAtom))
  const chats = useList(chatsAtom)
  const projects = useList(projectsAtom)
  const facts = useList(memoriesAtom).filter((m) => m.kind === "fact" && m.state === "active")
  const count = (scope: string) => facts.filter((m) => m.scope === scope).length
  const project = projects.find((p) => p.id === agent.projectId)
  // About you, its project (a global agent works in many: none listed), its own notes.
  const places = [
    { scope: "user", title: t("memory.aboutYou"), hint: t("agent.mem.seenByAll") },
    ...(project ? [{ scope: `project:${project.id}`, title: project.name, hint: t("agent.mem.seenByProject", { name: project.name }) }] : []),
    { scope: `agent:${agent.id}`, title: t("agent.mem.notes", { name: agent.name }), hint: t("agent.mem.notesHint", { name: agent.name }) }
  ]
  const memory = useInstant(agent, "memory")
  const knowledge = useInstant(agent, "knowledge")
  const learns = memory.value !== "read"
  const blocker = learns ? notLearning(agent, chats, team) : undefined
  const prefs = AsyncResult.getOrElse(useAtomValue(preferencesAtom), () => undefined)
  return (
    <>
      <Section title={t("agent.mem.title")} description={<span className="block max-w-prose">{t("agent.mem.hint", { name: agent.name })}</span>} action={<SaveStatus status={memory.status} onRetry={memory.retry} />}>
        <Rows>
          <SettingRow title={t("agent.mem.learns")} hint={learns ? t(prefs?.memoryApproval === "undo" ? "agent.mem.learnsUndo" : "agent.mem.learnsReview") : t("agent.mem.readHint")}>
            <Switch aria-label={t("agent.mem.learns")} isSelected={learns} onChange={(on) => memory.set(on ? "ask" : "read")} />
          </SettingRow>
        </Rows>
        {blocker && (
          <Notice tone="neutral" icon={<Info />} title={t("agent.mem.sharedTitle")}>
            {t("agent.mem.sharedRead", { other: blocker.name, name: agent.name })}
          </Notice>
        )}
        <div>
          <Button size="sm" variant="ghost" onPress={() => go({ view: "memory" })}>
            {t("agent.mem.approvalLink")}
          </Button>
        </div>
      </Section>
      {/* Where what it keeps goes: Zorel picks the owner for each memory; a memory can be moved later. */}
      <Section title={t("agent.mem.whereTitle")} description={<span className="block max-w-prose">{t("agent.mem.whereHint")}</span>}>
        <Rows>
          {places.map((p) => (
            <ListRow
              key={p.scope}
              icon={<ScopeIcon scope={p.scope} agents={team} />}
              title={p.title}
              hint={p.hint}
              aside={t("agent.mem.notesCount", { count: count(p.scope) })}
              label={`${p.title}: ${t("agent.mem.notesLink")}`}
              onPress={() => go({ view: "memory", tab: p.scope })}
            />
          ))}
        </Rows>
      </Section>
      <Section title={t("agent.know.title")} description={<span className="block max-w-prose">{t("agent.know.hint", { name: agent.name })}</span>} action={<SaveStatus status={knowledge.status} onRetry={knowledge.retry} />}>
        <Segmented
          fill
          label={t("agent.know.label")}
          value={knowledge.value}
          onChange={knowledge.set}
          options={[
            { id: "none", label: t("agent.know.none") },
            { id: "read", label: t("agent.know.read") },
            { id: "write", label: t("agent.know.write") }
          ]}
        />
        <p className="text-sm text-muted">{t(KNOW_HINT[knowledge.value])}</p>
        <div>
          <Button size="sm" variant="ghost" onPress={() => go({ view: "pages" })}>
            {t("agent.know.open")}
          </Button>
        </div>
      </Section>
      <AgentSkills agent={agent} team={team} />
    </>
  )
}

// The team as it is now (not the list on screen): "Stop using" writes the other agents out, so one created a
// moment ago must be in it. A failed read stops the action; nothing is written.
async function freshTeam(): Promise<Agent[]> {
  const r = await fetch("/api/agents")
  if (!r.ok) throw new Error(String(r.status))
  return teamOf((await r.json()) as Agent[])
}

const firstLine = (text: string) => text.split("\n").find((l) => l.trim()) ?? ""

function AgentSkills({ agent, team }: { agent: Agent; team: ReadonlyArray<Agent> }) {
  const memories = useReading(memoriesAtom)
  const files = useReading(fileSkillsAtom)
  const update = useMutation(mutations.updateMemory)
  const pick = useMutation(mutations.pickFileSkill)
  const invalidate = useInvalidate()
  const [busy, setBusy] = useState<string>()
  const [retry, setRetry] = useState<{ run: () => void }>()
  // One change at a time; a failure keeps what was there and offers to run it again.
  const run = (key: string, change: () => Promise<unknown>) => {
    setBusy(key)
    void change().then(
      () => setRetry(undefined),
      () => setRetry({ run: () => run(key, change) })
    ).finally(() => setBusy(undefined))
  }

  const skills = memories.items.filter((m) => m.kind === "skill" && m.state === "active")
  const own = skills.filter((m) => m.scope === `agent:${agent.id}`)
  const common = skills.filter((m) => m.scope === "user" || (agent.projectId !== null && m.scope === `project:${agent.projectId}`))
  const machine = files.items.filter((s) => s.enabled)
  const loading = memories.loading || files.loading
  const failed = memories.failed || files.failed
  const none = !loading && !failed && own.length + common.length + machine.length === 0

  // The row's action: put the agent in or out of the skill's agents, or open the skill when it is the only one using it.
  const action = (key: string, ids: ReadonlyArray<string> | undefined, write: (agents: string[]) => Promise<unknown>, edit: () => void, scope?: string) => {
    const on = sees(ids, agent.id)
    if (!on) return { label: t("agent.skillsTab.use"), onPress: () => run(key, async () => write(withAgent(ids, agent.id, await freshTeam()))) }
    if (withoutAgent(ids, agent.id, team, scope) === null) return { label: t("agent.skillsTab.edit"), onPress: edit, only: true }
    return {
      label: t("agent.skillsTab.stop"),
      onPress: () =>
        run(key, async () => {
          const next = withoutAgent(ids, agent.id, await freshTeam(), scope)
          if (next) await write(next)
        })
    }
  }

  const row = (key: string, title: string, hint: string, ids: ReadonlyArray<string> | undefined, act: { label: string; onPress: () => void; only?: boolean }, dim: boolean) => (
    <SettingRow
      key={key}
      title={
        <span className={cn("flex min-w-0 items-center gap-2", dim && "text-muted")}>
          <span className="truncate">{title}</span>
          <UsedByBadge ids={ids} />
        </span>
      }
      hint={
        <>
          <span className="line-clamp-1">{hint}</span>
          {act.only && <span className="text-dim">{t("agent.skillsTab.onlyOne", { name: agent.name })}</span>}
        </>
      }
    >
      <Button size="sm" variant="secondary" isPending={busy === key} isDisabled={busy !== undefined} aria-label={t("agent.skillsTab.action", { action: act.label, skill: title })} onPress={act.onPress}>
        {act.label}
      </Button>
    </SettingRow>
  )
  const sharedRow = (m: Memory) =>
    row(m.id, m.title, firstLine(m.text), m.agents, action(m.id, m.agents, (agents) => update({ params: { id: m.id }, payload: { agents }, reactivityKeys: ["memories"] }), () => go({ view: "skills", id: m.id }), m.scope), !sees(m.agents, agent.id))
  const machineRow = (s: FileSkill) =>
    row(s.path, s.name, s.description, s.agents, action(s.path, s.agents, (agents) => pick({ payload: { path: s.path, enabled: true, agents }, reactivityKeys: ["fileSkills"] }), () => go({ view: "skills", file: s.path })), !sees(s.agents, agent.id))

  return (
    <Section title={t("agent.skillsTab.title")} description={<span className="block max-w-prose">{t("agent.skillsTab.hint", { name: agent.name })}</span>}>
      <ReadingState loading={loading} failed={failed} onRetry={() => invalidate(["memories", "fileSkills"])} />
      {retry && (
        <Notice tone="danger" icon={<ShieldAlert />} title={t("agent.skillsTab.errorTitle")} action={<Button size="sm" variant="secondary" onPress={retry.run}>{t("common.retry")}</Button>}>
          {t("agent.skillsTab.errorBody")}
        </Notice>
      )}
      {none && (
        <Rows>
          <SettingRow title={t("agent.skillsTab.empty", { name: agent.name })} hint={t("agent.skillsTab.emptyHint", { name: agent.name })}>
            <Button size="sm" variant="secondary" onPress={() => go({ view: "skills" })}>
              {t("agent.skillsTab.openKnowledge")}
            </Button>
          </SettingRow>
        </Rows>
      )}
      {own.length > 0 && (
        <SkillGroup title={t("agent.skillsTab.own", { name: agent.name })} hint={t("agent.skillsTab.ownHint", { name: agent.name })}>
          {own.map((m) => (
            <SettingRow
              key={m.id}
              title={<span className="truncate">{m.title}</span>}
              hint={<span className="line-clamp-1">{firstLine(m.text)}</span>}
            >
              <Button size="sm" variant="ghost" isDisabled={busy !== undefined} aria-label={t("agent.skillsTab.action", { action: t("agent.skillsTab.remove"), skill: m.title })} onPress={() => run(m.id, () => update({ params: { id: m.id }, payload: { state: "forgotten" }, reactivityKeys: ["memories"] }))}>
                {t("agent.skillsTab.remove")}
              </Button>
            </SettingRow>
          ))}
        </SkillGroup>
      )}
      {common.length > 0 && (
        <SkillGroup title={t("agent.skillsTab.shared")} hint={t("agent.skillsTab.sharedHint")}>
          {common.map(sharedRow)}
        </SkillGroup>
      )}
      {machine.length > 0 && (
        <SkillGroup title={t("agent.skillsTab.machine")} hint={t("agent.skillsTab.machineHint")}>
          {machine.map(machineRow)}
        </SkillGroup>
      )}
      {(common.length > 0 || machine.length > 0) && <p className="text-sm text-dim">{t("agent.skillsTab.limitsNote", { name: agent.name })}</p>}
      <Notice tone="neutral" icon={<Info />} title={t("agent.skillsTab.nativeTitle")}>
        {t("agent.skillsTab.nativeBody")}
      </Notice>
    </Section>
  )
}

function SkillGroup({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 pt-2">
      <h3 className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium text-muted">
        {title}
        <span className="font-normal text-dim">{hint}</span>
      </h3>
      <Rows>{children}</Rows>
    </div>
  )
}
