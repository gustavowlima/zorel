// What runs in the background (as a reference app's Settings › Background processes, wider): agents working now, programs
// an agent left listening on a port in a chat's folder, open shells, engine sessions kept between turns (a
// Claude Code or Codex process each) and MCP connections. Settings › Processes lists them all by kind; a chat's
// header shows how many belong to it, and opens the same rows for that chat. Everything here can be stopped.
import { useAtomValue } from "@effect/atom-react"
import type { ProcessList } from "@zorel/contracts"
import { formatAge, t } from "@zorel/i18n"
import { AsyncResult } from "effect/reactivity"
import { type ReactNode, useEffect, useState } from "react"
import { agentsAtom, chatsAtom, mutations, processesAtom, projectsAtom, useInvalidate, useList, useMutation, useStatuses } from "../client.ts"
import { chatTitle } from "../labels.ts"
import { go } from "../state.ts"
import { Activity, Button, EmptyState, Globe, IconButton, ListRow, Plug, Popover, Rows, Section, Server, Sparkles, SquareTerminal, Tooltip } from "@/ui"

const EMPTY: ProcessList = { servers: [], terminals: [], sessions: [], connections: [] }

// The list, read again every `every` ms while the page is visible (each read lists listening ports: cheap, not free).
function useProcesses(every: number): ProcessList {
  const list = AsyncResult.getOrElse(useAtomValue(processesAtom), () => EMPTY)
  const invalidate = useInvalidate()
  useEffect(() => {
    const tick = setInterval(() => document.visibilityState === "visible" && invalidate(["processes"]), every)
    return () => clearInterval(tick)
  }, [every, invalidate])
  return list
}

interface Row {
  readonly key: string
  readonly kind: "turn" | "server" | "terminal" | "session" | "connection"
  readonly chatIds: ReadonlyArray<string>
  readonly icon: ReactNode
  readonly title: string
  readonly owner: string // the chat or project it belongs to (left out inside a chat)
  readonly detail: string
  readonly stopLabel: string
  readonly stop: () => Promise<unknown>
  readonly open: () => void
}

// Every process as a row, from the list plus the live chat statuses (agents working).
function useRows(list: ProcessList): Row[] {
  const chats = useList(chatsAtom)
  const agents = useList(agentsAtom)
  const projects = useList(projectsAtom)
  const statuses = useStatuses()
  const invalidate = useInvalidate()
  const stopProcess = useMutation(mutations.stopProcess)
  const closeSession = useMutation(mutations.closeSession)
  const closeConnection = useMutation(mutations.closeConnection)
  const closeTerminal = useMutation(mutations.closeTerminal)
  const interrupt = useMutation(mutations.interrupt)
  const chatName = (id: string) => {
    const chat = chats.find((c) => c.id === id)
    return chat ? chatTitle(chat) : t("processes.hiddenChat")
  }
  const agentName = (id: string | null) => agents.find((a) => a.id === id)?.name ?? t("common.assistant")
  const openChat = (id: string) => () => go({ view: "chat", id })
  const then = (p: Promise<unknown>) => p.finally(() => invalidate(["processes"]))
  return [
    ...Object.values(statuses)
      .filter((s) => s.state !== "idle")
      .map((s): Row => ({
        key: `turn:${s.chatId}`,
        kind: "turn",
        chatIds: [s.chatId],
        icon: <Sparkles />,
        title: s.label || agentName(s.agentId),
        owner: chatName(s.chatId),
        detail: "",
        stopLabel: t("processes.stopTurn"),
        stop: () => interrupt({ payload: { chatId: s.chatId } }),
        open: openChat(s.chatId)
      })),
    ...list.servers.map((s): Row => ({
      key: `server:${s.pid}`,
      kind: "server",
      chatIds: s.chatIds,
      icon: <Globe />,
      title: `${s.command} · ${s.ports.map((p) => `:${p}`).join(" ")}`,
      // A worktree is one chat's; the project folder is every chat's of the project.
      owner: s.chatIds.length === 1 ? chatName(s.chatIds[0]!) : (projects.find((p) => p.id === s.projectId)?.name ?? t("common.general")),
      detail: t("processes.openAt", { url: `localhost:${s.ports[0]}` }),
      stopLabel: t("processes.stop"),
      stop: () => then(stopProcess({ params: { pid: s.pid } })),
      open: () => window.open(`http://localhost:${s.ports[0]}`, "_blank", "noopener")
    })),
    ...list.terminals.map((s): Row => ({
      key: `terminal:${s.id}`,
      kind: "terminal",
      chatIds: [s.chatId],
      icon: <SquareTerminal />,
      title: s.label ?? t("processes.shell", { n: s.n }),
      owner: chatName(s.chatId),
      detail: s.busy ? t("processes.busy") : t("processes.idle"),
      stopLabel: t("processes.close"),
      stop: () => then(closeTerminal({ params: { id: s.chatId, terminal: s.id } })),
      open: openChat(s.chatId)
    })),
    ...list.sessions.map((s): Row => ({
      key: `session:${s.key}`,
      kind: "session",
      chatIds: [s.chatId],
      icon: <Server />,
      title: t("processes.session", { agent: agentName(s.agentId), harness: t(`model.providers.${s.provider}` as "model.providers.claude-cli") }),
      owner: chatName(s.chatId),
      detail: t("processes.usedAgo", { age: formatAge(s.usedAt) }),
      stopLabel: t("processes.close"),
      stop: () => then(closeSession({ params: { key: s.key } })),
      open: openChat(s.chatId)
    })),
    ...list.connections.map((c): Row => ({
      key: `connection:${c.id}`,
      kind: "connection",
      chatIds: [],
      icon: <Plug />,
      title: c.name,
      owner: "",
      detail: c.local ? t("processes.localConnection") : t("processes.remoteConnection"),
      stopLabel: t("processes.disconnect"),
      stop: () => then(closeConnection({ params: { id: c.id } })),
      open: () => go({ view: "settings", tab: "mcp" })
    }))
  ]
}

function StopButton({ row }: { row: Row }) {
  const [busy, setBusy] = useState(false)
  return (
    <Button
      size="sm"
      variant="secondary"
      isPending={busy}
      aria-label={`${row.stopLabel}: ${row.title}`}
      onPress={() => {
        setBusy(true)
        void row.stop().finally(() => setBusy(false))
      }}
    >
      {row.stopLabel}
    </Button>
  )
}

const KINDS = ["turn", "server", "terminal", "session", "connection"] as const

// Settings › Processes.
export function ProcessesSection() {
  const rows = useRows(useProcesses(4000))
  if (!rows.length) return <EmptyState icon={<Activity />} title={t("processes.empty")} hint={t("processes.emptyHint")} />
  return (
    <>
      {KINDS.map((kind) => {
        const of = rows.filter((r) => r.kind === kind)
        if (!of.length) return null
        return (
          <Section key={kind} title={t(`processes.kinds.${kind}`)} description={t(`processes.hints.${kind}`)}>
            <Rows>
              {of.map((r) => (
                <ListRow key={r.key} icon={r.icon} title={r.title} hint={[r.owner, r.detail].filter(Boolean).join(" · ")} label={r.title} onPress={r.open} trailing={<StopButton row={r} />} />
              ))}
            </Rows>
          </Section>
        )
      })}
    </>
  )
}

// A chat's header: how many processes this chat keeps running in the background (servers, shells, its engine
// sessions); opens them with Stop. Nothing shows when there are none.
export function ChatProcesses({ chatId }: { chatId: string }) {
  const rows = useRows(useProcesses(8000)).filter((r) => r.chatIds.includes(chatId) && r.kind !== "turn")
  if (!rows.length) return null
  const label = t("processes.inChat", { count: rows.length })
  return (
    <Popover
      label={label}
      placement="bottom end"
      className="w-96"
      trigger={
        <Tooltip content={label}>
          <IconButton label={label} shape="pill" className="w-auto gap-1 px-2 text-muted">
            <Activity />
            <span className="text-sm tabular-nums">{rows.length}</span>
          </IconButton>
        </Tooltip>
      }
    >
      <div className="flex flex-col p-1.5">
        <span className="px-2 pt-1 pb-2 text-sm text-muted">{label}</span>
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-3 rounded-control px-2 py-1.5">
            <span className="flex size-5 shrink-0 items-center justify-center text-muted [&_svg]:size-4">{r.icon}</span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium">{r.title}</span>
              <span className="truncate text-xs text-muted">{r.detail}</span>
            </span>
            <StopButton row={r} />
          </div>
        ))}
        <Button size="sm" variant="ghost" className="mt-1 justify-start text-muted" onPress={() => go({ view: "settings", tab: "processes" })}>
          {t("processes.seeAll")}
        </Button>
      </div>
    </Popover>
  )
}
