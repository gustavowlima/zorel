// Projeto: brief (contexto estável de todo turno), agentes do projeto e chats.
import type { Agent, Project } from "@zero/contracts"
import { useEffect, useState, type FormEvent } from "react"
import { call } from "../api.ts"
import { DEFAULT_MODEL, go, useApp } from "../state.ts"
import { Badge, Button, Card, Field, Input, Page, Select, SidebarItem, Textarea } from "@/ui"
import { ModelPicker } from "./model-picker.tsx"
import { ToolsSection } from "./tools.tsx"

export function NewProjectView() {
  const { reload } = useApp()
  const [name, setName] = useState("")
  const [brief, setBrief] = useState("")
  const [busy, setBusy] = useState(false)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    call((c) => c.projects.create({ payload: { name: name.trim(), brief } }))
      .then(async (p) => {
        await reload()
        go({ view: "project", id: p.id })
      })
      .finally(() => setBusy(false))
  }

  return (
    <Page title="Novo projeto">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Nome">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required autoFocus />
        </Field>
        <Field label="Brief" hint="Contexto estável que todo agente e chat do projeto recebe: objetivo, stack, decisões, tom.">
          <Textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={8} maxLength={8000} />
        </Field>
        <Button type="submit" variant="default" size="lg" isDisabled={busy || !name.trim()} className="self-start">
          Criar projeto
        </Button>
      </form>
    </Page>
  )
}

export function ProjectView({ project }: { project: Project }) {
  const { data, reload } = useApp()
  const [name, setName] = useState(project.name)
  const [brief, setBrief] = useState(project.brief)
  const [newChatAgent, setNewChatAgent] = useState("")
  useEffect(() => {
    setName(project.name)
    setBrief(project.brief)
  }, [project])

  const agents = data.agents.filter((a) => a.projectId === project.id)
  const chats = data.chats.filter((c) => c.projectId === project.id)
  const memories = data.memories.filter((m) => m.scope === `project:${project.id}`)
  const dirty = name !== project.name || brief !== project.brief

  const save = (e: FormEvent) => {
    e.preventDefault()
    call((c) => c.projects.update({ params: { id: project.id }, payload: { name: name.trim(), brief } })).then(reload)
  }
  const newChat = () => {
    // "*": canal com todos os agentes do projeto; o primeiro é o líder.
    const team = newChatAgent === "*" ? agents : agents.filter((a) => a.id === newChatAgent)
    call((c) => c.chats.create({ payload: { projectId: project.id, agentIds: team.map((a) => a.id), model: team[0]?.model ?? DEFAULT_MODEL } })).then(async (chat) => {
      await reload()
      go({ view: "chat", id: chat.id })
    })
  }
  const remove = () => {
    if (!confirm(`Apagar o projeto "${project.name}" com seus agentes, chats e memórias?`)) return
    call((c) => c.projects.remove({ params: { id: project.id } })).then(async () => {
      await reload()
      go({ view: "home" })
    })
  }

  return (
    <Page title={project.name} actions={<Button variant="ghost" onPress={remove}>Apagar projeto</Button>}>
      <form onSubmit={save} className="flex flex-col gap-3">
        <Field label="Nome">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
        </Field>
        <Field label="Brief" hint="Entra no prompt de todo turno deste projeto.">
          <Textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={6} maxLength={8000} />
        </Field>
        {dirty && (
          <Button type="submit" variant="default" className="self-start" isDisabled={!name.trim()}>
            Salvar
          </Button>
        )}
      </form>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Chats</h2>
          <div className="flex gap-2">
            <Select className="w-44" value={newChatAgent} onChange={(e) => setNewChatAgent(e.target.value)} aria-label="Agente do novo chat">
              <option value="">Sem agente</option>
              {agents.length > 1 && <option value="*">Canal com todos</option>}
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
            <Button variant="default" onPress={newChat}>
              Novo chat
            </Button>
          </div>
        </div>
        {chats.length === 0 && <p className="text-sm text-muted">Nenhum chat ainda.</p>}
        {chats.map((c) => (
          <SidebarItem key={c.id} onClick={() => go({ view: "chat", id: c.id })} className="h-control">
            <span className="truncate">{c.title}</span>
            <span className="ml-auto text-xs text-dim">{c.model}</span>
          </SidebarItem>
        ))}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Agentes do projeto</h2>
        {agents.map((a) => (
          <AgentCard key={a.id} agent={a} />
        ))}
        <AgentCard projectId={project.id} />
      </section>

      <ToolsSection projectId={project.id} />

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Memórias do projeto</h2>
        <p className="text-sm text-muted">
          {memories.filter((m) => m.state === "active").length} ativas, {memories.filter((m) => m.state === "pending").length} esperando revisão.{" "}
          <button type="button" className="text-accent-text hover:underline" onClick={() => go({ view: "memories" })}>
            Ver memórias
          </button>
        </p>
      </section>
    </Page>
  )
}

// Sem `agent`: formulário de criação.
export function AgentCard({ agent, projectId = null }: { agent?: Agent; projectId?: string | null }) {
  const { reload } = useApp()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(agent?.name ?? "")
  const [instructions, setInstructions] = useState(agent?.instructions ?? "")
  const [model, setModel] = useState(agent?.model ?? DEFAULT_MODEL)

  const save = (e: FormEvent) => {
    e.preventDefault()
    const payload = { name: name.trim(), instructions, model }
    const req = agent ? call((c) => c.agents.update({ params: { id: agent.id }, payload })) : call((c) => c.agents.create({ payload: { ...payload, projectId } }))
    req.then(() => {
      setOpen(false)
      if (!agent) {
        setName("")
        setInstructions("")
      }
      return reload()
    })
  }
  const remove = () => agent && confirm(`Apagar o agente ${agent.name} e as memórias dele?`) && call((c) => c.agents.remove({ params: { id: agent.id } })).then(reload)

  if (!open)
    return agent ? (
      <Card className="flex items-center gap-3 py-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium">{agent.name}</div>
          <div className="truncate text-sm text-muted">{agent.instructions.split("\n")[0] || "Sem instruções"}</div>
        </div>
        <Badge>{agent.model}</Badge>
        <Button variant="ghost" size="sm" onPress={() => setOpen(true)}>
          Editar
        </Button>
      </Card>
    ) : (
      <Button className="self-start" onPress={() => setOpen(true)}>
        + Novo agente
      </Button>
    )

  return (
    <Card>
      <form onSubmit={save} className="flex flex-col gap-3">
        <Field label="Nome">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required autoFocus />
        </Field>
        <Field label="Modelo padrão" hint="Chats novos com este agente começam neste modelo; dá para trocar no chat.">
          <ModelPicker value={model} onChange={setModel} />
        </Field>
        <Field label="Instruções" hint="Papel, jeito de trabalhar, o que evitar.">
          <Textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={5} maxLength={8000} />
        </Field>
        <div className="flex gap-2">
          <Button type="submit" variant="default" isDisabled={!name.trim()}>
            {agent ? "Salvar" : "Criar agente"}
          </Button>
          <Button variant="ghost" onPress={() => setOpen(false)}>
            Cancelar
          </Button>
          {agent && (
            <Button variant="destructive" className="ml-auto" onPress={remove}>
              Apagar
            </Button>
          )}
        </div>
      </form>
    </Card>
  )
}
