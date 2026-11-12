// What runs in the background: agents working now, programs
// an agent left listening on a port in a chat's folder, open shells, engine sessions kept between turns (a
// Claude Code or Codex process each) and MCP connections. Settings › Processes lists them all by kind; a chat's
// header shows how many belong to it, and opens the same rows for that chat. Everything here can be stopped.
// CPU and memory are live (read while the page is visible): 100% CPU is one full core. Zorel's own processes (its
// server, the desktop app) are rows too, so the list adds up to the total on top.
import { useAtomValue } from "@effect/atom-react"
import type { ProcessList } from "@zorel/contracts"
import { formatAge, formatBytes, formatNumber, t } from "@zorel/i18n"
import { AsyncResult } from "effect/reactivity"
import { type ReactNode, useEffect, useState } from "react"
import { agentsAtom, chatsAtom, mutations, processesAtom, projectsAtom, useInvalidate, useList, useMutation, useStatuses } from "../client.ts"
import { chatTitle } from "../labels.ts"
import { go } from "../state.ts"
import { Activity, AppWindow, Button, CircleStop, Cpu, Dot, EmptyState, Globe, IconButton, IconTile, MemoryStick, Plug, Popover, RowHit, Section, Server, Sparkles, SquareTerminal, Tooltip, X } from "@/ui"

const EMPTY: ProcessList = { servers: [], terminals: [], sessions: [], connections: [], usage: { cpu: 0, memory: 0, cores: 1, totalMemory: 1, parts: [] } }
const cpuText = (cpu: number) => `${formatNumber(Math.round(cpu))}%`

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
  readonly kind: "turn" | "server" | "terminal" | "session" | "connection" | "zorel"
  readonly chatIds: ReadonlyArray<string>
  readonly icon: ReactNode
  readonly title: string
  readonly owner: string // the chat or project it belongs to (left out inside a chat)
  readonly detail: string
  readonly use?: { cpu: number; memory: number } | undefined // none: a turn (it runs in its session), a remote connection
  readonly nested?: boolean // runs inside another row (a server in a shell): left out of sums
  readonly stopLabel: string
  readonly stop?: () => Promise<unknown> // none: Zorel's own (stop it by quitting)
  readonly open?: () => void
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
      .filter((s) => s.state === "running" || s.state === "waiting") // a failed chat has nothing left to stop
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
      use: s,
      nested: s.nested,
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
      use: s,
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
      use: s,
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
      use: c.local ? c : undefined, // a remote one runs elsewhere: nothing to measure here
      title: c.name,
      owner: "",
      detail: c.local ? t("processes.localConnection") : t("processes.remoteConnection"),
      stopLabel: t("processes.disconnect"),
      stop: () => then(closeConnection({ params: { id: c.id } })),
      open: () => go({ view: "settings", tab: "mcp" })
    }))
  ]
}

// The row's action (stop, close, disconnect): a quiet icon with its name in a tooltip.
function StopButton({ row }: { row: Row }) {
  const [busy, setBusy] = useState(false)
  if (!row.stop) return <span className="size-7" />
  const stop = row.stop
  return (
    <Tooltip content={row.stopLabel}>
      <IconButton
        size="sm"
        label={`${row.stopLabel}: ${row.title}`}
        isPending={busy}
        className="text-muted data-hovered:text-danger"
        onPress={() => {
          setBusy(true)
          void stop().finally(() => setBusy(false))
        }}
      >
        {row.kind === "server" || row.kind === "turn" ? <CircleStop /> : <X />}
      </IconButton>
    </Tooltip>
  )
}

// One process: what it is, whose, and its CPU and memory in fixed columns (so they read down the list).
function ProcessRow({ row, compact = false }: { row: Row; compact?: boolean }) {
  const sub = compact ? row.detail : row.owner || row.detail
  return (
    <div className="relative flex items-center gap-3 py-2">
      {row.open && <RowHit label={row.title} onPress={row.open} />}
      <span className="pointer-events-none relative flex w-5 shrink-0 justify-center text-muted [&_svg]:size-4">{row.icon}</span>
      <span className="pointer-events-none relative flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{row.title}</span>
        {sub && <span className="truncate text-xs text-muted">{sub}</span>}
      </span>
      <span className="pointer-events-none relative w-16 shrink-0 text-right text-sm tabular-nums text-secondary">{row.use ? cpuText(row.use.cpu) : "–"}</span>
      <span className="pointer-events-none relative w-20 shrink-0 text-right text-sm tabular-nums text-secondary">{row.use ? formatBytes(row.use.memory) : "–"}</span>
      <span className="relative flex w-7 shrink-0 justify-end">
        <StopButton row={row} />
      </span>
    </div>
  )
}

// The columns' names, once, with their icons.
const Columns = () => (
  <div className="flex items-center gap-3 pb-1.5 text-xs text-muted">
    <span className="w-5 shrink-0" />
    <span className="flex-1">{t("processes.process")}</span>
    <span className="flex w-16 shrink-0 items-center justify-end gap-1 [&_svg]:size-3.5">
      <Cpu />
      {t("processes.usage.cpu")}
    </span>
    <span className="flex w-20 shrink-0 items-center justify-end gap-1 [&_svg]:size-3.5">
      <MemoryStick />
      {t("processes.usage.memory")}
    </span>
    <span className="w-7 shrink-0" />
  </div>
)

const KINDS = ["turn", "server", "terminal", "session", "connection", "zorel"] as const

// Settings › Processes: Zorel's total on one line, then every process in one list, grouped by kind.
export function ProcessesSection() {
  const list = useProcesses(3000)
  const rows = [...useRows(list), ...zorelRows(list.usage)]
  const { usage } = list
  return (
    <Section title={t("processes.title")}>
      {usage.memory > 0 && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <Stat tone="bg-series-1/15 text-series-1" icon={<Cpu />} value={cpuText(usage.cpu)} label={t("processes.usage.cpu")} hint={t("processes.usage.cores", { count: usage.cores })} />
          <Stat tone="bg-series-7/15 text-series-7" icon={<MemoryStick />} value={formatBytes(usage.memory)} label={t("processes.usage.memory")} hint={t("processes.usage.ofMemory", { total: formatBytes(usage.totalMemory) })} />
          <span className="ml-auto flex items-center gap-1.5 text-xs text-muted">
            <Dot tone="success" />
            {t("processes.usage.live")}
          </span>
        </div>
      )}
      {rows.length === 0 ? (
        <EmptyState inset scene="resting" icon={<Activity />} title={t("processes.empty")} hint={t("processes.emptyHint")} />
      ) : (
        <div className="flex flex-col">
          <Columns />
          <div className="flex flex-col border-t border-subtle">
            {KINDS.map((kind) => {
              const of = rows.filter((r) => r.kind === kind)
              if (!of.length) return null
              return (
                <div key={kind} className="flex flex-col border-b border-subtle pt-2.5 pb-1.5">
                  <span className="text-xs text-muted">{t(`processes.kinds.${kind}`)}</span>
                  {of.map((r) => (
                    <ProcessRow key={r.key} row={r} />
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </Section>
  )
}

// CPU or memory in the summary line: icon, value, what it is and its scale.
// A live number with its own color (the chart series'), so the two read apart at a glance.
const Stat = ({ icon, value, label, hint, tone }: { icon: ReactNode; value: string; label: string; hint: string; tone: string }) => (
  <span className="flex items-center gap-2">
    <IconTile size="sm" className={tone}>{icon}</IconTile>
    <span className="flex flex-col leading-tight">
      <span className="font-semibold tabular-nums">
        {value} <span className="font-normal text-muted">{label}</span>
      </span>
      <span className="text-xs text-dim">{hint}</span>
    </span>
  </span>
)

// Zorel's own processes (its server, the desktop app, what else they started) as rows of their own.
function zorelRows(usage: ProcessList["usage"]): Row[] {
  return usage.parts
    .filter((p) => (p.id === "server" || p.id === "app" || p.id === "other") && p.memory > 0)
    .map((p) => ({ key: `zorel:${p.id}`, kind: "zorel", chatIds: [], icon: p.id === "app" ? <AppWindow /> : <Server />, title: t(`processes.usage.parts.${p.id}`), owner: "", detail: "", use: p, stopLabel: "" }))
}

// A chat's header: how many processes this chat keeps running in the background (servers, shells, its engine
// sessions); opens them with their CPU, memory and Stop. Nothing shows when there are none.
export function ChatProcesses({ chatId }: { chatId: string }) {
  const rows = useRows(useProcesses(5000)).filter((r) => r.chatIds.includes(chatId) && r.kind !== "turn")
  if (!rows.length) return null
  const total = rows.filter((r) => !r.nested).reduce((a, r) => ({ cpu: a.cpu + (r.use?.cpu ?? 0), memory: a.memory + (r.use?.memory ?? 0) }), { cpu: 0, memory: 0 })
  const label = t("processes.inChat", { count: rows.length })
  return (
    <Popover
      label={label}
      placement="bottom end"
      className="w-104"
      trigger={
        <Tooltip content={label}>
          <IconButton label={label} shape="pill" className="w-auto gap-1 px-2 text-muted">
            <Activity />
            <span className="text-sm tabular-nums">{rows.length}</span>
          </IconButton>
        </Tooltip>
      }
    >
      <div className="flex flex-col px-3.5 pt-3 pb-2">
        <div className="flex items-center gap-4 pb-2.5 text-sm">
          <span className="font-medium">{label}</span>
          <span className="ml-auto flex items-center gap-1 text-muted tabular-nums [&_svg]:size-3.5">
            <Cpu />
            {cpuText(total.cpu)}
          </span>
          <span className="flex items-center gap-1 text-muted tabular-nums [&_svg]:size-3.5">
            <MemoryStick />
            {formatBytes(total.memory)}
          </span>
        </div>
        <div className="flex flex-col border-t border-subtle pt-1">
          {rows.map((r) => (
            <ProcessRow key={r.key} row={r} compact />
          ))}
        </div>
        <Button size="sm" variant="ghost" className="mt-1 -ml-2 self-start text-muted" onPress={() => go({ view: "settings", tab: "processes" })}>
          {t("processes.seeAll")}
        </Button>
      </div>
    </Popover>
  )
}
