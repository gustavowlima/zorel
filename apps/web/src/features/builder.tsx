// Build with AI (as in Tucano): a screen of its own, not a chat in the list. On the left, a conversation with the
// Builder (Zero's own agent): describe the work and it asks a few questions, then proposes one agent or a team.
// On the right, the proposal to review (each agent's name, role, model, access and instructions) with Create
// and Not now, and what was created here, one press from its page (where Tools and access lives). Each visit
// starts fresh; "Build it myself" opens the empty form.
import type { Agent, Chat } from "@zero/contracts"
import type { Approval } from "@zero/contracts/events"
import { t } from "@zero/i18n"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { agentsAtom, mutations, uploadAttachment, useChat, useList, useMutation } from "../client.ts"
import { agentTone, modelLabel } from "../labels.ts"
import { go } from "../state.ts"
import { Timeline } from "./chat.tsx"
import { Composer } from "./composer.tsx"
import { ModelPicker } from "./model-picker.tsx"
import { AgentAvatar, Button, ChevronRight, PageHeader, Pencil, Section, Sparkles, Spinner } from "@/ui"

const SUGGESTIONS = ["builder.suggest.review", "builder.suggest.triage", "builder.suggest.docs", "builder.suggest.team"] as const

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
      {chat ? (
        <div className="flex min-h-0 flex-1">
          <Conversation chat={chat} />
          <Proposal chat={chat} since={opened.current} />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-muted">{error ? t("builder.failed") : <Spinner />}</div>
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
        <Timeline chat={chat} state={state} agents={agents} onView={() => {}} onEdit={() => {}} />
      )}
      <div className="w-full px-8 pt-2 pb-4.5">
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
      const m = /^([a-zA-Z]+): (.*)$/.exec(line)
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

function Proposal({ chat, since }: { chat: Chat; since: number }) {
  const state = useChat(chat.id)
  const agents = useList(agentsAtom)
  const decide = useMutation(mutations.decide)
  const [pending, setPending] = useState<"approved" | "denied">()
  const open: Approval | undefined = state.approvals.findLast((a) => a.tool === "zero_create_agent")
  const created = agents.filter((a) => !a.builtin && a.createdAt >= since)
  const choose = (a: Approval, outcome: "approved" | "denied") => {
    setPending(outcome)
    void decide({ payload: { approvalId: a.id, outcome }, reactivityKeys: ["approvals", "agents"] }).finally(() => setPending(undefined))
  }

  return (
    <aside aria-label={t("builder.proposal")} className="flex w-96 shrink-0 flex-col gap-6 overflow-y-auto border-l border-subtle px-5 py-6">
      <Section title={t("builder.proposal")}>
        {open ? (
          <div className="flex flex-col gap-3">
            {draftsOf(open.args).map((d) => (
              <DraftCard key={d.name} draft={d} />
            ))}
            <div className="flex items-center justify-end gap-2">
              <Button size="sm" variant="ghost" isDisabled={!!pending} onPress={() => choose(open, "denied")}>
                {t("builder.notNow")}
              </Button>
              <Button size="sm" variant="default" isPending={pending === "approved"} isDisabled={!!pending} onPress={() => choose(open, "approved")}>
                {t("builder.create")}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">{t("builder.waiting")}</p>
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
  )
}

function DraftCard({ draft }: { draft: Draft }) {
  const f = draft.fields
  const [more, setMore] = useState(false)
  const facts = [f.model && modelLabel(f.model), f.access && t(`access.${f.access as "workspace" | "ask" | "full"}`), f.scope === "project" ? t("builder.inProject") : t("builder.everywhere")].filter(Boolean)
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
