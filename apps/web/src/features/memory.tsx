// Memory: what the agents know about you and your work (facts; skills and pages have screens of their own). Tabs by
// owner (about you, each project, each agent's notes, forgotten), a strip when something waits for you, a field to
// teach it something about you, and each memory with where it came from. Review shows the new ones (Keep, Edit,
// Move, Discard) and the ones not confirmed in STALE_DAYS (Still true, Forget). The server enforces the rules
// (evidence, duplicates, who may write where); this screen shows and changes them.
import { isTeammate, type Memory } from "@zorel/contracts"
import { formatAge, formatDate, t } from "@zorel/i18n"
import { useState } from "react"
import { agentsAtom, chatsAtom, memoriesAtom, mutations, projectsAtom, useInvalidate, useList, useMutation, useReading } from "../client.ts"
import { chatTitle } from "../labels.ts"
import { go } from "../state.ts"
import { ScopeIcon } from "./knowledge.tsx"
import { ReadingState } from "./reading.tsx"
import { Brain, Button, ConfirmDialog, cx, EmptyState, Input, LineDiff, Menu, MenuItem, Pin, PinOff, Plus, Rows, Screen, SearchInput, Tab, TabList, Tabs, Textarea, Tooltip } from "@/ui"

const STALE_DAYS = 60 // an active memory not confirmed for this long asks "Still true?" (it stays in the prompt meanwhile)
const DAY = 86_400_000
const isStale = (m: Memory, now: number) => m.state === "active" && now - m.confirmedAt > STALE_DAYS * DAY

export function MemoryView({ tab = "all", review = false }: { tab?: string | undefined; review?: boolean | undefined }) {
  const reading = useReading(memoriesAtom)
  const projects = useList(projectsAtom)
  const agents = useList(agentsAtom)
  const invalidate = useInvalidate()
  const [query, setQuery] = useState("")
  const now = Date.now()
  const facts = reading.items.filter((m) => m.kind === "fact")
  const q = query.trim().toLowerCase()
  const found = facts.filter((m) => !q || m.text.toLowerCase().includes(q))
  const pending = found.filter((m) => m.state === "pending")
  const stale = found.filter((m) => isStale(m, now))
  const waiting = facts.filter((m) => m.state === "pending" || isStale(m, now)).length
  const kept = (scope: string) => facts.filter((m) => m.scope === scope && m.state === "active").length
  // Tabs: About you always; a project or an agent once it has memories; Forgotten once there is one.
  const owners = [...new Set(facts.filter((m) => m.state !== "forgotten" && m.scope !== "user").map((m) => m.scope))].sort((a, b) => a.localeCompare(b))
  const anyForgotten = facts.some((m) => m.state === "forgotten")
  const shown = found.filter((m) => (tab === "forgotten" ? m.state === "forgotten" : m.state === "active" && (tab === "all" || m.scope === tab)))
  const groups = tab === "all" ? ["user", ...owners].filter((s) => shown.some((m) => m.scope === s)) : [tab]

  return (
    <Screen
      title={t("memory.title")}
      subtitle={t("memory.subtitle", { count: facts.filter((m) => m.state === "active").length })}
      actions={<SearchInput size="sm" className="w-56" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("common.search")} aria-label={t("memory.search")} />}
    >
      <div className="flex w-full max-w-3xl flex-col gap-5 px-8 py-6">
        <ReadingState loading={reading.loading} failed={reading.failed} onRetry={() => invalidate(["memories"])} />
        {review ? (
          <>
            <div>
              <Button size="sm" variant="ghost" onPress={() => go({ view: "memory" })}>
                {t("memory.back")}
              </Button>
            </div>
            <Group title={t("memory.newTitle")} hint={t("memory.newHint")}>
              {pending.length ? pending.map((m) => <FactRow key={m.id} memory={m} showScope />) : <p className="py-3 text-sm text-muted">{t("memory.nothingNew")}</p>}
            </Group>
            <Group title={t("memory.staleTitle")} hint={t("memory.staleHint", { days: STALE_DAYS })}>
              {stale.length ? stale.map((m) => <FactRow key={m.id} memory={m} showScope stale />) : <p className="py-3 text-sm text-muted">{t("memory.allConfirmed")}</p>}
            </Group>
          </>
        ) : (
          <>
            <Tabs selectedKey={tab} onSelectionChange={(k) => go(k === "all" ? { view: "memory" } : { view: "memory", tab: String(k) })}>
              <TabList label={t("memory.title")}>
                <Tab id="all">{t("memory.all")}</Tab>
                <Tab id="user" count={kept("user") || undefined}>
                  {t("memory.aboutYou")}
                </Tab>
                {owners.map((s) => (
                  <Tab key={s} id={s} count={kept(s) || undefined}>
                    <span className="flex items-center gap-1.5">
                      <ScopeIcon scope={s} agents={agents} />
                      {ownerName(s, projects, agents)}
                    </span>
                  </Tab>
                ))}
                {anyForgotten && <Tab id="forgotten">{t("memory.forgotten")}</Tab>}
              </TabList>
            </Tabs>
            {waiting > 0 && tab !== "forgotten" && (
              <div role="status" className="flex items-center gap-3 rounded-card border border-accent-line bg-accent-faint px-3.5 py-2.5">
                <span aria-hidden="true" className="size-2 rounded-full bg-accent-text" />
                <span className="flex-1 text-sm">
                  <span className="font-medium">{t("memory.waiting", { count: waiting })}</span>
                  <span className="text-muted">{` · ${t("memory.waitingParts", { fresh: facts.filter((m) => m.state === "pending").length, old: facts.filter((m) => isStale(m, now)).length })}`}</span>
                </span>
                <Button size="sm" variant="default" onPress={() => go({ view: "memory", review: true })}>
                  {t("memory.review")}
                </Button>
              </div>
            )}
            {(tab === "all" || tab === "user") && <Teach />}
            {groups.map((s) => (
              <Group
                key={s}
                title={tab === "all" ? ownerName(s, projects, agents) : undefined}
                icon={tab === "all" ? <ScopeIcon scope={s} agents={agents} /> : undefined}
                hint={tab === "all" ? t(s === "user" ? "memory.seenByAll" : s.startsWith("agent:") ? "memory.seenByAgent" : "memory.seenByProject", { name: agents.find((a) => `agent:${a.id}` === s)?.name ?? ownerName(s, projects, agents) }) : undefined}
              >
                {shown.filter((m) => m.scope === s || tab === "forgotten").map((m) => (
                  <FactRow key={m.id} memory={m} />
                ))}
              </Group>
            ))}
            {!reading.loading && shown.length === 0 && (
              <EmptyState
                icon={<Brain />}
                title={tab === "forgotten" ? t("memory.noneForgotten") : facts.length ? t("memory.noneHere") : t("memory.empty")}
                hint={tab === "forgotten" ? t("memory.forgottenHint") : t("memory.emptyHint")}
              />
            )}
            {tab === "forgotten" && shown.length > 0 && <p className="text-sm text-dim">{t("memory.forgottenHint")}</p>}
          </>
        )}
      </div>
    </Screen>
  )
}

const ownerName = (scope: string, projects: ReadonlyArray<{ id: string; name: string }>, agents: ReadonlyArray<{ id: string; name: string }>) => {
  if (scope === "user") return t("memory.aboutYou")
  if (scope.startsWith("agent:")) {
    const a = agents.find((x) => `agent:${x.id}` === scope)
    return a ? t("memory.notesOf", { name: a.name }) : t("scope.unknown")
  }
  return projects.find((p) => `project:${p.id}` === scope)?.name ?? scope
}

function Group({ title, icon, hint, children }: { title?: string | undefined; icon?: React.ReactNode; hint?: string | undefined; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      {title && (
        <h3 className="flex flex-wrap items-center gap-x-2 text-sm font-medium text-muted">
          {icon}
          {title}
          {hint && <span className="font-normal text-dim">{`· ${hint}`}</span>}
        </h3>
      )}
      {!title && hint && <p className="text-sm text-dim">{hint}</p>}
      <Rows>{children}</Rows>
    </section>
  )
}

// "Teach it something about you": a sentence and Enter make an active memory about you.
function Teach() {
  const create = useMutation(mutations.createMemory)
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="flex items-center gap-2 rounded-card border border-dashed border-strong px-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (!text.trim() || busy) return
        setBusy(true)
        create({ payload: { scope: "user", kind: "fact", title: "", text: text.trim() }, reactivityKeys: ["memories"] })
          .then(() => setText(""))
          .finally(() => setBusy(false))
      }}
    >
      <Plus className="size-4 shrink-0 text-dim" />
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={500}
        placeholder={t("memory.teach")}
        aria-label={t("memory.teachLabel")}
        className="h-10 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
      />
    </form>
  )
}

// One memory: its sentence, who and where it came from, and what can be done with it here.
function FactRow({ memory: m, showScope = false, stale = false }: { memory: Memory; showScope?: boolean; stale?: boolean }) {
  const projects = useList(projectsAtom)
  const agents = useList(agentsAtom)
  const chats = useList(chatsAtom)
  const all = useList(memoriesAtom)
  const update = useMutation(mutations.updateMemory)
  const remove = useMutation(mutations.removeMemory)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(m.text)
  const [failed, setFailed] = useState<string>()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const chat = chats.find((c) => c.id === m.chatId)
  const target = m.replaces ? all.find((x) => x.id === m.replaces) : undefined // a correction: the memory it replaces
  const owner = m.scope.startsWith("agent:") ? agents.find((a) => `agent:${a.id}` === m.scope) : undefined
  const who = m.origin === "manual" ? t("memory.youWrote") : owner ? (m.state === "pending" ? t("memory.wantsToKeep", { name: owner.name }) : t("memory.kept", { name: owner.name })) : t("memory.learned")
  const patch = (payload: { state?: Memory["state"]; text?: string; scope?: string; essential?: boolean }) =>
    update({ params: { id: m.id }, payload, reactivityKeys: ["memories"] }).then(
      () => setFailed(undefined),
      (e: unknown) => {
        setFailed((e as { _tag?: string })?._tag === "Conflict" ? t("knowledge.sameText") : t("knowledge.saveFailed"))
        throw e
      }
    )
  const destinations = [
    "user",
    ...projects.map((p) => `project:${p.id}`),
    ...agents.filter((a) => isTeammate(a)).map((a) => `agent:${a.id}`)
  ].filter((s) => s !== m.scope)
  const move = (
    <Menu
      label={t("memory.moveTo")}
      trigger={
        <Button size="sm" variant="ghost">
          {t("memory.move")}
        </Button>
      }
    >
      {destinations.map((s) => (
        <MenuItem key={s} icon={<ScopeIcon scope={s} agents={agents} />} onAction={() => void patch({ scope: s }).catch(() => {})}>
          {ownerName(s, projects, agents)}
        </MenuItem>
      ))}
    </Menu>
  )
  return (
    <div className="flex flex-col gap-1.5 py-3">
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {editing ? (
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={2}
              maxLength={500}
              autoFocus
              aria-label={t("knowledge.text")}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setText(m.text)
                  setEditing(false)
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  if (text.trim()) void patch({ text: text.trim() }).then(() => setEditing(false), () => {})
                }
              }}
            />
          ) : target ? (
            <LineDiff before={target.text} after={m.text} />
          ) : (
            <span className={cx("text-fg", m.state === "forgotten" && "text-muted line-through decoration-dim")}>{m.text}</span>
          )}
          <span className="flex flex-wrap items-center gap-x-1.5 text-sm text-dim">
            {editing ? (
              t("memory.editKeys")
            ) : (
              <>
                {showScope && (
                  <>
                    <ScopeIcon scope={m.scope} agents={agents} />
                    <span>{ownerName(m.scope, projects, agents)}</span>
                    <span>·</span>
                  </>
                )}
                <span>{target ? t("knowledge.updatesFact") : who}</span>
                {chat && (
                  <>
                    <span>{t("memory.in")}</span>
                    <Button size="sm" variant="ghost" className="-mx-1 h-auto px-1 text-sm text-muted underline decoration-strong underline-offset-2" onPress={() => go({ view: "chat", id: chat.id })}>
                      {chatTitle(chat)}
                    </Button>
                  </>
                )}
                <span>·</span>
                <span title={formatDate(m.createdAt)}>{formatAge(m.createdAt)}</span>
                {m.essential && (
                  <>
                    <span>·</span>
                    <span className="text-accent-text">{t("knowledge.essential")}</span>
                  </>
                )}
              </>
            )}
          </span>
        </div>
        {!editing && (
          <div className="flex shrink-0 items-center gap-0.5">
            {m.state === "pending" && (
              <>
                <Button size="sm" variant="default" onPress={() => void patch({ state: "active" }).catch(() => {})}>
                  {target ? t("knowledge.applyImprovement") : t("memory.keep")}
                </Button>
                {!target && (
                  <Button size="sm" variant="ghost" onPress={() => setEditing(true)}>
                    {t("common.edit")}
                  </Button>
                )}
                {!target && move}
                <Button size="sm" variant="ghost" onPress={() => void patch({ state: "forgotten" }).catch(() => {})}>
                  {t("inbox.discard")}
                </Button>
              </>
            )}
            {m.state === "active" && stale && (
              <>
                <Button size="sm" variant="secondary" onPress={() => void patch({ state: "active" }).catch(() => {})}>
                  {t("memory.stillTrue")}
                </Button>
                <Button size="sm" variant="ghost" onPress={() => setEditing(true)}>
                  {t("common.edit")}
                </Button>
                <Button size="sm" variant="ghost" onPress={() => void patch({ state: "forgotten" }).catch(() => {})}>
                  {t("knowledge.forget")}
                </Button>
              </>
            )}
            {m.state === "active" && !stale && (
              <>
                <Tooltip content={t("knowledge.essentialHint")}>
                  <Button size="sm" variant="ghost" aria-label={m.essential ? t("knowledge.notEssential") : t("knowledge.essential")} onPress={() => void patch({ essential: !m.essential }).catch(() => {})}>
                    {m.essential ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                  </Button>
                </Tooltip>
                <Button size="sm" variant="ghost" onPress={() => setEditing(true)}>
                  {t("common.edit")}
                </Button>
                {move}
                <Button size="sm" variant="ghost" onPress={() => void patch({ state: "forgotten" }).catch(() => {})}>
                  {t("knowledge.forget")}
                </Button>
              </>
            )}
            {m.state === "forgotten" && (
              <>
                <Button size="sm" variant="ghost" onPress={() => void patch({ state: "active" }).catch(() => {})}>
                  {t("knowledge.restore")}
                </Button>
                <Button size="sm" variant="ghost" className="text-danger" onPress={() => setConfirmDelete(true)}>
                  {t("memory.deleteForGood")}
                </Button>
              </>
            )}
          </div>
        )}
      </div>
      {failed && (
        <p role="alert" className="text-sm text-danger">
          {failed}
        </p>
      )}
      <ConfirmDialog
        isOpen={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("memory.deleteTitle")}
        description={t("memory.deleteBody")}
        confirmLabel={t("memory.deleteForGood")}
        onConfirm={() => void remove({ params: { id: m.id }, reactivityKeys: ["memories"] })}
      />
    </div>
  )
}
