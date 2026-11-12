// Needs you (prototype "Inbox"): every open approval across chats and every memory a summary proposed,
// in one list. Agents wait here instead of guessing; deciding here is the same as deciding in the chat.
import type { Agent, Chat, Memory } from "@zorel/contracts"
import type { Approval } from "@zorel/contracts/events"
import { formatAge, t } from "@zorel/i18n"
import { type ReactNode, useState } from "react"
import { agentsAtom, approvalsAtom, chatsAtom, memoriesAtom, mutations, projectsAtom, routinesAtom, uncertainStepsAtom, useList, useMutation } from "../client.ts"
import { agentName, approvalTitle, chatTitle, scopeLabel } from "../labels.ts"
import { go } from "../state.ts"
import { openMemory } from "./knowledge.tsx"
import { AuthorAvatar } from "./people.tsx"
import { Button, Check, Code, CodeBlock, Column, EmptyState, IconTile, Rows, Screen, ShieldAlert, Tab, TabList, Tabs, Textarea, User } from "@/ui"
import { QuestionAnswer } from "./question.tsx"

type Filter = "all" | "approvals" | "memories"

export function InboxView() {
  // A routine's write that may have gone out (spec 013) waits here like an approval.
  const approvals = useList(approvalsAtom)
  const uncertain = useList(uncertainStepsAtom)
  const memories = useList(memoriesAtom).filter((m) => m.state === "pending")
  const [filter, setFilter] = useState<Filter>("all")
  const items = [
    ...(filter !== "memories" ? approvals.map((a) => ({ at: a.createdAt, approval: a })) : []),
    ...(filter !== "memories" ? uncertain.map((u) => ({ at: u.at, uncertain: u })) : []),
    ...(filter !== "approvals" ? memories.map((m) => ({ at: m.createdAt, memory: m })) : [])
  ].sort((a, b) => b.at - a.at)

  return (
    <Screen
      title={t("inbox.title")}
      subtitle={t("inbox.subtitle")}
      actions={
        <Tabs selectedKey={filter} onSelectionChange={(k) => setFilter(k as Filter)}>
          <TabList label={t("inbox.title")}>
            <Tab id="all" count={approvals.length + uncertain.length + memories.length || undefined}>
              {t("inbox.all")}
            </Tab>
            <Tab id="approvals" count={approvals.length + uncertain.length || undefined}>
              {t("inbox.approvals")}
            </Tab>
            <Tab id="memories" count={memories.length || undefined}>
              {t("inbox.memories")}
            </Tab>
          </TabList>
        </Tabs>
      }
    >
      <Column>
        {items.length === 0 ? (
          <EmptyState icon={<Check />} title={t("inbox.empty")} hint={t("inbox.emptyHint")} />
        ) : (
          <Rows>
            {items.map((item) =>
              "approval" in item ? <ApprovalItem key={item.approval.id} approval={item.approval} /> : "uncertain" in item ? <UncertainItem key={item.uncertain.stepId} step={item.uncertain} /> : <MemoryItem key={item.memory.id} memory={item.memory} />
            )}
          </Rows>
        )}
      </Column>
    </Screen>
  )
}

function Item({ avatar, who, context, at, children, actions }: { avatar: ReactNode; who: string; context: ReactNode; at: number; children: ReactNode; actions: ReactNode }) {
  return (
    <article className="flex gap-3.5 py-4">
      {avatar}
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <strong className="font-semibold">{who}</strong>
          <span className="text-sm text-muted">
            {context} · {formatAge(at)}
          </span>
        </div>
        {children}
        <div className="flex flex-wrap gap-2">{actions}</div>
      </div>
    </article>
  )
}

// "in <chat>", where the chat's name opens it.
function InChat({ chat }: { chat: Chat | undefined }) {
  if (!chat) return null
  return (
    <>
      {t("inbox.in")}{" "}
      <Button variant="ghost" className="h-auto rounded-inline px-0.5 py-0 align-baseline text-sm font-normal text-secondary data-hovered:bg-transparent data-hovered:text-fg" onPress={() => go({ view: "chat", id: chat.id })}>
        {chatTitle(chat)}
      </Button>
    </>
  )
}

export function ApprovalItem({ approval: a }: { approval: Approval }) {
  const agents = useList(agentsAtom)
  const chats = useList(chatsAtom)
  const decide = useMutation(mutations.decide)
  const [pending, setPending] = useState<"approved" | "always" | "denied">()
  const [editing, setEditing] = useState<string>() // an "Ask me": the text the steps after it get, changed first
  const chat = chats.find((c) => c.id === a.chatId)
  const agent = agents.find((x) => x.id === a.agentId)
  const choose = (outcome: "approved" | "always" | "denied", reason?: string) => {
    setPending(outcome)
    // Already decided elsewhere: the refetch removes it from the list either way.
    decide({ payload: { approvalId: a.id, outcome, ...(reason?.trim() && { reason: reason.trim().slice(0, 2000) }) }, reactivityKeys: ["approvals", "agents"] }).catch(() => setPending(undefined))
  }
  const askMe = a.kind === "question" && !!a.runStepId
  // An "Ask me" step of a routine (spec 013) is a yes or no, not a question to answer in words.
  if (a.kind === "question" && !a.runStepId)
    return (
      <Item avatar={<AuthorAvatar agent={agent} model={chat?.model ?? null} />} who={agentName(a.agentId, agents)} context={<InChat chat={chat} />} at={a.createdAt} actions={null}>
        <p className="font-medium">{a.summary}</p>
        <QuestionAnswer approval={a} />
      </Item>
    )
  return (
    <Item
      avatar={<AuthorAvatar agent={agent} model={chat?.model ?? null} />}
      who={agentName(a.agentId, agents)}
      context={<InChat chat={chat} />}
      at={a.createdAt}
      actions={
        editing !== undefined ? null : (
        <>
          <Button size="sm" variant="default" isPending={pending === "approved"} isDisabled={!!pending} onPress={() => choose("approved")}>
            {t("approval.allow")}
          </Button>
          {a.alwaysKey && (
            <Button size="sm" variant="secondary" isPending={pending === "always"} isDisabled={!!pending} onPress={() => choose("always")}>
              {t("approval.allowAlways")}
            </Button>
          )}
          <Button size="sm" variant="ghost" isDisabled={!!pending} onPress={() => choose("denied")}>
            {t("approval.deny")}
          </Button>
          {askMe && (
            <Button size="sm" variant="ghost" isDisabled={!!pending} onPress={() => setEditing(a.args)}>
              {t("flows.ask.edit")}
            </Button>
          )}
        </>
        )
      }
    >
      <p>{approvalTitle(a, agentName(a.agentId, agents))}</p>
      {editing !== undefined ? (
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
          {m.replaces ? (
            <Button size="sm" variant="default" onPress={() => openMemory(m)}>
              {t("inbox.reviewChange")}
            </Button>
          ) : (
            <>
              <Button size="sm" variant="default" onPress={() => set("active")}>
                {t("inbox.keep")}
              </Button>
              <Button size="sm" variant="secondary" onPress={() => openMemory(m)}>
                {t("common.edit")}
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" onPress={() => set("forgotten")}>
            {t("inbox.discard")}
          </Button>
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
