// Agent page, in three tabs (as in Tucano): Profile (who it is, its model and fallbacks, its instructions), Tools
// and access (folder access, web, browser, connectors, what was allowed for good), and Knowledge and activity
// (its memories and skills, usage, routines, versions). One Save in the header saves every tab. Without an id it
// creates one, in a project or global.
import { type Access, type Agent, type AgentPermissions, type AgentVersion, DEFAULT_PERMISSIONS, type FailoverTarget } from "@zero/contracts"
import { formatAge, t } from "@zero/i18n"
import { useEffect, useState } from "react"
import { agentsAtom, agentVersionsAtom, memoriesAtom, mutations, projectsAtom, serversAtom, useList, useMutation, useReading } from "../client.ts"
import { agentTone } from "../labels.ts"
import { go } from "../state.ts"
import { FailoverEditor, useTermsPending } from "./failover.tsx"
import { AgentRoutines } from "./routines.tsx"
import { PermissionsEditor } from "./permissions.tsx"
import { type ModelChoice, ModelPicker } from "./model-picker.tsx"
import type { ReactNode } from "react"
import {
  AgentAvatar, BookOpen, Button, ChartColumn, Download, Undo2, ChevronRight, ConfirmDialog, Field, IconButton, Input, Menu, MenuItem, MoreHorizontal, Rows, Screen, Section, Sparkles, Tab, TabList,
  TabPanel, Tabs, Textarea, Trash2
} from "@/ui"

const DEFAULT: ModelChoice = { model: "claude-cli/sonnet", accountId: null, effort: null }

export function AgentView({ agent, projectId }: { agent?: Agent; projectId: string | null }) {
  const agents = useList(agentsAtom)
  const projects = useList(projectsAtom)
  const servers = useList(serversAtom)
  const create = useMutation(mutations.createAgent)
  const update = useMutation(mutations.updateAgent)
  const remove = useMutation(mutations.removeAgent)
  const [name, setName] = useState(agent?.name ?? "")
  const [title, setTitle] = useState(agent?.title ?? "")
  const [description, setDescription] = useState(agent?.description ?? "")
  const [instructions, setInstructions] = useState(agent?.instructions ?? "")
  const [choice, setChoice] = useState<ModelChoice>(agent ? { model: agent.model, accountId: agent.accountId, effort: agent.effort } : DEFAULT)
  const [failover, setFailover] = useState<ReadonlyArray<FailoverTarget>>(agent?.failover ?? [])
  const [access, setAccess] = useState<Access>(agent?.access ?? "workspace")
  const [permissions, setPermissions] = useState<AgentPermissions>(agent?.permissions ?? DEFAULT_PERMISSIONS)
  const [tab, setTab] = useState<"profile" | "tools" | "activity">("profile")
  const termsPending = useTermsPending({ model: choice.model, accountId: choice.accountId }, failover)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setName(agent?.name ?? "")
    setTitle(agent?.title ?? "")
    setDescription(agent?.description ?? "")
    setInstructions(agent?.instructions ?? "")
    setChoice(agent ? { model: agent.model, accountId: agent.accountId, effort: agent.effort } : DEFAULT)
    setFailover(agent?.failover ?? [])
    setAccess(agent?.access ?? "workspace")
    setPermissions(agent?.permissions ?? DEFAULT_PERMISSIONS)
  }, [agent])

  const project = projects.find((p) => p.id === (agent?.projectId ?? projectId))
  const tools = servers.filter((s) => s.projectId === null || s.projectId === project?.id)
  // What it knows of its own: memories and skills scoped to this agent (made and edited in Knowledge).
  const own = useList(memoriesAtom).filter((m) => agent && m.scope === `agent:${agent.id}` && m.state !== "forgotten")
  const facts = own.filter((m) => m.kind === "fact")
  const skills = own.filter((m) => m.kind === "skill")
  const dirty =
    !agent ||
    name !== agent.name ||
    title !== agent.title ||
    description !== agent.description ||
    instructions !== agent.instructions ||
    choice.model !== agent.model ||
    choice.accountId !== agent.accountId ||
    choice.effort !== agent.effort ||
    JSON.stringify(failover) !== JSON.stringify(agent.failover) ||
    access !== agent.access ||
    JSON.stringify(permissions) !== JSON.stringify(agent.permissions)

  const save = () => {
    setBusy(true)
    const payload = { name: name.trim(), title: title.trim(), description: description.trim(), instructions, ...choice, failover, access, permissions }
    const done = agent
      ? update({ params: { id: agent.id }, payload, reactivityKeys: ["agents"] })
      : create({ payload: { ...payload, projectId: project?.id ?? null }, reactivityKeys: ["agents"] }).then((a) => go({ view: "agent", id: a.id }))
    void done.finally(() => setBusy(false))
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
        className="mx-auto flex w-full max-w-2xl flex-col px-8 py-6"
        onSubmit={(e) => {
          e.preventDefault()
          if (dirty && name.trim() && !termsPending) save()
        }}
      >
        <Tabs selectedKey={tab} onSelectionChange={(k) => setTab(k as typeof tab)} className="gap-7">
          <TabList label={t("agent.newTitle")}>
            <Tab id="profile">{t("agent.tabs.profile")}</Tab>
            <Tab id="tools">{t("agent.tabs.tools")}</Tab>
            {agent && <Tab id="activity">{t("agent.tabs.activity")}</Tab>}
          </TabList>

          <TabPanel id="profile" className="flex flex-col gap-7">
            {/* Who it is: other agents read the title and description to know whom to hand work to. */}
            <div className="grid grid-cols-2 gap-4">
              <Field label={t("agent.name")}>
                <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required {...(!agent && { autoFocus: true })} />
              </Field>
              <Field label={t("agent.titleField")} hint={t("agent.titleHint")}>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} placeholder={t("agent.titlePlaceholder")} />
              </Field>
            </div>
            <Field label={t("agent.description")} hint={t("agent.descriptionHint")}>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={300} placeholder={t("agent.descriptionPlaceholder")} />
            </Field>
            <Section title={t("agent.brain")}>
              <Field label={t("agent.model")} hint={t("agent.modelHint")}>
                <ModelPicker variant="field" value={choice} onChange={setChoice} />
              </Field>
              <div className="flex flex-col gap-2 pt-2">
                <span className="text-sm font-medium text-muted">{t("failover.title")}</span>
                <p className="text-sm text-dim">{t("failover.intro")}</p>
                <FailoverEditor primary={{ model: choice.model, accountId: choice.accountId }} value={failover} onChange={setFailover} />
              </div>
            </Section>
            <Field label={t("agent.role")} hint={t("agent.roleHint")}>
              <Textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={8} maxLength={8000} />
            </Field>
          </TabPanel>

          <TabPanel id="tools">
            <PermissionsEditor access={access} onAccess={setAccess} value={permissions} onChange={setPermissions} servers={tools} />
          </TabPanel>

          {agent && (
            <TabPanel id="activity" className="flex flex-col gap-8">
              <Section title={t("agent.knows")}>
                <Rows>
                  <Group icon={<BookOpen />} label={t("agent.memories")} count={t("agent.memoryCount", { count: facts.length })}>
                    {facts.slice(0, 5).map((m) => (
                      <Item key={m.id} text={m.text} pending={m.state === "pending"} onPress={() => go({ view: "knowledge", id: m.id })} />
                    ))}
                  </Group>
                  <Group icon={<Sparkles />} label={t("agent.skills")} count={t("agent.skillCount", { count: skills.length })}>
                    {skills.slice(0, 5).map((m) => (
                      <Item key={m.id} text={m.title} pending={m.state === "pending"} onPress={() => go({ view: "knowledge", id: m.id })} />
                    ))}
                  </Group>
                  <LinkRow icon={<BookOpen />} label={t("agent.openKnowledge")} onPress={() => go({ view: "knowledge" })} />
                </Rows>
              </Section>
              <Section title={t("agent.does")}>
                <Rows>
                  <LinkRow icon={<ChartColumn />} label={t("agent.usage")} hint={t("agent.usageHint")} onPress={() => go({ view: "usage", agentId: agent.id })} />
                </Rows>
              </Section>
              <History agent={agent} />
            </TabPanel>
          )}
        </Tabs>
      </form>
      {/* Outside the profile form (a form of its own): the agent's routines, with its activity. */}
      {agent && tab === "activity" && (
        <div className="mx-auto flex w-full max-w-2xl flex-col px-8 pb-10">
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
            void remove({ params: { id: agent.id }, reactivityKeys: ["agents", "chats", "memories"] }).then(() =>
              go(agent.projectId ? { view: "project", id: agent.projectId, tab: "agents" } : { view: "home" })
            )
          }
        />
      )}
    </Screen>
  )
}

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

export const EXPORT_KIND = "zero.agent"

export function exportAgent(a: Agent) {
  const data = {
    kind: EXPORT_KIND,
    version: 1,
    name: a.name, title: a.title, description: a.description, instructions: a.instructions, model: a.model, effort: a.effort,
    failover: a.failover.map((f) => ({ model: f.model, accountId: null })),
    access: a.access
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
  if (v.kind !== EXPORT_KIND) throw new Error(t("agent.importNotAgent"))
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
    access: (["ask", "workspace", "full"] as const).find((a) => a === v.access) ?? "workspace"
  }
}

// A row that opens somewhere (Knowledge, Usage).
function LinkRow({ icon, label, hint, onPress }: { icon: ReactNode; label: string; hint?: string; onPress: () => void }) {
  return (
    <Button variant="ghost" className="h-auto justify-start gap-3 rounded-control px-3 py-3 text-left font-normal text-fg [&_svg]:text-muted" onPress={onPress}>
      {icon}
      <span className="flex min-w-0 flex-1 flex-col">
        <span>{label}</span>
        {hint && <span className="truncate text-sm text-muted">{hint}</span>}
      </span>
      <ChevronRight className="size-4" />
    </Button>
  )
}

// A kind of knowledge with its count, and up to five of its items under it.
function Group({ icon, label, count, children }: { icon: ReactNode; label: string; count: string; children: ReactNode }) {
  return (
    <div className="flex flex-col py-2">
      <div className="flex items-center gap-3 px-3 py-1.5 [&_svg]:size-4 [&_svg]:text-muted">
        {icon}
        <span className="flex-1">{label}</span>
        <span className="text-sm text-muted tabular-nums">{count}</span>
      </div>
      <div className="flex flex-col pl-7">{children}</div>
    </div>
  )
}

function Item({ text, pending, onPress }: { text: string; pending: boolean; onPress: () => void }) {
  return (
    <Button variant="ghost" className="h-auto justify-start gap-2 rounded-control px-3 py-1.5 text-left text-sm font-normal text-secondary" onPress={onPress}>
      <span className="min-w-0 flex-1 truncate">{text}</span>
      {pending && <span className="shrink-0 text-xs text-accent-text">{t("agent.pending")}</span>}
    </Button>
  )
}

