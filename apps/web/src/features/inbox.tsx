// Needs you (prototype "Inbox"): every open approval across chats and every memory a summary proposed,
// in one list. Agents wait here instead of guessing; deciding here is the same as deciding in the chat.
import type { Agent, Memory } from "@zero/contracts"
import type { Approval } from "@zero/contracts/events"
import { formatAge, t } from "@zero/i18n"
import { type ReactNode, useState } from "react"
import { agentsAtom, approvalsAtom, chatsAtom, memoriesAtom, mutations, projectsAtom, useList, useMutation } from "../client.ts"
import { agentName, chatTitle, scopeLabel } from "../labels.ts"
import { go } from "../state.ts"
import { AuthorAvatar } from "./people.tsx"
import { Button, Check, Code, EmptyState, Screen, Tab, TabList, Tabs, User } from "@/ui"

type Filter = "all" | "approvals" | "memories"

export function InboxView() {
  const approvals = useList(approvalsAtom)
  const memories = useList(memoriesAtom).filter((m) => m.state === "pending")
  const [filter, setFilter] = useState<Filter>("all")
  const items = [
    ...(filter !== "memories" ? approvals.map((a) => ({ at: a.createdAt, approval: a })) : []),
    ...(filter !== "approvals" ? memories.map((m) => ({ at: m.createdAt, memory: m })) : [])
  ].sort((a, b) => b.at - a.at)

  return (
    <Screen
      title={t("inbox.title")}
      subtitle={t("inbox.subtitle")}
      actions={
        <Tabs selectedKey={filter} onSelectionChange={(k) => setFilter(k as Filter)}>
          <TabList label={t("inbox.title")}>
            <Tab id="all" count={approvals.length + memories.length}>
              {t("inbox.all")}
            </Tab>
            <Tab id="approvals" count={approvals.length}>
              {t("inbox.approvals")}
            </Tab>
            <Tab id="memories" count={memories.length}>
              {t("inbox.memories")}
            </Tab>
          </TabList>
        </Tabs>
      }
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col px-7 pt-2 pb-8">
        {items.length === 0 && <EmptyState icon={<Check />} title={t("inbox.empty")} hint={t("inbox.emptyHint")} />}
        {items.map((item) => ("approval" in item ? <ApprovalItem key={item.approval.id} approval={item.approval} /> : <MemoryItem key={item.memory.id} memory={item.memory} />))}
      </div>
    </Screen>
  )
}

function Item({ avatar, who, context, at, children, actions }: { avatar: ReactNode; who: string; context: ReactNode; at: number; children: ReactNode; actions: ReactNode }) {
  return (
    <article className="flex gap-3.5 border-b border-subtle py-5 last:border-0">
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

function ApprovalItem({ approval: a }: { approval: Approval }) {
  const agents = useList(agentsAtom)
  const chats = useList(chatsAtom)
  const decide = useMutation(mutations.decide)
  const [pending, setPending] = useState<"approved" | "always" | "denied">()
  const chat = chats.find((c) => c.id === a.chatId)
  const agent = agents.find((x) => x.id === a.agentId)
  const choose = (outcome: "approved" | "always" | "denied") => {
    setPending(outcome)
    // Already decided elsewhere: the refetch removes it from the list either way.
    decide({ payload: { approvalId: a.id, outcome }, reactivityKeys: ["approvals", "agents"] }).catch(() => setPending(undefined))
  }
  return (
    <Item
      avatar={<AuthorAvatar agent={agent} model={chat?.model ?? null} />}
      who={agentName(a.agentId, agents)}
      context={chat ? t("inbox.inChat", { chat: chatTitle(chat) }) : ""}
      at={a.createdAt}
      actions={
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
          {chat && (
            <Button size="sm" variant="ghost" onPress={() => go({ view: "chat", id: chat.id })}>
              {t("inbox.openChat")}
            </Button>
          )}
        </>
      }
    >
      <p>{a.summary || t("approval.wantsTo", { agent: agentName(a.agentId, agents), tool: a.tool })}</p>
      <Code className="self-start">{a.tool}</Code>
    </Item>
  )
}

function MemoryItem({ memory: m }: { memory: Memory }) {
  const projects = useList(projectsAtom)
  const agents: ReadonlyArray<Agent> = useList(agentsAtom)
  const update = useMutation(mutations.updateMemory)
  const set = (state: Memory["state"]) => void update({ params: { id: m.id }, payload: { state }, reactivityKeys: ["memories"] })
  const about = m.scope === "user"
  return (
    <Item
      avatar={
        <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-card bg-surface text-secondary">
          <User className="size-4" />
        </span>
      }
      who={about ? t("inbox.aboutYou") : scopeLabel(m.scope, projects, agents)}
      context={t("inbox.proposed")}
      at={m.createdAt}
      actions={
        <>
          {/* An improvement is reviewed where its change shows (Knowledge), not kept blind from here. */}
          {m.replaces ? (
            <Button size="sm" variant="default" onPress={() => go({ view: "knowledge", id: m.id })}>
              {t("inbox.reviewChange")}
            </Button>
          ) : (
            <>
              <Button size="sm" variant="default" onPress={() => set("active")}>
                {t("inbox.keep")}
              </Button>
              <Button size="sm" variant="secondary" onPress={() => go({ view: "knowledge", id: m.id })}>
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
        <p>{m.text}</p>
      )}
    </Item>
  )
}
