// Chat (prototype "Main"): header with the team, the conversation as a timeline (your messages on the
// right, each agent's reply with its activity pill, approvals waiting for you, handoffs between agents),
// and the message box. State is the chat atom: snapshot + live events, so a turn keeps going if the tab
// closes and the screen catches up when it reopens.
import { type Agent, type Chat, type FailoverTarget, type Message, type ProviderAccount, skillHandle, type WorkspaceFile } from "@zorel/contracts"
import { useAtomRefresh, useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import { type Approval, ErrorCode, isInterruption, type WorkStep } from "@zorel/contracts/events"
import { formatCompact, formatDuration, formatTime, t } from "@zorel/i18n"
import { type ReactNode, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { accountsAtom, agentsAtom, attachmentUrl, chatAtom, commandsAtom, filesAtom, memoriesAtom, type ChatState, type LiveTurn, mutations, type Note, projectsAtom, type Receipt, uploadAttachment, useChat, useList, useInvalidate, useMutation } from "../client.ts"
import { agentName, chatTitle, formatCost, handleOf, modelLabel, providerLabel, splitModel, switchText } from "../labels.ts"
import { ChatMarkdown } from "./chat-markdown.tsx"
import { go } from "../state.ts"
import { Composer, type ComposerSources } from "./composer.tsx"
import { ContextMeter } from "./context-meter.tsx"
import { QueuePanel, useQueue } from "./queue.tsx"
import { FailoverEditor, useTermsPending } from "./failover.tsx"
import { chatDelta, Delta, type Focus, PinItem, type Pins, type ShellPin, SIDE_ICON, SidePanel, type SideTab, sideLabel, TurnChanges, usePins } from "./workspace.tsx"
import { ModelPicker } from "./model-picker.tsx"
import { GitControl } from "./git.tsx"
import { ContextMenu, PageHeader, ShimmerText } from "@/ui"
import { AuthorAvatar, TeamPicker } from "./people.tsx"
import { ChatProcesses } from "./processes.tsx"
import { QuestionAnswer } from "./question.tsx"
import {
  Button, Check, CircleAlert, CircleCheck, CircleX, Clock, Code, ConfirmDialog, Copy, cx, Dialog, DisclosurePill, Dot, EmptyState, Field, File, IconButton, ImageViewer, Info, Input, Menu, MenuItem,
  MenuSeparator, MessageCircle, MessageCircleQuestion, ShieldAlert, Minimize2, MoreHorizontal, PanelRight, Pencil, Shield, Shuffle, Sparkles, Spinner, SquarePen, SquareTerminal, Switch, Tooltip, Trash2
} from "@/ui"

export function ChatView({ chat }: { chat: Chat }) {
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
  const submit = (text: string, attachmentIds: ReadonlyArray<string>) => {
    if (!busy && !queue.items.length) return sendNow(text, attachmentIds)
    queue.add(text, attachmentIds)
    return Promise.resolve()
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
  // The side panel and its tab (Changes, Files, Browser, Terminal); undefined: closed.
  const [panel, setPanel] = useState<SideTab>()
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
  // "#": every agent this chat can use; the one picked answers from now on (joins the chat if it wasn't in it).
  const available = agents.filter((a) => !a.builtin && (a.projectId === null || a.projectId === chat.projectId))
  const makeLead = (a: Agent) =>
    void updateChat({ params: { id: chat.id }, payload: { agentIds: [a.id, ...chat.agentIds.filter((id) => id !== a.id)], model: a.model }, reactivityKeys: ["chats", "context"] })
  const sourcesWith = (files: ReadonlyArray<WorkspaceFile>): ComposerSources => ({
    leads: available.map((a) => ({
      id: handleOf(a),
      label: a.name,
      hint: a.id === chat.agentIds[0] ? t("composer.answering") : a.title || modelLabel(a.model),
      icon: <AuthorAvatar agent={a} model={null} size={16} />,
      run: () => makeLead(a)
    })),
    // "@": the members first, then the project's files (the agent reads them with its tools).
    agents: [
      ...team.map((a) => ({ id: handleOf(a), label: a.name, icon: <AuthorAvatar agent={a} model={null} size={16} /> })),
      ...files.filter((f) => f.status !== "deleted").map((f) => ({ id: f.path, label: f.path, hint: t("composer.file"), icon: <File className="size-4" /> }))
    ],
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
      />
      <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
      <Timeline chat={chat} state={state} agents={agents} onView={view} onEdit={setRewind} />
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
        <QueuePanel
          items={queue.items}
          canSteer={busy && splitModel(state.live?.model ?? chat.model).provider === "codex-cli"} // only Codex takes a correction mid-turn
          onSteer={(item) => {
            queue.remove(item.id)
            void steer({ payload: { chatId: chat.id, text: item.text, ...(item.attachmentIds.length && { attachmentIds: item.attachmentIds }) } })
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
                  <ContextMeter chatId={chat.id} onCompact={compact} onNewChat={newChat} />
                </>
              }
            />
          )}
        </WithFiles>
        </div>
      </div>
      </div>
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
  onShell
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
}) {
  const projects = useList(projectsAtom)
  const project = projects.find((p) => p.id === chat.projectId)
  const update = useMutation(mutations.updateChat)
  const remove = useMutation(mutations.removeChat)
  const [dialog, setDialog] = useState<"rename" | "delete" | "failover">()

  return (
    <>
      <PageHeader className="min-h-13 gap-x-3 gap-y-2 py-2 pr-4 pl-7">
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
        <ChatProcesses chatId={chat.id} />
        {/* One control for the side panel (Changes, Files, Browser, Terminal live in its tabs); what this chat
            changed shows on it. */}
        <Tooltip content={panelOpen ? t("workspace.closePanel") : t("workspace.openPanel")}>
          <Button size="sm" variant={panelOpen ? "secondary" : "ghost"} aria-expanded={panelOpen} aria-label={panelOpen ? t("workspace.closePanel") : t("workspace.openPanel")} onPress={onPanel} shape="pill">
            <PanelRight />
            {delta.added + delta.removed > 0 && <Delta {...delta} />}
          </Button>
        </Tooltip>
        <TeamPicker chat={chat} />
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

type Item = { at: number; message: Message } | { at: number; note: Note }

export function Timeline({ chat, state, agents, onView, onEdit }: { chat: Chat; state: ChatState; agents: ReadonlyArray<Agent>; onView: (f: Focus) => void; onEdit: (m: Message) => void }) {
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true) // follow new content only while the reader is at the bottom
  const items: Item[] = [...state.messages.map((m) => ({ at: m.at, message: m })), ...state.notes.map((n) => ({ at: n.at, note: n }))].sort((a, b) => a.at - b.at)
  const multi = chat.agentIds.length > 1
  // One agent (or none): the header already says who answers, so replies show no face and no name.
  const solo = !multi

  // biome-ignore lint/correctness/useExhaustiveDependencies: the content is the trigger
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [items.length, state.live?.text, state.live?.steps.length, state.approvals.length])

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
              className={cx(item.message.at <= chat.summaryUntil && "opacity-55")}
              title={item.message.at <= chat.summaryUntil ? t("chat.coveredBySummary") : undefined}
            >
              {item.message.role === "user" ? (
                <UserMessage message={item.message} onEdit={state.live ? undefined : () => onEdit(item.message)} />
              ) : (
                <AgentMessage message={item.message} agents={agents} onView={onView} continued={solo || continues(items[i - 1], item.message)} bare={solo} />
              )}
            </div>
          ) : (
            <TimelineNote key={`${item.note.kind}-${item.note.at}`} note={item.note} agents={agents} />
          )
        )}
        {state.live && <LiveMessage live={state.live} agents={agents} receipts={state.receipts} bare={solo} />}
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
      {open && (
        <div id={id} className="flex flex-col gap-1.5 rounded-card border border-subtle px-4 py-3">
          <p className="text-sm text-dim">{t("chat.summaryHint")}</p>
          <p className="whitespace-pre-wrap text-secondary">{text}</p>
        </div>
      )}
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
                className="inline-flex h-control-sm max-w-60 items-center gap-1.5 rounded-full bg-surface px-3 text-sm text-secondary outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent"
              >
                <File className="size-3.5 shrink-0 text-muted" />
                <span className="truncate">{a.name}</span>
              </a>
            )
          )}
        </div>
      )}
      <div className="rounded-sheet bg-surface px-4 py-2.5 text-chat whitespace-pre-wrap">{m.text}</div>
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
      className={cx(
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

// "Edit from here" (as in T3 Code): the conversation goes back to before this message of yours, which comes back
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
              <strong className="font-semibold" title={model ? modelLabel(model) : undefined}>
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
  if (isInterruption(error)) return { tone: "warning", text: t("chat.interrupted") }
  return { tone: "danger", text: error }
}

function AgentMessage({ message: m, agents, onView, continued, bare }: { message: Message; agents: ReadonlyArray<Agent>; onView: (f: Focus) => void; continued: boolean; bare: boolean }) {
  const accounts = useList(accountsAtom)
  return (
    <div className="flex flex-col gap-6">
      {m.switches.map((sw, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a saved message's switches never change
        <Separator key={i}>{switchText(sw, accounts)}</Separator>
      ))}
      <AgentReply message={m} agents={agents} accounts={accounts} onView={onView} continued={continued} bare={bare} />
    </div>
  )
}

function AgentReply({
  message: m,
  agents,
  accounts,
  onView,
  continued,
  bare
}: { message: Message; agents: ReadonlyArray<Agent>; accounts: ReadonlyArray<ProviderAccount>; onView: (f: Focus) => void; continued: boolean; bare: boolean }) {
  const ending = endingOf(m.error)
  const tokens = m.inputTokens || m.outputTokens ? t("chat.tokens", { input: formatCompact(m.inputTokens), output: formatCompact(m.outputTokens) }) : null
  // Which account answered and what it cost; a subscription shows the API equivalent, not a charge.
  const account = accounts.find((a) => a.id === m.accountId)
  const cost = m.cost === null ? null : account?.kind === "subscription" ? `${t("usage.apiEquivalent")} ${formatCost(m.cost)}` : formatCost(m.cost)
  return (
    <Reply
      agentId={m.agentId}
      model={m.model}
      agents={agents}
      continued={continued}
      bare={bare}
      pill={m.steps.length > 0 && <StoredActivity steps={m.steps} durationMs={m.durationMs} />}
      footer={
        <>
          {ending && (
            <span className={cx("inline-flex items-center gap-1.5 text-sm", ending.tone === "danger" ? "text-danger" : "text-warning")}>
              <CircleAlert className="size-3.5" />
              {ending.tone === "danger" ? t("chat.failed") : ending.text}
            </span>
          )}
          <MessageActions
            text={m.text}
            at={m.at}
            details={
              (m.model || tokens || account || cost) && (
                <span className="flex flex-col gap-0.5">
                  {m.model && <span className="text-fg">{modelLabel(m.model)}</span>}
                  {tokens && <span>{tokens}</span>}
                  {account && <span>{account.label}</span>}
                  {cost && <span>{cost}</span>}
                </span>
              )
            }
          />
        </>
      }
    >
      {m.text && <ChatMarkdown text={m.text} />}
      <TurnChanges message={m} onView={onView} />
      {ending?.tone === "danger" && <pre className="overflow-auto rounded-control bg-code px-3 py-2 font-mono text-sm whitespace-pre-wrap text-danger">{ending.text}</pre>}
    </Reply>
  )
}

// ---------- activity ----------

// A finished turn in one line: its steps, what was refused or failed and how long it took; opens the steps.
function StoredActivity({ steps, durationMs }: { steps: Message["steps"]; durationMs: number | null }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const refused = steps.filter((s) => s.status === "refused").length
  const failed = steps.filter((s) => s.status === "error").length
  const parts = [
    t("activity.steps", { count: steps.length }),
    refused && t("activity.refused", { count: refused }),
    failed && t("activity.errors", { count: failed }),
    durationMs !== null && durationMs >= 1000 && formatDuration(durationMs)
  ].filter(Boolean)
  return (
    <>
      <DisclosurePill expanded={open} onToggle={() => setOpen(!open)} controls={id} leading={<Dot tone={failed ? "danger" : refused ? "warning" : "success"} />}>
        {parts.join(" · ")}
      </DisclosurePill>
      {open && (
        <ol id={id} className="flex max-w-130 basis-full flex-col gap-2.5 rounded-card border border-subtle px-3.5 py-2.5 text-sm">
          {steps.map((s, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: stored steps are immutable and may repeat a tool
            <li key={i} className="flex gap-2.5">
              <StepIcon status={s.status} />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                {/* Native steps: "run" keeps the command, "edit" the files; MCP tools keep name and arguments. */}
                <Code className="self-start break-all">{s.tool === "run" ? `$ ${s.args}` : s.tool === "edit" ? s.args : s.tool}</Code>
                {s.tool !== "run" && s.tool !== "edit" && s.args && s.args !== "{}" && (
                  <pre className="overflow-auto rounded-control bg-code px-2.5 py-1.5 font-mono text-sm text-muted">{s.args}</pre>
                )}
                {s.result && <p className="line-clamp-3 text-sm text-muted">{s.result}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </>
  )
}

function StepIcon({ status }: { status: WorkStep["status"] }) {
  const cls = "mt-0.5 size-4 shrink-0"
  if (status === "running") return <Spinner size={16} className={cx(cls, "text-success")} />
  if (status === "waiting") return <Clock className={cx(cls, "text-accent-text")} />
  if (status === "refused") return <Shield className={cx(cls, "text-warning")} />
  if (status === "error") return <CircleX className={cx(cls, "text-danger")} />
  return <CircleCheck className={cx(cls, "text-success")} />
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

// The turn running now: what it does (a light sweeps across it), or plainly that it waits for the provider before
// anything came back; the time only after 5 s. Questions and approvals wait above the message box (PendingTray).
const SHOW_TIME_AFTER_MS = 5000
function LiveMessage({ live, agents, receipts, bare }: { live: LiveTurn; agents: ReadonlyArray<Agent>; receipts: ReadonlyArray<Receipt>; bare: boolean }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const now = useNow(true)
  const current = [...live.steps].reverse().find((s) => s.status === "running" || s.status === "waiting")
  const idle = !live.text && !live.steps.length
  const elapsed = now - live.startedAt
  const what = current?.title ?? (idle ? t("activity.waitingFor", { provider: providerLabel(splitModel(live.model).provider) }) : t("activity.working"))
  const label = (
    <>
      {idle || current?.status === "waiting" ? what : <ShimmerText>{what}</ShimmerText>}
      {elapsed >= SHOW_TIME_AFTER_MS && <span className="text-muted tabular-nums">{` · ${formatDuration(elapsed)}`}</span>}
    </>
  )
  return (
    <Reply
      agentId={live.agentId}
      model={live.model}
      agents={agents}
      bare={bare}
      continued={bare}
      pill={
        <>
          <DisclosurePill expanded={open} onToggle={() => setOpen(!open)} controls={id} leading={current?.status === "waiting" ? <Clock className="size-3.5 text-accent-text" /> : <Spinner size={12} className="text-success" />}>
            {label}
          </DisclosurePill>
          {open && live.steps.length > 0 && (
            <ol id={id} className="flex max-w-130 basis-full flex-col gap-2 rounded-card border border-subtle px-3.5 py-2.5 text-sm">
              {live.steps.map((s) => (
                <li key={s.id} className="flex items-start gap-2.5">
                  <StepIcon status={s.status} />
                  <span className="min-w-0 flex-1 text-secondary">
                    {s.title}
                    {s.status === "waiting" && <span className="text-accent-text">{` · ${t("activity.waiting")}`}</span>}
                  </span>
                  {s.durationMs !== null && <span className="shrink-0 text-sm text-muted">{formatDuration(s.durationMs)}</span>}
                </li>
              ))}
            </ol>
          )}
        </>
      }
    >
      {live.text ? <ChatMarkdown text={live.text} /> : <TypingDots />}
      {receipts.map((r) => (
        <ReceiptCard key={r.approval.id} receipt={r} />
      ))}
    </Reply>
  )
}

const TypingDots = () => (
  <span role="status" className="inline-flex h-6 items-center gap-1" aria-label={t("activity.working")}>
    {[0, 1, 2].map((i) => (
      <span key={i} className="size-1.5 animate-pulse rounded-full bg-dim motion-reduce:animate-none" style={{ animationDelay: `${i * 180}ms` }} />
    ))}
  </span>
)

// ---------- approvals ----------

// What waits for you in this chat (approvals, questions), right above the message box until you decide, so it
// never scrolls out of sight with the conversation.
function PendingTray({ approvals }: { approvals: ReadonlyArray<Approval> }) {
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
      {details && <pre className="max-h-48 basis-full overflow-auto rounded-control bg-code px-3 py-2 font-mono text-sm text-secondary">{a.args}</pre>}
      {error && <p className="basis-full text-sm text-danger">{error}</p>}
      </div>
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

// What an approval would run, in one line: the shell command or file it names, else the tool.
function commandOf(a: Approval): string {
  try {
    const args = JSON.parse(a.args) as Record<string, unknown>
    const first = [args.command, args.cmd, args.file_path, args.path].find((v) => typeof v === "string")
    if (typeof first === "string") return first
  } catch {
    // not JSON: fall back to the tool's name
  }
  return a.tool
}

// A decision already taken: one quiet line ("Allowed · …").
function ReceiptCard({ receipt: r }: { receipt: Receipt }) {
  const ok = r.outcome === "approved" || r.outcome === "always"
  const question = r.approval.kind === "question"
  return (
    <p className="text-sm text-muted">
      <span className={ok ? "text-success" : "text-secondary"}>
        {r.outcome === "expired" ? t("approval.expired") : question ? (ok ? t("question.answered") : t("question.skipped")) : ok ? t("approval.approved") : t("approval.denied")}
      </span>
      {` · ${r.approval.summary || r.approval.tool}`}
    </p>
  )
}

function TimelineNote({ note, agents }: { note: Note; agents: ReadonlyArray<Agent> }) {
  const accounts = useList(accountsAtom)
  if (note.kind === "failover") return <Separator>{switchText(note.switch, accounts)}</Separator>
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
