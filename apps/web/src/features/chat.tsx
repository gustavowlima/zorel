// Chat/canal: segue os eventos do runtime (snapshot + ao vivo), então o turno continua se a aba fechar e reabrir.
// Respostas uma por agente, aprovação de ferramentas no meio do turno, troca de modelo e membros, compactação manual.
import type { Agent, Chat, Message } from "@zero/contracts"
import { type Approval, type ChatEvent, isInterruption, type WorkStep } from "@zero/contracts/events"
import { useEffect, useRef, useState, type FormEvent } from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { call, decideApproval, interruptChat, sendMessage, subscribeChat } from "../api.ts"
import { go, useApp } from "../state.ts"
import { Badge, Button, Card, ConfirmButton, cx, Select, Textarea, Tooltip } from "@/ui"
import { ModelPicker } from "./model-picker.tsx"

type Live = { turnId: string; agentId: string | null; model: string; text: string; steps: WorkStep[] }

const handle = (a: Agent) => a.name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "")

export function ChatView({ chat }: { chat: Chat }) {
  const { data, reload } = useApp()
  const [messages, setMessages] = useState<Message[]>([])
  const [live, setLive] = useState<Live>()
  const [busy, setBusy] = useState(false)
  const [approvals, setApprovals] = useState<ReadonlyArray<Approval>>([])
  const [text, setText] = useState("")
  const [error, setError] = useState<string>()
  const [compacting, setCompacting] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)
  const reloadRef = useRef(reload)
  reloadRef.current = reload

  useEffect(() => {
    setMessages([])
    setLive(undefined)
    setApprovals([])
    setError(undefined)
    const onEvent = (ev: ChatEvent) => {
      switch (ev._tag) {
        case "snapshot": {
          const s = ev.snapshot
          const running = s.turns.find((t) => t.state === "running")
          setError(undefined) // (re)conectou: some o aviso de conexão caída
          setMessages([...s.messages])
          setApprovals(s.approvals)
          setBusy(s.turns.length > 0)
          setLive(
            running && {
              turnId: running.id, agentId: running.agentId, model: running.model,
              text: s.partial.find((p) => p.turnId === running.id)?.text ?? "", steps: s.steps.filter((x) => x.turnId === running.id)
            }
          )
          return
        }
        case "message":
          return setMessages((m) => [...m, ev.message])
        case "queued":
          return setBusy(true)
        case "turn-started":
          return setLive({ turnId: ev.turn.id, agentId: ev.turn.agentId, model: ev.turn.model, text: "", steps: [] })
        case "text":
          return setLive((l) => (l?.turnId === ev.turnId ? { ...l, text: l.text + ev.delta } : l))
        case "step-started":
        case "step-finished":
          return setLive((l) => (l?.turnId === ev.step.turnId ? { ...l, steps: [...l.steps.filter((x) => x.id !== ev.step.id), ev.step] } : l))
        case "approval":
          return setApprovals((a) => [...a, ev.approval])
        case "approval-resolved":
          return setApprovals((a) => a.filter((x) => x.id !== ev.approvalId))
        case "turn-completed":
        case "turn-failed":
        case "interrupted": {
          const message = ev.message
          setLive((l) => (l?.turnId === ev.turn.id ? undefined : l))
          if (message) setMessages((m) => [...m, message]) // erro do engine vem dentro da mensagem salva
          return
        }
        case "status":
          setBusy(ev.status.state !== "idle")
          if (ev.status.state === "idle") void reloadRef.current() // título, consolidação e memórias pendentes podem ter mudado
          return
      }
    }
    return subscribeChat(chat.id, onEvent, (e) => setError(String(e)))
  }, [chat.id])
  // biome-ignore lint/correctness/useExhaustiveDependencies: as dependências são o gatilho (rolar quando chega conteúdo)
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" }) // em Chromes novos devolve Promise: não pode virar o cleanup
  }, [messages, live, approvals])

  const project = data.projects.find((p) => p.id === chat.projectId)
  const team = chat.agentIds.flatMap((id) => data.agents.find((a) => a.id === id) ?? [])
  const candidates = data.agents.filter((a) => (a.projectId === null || a.projectId === chat.projectId) && !chat.agentIds.includes(a.id))
  const agentName = (id: string | null) => data.agents.find((a) => a.id === id)?.name ?? "Assistente"

  const update = (payload: { model?: string; agentIds?: ReadonlyArray<string> }) =>
    call((c) => c.chats.update({ params: { id: chat.id }, payload })).then(reload, (e) => setError(String(e)))

  // Com o chat ocupado, a mensagem entra na fila do runtime e é respondida depois.
  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    const input = text.trim()
    if (!input) return
    setText("")
    setError(undefined)
    sendMessage(chat.id, input).catch((err) => {
      setError(String(err instanceof Error ? err.message : err))
      setText((t) => t || input)
    })
  }

  const decide = (a: Approval, approve: boolean) => {
    setApprovals((list) => list.filter((x) => x.id !== a.id))
    decideApproval(a.id, approve ? "approved" : "denied").catch(() => setError("Esse pedido já expirou."))
  }

  const compact = () => {
    setCompacting(true)
    call((c) => c.chats.consolidate({ params: { id: chat.id } }))
      .then(reload, () => setError("Não deu para compactar agora (já está compactando ou o modelo falhou)."))
      .finally(() => setCompacting(false))
  }

  const remove = () => {
    call((c) => c.chats.remove({ params: { id: chat.id } })).then(async () => {
      await reload()
      go(chat.projectId ? { view: "project", id: chat.projectId } : { view: "home" })
    })
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-start gap-2 border-b border-subtle px-4 py-3">
        <div className="mr-auto min-w-0 pt-1.5">
          <div className="truncate font-semibold">{chat.title}</div>
          {project && (
            <button type="button" onClick={() => go({ view: "project", id: project.id })} className="text-sm text-muted hover:text-fg">
              {project.name}
            </button>
          )}
        </div>
        <label className="flex flex-col gap-1 text-xs text-dim">
          {team[0] ? `Modelo de ${team[0].name}` : "Modelo"}
          <ModelPicker className="w-60" value={chat.model} onChange={(model) => update({ model })} />
        </label>
        <div className="flex gap-1 pt-5">
          <Tooltip content="Resume a conversa até aqui e propõe memórias e skills">
            <Button variant="ghost" onPress={compact} isDisabled={compacting || busy}>
              {compacting ? "Compactando…" : "Compactar"}
            </Button>
          </Tooltip>
          <ConfirmButton variant="ghost" title="Apagar este chat?" description="Todas as mensagens serão apagadas." onConfirm={remove}>
            Apagar
          </ConfirmButton>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-1.5 border-b border-subtle px-4 py-2 text-sm">
        <span className="text-dim">Membros:</span>
        {team.length === 0 && <span className="text-muted">nenhum agente (assistente padrão)</span>}
        {team.map((a, i) => (
          <span key={a.id} className="inline-flex items-center gap-1 rounded-full bg-control py-0.5 pr-1 pl-2.5" title={i === 0 ? "Líder: responde quando ninguém é mencionado" : a.model}>
            {i === 0 && <span className="text-accent-text">★</span>}@{handle(a)}
            <button type="button" aria-label={`Tirar ${a.name}`} className="rounded-full px-1 text-dim hover:text-fg" onClick={() => update({ agentIds: chat.agentIds.filter((x) => x !== a.id) })}>
              ×
            </button>
          </span>
        ))}
        {candidates.length > 0 && (
          <Select
            size="sm"
            className="w-40"
            value=""
            placeholder="+ agente"
            onChange={(id) => update({ agentIds: [...chat.agentIds, id] })}
            options={candidates.map((a) => ({ value: a.id, label: a.name }))}
            aria-label="Adicionar agente"
          />
        )}
        {team.length > 1 && <span className="text-xs text-dim">Mencione com @ para escolher quem responde; agentes passam a vez mencionando uns aos outros.</span>}
      </div>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
          {chat.summary && (
            <details className="rounded-card border border-subtle bg-surface px-3 py-2 text-sm text-secondary">
              <summary className="cursor-pointer text-muted">Resumo do que veio antes (é isso que o modelo vê das mensagens antigas)</summary>
              <p className="mt-2 whitespace-pre-wrap">{chat.summary}</p>
            </details>
          )}
          {messages.length === 0 && !busy && <div className="py-16 text-center text-muted">Comece a conversa. Você pode trocar o modelo a qualquer momento.</div>}
          {messages.map((m) => (
            // Já coberta pelo resumo: o modelo não vê mais o texto literal.
            <div key={m.id} className={cx("flex flex-col", m.at <= chat.summaryUntil && "opacity-50")} title={m.at <= chat.summaryUntil ? "Coberta pelo resumo" : undefined}>
              <Bubble message={m} author={agentName(m.agentId)} multi={team.length > 1} />
            </div>
          ))}
          {live && (
            <div className="flex flex-col gap-1">
              {live.steps.map((s) => (
                <div key={s.id} className="text-xs text-muted">
                  <Badge tone={s.status === "ok" ? "neutral" : s.status === "error" ? "danger" : s.status === "refused" || s.status === "waiting" ? "warning" : "accent"}>{s.status}</Badge> <code>{s.title}</code>
                </div>
              ))}
              <Bubble message={{ role: "assistant", text: live.text || "…", model: live.model, error: null, steps: [] }} author={agentName(live.agentId)} multi={team.length > 1} live />
            </div>
          )}
          {approvals.map((a) => (
            <Card key={a.id} className="flex flex-col gap-2 border-strong">
              <div className="text-sm">
                <span className="font-medium">{agentName(a.agentId)}</span> quer usar <code className="text-accent-text">{a.tool}</code>
              </div>
              <pre className="max-h-48 overflow-auto rounded-control bg-control p-2 text-xs">{a.args}</pre>
              <div className="flex gap-2">
                <Button variant="default" size="sm" onPress={() => decide(a, true)}>
                  Aprovar
                </Button>
                <Button variant="destructive" size="sm" onPress={() => decide(a, false)}>
                  Recusar
                </Button>
              </div>
            </Card>
          ))}
          {error && <div className="rounded-card bg-danger-soft p-3 text-sm text-danger">{error}</div>}
          <div ref={bottom} />
        </div>
      </div>

      <form onSubmit={submit} className="mx-auto flex w-full max-w-3xl items-end gap-2 px-4 pb-4">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return
            e.preventDefault()
            void submit()
          }}
          rows={Math.min(8, Math.max(2, text.split("\n").length))}
          placeholder={team.length > 1 ? `Mensagem (@${handle(team[1]!)} para chamar alguém específico)` : "Mensagem (Enter envia, Shift+Enter quebra linha)"}
          aria-label="Mensagem"
          autoFocus
        />
        {busy ? (
          <>
            <Button type="submit" variant="secondary" size="lg" isDisabled={!text.trim()}>
              Na fila
            </Button>
            <Button size="lg" onPress={() => void interruptChat(chat.id).catch((e) => setError(String(e)))}>
              Parar
            </Button>
          </>
        ) : (
          <Button type="submit" variant="default" size="lg" isDisabled={!text.trim()}>
            Enviar
          </Button>
        )}
      </form>
    </div>
  )
}

const interrupted = isInterruption
const stepTone = { ok: "neutral", error: "danger", refused: "warning" } as const

function Bubble({ message: m, author, multi, live }: { message: Pick<Message, "role" | "text" | "model" | "error" | "steps"> & Partial<Message>; author: string; multi: boolean; live?: boolean }) {
  if (m.role === "user") return <div className="max-w-[85%] self-end whitespace-pre-wrap rounded-card bg-surface px-3 py-2">{m.text}</div>
  return (
    <div className="flex flex-col gap-1">
      {multi && <div className="text-sm font-medium text-accent-text">{author}</div>}
      {m.steps.length > 0 && (
        <div className="flex flex-col gap-1">
          {m.steps.map((s, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: passos de uma mensagem são imutáveis e podem repetir a mesma ferramenta
            <details key={i} className="text-xs text-muted">
              <summary className="cursor-pointer">
                <Badge tone={stepTone[s.status]}>{s.status === "ok" ? "usou" : s.status === "refused" ? "recusada" : "falhou"}</Badge> <code>{s.tool}</code>
              </summary>
              <pre className="mt-1 overflow-auto rounded-control bg-control p-2">{`${s.args}\n→ ${s.result}`}</pre>
            </details>
          ))}
        </div>
      )}
      <div className={cx("prose-chat leading-relaxed", live && "opacity-90")}>
        <Markdown remarkPlugins={[remarkGfm]}>{m.text}</Markdown>
      </div>
      <div className="flex items-center gap-2 text-xs text-dim">
        {m.model && <span>{m.model}</span>}
        {!live && m.inputTokens ? <span>{`${m.inputTokens.toLocaleString()} → ${m.outputTokens?.toLocaleString()} tokens`}</span> : null}
        {m.error && <Badge tone={interrupted(m.error) ? "warning" : "danger"}>{interrupted(m.error) ? "interrompido" : "erro"}</Badge>}
      </div>
      {m.error && !interrupted(m.error) && <div className="whitespace-pre-wrap text-sm text-danger">{m.error}</div>}
    </div>
  )
}
