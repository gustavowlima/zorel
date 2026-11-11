// Chat (prototype "Main"): header with the team, the conversation as a timeline (your messages on the
// right, each agent's reply with its activity pill, approvals waiting for you, handoffs between agents),
// and the message box. State is the chat atom: snapshot + live events, so a turn keeps going if the tab
// closes and the screen catches up when it reopens.
import { type Agent, type Chat, type FailoverTarget, type Memory, type Message, type ProviderAccount, skillHandle, type WorkspaceFile, workSteps } from "@zorel/contracts"
import { useAtomRefresh, useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import { type Approval, ErrorCode, isInterruption, type WorkStep } from "@zorel/contracts/events"
import { formatCompact, formatDuration, formatTime, locale, t } from "@zorel/i18n"
import { memo, type ReactNode, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { accountsAtom, agentsAtom, attachmentUrl, chatAtom, commandsAtom, filesAtom, memoriesAtom, type ChatState, type LiveTurn, mutations, type Note, projectsAtom, type Receipt, teamsAtom, uploadAttachment, useChat, useList, useInvalidate, useMutation } from "../client.ts"
import { agentName, agentTint, chatTitle, formatCost, handleOf, modelLabel, providerLabel, splitModel, switchText, waitLabel } from "../labels.ts"
import { ChatMarkdown } from "./chat-markdown.tsx"
import { MemoryChip } from "./memory.tsx"
import { MentionText } from "./mention.tsx"
import { commandOf, extraArgs } from "./receipt-args.ts"
import { go, liveStepsOpen } from "../state.ts"
import { agentOptions, callable, teamsIn, toJoin } from "./agent-options.ts"
import { Composer, type ComposerOption, type ComposerSources, SendError } from "./composer.tsx"
import { ContextMeter } from "./context-meter.tsx"
import { QueuePanel, useQueue } from "./queue.tsx"
import { TaskDrawer, useTaskLinks } from "./task-drawer.tsx"
import { FailoverEditor, useTermsPending } from "./failover.tsx"
import { chatDelta, Delta, type Focus, PinItem, type Pins, RunControl, type ShellPin, SIDE_ICON, SidePanel, type SideTab, sideLabel, TurnChanges, usePins } from "./workspace.tsx"
import { ModelPicker } from "./model-picker.tsx"
import { AccessChip } from "./access-chip.tsx"
import { GitControl } from "./git.tsx"
import { ContextMenu, Drawer, Fold, HEADER, PageHeader } from "@/ui"
import { AuthorAvatar, TeamPicker } from "./people.tsx"
import { ChatProcesses } from "./processes.tsx"
import { QuestionAnswer } from "./question.tsx"
import {
  Button, Check, ChevronDown, CircleAlert, CircleCheck, CircleX, Clock, ConfirmDialog, Copy, cn, Dialog, DisclosurePill, EmptyState, Field, File, IconButton, ImageViewer, Info, Input, Menu, MenuItem,
  MenuSeparator, MessageCircle, MessageCircleQuestion, ShieldAlert, Minimize2, MoreHorizontal, PanelRight, Pencil, RefreshCw, Search, Shuffle, Sparkles, Spinner, Square, SquarePen, SquareTerminal, StepHead, StepList, StepNote, StepRow, Switch, Tooltip, Trash2, Users, Wrench, FileText
} from "@/ui"
import { interleave, kindOf, type SummaryKind, type SummaryStep, summarize } from "./steps.ts"

export function ChatView({ chat, at }: { chat: Chat; at?: string | undefined }) {
  const state = useChat(chat.id)
  const agents = useList(agentsAtom)
  const send = useMutation(mutations.send)
  const steer = useMutation(mutations.steer)
  const interrupt = useMutation(mutations.interrupt)
  const updateChat = useMutation(mutations.updateChat)
  const team = chat.agentIds.flatMap((id) => agents.find((a) => a.id === id) ?? [])
  const busy = state.pending > 0 || !!state.live

  const sendNow = useCallback(
    (text: string, attachmentIds: ReadonlyArray<string>) =>
      send({ payload: { chatId: chat.id, clientId: crypto.randomUUID(), text, ...(attachmentIds.length && { attachmentIds }) } }),
    [send, chat.id]
  )
  // While a turn runs, a new message waits in the queue (above the box) and goes out when the chat is free.
  const queue = useQueue(chat.id, busy, state.ready, sendNow)
  // What "Send now" did, said once for a few seconds above the queue.
  const [sent, setSent] = useState<"queue.sentJoined" | "queue.sentStopped" | null>(null)
  useEffect(() => {
    if (!sent) return
    const timer = setTimeout(() => setSent(null), 6000)
    return () => clearTimeout(timer)
  }, [sent])
  // The agents "#" and "@" offer: everyone this chat can use. One that is not in the chat yet joins it when a
  // message naming it is sent (not when picked, so a chip taken back leaves no stray member): the server only calls
  // members, so the send waits for that. The lead and the model stay.
  const available = callable(agents, chat.projectId)
  // A team named with @ (spec 010) brings its members in; the server routes the message to the one who fits.
  const teams = teamsIn(useList(teamsAtom), chat.projectId)
  const submit = async (text: string, attachmentIds: ReadonlyArray<string>) => {
    const joining = toJoin(text, chat.agentIds, available, teams)
    if (joining.length) {
      try {
        await updateChat({ params: { id: chat.id }, payload: { agentIds: [...chat.agentIds, ...joining.map((a) => a.id)] }, reactivityKeys: ["chats", "context"] })
      } catch {
        throw new SendError(t("chat.addFailed"))
      }
    }
    if (!busy && !queue.items.length) return sendNow(text, attachmentIds)
    queue.add(text, attachmentIds)
  }
  // A queued message brought back to the box remounts it with that text.
  const [draft, setDraft] = useState<{ key: number; text: string }>({ key: 0, text: "" })
  // "Edit from here": the message picked, until the dialog closes.
  const [rewind, setRewind] = useState<Message>()
  const refreshChat = useAtomRefresh(chatAtom(chat.id))
  // Text others add to the box (a terminal selection), after what is typed.
  const insertRef = useRef<((text: string) => void) | undefined>(undefined)
  const second = team[1]
  const projects = useList(projectsAtom)
  const project = projects.find((p) => p.id === chat.projectId)
  // What opens beside the chat, one at a time: the side panel on a tab (Changes, Files, Browser, Terminal), or a task
  // a teammate was given from here.
  const [drawer, setDrawer] = useState<{ panel: SideTab } | { task: string }>()
  const panel = drawer && "panel" in drawer ? drawer.panel : undefined
  const setPanel = (tab: SideTab | undefined) => setDrawer(tab && { panel: tab })
  const openTask = (task: string) => setDrawer({ task })
  const taskLink = useTaskLinks(chat, openTask)
  const pins = usePins(chat.id)
  // A turn ended: an agent may have created or changed a teammate (zorel_create_agent / zorel_update_agent).
  const invalidate = useInvalidate()
  const turns = state.messages.length
  useEffect(() => {
    if (turns) invalidate(["agents"])
  }, [turns, invalidate])
  const [shellFocus, setShellFocus] = useState<{ session: string }>() // a new object each time a pinned shell is pressed
  const [browserUrl, setBrowserUrl] = useState<{ url: string }>() // a new object each time, so the same URL opens again
  const openInBrowser = (url: string) => {
    setBrowserUrl({ url })
    setPanel("browser")
  }
  // An agent started a preview (zorel_preview): its page is the chat's active tab, so the Browser panel opens on it.
  // Once per preview: the person may close the panel afterwards.
  const shownPreviews = useRef(new Set<string>())
  const previewDone = state.live?.steps.find((st) => st.tool === "zorel_preview" && st.status === "ok" && !shownPreviews.current.has(st.id))
  useEffect(() => {
    if (!previewDone) return
    shownPreviews.current.add(previewDone.id)
    setDrawer({ panel: "browser" })
  }, [previewDone])
  const [focus, setFocus] = useState<Focus>()
  const view = (f: Focus) => {
    setFocus(f)
    setPanel("changes")
  }
  const consolidate = useMutation(mutations.consolidate)
  const compact = () => void consolidate({ params: { id: chat.id }, reactivityKeys: ["chats", "memories", "context"] }).catch(() => undefined)
  const newChat = () => go(chat.projectId ? { view: "home", projectId: chat.projectId } : { view: "home" })
  const memories = useList(memoriesAtom)
  const engineCommands = AsyncResult.getOrElse(useAtomValue(commandsAtom(chat.id)), () => [])
  // What "@", "$" and "/" offer in this chat: its agents, the skills it can use, Zorel's commands.
  const scopes = new Set(["user", ...(chat.projectId ? [`project:${chat.projectId}`] : []), ...chat.agentIds.map((id) => `agent:${id}`)])
  // "#" and "@" call an agent: every one this chat can use (its members first; the rest join it when the message is sent).
  const people: ComposerOption[] = agentOptions(available, chat.agentIds, { member: (a) => a.title || modelLabel(a.model), outside: t("composer.addToChat") }).map((o) => ({
    id: o.id,
    label: o.label,
    hint: o.hint,
    icon: <AuthorAvatar agent={o.agent} model={null} size={16} />,
    tint: agentTint(o.agent, agents)
  }))
  // Then the teams: `@team` reaches the member who fits.
  for (const x of teams) people.push({ id: x.handle, label: x.name, hint: t("teams.option", { count: x.agentIds.length }), icon: <Users className="size-4" /> })
  const sourcesWith = (files: ReadonlyArray<WorkspaceFile>): ComposerSources => ({
    leads: people,
    // "@": the agents, then the project's files (the agent reads them with its tools).
    agents: [...people, ...files.filter((f) => f.status !== "deleted").map((f) => ({ id: f.path, label: f.path, hint: t("composer.file"), icon: <File className="size-4" /> }))],
    skills: memories.filter((m) => m.kind === "skill" && m.state === "active" && scopes.has(m.scope)).map((m) => ({ id: skillHandle(m.title), label: m.title, icon: <Sparkles className="size-4" /> })),
    commands: [
      { id: "compact", label: t("composer.command.compact"), hint: t("composer.command.compactHint"), icon: <Minimize2 className="size-4" />, run: compact },
      { id: "new", label: t("composer.command.newChat"), hint: t("composer.command.newChatHint"), icon: <SquarePen className="size-4" />, run: newChat },
      { id: "changes", label: t("composer.command.changes"), hint: t("composer.command.changesHint"), icon: <PanelRight className="size-4" />, run: () => setPanel("changes") },
      ...(project?.path ? [{ id: "terminal", label: t("composer.command.terminal"), hint: t("composer.command.terminalHint"), icon: <SquareTerminal className="size-4" />, run: () => setPanel("terminal") }] : []),
      // Then Claude Code's own (built-in, the user's, the project's): written into the message, run by the CLI.
      ...engineCommands.map((c) => ({ id: c.name, label: `/${c.name}${c.argumentHint ? ` ${c.argumentHint}` : ""}`, hint: c.description, icon: <SquareTerminal className="size-4" /> }))
    ]
  })

  return (
    <section aria-label={t("chat.label")} className="flex h-full min-h-0 flex-col">
      <ChatHeader
        chat={chat}
        team={team}
        delta={chatDelta(state.messages)}
        panelOpen={!!panel}
        onPanel={() => setPanel(panel ? undefined : "changes")}
        workspace={!!project?.path}
        pins={pins}
        panel={panel}
        onSide={(tab) => setPanel(panel === tab ? undefined : tab)}
        onShell={(pin) => {
          setShellFocus({ session: pin.session })
          setPanel("terminal")
        }}
        onRun={openInBrowser}
      />
      <div className="flex min-h-0 flex-1">
      {/* Catches clicks on this chat's task links inside the transcript (they stay links: a link's Enter is a click). */}
      <div className="flex min-w-0 flex-1 flex-col" onClickCapture={taskLink}>
      <Timeline chat={chat} state={state} agents={agents} onView={view} onEdit={setRewind} onStop={() => void interrupt({ payload: { chatId: chat.id } })} at={at} />
      <RewindDialog
        chatId={chat.id}
        message={rewind}
        changes={rewind ? state.messages.some((m) => m.at >= rewind.at && m.changes.length && !m.revertedAt) : false}
        onClose={() => setRewind(undefined)}
        onDone={(text) => {
          refreshChat()
          setDraft((d) => ({ key: d.key + 1, text }))
        }}
      />
      <div className="w-full px-8 pt-2 pb-4.5">
        <div className="mx-auto w-full max-w-chat">
        <PendingTray approvals={state.approvals} />
        {chat.resumeAt && (
          // Every route hit its usage limit: the chat goes on by itself at the reset (or you cancel, or write).
          <div role="status" className="mb-2 flex items-center gap-3 rounded-card border border-subtle px-3.5 py-2 text-sm">
            <Clock className="size-4 shrink-0 text-warning" />
            <span className="flex-1 text-secondary">{t("chat.resumesAt", { time: formatTime(chat.resumeAt) })}</span>
            <Button size="sm" variant="ghost" onPress={() => void updateChat({ params: { id: chat.id }, payload: { resumeAt: null }, reactivityKeys: ["chats"] })}>
              {t("common.cancel")}
            </Button>
          </div>
        )}
        {/* An agent here waiting on teammates: their answers to its @mention, or a task it gave (opens that chat). */}
        {state.status?.waits?.map((w) => (
          <div key={w.taskChatId ?? `${w.agentId}:mention`} role="status" className="mb-2 flex items-center gap-3 rounded-card border border-subtle px-3.5 py-2 text-sm">
            <Clock className="size-4 shrink-0 text-muted" />
            <span className="flex-1 text-secondary">{waitLabel(w, agents)}</span>
            {w.taskChatId && (
              <Button size="sm" variant="ghost" onPress={() => openTask(w.taskChatId!)}>
                {t("status.openTask")}
              </Button>
            )}
          </div>
        ))}
        {sent && (
          <p role="status" className="mx-3 mb-1 text-xs text-dim">
            {t(sent)}
          </p>
        )}
        <QueuePanel
          items={queue.items}
          busy={busy}
          ahead={state.pending}
          // Claude and Codex take a message into the reply in progress (not with attachments); any other engine stops it.
          joinsTurn={(item) => !item.attachmentIds.length && ["claude-cli", "codex-cli"].includes(splitModel(state.live?.model ?? chat.model).provider)}
          onSendNow={(item) => {
            queue.remove(item.id)
            // If the server refuses it, it goes back to the queue instead of vanishing.
            steer({ payload: { chatId: chat.id, text: item.text, ...(item.attachmentIds.length && { attachmentIds: item.attachmentIds }) } }).then(
              (r) => setSent(r.joined ? "queue.sentJoined" : "queue.sentStopped"),
              () => queue.add(item.text, item.attachmentIds)
            )
          }}
          onEdit={(item) => {
            queue.remove(item.id)
            setDraft((d) => ({ key: d.key + 1, text: item.text }))
          }}
          onRemove={(item) => queue.remove(item.id)}
        />
        <WithFiles projectId={project?.path ? project.id : undefined} chatId={chat.id}>
          {(files) => (
            <Composer
              key={`${chat.id}:${draft.key}`}
              autoFocus
              initialText={draft.text}
              insertRef={insertRef}
              sources={sourcesWith(files)}
              busy={busy}
              onStop={() => void interrupt({ payload: { chatId: chat.id } })}
              onSubmit={submit}
              upload={(f) => uploadAttachment(chat.id, f)}
              placeholder={team[0] && second ? t("composer.placeholderTeam", { name: (followUpOf(state.messages, team) ?? team[0]).name }) : t("composer.placeholder")}
              tools={
                <>
                  <ModelPicker
                    value={{ model: chat.model, accountId: chat.accountId, effort: chat.effort }}
                    onChange={(v) => void updateChat({ params: { id: chat.id }, payload: v, reactivityKeys: ["chats", "context"] })}
                  />
                  <AccessChip chat={chat} />
                  <span className="ml-auto flex">
                    <ContextMeter chatId={chat.id} onCompact={compact} onNewChat={newChat} />
                  </span>
                </>
              }
            />
          )}
        </WithFiles>
        </div>
      </div>
      </div>
      <Drawer open={!!panel}>
        {panel && (
        <SidePanel
          chat={chat}
          project={project}
          messages={state.messages}
          agents={agents}
          tab={panel}
          onTab={setPanel}
          focus={focus}
          onFocus={setFocus}
          onClose={() => setPanel(undefined)}
          browserUrl={browserUrl}
          onOpenUrl={openInBrowser}
          onAddToChat={(text) => insertRef.current?.(text)}
          pins={pins}
          shellFocus={shellFocus}
        />
        )}
      </Drawer>
      <TaskDrawer chat={chat} taskId={drawer && "task" in drawer ? drawer.task : undefined} onClose={() => setDrawer(undefined)} />
      </div>
    </section>
  )
}

// Who a message that names no one goes to, as the server decides it (runtime followUp): the teammate you named last
// time if it answered you, else the lead.
function followUpOf(messages: ReadonlyArray<Message>, team: ReadonlyArray<Agent>): Agent | undefined {
  const mine = messages.flatMap((m, i) => (m.role === "user" ? [i] : []))
  const last = mine.at(-1)
  if (last === undefined) return undefined
  const named = team.filter((a) => new RegExp(`(^|\\s)@${handleOf(a)}\\b`, "i").test(messages[last]!.text))
  const answered = messages.slice(last + 1).filter((m) => m.role === "assistant").at(-1)
  const who = named.find((a) => a.id === answered?.agentId)
  return who && who.id !== team[0]?.id ? who : undefined
}

// The project's files for "@" (only a project with a folder has them; read once, kept fresh by the workspace key).
function WithFiles({ projectId, chatId, children }: { projectId: string | undefined; chatId: string; children: (files: ReadonlyArray<WorkspaceFile>) => ReactNode }) {
  return projectId ? <FilesOf projectId={projectId} chatId={chatId}>{children}</FilesOf> : children([])
}
function FilesOf({ projectId, chatId, children }: { projectId: string; chatId: string; children: (files: ReadonlyArray<WorkspaceFile>) => ReactNode }) {
  return children(AsyncResult.getOrElse(useAtomValue(filesAtom(projectId, chatId)), () => []))
}

// ---------- header ----------

function ChatHeader({
  chat,
  team,
  delta,
  panelOpen,
  onPanel,
  workspace,
  pins,
  panel,
  onSide,
  onShell,
  onRun
}: {
  chat: Chat
  team: ReadonlyArray<Agent>
  delta: { added: number; removed: number }
  panelOpen: boolean
  onPanel: () => void
  workspace: boolean
  pins: Pins
  panel: SideTab | undefined
  onSide: (tab: SideTab) => void
  onShell: (pin: ShellPin) => void
  onRun: (url: string) => void
}) {
  const projects = useList(projectsAtom)
  const project = projects.find((p) => p.id === chat.projectId)
  const update = useMutation(mutations.updateChat)
  const remove = useMutation(mutations.removeChat)
  const [dialog, setDialog] = useState<"rename" | "delete" | "failover">()

  return (
    <>
      <PageHeader className={cn(HEADER, "gap-x-3")}>
        <div className="flex min-w-0 flex-1 items-baseline gap-3">
          <h1 className="truncate text-lg font-semibold">{chatTitle(chat)}</h1>
          <Button size="sm" variant="ghost" className="-ml-2 shrink-0 text-muted" onPress={() => go(project ? { view: "project", id: project.id, tab: "overview" } : { view: "home" })}>
            {project?.name ?? t("common.general")}
          </Button>
        </div>
        {/* What was pinned from the side panel (a tab, a shell): one press opens it there. Right-click unpins. */}
        {(pins.side.length > 0 || pins.shells.length > 0) && (
          <ContextMenu
            label={t("workspace.pinned")}
            className="flex items-center gap-1"
            menuFor={(el) => {
              const b = el.closest<HTMLElement>("[data-pin]")
              if (!b) return undefined
              const [kind, id] = (b.dataset.pin ?? "").split(":") as [string, string]
              return (
                <PinItem
                  pinned
                  onAction={() => (kind === "side" ? pins.toggleSide(id as SideTab) : pins.toggleShell({ session: id, label: "" }))}
                />
              )
            }}
          >
            {pins.side
              .filter((tab) => workspace || (tab !== "files" && tab !== "terminal" && tab !== "git"))
              .map((tab) => {
                // Pinned Git shows the branch and what is pending (it stays out of the title row unless pinned).
                if (tab === "git")
                  return (
                    <span key={tab} data-pin="side:git" className="contents">
                      <GitControl chat={chat} open={panel === "git"} onOpen={() => onSide("git")} />
                    </span>
                  )
                const Icon = SIDE_ICON[tab]
                return (
                  <Button key={tab} data-pin={`side:${tab}`} size="sm" variant={panel === tab ? "secondary" : "ghost"} aria-pressed={panel === tab} onPress={() => onSide(tab)} shape="pill">
                    <Icon />
                    {sideLabel(tab)}
                  </Button>
                )
              })}
            {workspace &&
              pins.shells.map((pin) => (
                <Button key={pin.session} data-pin={`shell:${pin.session}`} size="sm" variant="ghost" onPress={() => onShell(pin)} shape="pill" className="max-w-40">
                  <SquareTerminal />
                  <span className="truncate">{pin.label}</span>
                </Button>
              ))}
          </ContextMenu>
        )}
        {workspace && <RunControl chatId={chat.id} onOpen={onRun} />}
        <ChatProcesses chatId={chat.id} />
        <TeamPicker chat={chat} />
        {/* One control for the side panel, after the agents (Changes, Files, Browser, Terminal live in its tabs); what
            this chat changed shows on it. */}
        <Tooltip content={panelOpen ? t("workspace.closePanel") : t("workspace.openPanel")}>
          <Button size="sm" variant={panelOpen ? "secondary" : "ghost"} aria-expanded={panelOpen} aria-label={panelOpen ? t("workspace.closePanel") : t("workspace.openPanel")} onPress={onPanel} shape="pill">
            <PanelRight />
            {delta.added + delta.removed > 0 && <Delta {...delta} />}
          </Button>
        </Tooltip>
        <Menu
          label={t("common.more")}
          trigger={
            <IconButton label={t("common.more")}>
              <MoreHorizontal />
            </IconButton>
          }
        >
          <MenuItem icon={<Pencil />} onAction={() => setDialog("rename")}>
            {t("common.rename")}
          </MenuItem>
          <MenuItem icon={<Shuffle />} onAction={() => setDialog("failover")}>
            {t("failover.menu")}
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={<Trash2 />} tone="danger" onAction={() => setDialog("delete")}>
            {t("common.delete")}
          </MenuItem>
        </Menu>
      </PageHeader>
      <FailoverDialog isOpen={dialog === "failover"} onClose={() => setDialog(undefined)} chat={chat} lead={team[0]} />
      <RenameDialog isOpen={dialog === "rename"} onClose={() => setDialog(undefined)} title={chatTitle(chat)} onSave={(title) => void update({ params: { id: chat.id }, payload: { title }, reactivityKeys: ["chats"] })} />
      <ConfirmDialog
        isOpen={dialog === "delete"}
        onOpenChange={(open) => !open && setDialog(undefined)}
        title={t("chat.deleteTitle")}
        description={t("chat.deleteBody")}
        onConfirm={() =>
          void remove({ params: { id: chat.id }, reactivityKeys: ["chats"] }).then(() => go(chat.projectId ? { view: "home", projectId: chat.projectId } : { view: "home" }))
        }
      />
    </>
  )
}

// The chat's own fallbacks for its lead, or the lead agent's list (chat.failover null).
function FailoverDialog({ isOpen, onClose, chat, lead }: { isOpen: boolean; onClose: () => void; chat: Chat; lead: Agent | undefined }) {
  const update = useMutation(mutations.updateChat)
  const [own, setOwn] = useState(chat.failover !== null || !lead)
  const [list, setList] = useState<ReadonlyArray<FailoverTarget>>(chat.failover ?? lead?.failover ?? [])
  const primary = { model: chat.model, accountId: chat.accountId }
  const pending = useTermsPending(primary, own ? list : [])
  useEffect(() => {
    if (!isOpen) return
    setOwn(chat.failover !== null || !lead)
    setList(chat.failover ?? lead?.failover ?? [])
  }, [isOpen, chat.failover, lead])
  return (
    <Dialog title={t("failover.title")} size="lg" isOpen={isOpen} onOpenChange={(open) => !open && onClose()}>
      {(close) => (
        <div className="flex flex-col gap-4">
          <p className="text-muted">{t("failover.intro")}</p>
          {lead && (
            <Switch isSelected={!own} onChange={(useAgent) => setOwn(!useAgent)}>
              {t("failover.useAgent")}
            </Switch>
          )}
          {own ? <FailoverEditor primary={primary} value={list} onChange={setList} /> : <FailoverEditor primary={primary} value={lead?.failover ?? []} onChange={(v) => {
                setOwn(true)
                setList(v)
              }} />}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onPress={close}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="default"
              isDisabled={pending}
              onPress={() => {
                void update({ params: { id: chat.id }, payload: { failover: own ? list : null }, reactivityKeys: ["chats"] })
                close()
              }}
            >
              {t("common.save")}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  )
}

export function RenameDialog({ isOpen, onClose, title, onSave }: { isOpen: boolean; onClose: () => void; title: string; onSave: (title: string) => void }) {
  const [value, setValue] = useState(title)
  useEffect(() => {
    if (isOpen) setValue(title)
  }, [isOpen, title])
  return (
    <Dialog title={t("chat.renameTitle")} isOpen={isOpen} onOpenChange={(open) => !open && onClose()}>
      {(close) => (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!value.trim()) return
            onSave(value.trim())
            close()
          }}
        >
          <Field label={t("chat.titleField")}>
            <Input value={value} onChange={(e) => setValue(e.target.value)} maxLength={80} autoFocus />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onPress={close}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="default" isDisabled={!value.trim()}>
              {t("common.save")}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  )
}

// ---------- timeline ----------

type Item = { at: number; message: Message } | { at: number; note: Note } | { at: number; memory: Memory }

export function Timeline({ chat, state, agents, onView, onEdit, onStop, at }: { chat: Chat; state: ChatState; agents: ReadonlyArray<Agent>; onView: (f: Focus) => void; onEdit: (m: Message) => void; onStop?: (() => void) | undefined; at?: string | undefined }) {
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true) // follow new content only while the reader is at the bottom
  // What was kept from this chat shows where it happened, from the memories themselves (a reload keeps it). The
  // live "remembered" event only says the list changed.
  const kept = useList(memoriesAtom).filter((m) => m.kind === "fact" && m.chatId === chat.id && m.origin === "auto" && m.state !== "forgotten")
  const invalidate = useInvalidate()
  const rememberedCount = state.notes.filter((n) => n.kind === "remembered").length
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new remembered event is the trigger
  useEffect(() => {
    if (rememberedCount) invalidate(["memories"])
  }, [rememberedCount])
  const items: Item[] = [
    ...state.messages.map((m) => ({ at: m.at, message: m })),
    ...state.notes.filter((n) => n.kind !== "remembered").map((n) => ({ at: n.at, note: n })),
    ...kept.map((m) => ({ at: m.createdAt, memory: m }))
  ].sort((a, b) => a.at - b.at)
  const multi = chat.agentIds.length > 1
  // One agent (or none): the header already says who answers, so replies show no face and no name.
  const solo = !multi

  // biome-ignore lint/correctness/useExhaustiveDependencies: the content is the trigger
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [items.length, state.live?.text, state.live?.steps.length, state.approvals.length])
  // Opened on one reply (an agent's session in its Work tab): that reply in view, marked for a moment.
  const [marked, setMarked] = useState<string>()
  const ready = state.ready
  useLayoutEffect(() => {
    if (!ready || !at) return
    const node = scroller.current?.querySelector(`[data-message="${CSS.escape(at)}"]`)
    if (!node) return
    pinned.current = false
    node.scrollIntoView({ block: "start" })
    setMarked(at)
    const id = setTimeout(() => setMarked(undefined), 1800)
    return () => clearTimeout(id)
  }, [ready, at])

  return (
    <div
      ref={scroller}
      onScroll={(e) => {
        const el = e.currentTarget
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
      }}
      className="min-h-0 flex-1 overflow-auto"
    >
      {/* Side breathing room outside the reading column, so the column lines up with the message box below. */}
      <div className="px-8 pt-6 pb-8">
      <div className="mx-auto flex w-full max-w-chat flex-col gap-7">
        {chat.summary && <Summary text={chat.summary} />}
        {state.ready && items.length === 0 && !state.live && <EmptyState icon={<MessageCircle />} title={t("chat.empty")} hint={t("chat.emptyHint")} />}
        {!state.ready && (
          <div className="flex justify-center py-16 text-muted">
            <Spinner />
          </div>
        )}
        {items.map((item, i) =>
          "message" in item ? (
            <div
              key={item.message.id}
              data-message={item.message.id}
              className={cn("scroll-mt-6 rounded-card transition-colors duration-700", item.message.at <= chat.summaryUntil && "opacity-55", marked === item.message.id && "bg-accent-faint")}
              title={item.message.at <= chat.summaryUntil ? t("chat.coveredBySummary") : undefined}
            >
              {item.message.role === "user" ? (
                <UserMessage message={item.message} onEdit={state.live ? undefined : () => onEdit(item.message)} />
              ) : (
                <AgentMessage message={item.message} agents={agents} onView={onView} continued={solo || continues(items[i - 1], item.message)} bare={solo} last={i === items.length - 1 && !state.live && state.pending === 0} />
              )}
            </div>
          ) : "memory" in item ? (
            <MemoryChip key={item.memory.id} memory={item.memory} />
          ) : (
            <TimelineNote key={`${item.note.kind}-${item.note.at}`} note={item.note} agents={agents} />
          )
        )}
        {state.live && <LiveMessage live={state.live} agents={agents} receipts={state.receipts} bare={solo} onStop={state.pending <= 1 ? onStop : undefined} />}
        {multi && state.ready && items.length === 0 && <p className="text-center text-sm text-dim">{t("team.mentionHint")}</p>}
      </div>
      </div>
    </div>
  )
}

// A reply that follows one from the same agent within a few minutes (no note between) joins its run: no new
// avatar and name.
const RUN_GAP_MS = 5 * 60_000
const continues = (prev: Item | undefined, m: Message) =>
  m.role !== "user" &&
  !m.switches.length &&
  !!prev &&
  "message" in prev &&
  prev.message.role !== "user" &&
  prev.message.agentId === m.agentId &&
  m.at - prev.message.at < RUN_GAP_MS

function Summary({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <div className="flex flex-col gap-2">
      <DisclosurePill expanded={open} onToggle={() => setOpen(!open)} controls={id} leading={<Sparkles className="size-3.5 text-muted" />}>
        {t("chat.summaryTitle")}
      </DisclosurePill>
      <Fold open={open}>
        <div id={id} className="flex flex-col gap-1.5 rounded-card border border-subtle px-4 py-3">
          <p className="text-sm text-dim">{t("chat.summaryHint")}</p>
          <p className="whitespace-pre-wrap text-secondary">{text}</p>
        </div>
      </Fold>
    </div>
  )
}

function UserMessage({ message: m, onEdit }: { message: Message; onEdit?: (() => void) | undefined }) {
  return (
    <div className="group/msg relative ml-auto flex max-w-125 flex-col items-end gap-1.5">
      {m.attachments.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1.5">
          {m.attachments.map((a) =>
            a.mime.startsWith("image/") ? (
              <ImageViewer key={a.id} src={attachmentUrl(a.id)} name={a.name} closeLabel={t("common.close")} openLabel={t("chat.openOriginal")}>
                <img src={attachmentUrl(a.id)} alt={a.name} className="h-28 max-w-60 rounded-card border border-subtle object-cover" />
              </ImageViewer>
            ) : (
              <a
                key={a.id}
                href={attachmentUrl(a.id)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-control-sm max-w-60 items-center gap-1.5 rounded-full border border-subtle bg-raised px-3 text-sm text-secondary outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent"
              >
                <File className="size-3.5 shrink-0 text-muted" />
                <span className="truncate">{a.name}</span>
              </a>
            )
          )}
        </div>
      )}
      <div className="rounded-sheet border border-subtle bg-raised px-4 py-2.5 text-chat whitespace-pre-wrap">
        <MentionText text={m.text} />
      </div>
      <MessageActions text={m.text} at={m.at} align="end" onEdit={onEdit} />
    </div>
  )
}

// Under a message, shown on hover or focus (always on touch): copy, when it was written and, for a reply, the
// details (model, tokens, account, cost) in a tooltip. Quiet, so a conversation reads as text.
function MessageActions({ text, at, details, align = "start", onEdit }: { text: string; at: number; details?: ReactNode; align?: "start" | "end"; onEdit?: (() => void) | undefined }) {
  const [copied, setCopied] = useState(false)
  const copy = () =>
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    })
  return (
    <div
      className={cn(
        // Laid over the gap below the message, so it takes no height of its own.
        "absolute top-full z-10 flex h-6 items-center gap-0.5 text-sm text-dim opacity-0 transition-opacity duration-150 group-hover/msg:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100 motion-reduce:transition-none",
        align === "end" ? "right-0" : "-left-1.5"
      )}
    >
      {text && (
        <Tooltip content={copied ? t("common.copied") : t("common.copy")}>
          <IconButton label={t("common.copy")} size="xs" onPress={copy}>
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          </IconButton>
        </Tooltip>
      )}
      {onEdit && (
        <Tooltip content={t("chat.editFromHere")}>
          <IconButton label={t("chat.editFromHere")} size="xs" onPress={onEdit}>
            <Pencil className="size-3.5" />
          </IconButton>
        </Tooltip>
      )}
      {details && (
        <Tooltip content={details}>
          <IconButton label={t("chat.details")} size="xs">
            <Info className="size-3.5" />
          </IconButton>
        </Tooltip>
      )}
      <time className="px-1.5 tabular-nums" dateTime={new Date(at).toISOString()} title={new Date(at).toLocaleString()}>
        {formatTime(at)}
      </time>
    </div>
  )
}

// "Edit from here": the conversation goes back to before this message of yours, which comes back
// to the message box to edit; optionally the files the later turns changed go back too.
function RewindDialog({ chatId, message, changes, onClose, onDone }: { chatId: string; message: Message | undefined; changes: boolean; onClose: () => void; onDone: (text: string) => void }) {
  const rewind = useMutation(mutations.rewind)
  const [files, setFiles] = useState(true)
  const [error, setError] = useState<string>()
  return (
    <Dialog title={t("chat.rewindTitle")} isOpen={!!message} onOpenChange={(o) => {
        if (o) return
        setError(undefined)
        onClose()
      }}>
      {(close) => (
        <>
          <p className="text-secondary">{t("chat.rewindBody")}</p>
          {changes && (
            <Switch isSelected={files} onChange={setFiles}>
              {t("chat.rewindFiles")}
            </Switch>
          )}
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onPress={close}>
              {t("common.cancel")}
            </Button>
            <Button
              onPress={() => {
                if (!message) return
                setError(undefined)
                rewind({ params: { id: chatId }, payload: { messageId: message.id, files: changes && files }, reactivityKeys: ["chats", "workspace"] })
                  .then((r) => {
                    onDone(r.text)
                    close()
                  })
                  .catch((e: unknown) => {
                    const conflict = (e as { files?: ReadonlyArray<string> })?.files
                    setError(conflict ? t("workspace.undoConflict", { files: conflict.join(", ") }) : t("chat.rewindFailed"))
                  })
              }}
            >
              {t("chat.rewindAction")}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  )
}

// Agent reply: avatar column + content (name with its activity pill, text, how it ended; model, tokens and
// cost in the footer line).
function Reply({
  agentId,
  model,
  agents,
  pill,
  children,
  footer,
  continued = false,
  bare = false
}: { agentId: string | null; model: string | null; agents: ReadonlyArray<Agent>; pill?: ReactNode; children: ReactNode; footer?: ReactNode; continued?: boolean; bare?: boolean }) {
  const agent = agents.find((a) => a.id === agentId)
  return (
    // bare: a chat with one agent, the reply sits flush with the column (no face, no gutter).
    <article className="group/msg flex gap-3" aria-label={continued ? agentName(agentId, agents) : undefined}>
      {bare ? null : continued ? <span aria-hidden="true" className="w-7 shrink-0" /> : <AuthorAvatar agent={agent} model={model} size={28} />}
      <div className="relative flex min-w-0 flex-1 flex-col gap-2">
        {/* The steps list of the pill wraps to its own line (basis-full) under the name. */}
        {(!continued || pill) && (
          <div className="flex min-h-7 flex-wrap items-center gap-x-2.5 gap-y-2.5">
            {!continued && (
              <strong className={cn("font-semibold", agent && `tint-text ${agentTint(agent, agents)}`)} title={model ? modelLabel(model) : undefined}>
                {agentName(agentId, agents)}
              </strong>
            )}
            {pill}
          </div>
        )}
        {children}
        {footer}
      </div>
    </article>
  )
}


function endingOf(error: string | null): { tone: "warning" | "danger"; text: string } | undefined {
  if (!error) return undefined
  if (error === ErrorCode.cancelled) return { tone: "warning", text: t("chat.cancelled") }
  if (error === ErrorCode.serverRestarted) return { tone: "warning", text: t("chat.serverRestarted") }
  if (error === ErrorCode.replyLimit) return { tone: "warning", text: t("chat.replyLimit") }
  if (error === ErrorCode.monthlyLimit) return { tone: "warning", text: t("chat.monthlyLimit") }
  if (isInterruption(error)) return { tone: "warning", text: t("chat.interrupted") }
  return { tone: "danger", text: error }
}

function AgentMessage({ message: m, agents, onView, continued, bare, last }: { message: Message; agents: ReadonlyArray<Agent>; onView: (f: Focus) => void; continued: boolean; bare: boolean; last: boolean }) {
  const accounts = useList(accountsAtom)
  return (
    <div className="flex flex-col gap-6">
      {m.switches.map((sw, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a saved message's switches never change
        <Separator key={i}>{switchText(sw, accounts)}</Separator>
      ))}
      <AgentReply message={m} agents={agents} accounts={accounts} onView={onView} continued={continued} bare={bare} last={last} />
    </div>
  )
}

function AgentReply({
  message: m,
  agents,
  accounts,
  onView,
  continued,
  bare,
  last
}: { message: Message; agents: ReadonlyArray<Agent>; accounts: ReadonlyArray<ProviderAccount>; onView: (f: Focus) => void; continued: boolean; bare: boolean; last: boolean }) {
  const ending = endingOf(m.error)
  const retry = useMutation(mutations.retry)
  const tokens = m.inputTokens || m.outputTokens ? t("chat.tokens", { input: formatCompact(m.inputTokens), output: formatCompact(m.outputTokens) }) : null
  // Which account answered and what it cost; a subscription shows the API equivalent, not a charge.
  const account = accounts.find((a) => a.id === m.accountId)
  const cost = m.cost === null ? null : account?.kind === "subscription" ? `${t("usage.apiEquivalent")} ${formatCost(m.cost)}` : formatCost(m.cost)
  const took = m.durationMs !== null && m.durationMs >= 1000 ? formatDuration(m.durationMs) : null // the receipt keeps the time a plain answer took
  return (
    <Reply
      agentId={m.agentId}
      model={m.model}
      agents={agents}
      continued={continued}
      bare={bare}
      footer={
        <>
          {ending && (
            <span className={cn("inline-flex items-center gap-1.5 text-sm", ending.tone === "danger" ? "text-danger" : "text-warning")}>
              <CircleAlert className="size-3.5" />
              {ending.tone === "danger" ? t("chat.failed") : ending.text}
            </span>
          )}
          {/* The last reply ended early: answer again (Continue after its reply limit), or raise the month's limit. */}
          {ending && last && m.error !== ErrorCode.cancelled && (
            m.error === ErrorCode.monthlyLimit ? (
              m.agentId && (
                <Button size="sm" variant="ghost" onPress={() => go({ view: "agent", id: m.agentId! })}>
                  {t("chat.raiseLimit")}
                </Button>
              )
            ) : (
              <Button size="sm" variant="ghost" onPress={() => void retry({ payload: { chatId: m.chatId, messageId: m.id } })}>
                <RefreshCw />
                {m.error === ErrorCode.replyLimit ? t("chat.continue") : t("chat.retry")}
              </Button>
            )
          )}
          <MessageActions
            text={m.text}
            at={m.at}
            details={
              (m.model || tokens || account || cost || took) && (
                <span className="flex flex-col gap-0.5">
                  {m.model && <span className="text-fg">{modelLabel(m.model)}</span>}
                  {tokens && <span>{tokens}</span>}
                  {took && <span>{took}</span>}
                  {account && <span>{account.label}</span>}
                  {cost && <span>{cost}</span>}
                </span>
              )
            }
          />
        </>
      }
    >
      <StoredReply message={m} />
      <TurnChanges message={m} onView={onView} />
      {ending?.tone === "danger" && <pre className="overflow-auto rounded-control bg-code px-3 py-2 font-mono text-sm whitespace-pre-wrap text-danger">{ending.text}</pre>}
    </Reply>
  )
}

// ---------- activity ----------

// A finished reply as it happened: its words cut where steps began, each run of steps one folded line with its own
// summary between them. Replies saved before steps knew where they began keep one line above the words. A long
// thought goes at the top of the first group; with one group the line says how long the whole turn took.
function StoredReply({ message: m }: { message: Message }) {
  const work = workSteps(m.steps)
  const pieces = interleave(m.text, work, (s) => s.at)
  const groups = pieces.filter((p) => p.kind === "steps").length
  const thought = m.steps.filter((s) => s.tool === "thought")
  let first = true
  return pieces.map((p, i) => {
    // biome-ignore lint/suspicious/noArrayIndexKey: a saved reply's pieces never change
    if (p.kind === "text") return <ChatMarkdown key={`t${i}`} text={p.text} />
    const steps = first ? [...thought, ...p.steps] : p.steps
    first = false
    const took = groups === 1 ? m.durationMs : p.steps.reduce((sum, s) => sum + (s.ms ?? 0), 0)
    return <StoredActivity key={p.key} steps={steps} durationMs={took} />
  })
}

// A step's glyph says what kind of work it was (one running spins, one waiting for you is the clock).
const KIND_ICON: Record<SummaryKind, ReactNode> = { search: <Search />, read: <FileText />, edit: <Pencil />, run: <SquareTerminal />, tool: <Wrench />, delegate: <Users /> }
const glyphOf = (kind: string) => KIND_ICON[kindOf(kind) ?? "tool"]
const savedStep = (s: Message["steps"][number]): SummaryStep => ({ kind: s.tool, status: s.status, title: s.title ?? "", detail: s.detail || s.args, files: s.tool === "edit" ? s.args.split(", ").filter(Boolean) : [] })

// The summary as a sentence ("Read 2 files and ran 3 commands"), with what still failed or was refused.
function sentenceOf(steps: ReadonlyArray<SummaryStep>) {
  const { parts, failed, refused } = summarize(steps)
  const words = new Intl.ListFormat(locale(), { type: "conjunction" }).format(parts.map((p) => t(`activity.did.${p.kind}`, { count: p.count })))
  return { text: words.charAt(0).toUpperCase() + words.slice(1), failed, refused }
}

// A finished turn's work: one line (what it did, what still failed, how long) that opens to its steps as a tree.
// Folded by default; the reply's words are what's read.
function StoredActivity({ steps, durationMs }: { steps: Message["steps"]; durationMs: number | null }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const { text, failed, refused } = sentenceOf(steps.map(savedStep))
  // Replied is the reply itself; a thought shows when it took a while.
  const shown = steps.filter((s) => s.tool !== "reply" && (s.tool !== "thought" || (s.ms ?? 0) >= 1000))
  const lastWork = shown.map((s) => s.tool !== "thought").lastIndexOf(true)
  return (
    <div className="flex min-w-0 flex-col">
      <StepHead open={open} onToggle={() => setOpen(!open)} controls={id}>
        <span className="truncate">{text}</span>
        {failed > 0 && <span className="shrink-0 text-danger">· {t("activity.errors", { count: failed })}</span>}
        {refused > 0 && <span className="shrink-0 text-warning">· {t("activity.refused", { count: refused })}</span>}
        {durationMs !== null && durationMs >= 1000 && <span className="shrink-0 text-dim tabular-nums">· {formatDuration(durationMs)}</span>}
      </StepHead>
      <Fold open={open}>
        <StepList id={id}>
          {shown.map((s, i) =>
            s.tool === "thought" ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: stored steps are immutable and may repeat a tool
              <StepNote key={i} last={i > lastWork}>
                {t("activity.thought", { time: formatDuration(s.ms ?? 0) })}
              </StepNote>
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: stored steps are immutable and may repeat a tool
              <StoredStep key={i} step={s} last={i === lastWork} />
            )
          )}
        </StepList>
      </Fold>
    </div>
  )
}

// One finished step: its title in plain words (the command, path or URL on hover), how long it took or that it
// failed; it opens to the whole command and the start of its output (all of it on "Show all"). Steps saved before
// titles existed, and MCP tools, are named by their tool.
const NATIVE_LABEL: Record<string, string> = { run: "$", read: "read", search: "search" }
function StoredStep({ step: s, last }: { step: Message["steps"][number]; last: boolean }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const title = s.title || (NATIVE_LABEL[s.tool] ? `${NATIVE_LABEL[s.tool]} ${s.args}` : s.tool === "edit" ? s.args : s.tool)
  const command = s.tool === "run" ? s.args : s.detail || (s.args && s.args !== "{}" && !NATIVE_LABEL[s.tool] && s.tool !== "edit" ? s.args : "")
  const hint = (s.detail || (s.tool === "run" ? s.args : "")) || undefined
  const facts = [
    s.status === "error" && <span key="e" className="text-danger">{t("activity.failedStep")}</span>,
    s.status === "refused" && <span key="r" className="text-warning">{t("activity.refusedStep")}</span>,
    s.ms !== undefined && s.ms >= 1000 && <span key="t">{formatDuration(s.ms)}</span>
  ].filter(Boolean)
  return (
    <StepRow
      icon={glyphOf(s.tool)}
      tone={s.status === "error" ? "danger" : s.status === "refused" ? "warning" : "default"}
      title={title}
      hint={hint !== title ? hint : undefined}
      facts={facts.length ? facts : undefined}
      last={last}
      open={open}
      onToggle={command || s.result ? () => setOpen(!open) : undefined}
      controls={id}
    >
      {command && <pre className="max-h-48 overflow-auto rounded-control bg-code px-2.5 py-1.5 font-mono text-sm whitespace-pre-wrap break-all text-secondary">{command}</pre>}
      <StepOutput result={s.result} />
    </StepRow>
  )
}

// The start of a step's output (all of it on "Show all").
function StepOutput({ result }: { result: string }) {
  const [all, setAll] = useState(false)
  if (!result) return null
  const long = result.length > 240 || result.split("\n").length > 3
  return (
    <>
      {/* Its lines as it wrote them (a test run reads line by line), three of them until "Show all". */}
      <pre className={cn("overflow-auto rounded-control bg-code px-2.5 py-1.5 font-mono text-sm whitespace-pre-wrap text-muted", all && "max-h-96")}>
        {/* Clamped inside the padding, so a fourth line doesn't peek through it. */}
        <span className={all ? undefined : "line-clamp-3"}>{result}</span>
      </pre>
      {long && (
        <Button size="sm" variant="ghost" className="-ml-2 self-start" onPress={() => setAll(!all)}>
          {all ? t("activity.showLess") : t("activity.showAll")}
        </Button>
      )}
    </>
  )
}

// Re-renders every second while mounted (live elapsed time).
function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])
  return now
}

// The label of the live pill. A step's title shows at once; the generic text that fills the gap between two steps
// waits a moment, so the pill doesn't flip back and forth each time the next step starts right after the last.
const GAP_LABEL_AFTER_MS = 700
function useHeldLabel(wanted: string, specific: boolean) {
  const [shown, setShown] = useState(wanted)
  useEffect(() => {
    if (specific) return setShown(wanted)
    const id = setTimeout(() => setShown(wanted), GAP_LABEL_AFTER_MS)
    return () => clearTimeout(id)
  }, [wanted, specific])
  return specific ? wanted : shown
}

// The turn running now, laid out as it happens: what it has written so far, cut where steps began, each run of steps
// a group on the tree (open while it works, unless turned off in Settings) with its own summary; at the end what it
// does now (a light sweeps across it), or plainly that it waits for the provider before anything came back, the time
// only after 5 s, and Stop. Questions and approvals wait above the message box (PendingTray).
const SHOW_TIME_AFTER_MS = 5000
function LiveMessage({ live, agents, receipts, bare, onStop }: { live: LiveTurn; agents: ReadonlyArray<Agent>; receipts: ReadonlyArray<Receipt>; bare: boolean; onStop?: (() => void) | undefined }) {
  const now = useNow(true)
  const current = [...live.steps].reverse().find((s) => s.status === "running" || s.status === "waiting")
  const idle = !live.text && !live.steps.length
  const elapsed = now - live.startedAt
  const wanted = current?.title ?? (idle ? t("activity.waitingFor", { provider: providerLabel(splitModel(live.model).provider) }) : t("activity.working"))
  const what = useHeldLabel(wanted, !!current)
  const pieces = interleave(live.text, live.steps, (s) => live.stepAt[s.id])
  return (
    <Reply
      agentId={live.agentId}
      model={live.model}
      agents={agents}
      bare={bare}
      continued={bare}
      footer={
        // Below everything so far: the words and steps grow above it and the status stays at the end. Stop sits beside
        // the words (a button inside a button isn't valid); it is the composer's action too.
        <div className="flex h-7 max-w-full min-w-0 items-center gap-2 text-base text-muted">
          <span className="flex w-4 shrink-0 justify-center [&_svg]:size-3.5">{current?.status === "waiting" ? <Clock className="text-accent-text" /> : <Spinner size={12} className="text-muted" />}</span>
          {/* One element for every state, so the sweep doesn't restart each time the label changes. */}
          <span className={cn("truncate", idle || current?.status === "waiting" ? undefined : "shimmer-text")}>{what}</span>
          {elapsed >= SHOW_TIME_AFTER_MS && <span className="shrink-0 text-dim tabular-nums">{`· ${formatDuration(elapsed)}`}</span>}
          {onStop && (
            <Tooltip content={t("composer.stop")}>
              <IconButton label={t("composer.stop")} variant="ghost" shape="pill" size="xs" onPress={onStop}>
                <Square className="size-3 fill-current" />
              </IconButton>
            </Tooltip>
          )}
        </div>
      }
    >
      {pieces.map((p, i) =>
        p.kind === "steps" ? (
          <LiveSteps key={p.key} steps={p.steps} />
        ) : i === pieces.length - 1 ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: a piece is its position in a reply that only grows
          <LiveText key={`t${i}`} text={p.text} />
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: a piece is its position in a reply that only grows
          <ChatMarkdown key={`t${i}`} text={p.text} />
        )
      )}
      {receipts.map((r) => (
        <ReceiptCard key={r.approval.id} receipt={r} />
      ))}
    </Reply>
  )
}

// One run of a live turn's steps: its summary, a spinner (the clock while one waits for you) while one runs, and its
// steps as they come on the tree.
const liveStep = (s: WorkStep): SummaryStep => ({ kind: s.kind, status: s.status, title: s.title, detail: s.detail, files: s.files })
function LiveSteps({ steps }: { steps: ReadonlyArray<WorkStep> }) {
  const [open, setOpen] = useState(liveStepsOpen)
  const id = useId()
  const working = steps.find((s) => s.status === "running" || s.status === "waiting")
  const { text, failed, refused } = sentenceOf(steps.map(liveStep))
  return (
    <div className="flex min-w-0 flex-col">
      <StepHead
        open={open}
        onToggle={() => setOpen(!open)}
        controls={id}
        {...(working && { leading: working.status === "waiting" ? <Clock className="text-accent-text" /> : <Spinner size={12} className="text-muted" /> })}
      >
        <span className="truncate">{text}</span>
        {failed > 0 && <span className="shrink-0 text-danger">· {t("activity.errors", { count: failed })}</span>}
        {refused > 0 && <span className="shrink-0 text-warning">· {t("activity.refused", { count: refused })}</span>}
      </StepHead>
      <Fold open={open}>
        <StepList id={id}>
          {steps.map((s, i) => {
            const facts = [
              s.status === "waiting" && <span key="w" className="text-accent-text">{t("activity.waiting")}</span>,
              s.status === "error" && <span key="e" className="text-danger">{t("activity.failedStep")}</span>,
              s.status === "refused" && <span key="r" className="text-warning">{t("activity.refusedStep")}</span>,
              s.durationMs !== null && s.durationMs >= 1000 && <span key="t">{formatDuration(s.durationMs)}</span>
            ].filter(Boolean)
            return (
              <StepRow
                key={s.id}
                icon={s.status === "running" ? <Spinner size={12} className="text-muted" /> : s.status === "waiting" ? <Clock /> : glyphOf(s.kind)}
                tone={s.status === "waiting" ? "waiting" : s.status === "error" ? "danger" : s.status === "refused" ? "warning" : "default"}
                title={s.title}
                hint={s.detail && s.detail !== s.title ? s.detail : undefined}
                facts={facts.length ? facts : undefined}
                last={i === steps.length - 1}
              />
            )
          })}
        </StepList>
      </Fold>
    </div>
  )
}

// The reply as it streams. Text arrives in batches (the server groups deltas every 100 ms); shown as it comes it jumps,
// so it is revealed frame by frame, catching up with what arrived in about CATCH_UP_FRAMES frames (at once with
// reduced motion). Only the last block (paragraph or code fence) still grows: the ones before render once.
const CATCH_UP_FRAMES = 6
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
function useSmoothText(target: string) {
  const shown = useRef(target.length)
  const [, redraw] = useState(0)
  useEffect(() => {
    if (reducedMotion() || target.length < shown.current) {
      shown.current = target.length
      redraw((n) => n + 1)
      return
    }
    let frame = 0
    const tick = () => {
      const left = target.length - shown.current
      if (left <= 0) return
      shown.current += Math.max(1, Math.ceil(left / CATCH_UP_FRAMES))
      redraw((n) => n + 1)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target])
  return target.slice(0, shown.current)
}
// Blocks split on blank lines outside code fences, so a fence keeps its blank lines.
function blocksOf(text: string): string[] {
  const out: string[] = []
  let fence = false
  let current: string[] = []
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    if (!fence && line.trim() === "" && current.length) {
      out.push(current.join("\n"))
      current = []
    } else current.push(line)
  }
  if (current.length) out.push(current.join("\n"))
  return out
}
const Block = memo(ChatMarkdown)
function LiveText({ text }: { text: string }) {
  const shown = useSmoothText(text)
  return (
    // The same spacing between blocks as inside one message (.prose-chat > * + *), so nothing moves when it ends.
    <div className="prose-chat text-chat">
      {blocksOf(shown).map((b, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a block is its position in a text that only grows
        <Block key={i} text={b} />
      ))}
    </div>
  )
}

// ---------- approvals ----------

// What waits for you in this chat (approvals, questions), right above the message box until you decide, so it
// never scrolls out of sight with the conversation.
export function PendingTray({ approvals }: { approvals: ReadonlyArray<Approval> }) {
  if (!approvals.length) return null
  return (
    <section className="mb-2 flex flex-col gap-2" aria-label={t("approval.waiting")}>
      {approvals.map((a) => (
        <ApprovalCard key={a.id} approval={a} />
      ))}
    </section>
  )
}

function ApprovalCard({ approval: a }: { approval: Approval }) {
  const decide = useMutation(mutations.decide)
  const agents = useList(agentsAtom)
  const [pending, setPending] = useState<"approved" | "always" | "denied">()
  const [error, setError] = useState<string>()
  const [details, setDetails] = useState(false)
  const choose = (outcome: "approved" | "always" | "denied") => {
    setPending(outcome)
    decide({ payload: { approvalId: a.id, outcome }, reactivityKeys: ["approvals", "agents"] }).catch(() => {
      setPending(undefined)
      setError(t("chat.approvalGone"))
    })
  }
  const command = commandOf(a)
  const who = agentName(a.agentId, agents)
  if (a.kind === "question")
    return (
      <TrayCard icon={<MessageCircleQuestion />} label={t("question.label", { agent: who })}>
        <span className="text-chat font-medium">{a.summary}</span>
        <QuestionAnswer approval={a} onError={setError} />
        {error && <p className="text-sm text-danger">{error}</p>}
      </TrayCard>
    )
  return (
    <TrayCard icon={<ShieldAlert />} label={t("approval.waitsFor", { agent: who })}>
      <div className="flex flex-wrap items-center gap-2.5">
      <span className="flex min-w-50 flex-1 flex-col">
        <span className="font-medium">{a.summary || t("approval.wantsTo", { agent: who, tool: a.tool })}</span>
        {/* The command itself; pressing it shows every argument. */}
        <Button variant="ghost" size="sm" aria-expanded={details} onPress={() => setDetails(!details)} className="h-auto max-w-full justify-start rounded-none bg-transparent px-0 font-mono font-normal text-muted data-hovered:bg-transparent">
          <span className="truncate" title={command}>
            {command}
            {a.cwd && <span className="font-sans">{` ${t("approval.folder", { path: a.cwd })}`}</span>}
          </span>
        </Button>
      </span>
      <Button size="sm" variant="ghost" isDisabled={!!pending} onPress={() => choose("denied")}>
        {t("approval.deny")}
      </Button>
      {/* Only when the action can be allowed for good (an MCP tool, the browser): it saves a rule on the agent. */}
      {a.alwaysKey && (
        <Tooltip content={t("approval.allowAlwaysHint")}>
          <Button size="sm" variant="secondary" isPending={pending === "always"} isDisabled={!!pending} onPress={() => choose("always")}>
            {t("approval.allowAlways")}
          </Button>
        </Tooltip>
      )}
      <Button size="sm" variant="default" isPending={pending === "approved"} isDisabled={!!pending} onPress={() => choose("approved")}>
        {t("approval.allow")}
      </Button>
      {error && <p className="basis-full text-sm text-danger">{error}</p>}
      </div>
      <Fold open={details}>
        <pre className="max-h-48 overflow-auto rounded-control bg-code px-3 py-2 font-mono text-sm text-secondary">{a.args}</pre>
      </Fold>
    </TrayCard>
  )
}

// A card that waits for you above the message box: the box's own frame (canvas, strong border) so the two read as
// one piece; the accent only in the small line that says who waits, with its icon.
function TrayCard({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="flex w-full flex-col gap-2.5 rounded-card border border-strong bg-canvas px-3.5 py-3">
      <span className="flex items-center gap-1.5 text-sm text-accent-text [&_svg]:size-3.5">
        {icon}
        {label}
      </span>
      {children}
    </section>
  )
}

// A decision already taken: one quiet 28px row (the outcome's icon, "Allowed" or "Denied", what it was, cut to one
// line) that opens to the whole command, the folder it ran in and every argument, with Copy.
function ReceiptCard({ receipt: r }: { receipt: Receipt }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const id = useId()
  const a = r.approval
  const ok = r.outcome === "approved" || r.outcome === "always"
  const question = a.kind === "question"
  const word = r.outcome === "expired" ? t("approval.expired") : question ? (ok ? t("question.answered") : t("question.skipped")) : ok ? t("approval.approved") : t("approval.denied")
  const summary = a.summary || a.tool
  const command = question ? "" : commandOf(a)
  const extra = question ? undefined : extraArgs(a, command)
  const copy = () =>
    void navigator.clipboard.writeText(command === a.tool && extra ? extra : command).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    })
  return (
    <div className="flex w-full max-w-130 flex-col gap-1">
      <Button variant="ghost" size="sm" aria-expanded={open} aria-controls={id} onPress={() => setOpen(!open)} className="w-full justify-start gap-2 px-2 font-normal text-muted">
        {r.outcome === "expired" ? <Clock className="size-3.5 shrink-0" /> : ok ? <CircleCheck className="size-3.5 shrink-0 text-success" /> : <CircleX className="size-3.5 shrink-0" />}
        <span className="shrink-0 text-secondary">{word}</span>
        <span className="min-w-0 flex-1 truncate text-left" title={summary}>
          {summary}
        </span>
        <ChevronDown aria-hidden="true" className={cn("size-3.5 shrink-0 transition-transform duration-150 ease-out motion-reduce:transition-none", open && "rotate-180")} />
      </Button>
      <Fold open={open}>
        <div id={id} className="flex flex-col gap-2 rounded-card border border-subtle bg-code px-3 py-2.5 text-sm">
          {question || !summary.includes(command) ? <p className="text-secondary">{summary}</p> : null}
          {command && (
            <div className="flex items-start gap-2">
              <pre className="min-w-0 flex-1 overflow-auto font-mono whitespace-pre-wrap break-all text-secondary">{command}</pre>
              <Tooltip content={copied ? t("common.copied") : t("common.copy")}>
                <IconButton label={t("common.copy")} size="xs" onPress={copy}>
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                </IconButton>
              </Tooltip>
            </div>
          )}
          {a.cwd && <p className="text-muted">{t("approval.folder", { path: a.cwd })}</p>}
          {extra && (
            <div className="flex flex-col gap-1">
              <span className="text-muted">{t("approval.details")}</span>
              <pre className="max-h-48 overflow-auto font-mono text-muted">{extra}</pre>
            </div>
          )}
        </div>
      </Fold>
    </div>
  )
}

function TimelineNote({ note, agents }: { note: Note; agents: ReadonlyArray<Agent> }) {
  const accounts = useList(accountsAtom)
  if (note.kind === "failover") return <Separator>{switchText(note.switch, accounts)}</Separator>
  if (note.kind === "remembered") return null // shown from the memories themselves (MemoryChip)
  const to = note.to.map((id) => agentName(id, agents)).join(", ")
  const from = agentName(note.from, agents)
  if (note.via === "limit") return <Separator>{t("chat.chainStopped")}</Separator>
  if (note.via === "reply") return <Separator>{t("chat.handedBack", { from, to })}</Separator>
  if (note.via === "route") return <Separator>{note.reason ? t("chat.routedWhy", { to, reason: note.reason }) : t("chat.routed", { to })}</Separator>
  return <Separator>{t("chat.handoff", { from, to })}</Separator>
}

// A centered line in the timeline (handoffs, failover moves).
function Separator({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-sm text-muted">
      <span aria-hidden="true" className="h-px flex-1 bg-subtle" />
      <span className="max-w-xl text-center">{children}</span>
      <span aria-hidden="true" className="h-px flex-1 bg-subtle" />
    </div>
  )
}
