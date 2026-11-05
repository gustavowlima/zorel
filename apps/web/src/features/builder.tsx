// Build with AI: a screen of its own in two steps, one at a time. 1 Describe: a conversation with the
// Builder (Zorel's own agent) on the left, the proposed agent on the right as it takes shape. 2 Powers: what it may
// reach, as plain choices (no access / read / read and write), prefilled with the least the Builder proposed;
// Create makes it with those powers and opens its page. A team is created as proposed from step 1. Each visit
// starts fresh; "Build it myself" opens the form.
import { type Access, type Agent, type AgentPermissions, type Chat, DEFAULT_PERMISSIONS, type Grant, type McpServer } from "@zorel/contracts"
import type { Approval } from "@zorel/contracts/events"
import { t } from "@zorel/i18n"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { agentsAtom, mutations, projectsAtom, serversAtom, uploadAttachment, useChat, useInvalidate, useList, useMutation } from "../client.ts"
import { agentTone, modelLabel } from "../labels.ts"
import { go } from "../state.ts"
import { PendingTray, Timeline } from "./chat.tsx"
import { Composer } from "./composer.tsx"
import { ModelPicker } from "./model-picker.tsx"
import { PermissionsEditor } from "./permissions.tsx"
import { AgentAvatar, Button, Check, ChevronRight, cx, Dialog, Folder, PageHeader, Pencil, Section, Select, Sparkles, Spinner, Tag } from "@/ui"

const SUGGESTIONS = ["builder.suggest.review", "builder.suggest.triage", "builder.suggest.docs", "builder.suggest.team"] as const
type Step = "describe" | "powers"
const STEPS: ReadonlyArray<Step> = ["describe", "powers"]

export function BuilderView({ projectId }: { projectId: string | null }) {
  const builder = useMutation(mutations.builder)
  const [chat, setChat] = useState<Chat>()
  const [error, setError] = useState(false)
  const opened = useRef(0)
  // One fresh conversation per visit (StrictMode mounts twice: the ref keeps it to one).
  useEffect(() => {
    if (opened.current) return
    opened.current = Date.now()
    builder({ payload: { projectId, model: "claude-cli/sonnet" } }).then(setChat, () => setError(true))
  }, [builder, projectId])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <BuilderHeader projectId={projectId} />
      {chat ? <Wizard chat={chat} since={opened.current} /> : <div className="flex flex-1 items-center justify-center text-muted">{error ? t("builder.failed") : <Spinner />}</div>}
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
    <PageHeader className="min-h-14 gap-x-4 gap-y-2 px-7 py-3">
      <h1 className="truncate text-lg font-semibold">{title}</h1>
      <span className="min-w-0 flex-1 truncate text-muted">{subtitle}</span>
      {action}
    </PageHeader>
  )
}

function Conversation({ chat, side = false }: { chat: Chat; side?: boolean }) {
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
    <section aria-label={t("builder.conversation")} className={cx("flex min-w-0 flex-col", side ? "order-2 w-104 shrink-0 border-l border-subtle" : "flex-1")}>
      {empty ? (
        // Before the first message: what to say, and a few starting points.
        <div className="flex flex-1 flex-col items-center justify-center gap-5 px-8 text-center">
          <span className="flex size-10 items-center justify-center rounded-card bg-accent-soft text-accent-text">
            <Sparkles className="size-5" />
          </span>
          <div className="flex max-w-md flex-col gap-1.5">
            <h2 className="text-lg font-semibold">{t("builder.introTitle")}</h2>
            <p className="text-muted">{t("builder.introBody")}</p>
          </div>
          <div className="flex max-w-xl flex-wrap justify-center gap-1.5">
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
          <Timeline chat={chat} state={{ ...state, approvals: state.approvals.filter((a) => a.tool !== "zorel_create_agent") }} agents={agents} onView={() => {}} onEdit={() => {}} />
          {/* While a proposal waits, the turn only shows "waiting": say where it is and what this box is for now. */}
          {side && (
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
          placeholder={side ? "" : t("builder.placeholder")}
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
  const created = agents.filter((a) => !a.builtin && a.createdAt >= since)
  const [step, setStep] = useState<Step>("describe")
  const [access, setAccess] = useState<Access>("workspace")
  const [perms, setPerms] = useState<AgentPermissions>(DEFAULT_PERMISSIONS)
  const [busy, setBusy] = useState(false)
  // After Create: the agent appears once the Builder's turn applies the proposal; then its powers, and its page.
  const [finishing, setFinishing] = useState<{ name: string; access: Access; permissions: AgentPermissions; at: number }>()

  // A new proposal is prefilled into the next steps.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new proposal resets
  useEffect(() => {
    if (!single) return
    const f = single.fields
    setAccess(f.access === "ask" || f.access === "full" ? f.access : "workspace")
    setPerms(permissionsOf(f, servers))
  }, [open?.id])

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the agent shows up (stable mutations)
  useEffect(() => {
    if (!finishing) return
    // By name; else the agent that appeared right after Create (the Builder may have tidied the name).
    const made = created.find((a) => a.name.toLowerCase() === finishing.name.toLowerCase()) ?? created.filter((a) => a.createdAt >= finishing.at - 2000).at(-1)
    if (!made) {
      const poll = setInterval(() => invalidate(["agents"]), 700)
      return () => clearInterval(poll)
    }
    setFinishing(undefined)
    void (async () => {
      await updateAgent({ params: { id: made.id }, payload: { access: finishing.access, permissions: finishing.permissions }, reactivityKeys: ["agents"] })
      go({ view: "agent", id: made.id })
    })().finally(() => setBusy(false))
    return undefined
  }, [finishing, created.length])

  const choose = (a: Approval, outcome: "approved" | "denied") => {
    setBusy(true)
    void decide({ payload: { approvalId: a.id, outcome }, reactivityKeys: ["approvals", "agents"] }).finally(() => outcome === "denied" && setBusy(false))
  }
  const create = () => {
    if (!open || !single) return
    setFinishing({ name: single.name, access, permissions: perms, at: Date.now() })
    choose(open, "approved")
  }
  const name = single?.name ?? ""

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Steps only where there are steps: one agent goes on to its powers; a team is created as proposed. */}
      {(single || step === "powers") && <Stepper step={step} />}
      {/* Step 1 stays mounted (the conversation keeps its scroll and draft) while the others show. Before a
          proposal the conversation leads and the side explains the flow; once one arrives, reviewing it is the
          main task, so it takes the middle and the conversation moves to the side to keep refining it. */}
      <div className={cx("min-h-0 flex-1", step === "describe" ? "flex" : "hidden")}>
        <Conversation chat={chat} side={!!open} />
        {open ? (
          <ProposalReview
            drafts={drafts}
            single={!!single}
            busy={busy}
            reason={single?.fields.reason}
            onCreate={() => (single ? setStep("powers") : choose(open, "approved"))}
            onDecline={() => choose(open, "denied")}
          />
        ) : (
          <aside aria-label={t("builder.proposal")} className="flex w-80 shrink-0 flex-col gap-8 overflow-y-auto border-l border-subtle px-6 py-7">
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
                <div className="flex flex-col gap-1">
                  {created.map((a) => (
                    <CreatedRow key={a.id} agent={a} agents={agents} />
                  ))}
                </div>
              </Section>
            )}
          </aside>
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
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-8 py-10">
          <div className="flex flex-col gap-1.5">
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="text-muted">{hint}</p>
          </div>
          {children}
        </div>
      </div>
      <div className="shrink-0 border-t border-subtle">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-2 px-8 py-3">{footer}</div>
      </div>
    </div>
  )
}

// The proposal under review: the team at a glance, one card per agent (what it does, how it runs, what it reaches,
// its instructions on demand), and the decision in a bar that stays in view.
function ProposalReview({ drafts, single, busy, reason, onCreate, onDecline }: { drafts: Draft[]; single: boolean; busy: boolean; reason: string | undefined; onCreate: () => void; onDecline: () => void }) {
  const scope = drafts.every((d) => d.fields.scope === "project") ? t("builder.inProject") : t("builder.everywhere")
  return (
    <section aria-label={t("builder.proposal")} className="flex min-w-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-8 py-8">
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
              <AgentReview key={d.name} draft={d} tone={i} />
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

function AgentReview({ draft, tone }: { draft: Draft; tone: number }) {
  const f = draft.fields
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
      {f.model && <Tag hint={t("builder.runsOnHint")}>{t("builder.runsOn", { model: modelLabel(f.model) })}</Tag>}
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

function CreatedRow({ agent, agents }: { agent: Agent; agents: ReadonlyArray<Agent> }) {
  return (
    <Button variant="ghost" className="h-auto justify-start gap-2.5 px-2 py-2 font-normal text-fg" onPress={() => go({ view: "agent", id: agent.id })}>
      <AgentAvatar id={agent.id} name={agent.name} tone={agentTone(agent, agents)} size={28} />
      <span className="flex min-w-0 flex-1 flex-col text-left">
        <span className="truncate">{agent.name}</span>
        <span className="truncate text-sm text-muted">{agent.title || modelLabel(agent.model)}</span>
      </span>
      <ChevronRight className="text-muted" />
    </Button>
  )
}
