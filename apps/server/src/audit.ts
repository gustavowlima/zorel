// Audit log (Settings › Audit log): who changed what in Zero, with the fields before → after. Built on evlog's
// audit helpers: the action vocabulary (defineAuditAction), the event shape and idempotency key (audit) and the
// redacted diff (auditDiff). The event is written straight to SQLite inside the Effect that made the change, so
// a change and its record share one process and tests stay isolated (no global drain). Secrets never enter:
// API keys and MCP env values are recorded by name only, and *key/*token/*secret paths are redacted anyway.
import type { AuditEntry } from "@zero/contracts"
import { Context, Effect, Layer } from "effect"
import { type AuditActor, audit, auditDiff, defineAuditAction, initLogger } from "evlog"
import { LOCAL_ACTOR } from "./access.ts"
import { Store } from "./db.ts"

const action = <A extends string>(name: A, target: string) => defineAuditAction(name, { target })
export const Actions = {
  projectCreated: action("project.created", "project"),
  projectUpdated: action("project.updated", "project"),
  projectDeleted: action("project.deleted", "project"),
  agentCreated: action("agent.created", "agent"),
  agentUpdated: action("agent.updated", "agent"),
  agentDeleted: action("agent.deleted", "agent"),
  accountAdded: action("account.added", "account"),
  accountRenamed: action("account.renamed", "account"),
  accountRemoved: action("account.removed", "account"),
  accountSignInStarted: action("account.signin_started", "account"),
  apiKeySet: action("api_key.set", "api_key"),
  apiKeyCleared: action("api_key.cleared", "api_key"),
  mcpAdded: action("mcp_server.added", "mcp_server"),
  mcpUpdated: action("mcp_server.updated", "mcp_server"),
  mcpRemoved: action("mcp_server.removed", "mcp_server"),
  failoverTermsAccepted: action("failover_terms.accepted", "preference"),
  approvalApproved: action("approval.approved", "approval"),
  approvalDenied: action("approval.denied", "approval"),
  turnUndone: action("turn.undone", "turn"),
  storageCleaned: action("storage.cleaned", "storage")
} as const
type Action = (typeof Actions)[keyof typeof Actions]

const REDACT = ["**.key", "**.token", "**.secret", "**.password", "**.env"]
// Phase 8 seam: the hosted mode passes the request's Actor; locally it is always the owner.
const owner: AuditActor = { type: "user", id: LOCAL_ACTOR.id }

export interface AuditInput {
  readonly target: { readonly id: string; readonly name: string }
  readonly before?: Record<string, unknown> | undefined // only the fields that changed are kept
  readonly after?: Record<string, unknown> | undefined
  readonly outcome?: "success" | "failure" | "denied"
  readonly reason?: string | null
  readonly actor?: AuditActor
}

export interface AuditService {
  readonly record: (action: Action, input: AuditInput) => Effect.Effect<void>
  readonly list: Effect.Effect<AuditEntry[]>
}

const show = (v: unknown) => (v === undefined || v === null ? null : typeof v === "string" ? v : JSON.stringify(v))
const pointer = (path: string) => path.replace(/^\//, "").split("/")[0]!

export class Audit extends Context.Service<Audit, AuditService>()("Audit") {
  static layer = Layer.effect(
    Audit,
    Effect.gen(function* () {
      const store = yield* Store
      // evlog would print each event to stdout; the store is the only sink.
      initLogger({ silent: true, drain: () => undefined })
      return {
        record: (a, input) =>
          Effect.gen(function* () {
            const diff = input.before || input.after ? auditDiff(input.before ?? {}, input.after ?? {}, { redactPaths: REDACT, includeBefore: true }) : undefined
            const event = audit(
              a({
                actor: input.actor ?? owner,
                target: { id: input.target.id, name: input.target.name },
                outcome: input.outcome ?? "success",
                ...(input.reason && { reason: input.reason }),
                ...(diff && { changes: diff })
              })
            )
            const fields = event?.audit
            if (!fields) return
            // One row per changed top-level field: before (redacted snapshot) → after (patch value).
            const before = (diff?.before ?? {}) as Record<string, unknown>
            const changes = [...new Set((diff?.patch ?? []).map((op) => pointer(op.path)))].map((field) => ({
              field,
              before: show(before[field]),
              after: show(diff?.patch.find((op) => pointer(op.path) === field && op.op !== "remove") ? (input.after ?? {})[field] : undefined)
            }))
            yield* store.addAudit({
              // Not evlog's idempotency key: it is the same for two equal changes in the same instant
              // (change a model and change it back), and each one must be kept. Written once, no retries.
              id: crypto.randomUUID(),
              at: Date.parse(String(event.timestamp)) || Date.now(),
              action: fields.action,
              actorType: fields.actor.type,
              actorId: fields.actor.id,
              targetType: fields.target?.type ?? "unknown",
              targetId: fields.target?.id ?? "",
              targetName: input.target.name,
              outcome: fields.outcome,
              reason: fields.reason ?? null,
              changes: changes.map((c) => (REDACT.some((p) => p.endsWith(`.${c.field}`)) ? { ...c, before: c.before && "[REDACTED]", after: c.after && "[REDACTED]" } : c))
            })
          }).pipe(Effect.catchCause((cause) => Effect.logWarning("audit event not recorded", { cause: String(cause) }))), // never breaks the change itself
        list: Effect.map(store.auditLog(500), (rows) =>
          rows.map((r) => ({
            id: r.id,
            at: r.at,
            action: r.action,
            actor: { type: r.actorType, id: r.actorId },
            target: { type: r.targetType, id: r.targetId, name: r.targetName },
            outcome: r.outcome,
            reason: r.reason,
            changes: r.changes
          }))
        )
      }
    })
  )
}

// The fields of `after` that differ from `before`, with their old values: what an update changed.
export function changed<T extends object>(before: T, after: T, keys: ReadonlyArray<string>) {
  const b: Record<string, unknown> = {}
  const a: Record<string, unknown> = {}
  for (const k of keys) {
    const x = (before as Record<string, unknown>)[k]
    const y = (after as Record<string, unknown>)[k]
    if (JSON.stringify(x) !== JSON.stringify(y)) {
      b[k] = x
      a[k] = y
    }
  }
  return { before: b, after: a }
}
