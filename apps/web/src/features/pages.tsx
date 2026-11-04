// Knowledge pages (phase 3b; a reference app's wiki as reference): longer Markdown notes by scope that agents search and
// read with tools and write as versions. Read as Markdown; edit in place; pin (its title then goes into every turn
// in that scope); every save is a version you can restore.
import type { Page } from "@zero/contracts"
import { formatAge, formatDate, t } from "@zero/i18n"
import { useState } from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { agentsAtom, mutations, pageVersionsAtom, projectsAtom, useList, useMutation, useReading } from "../client.ts"
import { scopeLabel } from "../labels.ts"
import { go } from "../state.ts"
import { Button, ConfirmDialog, Field, Input, Pin, PinOff, Rows, Select, Textarea, Trash2, Undo2 } from "@/ui"

const prose = "prose-chat leading-relaxed" // the same Markdown look as the chat

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
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-10 py-8">
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-xs font-semibold tracking-wide text-accent-text uppercase">{t("pages.page")}</span>
          {editing ? (
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} aria-label={t("pages.titleField")} />
          ) : (
            <h2 className="text-lg font-semibold">{page.title}</h2>
          )}
          <p className="text-sm text-muted">{`${scopeLabel(page.scope, projects, agents)} · ${t("pages.updated", { age: formatAge(page.updatedAt) })}`}</p>
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
        onConfirm={() => void remove({ params: { id: page.id }, reactivityKeys: ["pages"] }).then(() => go({ view: "knowledge" }))}
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
      className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-10 py-8"
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
              ...agents.map((a) => ({ value: `agent:${a.id}`, label: t("scope.agent", { name: a.name }) }))
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
