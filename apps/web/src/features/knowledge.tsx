// Shared pieces of what agents know: the reader of one memory or skill (diff of a proposed improvement, versions,
// approve, edit, forget), the form for a new one, and a scope's mark. The screens are Memory (facts), Skills and
// Pages; Knowledge was the single screen they split from. Nothing reaches the model until it is approved.
import type { Agent, Memory } from "@zorel/contracts"
import { isTeammate } from "@zorel/contracts"
import { formatAge, formatDate, t } from "@zorel/i18n"
import { useState } from "react"
import { agentsAtom, chatsAtom, memoriesAtom, memoryVersionsAtom, mutations, projectsAtom, useList, useMutation, useReading } from "../client.ts"
import { agentTone, chatTitle, scopeLabel } from "../labels.ts"
import { go } from "../state.ts"
import { UsedBy, UsedByBadge, useUsedBy } from "./used-by.tsx"
import { AgentAvatar, Button, column, cn, Field, Folder, Input, LineDiff, Pin, PinOff, Rows, Select, Textarea, Tooltip, Undo2, User } from "@/ui"

// Where a memory lives now: a skill in Skills, a fact in Memory.
export const openMemory = (m: Pick<Memory, "id" | "kind">) => go(m.kind === "skill" ? { view: "skills", id: m.id } : { view: "memory" })

// A scope's mark in a list: the agent's face, a folder for a project, a person for "about you".
export function ScopeIcon({ scope, agents }: { scope: string; agents: ReadonlyArray<Agent> }) {
  const agent = scope.startsWith("agent:") ? agents.find((a) => `agent:${a.id}` === scope) : undefined
  if (agent) return <AgentAvatar id={agent.id} name={agent.name} tone={agentTone(agent, agents)} size={16} />
  return scope.startsWith("project:") ? <Folder className="size-4 text-muted" /> : <User className="size-4 text-muted" />
}

export function Reader({ memory: m }: { memory: Memory }) {
  const projects = useList(projectsAtom)
  const agents = useList(agentsAtom)
  const chats = useList(chatsAtom)
  const update = useMutation(mutations.updateMemory)
  const [editing, setEditing] = useState(false)
  const [failed, setFailed] = useState<string>() // why the last save didn't go through
  const [title, setTitle] = useState(m.title)
  const [text, setText] = useState(m.text)
  const skill = m.kind === "skill"
  // Which agents see a skill (an agent's own skill is already only its own).
  const limitable = skill && !m.scope.startsWith("agent:")
  const usedBy = useUsedBy(m.agents)
  const chat = chats.find((c) => c.id === m.chatId)
  // A proposed improvement: the skill it would replace (the person sees what changes before approving).
  const target = useList(memoriesAtom).find((x) => x.id === m.replaces)
  const patch = (payload: { state?: Memory["state"]; title?: string; text?: string; essential?: boolean; agents?: string[] }) => update({ params: { id: m.id }, payload, reactivityKeys: ["memories"] })

  return (
    <article className={cn(column(), "gap-5")}>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted">{skill ? t("knowledge.skill") : t("knowledge.fact")}</span>
        {skill && !editing && <h2 className="text-lg font-semibold">{m.title}</h2>}
        {limitable && !editing && (
          <div>
            <UsedByBadge ids={m.agents} />
          </div>
        )}
        <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted">
          <span>{scopeLabel(m.scope, projects, agents)}</span>
          <span>·</span>
          {chat ? (
            <Button size="sm" variant="ghost" className="-mx-1.5 h-auto px-1.5 text-muted" onPress={() => go({ view: "chat", id: chat.id })}>
              {t("knowledge.fromChat", { chat: chatTitle(chat) })}
            </Button>
          ) : (
            <span>{m.origin === "auto" ? t("knowledge.learned") : t("knowledge.added")}</span>
          )}
          <span>·</span>
          <span>{formatDate(m.createdAt)}</span>
          {m.essential && (
            <>
              <span>·</span>
              <span className="text-secondary">{t("knowledge.essential")}</span>
            </>
          )}
        </p>
      </div>
      {m.state !== "active" && (
        <div className="flex flex-col gap-1 rounded-card bg-surface px-4 py-3 text-sm">
          <span className="text-secondary">{target && m.state === "pending" ? (skill ? t("knowledge.improves", { title: target.title }) : t("knowledge.updatesFact")) : t(`knowledge.state.${m.state}`)}</span>
          {m.reason && <span className="text-muted">{t("knowledge.why", { reason: m.reason })}</span>}
        </div>
      )}
      {editing ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            setFailed(undefined)
            patch({ text: text.trim(), ...(skill && { title: title.trim() }), ...(limitable && usedBy.changed && { agents: usedBy.value }) }).then(
              () => setEditing(false),
              (e: unknown) => setFailed((e as { _tag?: string })?._tag === "Conflict" ? t("knowledge.sameText") : t("knowledge.saveFailed"))
            )
          }}
        >
          {failed && (
            <p role="alert" className="text-sm text-danger">
              {failed}
            </p>
          )}
          {skill && (
            <Field label={t("knowledge.titleField")}>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
            </Field>
          )}
          <Field label={skill ? t("knowledge.steps") : t("knowledge.text")}>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={skill ? 10 : 4} maxLength={4000} autoFocus />
          </Field>
          {limitable && <UsedBy state={usedBy} />}
          <div className="flex gap-2">
            <Button type="submit" variant="default" isDisabled={!text.trim() || (skill && !title.trim()) || (limitable && !usedBy.valid)}>
              {t("common.save")}
            </Button>
            <Button
              variant="ghost"
              onPress={() => {
                usedBy.reset()
                setEditing(false)
              }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </form>
      ) : target && m.state === "pending" ? (
        <div className="flex flex-col gap-2">
          {target.title !== m.title && <p className="text-sm text-muted">{t("knowledge.renamed", { from: target.title, to: m.title })}</p>}
          <LineDiff before={target.text} after={m.text} />
        </div>
      ) : (
        <p className={cn("whitespace-pre-wrap leading-relaxed", skill ? "text-secondary" : "text-lg")}>{m.text}</p>
      )}
      {!editing && (
        <div className="flex flex-wrap gap-2">
          {m.state === "pending" && (
            <Button size="sm" variant="default" onPress={() => void patch({ state: "active" }).then((applied) => applied.id !== m.id && openMemory(applied))}>
              {target ? t("knowledge.applyImprovement") : t("knowledge.approve")}
            </Button>
          )}
          {m.state === "forgotten" ? (
            <Button size="sm" variant="secondary" onPress={() => void patch({ state: "active" })}>
              {t("knowledge.restore")}
            </Button>
          ) : (
            <>
              <Button size="sm" variant="secondary" onPress={() => setEditing(true)}>
                {t("common.edit")}
              </Button>
              {m.state === "active" && !skill && (
                <Tooltip content={t("knowledge.essentialHint")}>
                  <Button size="sm" variant="secondary" onPress={() => void patch({ essential: !m.essential })}>
                    {m.essential ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                    {m.essential ? t("knowledge.notEssential") : t("knowledge.essential")}
                  </Button>
                </Tooltip>
              )}
              <Button size="sm" variant="ghost" onPress={() => void patch({ state: "forgotten" })}>
                {m.state === "pending" ? t("inbox.discard") : t("knowledge.forget")}
              </Button>
            </>
          )}
        </div>
      )}
      {m.state === "active" && <MemoryVersions memory={m} />}
    </article>
  )
}

// Earlier texts of this memory or skill (each edit or approved improvement keeps the one before); any comes back.
function MemoryVersions({ memory: m }: { memory: Memory }) {
  const versions = useReading(memoryVersionsAtom(m.id)).items
  const restore = useMutation(mutations.restoreMemory)
  const [open, setOpen] = useState<string>()
  if (!versions.length) return null
  return (
    <section className="flex flex-col gap-2 border-t border-subtle pt-5">
      <h3 className="text-sm font-medium text-muted">{t("knowledge.versions")}</h3>
      <Rows>
        {versions.map((v) => (
          <div key={v.id} className="flex flex-col gap-2 py-2">
            <div className="flex items-center gap-3">
              <Button size="sm" variant="ghost" className="-ml-2.5 min-w-0 flex-1 justify-start font-normal text-secondary" aria-expanded={open === v.id} onPress={() => setOpen(open === v.id ? undefined : v.id)}>
                <span className="truncate">{`${v.by === "you" ? t("agent.byYou") : v.by} · ${formatDate(v.at)} ${formatAge(v.at)}`}</span>
              </Button>
              <Button size="sm" variant="ghost" onPress={() => void restore({ params: { id: m.id }, payload: { versionId: v.id }, reactivityKeys: ["memories"] })}>
                <Undo2 />
                {t("agent.restore")}
              </Button>
            </div>
            {open === v.id && <LineDiff before={v.text} after={m.text} />}
          </div>
        ))}
      </Rows>
    </section>
  )
}

export function NewMemory({ kind, onKind, onDone }: { kind: Memory["kind"]; onKind?: ((k: Memory["kind"]) => void) | undefined; onDone: (id?: string) => void }) {
  const projects = useList(projectsAtom)
  const agents = useList(agentsAtom)
  const create = useMutation(mutations.createMemory)
  const [scope, setScope] = useState("user")
  const [title, setTitle] = useState("")
  const [text, setText] = useState("")
  const skill = kind === "skill"
  return (
    <form
      className={cn(column(), "gap-4")}
      onSubmit={(e) => {
        e.preventDefault()
        void create({ payload: { scope, kind, title: skill ? title.trim() : "", text: text.trim() }, reactivityKeys: ["memories"] }).then((m) => onDone(m.id))
      }}
    >
      <h2 className="text-lg font-semibold">{skill ? t("knowledge.newSkill") : t("knowledge.newFact")}</h2>
      <div className="flex flex-wrap gap-3">
        {onKind && <Field label={t("knowledge.kind")} className="w-40">
          <Select
            value={kind}
            onChange={(v) => onKind(v as Memory["kind"])}
            aria-label={t("knowledge.kind")}
            options={[
              { value: "fact", label: t("knowledge.fact") },
              { value: "skill", label: t("knowledge.skill") }
            ]}
          />
        </Field>}
        <Field label={t("knowledge.scope")} className="min-w-56 flex-1">
          <Select
            value={scope}
            onChange={setScope}
            aria-label={t("knowledge.scope")}
            options={[
              { value: "user", label: t("scope.user") },
              ...projects.map((p) => ({ value: `project:${p.id}`, label: t("scope.project", { name: p.name }) })),
              ...agents.filter((a) => isTeammate(a)).map((a) => ({ value: `agent:${a.id}`, label: t("scope.agent", { name: a.name }), icon: <ScopeIcon scope={`agent:${a.id}`} agents={agents} /> }))
            ]}
          />
        </Field>
      </div>
      {skill && (
        <Field label={t("knowledge.titleField")}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} autoFocus />
        </Field>
      )}
      <Field label={skill ? t("knowledge.steps") : t("knowledge.text")}>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={skill ? 8 : 3} maxLength={skill ? 4000 : 500} {...(!skill && { autoFocus: true })} />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" variant="default" isDisabled={!text.trim() || (skill && !title.trim())}>
          {t("common.create")}
        </Button>
        <Button variant="ghost" onPress={() => onDone()}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  )
}
