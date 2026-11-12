// Build with AI: a chat with the Builder (Zorel's own agent), centered like any conversation. Its proposal, one
// agent or a team, shows as a card after its turn; "Open" slides in a panel to look and set it up (profile and AI,
// then powers: no access / read / read and write, prefilled with the least the Builder proposed), and Create makes
// it. Each visit starts fresh; "Build it myself" opens the form.
import { type Access, type Agent, type AgentPermissions, type Chat, type McpServer, type ModelInfo, isTeammate } from "@zorel/contracts"
import type { Approval, ProposedAgent } from "@zorel/contracts/events"
import { t } from "@zorel/i18n"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import { agentsAtom, modelsAtom, mutations, projectsAtom, serversAtom, uploadAttachment, useChat, useList, useMutation } from "../client.ts"
import { agentTone, modelLabel, modelName } from "../labels.ts"
import { go, READY_KEY, store, stored } from "../state.ts"
import { PendingTray, Timeline } from "./chat.tsx"
import { Composer } from "./composer.tsx"
import { type ModelChoice, ModelPicker } from "./model-picker.tsx"
import { PermissionsEditor, summarizePowers } from "./permissions.tsx"
import { AgentAvatar, Button, ChevronLeft, cn, Dialog, Drawer, EmptyState, Folder, HEADER, IconButton, ListRow, PageHeader, Pencil, RowHit, Rows, Section, Select, SettingRow, ShieldCheck, Sparkles, Spinner, X, Cpu } from "@/ui"

const SUGGESTIONS = ["builder.suggest.review", "builder.suggest.triage", "builder.suggest.docs", "builder.suggest.team"] as const

// The model the Builder starts on: Claude Code's Sonnet when it is there, else the first subscription model that
// is, else any available one. None: the Builder can't start (the screen says so and points to Providers).
const PREFERRED = ["claude-cli/sonnet", "codex-cli/"]
// The model named when nothing else is: a proposal without one, a first agent made with no AI found yet.
export const FALLBACK_MODEL = PREFERRED[0]!
export function builderModel(models: ReadonlyArray<ModelInfo>): string | undefined {
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
  const started = useRef(-1)
  // One fresh conversation per visit (StrictMode mounts twice: the ref keeps it to one); "Try again" starts another.
  useEffect(() => {
    if (started.current === attempt || !AsyncResult.isSuccess(modelsResult)) return
    started.current = attempt
    const model = builderModel(modelsResult.value)
    if (!model) return setError("noModel")
    builder({ payload: { projectId, model } }).then(setChat, () => setError("failed"))
  }, [builder, projectId, modelsResult, attempt])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader className={HEADER}>
        <h1 className="truncate text-lg font-semibold">{t("builder.title")}</h1>
        <span className="min-w-0 flex-1 truncate text-muted">{t("builder.subtitle")}</span>
        <Button size="sm" variant="ghost" onPress={() => go({ view: "new-agent", projectId })}>
          <Pencil />
          {t("builder.manual")}
        </Button>
      </PageHeader>
      {chat ? (
        <Wizard chat={chat} />
      ) : error ? (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            scene="offline"
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

// The conversation with the Builder, as any chat: its face and name before the first message, the timeline, the
// message box. The proposal shows as a card after the Builder's turn (`card`). While a proposal is out, what you
// write declines it with your words as the reason: the Builder's turn waits on that decision, so a plain message
// would queue behind it, unread, and show above the turn it came after.
function Conversation({ chat, open, card }: { chat: Chat; open: Approval | undefined; card: ReactNode }) {
  const state = useChat(chat.id)
  const agents = useList(agentsAtom)
  const projects = useList(projectsAtom)
  const send = useMutation(mutations.send)
  const decide = useMutation(mutations.decide)
  const interrupt = useMutation(mutations.interrupt)
  const updateChat = useMutation(mutations.updateChat)
  const [model, setModel] = useState({ model: chat.model, accountId: chat.accountId, effort: chat.effort })
  // While a proposal is out the turn waits on you, not the other way round: no Stop, just send (a change).
  const busy = !open && (state.pending > 0 || state.lives.length > 0)
  const submit = (text: string) =>
    (open
      ? decide({ payload: { approvalId: open.id, outcome: "denied", reason: text }, reactivityKeys: ["approvals"] })
      : send({ payload: { chatId: chat.id, clientId: crypto.randomUUID(), text } })
    ).then(() => undefined)
  const stop = () => void interrupt({ payload: { chatId: chat.id } })
  // The proposal is the card below the turn: no second card for it in the tray, and no waiting step or "waits for
  // your OK" line repeating it (a turn left with nothing to show then shows nothing).
  const others = state.approvals.filter((a) => a.tool !== "zorel_create_agent")
  const lives = open ? state.lives.map((l) => ({ ...l, steps: l.steps.filter((s) => s.status !== "waiting") })).filter((l) => l.text || l.steps.length) : state.lives
  const builder = agents.find((a) => a.id === chat.agentIds[0])

  return (
    <section aria-label={t("builder.conversation")} className="flex min-w-0 flex-1 flex-col">
      <Timeline
        chat={chat}
        state={{ ...state, approvals: others, lives }}
        agents={agents}
        onView={() => {}}
        onEdit={() => {}}
        onStop={stop}
        intro={<BuilderIntro builder={builder} tone={builder ? agentTone(builder, agents) : 0} onPick={(text) => void submit(text)} />}
        after={card}
        liveStatus={!open}
      />
      <div className="w-full px-8 pt-2 pb-4.5">
        <div className="mx-auto flex w-full max-w-chat flex-col gap-1.5">
          {/* A question of the Builder's waits here, above the message box, as in any chat. */}
          <PendingTray approvals={others} />
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
            onStop={stop}
            onSubmit={submit}
            upload={(f) => uploadAttachment(chat.id, f)}
            placeholder={open ? t("builder.changePlaceholder") : ""}
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
      </div>
    </section>
  )
}

// Before the first message: the Builder itself (face, name, color), what to say, a few starting points.
function BuilderIntro({ builder, tone, onPick }: { builder: Agent | undefined; tone: number; onPick: (text: string) => void }) {
  return (
    <div className="flex flex-col items-center gap-5 pt-16 text-center">
      {builder && <AgentAvatar id={builder.id} name={builder.name} tone={tone} size={64} live />}
      <div className="flex max-w-md flex-col gap-1.5">
        <h2 className="text-title font-semibold">{builder?.name ?? t("builder.title")}</h2>
        <p className="text-balance text-muted">{t("builder.introBody")}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-1.5">
        {SUGGESTIONS.map((k) => (
          <Button key={k} size="sm" variant="secondary" shape="pill" className="font-normal" onPress={() => onPick(t(k))}>
            {t(k)}
          </Button>
        ))}
      </div>
    </div>
  )
}

// One proposed agent, as the server sent it with the proposal (the card's text is only for reading).
type Draft = ProposedAgent
const draftsOf = (a: Approval | undefined): Draft[] => (a?.proposal?.kind === "create" ? [...a.proposal.agents] : [])

type Powers = { access: Access; permissions: AgentPermissions }
// Where the panel is: a stack, so Back is always one pop (a team's list → a member's profile → its powers).
type View = { at: "team" } | { at: "profile" | "powers"; index: number }

// The Builder's screen: the conversation, and the proposal it makes as a card after its turn. "Open" slides in a
// panel to look at the agent (or each of the team) and set it up: its profile and AI, then its powers, prefilled
// with the least the Builder proposed. Create sends what was set here with the approval (decide's overrides): the
// server creates each agent with it, in one step. One agent then opens its page.
function Wizard({ chat }: { chat: Chat }) {
  const state = useChat(chat.id)
  const agents = useList(agentsAtom)
  const servers = useList(serversAtom).filter((s) => s.projectId === null || s.projectId === chat.projectId)
  const decide = useMutation(mutations.decide)
  const open: Approval | undefined = state.approvals.findLast((a) => a.tool === "zorel_create_agent")
  const drafts = draftsOf(open)
  const single = drafts.length === 1
  // Made in this conversation (the server's clock on both sides).
  const created = agents.filter((a) => isTeammate(a) && a.createdAt >= chat.createdAt)
  const [panel, setPanel] = useState(false)
  const [stack, setStack] = useState<View[]>([])
  const [busy, setBusy] = useState(false)
  // What was set here per agent (by its place in the proposal) before anything exists: a model, its powers.
  const [models, setModels] = useState<Record<number, ModelChoice>>({})
  const [powers, setPowers] = useState<Record<number, Powers>>({})
  // The one agent approved: its page opens once it shows up in the list (the turn's end refetches the agents).
  const [opening, setOpening] = useState<string>()

  // A new proposal starts from what the Builder proposed (the panel stays open across a revision). An approval
  // that is gone (decided, expired) frees the buttons.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new proposal resets
  useEffect(() => {
    setModels({})
    setPowers({})
    setStack([single ? { at: "profile", index: 0 } : { at: "team" }])
    setBusy(false)
  }, [open?.id])
  const made = opening && created.find((a) => a.name === opening)
  useEffect(() => {
    if (!made) return
    setOpening(undefined)
    // Made from the first run: its "ready" step (App shows it), else the agent's page.
    if (stored(READY_KEY) === "pending") {
      store(READY_KEY, made.id)
      go({ view: "home" })
    } else go({ view: "agent", id: made.id })
  }, [made])

  const powersOf = (i: number): Powers => powers[i] ?? { access: drafts[i]!.access, permissions: drafts[i]!.permissions }
  const choose = (outcome: "approved" | "denied") => {
    if (!open) return
    setBusy(true)
    setPanel(false)
    const overrides = outcome === "approved" ? drafts.map((_, i) => ({ ...models[i], ...powers[i] })) : undefined
    if (outcome === "approved" && single) setOpening(drafts[0]!.name)
    void decide({ payload: { approvalId: open.id, outcome, ...(overrides && { overrides }) }, reactivityKeys: ["approvals", "agents"] }).catch(() => {
      setBusy(false)
      setOpening(undefined)
    })
  }

  const card = open ? (
    <ProposalCard
      drafts={drafts}
      busy={busy}
      onOpen={(index) => {
        setStack(single ? [{ at: "profile", index: 0 }] : [{ at: "team" }, ...(index === undefined ? [] : [{ at: "profile" as const, index }])])
        setPanel(true)
      }}
      onCreate={() => choose("approved")}
      onDecline={() => choose("denied")}
    />
  ) : busy || opening ? (
    <p className="text-sm text-muted">{t("builder.creating")}</p>
  ) : created.length > 0 ? (
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
  ) : null

  return (
    <div className="flex min-h-0 flex-1">
      <Conversation chat={chat} open={open} card={card} />
      <Drawer open={panel && !!open && stack.length > 0}>
        {open && stack.length > 0 && (
          <ProposalPanel
            drafts={drafts}
            stack={stack}
            onStack={setStack}
            busy={busy}
            models={models}
            onModel={(i, v) => setModels((m) => ({ ...m, [i]: v }))}
            powersOf={powersOf}
            onPowers={(i, p) => setPowers((m) => ({ ...m, [i]: p }))}
            servers={servers}
            onCreate={() => choose("approved")}
            onDecline={() => choose("denied")}
            onClose={() => setPanel(false)}
          />
        )}
      </Drawer>
    </div>
  )
}

// The proposal in the conversation, as the Builder's answer (spec 018): a card under its message — face, name, role
// and "proposed by the Builder", what it does (three lines), one line of facts (model, access, powers), then
// Create (as proposed), Edit first (the setup panel) and Discard. A team: one card per member, the same actions for all.
function ProposalCard({ drafts, busy, onOpen, onCreate, onDecline }: { drafts: Draft[]; busy: boolean; onOpen: (index?: number) => void; onCreate: () => void; onDecline: () => void }) {
  const team = drafts.length > 1
  return (
    <article aria-label={t("builder.proposal")} className="flex flex-col gap-3">
      {team && <p className="text-muted">{t("builder.teamHint")}</p>}
      <ul className={cn("grid gap-2.5", team && "sm:grid-cols-2")}>
        {drafts.map((d, i) => {
          const powers = summarizePowers(d.permissions)
          const facts = [modelName(d.model), t(`access.${d.access}`), powers.count ? t("builder.powerCount", { count: powers.count }) : null].filter(Boolean)
          return (
            <li key={d.name} className="relative flex flex-col gap-3 rounded-card bg-surface p-4 ring-1 ring-strong">
              <RowHit label={`${t("builder.open")}: ${d.name}`} onPress={() => onOpen(i)} className="inset-0 rounded-card" />
              <div className="pointer-events-none relative flex items-center gap-3">
                <AgentAvatar id={d.name} name={d.name} tone={i} size={team ? 32 : 40} live />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-lg font-semibold">{d.name}</span>
                  {d.title && <span className="truncate text-sm text-muted">{d.title}</span>}
                </span>
                {!team && <span className="shrink-0 rounded-full bg-control px-2 py-0.5 text-xs text-secondary">{t("builder.proposedBy")}</span>}
              </div>
              {d.description && <p className={cn("pointer-events-none relative text-secondary", team ? "line-clamp-2 text-sm" : "line-clamp-3")}>{d.description}</p>}
              <p className="pointer-events-none relative truncate text-sm text-muted">{facts.join(" · ")}</p>
            </li>
          )
        })}
      </ul>
      <div className="flex items-center gap-1.5 pt-1">
        <Button variant="default" isDisabled={busy} onPress={onCreate}>
          {team ? t("builder.createAll", { count: drafts.length }) : t("builder.createNamed", { name: drafts[0]!.name })}
        </Button>
        <Button variant="secondary" isDisabled={busy} onPress={() => onOpen()}>
          {t("builder.editFirst")}
        </Button>
        <Button variant="ghost" isDisabled={busy} onPress={onDecline}>
          {t("builder.discard")}
        </Button>
      </div>
    </article>
  )
}

// The panel "Open" slides in: a team's members (each opens), an agent's profile, then its powers; the way on at the
// bottom. Each kind of view is one entry of a table (title, body, footer); Back pops the stack. The conversation stays
// beside it: a change asked there revises the proposal, and this panel follows.
function ProposalPanel({
  drafts, stack, onStack, busy, models, onModel, powersOf, onPowers, servers, onCreate, onDecline, onClose
}: {
  drafts: Draft[]
  stack: View[]
  onStack: (s: View[]) => void
  busy: boolean
  models: Record<number, ModelChoice>
  onModel: (i: number, v: ModelChoice) => void
  powersOf: (i: number) => Powers
  onPowers: (i: number, p: Powers) => void
  servers: ReadonlyArray<McpServer>
  onCreate: () => void
  onDecline: () => void
  onClose: () => void
}) {
  const view = stack.at(-1)!
  const push = (v: View) => onStack([...stack, v])
  const pop = () => onStack(stack.slice(0, -1))
  const team = drafts.length > 1
  const scope = drafts.every((d) => d.scope === "project") ? t("builder.inProject") : t("builder.everywhere")
  // The AI each agent runs on: the one picked here, else the proposed one, else the fallback (card and profile agree).
  const choiceOf = (i: number): ModelChoice => models[i] ?? { model: drafts[i]!.model || FALLBACK_MODEL, accountId: null, effort: null }
  const VIEWS = {
    team: () => ({
      title: t("builder.yourAgents"),
      body: (
        <ul className="flex flex-col gap-3">
          {drafts.map((d, i) => (
            <MemberCard key={d.name} draft={d} tone={i} model={choiceOf(i).model} powers={powersOf(i)} onOpen={() => push({ at: "profile", index: i })} onPowers={() => push({ at: "powers", index: i })} />
          ))}
        </ul>
      ),
      footer: (
        <>
          <Button size="sm" variant="ghost" isDisabled={busy} onPress={onDecline}>
            {t("builder.notNow")}
          </Button>
          <Button size="sm" variant="default" isPending={busy} isDisabled={busy} onPress={onCreate}>
            {t("builder.createAll", { count: drafts.length })}
          </Button>
        </>
      )
    }),
    profile: (i: number) => {
      return {
        title: "", // the profile shows the name itself, large
        body: <AgentProfile draft={drafts[i]!} tone={i} choice={choiceOf(i)} onChoice={(v) => onModel(i, v)} powers={powersOf(i)} onPowers={() => push({ at: "powers", index: i })} />,
        footer: (
          <Button size="sm" variant="default" onPress={() => push({ at: "powers", index: i })}>
            {t("builder.next")}
          </Button>
        )
      }
    },
    powers: (i: number) => {
      const draft = drafts[i]!
      const p = powersOf(i)
      return {
        title: t("builder.powersTitle", { name: draft.name }),
        body: (
          <div className="flex flex-col gap-6">
            <p className="text-muted">{t("builder.powersHint")}</p>
            <PermissionsEditor access={p.access} onAccess={(access) => onPowers(i, { ...p, access })} value={p.permissions} onChange={(permissions) => onPowers(i, { ...p, permissions })} servers={servers} showAlways={false} />
          </div>
        ),
        // A member of a team goes back to the list; one agent is created from here.
        footer: team ? (
          <Button size="sm" variant="default" onPress={() => onStack(stack.slice(0, 1))}>
            {t("builder.done")}
          </Button>
        ) : (
          <Button size="sm" variant="default" isPending={busy} isDisabled={busy} onPress={onCreate}>
            {t("builder.createNamed", { name: draft.name })}
          </Button>
        )
      }
    }
  }
  const { title, body, footer } = view.at === "team" ? VIEWS.team() : VIEWS[view.at](view.index)
  const name = view.at === "team" ? "" : drafts[view.index]!.name

  return (
    <aside aria-label={t("builder.proposal")} className="flex w-120 shrink-0 flex-col border-l border-subtle bg-canvas">
      <div className="flex h-14 shrink-0 items-center gap-1 px-3">
        {stack.length > 1 && (
          <IconButton label={t("nav.back")} onPress={pop}>
            <ChevronLeft />
          </IconButton>
        )}
        {/* Never an empty heading: on the profile the name is for screen readers (it shows large below). */}
        <h2 className={cn("min-w-0 flex-1 truncate font-semibold", stack.length === 1 && "pl-2", !title && "sr-only")}>{title || name}</h2>
        {!title && <span className="flex-1" />}
        <IconButton label={t("common.close")} onPress={onClose}>
          <X />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-2 pb-6">{body}</div>
      {/* The way on, with what it means beside it: where the agents will live and that nothing exists yet. */}
      <div className="flex shrink-0 items-center gap-2 px-5 pt-2 pb-4">
        <p className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-muted">
          {view.at !== "powers" && (
            <>
              <Folder className="size-3.5 shrink-0" />
              <span className="truncate" title={`${scope}. ${t("builder.untilYouApprove")}.`}>
                {scope}. {t("builder.untilYouApprove")}.
              </span>
            </>
          )}
        </p>
        {footer}
      </div>
    </aside>
  )
}

// A team member in the panel: face, name and role, what it does (cut to two lines), and one quiet line of how it runs
// (its AI · access · permissions) with "Edit permissions" as a soft pill. No frame: a calm surface; it opens the profile.
function MemberCard({ draft, tone, model, powers, onOpen, onPowers }: { draft: Draft; tone: number; model: string; powers: Powers; onOpen: () => void; onPowers: () => void }) {
  const f = draft
  const runs = [model && modelName(model), t(`access.${powers.access}`), t("builder.powerCount", { count: summarizePowers(powers.permissions).count })].filter(Boolean)
  return (
    <li className="relative flex flex-col gap-3 rounded-card bg-surface p-4">
      <RowHit label={`${t("builder.open")}: ${draft.name}`} onPress={onOpen} className="inset-0 rounded-card" />
      <div className="pointer-events-none relative flex items-center gap-3">
        <AgentAvatar id={draft.name} name={draft.name} tone={tone} size={40} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{draft.name}</span>
          {f.title && <span className="truncate text-sm text-muted">{f.title}</span>}
        </span>
      </div>
      {f.description && <p className="pointer-events-none relative line-clamp-2 text-sm text-secondary">{f.description}</p>}
      <div className="relative flex items-center gap-2">
        <span className="pointer-events-none min-w-0 flex-1 truncate text-sm text-muted">{runs.join(" · ")}</span>
        <Button size="sm" variant="secondary" shape="pill" className="font-normal" onPress={onPowers}>
          {t("builder.editPowers")}
        </Button>
      </div>
    </li>
  )
}

// A proposed agent as a profile, soft: its face, name and role, what it does; why it's the one, as a quiet note; then
// how it runs on one calm surface, each item a label over its value (the panel is narrow: no label column, no
// divider lines). The instructions (written for the model, in English) wait behind "See instructions".
function AgentProfile({ draft, tone, choice, onChoice, powers, onPowers }: { draft: Draft; tone: number; choice: ModelChoice; onChoice: (v: ModelChoice) => void; powers: Powers; onPowers: () => void }) {
  const f = draft
  const [instructions, setInstructions] = useState(false)
  // What is set here (the permissions step may have changed them), not only what was proposed.
  const s = summarizePowers(powers.permissions)
  const reach = [s.web && t("builder.web"), s.browser && t("builder.browser"), s.connectors > 0 && t("builder.connectorCount", { count: s.connectors })].filter(Boolean)
  return (
    <article className="flex min-w-0 flex-col gap-6">
      <div className="flex items-center gap-4">
        <AgentAvatar id={draft.name} name={draft.name} tone={tone} size={64} live />
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="truncate text-display font-semibold">{draft.name}</h3>
          {f.title && <p className="truncate text-muted">{f.title}</p>}
        </div>
      </div>
      {(f.description || f.instructions) && (
        <div className="flex flex-col items-start gap-2">
          {f.description && <p className="leading-relaxed text-secondary">{f.description}</p>}
          {/* How it thinks, next to what it does (the instructions are written for the model). */}
          {f.instructions && (
            <Button size="sm" variant="ghost" shape="pill" className="-ml-2.5 font-normal text-muted" onPress={() => setInstructions(true)}>
              {t("builder.seeInstructions")}
            </Button>
          )}
        </div>
      )}
      {f.reason && (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm text-muted">{t("builder.why")}</span>
          <p className="text-sm leading-relaxed text-secondary">{f.reason}</p>
        </div>
      )}
      {/* How it runs, as two settings rows (what, then its control on the right), parted by a hairline: its AI, and
          its permissions in one line (what it may do on its own · what it reaches) with "Change". */}
      <Rows className="rounded-card border-transparent">
        <SettingRow icon={<Cpu />} title={t("builder.model")}>
          <ModelPicker className="max-w-56 text-fg" value={choice} onChange={onChoice} />
        </SettingRow>
        <SettingRow icon={<ShieldCheck />} title={t("builder.permissions")} hint={[t(`access.${powers.access}`), reach.length ? reach.join(", ") : t("builder.reachesNothing")].join(" · ")}>
          <Button size="sm" variant="secondary" shape="pill" className="font-normal" aria-label={`${t("builder.change")}: ${t("builder.permissions")}`} onPress={onPowers}>
            {t("builder.change")}
          </Button>
        </SettingRow>
      </Rows>
      <Dialog title={t("builder.details", { name: draft.name })} size="lg" isOpen={instructions} onOpenChange={setInstructions}>
        {(close) => (
          <div className="flex flex-col gap-4">
            <p className="max-h-80 overflow-y-auto rounded-control bg-control px-3 py-2.5 text-sm whitespace-pre-wrap text-secondary">{f.instructions}</p>
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

