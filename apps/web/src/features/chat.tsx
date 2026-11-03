// Chat (prototype "Main"): header with the team, the conversation as a timeline (your messages on the
// right, each agent's reply with its activity pill, approvals waiting for you, handoffs between agents),
// and the message box. State is the chat atom: snapshot + live events, so a turn keeps going if the tab
// closes and the screen catches up when it reopens.
import { type Agent, type Chat, type FailoverTarget, type Message, type ProviderAccount, skillHandle, type WorkspaceFile } from "@zero/contracts"
import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import { type Approval, ErrorCode, isInterruption, type WorkStep } from "@zero/contracts/events"
import { formatCompact, formatDuration, formatTime, t } from "@zero/i18n"
import { type ReactNode, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { accountsAtom, agentsAtom, attachmentUrl, commandsAtom, filesAtom, memoriesAtom, type ChatState, type LiveTurn, mutations, type Note, projectsAtom, type Receipt, uploadAttachment, useChat, useList, useMutation } from "../client.ts"
import { agentName, chatTitle, formatCost, handleOf, modelLabel, switchText } from "../labels.ts"
import { go } from "../state.ts"
import { Composer, type ComposerSources } from "./composer.tsx"
import { ContextMeter } from "./context-meter.tsx"
import { QueuePanel, useQueue } from "./queue.tsx"
import { FailoverEditor, useTermsPending } from "./failover.tsx"
import { chatDelta, Delta, type Focus, TerminalPanel, TurnChanges, WorkspacePanel } from "./workspace.tsx"
import { ModelPicker } from "./model-picker.tsx"
import { AuthorAvatar, TeamPicker } from "./people.tsx"
import {
  Button, Check, CircleAlert, CircleCheck, CircleX, Clock, Code, ConfirmDialog, Copy, cx, Dialog, DisclosurePill, Dot, EmptyState, Field, File, IconButton, ImageViewer, Info, Input, Menu, MenuItem,
  MenuSeparator, MessageCircle, Minimize2, MoreHorizontal, PanelBottom, PanelRight, Pencil, Shield, Shuffle, Sparkles, Spinner, SquarePen, SquareTerminal, Switch, Tooltip, Trash2
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
  const second = team[1]
  const projects = useList(projectsAtom)
  const project = projects.find((p) => p.id === chat.projectId)
  const [panel, setPanel] = useState<"changes" | "files">()
  const [terminal, setTerminal] = useState(false)
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
  // What "@", "$" and "/" offer in this chat: its agents, the skills it can use, Zero's commands.
  const scopes = new Set(["user", ...(chat.projectId ? [`project:${chat.projectId}`] : []), ...chat.agentIds.map((id) => `agent:${id}`)])
  // "#": every agent this chat can use; the one picked answers from now on (joins the chat if it wasn't in it).
  const available = agents.filter((a) => a.projectId === null || a.projectId === chat.projectId)
  const makeLead = (a: Agent) =>
    void updateChat({ params: { id: chat.id }, payload: { agentIds: [a.id, ...chat.agentIds.filter((id) => id !== a.id)], model: a.model }, reactivityKeys: ["chats", "context"] })
  const sourcesWith = (files: ReadonlyArray<WorkspaceFile>): ComposerSources => ({
    leads: available.map((a) => ({
      id: handleOf(a),
      label: a.name,
      hint: a.id === chat.agentIds[0] ? t("composer.answering") : modelLabel(a.model),
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
      ...(project?.path ? [{ id: "terminal", label: t("composer.command.terminal"), hint: t("composer.command.terminalHint"), icon: <PanelBottom className="size-4" />, run: () => setTerminal(true) }] : []),
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
        terminalOpen={terminal}
        onTerminal={() => setTerminal(!terminal)}
        workspace={!!project?.path}
      />
      <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
      <Timeline chat={chat} state={state} agents={agents} onView={view} />
      <div className="mx-auto w-full max-w-180 px-6 pt-2 pb-4.5">
        <QueuePanel
          items={queue.items}
          canSteer={busy}
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
              sources={sourcesWith(files)}
              busy={busy}
              onStop={() => void interrupt({ payload: { chatId: chat.id } })}
              onSubmit={submit}
              upload={(f) => uploadAttachment(chat.id, f)}
              placeholder={team[0] && second ? t("composer.placeholderTeam", { name: team[0].name }) : t("composer.placeholder")}
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
      {terminal && <TerminalPanel chatId={chat.id} onClose={() => setTerminal(false)} />}
      </div>
      {panel && (
        <WorkspacePanel chat={chat} project={project} messages={state.messages} agents={agents} tab={panel} onTab={setPanel} focus={focus} onFocus={setFocus} onClose={() => setPanel(undefined)} />
      )}
      </div>
    </section>
  )
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
  terminalOpen,
  onTerminal,
  workspace
}: {
  chat: Chat
  team: ReadonlyArray<Agent>
  delta: { added: number; removed: number }
  panelOpen: boolean
  onPanel: () => void
  terminalOpen: boolean
  onTerminal: () => void
  workspace: boolean
}) {
  const projects = useList(projectsAtom)
  const project = projects.find((p) => p.id === chat.projectId)
  const update = useMutation(mutations.updateChat)
  const remove = useMutation(mutations.removeChat)
  const consolidate = useMutation(mutations.consolidate)
  const [dialog, setDialog] = useState<"rename" | "delete" | "failover">()
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string }>()
  const [compacting, setCompacting] = useState(false)

  const compact = () => {
    setCompacting(true)
    setNote(undefined)
    consolidate({ params: { id: chat.id }, reactivityKeys: ["chats", "memories"] })
      .then(
        () => setNote({ tone: "ok", text: t("chat.compacted") }),
        () => setNote({ tone: "error", text: t("chat.compactFailed") })
      )
      .finally(() => setCompacting(false))
  }

  return (
    <>
      <header className="flex min-h-13 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-subtle py-2 pr-4 pl-7">
        <div className="flex min-w-0 flex-1 items-baseline gap-3">
          <h1 className="truncate text-lg font-semibold">{chatTitle(chat)}</h1>
          <Button size="sm" variant="ghost" className="-ml-2 shrink-0 text-muted" onPress={() => go(project ? { view: "project", id: project.id, tab: "overview" } : { view: "home" })}>
            {project?.name ?? t("common.general")}
          </Button>
        </div>
        {compacting && (
          <span className="inline-flex items-center gap-1.5 text-sm text-muted">
            <Spinner size={12} /> {t("chat.compacting")}
          </span>
        )}
        {(workspace || delta.added + delta.removed > 0) && (
          <Button size="sm" variant={panelOpen ? "secondary" : "ghost"} aria-expanded={panelOpen} onPress={onPanel} className="rounded-full">
            <PanelRight />
            {t("workspace.changes")}
            {delta.added + delta.removed > 0 && <Delta {...delta} />}
          </Button>
        )}
        {workspace && (
          <Button size="sm" variant={terminalOpen ? "secondary" : "ghost"} aria-expanded={terminalOpen} onPress={onTerminal} className="rounded-full">
            <PanelBottom />
            {t("workspace.terminal")}
          </Button>
        )}
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
          <MenuItem icon={<Sparkles />} onAction={compact}>
            {t("chat.compact")}
          </MenuItem>
          <MenuItem icon={<Shuffle />} onAction={() => setDialog("failover")}>
            {t("failover.menu")}
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={<Trash2 />} tone="danger" onAction={() => setDialog("delete")}>
            {t("common.delete")}
          </MenuItem>
        </Menu>
      </header>
      {note && (
        <div className={cx("flex items-center justify-center gap-3 border-b border-subtle px-7 py-2 text-sm", note.tone === "ok" ? "text-secondary" : "text-danger")}>
          <span>{note.text}</span>
          {note.tone === "ok" && (
            <Button size="sm" variant="secondary" onPress={() => go({ view: "inbox" })}>
              {t("chat.review")}
            </Button>
          )}
        </div>
      )}
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

function RenameDialog({ isOpen, onClose, title, onSave }: { isOpen: boolean; onClose: () => void; title: string; onSave: (title: string) => void }) {
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

function Timeline({ chat, state, agents, onView }: { chat: Chat; state: ChatState; agents: ReadonlyArray<Agent>; onView: (f: Focus) => void }) {
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true) // follow new content only while the reader is at the bottom
  const items: Item[] = [...state.messages.map((m) => ({ at: m.at, message: m })), ...state.notes.map((n) => ({ at: n.at, note: n }))].sort((a, b) => a.at - b.at)
  const multi = chat.agentIds.length > 1

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
      <div className="mx-auto flex w-full max-w-180 flex-col gap-7 px-7 pt-6 pb-8">
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
                <UserMessage message={item.message} />
              ) : (
                <AgentMessage message={item.message} agents={agents} onView={onView} continued={continues(items[i - 1], item.message)} />
              )}
            </div>
          ) : (
            <TimelineNote key={`${item.note.kind}-${item.note.at}`} note={item.note} agents={agents} />
          )
        )}
        {state.live && <LiveMessage live={state.live} agents={agents} approvals={state.approvals} receipts={state.receipts} />}
        {!state.live && state.approvals.map((a) => <ApprovalCard key={a.id} approval={a} />)}
        {multi && state.ready && items.length === 0 && <p className="text-center text-sm text-dim">{t("team.mentionHint")}</p>}
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

function UserMessage({ message: m }: { message: Message }) {
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
      <div className="rounded-sheet bg-surface px-4 py-2.5 whitespace-pre-wrap">{m.text}</div>
      <MessageActions text={m.text} at={m.at} align="end" />
    </div>
  )
}

// Under a message, shown on hover or focus (always on touch): copy, when it was written and, for a reply, the
// details (model, tokens, account, cost) in a tooltip. Quiet, so a conversation reads as text.
function MessageActions({ text, at, details, align = "start" }: { text: string; at: number; details?: ReactNode; align?: "start" | "end" }) {
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
          <IconButton label={t("common.copy")} size="sm" onPress={copy}>
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          </IconButton>
        </Tooltip>
      )}
      {details && (
        <Tooltip content={details}>
          <IconButton label={t("chat.details")} size="sm">
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

// Agent reply: avatar column + content (name with its activity pill, text, how it ended; model, tokens and
// cost in the footer line).
function Reply({
  agentId,
  model,
  agents,
  pill,
  children,
  footer,
  continued = false
}: { agentId: string | null; model: string | null; agents: ReadonlyArray<Agent>; pill?: ReactNode; children: ReactNode; footer?: ReactNode; continued?: boolean }) {
  const agent = agents.find((a) => a.id === agentId)
  return (
    <article className="group/msg flex gap-3" aria-label={continued ? agentName(agentId, agents) : undefined}>
      {continued ? <span aria-hidden="true" className="w-7 shrink-0" /> : <AuthorAvatar agent={agent} model={model} size={28} />}
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

const prose = (text: string) => (
  <div className="prose-chat leading-relaxed">
    <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
  </div>
)

function endingOf(error: string | null): { tone: "warning" | "danger"; text: string } | undefined {
  if (!error) return undefined
  if (error === ErrorCode.cancelled) return { tone: "warning", text: t("chat.cancelled") }
  if (error === ErrorCode.serverRestarted) return { tone: "warning", text: t("chat.serverRestarted") }
  if (isInterruption(error)) return { tone: "warning", text: t("chat.interrupted") }
  return { tone: "danger", text: error }
}

function AgentMessage({ message: m, agents, onView, continued }: { message: Message; agents: ReadonlyArray<Agent>; onView: (f: Focus) => void; continued: boolean }) {
  const accounts = useList(accountsAtom)
  return (
    <div className="flex flex-col gap-6">
      {m.switches.map((sw, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a saved message's switches never change
        <Separator key={i}>{switchText(sw, accounts)}</Separator>
      ))}
      <AgentReply message={m} agents={agents} accounts={accounts} onView={onView} continued={continued} />
    </div>
  )
}

function AgentReply({
  message: m,
  agents,
  accounts,
  onView,
  continued
}: { message: Message; agents: ReadonlyArray<Agent>; accounts: ReadonlyArray<ProviderAccount>; onView: (f: Focus) => void; continued: boolean }) {
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
      pill={m.steps.length > 0 && <StoredActivity steps={m.steps} />}
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
      {m.text && prose(m.text)}
      <TurnChanges message={m} onView={onView} />
      {ending?.tone === "danger" && <pre className="overflow-auto rounded-control bg-code px-3 py-2 font-mono text-sm whitespace-pre-wrap text-danger">{ending.text}</pre>}
    </Reply>
  )
}

// ---------- activity ----------

function StoredActivity({ steps }: { steps: Message["steps"] }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const refused = steps.filter((s) => s.status === "refused").length
  const failed = steps.filter((s) => s.status === "error").length
  const parts = [t("activity.steps", { count: steps.length }), refused && t("activity.refused", { count: refused }), failed && t("activity.errors", { count: failed })].filter(Boolean)
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

function LiveMessage({ live, agents, approvals, receipts }: { live: LiveTurn; agents: ReadonlyArray<Agent>; approvals: ReadonlyArray<Approval>; receipts: ReadonlyArray<Receipt> }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const now = useNow(true)
  const current = [...live.steps].reverse().find((s) => s.status === "running" || s.status === "waiting")
  const label = [current?.title ?? t("activity.working"), formatDuration(now - live.startedAt)].join(" · ")
  return (
    <Reply
      agentId={live.agentId}
      model={live.model}
      agents={agents}
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
      {live.text ? prose(live.text) : <TypingDots />}
      {receipts.map((r) => (
        <ReceiptCard key={r.approval.id} receipt={r} />
      ))}
      {approvals.map((a) => (
        <ApprovalCard key={a.id} approval={a} />
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

function ApprovalCard({ approval: a }: { approval: Approval }) {
  const decide = useMutation(mutations.decide)
  const agents = useList(agentsAtom)
  const [pending, setPending] = useState<"approved" | "denied">()
  const [error, setError] = useState<string>()
  const [details, setDetails] = useState(false)
  const choose = (outcome: "approved" | "denied") => {
    setPending(outcome)
    decide({ payload: { approvalId: a.id, outcome }, reactivityKeys: ["approvals"] }).catch(() => {
      setPending(undefined)
      setError(t("chat.approvalGone"))
    })
  }
  const command = commandOf(a)
  return (
    <section aria-label={t("approval.waiting")} className="flex w-full max-w-130 flex-wrap items-center gap-2.5 rounded-card border border-accent-line bg-accent-faint py-2.5 pr-2.5 pl-3.5">
      <span className="flex min-w-50 flex-1 flex-col">
        <span className="font-medium text-accent-text">{a.summary || t("approval.wantsTo", { agent: agentName(a.agentId, agents), tool: a.tool })}</span>
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
      <Button size="sm" variant="default" isPending={pending === "approved"} isDisabled={!!pending} onPress={() => choose("approved")}>
        {t("approval.allow")}
      </Button>
      {details && <pre className="max-h-48 basis-full overflow-auto rounded-control bg-code px-3 py-2 font-mono text-sm text-secondary">{a.args}</pre>}
      {error && <p className="basis-full text-sm text-danger">{error}</p>}
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
  return (
    <p className="text-sm text-muted">
      <span className={ok ? "text-success" : "text-secondary"}>{ok ? t("approval.approved") : r.outcome === "expired" ? t("approval.expired") : t("approval.denied")}</span>
      {` · ${r.approval.summary || r.approval.tool}`}
    </p>
  )
}

function TimelineNote({ note, agents }: { note: Note; agents: ReadonlyArray<Agent> }) {
  const accounts = useList(accountsAtom)
  if (note.kind === "failover") return <Separator>{switchText(note.switch, accounts)}</Separator>
  const to = note.to.map((id) => agentName(id, agents)).join(", ")
  return <Separator>{t("chat.handoff", { from: agentName(note.from, agents), to })}</Separator>
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
