// Settings › Audit log: every change to providers, projects, agents, MCP servers and
// every approval or undo, newest first by day, with who did it and the fields before → after. Filters by kind,
// words and a span of days run on the server, which sends one page of 50 and the total. Records come from the server's Audit service (evlog audit events in SQLite).
import { useAtomValue } from "@effect/atom-react"
import type { AuditEntry, AuditKind } from "@zorel/contracts"
import { AsyncResult } from "effect/reactivity"
import { formatDate, formatTime, type MessageKey, t } from "@zorel/i18n"
import { type ReactNode, useEffect, useId, useState } from "react"
import { agentsAtom, auditAtom, useInvalidate, useList } from "../client.ts"
import { ReadingState } from "./reading.tsx"
import { modelLabel } from "../labels.ts"
import { ArrowRight, Bot, Button, ChevronDown, ChevronRight, cn, Fold, DateRangeField, Folder, KeyRound, Plug, Rows, SearchInput, Section, Select, Shield, Undo2 } from "@/ui"

const KINDS: ReadonlyArray<AuditKind> = ["all", "providers", "projects", "tools", "approvals"]


// The icon tile: what was touched, tinted by what happened to it.
const toneOf = (e: AuditEntry) => {
  const verb = e.action.split(".")[1] ?? ""
  if (e.outcome !== "success" || verb === "deleted" || verb === "removed" || verb === "denied" || verb === "cleared") return "bg-danger-soft text-danger"
  if (verb === "created" || verb === "added" || verb === "approved" || verb === "set") return "bg-success-faint text-success"
  return "bg-control text-secondary"
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
  "project.created", "project.updated", "project.deleted", "agent.created", "agent.updated", "agent.deleted", "team.created", "team.updated", "team.deleted", "routine.history_cleared", "account.added", "account.renamed",
  "account.removed", "account.signin_started", "api_key.set", "api_key.cleared", "mcp_server.added", "mcp_server.updated", "mcp_server.removed",
  "failover_terms.accepted", "approval.approved", "approval.denied", "turn.undone", "storage.cleaned", "chat.access_changed", "desktop.installed", "cli.installed",
  "computer.erased", "git.committed", "git.pushed", "git.branched", "git.pr_created",
  "git.merged", "git.discarded"
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
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 basis-80 items-center gap-2">
          <Select
            className="w-auto"
            aria-label={t("audit.kind")}
            value={kind}
            onChange={(v) => narrow(setKind)(v as AuditKind)}
            options={KINDS.map((k) => ({ value: k, label: t(`audit.kinds.${k}`) }))}
          />
          <SearchInput className="flex-1" placeholder={t("audit.search")} aria-label={t("audit.search")} value={typed} onChange={(e) => setTyped(e.target.value)} />
        </div>
        <DateRangeField
          label={t("audit.days")}
          clearLabel={t("audit.clearDays")}
          openLabel={t("audit.pickDays")}
          value={{ start: from || null, end: to || null }}
          onChange={(r) => {
            setFrom(r.start ?? "")
            setTo(r.end ?? "")
            setPage(0)
          }}
          className="shrink-0"
        />
      </div>
      <ReadingState loading={AsyncResult.isInitial(result)} failed={AsyncResult.isFailure(result)} onRetry={() => invalidate(["audit"])} />
      {data && shown.length === 0 && <p className="text-muted">{filtered ? t("audit.noMatch") : t("audit.empty")}</p>}
      {days.map(({ day, entries: list }) => (
        <div key={day} className="flex flex-col gap-2">
          <h3 className="pt-2 text-sm font-medium text-muted">{day}</h3>
          <Rows>
            {list.map((e) => (
              <AuditRow key={e.id} entry={e} by={actorName(e, agents)} />
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

// One change in the log: what happened, the fields that changed (an update's, inline), who did it and when. "Details"
// opens everything recorded: every field before → after in full (a creation's values, an approval's tool and chat),
// the reason, the outcome, what was touched (kind and id) and the exact time.
function AuditRow({ entry: e, by }: { entry: AuditEntry; by: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const inline = e.changes.length > 0 && (e.action.endsWith("updated") || e.action.endsWith("renamed"))
  return (
    <div className="flex items-start gap-3 py-3">
      <span className={cn("mt-px flex size-6 shrink-0 items-center justify-center rounded-control [&_svg]:size-3.5", toneOf(e))}>{iconOf(e)}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <Sentence entry={e} />
        {inline && (
          <span className="flex flex-col gap-0.5 text-sm">
            {e.changes.map((c) => (
              <span key={c.field} className="flex min-w-0 flex-wrap items-center gap-x-1.5">
                <span className="text-muted">{fieldName(c.field)}:</span>
                <Value field={c.field} value={c.before} tone="before" />
                {/* The arrow travels with the new value: a wrap never leaves it dangling. */}
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <ArrowRight className="size-3.5 shrink-0 text-muted" />
                  <Value field={c.field} value={c.after} tone="after" />
                </span>
              </span>
            ))}
          </span>
        )}
        {e.reason && <span className="text-sm text-muted">{e.reason}</span>}
        <span className="flex items-center gap-2 text-sm text-muted">
          {e.actor.type === "user" ? t("audit.byYou") : t("audit.by", { name: by })}
          <Button size="sm" variant="ghost" shape="pill" className="-my-1 font-normal text-muted" aria-expanded={open} aria-controls={id} onPress={() => setOpen(!open)}>
            {t("audit.details")}
            <ChevronDown className={cn("size-3.5 transition-transform duration-150 ease-out motion-reduce:transition-none", open && "rotate-180")} />
          </Button>
        </span>
        <Fold open={open}>
          <dl id={id} className="mt-1 flex flex-col gap-2 rounded-card bg-control p-3 text-sm">
            {e.changes.map((c) => (
              <Detail key={c.field} label={fieldName(c.field)}>
                {c.before !== null && c.before !== "" && <span className="whitespace-pre-wrap break-words text-muted line-through decoration-1">{c.before}</span>}
                <span className="whitespace-pre-wrap break-words text-fg">{c.after === null || c.after === "" ? "—" : c.after}</span>
              </Detail>
            ))}
            {e.reason && <Detail label={t("audit.reason")}>{e.reason}</Detail>}
            <Detail label={t("audit.outcome")}>{t(`audit.outcomes.${e.outcome}`)}</Detail>
            <Detail label={t("audit.target")}>
              <span className="break-all">{`${e.target.type} · ${e.target.id}`}</span>
            </Detail>
            <Detail label={t("audit.when")}>{new Date(e.at).toLocaleString()}</Detail>
          </dl>
        </Fold>
      </span>
      <time className="shrink-0 text-sm text-muted tabular-nums" dateTime={new Date(e.at).toISOString()} title={new Date(e.at).toLocaleString()}>
        {formatTime(e.at, e.at) /* the day is the heading above: the time alone */}
      </time>
    </div>
  )
}
// Who did it: you, an agent (by its name, or "a removed agent"), or Zorel itself. Who acts, by kind.
const ACTOR: Record<AuditEntry["actor"]["type"], (e: AuditEntry, agents: ReadonlyArray<{ id: string; name: string }>) => string> = {
  user: () => t("audit.you"),
  agent: (e, agents) => agents.find((a) => a.id === e.actor.id)?.name ?? t("audit.removedAgent"),
  system: () => t("app.name"),
  api: () => t("app.name")
}
const actorName = (e: AuditEntry, agents: ReadonlyArray<{ id: string; name: string }>) => ACTOR[e.actor.type](e, agents)
const fieldName = (field: string) => (FIELDS.has(field) ? t(`audit.fields.${field}` as MessageKey) : field)
const Detail = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
    <dt className="shrink-0 text-muted sm:w-28">{label}</dt>
    <dd className="flex min-w-0 flex-1 flex-col gap-0.5 text-secondary">{children}</dd>
  </div>
)

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
  return <span className={cn("max-w-64 truncate", tone === "before" ? "text-muted line-through decoration-1" : "font-medium text-fg")}>{text}</span>
}
