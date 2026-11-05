// An agent's work (its page › Work, where its row on the Agents screen opens). Now: what it's doing this moment, live
// from the chats' statuses (working, or waiting on you first). Sessions: every time it worked, newest first, each
// with its project and chat, when, how long, how it ended and its tokens; pressing one opens that chat on its reply
// (its steps are there, under the reply). Each chat is one session of the agent (one engine session
// per chat), so a run names the chat it continued.
import type { Agent, AgentRun, Chat } from "@zorel/contracts"
import type { ChatStatus } from "@zorel/contracts/events"
import { formatAge, formatCompact, formatDuration, t } from "@zorel/i18n"
import { useEffect, useState } from "react"
import { agentRunsAtom, chatsAtom, mutations, projectsAtom, useInvalidate, useList, useMutation, useReading, useStatuses } from "../client.ts"
import { chatTitle } from "../labels.ts"
import { go } from "../state.ts"
import { Button, ChevronRight, CircleCheck, CircleX, Dot, ListRow, MessageCircle, Rows, Section, Square, Tag } from "@/ui"

const ACTIVE = new Set<ChatStatus["state"]>(["running", "waiting"])
const toneOf = (s: ChatStatus["state"]) => (s === "waiting" ? "warning" : s === "failed" ? "danger" : "accent")
// ponytail: a task chat is known by its title ("Name: task"); add taskOf to Chat if titles get renamed
// A reply's first words without Markdown marks (**bold**, `code`, # headings).
const plain = (text: string) => text.replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim()
const isTask = (c: Chat, agent: Agent) => c.title.startsWith(`${agent.name}: `)

export function AgentWork({ agent }: { agent: Agent }) {
  const chats = useList(chatsAtom)
  const projects = useList(projectsAtom)
  const statuses = useStatuses()
  const runs = useReading(agentRunsAtom(agent.id))
  const invalidate = useInvalidate()
  const mine = chats.filter((c) => c.agentIds.includes(agent.id))
  const now = mine.flatMap((c) => {
    const s = statuses[c.id]
    return s && s.agentId === agent.id && ACTIVE.has(s.state) ? [{ chat: c, status: s }] : []
  })
  // A run started or ended: the sessions list reads again.
  const live = now.map((x) => `${x.chat.id}:${x.status.state}`).join(",")
  useEffect(() => {
    invalidate(["runs"])
  }, [live, invalidate])

  // Its own chat with you: the latest where it's the only member (not a task or a routine's), else a new one.
  const create = useMutation(mutations.createChat)
  const [opening, setOpening] = useState(false)
  const direct = [...mine].sort((a, b) => (b.lastAt ?? b.createdAt) - (a.lastAt ?? a.createdAt)).find((c) => c.agentIds.length === 1 && !isTask(c, agent) && !c.title.endsWith("(routine)"))
  const talk = () => {
    if (direct) return go({ view: "chat", id: direct.id })
    setOpening(true)
    create({ payload: { projectId: agent.projectId, agentIds: [agent.id], model: agent.model, accountId: agent.accountId, effort: agent.effort }, reactivityKeys: ["chats"] })
      .then((c) => go({ view: "chat", id: c.id }))
      .finally(() => setOpening(false))
  }
  const where = (chatId: string) => {
    const c = chats.find((x) => x.id === chatId)
    const project = c?.projectId ? (projects.find((p) => p.id === c.projectId)?.name ?? t("agent.work.general")) : t("agent.work.general")
    return { chat: c, project }
  }

  return (
    <>
      <Section
        title={t("agent.work.now")}
        description={t("agent.work.nowHint")}
        action={
          <Button size="sm" variant="secondary" isPending={opening} onPress={talk}>
            <MessageCircle />
            {t("agent.work.talk", { name: agent.name })}
          </Button>
        }
      >
        <Rows>
          {now.length ? (
            now.map(({ chat: c, status: s }) => (
              <ListRow
                key={c.id}
                label={chatTitle(c)}
                onPress={() => go({ view: "chat", id: c.id })}
                icon={<Dot tone={toneOf(s.state)} />}
                title={chatTitle(c)}
                hint={s.label || t(`agent.work.${s.state as "running" | "waiting"}`)}
                {...(s.state === "waiting" && { hintTone: "warning" as const })}
                aside={where(c.id).project}
              />
            ))
          ) : (
            <p className="py-3.5 text-muted">{t("agent.work.idle")}</p>
          )}
        </Rows>
      </Section>
      <Section title={t("agent.work.sessions")} description={t("agent.work.sessionsHint")}>
        <Rows>
          {runs.loading ? (
            <p className="py-3.5 text-muted">{t("common.checking")}</p>
          ) : runs.items.length === 0 ? (
            <p className="py-3.5 text-muted">{t("agent.work.noSessions")}</p>
          ) : (
            runs.items.map((r) => <RunRow key={r.turnId} run={r} agent={agent} {...where(r.chatId)} />)
          )}
        </Rows>
      </Section>
    </>
  )
}

// One run: where (project › chat), how it ended, when, how long, its steps and tokens. Pressing it opens that chat,
// the agent's session, on this run's reply.
function RunRow({ run: r, agent, chat, project }: { run: AgentRun; agent: Agent; chat: Chat | undefined; project: string }) {
  const failed = r.state === "failed"
  const stopped = r.state === "interrupted"
  const errors = r.steps.filter((s) => s.status === "error").length
  const took = r.startedAt && r.endedAt ? r.endedAt - r.startedAt : null
  const meta = [
    r.state === "running" ? t("agent.work.running") : formatAge(r.endedAt ?? r.startedAt ?? Date.now()),
    took !== null && took >= 1000 && formatDuration(took),
    t("activity.steps", { count: r.steps.length }),
    errors > 0 && t("activity.errors", { count: errors }),
    r.inputTokens + r.outputTokens > 0 && t("agent.tokens", { n: formatCompact(r.inputTokens + r.outputTokens) })
  ].filter(Boolean)
  const icon =
    r.state === "running" ? <Dot tone="accent" /> : failed ? <CircleX className="size-4 text-danger" /> : stopped ? <Square className="size-3.5 text-warning" /> : <CircleCheck className="size-4 text-success" />
  const name = chat ? chatTitle(chat) : t("agent.work.deletedChat")
  return (
    <ListRow
      label={`${t("agent.work.openChat")}: ${project} › ${name}`}
      onPress={() => chat && go({ view: "chat", id: chat.id, ...(r.messageId && { at: r.messageId }) })}
      icon={icon}
      title={
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-muted">{project}</span>
          <ChevronRight className="size-3.5 shrink-0 text-dim" />
          <span className="truncate">{name}</span>
          {chat && isTask(chat, agent) && <Tag>{t("agent.work.task")}</Tag>}
        </span>
      }
      hint={failed || stopped ? `${t(failed ? "agent.work.failed" : "agent.work.stopped")}${r.preview ? ` · ${plain(r.preview)}` : ""}` : plain(r.preview) || meta.join(" · ")}
      {...(failed && { hintTone: "warning" as const })}
      aside={meta.join(" · ")}
    />
  )
}
