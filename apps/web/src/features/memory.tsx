// Memory: what the agents know about you and your work, three ways (MemorySwitch): its facts as a list, the same facts
// as a map, and its pages (pages.tsx; skills have a screen of their own). Tabs by
// owner (about you, each project, each agent's notes, forgotten), a strip when something waits for you, a field to
// teach it something about you, and each memory with where it came from. Review shows the new ones (Keep, Edit,
// Move, Discard) and the ones not confirmed in STALE_DAYS (Still true, Forget). The server enforces the rules
// (evidence, duplicates, who may write where); this screen shows and changes them.
import { useAtomValue } from "@effect/atom-react"
import { isTeammate, type Memory, type MemoryApproval } from "@zorel/contracts"
import { AsyncResult } from "effect/reactivity"
import { formatAge, formatDate, t } from "@zorel/i18n"
import { useEffect, useState } from "react"
import { agentsAtom, chatsAtom, memoriesAtom, mutations, preferencesAtom, projectsAtom, useInvalidate, useList, useMutation, useReading } from "../client.ts"
import { agentTint, chatTitle } from "../labels.ts"
import { go, store, stored } from "../state.ts"
import { ScopeIcon } from "./knowledge.tsx"
import { MemoryMap } from "./memory-map.tsx"
import { ReadingState } from "./reading.tsx"
import { Brain, Button, ListPresence, SETTLE, PresenceRow, Rise, ChevronRight, Column, ConfirmDialog, cn, EmptyState, IconButton, Inbox, Input, LineDiff, Menu, MenuItem, MenuSeparator, MoreHorizontal, Notice, Pencil, Pin, PinOff, Plus, Rows, Screen, SearchInput, Section, Segmented, Select, SettingRow, Tab, TabList, Tabs, Textarea, Tooltip, X } from "@/ui"

const MAP_KEY = "zorel.memory.map" // Facts as a list or a map, remembered on this computer

// Memory's three views, one control in its header: Facts, Map (both of its facts) and Pages (#/pages, its own route so
// links to a page keep working). Facts or Map is remembered on this computer; `onFacts` shows it in place (the facts'
// screen), else it opens Memory (from Pages).
export function MemorySwitch({ value, onFacts }: { value: "list" | "map" | "pages"; onFacts?: (asMap: boolean) => void }) {
  return (
    <Segmented
      label={t("memory.view")}
      value={value}
      onChange={(v) => {
        if (v === "pages") return go({ view: "pages" })
        store(MAP_KEY, v === "map" ? "1" : "0")
        if (onFacts) onFacts(v === "map")
        else go({ view: "memory" })
      }}
      options={[
        { id: "list", label: t("memory.list") },
        { id: "map", label: t("memory.map") },
        { id: "pages", label: t("memory.pages") }
      ]}
    />
  )
}
const STALE_DAYS = 60 // an active memory not confirmed for this long asks "Still true?" (it stays in the prompt meanwhile)
const DAY = 86_400_000
const GROUP_LIMIT = 8 // facts per owner in "All"; the owner's tab shows every one

// What was just forgotten or moved, and how to put it back (the page's one receipt, gone after RECEIPT_MS).
type Receipt = { id: string; label: string; text: string; undo: { state?: Memory["state"]; scope?: string } }
const RECEIPT_MS = 8000
const isStale = (m: Memory, now: number) => m.state === "active" && now - m.confirmedAt > STALE_DAYS * DAY

export function MemoryView({ tab = "all", review = false }: { tab?: string | undefined; review?: boolean | undefined }) {
  const reading = useReading(memoriesAtom)
  const projects = useList(projectsAtom)
  const agents = useList(agentsAtom)
  const invalidate = useInvalidate()
  const [query, setQuery] = useState("")
  const [asMap, setAsMap] = useState(() => stored(MAP_KEY) === "1")
  const [receipt, setReceipt] = useState<Receipt>()
  const update = useMutation(mutations.updateMemory)
  useEffect(() => {
    if (!receipt) return
    const timer = setTimeout(() => setReceipt(undefined), RECEIPT_MS)
    return () => clearTimeout(timer)
  }, [receipt])
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
  // An agent's notes wear its color in their title (identity tint); you and projects stay neutral.
  const tabTint = (scope: string) => {
    const a = agents.find((x) => `agent:${x.id}` === scope)
    return a && agentTint(a, agents)
  }
  const groups = tab === "all" ? ["user", ...owners].filter((s) => shown.some((m) => m.scope === s)) : [tab]

  // The owners' tabs, over the map (no Forgotten there: it shows All) and over the list.
  const scopeTabs = (onMap: boolean) => (
    <Tabs selectedKey={onMap && tab === "forgotten" ? "all" : tab} onSelectionChange={(k) => go(k === "all" ? { view: "memory" } : { view: "memory", tab: String(k) })}>
      <TabList label={t("memory.title")}>
        <Tab id="all">{t("memory.all")}</Tab>
        <Tab id="user" count={kept("user") || undefined}>
          {t("memory.aboutYou")}
        </Tab>
        {owners.map((s) => (
          <Tab key={s} id={s} count={kept(s) || undefined} tint={tabTint(s)}>
            <span className="flex items-center gap-1.5">
              <ScopeIcon scope={s} agents={agents} />
              {ownerName(s, projects, agents)}
            </span>
          </Tab>
        ))}
        {!onMap && anyForgotten && <Tab id="forgotten">{t("memory.forgotten")}</Tab>}
      </TabList>
    </Tabs>
  )
  return (
    <Screen
      title={review ? t("memory.reviewTitle") : t("memory.title")}
      subtitle={review ? t("memory.waiting", { count: waiting }) : t("memory.subtitle", { count: tab === "all" || tab === "forgotten" ? facts.filter((m) => m.state === "active").length : kept(tab) })}
      {...(asMap && !review && { bodyClassName: "flex flex-col" })}
      actions={
        // The same two controls in Facts, Map and Pages, at the same place: the switch, then the search.
        <>
          {!review && <MemorySwitch value={asMap ? "map" : "list"} onFacts={setAsMap} />}
          <SearchInput size="sm" className="w-56" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("common.search")} aria-label={t("memory.search")} />
        </>
      }
    >
      {asMap && !review ? (
          <MemoryMap
            key={tab}
            scope={tab === "all" || tab === "forgotten" ? "" : tab}
            toolbar={
            scopeTabs(true)
            }
          />
      ) : (
      <Column className="min-h-full">
        <ReadingState loading={reading.loading} failed={reading.failed} onRetry={() => invalidate(["memories"])} />
        {review ? (
          <>
            <div className="-mb-4">
              <Button size="sm" variant="ghost" className="-ml-2.5 text-muted" onPress={() => go({ view: "memory" })}>
                <ChevronRight className="size-3.5 rotate-180" />
                {t("memory.title")}
              </Button>
            </div>
            <Section title={t("memory.newTitle")} description={t("memory.newHint")}>
              <Rows>{pending.length ? <ListPresence>{pending.map((m) => <PresenceRow key={m.id}><FactRow memory={m} showScope onDone={setReceipt} /></PresenceRow>)}</ListPresence> : <p className="py-3 text-sm text-muted">{t("memory.nothingNew")}</p>}</Rows>
            </Section>
            <Section title={t("memory.staleTitle")} description={t("memory.staleHint", { days: STALE_DAYS })}>
              <Rows>{stale.length ? <ListPresence>{stale.map((m) => <PresenceRow key={m.id}><FactRow memory={m} showScope stale onDone={setReceipt} /></PresenceRow>)}</ListPresence> : <p className="py-3 text-sm text-muted">{t("memory.allConfirmed")}</p>}</Rows>
            </Section>
            <Section title={t("memory.approval")}>
              <Rows>
                <Approval />
              </Rows>
            </Section>
          </>
        ) : (
          // The tabs 32px above what they show; the strip, the field and each owner's group 40px apart (DESIGN.md).
          <div className="flex flex-col gap-8">
            {scopeTabs(false)}
            {/* A new scope's facts settle in (the tabs change the route, so this is the panel). */}
            <div key={tab} className={cn("flex flex-col gap-10", SETTLE)}>
              {waiting > 0 && tab !== "forgotten" && (
                <Notice
                  tone="neutral"
                  icon={<Inbox />}
                  title={t("memory.waiting", { count: waiting })}
                  action={
                    <Button size="sm" variant="default" onPress={() => go({ view: "memory", review: true })}>
                      {t("memory.review")}
                    </Button>
                  }
                >
                  {t("memory.waitingParts", { fresh: facts.filter((m) => m.state === "pending").length, old: facts.filter((m) => isStale(m, now)).length })}
                </Notice>
              )}
              {(tab === "all" || tab === "user") && <Teach />}
              {groups.map((s) => (
                <OwnerGroup
                  key={s}
                  scope={s}
                  facts={shown.filter((m) => m.scope === s || tab === "forgotten")}
                  limited={tab === "all" && !q}
                  title={tab === "all" ? <span className={cn("flex items-center gap-1.5", tabTint(s) && `tint-text ${tabTint(s)}`)}><ScopeIcon scope={s} agents={agents} />{ownerName(s, projects, agents)}</span> : undefined}
                  hint={tab === "all" ? t(s === "user" ? "memory.seenByAll" : s.startsWith("agent:") ? "memory.seenByAgent" : "memory.seenByProject", { name: agents.find((a) => `agent:${a.id}` === s)?.name ?? ownerName(s, projects, agents) }) : undefined}
                  onDone={setReceipt}
                />
              ))}
              {!reading.loading && shown.length === 0 && (
                <EmptyState
                  inset
                  icon={<Brain />}
                  title={tab === "forgotten" ? t("memory.noneForgotten") : facts.length ? t("memory.noneHere") : t("memory.empty")}
                  hint={tab === "forgotten" ? t("memory.forgottenHint") : t("memory.emptyHint")}
                />
              )}
              {tab === "forgotten" && shown.length > 0 && <p className="text-sm text-dim">{t("memory.forgottenHint")}</p>}
            </div>
          </div>
        )}
        {/* The receipt: what just left the list, and Undo puts it back where it was; it rises in and sinks away. */}
        <Rise show={!!receipt} className="sticky bottom-0 mx-auto mt-auto w-full max-w-lg">
        {receipt && (
          <div role="status" className="flex w-full items-center gap-3 rounded-card border border-strong bg-raised px-3.5 py-2 text-sm shadow-float">
            <span className="min-w-0 flex-1 truncate text-secondary">
              <span className="text-fg">{receipt.label}</span>
              {` · ${receipt.text}`}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onPress={() => {
                setReceipt(undefined)
                void update({ params: { id: receipt.id }, payload: receipt.undo, reactivityKeys: ["memories"] })
              }}
            >
              {t("memory.undo")}
            </Button>
          </div>
        )}
        </Rise>
      </Column>
      )}
    </Screen>
  )
}

// One setting for every agent: what a new fact learned from a chat becomes (corrections and skills always wait).
function Approval() {
  const prefs = AsyncResult.getOrElse(useAtomValue(preferencesAtom), () => undefined)
  const set = useMutation(mutations.memoryApproval)
  return (
    <SettingRow title={t("memory.approvalTitle")} hint={t("memory.approvalHint")}>
      <Select
        size="sm"
        aria-label={t("memory.approval")}
        value={prefs?.memoryApproval ?? "review"}
        onChange={(v) => void set({ payload: { approval: v as MemoryApproval }, reactivityKeys: ["preferences"] })}
        options={[
          { value: "review", label: t("memory.approvalReview") },
          { value: "undo", label: t("memory.approvalUndo") }
        ]}
      />
    </SettingRow>
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

// An owner's facts: a Section (its h2 under the page's h1, the audience hint beneath, as in Settings) holding one Rows
// card; inside one owner's tab the tab already names it, so the card stands alone. Limited (All, no search): the
// pinned ones first, then GROUP_LIMIT in all, and "See all" opens the owner's tab.
function OwnerGroup({ scope, facts, limited, title, hint, onDone }: { scope: string; facts: ReadonlyArray<Memory>; limited: boolean; title?: React.ReactNode; hint?: string | undefined; onDone: (r: Receipt) => void }) {
  const ordered = limited ? [...facts].sort((a, b) => Number(b.essential) - Number(a.essential)).slice(0, GROUP_LIMIT) : facts
  const rows = (
    <Rows>
      <ListPresence>
        {ordered.map((m) => (
          <PresenceRow key={m.id}>
            <FactRow memory={m} onDone={onDone} />
          </PresenceRow>
        ))}
      </ListPresence>
    </Rows>
  )
  if (!title) return rows
  return (
    <Section title={title} description={hint}>
      {rows}
      {ordered.length < facts.length && (
        <Button size="sm" variant="ghost" className="-ml-2.5 mt-2 self-start text-muted" onPress={() => go({ view: "memory", tab: scope })}>
          {t("memory.seeAll", { count: facts.length })}
          <ChevronRight className="size-3.5" />
        </Button>
      )}
    </Section>
  )
}

// "Teach it something about you": a sentence and Enter make an active memory about you.
function Teach() {
  const create = useMutation(mutations.createMemory)
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="relative"
      onSubmit={(e) => {
        e.preventDefault()
        if (!text.trim() || busy) return
        setBusy(true)
        create({ payload: { scope: "user", kind: "fact", title: "", text: text.trim() }, reactivityKeys: ["memories"] })
          .then(() => setText(""))
          .finally(() => setBusy(false))
      }}
    >
      <Plus aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-dim" />
      <Input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder={t("memory.teach")} aria-label={t("memory.teachLabel")} disabled={busy} className="pl-9" />
    </form>
  )
}

// Move ▾: to you, a project or a teammate's notes (not where it is).
// Where a fact can go: you, a project or a teammate's notes, never where it is.
const moveDestinations = (m: Memory, projects: ReadonlyArray<{ id: string }>, agents: ReadonlyArray<Parameters<typeof isTeammate>[0] & { id: string }>) =>
  ["user", ...projects.map((p) => `project:${p.id}`), ...agents.filter((a) => isTeammate(a)).map((a) => `agent:${a.id}`)].filter((s) => s !== m.scope)

function MoveMenu({ memory: m, onMove }: { memory: Memory; onMove: (scope: string) => void }) {
  const projects = useList(projectsAtom)
  const agents = useList(agentsAtom)
  const destinations = moveDestinations(m, projects, agents)
  return (
    <Menu
      label={t("memory.moveTo")}
      trigger={
        <Button size="sm" variant="ghost">
          {t("memory.move")}
        </Button>
      }
    >
      {destinations.map((s) => (
        <MenuItem key={s} icon={<ScopeIcon scope={s} agents={agents} />} onAction={() => onMove(s)}>
          {ownerName(s, projects, agents)}
        </MenuItem>
      ))}
    </Menu>
  )
}

// Under a reply: what an agent kept or wants to keep from this chat (or what the chat's learning proposed), with
// where it went. Built from the memory itself (chatId, agentId), so it's still there after a reload.
export function MemoryChip({ memory: m }: { memory: Memory }) {
  const projects = useList(projectsAtom)
  const agents = useList(agentsAtom)
  const update = useMutation(mutations.updateMemory)
  const [failed, setFailed] = useState(false)
  const agent = agents.find((a) => a.id === m.agentId)
  const patch = (payload: { state?: Memory["state"]; scope?: string }) =>
    void update({ params: { id: m.id }, payload, reactivityKeys: ["memories"] }).then(
      () => setFailed(false),
      () => setFailed(true)
    )
  const pending = m.state === "pending"
  const lead = pending ? (agent ? t("memory.chipWants", { name: agent.name }) : t("memory.chipProposed")) : agent ? t("memory.chipKept", { name: agent.name }) : t("memory.chipLearned")
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex w-full items-center gap-2 rounded-card border border-subtle bg-surface py-1 pr-1 pl-3 text-sm">
        <Brain className="size-3.5 shrink-0 text-muted" />
        <span className="line-clamp-2 min-w-0 flex-1" title={m.text}>
          <span className="text-muted">{`${lead} `}</span>
          <span className="text-secondary">{m.text}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-control px-2 py-0.5 text-xs text-muted">
          <ScopeIcon scope={m.scope} agents={agents} />
          {ownerName(m.scope, projects, agents)}
        </span>
        {pending && (
          <Button size="sm" variant="default" onPress={() => patch({ state: "active" })}>
            {t("memory.keep")}
          </Button>
        )}
        <MoveMenu memory={m} onMove={(scope) => patch({ scope })} />
        <Button size="sm" variant="ghost" onPress={() => patch({ state: "forgotten" })}>
          {pending ? t("inbox.discard") : t("memory.undo")}
        </Button>
      </div>
      {failed && (
        <p role="alert" className="text-sm text-danger">
          {t("knowledge.saveFailed")}
        </p>
      )}
    </div>
  )
}

// One memory: its sentence, who and where it came from, and what can be done with it here.
function FactRow({ memory: m, showScope = false, stale = false, onDone }: { memory: Memory; showScope?: boolean; stale?: boolean; onDone: (r: Receipt) => void }) {
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
  // Forget, Discard and Move take the fact off this list: the page shows a receipt that puts it back.
  const forget = (label: string) => void patch({ state: "forgotten" }).then(() => onDone({ id: m.id, label, text: m.text, undo: { state: m.state } }), () => {})
  const moveTo = (scope: string) => void patch({ scope }).then(() => onDone({ id: m.id, label: `${t("memory.movedTo")} ${ownerName(scope, projects, agents)}`, text: m.text, undo: { scope: m.scope } }), () => {})
  const move = <MoveMenu memory={m} onMove={moveTo} />
  const destinations = moveDestinations(m, projects, agents)
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
            <span className={cn("text-fg", m.state === "forgotten" && "text-muted line-through decoration-dim")}>{m.text}</span>
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
                    <span className="inline-flex items-center gap-1 text-secondary">
                      <Pin className="size-3" aria-hidden="true" />
                      {t("knowledge.essential")}
                    </span>
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
                <Button size="sm" variant="secondary" onPress={() => void patch({ state: "active" }).catch(() => {})}>
                  {target ? t("knowledge.applyImprovement") : t("memory.keep")}
                </Button>
                {!target && (
                  <Button size="sm" variant="ghost" onPress={() => setEditing(true)}>
                    {t("common.edit")}
                  </Button>
                )}
                {!target && move}
                <Button size="sm" variant="ghost" onPress={() => forget(t("memory.discarded"))}>
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
                <Button size="sm" variant="ghost" onPress={() => forget(t("memory.forgot"))}>
                  {t("knowledge.forget")}
                </Button>
              </>
            )}
            {m.state === "active" && !stale && (
              <>
                <Tooltip content={t("knowledge.essentialHint")}>
                  <IconButton size="sm" label={m.essential ? t("knowledge.notEssential") : t("knowledge.essential")} className={m.essential ? "text-secondary" : "text-dim"} onPress={() => void patch({ essential: !m.essential }).catch(() => {})}>
                    {m.essential ? <PinOff /> : <Pin />}
                  </IconButton>
                </Tooltip>
                <Menu
                  label={t("common.more")}
                  trigger={
                    <IconButton size="sm" label={t("common.more")} className="text-dim">
                      <MoreHorizontal />
                    </IconButton>
                  }
                >
                  <MenuItem icon={<Pencil />} onAction={() => setEditing(true)}>
                    {t("common.edit")}
                  </MenuItem>
                  <MenuSeparator />
                  {destinations.map((d) => (
                    <MenuItem key={d} icon={<ScopeIcon scope={d} agents={agents} />} onAction={() => moveTo(d)}>
                      {`${t("memory.moveTo")} ${ownerName(d, projects, agents)}`}
                    </MenuItem>
                  ))}
                  <MenuSeparator />
                  <MenuItem icon={<X />} onAction={() => forget(t("memory.forgot"))}>
                    {t("knowledge.forget")}
                  </MenuItem>
                </Menu>
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
