// Knowledge (prototype "Knowledge"): what the chats learned and what you wrote, as a list and a reader.
// Facts are durable sentences; skills are procedures. Nothing reaches the model until it is approved.
import type { Memory } from "@zero/contracts"
import { formatAge, formatDate, t } from "@zero/i18n"
import { useEffect, useState } from "react"
import { agentsAtom, chatsAtom, memoriesAtom, mutations, projectsAtom, useList, useMutation } from "../client.ts"
import { chatTitle, scopeLabel } from "../labels.ts"
import { go } from "../state.ts"
import {
  BookOpen, Button, cx, EmptyState, Field, Input, Plus, Screen, Search, Select, Tab, TabList, Tabs, Textarea
} from "@/ui"

type Filter = "all" | "fact" | "skill" | "pending" | "forgotten"

const matches = (m: Memory, f: Filter) =>
  f === "pending" ? m.state === "pending" : f === "forgotten" ? m.state === "forgotten" : m.state !== "forgotten" && (f === "all" || m.kind === f)

export function KnowledgeView({ selected }: { selected: string | undefined }) {
  const memories = useList(memoriesAtom)
  const projects = useList(projectsAtom)
  const agents = useList(agentsAtom)
  const [filter, setFilter] = useState<Filter>("all")
  const [scope, setScope] = useState("")
  const [query, setQuery] = useState("")
  const [creating, setCreating] = useState<Memory["kind"]>()

  const q = query.trim().toLowerCase()
  const list = memories
    .filter((m) => matches(m, filter) && (!scope || m.scope === scope) && (!q || `${m.title} ${m.text}`.toLowerCase().includes(q)))
    .sort((a, b) => Math.max(b.createdAt, b.confirmedAt) - Math.max(a.createdAt, a.confirmedAt))
  const current = memories.find((m) => m.id === selected)
  const scopes = [...new Set(memories.map((m) => m.scope))]
  const count = memories.filter((m) => m.state !== "forgotten").length

  useEffect(() => {
    if (selected) setCreating(undefined)
  }, [selected])

  return (
    <Screen
      title={t("knowledge.title")}
      subtitle={t("knowledge.subtitle", { count })}
      bodyClassName="flex"
      actions={
        <>
          <div className="relative w-56">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted" aria-hidden="true" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("common.search")} aria-label={t("knowledge.search")} className="rounded-full pl-8" />
          </div>
          <Button variant="secondary" onPress={() => setCreating("fact")}>
            <Plus />
            {t("knowledge.new")}
          </Button>
        </>
      }
    >
      <nav aria-label={t("knowledge.title")} className="flex w-96 shrink-0 flex-col gap-3 overflow-y-auto border-r border-subtle py-4 pr-3 pl-4">
        <Tabs selectedKey={filter} onSelectionChange={(k) => setFilter(k as Filter)}>
          <TabList label={t("knowledge.title")}>
            <Tab id="all">{t("knowledge.all")}</Tab>
            <Tab id="fact">{t("knowledge.facts")}</Tab>
            <Tab id="skill">{t("knowledge.skills")}</Tab>
            <Tab id="pending" count={memories.filter((m) => m.state === "pending").length || undefined}>
              {t("knowledge.pending")}
            </Tab>
            <Tab id="forgotten">{t("knowledge.forgotten")}</Tab>
          </TabList>
        </Tabs>
        {scopes.length > 1 && (
          <Select
            size="sm"
            aria-label={t("knowledge.scope")}
            value={scope}
            onChange={setScope}
            options={[{ value: "", label: t("knowledge.allScopes") }, ...scopes.map((s) => ({ value: s, label: scopeLabel(s, projects, agents) }))]}
          />
        )}
        <ul className="flex flex-col gap-0.5">
          {list.map((m) => (
            <li key={m.id}>
              <Button
                variant="ghost"
                onPress={() => go({ view: "knowledge", id: m.id })}
                className={cx(
                  "h-auto w-full flex-col items-start gap-0.5 rounded-card border px-3 py-2.5 text-left font-normal whitespace-normal",
                  m.id === selected ? "border-subtle bg-surface text-fg" : "border-transparent text-fg"
                )}
              >
                <span className="block w-full truncate font-medium">{m.kind === "skill" ? m.title : m.text}</span>
                <span className="block w-full truncate text-sm text-muted">
                  {[m.kind === "skill" ? t("knowledge.skill") : t("knowledge.fact"), scopeLabel(m.scope, projects, agents), formatAge(Math.max(m.createdAt, m.confirmedAt))].join(" · ")}
                </span>
              </Button>
            </li>
          ))}
        </ul>
        {list.length === 0 && <p className="px-2 py-6 text-center text-muted">{memories.length ? t("knowledge.noMatch") : t("knowledge.empty")}</p>}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto">
        {creating ? (
          <NewMemory kind={creating} onKind={setCreating} onDone={(id) => (id ? go({ view: "knowledge", id }) : setCreating(undefined))} />
        ) : current ? (
          <Reader key={current.id} memory={current} />
        ) : (
          <EmptyState icon={<BookOpen />} title={memories.length ? t("knowledge.select") : t("knowledge.empty")} hint={memories.length ? undefined : t("knowledge.emptyHint")} />
        )}
      </div>
    </Screen>
  )
}

function Reader({ memory: m }: { memory: Memory }) {
  const projects = useList(projectsAtom)
  const agents = useList(agentsAtom)
  const chats = useList(chatsAtom)
  const update = useMutation(mutations.updateMemory)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(m.title)
  const [text, setText] = useState(m.text)
  const skill = m.kind === "skill"
  const chat = chats.find((c) => c.id === m.chatId)
  const patch = (payload: { state?: Memory["state"]; title?: string; text?: string }) => update({ params: { id: m.id }, payload, reactivityKeys: ["memories"] })

  return (
    <article className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-10 py-8">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold tracking-wide text-accent-text uppercase">{skill ? t("knowledge.skill") : t("knowledge.fact")}</span>
        {skill && !editing && <h2 className="text-lg font-semibold">{m.title}</h2>}
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
        </p>
      </div>
      {m.state !== "active" && <p className="rounded-card bg-surface px-4 py-3 text-sm text-secondary">{t(`knowledge.state.${m.state}`)}</p>}
      {editing ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void patch({ text: text.trim(), ...(skill && { title: title.trim() }) }).then(() => setEditing(false))
          }}
        >
          {skill && (
            <Field label={t("knowledge.titleField")}>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
            </Field>
          )}
          <Field label={skill ? t("knowledge.steps") : t("knowledge.text")}>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={skill ? 10 : 4} maxLength={4000} autoFocus />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" variant="default" isDisabled={!text.trim() || (skill && !title.trim())}>
              {t("common.save")}
            </Button>
            <Button variant="ghost" onPress={() => setEditing(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        </form>
      ) : (
        <p className={cx("whitespace-pre-wrap leading-relaxed", skill ? "text-secondary" : "text-lg")}>{m.text}</p>
      )}
      {!editing && (
        <div className="flex flex-wrap gap-2">
          {m.state === "pending" && (
            <Button size="sm" variant="default" onPress={() => void patch({ state: "active" })}>
              {t("knowledge.approve")}
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
              <Button size="sm" variant="ghost" onPress={() => void patch({ state: "forgotten" })}>
                {m.state === "pending" ? t("inbox.discard") : t("knowledge.forget")}
              </Button>
            </>
          )}
        </div>
      )}
    </article>
  )
}

function NewMemory({ kind, onKind, onDone }: { kind: Memory["kind"]; onKind: (k: Memory["kind"]) => void; onDone: (id?: string) => void }) {
  const projects = useList(projectsAtom)
  const agents = useList(agentsAtom)
  const create = useMutation(mutations.createMemory)
  const [scope, setScope] = useState("user")
  const [title, setTitle] = useState("")
  const [text, setText] = useState("")
  const skill = kind === "skill"
  return (
    <form
      className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-10 py-8"
      onSubmit={(e) => {
        e.preventDefault()
        void create({ payload: { scope, kind, title: skill ? title.trim() : "", text: text.trim() }, reactivityKeys: ["memories"] }).then((m) => onDone(m.id))
      }}
    >
      <h2 className="text-lg font-semibold">{skill ? t("knowledge.newSkill") : t("knowledge.newFact")}</h2>
      <div className="flex flex-wrap gap-3">
        <Field label={t("knowledge.kind")} className="w-40">
          <Select
            value={kind}
            onChange={(v) => onKind(v as Memory["kind"])}
            aria-label={t("knowledge.kind")}
            options={[
              { value: "fact", label: t("knowledge.fact") },
              { value: "skill", label: t("knowledge.skill") }
            ]}
          />
        </Field>
        <Field label={t("knowledge.scope")} className="min-w-56 flex-1">
          <Select
            value={scope}
            onChange={setScope}
            aria-label={t("knowledge.scope")}
            options={[
              { value: "user", label: t("scope.user") },
              ...projects.map((p) => ({ value: `project:${p.id}`, label: t("scope.project", { name: p.name }) })),
              ...agents.map((a) => ({ value: `agent:${a.id}`, label: t("scope.agent", { name: a.name }) }))
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
