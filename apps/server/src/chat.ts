// Um turno de chat: grava a mensagem do usuário e decide quem responde (mencionados com @, ou o líder).
// Cada resposta monta o próprio contexto, roda o engine em streaming com as ferramentas permitidas
// (aprovação humana quando a política pede), é gravada mesmo se interrompida, e pode passar a vez a
// outro agente mencionando-o, até MAX_DEPTH respostas seguidas. Quando a janela enche, consolida em background.
import type { Agent, Chat, SendEvent, SendInput, Step } from "@zero/contracts"
import { Context, Data, Effect, Layer, Queue, Stream } from "effect"
import { join } from "node:path"
import {
  buildTurn, CONSOLIDATION_SYSTEM, consolidationPrompt, MAX_AFTER, MAX_DEPTH, mentioned, parseConsolidation,
  pinned, RETRIEVED, scopesOf, SKILL_BODIES, WINDOW
} from "./context.ts"
import { Store, type Repository } from "./db.ts"
import { Engines, type EngineEvent, type TurnTools } from "./engines.ts"
import { exposedName, needsApproval, resultText, textResult, Tools, type Gateway, type Hub, type Session, type ToolDef } from "./tools.ts"

export class NotFound extends Data.TaggedError("NotFound")<{}> {}
export class Busy extends Data.TaggedError("Busy")<{}> {}

// Onde as CLIs rodam: diretórios vazios por chat, dentro da pasta de dados.
export class DataDir extends Context.Service<DataDir, string>()("DataDir") {
  static layer = (dir: string) => Layer.succeed(DataDir, dir)
}

const MAX_MENTIONS = 3
const MAX_PENDING = 20 // propostas esperando revisão; acima disso a consolidação só atualiza o resumo
const APPROVAL_MS = 10 * 60_000

// ponytail: travas e aprovações em memória, um processo de server; mover para o banco se houver mais de um.
const turning = new Set<string>()
const consolidating = new Set<string>()
const approvals = new Map<string, (approve: boolean) => void>()

// POST /api/approvals/:id. false se não existe (já decidida, expirada ou turno encerrado).
export function decide(id: string, approve: boolean): boolean {
  const resolve = approvals.get(id)
  resolve?.(approve)
  return !!resolve
}

const members = (store: Repository, chat: Chat) =>
  Effect.forEach(chat.agentIds, store.agent).pipe(Effect.map((xs) => xs.filter((a): a is Agent => !!a)))

// ---------- ferramentas do turno ----------

interface ToolsOfTurn {
  readonly tools: TurnTools | undefined
  readonly steps: Step[]
  readonly close: () => void
}

// Lista as ferramentas permitidas dos servidores do chat e abre uma sessão no gateway.
// `emit` empurra eventos (passos e pedidos de aprovação) para o stream da resposta.
async function openTools(store: Repository, hub: Hub, gateway: Gateway, chat: Chat, emit: (e: SendEvent) => void): Promise<ToolsOfTurn> {
  const steps: Step[] = []
  const record = (step: Step) => {
    steps.push(step)
    emit({ type: "tool", step })
  }
  const pendingHere = new Set<string>()
  const routes = new Map<string, { server: string; tool: string; approve: boolean }>()
  const defs: ToolDef[] = []
  for (const s of await Effect.runPromise(store.mcpServersFor(chat.projectId))) {
    const listed = await hub.tools(s).catch((e: unknown) => {
      record({ tool: s.name, args: "", status: "error", result: `Não conectou: ${e instanceof Error ? e.message : e}` })
      return []
    })
    for (const t of listed) {
      if (s.mode === "read" && t.cls !== "read") continue
      const name = exposedName(s.name, t.name)
      routes.set(name, { server: s.id, tool: t.name, approve: needsApproval(s.mode, t.cls) })
      defs.push({ name, description: t.description, inputSchema: t.inputSchema })
    }
  }
  if (!defs.length) return { tools: undefined, steps, close: () => {} }

  const call: Session["call"] = async (name, args) => {
    const route = routes.get(name)
    const server = route && (await Effect.runPromise(store.mcpServer(route.server)))
    if (!route || !server) return textResult(`Ferramenta não permitida: ${name}`, true)
    const shown = JSON.stringify(args).slice(0, 300)
    if (route.approve) {
      const id = crypto.randomUUID()
      pendingHere.add(id)
      emit({ type: "approval", id, tool: name, args: JSON.stringify(args, null, 2).slice(0, 4000) })
      const ok = await new Promise<boolean>((resolve) => {
        approvals.set(id, resolve)
        setTimeout(() => resolve(false), APPROVAL_MS)
      })
      approvals.delete(id)
      pendingHere.delete(id)
      if (!ok) {
        record({ tool: name, args: shown, status: "refused", result: "" })
        return textResult("O usuário recusou esta ação. Não tente de novo sem pedir.", true)
      }
    }
    const r = await hub.call(server, route.tool, args).catch((e: unknown) => textResult(String(e instanceof Error ? e.message : e), true))
    record({ tool: name, args: shown, status: r.isError ? "error" : "ok", result: resultText(r).slice(0, 300) })
    return r
  }
  const session = gateway.open({ tools: defs, call })
  return {
    tools: { url: session.url, defs, call },
    steps,
    close: () => {
      session.close()
      for (const id of pendingHere) approvals.get(id)?.(false) // turno acabou: pedidos abertos viram recusa
    }
  }
}

// ---------- contexto ----------

const prepare = (store: Repository, chat: Chat, agent: Agent | undefined, model: string, dataDir: string, tools: TurnTools | undefined) =>
  Effect.gen(function* () {
    const scopes = scopesOf(chat, agent?.id ?? null)
    const fixed = pinned(yield* store.activeMemories(scopes))
    const messages = yield* store.messagesAfter(chat.id, chat.summaryUntil)
    const last = messages.at(-1)?.text ?? ""
    return buildTurn({
      chat,
      model,
      project: chat.projectId ? yield* store.project(chat.projectId) : undefined,
      agent,
      members: yield* members(store, chat),
      pinned: fixed,
      retrieved: yield* store.searchMemories(scopes, last, fixed.map((m) => m.id), RETRIEVED),
      skills: { all: yield* store.activeMemories(scopes, "skill"), relevant: yield* store.searchMemories(scopes, last, [], SKILL_BODIES, "skill") },
      messages,
      cwd: join(dataDir, "runs", chat.id),
      tools
    })
  })

// ---------- consolidação (aprendizado contínuo) ----------

const collect = (events: Stream.Stream<EngineEvent>) =>
  Stream.runFold(events, () => ({ text: "", error: undefined as string | undefined }), (acc, ev) =>
    ev.type === "text" ? { ...acc, text: acc.text + ev.delta } : ev.type === "error" ? { ...acc, error: ev.message } : acc
  )

// Dobra o que sai da janela no resumo e propõe memórias e skills (pendentes até o usuário aprovar).
// O escopo "agent" vai para o líder do chat. force: resume tudo até agora ("Compactar").
export const consolidate = Effect.fn("consolidate")(function* (chatId: string, force = false) {
  const store = yield* Store
  const engines = yield* Engines
  const dataDir = yield* DataDir
  const chat = yield* store.chat(chatId)
  if (!chat) return yield* new NotFound()
  if (consolidating.has(chatId)) return yield* new Busy()
  const after = (yield* store.messagesAfter(chat.id, chat.summaryUntil)).filter((m) => m.text.trim())
  const chunk = force ? after : after.length > MAX_AFTER ? after.slice(0, after.length - WINDOW) : []
  if (!chunk.length) return chat

  consolidating.add(chatId)
  return yield* Effect.gen(function* () {
    const lead = chat.agentIds[0] ?? null
    const scopes = scopesOf(chat, lead)
    const agents = yield* members(store, chat)
    const existing = yield* store.activeMemories(scopes)
    const skills = yield* store.activeMemories(scopes, "skill")
    const forgotten = yield* store.forgottenMemories(scopes)
    const result = yield* collect(
      engines.run({
        model: process.env.ZERO_MEMORY_MODEL || chat.model,
        system: CONSOLIDATION_SYSTEM,
        messages: [{
          role: "user",
          text: consolidationPrompt({
            summary: chat.summary, chunk, existing, skills, forgotten,
            hasProject: !!chat.projectId, hasAgent: !!lead, names: (id) => agents.find((a) => a.id === id)?.name ?? "assistente"
          })
        }],
        cwd: join(dataDir, "runs", "_memory")
      })
    )
    const allowed = ["user", ...(chat.projectId ? ["project"] : []), ...(lead ? ["agent"] : [])]
    const parsed = result.error ? undefined : parseConsolidation(result.text, allowed)
    if (!parsed) {
      yield* Effect.logWarning("consolidação falhou", result.error ?? result.text.slice(0, 300))
      return chat
    }
    const scopeOf = { user: "user", project: `project:${chat.projectId}`, agent: `agent:${lead}` }
    yield* store.setSummary(chat.id, parsed.summary, chunk.at(-1)!.at)
    // Teto de pendentes: a revisão humana é o gargalo; acima dele, propostas novas são descartadas.
    const proposals = [
      ...parsed.memories.map((m) => ({ scope: scopeOf[m.scope], kind: "fact" as const, title: "", text: m.text })),
      ...parsed.skills.map((s) => ({ scope: scopeOf[s.scope], kind: "skill" as const, title: s.title, text: s.text }))
    ]
    const room = Math.max(0, MAX_PENDING - (yield* store.pendingCount(scopes)))
    if (proposals.length > room) yield* Effect.logInfo("propostas acima do teto de pendentes; excedentes descartadas", { room, proposed: proposals.length })
    for (const p of proposals.slice(0, room)) yield* store.addMemory({ ...p, state: "pending", origin: "auto", chatId: chat.id })
    return (yield* store.chat(chat.id))!
  }).pipe(Effect.ensuring(Effect.sync(() => consolidating.delete(chatId))))
})

// ---------- turno ----------

export const send = Effect.fn("send")(function* (chatId: string, input: SendInput) {
  const store = yield* Store
  const engines = yield* Engines
  const dataDir = yield* DataDir
  const { hub, gateway } = yield* Tools
  const services = yield* Effect.context<Store | Engines | DataDir>()
  let chat = yield* store.chat(chatId)
  if (!chat) return yield* new NotFound()
  if (turning.has(chatId)) return yield* new Busy()
  // ponytail: trava em memória antes do primeiro yield de escrita; o runtime de turnos (fila no banco) substitui.
  turning.add(chatId)

  if (input.model && input.model !== chat.model) chat = (yield* store.updateChat(chatId, { model: input.model }))!
  if (chat.title === "Novo chat") chat = (yield* store.updateChat(chatId, { title: input.text.replace(/\s+/g, " ").slice(0, 60) }))!
  const user = yield* store.addMessage({ chatId, role: "user", agentId: null, text: input.text, model: null, error: null, steps: [], inputTokens: 0, outputTokens: 0 })
  const current = chat
  const team = yield* members(store, current)
  const lead = team[0]

  // Uma resposta de um agente (ou do assistente sem agente). `onText` recebe o texto final, para o encadeamento.
  // O líder usa o modelo do chat (o que o usuário escolheu); os outros membros usam o modelo deles.
  const reply = (agent: Agent | undefined, onText: (text: string) => void) =>
    Stream.callback<SendEvent>((q) => {
      const emit = (e: SendEvent) => void Queue.offerUnsafe(q, e)
      let model = agent?.model ?? current.model
      const acc = { text: "", error: undefined as string | undefined, usage: { inputTokens: 0, outputTokens: 0 }, steps: [] as Step[], saved: false }
      const save = Effect.suspend(() => {
        if (acc.saved) return Effect.void
        acc.saved = true
        return store.addMessage({ chatId, role: "assistant", agentId: agent?.id ?? null, text: acc.text, model, error: acc.error ?? null, steps: acc.steps, ...acc.usage }).pipe(
          Effect.map((message) => {
            onText(acc.text)
            emit({ type: "done", message })
            return message
          })
        )
      })
      return Effect.gen(function* () {
        if (!agent || agent.id === lead?.id) model = (yield* store.chat(chatId))!.model
        emit({ type: "start", agentId: agent?.id ?? null, model })
        const opened = yield* Effect.promise(() => openTools(store, hub, gateway, current, emit))
        acc.steps = opened.steps
        yield* Effect.addFinalizer(() => Effect.sync(opened.close))
        const turn = yield* prepare(store, (yield* store.chat(chatId))!, agent, model, dataDir, opened.tools)
        yield* engines.run(turn).pipe(
          Stream.runForEach((ev) =>
            Effect.sync(() => {
              if (ev.type === "text") {
                acc.text += ev.delta
                emit(ev)
              }
              else if (ev.type === "done") acc.usage = ev.usage
              else acc.error = ev.message
            })
          )
        )
        yield* save
        yield* Queue.end(q)
      }).pipe(
        // Cliente desconectou ou algo quebrou no meio: guarda o que já veio.
        Effect.onExit((exit) => {
          if (exit._tag !== "Failure") return Effect.void
          acc.error ??= "interrompido"
          return save
        })
      )
    })

  // Encadeia: cada resposta pode mencionar outros membros, que respondem em seguida.
  const chain = (queue: ReadonlyArray<Agent | undefined>, depth: number): Stream.Stream<SendEvent> => {
    if (!queue.length) return Stream.empty
    const [agent, ...rest] = queue
    let said = ""
    return reply(agent, (t) => (said = t)).pipe(
      Stream.concat(
        Stream.suspend(() => {
          const next = mentioned(said, team.filter((a) => a.id !== agent?.id && !rest.includes(a))).slice(0, MAX_MENTIONS)
          if (next.length && depth + 1 >= MAX_DEPTH)
            return Stream.make<[SendEvent]>({ type: "error", message: `Parei a conversa entre agentes depois de ${MAX_DEPTH} respostas seguidas. Mande uma mensagem para continuar.` }).pipe(
              Stream.concat(chain(rest, depth))
            )
          return chain([...rest, ...next], next.length ? depth + 1 : depth)
        })
      )
    )
  }

  const first = mentioned(input.text, team).slice(0, MAX_MENTIONS)
  return Stream.make<[SendEvent]>({ type: "user", message: user }).pipe(
    Stream.concat(chain(first.length ? first : [lead], 0)),
    Stream.ensuring(
      Effect.sync(() => {
        turning.delete(chatId)
        Effect.runForkWith(services)(consolidate(chatId).pipe(Effect.ignore))
      })
    )
  )
})
