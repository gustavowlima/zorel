// Needs you (prototype "Inbox"): every open approval across chats and every memory a summary proposed,
// in one list. Agents wait here instead of guessing; deciding here is the same as deciding in the chat.
import type { Agent, Chat, Memory } from "@zorel/contracts"
import type { Approval } from "@zorel/contracts/events"
import { formatAge, t } from "@zorel/i18n"
import { type ReactNode, useState } from "react"
import { agentsAtom, approvalsAtom, chatsAtom, memoriesAtom, mutations, projectsAtom, routinesAtom, uncertainStepsAtom, useList, useMutation } from "../client.ts"
import { needsYou, agentName, approvalTitle, chatTitle, scopeLabel } from "../labels.ts"
import { go } from "../state.ts"
import { openMemory } from "./knowledge.tsx"
import { AuthorAvatar } from "./people.tsx"
import { Button, Check, Code, CodeBlock, cn, Column, EmptyState, IconTile, Screen, ShieldAlert, Tab, TabList, Tabs, Textarea, User } from "@/ui"
import { QuestionAnswer } from "./question.tsx"

type Filter = "all" | "approvals" | "questions" | "memories"
type Kind = "approval" | "question" | "memory" | "check"

// A question in words (zorel_ask_user); a routine's "Ask me" step is a yes or no, so it counts as an approval.
const isQuestion = (a: Approval) => a.kind === "question" && !a.runStepId

export function InboxView() {
  // A routine's write that may have gone out (spec 013) waits here like an approval.
  const approvals = needsYou(useList(approvalsAtom), useList(agentsAtom))
  const uncertain = useList(uncertainStepsAtom)
  const memories = useList(memoriesAtom).filter((m) => m.state === "pending")
  const [filter, setFilter] = useState<Filter>("all")
  const questions = approvals.filter(isQuestion)
  const asks = approvals.filter((a) => !isQuestion(a))
  const total = approvals.length + uncertain.length + memories.length
  const show = (f: Filter) => filter === "all" || filter === f
  const items = [
    ...(show("approvals") ? asks.map((a) => ({ at: a.createdAt, approval: a })) : []),
    ...(show("questions") ? questions.map((a) => ({ at: a.createdAt, approval: a })) : []),
    ...(show("approvals") ? uncertain.map((u) => ({ at: u.at, uncertain: u })) : []),
    ...(show("memories") ? memories.map((m) => ({ at: m.createdAt, memory: m })) : [])
  ].sort((a, b) => b.at - a.at)
  const tabs: Array<[Filter, string, number]> = [
    ["all", t("inbox.all"), total],
    ["approvals", t("inbox.approvals"), asks.length + uncertain.length],
    ["questions", t("inbox.questions"), questions.length],
    ["memories", t("inbox.memories"), memories.length]
  ]

  return (
    <Screen
      title={t("inbox.title")}
      subtitle={total ? t("inbox.waiting", { count: total }) : t("inbox.subtitle")}
      actions={
        <Tabs selectedKey={filter} onSelectionChange={(k) => setFilter(k as Filter)}>
          <TabList label={t("inbox.title")}>
            {tabs.map(([id, label, count]) => (
              <Tab key={id} id={id} count={count || undefined}>
                {label}
              </Tab>
            ))}
          </TabList>
        </Tabs>
      }
    >
      <Column>
        {items.length === 0 ? (
          <EmptyState scene="allClear" icon={<Check />} title={t("inbox.empty")} hint={t("inbox.emptyHint")} />
        ) : (
          <div className="flex flex-col gap-3">
            {items.map((item) =>
              "approval" in item ? <ApprovalItem key={item.approval.id} approval={item.approval} /> : "uncertain" in item ? <UncertainItem key={item.uncertain.stepId} step={item.uncertain} /> : <MemoryItem key={item.memory.id} memory={item.memory} />
            )}
            {/* The end of the list says so: nothing else waits, the rest goes on without you. */}
            <p className="mt-3 px-1 text-center text-sm text-muted">{t("inbox.thatsAll")}</p>
          </div>
        )}
      </Column>
    </Screen>
  )
}

const KIND_TONE: Record<Kind, string> = {
  approval: "bg-wait-soft text-warning",
  question: "bg-accent-soft text-accent-text",
  memory: "bg-control text-secondary",
  check: "bg-wait-soft text-warning"
}

function Item({ kind, avatar, who, context, at, chat, children, actions }: { kind: Kind; avatar: ReactNode; who: string; context?: ReactNode; at: number; chat?: Chat | undefined; children: ReactNode; actions: ReactNode }) {
  return (
    <article className="flex flex-col gap-3.5 rounded-card border border-subtle bg-surface p-5">
      <header className="flex items-start gap-3">
        {avatar}
        <div className="flex min-w-0 flex-1 flex-col">
          <strong className="truncate font-semibold">{who}</strong>
          <span className="truncate text-sm text-muted">{[chat && chatTitle(chat), context, formatAge(at)].filter(Boolean).join(" · ")}</span>
        </div>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", KIND_TONE[kind])}>{t(`inbox.kind.${kind}`)}</span>
      </header>
      {children}
      {(chat || actions) && (
        <footer className="flex flex-wrap items-center gap-2">
          {chat && (
            <Button size="sm" variant="ghost" className="-ml-2.5" onPress={() => go({ view: "chat", id: chat.id })}>
              {t("inbox.openChat")}
            </Button>
          )}
          <div className="ml-auto flex flex-wrap justify-end gap-2">{actions}</div>
        </footer>
      )}
    </article>
  )
}

// The project a chat lives in, for the card's "where" line.
const projectOf = (chat: Chat | undefined, projects: ReadonlyArray<{ id: string; name: string }>) => projects.find((p) => p.id === chat?.projectId)?.name

export function ApprovalItem({ approval: a }: { approval: Approval }) {
  const agents = useList(agentsAtom)
  const chats = useList(chatsAtom)
  const decide = useMutation(mutations.decide)
  const [pending, setPending] = useState<"approved" | "always" | "denied">()
  const [editing, setEditing] = useState<string>() // an "Ask me": the text the steps after it get, changed first
  const chat = chats.find((c) => c.id === a.chatId)
  const agent = agents.find((x) => x.id === a.agentId)
  const project = projectOf(chat, useList(projectsAtom))
  const choose = (outcome: "approved" | "always" | "denied", reason?: string) => {
    setPending(outcome)
    // Already decided elsewhere: the refetch removes it from the list either way.
    decide({ payload: { approvalId: a.id, outcome, ...(reason?.trim() && { reason: reason.trim().slice(0, 2000) }) }, reactivityKeys: ["approvals", "agents"] }).catch(() => setPending(undefined))
  }
  const askMe = a.kind === "question" && !!a.runStepId
  // An "Ask me" step of a routine (spec 013) is a yes or no, not a question to answer in words.
  if (a.kind === "question" && !a.runStepId)
    return (
      <Item kind="question" avatar={<AuthorAvatar agent={agent} model={chat?.model ?? null} state="waiting" />} who={agentName(a.agentId, agents)} chat={chat} context={project} at={a.createdAt} actions={null}>
        <p className="text-lg">{a.summary}</p>
        <QuestionAnswer approval={a} />
      </Item>
    )
  return (
    <Item
      kind="approval"
      avatar={<AuthorAvatar agent={agent} model={chat?.model ?? null} state="waiting" />}
      who={agentName(a.agentId, agents)}
      chat={chat}
      context={project}
      at={a.createdAt}
      actions={
        editing !== undefined ? null : (
        // Quiet choices first, the main one last (on the right edge).
        <>
          {askMe && (
            <Button size="sm" variant="ghost" isDisabled={!!pending} onPress={() => setEditing(a.args)}>
              {t("flows.ask.edit")}
            </Button>
          )}
          {a.alwaysKey && (
            <Button size="sm" variant="ghost" isPending={pending === "always"} isDisabled={!!pending} onPress={() => choose("always")}>
              {t("approval.allowAlways")}
            </Button>
          )}
          <Button size="sm" variant="secondary" isDisabled={!!pending} onPress={() => choose("denied")}>
            {t("approval.deny")}
          </Button>
          <Button size="sm" variant="default" isPending={pending === "approved"} isDisabled={!!pending} onPress={() => choose("approved")}>
            {t("approval.allow")}
          </Button>
        </>
        )
      }
    >
      {/* A command reads as the command itself, in a code block; anything else as its title and the tool. */}
      {a.kind === "command" ? <CodeBlock code={a.summary.slice(0, 2000)} language="bash" /> : <p>{approvalTitle(a, agentName(a.agentId, agents))}</p>}
      {a.kind === "command" ? null : editing !== undefined ? (
        <div className="flex flex-col gap-2">
          <Textarea aria-label={t("flows.ask.edit")} rows={6} value={editing} onChange={(e) => setEditing(e.target.value.slice(0, 2000))} />
          <div className="flex gap-2">
            <Button size="sm" isDisabled={!!pending || !editing.trim()} onPress={() => choose("approved", editing)}>
              {t("flows.ask.approveEdited")}
            </Button>
            <Button size="sm" variant="ghost" onPress={() => setEditing(undefined)}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      ) : a.runStepId && a.args ? (
        <CodeBlock code={a.args.slice(0, 2000)} />
      ) : (
        <Code className="self-start">{a.tool}</Code>
      )}
    </Item>
  )
}

function UncertainItem({ step }: { step: { routineId: string; runId: string; stepId: string; at: number } }) {
  const routine = useList(routinesAtom).find((r) => r.id === step.routineId)
  return (
    <Item
      kind="check"
      avatar={
        <IconTile size="md" className="text-warning">
          <ShieldAlert />
        </IconTile>
      }
      who={routine?.name ?? t("flows.run.title")}
      context={t("flows.uncertain.context")}
      at={step.at}
      actions={
        <Button size="sm" variant="secondary" onPress={() => go({ view: "routine-run", id: step.routineId, runId: step.runId })}>
          {t("flows.uncertain.open")}
        </Button>
      }
    >
      <p>{t("flows.uncertain.title")}</p>
    </Item>
  )
}

function MemoryItem({ memory: m }: { memory: Memory }) {
  const projects = useList(projectsAtom)
  const agents: ReadonlyArray<Agent> = useList(agentsAtom)
  const update = useMutation(mutations.updateMemory)
  const set = (state: Memory["state"]) => void update({ params: { id: m.id }, payload: { state }, reactivityKeys: ["memories"] })
  const about = m.scope === "user"
  const agent = agents.find((a) => `agent:${a.id}` === m.scope) // an agent's memory shows that agent's face
  return (
    <Item
      kind="memory"
      avatar={
        agent ? (
          <AuthorAvatar agent={agent} model={null} />
        ) : (
          <IconTile>
            <User />
          </IconTile>
        )
      }
      who={about ? t("inbox.aboutYou") : scopeLabel(m.scope, projects, agents)}
      context={t("inbox.proposed")}
      at={m.createdAt}
      actions={
        <>
          {/* An improvement is reviewed where its change shows (Knowledge), not kept blind from here. */}
          <Button size="sm" variant="ghost" onPress={() => set("forgotten")}>
            {t("inbox.discard")}
          </Button>
          {m.replaces ? (
            <Button size="sm" variant="default" onPress={() => openMemory(m)}>
              {t("inbox.reviewChange")}
            </Button>
          ) : (
            <>
              <Button size="sm" variant="secondary" onPress={() => openMemory(m)}>
                {t("common.edit")}
              </Button>
              <Button size="sm" variant="default" onPress={() => set("active")}>
                {t("inbox.keep")}
              </Button>
            </>
          )}
        </>
      }
    >
      {m.kind === "skill" ? (
        <p>
          <span className="font-medium">{m.title}</span>
          <span className="text-muted">{` · ${m.replaces ? t("inbox.betterSkill") : t("knowledge.skill")}`}</span>
          {m.reason && <span className="block text-sm text-muted">{m.reason}</span>}
        </p>
      ) : (
        <p>
          {m.text}
          {m.replaces && <span className="text-muted">{` · ${t("inbox.updatesMemory")}`}</span>}
        </p>
      )}
    </Item>
  )
}
