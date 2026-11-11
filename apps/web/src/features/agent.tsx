// Agent page, in tabs: Work, Profile (groups: who it is, its model and fallbacks, its instructions), Tools and access
// (folder access, web, browser, connectors, what was allowed for good), Memory & skills (what it keeps, its Knowledge
// access, the skills it sees: applied at once) and Activity (usage, routines, versions). One Save in the header saves every tab; unsaved edits survive leaving the page.
// Without an id it creates one, in a project or global.
import { type Access, type Agent, type AgentPermissions, type AgentVersion, DEFAULT_PERMISSIONS, type FailoverTarget } from "@zorel/contracts"
import { formatAge, formatCompact, t } from "@zorel/i18n"
import { useEffect, useState } from "react"
import { agentsAtom, agentVersionsAtom, mutations, projectsAtom, serversAtom, teamsAtom, useList, useMutation, useReading } from "../client.ts"
import { agentTint, agentTone } from "../labels.ts"
import { type AgentTab, go, storedJson, storeJson } from "../state.ts"
import { AgentMemory } from "./agent-memory.tsx"
import { AgentWork } from "./agent-work.tsx"
import { FailoverEditor, useTermsPending } from "./failover.tsx"
import { AgentRoutines } from "./routines.tsx"
import { useArchive } from "./agents.tsx"
import { PermissionsEditor } from "./permissions.tsx"
import { type ModelChoice, ModelPicker } from "./model-picker.tsx"
import {
  AgentAvatar, Archive, ArchiveRestore, Button, ChartColumn, CheckList, column, ConfirmDialog, cn, Download, Field, IconButton, Input, ListRow, Menu, MenuItem, MoreHorizontal, Notice, Rows, Screen, Section, Select, SettingRow, Tab, TabList,
  TabPanel, Tabs, Textarea, Trash2, Undo2
} from "@/ui"

const DEFAULT: ModelChoice = { model: "claude-cli/sonnet", accountId: null, effort: null }

// The profile being edited. Unsaved edits are kept on this computer (per agent, or per "new agent here") until they
// are saved, so leaving the page never loses them: coming back shows them again, marked "Unsaved changes".
type Draft = {
  name: string
  title: string
  description: string
  instructions: string
  choice: ModelChoice
  failover: ReadonlyArray<FailoverTarget>
  access: Access
  permissions: AgentPermissions
}
const fromAgent = (agent: Agent | undefined): Draft => ({
  name: agent?.name ?? "",
  title: agent?.title ?? "",
  description: agent?.description ?? "",
  instructions: agent?.instructions ?? "",
  choice: agent ? { model: agent.model, accountId: agent.accountId, effort: agent.effort } : DEFAULT,
  failover: agent?.failover ?? [],
  access: agent?.access ?? "workspace",
  permissions: agent?.permissions ?? DEFAULT_PERMISSIONS
})
const draftKey = (agent: Agent | undefined, projectId: string | null) => `zorel.draft.agent.${agent?.id ?? `new:${projectId ?? "global"}`}`

export function AgentView({ agent, projectId, tab: opened, teamId }: { agent?: Agent; projectId: string | null; tab?: AgentTab | undefined; teamId?: string }) {
  const agents = useList(agentsAtom)
  const projects = useList(projectsAtom)
  const servers = useList(serversAtom)
  const create = useMutation(mutations.createAgent)
  const update = useMutation(mutations.updateAgent)
  const remove = useMutation(mutations.removeAgent)
  const key = draftKey(agent, projectId)
  const [form, setForm] = useState<Draft>(() => storedJson<Draft>(key) ?? fromAgent(agent))
  const set = (patch: Partial<Draft>) => setForm((f) => ({ ...f, ...patch }))
  const { name, title, description, instructions, choice, failover, access, permissions } = form
  const [tab, setTab] = useState<AgentTab>(opened ?? "profile")
  useEffect(() => {
    if (opened) setTab(opened) // opened again on another tab (the Agents screen's row: Work; its gear: Profile)
  }, [opened])
  // Its teams (spec 010): saved with the profile, not kept in the draft. A global agent fits any team; a project's
  // agent only that project's. undefined: untouched (what the server has, or the team "New agent" came from).
  const allTeams = useList(teamsAtom)
  const home = agent?.projectId ?? projectId
  const teamsHere = allTeams.filter((x) => home === null || x.projectId === home)
  const savedTeams = agent ? teamsHere.filter((x) => x.agentIds.includes(agent.id)).map((x) => x.id) : teamId ? [teamId] : []
  const [pickedTeams, setPickedTeams] = useState<string[]>()
  const teamIds = pickedTeams ?? savedTeams
  const teamsChanged = pickedTeams !== undefined && [...pickedTeams].sort().join() !== [...savedTeams].sort().join()
  const termsPending = useTermsPending({ model: choice.model, accountId: choice.accountId }, failover)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const archive = useArchive()
  const limits = useMutation(mutations.updateAgent)
  // The token limits apply at once (not part of the profile's Save): a limit is a guard, not a draft.
  const setLimit = (field: "monthlyTokens" | "replyTokens", v: string) =>
    agent && void limits({ params: { id: agent.id }, payload: { [field]: v ? Number(v) : null }, reactivityKeys: ["agents"] })

  // Another agent, or this one saved (or changed elsewhere): its draft if it has one, else the saved profile.
  useEffect(() => setForm(storedJson<Draft>(key) ?? fromAgent(agent)), [agent, key])

  const project = projects.find((p) => p.id === (agent?.projectId ?? projectId))
  const tools = servers.filter((s) => s.projectId === null || s.projectId === project?.id)
  const changed = JSON.stringify(form) !== JSON.stringify(fromAgent(agent))
  const dirty = !agent || changed || teamsChanged
  useEffect(() => storeJson(key, changed && (agent || name.trim()) ? form : undefined), [key, changed, form, agent, name])

  const save = () => {
    setBusy(true)
    const payload = { name: name.trim(), title: title.trim(), description: description.trim(), instructions, ...choice, failover, access, permissions, ...((teamsChanged || (!agent && teamIds.length > 0)) && { teamIds }) }
    const done = agent
      ? update({ params: { id: agent.id }, payload, reactivityKeys: ["agents"] })
      : create({ payload: { ...payload, projectId: project?.id ?? null }, reactivityKeys: ["agents"] }).then((a) => go({ view: "agent", id: a.id }))
    void done.then(() => {
      storeJson(key, undefined)
      setPickedTeams(undefined)
    }).finally(() => setBusy(false))
  }

  return (
    <Screen
      title={
        <span className="flex items-center gap-3">
          {agent && <AgentAvatar id={agent.id} name={agent.name} tone={agentTone(agent, agents)} size={28} />}
          {agent?.name ?? t("agent.newTitle")}
        </span>
      }
      subtitle={project ? t("agent.of", { project: project.name }) : t("agent.globalHint")}
      actions={
        <>
          {agent && changed && <span className="text-sm text-muted">{t("agent.unsaved")}</span>}
          {agent && changed && (
            <Button size="sm" variant="ghost" onPress={() => setForm(fromAgent(agent))}>
              {t("agent.discard")}
            </Button>
          )}
          {agent && (
            <Menu
              label={t("common.more")}
              trigger={
                <IconButton label={t("common.more")}>
                  <MoreHorizontal />
                </IconButton>
              }
            >
              <MenuItem icon={<Download />} onAction={() => exportAgent(agent)}>
                {t("agent.export")}
              </MenuItem>
              <MenuItem icon={agent.archivedAt ? <ArchiveRestore /> : <Archive />} onAction={() => archive(agent, !agent.archivedAt)}>
                {agent.archivedAt ? t("agent.restoreArchived") : t("agent.archive")}
              </MenuItem>
              <MenuItem icon={<Trash2 />} tone="danger" onAction={() => setConfirm(true)}>
                {t("agent.deleteAction")}
              </MenuItem>
            </Menu>
          )}
          <Button size="sm" variant="default" isPending={busy} isDisabled={!dirty || !name.trim() || busy || termsPending} onPress={save}>
            {agent ? t("common.save") : t("agent.create")}
          </Button>
        </>
      }
    >
      <form
        className={column()}
        onSubmit={(e) => {
          e.preventDefault()
          if (dirty && name.trim() && !termsPending) save()
        }}
      >
        {agent?.archivedAt && (
          <Notice icon={<Archive />} className="mb-6" title={t("agent.archivedTitle")} action={<Button size="sm" variant="secondary" onPress={() => archive(agent, false)}>{t("agent.restoreArchived")}</Button>}>
            {t("agent.archivedBody")}
          </Notice>
        )}
        <Tabs selectedKey={tab} onSelectionChange={(k) => setTab(k as typeof tab)} className="gap-8">
          <TabList label={agent ? t("agent.tabsLabel", { name: agent.name }) : t("agent.newTitle")} tint={agent && agentTint(agent, agents)}>
            {agent && <Tab id="work">{t("agent.tabs.work")}</Tab>}
            <Tab id="profile">{t("agent.tabs.profile")}</Tab>
            <Tab id="tools">{t("agent.tabs.tools")}</Tab>
            {agent && <Tab id="memory">{t("agent.tabs.memory")}</Tab>}
            {agent && <Tab id="activity">{t("agent.tabs.activity")}</Tab>}
          </TabList>

          {agent && (
            <TabPanel id="work" className="flex flex-col gap-10">
              <AgentWork agent={agent} />
            </TabPanel>
          )}
          <TabPanel id="profile" className="flex flex-col gap-10">
            {/* Who it is: other agents read the title and description to know whom to hand work to. */}
            <Section title={t("agent.who")}>
              <Rows>
                <div className="flex flex-col gap-4 py-4">
                  <div className="grid grid-cols-2 gap-4">
                    <Field label={t("agent.name")}>
                      <Input value={name} onChange={(e) => set({ name: e.target.value })} maxLength={80} required {...(!agent && { autoFocus: true })} />
                    </Field>
                    <Field label={t("agent.titleField")} hint={t("agent.titleHint")}>
                      <Input value={title} onChange={(e) => set({ title: e.target.value })} maxLength={60} placeholder={t("agent.titlePlaceholder")} />
                    </Field>
                  </div>
                  <Field label={t("agent.description")} hint={t("agent.descriptionHint")}>
                    <Textarea value={description} onChange={(e) => set({ description: e.target.value })} rows={2} maxLength={300} placeholder={t("agent.descriptionPlaceholder")} />
                  </Field>
                  {teamsHere.length > 0 && (
                    // Not a Field: that's a <label>, and a group of boxes inside one would tick the first on any click.
                    <div className="flex flex-col gap-1.5 text-sm text-muted">
                      <span>{t("teams.pick")}</span>
                      <CheckList label={t("teams.pick")} value={teamIds} onChange={setPickedTeams} options={teamsHere.map((x) => ({ value: x.id, label: x.name, trailing: <span className="text-sm text-muted">@{x.handle}</span> }))} />
                      <span className="text-dim">{t("teams.pickHint")}</span>
                    </div>
                  )}
                </div>
              </Rows>
            </Section>
            {/* The model it runs on, and where a turn goes when that model fails first. */}
            <Section title={t("agent.brain")}>
              <Rows>
                <SettingRow title={t("agent.model")} hint={t("agent.modelHint")}>
                  <ModelPicker variant="field" className="w-64" value={choice} onChange={(c) => set({ choice: c })} />
                </SettingRow>
                <div className="flex flex-col gap-3 py-3.5">
                  <span className="flex flex-col gap-0.5">
                    <span className="font-medium">{t("failover.title")}</span>
                    <span className="max-w-prose text-sm text-muted">{t("failover.intro")}</span>
                  </span>
                  <FailoverEditor primary={{ model: choice.model, accountId: choice.accountId }} value={failover} onChange={(f) => set({ failover: f })} />
                </div>
                {agent && (
                  <SettingRow title={t("agent.monthlyLimit")} hint={t("agent.monthlyLimitHint")}>
                    <Select size="sm" className="w-36" aria-label={t("agent.monthlyLimit")} value={String(agent.monthlyTokens ?? "")} onChange={(v) => setLimit("monthlyTokens", v)} options={limitOptions(MONTHLY, agent.monthlyTokens)} />
                  </SettingRow>
                )}
                {agent && (
                  <SettingRow title={t("agent.replyLimit")} hint={t("agent.replyLimitHint")}>
                    <Select size="sm" className="w-36" aria-label={t("agent.replyLimit")} value={String(agent.replyTokens ?? "")} onChange={(v) => setLimit("replyTokens", v)} options={limitOptions(PER_REPLY, agent.replyTokens)} />
                  </SettingRow>
                )}
              </Rows>
            </Section>
            <Section title={t("agent.instructions")} description={t("agent.roleHint")}>
              <Textarea aria-label={t("agent.instructions")} value={instructions} onChange={(e) => set({ instructions: e.target.value })} rows={10} maxLength={8000} />
            </Section>
          </TabPanel>

          <TabPanel id="tools">
            <PermissionsEditor access={access} onAccess={(v) => set({ access: v })} value={permissions} onChange={(v) => set({ permissions: v })} servers={tools} agentId={agent?.id} />
          </TabPanel>

          {agent && (
            <TabPanel id="memory" className="flex flex-col gap-10">
              <AgentMemory agent={agent} />
            </TabPanel>
          )}

          {agent && (
            <TabPanel id="activity" className="flex flex-col gap-10">
              <Section title={t("agent.does")}>
                <Rows>
                  <ListRow icon={<ChartColumn className="size-4 text-muted" />} title={t("agent.usage")} hint={t("agent.usageHint")} label={t("agent.usage")} onPress={() => go({ view: "usage", agentId: agent.id })} />
                </Rows>
              </Section>
              <History agent={agent} />
            </TabPanel>
          )}
        </Tabs>
      </form>
      {/* Outside the profile form (a form of its own): the agent's routines, with its activity. */}
      {agent && tab === "activity" && (
        <div className={cn(column(), "pt-0")}>
          <AgentRoutines agent={agent} />
        </div>
      )}
      {agent && (
        <ConfirmDialog
          isOpen={confirm}
          onOpenChange={setConfirm}
          title={t("agent.deleteTitle", { name: agent.name })}
          description={t("agent.deleteBody")}
          onConfirm={() =>
            void remove({ params: { id: agent.id }, reactivityKeys: ["agents", "chats", "memories"] }).then(() => {
              storeJson(key, undefined)
              go(agent.projectId ? { view: "project", id: agent.projectId, tab: "agents" } : { view: "home" })
            })
          }
        />
      )}
    </Screen>
  )
}

// ---------- token limits ----------

const MONTHLY = [1_000_000, 5_000_000, 20_000_000, 50_000_000, 100_000_000]
const PER_REPLY = [100_000, 250_000, 500_000, 1_000_000, 2_000_000]
// The choices of a limit's select: none, the steps, and the agent's own value when it is none of them.
const limitOptions = (steps: ReadonlyArray<number>, current: number | null) =>
  [null, ...steps, ...(current && !steps.includes(current) ? [current] : [])].map((n) => ({ value: n === null ? "" : String(n), label: n === null ? t("agent.noLimit") : t("agent.tokens", { n: formatCompact(n) }) }))

// ---------- versions ----------

const VERSION_FIELDS = ["name", "title", "description", "instructions", "model", "accountId", "effort", "failover", "access", "permissions"] as const

// Every saved state of the profile, newest first: who changed it, when, which fields; any older one can come back
// (restoring is itself a new version).
function History({ agent }: { agent: Agent }) {
  const versions = useReading(agentVersionsAtom(agent.id)).items
  const restore = useMutation(mutations.restoreAgent)
  const [open, setOpen] = useState<AgentVersion>()
  if (versions.length < 2) return null
  return (
    <Section title={t("agent.history")} description={t("agent.historyHint")}>
      <Rows>
        {versions.map((v, i) => {
          const prev = versions[i + 1]
          const fields = prev ? VERSION_FIELDS.filter((f) => JSON.stringify(v.profile[f]) !== JSON.stringify(prev.profile[f])) : []
          return (
            <div key={v.id} className="flex items-center gap-3 py-2.5">
              <span className="w-8 shrink-0 font-mono text-sm text-muted">{`v${v.n}`}</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm first-letter:uppercase">{prev ? fields.map((f) => t(`agent.field.${f}`)).join(", ") || t("agent.noFieldChange") : t("agent.created")}</span>
                <span className="text-sm text-muted">{`${v.by === "you" ? t("agent.byYou") : v.by} · ${formatAge(v.at)}`}</span>
              </span>
              {i === 0 ? (
                <span className="text-sm text-muted">{t("agent.current")}</span>
              ) : (
                <Button size="sm" variant="ghost" onPress={() => setOpen(v)}>
                  <Undo2 />
                  {t("agent.restore")}
                </Button>
              )}
            </div>
          )
        })}
      </Rows>
      <ConfirmDialog
        isOpen={!!open}
        onOpenChange={(o) => !o && setOpen(undefined)}
        title={t("agent.restoreTitle", { n: open?.n ?? 0 })}
        description={t("agent.restoreBody")}
        confirmLabel={t("agent.restore")}
        onConfirm={() => open && void restore({ params: { id: agent.id, n: open.n }, reactivityKeys: ["agents"] })}
      />
    </Section>
  )
}

// ---------- export / import: the profile as JSON, without the account (it is this computer's) ----------

const EXPORT_KIND = "zorel.agent"

export function exportAgent(a: Agent) {
  const data = {
    kind: EXPORT_KIND,
    version: 1,
    name: a.name, title: a.title, description: a.description, instructions: a.instructions, model: a.model, effort: a.effort,
    failover: a.failover.map((f) => ({ model: f.model, accountId: null })),
    access: a.access,
    memory: a.memory,
    knowledge: a.knowledge
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }))
  const link = document.createElement("a")
  link.href = url
  link.download = `${a.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "agent"}.agent.json`
  link.click()
  URL.revokeObjectURL(url)
}

// A file from exportAgent back to a create payload (the server validates every field).
export function importedAgent(text: string, projectId: string | null) {
  const v = JSON.parse(text) as Record<string, unknown>
  if (v.kind !== EXPORT_KIND && v.kind !== "zero.agent") throw new Error(t("agent.importNotAgent"))
  const str = (x: unknown) => (typeof x === "string" ? x : "")
  return {
    projectId,
    name: str(v.name),
    title: str(v.title),
    description: str(v.description),
    instructions: str(v.instructions),
    model: str(v.model),
    effort: (["low", "medium", "high", "max"] as const).find((e) => e === v.effort) ?? null,
    failover: Array.isArray(v.failover) ? (v.failover as Array<{ model?: unknown }>).flatMap((f) => (typeof f.model === "string" ? [{ model: f.model, accountId: null }] : [])) : [],
    access: (["ask", "workspace", "full"] as const).find((a) => a === v.access) ?? "workspace",
    memory: (["auto", "ask", "read"] as const).find((m) => m === v.memory) ?? "ask", // files from before it: the default
    knowledge: (["read", "none"] as const).find((k) => k === v.knowledge) ?? "read"
  }
}
