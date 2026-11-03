// Settings › Audit log (inspired by a reference app's): every change to providers, projects, agents, MCP servers and
// every approval or undo, newest first, with who did it and the fields before → after. A kind filter and a
// search sit above the list. Records come from the server's Audit service (evlog audit events in SQLite).
import type { AuditEntry } from "@zero/contracts"
import { formatTime, type MessageKey, t } from "@zero/i18n"
import { type ReactNode, useEffect, useState } from "react"
import { agentsAtom, auditAtom, useInvalidate, useList } from "../client.ts"
import { modelLabel } from "../labels.ts"
import { ArrowRight, Bot, Folder, History, Input, KeyRound, Plug, Search, Select, Shield, Undo2, cx } from "@/ui"

type Kind = "all" | "providers" | "projects" | "tools" | "approvals"
const KINDS: ReadonlyArray<Kind> = ["all", "providers", "projects", "tools", "approvals"]

const kindOf = (e: AuditEntry): Exclude<Kind, "all"> => {
  const resource = e.action.split(".")[0]
  if (resource === "account" || resource === "api_key" || resource === "failover_terms") return "providers"
  if (resource === "project" || resource === "agent") return "projects"
  if (resource === "mcp_server") return "tools"
  return "approvals"
}

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
  const entries = useList(auditAtom)
  const agents = useList(agentsAtom)
  const invalidate = useInvalidate()
  const [kind, setKind] = useState<Kind>("all")
  const [query, setQuery] = useState("")
  // Other screens don't refresh the log when they change something: read it fresh on open.
  useEffect(() => invalidate(["audit"]), [invalidate])

  const q = query.trim().toLowerCase()
  const shown = entries.filter(
    (e) => (kind === "all" || kindOf(e) === kind) && (!q || [e.target.name, e.action, ...e.changes.flatMap((c) => [c.field, c.before ?? "", c.after ?? ""])].some((s) => s.toLowerCase().includes(q)))
  )
  const actorName = (e: AuditEntry) =>
    e.actor.type === "user" ? t("audit.you") : e.actor.type === "agent" ? (agents.find((a) => a.id === e.actor.id)?.name ?? t("audit.removedAgent")) : t("app.name")

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-muted">{t("audit.changes")}</h2>
        <div className="flex items-center gap-2">
          <Select
            size="sm"
            className="w-auto"
            aria-label={t("audit.kind")}
            value={kind}
            onChange={(v) => setKind(v as Kind)}
            options={KINDS.map((k) => ({ value: k, label: t(`audit.kinds.${k}`) }))}
          />
          <label className="relative w-52">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" />
            <Input className="pl-8" placeholder={t("audit.search")} aria-label={t("audit.search")} value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
        </div>
      </div>
      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-card bg-surface px-6 py-12 text-center">
          <History className="size-5 text-muted" />
          <p className="text-muted">{entries.length ? t("audit.noMatch") : t("audit.empty")}</p>
        </div>
      ) : (
        <ol className="flex flex-col divide-y divide-subtle rounded-card bg-surface px-4">
          {shown.map((e) => (
            <li key={e.id} className="flex items-start gap-3.5 py-3.5">
              <span className={cx("flex size-9 shrink-0 items-center justify-center rounded-control [&_svg]:size-4", toneOf(e))}>{iconOf(e)}</span>
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
              <time className="shrink-0 text-sm text-muted tabular-nums" dateTime={new Date(e.at).toISOString()}>
                {formatTime(e.at)}
              </time>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
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
