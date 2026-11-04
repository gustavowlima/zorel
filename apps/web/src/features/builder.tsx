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
import { Timeline } from "./chat.tsx"
import { Composer } from "./composer.tsx"
import { ModelPicker } from "./model-picker.tsx"
import { PermissionsEditor } from "./permissions.tsx"
import { AgentAvatar, Button, Check, ChevronRight, cx, Folder, PageHeader, Pencil, Section, Select, Sparkles, Spinner } from "@/ui"

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

function Conversation({ chat }: { chat: Chat }) {
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
    <section aria-label={t("builder.conversation")} className="flex min-w-0 flex-1 flex-col">
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
        <Timeline chat={chat} state={{ ...state, approvals: state.approvals.filter((a) => a.tool !== "zorel_create_agent") }} agents={agents} onView={() => {}} onEdit={() => {}} />
      )}
      <div className="flex w-full flex-col gap-1.5 px-8 pt-2 pb-4.5">
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
          placeholder={t("builder.placeholder")}
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
      <Stepper step={step} />
      {/* Step 1 stays mounted (the conversation keeps its scroll and draft) while the others show. */}
      <div className={cx("min-h-0 flex-1", step === "describe" ? "flex" : "hidden")}>
        <Conversation chat={chat} />
        <aside aria-label={t("builder.proposal")} className="flex w-96 shrink-0 flex-col gap-6 overflow-y-auto border-l border-subtle px-5 py-6">
          <Section title={t("builder.proposal")}>
            {open ? (
              <div className="flex flex-col gap-3">
                {drafts.map((d) => (
                  <DraftCard key={d.name} draft={d} />
                ))}
                {single?.fields.reason && <p className="text-sm text-muted">{t("knowledge.why", { reason: single.fields.reason })}</p>}
                <div className="flex items-center justify-end gap-2">
                  <Button size="sm" variant="ghost" isDisabled={busy} onPress={() => choose(open, "denied")}>
                    {t("builder.notNow")}
                  </Button>
                  {single ? (
                    <Button size="sm" variant="default" onPress={() => setStep("powers")}>
                      {t("builder.useIt")}
                      <ChevronRight />
                    </Button>
                  ) : (
                    <Button size="sm" variant="default" isPending={busy} isDisabled={busy} onPress={() => choose(open, "approved")}>
                      {t("builder.createAll", { count: drafts.length })}
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted">{finishing ? t("builder.creating") : t("builder.waiting")}</p>
            )}
          </Section>
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

function DraftCard({ draft }: { draft: Draft }) {
  const f = draft.fields
  const [more, setMore] = useState(false)
  const facts = [f.model && modelLabel(f.model), f.access && t(`access.${f.access as "workspace" | "ask" | "full"}`), f.scope === "project" ? t("builder.inProject") : t("builder.everywhere")].filter(Boolean)
  const powers = [f.web === "true" && t("builder.web"), f.browser === "true" && t("builder.browser"), f.connectors && f.connectors !== "none" && f.connectors].filter(Boolean)
  return (
    <article className="flex flex-col gap-2.5 rounded-card border border-subtle bg-surface p-3.5">
      <div className="flex items-center gap-2.5">
        <AgentAvatar id={draft.name} name={draft.name} size={28} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{draft.name}</span>
          {f.title && <span className="truncate text-sm text-muted">{f.title}</span>}
        </span>
      </div>
      {f.description && <p className="text-secondary">{f.description}</p>}
      <p className="text-sm text-muted">{facts.join(" · ")}</p>
      <p className="text-sm text-muted">{powers.length ? t("builder.reaches", { what: powers.join(", ") }) : t("builder.reachesNothing")}</p>
      {f.instructions && (
        <div className="flex flex-col gap-1">
          <p className={more ? "whitespace-pre-wrap text-sm text-secondary" : "line-clamp-3 whitespace-pre-wrap text-sm text-secondary"}>{f.instructions}</p>
          <Button size="sm" variant="ghost" className="-ml-2.5 self-start" onPress={() => setMore(!more)}>
            {more ? t("builder.less") : t("builder.more")}
          </Button>
        </div>
      )}
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
