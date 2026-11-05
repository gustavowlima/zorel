// An agent's work (its page › Work, where its row on the Agents screen opens): what it's doing this moment, live
// from the chats' statuses (working, or waiting on you first), then every chat it's a member of, grouped by project,
// the most recent first. A row opens that chat; a task it was handed is marked as one.
import type { Agent, Chat } from "@zorel/contracts"
import type { ChatStatus } from "@zorel/contracts/events"
import { formatAge, t } from "@zorel/i18n"
import { chatsAtom, projectsAtom, useList, useStatuses } from "../client.ts"
import { chatTitle } from "../labels.ts"
import { go } from "../state.ts"
import { Dot, EmptyState, ListRow, MessageCircle, Rows, Section, Tag } from "@/ui"

const ACTIVE = new Set<ChatStatus["state"]>(["running", "waiting"])
const toneOf = (s: ChatStatus["state"]) => (s === "waiting" ? "warning" : s === "failed" ? "danger" : "accent")
// A preview line without Markdown marks (the reply's **bold**, `code`, # headings).
const plain = (text: string) => text.replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim()
const recent = (a: Chat, b: Chat) => (b.lastAt ?? b.createdAt) - (a.lastAt ?? a.createdAt)

export function AgentWork({ agent }: { agent: Agent }) {
  const chats = useList(chatsAtom)
  const projects = useList(projectsAtom)
  const statuses = useStatuses()
  const mine = chats.filter((c) => c.agentIds.includes(agent.id)).sort(recent)
  // Now: the chats where this agent is the one running or waiting.
  const now = mine.flatMap((c) => {
    const s = statuses[c.id]
    return s && s.agentId === agent.id && ACTIVE.has(s.state) ? [{ chat: c, status: s }] : []
  })
  const groups = [...new Set(mine.map((c) => c.projectId))].map((id) => ({
    id,
    name: id ? (projects.find((p) => p.id === id)?.name ?? t("agent.work.general")) : t("agent.work.general"),
    list: mine.filter((c) => c.projectId === id)
  }))
  const row = (c: Chat, status?: ChatStatus) => {
    const s = status ?? statuses[c.id]
    const live = s && s.state !== "idle" && (s.agentId === agent.id || s.state === "failed") ? s : undefined
    return (
      <ListRow
        key={c.id}
        label={chatTitle(c)}
        onPress={() => go({ view: "chat", id: c.id })}
        icon={live ? <Dot tone={toneOf(live.state)} /> : <MessageCircle className="size-4 text-muted" />}
        title={
          <span className="flex items-center gap-2">
            <span className="truncate">{chatTitle(c)}</span>
            {/* ponytail: a task chat is known by its title ("Name: task"); add taskOf to Chat if titles get renamed */}
            {c.title.startsWith(`${agent.name}: `) && <Tag>{t("agent.work.task")}</Tag>}
          </span>
        }
        hint={live ? live.label || t(`agent.work.${live.state as "running" | "waiting" | "failed"}`) : plain(c.preview ?? "")}
        {...(live?.state === "waiting" && { hintTone: "warning" as const })}
        aside={formatAge(c.lastAt ?? c.createdAt)}
      />
    )
  }
  return (
    <>
      <Section title={t("agent.work.now")} description={t("agent.work.nowHint")}>
        <Rows>{now.length ? now.map((x) => row(x.chat, x.status)) : <p className="py-3.5 text-muted">{t("agent.work.idle")}</p>}</Rows>
      </Section>
      {mine.length === 0 ? (
        <EmptyState icon={<MessageCircle />} title={t("agent.work.chats")} hint={t("agent.work.none")} />
      ) : (
        groups.map((g, i) => (
          <Section key={g.id ?? "general"} title={`${g.name} · ${g.list.length}`} {...(i === 0 && { description: t("agent.work.chatsHint") })}>
            <Rows>{g.list.map((c) => row(c))}</Rows>
          </Section>
        ))
      )}
    </>
  )
}
