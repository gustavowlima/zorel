// Knowledge (prototype "Knowledge"): what the chats learned and what you wrote, as a list and a reader.
// Facts are durable sentences; skills are procedures. Nothing reaches the model until it is approved.
import type { Agent, Memory } from "@zorel/contracts"
import { isTeammate } from "@zorel/contracts"
import { formatAge, formatDate, t } from "@zorel/i18n"
import { useEffect, useState } from "react"
import { agentsAtom, chatsAtom, memoriesAtom, memoryVersionsAtom, mutations, pagesAtom, projectsAtom, useList, useMutation, useReading } from "../client.ts"
import { NewPage, PageView } from "./pages.tsx"
import { agentTone, chatTitle, scopeLabel } from "../labels.ts"
import { go } from "../state.ts"
import { AgentAvatar, BookOpen, Button, cx, EmptyState, Field, Folder, Input, LineDiff, Pin, PinOff, Plus, Rows, Screen, SearchInput, Select, Tab, TabList, Tabs, Textarea, Tooltip, Undo2, User } from "@/ui"

// What is shown: a kind (the tabs) and a state (the "Show" select): active, waiting for review, or forgotten.
type Kind = "all" | "fact" | "skill" | "page"
type State = "active" | "pending" | "forgotten"

const matches = (m: Memory, kind: Kind, state: State) =>
  (state === "active" ? m.state !== "forgotten" : m.state === state) && (kind === "all" || m.kind === kind)

// A scope's mark in a list: the agent's face, a folder for a project, a person for "about you".
function ScopeIcon({ scope, agents }: { scope: string; agents: ReadonlyArray<Agent> }) {
  const agent = scope.startsWith("agent:") ? agents.find((a) => `agent:${a.id}` === scope) : undefined
  if (agent) return <AgentAvatar id={agent.id} name={agent.name} tone={agentTone(agent, agents)} size={16} />
  return scope.startsWith("project:") ? <Folder className="size-4 text-muted" /> : <User className="size-4 text-muted" />
}

export function KnowledgeView({ selected, scope: openScope, kind: openKind }: { selected: string | undefined; scope?: string | undefined; kind?: "fact" | "skill" | undefined }) {
  const memories = useList(memoriesAtom)
  const pages = useList(pagesAtom)
  const projects = useList(projectsAtom)
  const agents = useList(agentsAtom)
  const [kind, setKind] = useState<Kind>(openKind ?? "all")
  const [state, setState] = useState<State>("active")
  const [scope, setScope] = useState(openScope ?? "")
  // Opened filtered (an agent's memories, from its page): the route sets the scope and the kind.
  useEffect(() => {
    if (openScope) setScope(openScope)
    if (openKind) setKind(openKind)
  }, [openScope, openKind])
  const [query, setQuery] = useState("")
  const [creating, setCreating] = useState<Memory["kind"]>()
  const [creatingPage, setCreatingPage] = useState(false)

  const q = query.trim().toLowerCase()
  const list = memories
    .filter((m) => matches(m, kind, state) && (!scope || m.scope === scope) && (!q || `${m.title} ${m.text}`.toLowerCase().includes(q)))
    .sort((a, b) => Math.max(b.createdAt, b.confirmedAt) - Math.max(a.createdAt, a.confirmedAt))
  const current = memories.find((m) => m.id === selected)
  const page = pages.find((p) => p.id === selected)
  const pageList = pages.filter((p) => (!scope || p.scope === scope) && (!q || `${p.title} ${p.body}`.toLowerCase().includes(q)))
  const showPages = kind === "page"
  const scopes = [...new Set(memories.map((m) => m.scope))]
  const count = memories.filter((m) => m.state !== "forgotten").length
  const pendingCount = memories.filter((m) => m.state === "pending").length
  // Nothing learned or written yet: one empty state for the whole screen, not one per pane.
  const nothing = memories.length === 0 && pages.length === 0 && !creating && !creatingPage && !selected

  useEffect(() => {
    if (selected) {
      setCreating(undefined)
      setCreatingPage(false)
    }
  }, [selected])
  // A page opened by link shows in the Pages list.
  useEffect(() => {
    if (page) setKind("page")
  }, [page])

  return (
    <Screen
      title={t("knowledge.title")}
      subtitle={t("knowledge.subtitle", { count })}
      bodyClassName="flex"
      actions={
        <>
          <SearchInput size="sm" className="w-56" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("common.search")} aria-label={t("knowledge.search")} />
          <Button size="sm" variant="secondary" onPress={() => (showPages ? setCreatingPage(true) : setCreating("fact"))}>
            <Plus />
            {t("knowledge.new")}
          </Button>
        </>
      }
    >
      {nothing ? (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            icon={<BookOpen />}
            title={t("knowledge.empty")}
            hint={t("knowledge.emptyHint")}
            action={
              <Button size="sm" variant="default" onPress={() => setCreating("fact")}>
                <Plus />
                {t("knowledge.new")}
              </Button>
            }
          />
        </div>
      ) : (
      <>
      <nav aria-label={t("knowledge.title")} className="flex w-96 shrink-0 flex-col gap-3 overflow-y-auto border-r border-subtle py-4 pr-3 pl-4">
        <Tabs selectedKey={kind} onSelectionChange={(k) => setKind(k as Kind)}>
          <TabList label={t("knowledge.title")}>
            <Tab id="all">{t("knowledge.all")}</Tab>
            <Tab id="fact">{t("knowledge.facts")}</Tab>
            <Tab id="skill">{t("knowledge.skills")}</Tab>
            <Tab id="page">{t("pages.pages")}</Tab>
          </TabList>
        </Tabs>
        <div className="grid grid-cols-2 gap-2">
          {!showPages && (
            <Select
              size="sm"
              aria-label={t("knowledge.show")}
              value={state}
              onChange={(v) => setState(v as State)}
              options={[
                { value: "active", label: t("knowledge.active") },
                { value: "pending", label: pendingCount ? `${t("knowledge.pending")} · ${pendingCount}` : t("knowledge.pending") },
                { value: "forgotten", label: t("knowledge.forgotten") }
              ]}
            />
          )}
          {scopes.length > 1 && (
            <Select
              size="sm"
              aria-label={t("knowledge.scope")}
              value={scope}
              onChange={setScope}
              searchLabel={t("knowledge.searchScopes")}
              options={[{ value: "", label: t("knowledge.allScopes") }, ...scopes.map((s) => ({ value: s, label: scopeLabel(s, projects, agents), icon: <ScopeIcon scope={s} agents={agents} /> }))]}
            />
          )}
        </div>
        {showPages && (
          <ul className="flex flex-col gap-0.5">
            {pageList.map((p) => (
              <li key={p.id}>
                <Button
                  variant="ghost"
                  onPress={() => go({ view: "knowledge", id: p.id })}
                  className={cx(
                    "h-auto w-full flex-col items-start gap-0.5 rounded-card border px-3 py-2.5 text-left font-normal whitespace-normal",
                    p.id === selected ? "border-subtle bg-surface text-fg" : "border-transparent text-fg"
                  )}
                >
                  <span className="flex w-full items-center gap-1.5 truncate font-medium">
                    {p.pinned && <Pin className="size-3 shrink-0 text-muted" />}
                    {p.title}
                  </span>
                  <span className="block w-full truncate text-sm text-muted">{[scopeLabel(p.scope, projects, agents), formatAge(p.updatedAt)].join(" · ")}</span>
                </Button>
              </li>
            ))}
            {pageList.length === 0 && <p className="px-2 py-6 text-center text-muted">{t("pages.empty")}</p>}
          </ul>
        )}
        <ul className={cx("flex flex-col gap-0.5", showPages && "hidden")}>
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
        {!showPages && list.length === 0 && <p className="px-2 py-6 text-center text-muted">{memories.length ? t("knowledge.noMatch") : t("knowledge.empty")}</p>}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto">
        {creatingPage ? (
          <NewPage onDone={(id) => (id ? go({ view: "knowledge", id }) : setCreatingPage(false))} />
        ) : page ? (
          <PageView key={page.id} page={page} />
        ) : creating ? (
          <NewMemory kind={creating} onKind={setCreating} onDone={(id) => (id ? go({ view: "knowledge", id }) : setCreating(undefined))} />
        ) : current ? (
          <Reader key={current.id} memory={current} />
        ) : (
          <EmptyState icon={<BookOpen />} title={t("knowledge.select")} />
        )}
      </div>
      </>
      )}
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
  // A proposed improvement: the skill it would replace (the person sees what changes before approving).
  const target = useList(memoriesAtom).find((x) => x.id === m.replaces)
  const patch = (payload: { state?: Memory["state"]; title?: string; text?: string; essential?: boolean }) => update({ params: { id: m.id }, payload, reactivityKeys: ["memories"] })

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
          {m.essential && (
            <>
              <span>·</span>
              <span className="text-accent-text">{t("knowledge.essential")}</span>
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
      ) : target && m.state === "pending" ? (
        <div className="flex flex-col gap-2">
          {target.title !== m.title && <p className="text-sm text-muted">{t("knowledge.renamed", { from: target.title, to: m.title })}</p>}
          <LineDiff before={target.text} after={m.text} />
        </div>
      ) : (
        <p className={cx("whitespace-pre-wrap leading-relaxed", skill ? "text-secondary" : "text-lg")}>{m.text}</p>
      )}
      {!editing && (
        <div className="flex flex-wrap gap-2">
          {m.state === "pending" && (
            <Button size="sm" variant="default" onPress={() => void patch({ state: "active" }).then((applied) => applied.id !== m.id && go({ view: "knowledge", id: applied.id }))}>
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
