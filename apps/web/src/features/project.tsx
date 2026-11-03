// Project: overview (name, brief: the stable context of every turn, and its chats), its agents, and the
// MCP servers only its chats see. The chats themselves live in the sidebar tree.
import type { Project } from "@zero/contracts"
import { formatAge, t } from "@zero/i18n"
import { type FormEvent, useEffect, useState } from "react"
import { agentsAtom, chatsAtom, mutations, useList, useMutation, useStatuses } from "../client.ts"
import { agentTone, chatTitle, modelLabel, statusLabel } from "../labels.ts"
import { go, type ProjectTab } from "../state.ts"
import { McpSection } from "./mcp.tsx"
import {
  AgentAvatar, Bot, Button, ChatStatusIcon, ChevronRight, ConfirmDialog, EmptyState, Field, IconButton, Input, Menu, MenuItem, MessageCircle, MoreHorizontal, Plus, Popover, Screen, Section, Tab,
  TabList, TabPanel, Tabs, Textarea, Trash2
} from "@/ui"

// New project: a small popover from the sidebar's "+" (name and an optional brief), not a page.
// The brief can be written later in the project's overview.
export function NewProjectButton() {
  const create = useMutation(mutations.createProject)
  const [name, setName] = useState("")
  const [brief, setBrief] = useState("")
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    create({ payload: { name: name.trim(), brief }, reactivityKeys: ["projects"] })
      .then((p) => {
        setOpen(false)
        setName("")
        setBrief("")
        go({ view: "project", id: p.id, tab: "overview" })
      })
      .finally(() => setBusy(false))
  }
  return (
    <Popover
      label={t("project.newTitle")}
      placement="bottom start"
      className="w-80"
      isOpen={open}
      onOpenChange={setOpen}
      trigger={
        <IconButton label={t("nav.newProject")} size="sm">
          <Plus className="size-3.5" />
        </IconButton>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-3 p-4">
        <p className="font-semibold">{t("project.newTitle")}</p>
        <Field label={t("project.name")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required autoFocus />
        </Field>
        <Field label={t("project.brief")} hint={t("project.briefHintShort")}>
          <Textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={3} maxLength={8000} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onPress={() => setOpen(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="default" isPending={busy} isDisabled={busy || !name.trim()}>
            {t("project.create")}
          </Button>
        </div>
      </form>
    </Popover>
  )
}

export function ProjectView({ project, tab }: { project: Project; tab: ProjectTab }) {
  const remove = useMutation(mutations.removeProject)
  const [confirm, setConfirm] = useState(false)
  return (
    <Screen
      title={project.name}
      actions={
        <>
          <Button size="sm" variant="default" onPress={() => go({ view: "home", projectId: project.id })}>
            <Plus />
            {t("nav.newChat")}
          </Button>
          <Menu
            label={t("common.more")}
            trigger={
              <IconButton label={t("common.more")}>
                <MoreHorizontal />
              </IconButton>
            }
          >
            <MenuItem icon={<Trash2 />} tone="danger" onAction={() => setConfirm(true)}>
              {t("project.deleteAction")}
            </MenuItem>
          </Menu>
        </>
      }
    >
      <Tabs selectedKey={tab} onSelectionChange={(k) => go({ view: "project", id: project.id, tab: k as ProjectTab })} className="mx-auto w-full max-w-2xl gap-6 px-8 py-6">
        <TabList label={project.name}>
          <Tab id="overview">{t("project.overview")}</Tab>
          <Tab id="agents">{t("project.agents")}</Tab>
          <Tab id="tools">{t("project.tools")}</Tab>
        </TabList>
        <TabPanel id="overview">
          <Overview key={project.id} project={project} />
        </TabPanel>
        <TabPanel id="agents">
          <Agents projectId={project.id} />
        </TabPanel>
        <TabPanel id="tools">
          <McpSection projectId={project.id} />
        </TabPanel>
      </Tabs>
      <ConfirmDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title={t("project.deleteTitle", { name: project.name })}
        description={t("project.deleteBody")}
        onConfirm={() => void remove({ params: { id: project.id }, reactivityKeys: ["projects", "agents", "chats", "memories"] }).then(() => go({ view: "home" }))}
      />
    </Screen>
  )
}

function Overview({ project }: { project: Project }) {
  const update = useMutation(mutations.updateProject)
  const chats = useList(chatsAtom).filter((c) => c.projectId === project.id)
  const agents = useList(agentsAtom)
  const statuses = useStatuses()
  const [name, setName] = useState(project.name)
  const [brief, setBrief] = useState(project.brief)
  useEffect(() => {
    setName(project.name)
    setBrief(project.brief)
  }, [project])
  const dirty = name !== project.name || brief !== project.brief
  return (
    <div className="flex flex-col gap-8">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void update({ params: { id: project.id }, payload: { name: name.trim(), brief }, reactivityKeys: ["projects"] })
        }}
      >
        <Field label={t("project.name")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
        </Field>
        <Field label={t("project.brief")} hint={t("project.briefHint")}>
          <Textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={7} maxLength={8000} />
        </Field>
        {dirty && (
          <div className="flex items-center gap-3">
            <Button type="submit" variant="default" isDisabled={!name.trim()}>
              {t("common.save")}
            </Button>
            <span className="text-sm text-muted">{t("project.unsaved")}</span>
          </div>
        )}
      </form>
      <Section title={t("project.chats")}>
        {chats.length === 0 ? (
          <p className="text-muted">{t("project.noChats")}</p>
        ) : (
          <div className="flex flex-col divide-y divide-subtle border-y border-subtle">
            {[...chats]
              .sort((a, b) => b.createdAt - a.createdAt)
              .map((c) => {
                const s = statuses[c.id]
                const live = s && s.state !== "idle" ? s : undefined
                return (
                  <Button key={c.id} variant="ghost" className="h-11 justify-start gap-3 rounded-none px-1 font-normal text-fg" onPress={() => go({ view: "chat", id: c.id })}>
                    {live ? <ChatStatusIcon state={live.state === "idle" ? "running" : live.state} /> : <MessageCircle className="text-muted" />}
                    <span className="min-w-0 flex-1 truncate text-left">{chatTitle(c)}</span>
                    <span className="shrink-0 text-sm text-muted">{live ? statusLabel(live, agents) : formatAge(c.createdAt)}</span>
                  </Button>
                )
              })}
          </div>
        )}
      </Section>
    </div>
  )
}

function Agents({ projectId }: { projectId: string }) {
  const agents = useList(agentsAtom)
  const mine = agents.filter((a) => a.projectId === projectId)
  return (
    <Section
      title={t("project.agents")}
      action={
        <Button size="sm" variant="secondary" onPress={() => go({ view: "new-agent", projectId })}>
          <Plus />
          {t("nav.newAgent")}
        </Button>
      }
    >
      {mine.length === 0 ? (
        <EmptyState icon={<Bot />} title={t("project.noAgents")} hint={t("project.noAgentsHint")} />
      ) : (
        <div className="flex flex-col divide-y divide-subtle border-y border-subtle">
          {mine.map((a) => (
            <Button key={a.id} variant="ghost" className="h-14 justify-start gap-3 rounded-none px-1 font-normal text-fg" onPress={() => go({ view: "agent", id: a.id })}>
              <AgentAvatar id={a.id} name={a.name} tone={agentTone(a, agents)} size={28} />
              <span className="flex min-w-0 flex-1 flex-col text-left">
                <span className="truncate font-medium">{a.name}</span>
                {a.instructions.trim() && <span className="truncate text-sm text-muted">{a.instructions.trim().split("\n")[0]}</span>}
              </span>
              <span className="shrink-0 text-sm text-muted">{modelLabel(a.model)}</span>
              <ChevronRight className="text-muted" />
            </Button>
          ))}
        </div>
      )}
    </Section>
  )
}
