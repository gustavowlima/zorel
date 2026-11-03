// Memories and skills: what the chats learned. Nothing enters the prompt by itself: pending only counts once approved.
import type { Memory } from "@zero/contracts"
import { useState, type FormEvent } from "react"
import { call } from "../api.ts"
import { scopeLabel, useApp } from "../state.ts"
import { Badge, Button, Card, Input, Page, Select, Textarea } from "@/ui"

export function MemoriesView() {
  const { data, reload } = useApp()
  const pending = data.memories.filter((m) => m.state === "pending")
  const active = data.memories.filter((m) => m.state === "active")
  const facts = active.filter((m) => m.kind === "fact")
  const skills = active.filter((m) => m.kind === "skill")
  const scopes = [...new Set(facts.map((m) => m.scope))]
  const forgotten = data.memories.filter((m) => m.state === "forgotten")

  return (
    <Page title="Memórias e skills">
      <p className="-mt-3 text-sm text-muted">
        Ao compactar uma conversa, o modelo propõe <b>memórias</b> (fatos duráveis) e <b>skills</b> (procedimentos que valem repetir). Aprovadas, entram no contexto de todo
        chat do mesmo escopo; o que não cabe no orçamento é buscado pela mensagem atual.
      </p>

      <section className="flex flex-col gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          Para revisar <Badge tone={pending.length ? "accent" : "neutral"}>{pending.length}</Badge>
        </h2>
        {pending.length === 0 && <p className="text-sm text-muted">Nada esperando revisão.</p>}
        {pending.map((m) => (
          <MemoryRow key={m.id} memory={m} label={scopeLabel(m.scope, data)} onChange={reload} />
        ))}
      </section>

      <NewMemory onCreated={reload} />

      {skills.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-semibold">Skills</h2>
          {skills.map((m) => (
            <MemoryRow key={m.id} memory={m} label={scopeLabel(m.scope, data)} onChange={reload} />
          ))}
        </section>
      )}

      {scopes.map((scope) => (
        <section key={scope} className="flex flex-col gap-2">
          <h2 className="font-semibold">{scopeLabel(scope, data)}</h2>
          {facts
            .filter((m) => m.scope === scope)
            .map((m) => (
              <MemoryRow key={m.id} memory={m} onChange={reload} />
            ))}
        </section>
      ))}

      {forgotten.length > 0 && (
        <details className="flex flex-col gap-2">
          <summary className="cursor-pointer font-semibold">Esquecidas ({forgotten.length})</summary>
          <p className="my-2 text-sm text-muted">Não entram no contexto e a consolidação é avisada para não propor de novo.</p>
          <div className="flex flex-col gap-2">
            {forgotten.map((m) => (
              <MemoryRow key={m.id} memory={m} label={scopeLabel(m.scope, data)} onChange={reload} />
            ))}
          </div>
        </details>
      )}
    </Page>
  )
}

function MemoryRow({ memory: m, label, onChange }: { memory: Memory; label?: string; onChange: () => void }) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(m.title)
  const [text, setText] = useState(m.text)
  const skill = m.kind === "skill"
  const patch = (payload: { state?: Memory["state"]; title?: string; text?: string }) => call((c) => c.memories.update({ params: { id: m.id }, payload })).then(onChange)

  return (
    <Card className="flex items-start gap-2 py-2">
      {editing ? (
        <form
          className="flex flex-1 flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            patch({ text: text.trim(), ...(skill ? { title: title.trim() } : {}) }).then(() => setEditing(false))
          }}
        >
          {skill && <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} aria-label="Título" />}
          {skill ? <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} maxLength={4000} autoFocus /> : <Input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} autoFocus />}
          <Button type="submit" size="sm" className="self-start" isDisabled={!text.trim() || (skill && !title.trim())}>
            Salvar
          </Button>
        </form>
      ) : (
        <div className="min-w-0 flex-1">
          {skill ? (
            <details>
              <summary className="cursor-pointer">
                <Badge tone="accent">skill</Badge> <span className="font-medium">{m.title}</span>
              </summary>
              <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-secondary">{m.text}</pre>
            </details>
          ) : (
            <div>{m.text}</div>
          )}
          {label && <div className="text-xs text-dim">{label}</div>}
        </div>
      )}
      {m.state === "pending" && (
        <Button size="sm" variant="default" onPress={() => patch({ state: "active" })}>
          Aprovar
        </Button>
      )}
      {m.state === "forgotten" ? (
        <Button size="sm" variant="ghost" onPress={() => patch({ state: "active" })}>
          Restaurar
        </Button>
      ) : (
        <>
          {!editing && (
            <Button size="sm" variant="ghost" onPress={() => setEditing(true)}>
              Editar
            </Button>
          )}
          <Button size="sm" variant="ghost" onPress={() => patch({ state: "forgotten" })}>
            {m.state === "pending" ? "Descartar" : "Esquecer"}
          </Button>
        </>
      )}
    </Card>
  )
}

function NewMemory({ onCreated }: { onCreated: () => void }) {
  const { data } = useApp()
  const [scope, setScope] = useState("user")
  const [kind, setKind] = useState<Memory["kind"]>("fact")
  const [title, setTitle] = useState("")
  const [text, setText] = useState("")
  const skill = kind === "skill"
  const submit = (e: FormEvent) => {
    e.preventDefault()
    call((c) => c.memories.create({ payload: { scope, kind, title: skill ? title.trim() : "", text: text.trim() } })).then(() => {
      setText("")
      setTitle("")
      onCreated()
    })
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Select
          className="w-32"
          value={kind}
          onChange={(v) => setKind(v as Memory["kind"])}
          options={[
            { value: "fact", label: "Memória" },
            { value: "skill", label: "Skill" }
          ]}
          aria-label="Tipo"
        />
        <Select
          className="w-56"
          value={scope}
          onChange={setScope}
          options={[
            { value: "user", label: "Você (todos os chats)" },
            ...data.projects.map((p) => ({ value: `project:${p.id}`, label: `Projeto · ${p.name}` })),
            ...data.agents.map((a) => ({ value: `agent:${a.id}`, label: `Agente · ${a.name}` }))
          ]}
          aria-label="Escopo"
        />
        {skill ? (
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título do procedimento" maxLength={80} />
        ) : (
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Escrever uma memória…" maxLength={500} />
        )}
        <Button type="submit" isDisabled={!text.trim() || (skill && !title.trim())}>
          Adicionar
        </Button>
      </div>
      {skill && <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} maxLength={4000} placeholder="Passo a passo" />}
    </form>
  )
}
