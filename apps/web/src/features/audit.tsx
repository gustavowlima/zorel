// Settings › Audit log (inspired by a reference app's): every change to providers, projects, agents, MCP servers and
// every approval or undo, newest first by day, with who did it and the fields before → after. Filters by kind,
// words and a span of days run on the server, which sends one page of 50 and the total. Records come from the server's Audit service (evlog audit events in SQLite).
import { useAtomValue } from "@effect/atom-react"
import type { AuditEntry, AuditKind } from "@zero/contracts"
import { AsyncResult } from "effect/reactivity"
import { formatDate, formatTime, type MessageKey, t } from "@zero/i18n"
import { type ReactNode, useEffect, useState } from "react"
import { agentsAtom, auditAtom, useInvalidate, useList } from "../client.ts"
import { ReadingState } from "./reading.tsx"
import { modelLabel } from "../labels.ts"
import { ArrowRight, Bot, Button, ChevronRight, Folder, Input, KeyRound, Plug, Rows, Search, Section, Select, Shield, Undo2, cx } from "@/ui"

const KINDS: ReadonlyArray<AuditKind> = ["all", "providers", "projects", "tools", "approvals"]


// The icon tile: what was touched, tinted by what happened to it.
const toneOf = (e: AuditEntry) => {
  const verb = e.action.split(".")[1] ?? ""
  if (e.outcome !== "success" || verb === "deleted" || verb === "removed" || verb === "denied" || verb === "cleared") return "bg-danger-soft text-danger"
  if (verb === "created" || verb === "added" || verb === "approved" || verb === "set") return "bg-success-faint text-success"
  return "bg-accent-soft text-accent-text"
}
const iconOf = (e: AuditEntry): ReactNode => {
  const resource = e.action.split(".")[0]
  if (resource === "agent") return <Bot />
  if (resource === "project") return <Folder />
  if (resource === "mcp_server") return <Plug />
  if (resource === "turn") return <Undo2 />
  if (resource === "approval") return <Shield />
  return <KeyRound />
}

const ACTIONS = new Set([
  "project.created", "project.updated", "project.deleted", "agent.created", "agent.updated", "agent.deleted", "account.added", "account.renamed",
  "account.removed", "account.signin_started", "api_key.set", "api_key.cleared", "mcp_server.added", "mcp_server.updated", "mcp_server.removed",
  "failover_terms.accepted", "approval.approved", "approval.denied", "turn.undone"
])
const ACCESS = new Set(["workspace", "ask", "full"])
const FIELDS = new Set(["name", "brief", "path", "instructions", "model", "accountId", "effort", "failover", "access", "label", "mode", "enabled", "provider"])

export function AuditSection() {
  const agents = useList(agentsAtom)
  const invalidate = useInvalidate()
  const [kind, setKind] = useState<AuditKind>("all")
  const [typed, setTyped] = useState("")
  const [q, setQ] = useState("")
  const [from, setFrom] = useState("") // yyyy-mm-dd, the computer's own day
  const [to, setTo] = useState("")
  const [page, setPage] = useState(0)
  // Words are sent a moment after typing stops; any change of filter goes back to the first page.
  useEffect(() => {
    const id = setTimeout(() => {
      setQ(typed.trim())
      setPage(0)
    }, 300)
    return () => clearTimeout(id)
  }, [typed])
  // A new filter starts again at the first page.
  const narrow = <A,>(set: (a: A) => void) => (a: A) => {
    set(a)
    setPage(0)
  }
  // Other screens don't refresh the log when they change something: read it fresh on open.
  useEffect(() => invalidate(["audit"]), [invalidate])

  const query = {
    ...(kind !== "all" && { kind }),
    ...(q && { q }),
    ...(from && { from: dayStart(from) }),
    ...(to && { to: dayStart(to) + DAY }),
    ...(page > 0 && { page })
  }
  const result = useAtomValue(auditAtom(query))
  const data = AsyncResult.getOrElse(result, () => undefined)
  const shown = data?.entries ?? []
  const filtered = kind !== "all" || !!q || !!from || !!to
  const actorName = (e: AuditEntry) =>
    e.actor.type === "user" ? t("audit.you") : e.actor.type === "agent" ? (agents.find((a) => a.id === e.actor.id)?.name ?? t("audit.removedAgent")) : t("app.name")

  // Entries by day (Today, Yesterday, a date), newest first: a time alone can't tell yesterday from today.
  const days = shown.reduce<Array<{ day: string; entries: AuditEntry[] }>>((acc, e) => {
    const day = dayOf(e.at)
    const last = acc.at(-1)
    if (last?.day === day) last.entries.push(e)
    else acc.push({ day, entries: [e] })
    return acc
  }, [])
  const first = data ? data.page * data.pageSize + 1 : 0
  const last = data ? data.page * data.pageSize + shown.length : 0
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <Section
      title={t("audit.changes")}
      action={
        filtered && (
          <Button
            size="sm"
            variant="ghost"
            onPress={() => {
              setKind("all")
              setTyped("")
              setFrom("")
              setTo("")
              setPage(0)
            }}
          >
            {t("audit.clearFilters")}
          </Button>
        )
      }
    >
      {/* Filters: kind, words, and a span of days (either end may stay open). */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Select
            className="w-auto"
            aria-label={t("audit.kind")}
            value={kind}
            onChange={(v) => narrow(setKind)(v as AuditKind)}
            options={KINDS.map((k) => ({ value: k, label: t(`audit.kinds.${k}`) }))}
          />
          <label className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" />
            <Input className="pl-8" placeholder={t("audit.search")} aria-label={t("audit.search")} value={typed} onChange={(e) => setTyped(e.target.value)} />
          </label>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted">
          <span>{t("audit.from")}</span>
          <Input type="date" className="w-auto" aria-label={t("audit.from")} value={from} max={to || undefined} onChange={(e) => narrow(setFrom)(e.target.value)} />
          <span>{t("audit.to")}</span>
          <Input type="date" className="w-auto" aria-label={t("audit.to")} value={to} min={from || undefined} onChange={(e) => narrow(setTo)(e.target.value)} />
        </div>
      </div>
      <ReadingState loading={AsyncResult.isInitial(result)} failed={AsyncResult.isFailure(result)} onRetry={() => invalidate(["audit"])} />
      {data && shown.length === 0 && <p className="text-muted">{filtered ? t("audit.noMatch") : t("audit.empty")}</p>}
      {days.map(({ day, entries: list }) => (
        <div key={day} className="flex flex-col gap-2">
          <h3 className="pt-2 text-xs font-medium text-dim">{day}</h3>
          <Rows>
            {list.map((e) => (
              <div key={e.id} className="flex items-start gap-3 py-3">
                <span className={cx("mt-px flex size-6 shrink-0 items-center justify-center rounded-control [&_svg]:size-3.5", toneOf(e))}>{iconOf(e)}</span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <Sentence entry={e} />
                  {e.changes.length > 0 && (e.action.endsWith("updated") || e.action.endsWith("renamed")) ? (
                    <span className="flex flex-col gap-0.5 text-sm">
                      {e.changes.map((c) => (
                        <span key={c.field} className="flex min-w-0 flex-wrap items-center gap-x-1.5">
                          <span className="text-muted">{FIELDS.has(c.field) ? t(`audit.fields.${c.field}` as MessageKey) : c.field}:</span>
                          <Value field={c.field} value={c.before} tone="before" />
                          <ArrowRight className="size-3.5 shrink-0 text-muted" />
                          <Value field={c.field} value={c.after} tone="after" />
                        </span>
                      ))}
                    </span>
                  ) : null}
                  {e.reason && <span className="text-sm text-muted">{e.reason}</span>}
                  <span className="text-sm text-muted">{actorName(e)}</span>
                </span>
                <time className="shrink-0 text-sm text-muted tabular-nums" dateTime={new Date(e.at).toISOString()} title={new Date(e.at).toLocaleString()}>
                  {formatTime(e.at)}
                </time>
              </div>
            ))}
          </Rows>
        </div>
      ))}
      {data && data.total > data.pageSize && (
        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="text-sm text-muted tabular-nums">{t("audit.range", { first, last, total: data.total })}</span>
          <span className="flex items-center gap-1">
            <Button size="sm" variant="ghost" isDisabled={data.page === 0} onPress={() => setPage(data.page - 1)}>
              <ChevronRight className="size-3.5 rotate-180" />
              {t("audit.newer")}
            </Button>
            <span className="px-1 text-sm text-muted tabular-nums">{t("audit.pageOf", { page: data.page + 1, pages })}</span>
            <Button size="sm" variant="ghost" isDisabled={data.page + 1 >= pages} onPress={() => setPage(data.page + 1)}>
              {t("audit.older")}
              <ChevronRight className="size-3.5" />
            </Button>
          </span>
        </div>
      )}
    </Section>
  )
}

const DAY = 86_400_000
// The start of a "yyyy-mm-dd" day on this computer.
const dayStart = (date: string) => {
  const [y = 0, m = 1, d = 1] = date.split("-").map(Number)
  return new Date(y, m - 1, d).getTime()
}
// "Today", "Yesterday" or the date, in the computer's own day.
function dayOf(at: number): string {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  if (at >= start.getTime()) return t("audit.today")
  if (at >= start.getTime() - DAY) return t("audit.yesterday")
  return formatDate(at)
}

// "Changed the agent {name}" with the name set apart; an unknown action shows as recorded.
function Sentence({ entry: e }: { entry: AuditEntry }) {
  if (!ACTIONS.has(e.action)) return <span className="text-secondary">{e.action}</span>
  const [head, tail] = t(`audit.actions.${e.action.replace(".", "_")}` as MessageKey, { name: "{name}" }).split("{name}")
  return (
    <span className="text-secondary">
      {head}
      {tail !== undefined && <strong className="font-medium text-fg">{e.target.name}</strong>}
      {tail}
    </span>
  )
}

// A recorded value, readable: model ids and access levels by name, empty as "—", long text cut to one line.
function Value({ field, value, tone }: { field: string; value: string | null; tone: "before" | "after" }) {
  const text =
    value === null || value === "" ? "—" : field === "model" ? modelLabel(value) : field === "access" && ACCESS.has(value) ? t(`access.${value}` as MessageKey) : value
  return <span className={cx("max-w-64 truncate", tone === "before" ? "text-muted line-through decoration-1" : "font-medium text-fg")}>{text}</span>
}
