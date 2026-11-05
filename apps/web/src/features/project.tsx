// Project: overview (name, brief: the stable context of every turn, and its chats), its agents, and the
// MCP servers only its chats see. The chats themselves live in the sidebar tree.
import type { FolderListing, Project } from "@zorel/contracts"
import { formatAge, t } from "@zorel/i18n"
import { type KeyboardEvent, useEffect, useState } from "react"
import { agentsAtom, chatsAtom, mutations, projectsAtom, useList, useMutation, useStatuses } from "../client.ts"
import { chatTitle, statusLabel } from "../labels.ts"
import { go, type ProjectTab } from "../state.ts"
import { McpSection } from "./mcp.tsx"
import { AgentRow, NewAgentMenu, useDeleteAgent, useWorking } from "./agents.tsx"
import {
  ArrowLeft, ArrowRight, ArrowUp, Bot, Button, ChatStatusIcon, ChevronRight, Select, ConfirmDialog, cx, Dialog, EmptyState, Field, Folder, FolderOpen, GitBranch, IconButton, Input, Menu, MenuItem, MessageCircle, MoreHorizontal, Plus, Screen, Section, Tab,
  TabList, TabPanel, Tabs, Textarea, Trash2
} from "@/ui"

// The reason a folder was refused (WorkspaceInvalid), in words.
const REASONS = ["relative", "missing", "not_directory", "forbidden"] as const
export function folderError(e: unknown): string {
  const reason = (e as { reason?: string })?.reason
  return REASONS.includes(reason as (typeof REASONS)[number]) ? t(`workspace.invalid.${reason as (typeof REASONS)[number]}`) : String(e)
}

// New project: the sidebar's "+" opens a centred dialog that maps a folder to a project, as T3 Code does. Type a path
// from ~/ and the folders below it are listed as you go (git repositories marked); the desktop app also offers the
// system's folder picker. The name comes from the folder. The brief is written later, in the project's overview.
const desktop = (window as { zorelDesktop?: { pickFolder?: (start?: string) => Promise<string | null> } }).zorelDesktop

const baseName = (p: string) => p.replace(/\/+$/, "").split("/").pop() ?? p
const tilde = (p: string, home: string) => (p === home ? "~" : p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p)

export function NewProjectButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <IconButton label={t("nav.newProject")} size="xs" onPress={() => setOpen(true)}>
        <Plus className="size-3.5" />
      </IconButton>
      <Dialog title={t("project.addTitle")} size="lg" isOpen={open} onOpenChange={setOpen}>
        {(close) => <AddProject onDone={close} />}
      </Dialog>
    </>
  )
}

function AddProject({ onDone }: { onDone: () => void }) {
  const create = useMutation(mutations.createProject)
  const [input, setInput] = useState("~/")
  const [history, setHistory] = useState({ stack: ["~"], at: 0 }) // folders visited, for back and forward
  const [listing, setListing] = useState<FolderListing>()
  const [missing, setMissing] = useState(false)
  const [selected, setSelected] = useState(-1) // -1: nothing selected
  const [name, setName] = useState("")
  const [named, setNamed] = useState(false) // the person typed a name: stop following the folder
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  // What's typed is a folder (up to the last /) and the start of a name inside it.
  const cut = input.lastIndexOf("/")
  const dir = cut < 0 ? "~" : input.slice(0, cut) || "/"
  const partial = cut < 0 ? input : input.slice(cut + 1)
  useEffect(() => {
    const id = setTimeout(() => {
      fetch(`/api/folders?${new URLSearchParams({ dir })}`)
        .then((r) => (r.ok ? (r.json() as Promise<FolderListing>) : Promise.reject()))
        .then(
          (l) => {
            setListing(l)
            setMissing(false)
          },
          () => setMissing(true)
        )
    }, 120)
    return () => clearTimeout(id)
  }, [dir])

  const shown = (listing?.folders ?? []).filter((f) =>
    partial ? f.name.toLowerCase().startsWith(partial.toLowerCase()) : !f.name.startsWith(".")
  )
  // Typing a name selects the first match; otherwise a click or the arrows select.
  const pick = selected >= 0 ? shown[Math.min(selected, shown.length - 1)] : partial ? shown[0] : undefined
  // What gets added: the selected folder, or the folder being shown.
  const target = missing || !listing ? undefined : (pick?.path ?? (partial ? undefined : listing.dir))
  const refused = !!listing && (target === listing.home || target === "/") // the server refuses home and the root
  useEffect(() => {
    if (!named) setName(target && !refused ? baseName(target) : "")
  }, [target, refused, named])

  const show = (folder: string) => {
    setInput(folder === "/" ? "/" : `${folder}/`)
    setSelected(-1)
  }
  // Opening a folder (double click, Enter, the row's arrow, the path bar, Up) is a step back can undo.
  const open = (path: string) => {
    if (!listing) return
    const folder = tilde(path, listing.home)
    setHistory((h) => ({ stack: [...h.stack.slice(0, h.at + 1), folder], at: h.at + 1 }))
    show(folder)
  }
  const step = (by: -1 | 1) => {
    const at = history.at + by
    if (at < 0 || at >= history.stack.length) return
    setHistory({ ...history, at })
    show(history.stack[at] ?? "~")
  }
  const up = () => listing?.parent && open(listing.parent)
  const add = (path: string | null) => {
    if (!name.trim()) return
    setBusy(true)
    setError(undefined)
    create({ payload: { name: name.trim(), brief: "", path }, reactivityKeys: ["projects"] })
      .then((p) => {
        onDone()
        go({ view: "project", id: p.id, tab: "overview" })
      }, (e: unknown) => setError(folderError(e)))
      .finally(() => setBusy(false))
  }
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    const atEnd = e.currentTarget.selectionStart === input.length
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      setSelected((i) => Math.max(0, Math.min(shown.length - 1, (i < 0 && partial ? 0 : i) + (e.key === "ArrowDown" ? 1 : -1))))
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      if (target && !refused) add(target)
    } else if ((e.key === "Enter" || e.key === "Tab" || (e.key === "ArrowRight" && atEnd)) && pick) {
      e.preventDefault()
      open(pick.path)
    } else if (e.key === "ArrowLeft" && atEnd && !partial && listing?.parent) {
      e.preventDefault()
      up()
    } else if (e.key === "Enter" && target && !refused) {
      e.preventDefault()
      add(target)
    }
  }
  const browse = async () => {
    const chosen = await desktop?.pickFolder?.(listing?.dir)
    if (chosen) open(chosen)
  }

  return (
    <div className="flex flex-col">
      {/* The browser, one block: an address bar (back, forward, up, the path, the system picker) over the list. */}
      <div className="flex items-center gap-1">
        <IconButton label={t("project.back")} size="sm" isDisabled={history.at === 0} onPress={() => step(-1)}>
          <ArrowLeft />
        </IconButton>
        <IconButton label={t("project.forward")} size="sm" isDisabled={history.at >= history.stack.length - 1} onPress={() => step(1)}>
          <ArrowRight />
        </IconButton>
        <IconButton label={t("project.up")} size="sm" isDisabled={!listing?.parent} onPress={up}>
          <ArrowUp />
        </IconButton>
        <Input
          aria-label={t("project.pathLabel")}
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            setSelected(-1)
          }}
          onKeyDown={keys}
          placeholder={t("project.pathPlaceholder")}
          spellCheck={false}
          autoFocus
          className="ml-1 h-control-sm min-w-0 flex-1 font-mono text-sm"
        />
        {desktop?.pickFolder && (
          <IconButton label={t("project.browse")} size="sm" onPress={() => void browse()}>
            <FolderOpen />
          </IconButton>
        )}
      </div>
      <div role="listbox" aria-label={t("project.pathLabel")} className="mt-2 flex h-64 flex-col gap-px overflow-y-auto rounded-card border border-subtle p-1">
        {shown.length === 0 && <p className="px-2.5 py-2 text-sm text-dim">{t("project.noFolders")}</p>}
        {shown.map((f, i) => (
          <div
            key={f.path}
            role="option"
            aria-selected={f === pick}
            tabIndex={-1}
            onMouseDown={(e) => {
              e.preventDefault() // keep the path field's focus: the keyboard works from there
              setSelected(i)
            }}
            onDoubleClick={() => open(f.path)}
            className={cx("group flex h-control-sm shrink-0 cursor-default items-center gap-2.5 rounded-control pr-1 pl-2.5", f === pick ? "bg-accent-soft text-fg" : "text-secondary hover:bg-hover")}
          >
            <span className={cx("flex size-4 shrink-0 items-center justify-center [&_svg]:size-4", f === pick ? "text-accent-text" : "text-muted")}>{f.git ? <GitBranch /> : <Folder />}</span>
            <span className="min-w-0 flex-1 truncate">{f.name}</span>
            {f.git && <span className="text-xs text-dim">{t("project.gitRepo")}</span>}
            {/* Opening is always one double click away; the arrow shows where the pointer or the selection is. */}
            <IconButton
              label={t("project.open", { name: f.name })}
              size="xs"
              onPress={() => open(f.path)}
              className={cx("text-muted", f === pick ? "opacity-100" : "opacity-0 group-hover:opacity-100 data-focus-visible:opacity-100")}
            >
              <ChevronRight />
            </IconButton>
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-dim">{t("project.pathHint")}</p>

      <div className="mt-5">
        <Field
          label={t("project.name")}
          hint={refused ? <span className="text-warning">{t("project.chooseInside")}</span> : target && listing ? t("project.adds", { path: tilde(target, listing.home) }) : undefined}
        >
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setNamed(true)
            }}
            maxLength={80}
          />
        </Field>
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}

      <div className="mt-6 flex items-center gap-2">
        <Button variant="ghost" size="sm" isDisabled={busy || !name.trim()} onPress={() => add(null)} className="-ml-2 text-muted">
          {t("project.withoutFolder")}
        </Button>
        <span className="ml-auto flex gap-2">
          <Button variant="ghost" onPress={onDone}>
            {t("common.cancel")}
          </Button>
          <Button variant="default" isPending={busy} isDisabled={busy || !target || refused || !name.trim()} onPress={() => target && add(target)}>
            {t("project.add")}
          </Button>
        </span>
      </div>
    </div>
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
  const [path, setPath] = useState(project.path ?? "")
  const [pathError, setPathError] = useState<string>()
  useEffect(() => {
    setName(project.name)
    setBrief(project.brief)
    setPath(project.path ?? "")
    setPathError(undefined)
  }, [project])
  const dirty = name !== project.name || brief !== project.brief || path.trim() !== (project.path ?? "")
  return (
    <div className="flex flex-col gap-8">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          setPathError(undefined)
          update({ params: { id: project.id }, payload: { name: name.trim(), brief, path: path.trim() || null }, reactivityKeys: ["projects"] }).catch((e: unknown) =>
            setPathError(folderError(e))
          )
        }}
      >
        <Field label={t("project.name")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
        </Field>
        <Field label={t("workspace.folder")} hint={pathError ? <span className="text-danger">{pathError}</span> : t("workspace.folderHint")}>
          <Input value={path} onChange={(e) => setPath(e.target.value)} placeholder={t("workspace.folderPlaceholder")} spellCheck={false} className="font-mono" />
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
  const project = useList(projectsAtom).find((p) => p.id === projectId)
  const update = useMutation(mutations.updateProject)
  const choices = agents.filter((a) => !a.builtin && (a.projectId === projectId || a.projectId === null))
  const working = useWorking()
  const del = useDeleteAgent()
  return (
    <Section
      title={t("project.agents")}
      action={
        <NewAgentMenu projectId={projectId} />
      }
    >
      {/* Who a new chat in the project starts with. */}
      <Field label={t("project.defaultAgent")} hint={t("project.defaultAgentHint")}>
        <Select
          aria-label={t("project.defaultAgent")}
          value={project?.defaultAgentId ?? ""}
          onChange={(v) => void update({ params: { id: projectId }, payload: { defaultAgentId: v || null }, reactivityKeys: ["projects"] })}
          options={[{ value: "", label: t("common.assistant") }, ...choices.map((a) => ({ value: a.id, label: a.title ? `${a.name} · ${a.title}` : a.name }))]}
        />
      </Field>
      {mine.length === 0 ? (
        <EmptyState icon={<Bot />} title={t("project.noAgents")} hint={t("project.noAgentsHint")} />
      ) : (
        <div className="flex flex-col divide-y divide-subtle border-y border-subtle">
          {mine.map((a) => (
            <AgentRow key={a.id} agent={a} agents={agents} working={working.has(a.id)} onDelete={del.ask} />
          ))}
        </div>
      )}
      {del.dialog}
    </Section>
  )
}
