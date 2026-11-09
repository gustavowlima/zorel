// Pages: longer Markdown notes by scope (each one a .md file in the knowledge folder) that agents search and
// read with tools and write as versions. A list on the left (pinned first, a scope filter, search) and the page on
// the right: read as Markdown, edit in place, pin (its title then goes into every turn in that scope), and every
// save is a version you can restore.
import { isTeammate, type Page } from "@zorel/contracts"
import { formatAge, formatDate, t } from "@zorel/i18n"
import { useState } from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { agentsAtom, mutations, pagesAtom, pageVersionsAtom, projectsAtom, useList, useMutation, useReading } from "../client.ts"
import { scopeLabel } from "../labels.ts"
import { MemorySwitch } from "./memory.tsx"
import { go } from "../state.ts"
import { BookOpen, Button, ConfirmDialog, column, cx, EmptyState, Field, Input, Pin, PinOff, Plus, Rows, Screen, SearchInput, Select, Textarea, Trash2, Undo2 } from "@/ui"

const prose = "prose-chat leading-relaxed" // the same Markdown look as the chat

export function PagesView({ selected }: { selected?: string | undefined }) {
  const pages = useList(pagesAtom)
  const projects = useList(projectsAtom)
  const agents = useList(agentsAtom)
  const [query, setQuery] = useState("")
  const [scope, setScope] = useState("")
  const [creating, setCreating] = useState(false)
  const q = query.trim().toLowerCase()
  const list = pages
    .filter((p) => (!scope || p.scope === scope) && (!q || `${p.title} ${p.body}`.toLowerCase().includes(q)))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
  const scopes = [...new Set(pages.map((p) => p.scope))]
  const page = pages.find((p) => p.id === selected)
  return (
    // Memory's third view: the same title and switch as its facts, so Pages reads as a tab of Memory.
    <Screen
      title={t("memory.title")}
      subtitle={t("pages.subtitle", { count: pages.length })}
      bodyClassName="flex"
      actions={
        // New page first, so the switch and the search keep the place they have in Facts and Map.
        <>
          <Button size="sm" variant="secondary" onPress={() => setCreating(true)}>
            <Plus />
            {t("pages.new")}
          </Button>
          <MemorySwitch value="pages" />
          <SearchInput size="sm" className="w-56" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("common.search")} aria-label={t("common.search")} />
        </>
      }
    >
      <nav aria-label={t("pages.pages")} className="flex w-96 shrink-0 flex-col gap-3 overflow-y-auto border-r border-subtle py-4 pr-3 pl-4">
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
          {list.map((p) => (
            <li key={p.id}>
              <Button
                variant="ghost"
                onPress={() => {
                  setCreating(false)
                  go({ view: "pages", id: p.id })
                }}
                className={cx("h-auto w-full flex-col items-start gap-0.5 rounded-card border px-3 py-2.5 text-left font-normal whitespace-normal", p.id === selected ? "border-subtle bg-surface text-fg" : "border-transparent text-fg")}
              >
                <span className="flex w-full items-center gap-1.5 truncate font-medium">
                  {p.pinned && <Pin className="size-3 shrink-0 text-muted" />}
                  {p.title}
                </span>
                <span className="block w-full truncate text-sm text-muted">{[scopeLabel(p.scope, projects, agents), formatAge(p.updatedAt)].join(" · ")}</span>
              </Button>
            </li>
          ))}
          {list.length === 0 && <p className="px-2 py-6 text-center text-muted">{pages.length ? t("knowledge.noMatch") : t("pages.empty")}</p>}
        </ul>
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto">
        {creating ? (
          <NewPage onDone={(id) => {
            setCreating(false)
            if (id) go({ view: "pages", id })
          }} />
        ) : page ? (
          <PageView key={page.id} page={page} />
        ) : (
          <EmptyState icon={<BookOpen />} title={pages.length ? t("pages.select") : t("pages.empty")} {...(!pages.length && { hint: t("pages.emptyHint") })} />
        )}
      </div>
    </Screen>
  )
}

export function PageView({ page }: { page: Page }) {
  const projects = useList(projectsAtom)
  const agents = useList(agentsAtom)
  const update = useMutation(mutations.updatePage)
  const remove = useMutation(mutations.removePage)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(page.title)
  const [body, setBody] = useState(page.body)
  const [confirm, setConfirm] = useState(false)
  const save = () =>
    void update({ params: { id: page.id }, payload: { title: title.trim(), body }, reactivityKeys: ["pages"] }).then(() => setEditing(false))
  return (
    <article className={cx(column(), "gap-5")}>
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {editing ? (
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} aria-label={t("pages.titleField")} />
          ) : (
            <h2 className="text-lg font-semibold">{page.title}</h2>
          )}
          <p className="text-sm text-muted">{`${scopeLabel(page.scope, projects, agents)} · ${t("pages.updated", { age: formatAge(page.updatedAt) })}`}</p>
          {/* The page is a Markdown file: open it in any editor; edits there come back here. */}
          {page.file && (
            <p className="truncate font-mono text-xs text-dim" title={t("pages.fileHint")}>
              {`knowledge/${page.file}`}
            </p>
          )}
        </div>
        {!editing && (
          <div className="flex gap-1.5">
            <Button size="sm" variant="ghost" onPress={() => void update({ params: { id: page.id }, payload: { pinned: !page.pinned }, reactivityKeys: ["pages"] })}>
              {page.pinned ? <PinOff /> : <Pin />}
              {page.pinned ? t("pages.unpin") : t("pages.pin")}
            </Button>
            <Button size="sm" variant="secondary" onPress={() => setEditing(true)}>
              {t("common.edit")}
            </Button>
          </div>
        )}
      </div>
      {editing ? (
        <div className="flex flex-col gap-3">
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={18} maxLength={100_000} className="font-mono text-sm" aria-label={t("pages.body")} />
          <div className="flex gap-2">
            <Button variant="default" isDisabled={!title.trim()} onPress={save}>
              {t("common.save")}
            </Button>
            <Button
              variant="ghost"
              onPress={() => {
                setTitle(page.title)
                setBody(page.body)
                setEditing(false)
              }}
            >
              {t("common.cancel")}
            </Button>
            <span className="flex-1" />
            <Button variant="ghost" onPress={() => setConfirm(true)}>
              <Trash2 />
              {t("common.delete")}
            </Button>
          </div>
        </div>
      ) : (
        <div className={prose}>
          <Markdown remarkPlugins={[remarkGfm]}>{page.body}</Markdown>
        </div>
      )}
      {!editing && <Versions page={page} />}
      <ConfirmDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title={t("pages.deleteTitle", { title: page.title })}
        description={t("pages.deleteBody")}
        onConfirm={() => void remove({ params: { id: page.id }, reactivityKeys: ["pages"] }).then(() => go({ view: "pages" }))}
      />
    </article>
  )
}

// Every saved state, newest first; any older one can come back (as a new version).
function Versions({ page }: { page: Page }) {
  const versions = useReading(pageVersionsAtom(page.id)).items
  const restore = useMutation(mutations.restorePage)
  if (versions.length < 2) return null
  return (
    <section className="flex flex-col gap-2 border-t border-subtle pt-5">
      <h3 className="text-sm font-medium text-muted">{t("pages.versions")}</h3>
      <Rows>
        {versions.map((v, i) => (
          <div key={v.id} className="flex items-center gap-3 py-2">
            <span className="w-8 font-mono text-sm text-muted">{`v${v.n}`}</span>
            <span className="flex-1 text-sm text-secondary">{`${v.by === "you" ? t("agent.byYou") : v.by} · ${formatDate(v.at)} ${formatAge(v.at)}`}</span>
            {i === 0 ? (
              <span className="text-sm text-muted">{t("agent.current")}</span>
            ) : (
              <Button size="sm" variant="ghost" onPress={() => void restore({ params: { id: page.id, n: v.n }, reactivityKeys: ["pages"] })}>
                <Undo2 />
                {t("agent.restore")}
              </Button>
            )}
          </div>
        ))}
      </Rows>
    </section>
  )
}

export function NewPage({ onDone }: { onDone: (id?: string) => void }) {
  const projects = useList(projectsAtom)
  const agents = useList(agentsAtom)
  const create = useMutation(mutations.createPage)
  const [scope, setScope] = useState("user")
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  return (
    <form
      className={cx(column(), "gap-4")}
      onSubmit={(e) => {
        e.preventDefault()
        void create({ payload: { scope, title: title.trim(), body }, reactivityKeys: ["pages"] }).then((p) => onDone(p.id))
      }}
    >
      <h2 className="text-lg font-semibold">{t("pages.new")}</h2>
      <div className="flex flex-wrap gap-3">
        <Field label={t("pages.titleField")} className="min-w-64 flex-1">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} autoFocus />
        </Field>
        <Field label={t("knowledge.scope")} className="min-w-56">
          <Select
            value={scope}
            onChange={setScope}
            aria-label={t("knowledge.scope")}
            options={[
              { value: "user", label: t("scope.user") },
              ...projects.map((p) => ({ value: `project:${p.id}`, label: t("scope.project", { name: p.name }) })),
              ...agents.filter((a) => isTeammate(a)).map((a) => ({ value: `agent:${a.id}`, label: t("scope.agent", { name: a.name }) }))
            ]}
          />
        </Field>
      </div>
      <Field label={t("pages.body")} hint={t("pages.bodyHint")}>
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={14} maxLength={100_000} className="font-mono text-sm" />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" variant="default" isDisabled={!title.trim()}>
          {t("common.create")}
        </Button>
        <Button variant="ghost" onPress={() => onDone()}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  )
}
