// Build with AI: a screen of its own in two steps, one at a time. 1 Describe: a conversation with the
// Builder (Zorel's own agent) on the left, the proposed agent on the right as it takes shape. 2 Powers: what it may
// reach, as plain choices (no access / read / read and write), prefilled with the least the Builder proposed;
// Create makes it with those powers and opens its page. A team is created as proposed from step 1. Each visit
// starts fresh; "Build it myself" opens the form.
import { type Access, type AgentPermissions, type Chat, DEFAULT_PERMISSIONS, type Grant, type McpServer, type ModelInfo, isTeammate } from "@zorel/contracts"
import type { Approval } from "@zorel/contracts/events"
import { t } from "@zorel/i18n"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import { agentsAtom, modelsAtom, mutations, projectsAtom, serversAtom, uploadAttachment, useChat, useInvalidate, useList, useMutation } from "../client.ts"
import { agentTone, modelLabel } from "../labels.ts"
import { go } from "../state.ts"
import { PendingTray, Timeline } from "./chat.tsx"
import { Composer } from "./composer.tsx"
import { type ModelChoice, ModelPicker } from "./model-picker.tsx"
import { PermissionsEditor } from "./permissions.tsx"
import { AgentAvatar, Button, Check, ChevronRight, column, cx, Dialog, EmptyState, Folder, HEADER, IconTile, ListRow, PageHeader, Pencil, Rows, Section, Select, Sparkles, Spinner, Tag } from "@/ui"

const SUGGESTIONS = ["builder.suggest.review", "builder.suggest.triage", "builder.suggest.docs", "builder.suggest.team"] as const
type Step = "describe" | "powers"
type Edit = { name: string; patch: Partial<ModelChoice> & { access?: Access; permissions?: AgentPermissions } }
const STEPS: ReadonlyArray<Step> = ["describe", "powers"]

// The model the Builder starts on: Claude Code's Sonnet when it is there, else the first subscription model that
// is, else any available one. None: the Builder can't start (the screen says so and points to Providers).
const PREFERRED = ["claude-cli/sonnet", "codex-cli/"]
function builderModel(models: ReadonlyArray<ModelInfo>): string | undefined {
  const ready = models.filter((m) => m.available && !m.id.endsWith("…"))
  for (const p of PREFERRED) {
    const hit = ready.find((m) => (p.endsWith("/") ? m.id.startsWith(p) : m.id === p))
    if (hit) return hit.id
  }
  return (ready.find((m) => m.kind === "subscription") ?? ready[0])?.id
}

export function BuilderView({ projectId }: { projectId: string | null }) {
  const builder = useMutation(mutations.builder)
  const modelsResult = useAtomValue(modelsAtom)
  const [chat, setChat] = useState<Chat>()
  const [error, setError] = useState<"failed" | "noModel">()
  const [attempt, setAttempt] = useState(0)
  const opened = useRef(0)
  const started = useRef(-1)
  // One fresh conversation per visit (StrictMode mounts twice: the ref keeps it to one); "Try again" starts another.
  useEffect(() => {
    if (started.current === attempt || !AsyncResult.isSuccess(modelsResult)) return
    started.current = attempt
    const model = builderModel(modelsResult.value)
    if (!model) return setError("noModel")
    opened.current = Date.now()
    builder({ payload: { projectId, model } }).then(setChat, () => setError("failed"))
  }, [builder, projectId, modelsResult, attempt])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <BuilderHeader projectId={projectId} />
      {chat ? (
        <Wizard chat={chat} since={opened.current} />
      ) : error ? (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            icon={<Sparkles />}
            title={t(error === "noModel" ? "builder.noModelTitle" : "builder.failedTitle")}
            hint={t(error === "noModel" ? "builder.noModel" : "builder.failed")}
            action={
              <div className="flex gap-2">
                <Button size="sm" variant="default" onPress={() => go({ view: "settings", tab: "providers" })}>
                  {t("builder.openProviders")}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onPress={() => {
                    setError(undefined)
                    setAttempt((n) => n + 1)
                  }}
                >
                  {t("common.retry")}
                </Button>
              </div>
            }
          />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-muted">
          <Spinner />
        </div>
      )}
    </div>
  )
}

function BuilderHeader({ projectId }: { projectId: string | null }) {
  return (
    <ScreenHeader
      title={t("builder.title")}
      subtitle={t("builder.subtitle")}
      action={
        <Button size="sm" variant="ghost" onPress={() => go({ view: "new-agent", projectId })}>
          <Pencil />
          {t("builder.manual")}
        </Button>
      }
    />
  )
}

// The page header (in the desktop title bar like every screen's).
function ScreenHeader({ title, subtitle, action }: { title: string; subtitle: string; action: ReactNode }) {
  return (
    <PageHeader className={HEADER}>
      <h1 className="truncate text-lg font-semibold">{title}</h1>
      <span className="min-w-0 flex-1 truncate text-muted">{subtitle}</span>
      {action}
    </PageHeader>
  )
}

function Conversation({ chat, reviewing }: { chat: Chat; reviewing: boolean }) {
  const state = useChat(chat.id)
  const agents = useList(agentsAtom)
  const projects = useList(projectsAtom)
  const send = useMutation(mutations.send)
  const interrupt = useMutation(mutations.interrupt)
  const updateChat = useMutation(mutations.updateChat)
  const [model, setModel] = useState({ model: chat.model, accountId: chat.accountId, effort: chat.effort })
  const busy = state.pending > 0 || !!state.live
  const submit = (text: string) => send({ payload: { chatId: chat.id, clientId: crypto.randomUUID(), text } }).then(() => undefined)
  const empty = state.ready && state.messages.length === 0 && !state.live && state.pending === 0

  return (
    // A narrow window: the conversation alone (the explanation steps aside); while a proposal is reviewed, the review.
    <section aria-label={t("builder.conversation")} className={cx("order-2 min-h-0 flex-1 flex-col border-subtle md:flex md:w-104 md:flex-none md:shrink-0 md:border-l", reviewing ? "hidden" : "flex")}>
      {empty ? (
        // Before the first message: what to say, and a few starting points.
        <div className="flex flex-1 flex-col items-center justify-center gap-5 px-8 text-center">
          <IconTile size="lg" className="text-muted">
            <Sparkles />
          </IconTile>
          <div className="flex max-w-md flex-col gap-1.5">
            <h2 className="text-lg font-semibold">{t("builder.introTitle")}</h2>
            <p className="text-muted">{t("builder.introBody")}</p>
          </div>
          <div className="flex flex-wrap justify-center gap-1.5">
            {SUGGESTIONS.map((k) => (
              <Button key={k} size="sm" variant="secondary" shape="pill" className="font-normal" onPress={() => void submit(t(k))}>
                {t(k)}
              </Button>
            ))}
          </div>
        </div>
      ) : (
        // The proposal is reviewed on the right: no second card for it inside the conversation.
        <>
          <Timeline chat={chat} state={{ ...state, approvals: state.approvals.filter((a) => a.tool !== "zorel_create_agent") }} agents={agents} onView={() => {}} onEdit={() => {}} onStop={() => void interrupt({ payload: { chatId: chat.id } })} />
          {/* While a proposal waits, the turn only shows "waiting": say where it is and what this box is for now. */}
          {reviewing && (
            <p className="mx-6 mb-2 flex items-start gap-2 rounded-card border border-subtle px-3 py-2.5 text-sm text-secondary">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-accent-text" />
              {t("builder.readyHint")}
            </p>
          )}
        </>
      )}
      <div className="flex w-full flex-col gap-1.5 px-8 pt-2 pb-4.5">
        {/* A question or an approval of the Builder's (not the proposal: that's reviewed on the right) waits here,
            above the message box, as in any chat: before, a question had nowhere to be answered. */}
        <PendingTray approvals={state.approvals.filter((a) => a.tool !== "zorel_create_agent")} />
        {/* Where the new agents live: picking a project starts the conversation over in it (as on Home). */}
        <Select
          variant="ghost"
          icon={<Folder />}
          className="w-auto max-w-64 self-start"
          aria-label={t("home.project")}
          value={chat.projectId ?? ""}
          onChange={(v) => go({ view: "builder", projectId: v || null })}
          options={[{ value: "", label: t("builder.everyProject") }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
        />
        <Composer
          autoFocus
          busy={busy}
          onStop={() => void interrupt({ payload: { chatId: chat.id } })}
          onSubmit={submit}
          upload={(f) => uploadAttachment(chat.id, f)}
          placeholder=""
          tools={
            <ModelPicker
              value={model}
              onChange={(v) => {
                setModel(v)
                void updateChat({ params: { id: chat.id }, payload: v })
              }}
            />
          }
        />
      </div>
    </section>
  )
}

// One proposed agent, read from the proposal card's text ("key: value" lines; a team has a "## Name" per agent).
type Draft = { name: string; fields: Record<string, string> }
export function draftsOf(text: string): Draft[] {
  const parse = (block: string, name: string): Draft => {
    const fields: Record<string, string> = {}
    let key = ""
    for (const line of block.split("\n")) {
      const m = /^([a-z_]+): (.*)$/i.exec(line)
      if (m) {
        key = m[1]!
        fields[key] = m[2]!
      } else if (key) fields[key] += `\n${line}`
    }
    return { name: fields.name || name, fields }
  }
  if (!text.includes("## ")) return [parse(text, "")]
  return text
    .split(/^## /m)
    .filter((b) => b.trim())
    .map((b) => {
      const [head, ...rest] = b.split("\n")
      return parse(rest.join("\n"), head!.trim())
    })
}

const GRANTS = new Set(["read", "write"])
// "GitHub (read), Notion (write)" → grants by server id; when connectors were named, the rest get no access.
function permissionsOf(f: Record<string, string>, servers: ReadonlyArray<McpServer>): AgentPermissions {
  const named = new Map(
    (f.connectors ?? "").split(",").flatMap((part) => {
      const m = /^\s*(.+?)\s*\((read|write)\)\s*$/.exec(part)
      return m && GRANTS.has(m[2]!) ? [[m[1]!.toLowerCase(), m[2]! as Grant] as const] : []
    })
  )
  const grants: Record<string, Grant> = {}
  if (f.connectors) for (const s of servers) grants[s.id] = named.get(s.name.toLowerCase()) ?? "none"
  return { web: f.web !== "false", browser: f.browser === "true", grants, always: [] }
}

function Wizard({ chat, since }: { chat: Chat; since: number }) {
  const state = useChat(chat.id)
  const agents = useList(agentsAtom)
  const servers = useList(serversAtom).filter((s) => s.projectId === null || s.projectId === chat.projectId)
  const decide = useMutation(mutations.decide)
  const updateAgent = useMutation(mutations.updateAgent)
  const invalidate = useInvalidate()
  const open: Approval | undefined = state.approvals.findLast((a) => a.tool === "zorel_create_agent")
  const drafts = open ? draftsOf(open.args) : []
  const single = drafts.length === 1 ? drafts[0] : undefined
  const created = agents.filter((a) => isTeammate(a) && a.createdAt >= since)
  const [step, setStep] = useState<Step>("describe")
  const [access, setAccess] = useState<Access>("workspace")
  const [perms, setPerms] = useState<AgentPermissions>(DEFAULT_PERMISSIONS)
  const [busy, setBusy] = useState(false)
  // A model picked per agent on its card (by name) before anything exists.
  const [models, setModels] = useState<Record<string, ModelChoice>>({})
  // After Create: the agents appear once the Builder's turn applies the proposal; then what was changed here
  // (a model, one agent's powers) is applied to each, and a single agent's page opens.
  const [finishing, setFinishing] = useState<{ at: number; edits: Edit[]; open: boolean }>()

  // A new proposal is prefilled into the next steps.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new proposal resets
  useEffect(() => {
    setModels({})
    if (!single) return
    const f = single.fields
    setAccess(f.access === "ask" || f.access === "full" ? f.access : "workspace")
    setPerms(permissionsOf(f, servers))
  }, [open?.id])

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the agent shows up (stable mutations)
  useEffect(() => {
    if (!finishing) return
    // By name; else, for one agent, the one that appeared right after Create (the Builder may have tidied the name).
    const fresh = created.filter((a) => a.createdAt >= finishing.at - 2000)
    const made = finishing.edits.map((e) => fresh.find((a) => a.name.toLowerCase() === e.name.toLowerCase()) ?? (finishing.edits.length === 1 ? fresh.at(-1) : undefined))
    if (made.some((a) => !a)) {
      const poll = setInterval(() => invalidate(["agents"]), 700)
      return () => clearInterval(poll)
    }
    setFinishing(undefined)
    void (async () => {
      for (const [i, e] of finishing.edits.entries()) await updateAgent({ params: { id: made[i]!.id }, payload: e.patch, reactivityKeys: ["agents"] })
      if (finishing.open) go({ view: "agent", id: made[0]!.id })
    })().finally(() => setBusy(false))
    return undefined
  }, [finishing, created.length])

  const choose = (a: Approval, outcome: "approved" | "denied") => {
    setBusy(true)
    void decide({ payload: { approvalId: a.id, outcome }, reactivityKeys: ["approvals", "agents"] }).finally(() => outcome === "denied" && setBusy(false))
  }
  const create = () => {
    if (!open || !single) return
    setFinishing({ at: Date.now(), open: true, edits: [{ name: single.name, patch: { access, permissions: perms, ...models[single.name] } }] })
    choose(open, "approved")
  }
  const createAll = () => {
    if (!open) return
    const edits = Object.entries(models).map(([name, patch]) => ({ name, patch }))
    if (edits.length) setFinishing({ at: Date.now(), open: false, edits })
    choose(open, "approved")
  }
  const name = single?.name ?? ""

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Steps only where there are steps: one agent goes on to its powers; a team is created as proposed. */}
      {(single || step === "powers") && <Stepper step={step} />}
      {/* Step 1 stays mounted (the conversation keeps its scroll and draft) while the others show. The
          conversation always sits on the right; the middle explains the flow, then holds the proposal to review. */}
      <div className={cx("min-h-0 flex-1", step === "describe" ? "flex" : "hidden")}>
        <Conversation chat={chat} reviewing={!!open} />
        {open ? (
          <ProposalReview
            drafts={drafts}
            single={!!single}
            busy={busy}
            reason={single?.fields.reason}
            models={models}
            onModel={(name, v) => setModels((m) => ({ ...m, [name]: v }))}
            onCreate={() => (single ? setStep("powers") : createAll())}
            onDecline={() => choose(open, "denied")}
          />
        ) : (
          <section aria-label={t("builder.proposal")} className="hidden min-w-0 flex-1 flex-col overflow-y-auto md:flex">
            <div className="m-auto flex w-full max-w-xl flex-col gap-10 px-7 py-7">
            {finishing ? (
              <p className="text-sm text-muted">{t("builder.creating")}</p>
            ) : (
              <Section title={t("builder.howTitle")}>
                <ol className="flex flex-col gap-3 text-sm">
                  {(["describe", "ask", "review", "create"] as const).map((k, i) => (
                    <li key={k} className="flex gap-3">
                      <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded-full border border-strong text-xs text-muted tabular-nums">
                        {i + 1}
                      </span>
                      <span className="text-secondary">{t(`builder.how.${k}`)}</span>
                    </li>
                  ))}
                </ol>
              </Section>
            )}
            {created.length > 0 && (
              <Section title={t("builder.created")} description={t("builder.createdHint")}>
                <Rows>
                  {created.map((a) => (
                    <ListRow
                      key={a.id}
                      label={`${t("agents.open")}: ${a.name}`}
                      onPress={() => go({ view: "agent", id: a.id })}
                      icon={<AgentAvatar id={a.id} name={a.name} tone={agentTone(a, agents)} size={28} />}
                      title={a.name}
                      hint={a.title || modelLabel(a.model)}
                    />
                  ))}
                </Rows>
              </Section>
            )}
            </div>
          </section>
        )}
      </div>

      {step === "powers" && single && (
        <StepPage
          title={t("builder.powersTitle", { name })}
          hint={t("builder.powersHint")}
          footer={
            <>
              <Button size="sm" variant="ghost" isDisabled={busy} onPress={() => setStep("describe")}>
                {t("nav.back")}
              </Button>
              <span className="flex-1" />
              <Button size="sm" variant="default" isPending={busy} isDisabled={busy} onPress={create}>
                {t("builder.createNamed", { name })}
              </Button>
            </>
          }
        >
          <PermissionsEditor access={access} onAccess={setAccess} value={perms} onChange={setPerms} servers={servers} showAlways={false} />
        </StepPage>
      )}

    </div>
  )
}

// 1 Describe — 2 Powers: done steps get a check, the current one is filled.
function Stepper({ step }: { step: Step }) {
  const at = STEPS.indexOf(step)
  return (
    <ol aria-label={t("builder.steps")} className="flex shrink-0 items-center justify-center gap-3 border-b border-subtle py-3 text-sm">
      {STEPS.map((k, i) => (
        <li key={k} className="flex items-center gap-3" {...(i === at && { "aria-current": "step" as const })}>
          {i > 0 && <span aria-hidden="true" className="h-px w-8 bg-strong" />}
          <span className={cx("flex items-center gap-2", i === at ? "font-medium text-fg" : "text-muted")}>
            <span
              aria-hidden="true"
              className={cx(
                "flex size-5 items-center justify-center rounded-full text-xs tabular-nums",
                i < at ? "bg-accent-soft text-accent-text" : i === at ? "bg-accent text-on-accent" : "border border-strong"
              )}
            >
              {i < at ? <Check className="size-3" /> : i + 1}
            </span>
            {t(`builder.step.${k}`)}
          </span>
        </li>
      ))}
    </ol>
  )
}

// A step of its own: a centered column with a title, a line, the content, and the way forward at the bottom.
function StepPage({ title, hint, footer, children }: { title: string; hint: string; footer: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={cx(column(), "gap-6")}>
          <div className="flex flex-col gap-1.5">
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="text-muted">{hint}</p>
          </div>
          {children}
        </div>
      </div>
      <div className="shrink-0 border-t border-subtle">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-7 py-3">{footer}</div>
      </div>
    </div>
  )
}

// The proposal under review: the team at a glance, one card per agent (what it does, how it runs, what it reaches,
// its instructions on demand), and the decision in a bar that stays in view.
function ProposalReview({
  drafts, single, busy, reason, models, onModel, onCreate, onDecline
}: { drafts: Draft[]; single: boolean; busy: boolean; reason: string | undefined; models: Record<string, ModelChoice>; onModel: (name: string, v: ModelChoice) => void; onCreate: () => void; onDecline: () => void }) {
  const scope = drafts.every((d) => d.fields.scope === "project") ? t("builder.inProject") : t("builder.everywhere")
  return (
    <section aria-label={t("builder.proposal")} className="flex min-w-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={cx(column(true), "gap-6")}>
          <header className="flex items-center gap-4">
            <span className="flex -space-x-2">
              {drafts.map((d, i) => (
                <AgentAvatar key={d.name} id={d.name} name={d.name} tone={i} size={40} className="ring-2 ring-canvas" />
              ))}
            </span>
            <div className="flex min-w-0 flex-col">
              <h2 className="text-lg font-semibold">{single ? t("builder.reviewOne") : t("builder.reviewTeam")}</h2>
              <p className="text-sm text-muted">{[t("builder.teamSize", { count: drafts.length }), scope, t("builder.untilYouApprove")].join(" · ")}</p>
            </div>
          </header>
          <div className={cx("grid gap-3", !single && "lg:grid-cols-2")}>
            {drafts.map((d, i) => (
              <AgentReview key={d.name} draft={d} tone={i} choice={models[d.name]} onChoice={(v) => onModel(d.name, v)} />
            ))}
          </div>
          {reason && <p className="text-sm text-muted">{t("knowledge.why", { reason })}</p>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3 border-t border-subtle px-8 py-3.5">
        <span className="min-w-0 flex-1 truncate text-sm text-muted">{t("builder.refineHint")}</span>
        <Button variant="ghost" isDisabled={busy} onPress={onDecline}>
          {t("builder.notNow")}
        </Button>
        <Button variant="default" isPending={busy && !single} isDisabled={busy} onPress={onCreate}>
          {single ? t("builder.useIt") : t("builder.createAll", { count: drafts.length })}
          {single && <ChevronRight />}
        </Button>
      </div>
    </section>
  )
}

function AgentReview({ draft, tone, choice, onChoice }: { draft: Draft; tone: number; choice: ModelChoice | undefined; onChoice: (v: ModelChoice) => void }) {
  const f = draft.fields
  const model = choice?.model ?? f.model
  const [details, setDetails] = useState(false)
  const access = f.access === "ask" || f.access === "full" ? f.access : f.access ? "workspace" : undefined
  const powers = [f.web === "true" && t("builder.web"), f.browser === "true" && t("builder.browser"), f.connectors && f.connectors !== "none" && f.connectors].filter(Boolean)
  const head = (
    <div className="flex items-center gap-3">
      <AgentAvatar id={draft.name} name={draft.name} tone={tone} size={40} live />
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{draft.name}</span>
        {f.title && <span className="truncate text-sm text-muted">{f.title}</span>}
      </span>
    </div>
  )
  const tags = (
    <div className="flex flex-wrap gap-1.5">
      {access && <Tag hint={t(`access.${access}Hint`)}>{t("builder.accessIs", { access: t(`access.${access}`) })}</Tag>}
      <Tag hint={t("builder.reachesHint")}>{powers.length ? t("builder.reaches", { what: powers.join(", ") }) : t("builder.reachesNothing")}</Tag>
    </div>
  )
  return (
    // The card keeps one size (a preview of the instructions): reading them all opens a dialog, so a long profile
    // never stretches the row and its neighbour.
    <article className="flex flex-col gap-3 rounded-card border border-subtle p-4">
      {head}
      {f.description && <p className="line-clamp-3 text-secondary">{f.description}</p>}
      {/* The primary model can be changed here, before the agent exists; the rest is on its page afterwards. */}
      {f.model && (
        <span className="flex items-center gap-2 text-sm text-muted">
          {t("builder.primaryModel")}
          <ModelPicker variant="field" className="min-w-0 flex-1" value={choice ?? { model: f.model, accountId: null, effort: null }} onChange={onChoice} />
        </span>
      )}
      {tags}
      {f.instructions && <p className="mt-auto line-clamp-3 border-t border-subtle pt-3 text-sm whitespace-pre-wrap text-muted">{f.instructions}</p>}
      <Button size="sm" variant="ghost" className="-ml-2.5 self-start" onPress={() => setDetails(true)}>
        {t("builder.seeDetails")}
      </Button>
      <Dialog title={t("builder.details", { name: draft.name })} size="lg" isOpen={details} onOpenChange={setDetails}>
        {(close) => (
          <div className="flex flex-col gap-4">
            {head}
            {f.description && <p className="text-secondary">{f.description}</p>}
            {model && <Tag hint={t("builder.runsOnHint")}>{t("builder.runsOn", { model: modelLabel(model) })}</Tag>}
            {tags}
            {f.reason && (
              <div className="flex flex-col gap-1.5">
                <span className="text-sm text-muted">{t("builder.why")}</span>
                <p className="text-sm text-secondary">{f.reason}</p>
              </div>
            )}
            {f.instructions && (
              <div className="flex flex-col gap-1.5">
                <span className="text-sm text-muted">{t("builder.instructions")}</span>
                <p className="max-h-80 overflow-y-auto rounded-control bg-control px-3 py-2.5 text-sm whitespace-pre-wrap text-secondary">{f.instructions}</p>
              </div>
            )}
            <div className="flex justify-end">
              <Button variant="ghost" onPress={close}>
                {t("common.close")}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </article>
  )
}
