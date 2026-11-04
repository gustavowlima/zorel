// Builds what a turn sends to the engine. Nothing accumulates in the CLI session: every turn
// the context is rebuilt in layers, from most stable to most volatile (good for prompt caching):
//   base → agent → channel → user memories → project (brief + memories) → agent memories
//   → skills → chat summary → memories retrieved by the current message → latest messages.
// Each layer has a budget; what doesn't fit stays searchable (FTS) and comes back when relevant.
// Rolling summary + memories + proposed skills model derived from a reference app (Apache-2.0), see NOTICE.
import { join } from "node:path"
import type { Agent, Chat, Memory, Message, Project } from "@zorel/contracts"
import { normalize } from "./db.ts"
import type { Turn, TurnMessage, TurnTools } from "./engines.ts"

export const WINDOW = 30 // messages kept verbatim after a consolidation
export const MAX_AFTER = 50 // more than this since the summary triggers a consolidation
export const MEMORY_BUDGET = 8_000 // characters of pinned memories in the prompt
export const RETRIEVED = 5 // memories retrieved by search each turn
export const SKILL_TITLES = 30 // skills listed by title
export const SKILL_BODIES = 2 // skills with the full step-by-step, the most relevant to the message
export const MAX_DEPTH = 3 // consecutive agent-to-agent replies with no human message in between

export const scopesOf = (chat: Pick<Chat, "projectId">, agentId: string | null): string[] => [
  "user",
  ...(chat.projectId ? [`project:${chat.projectId}`] : []),
  ...(agentId ? [`agent:${agentId}`] : [])
]

// "Copywriter Sênior" → "copywriter-senior"
export const handleOf = (a: Pick<Agent, "name">) => normalize(a.name).replace(/ /g, "-")

// Mentioned agents (@handle) in order of appearance; code in backticks doesn't count.
export function mentioned(text: string, agents: ReadonlyArray<Agent>): Agent[] {
  const plain = text.replace(/```[\s\S]*?```|`[^`]*`/g, " ")
  const handles = [...plain.matchAll(/@([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu)].map((m) => normalize(m[1]!).replace(/ /g, "-"))
  return [...new Set(handles)].flatMap((h) => agents.filter((a) => handleOf(a) === h))
}

// Most recently confirmed first, up to the budget; the rest is left to search.
export function pinned(active: ReadonlyArray<Memory>, budget = MEMORY_BUDGET): Memory[] {
  let used = 0
  const out: Memory[] = []
  for (const m of [...active].sort((a, b) => b.confirmedAt - a.confirmedAt)) {
    used += m.text.length + 3
    if (used > budget) break
    out.push(m)
  }
  return out
}

const section = (title: string, body: string | undefined) => (body?.trim() ? `## ${title}\n${body.trim()}` : undefined)
const bullets = (ms: ReadonlyArray<Memory>) => ms.map((m) => `- ${m.text}`).join("\n")

export interface TurnInput {
  readonly chat: Chat
  readonly model: string
  readonly project: Project | undefined
  readonly agent: Agent | undefined // who replies now
  readonly members: ReadonlyArray<Agent> // all agents in the chat
  readonly pinned: ReadonlyArray<Memory>
  readonly retrieved: ReadonlyArray<Memory>
  readonly skills: { readonly all: ReadonlyArray<Memory>; readonly relevant: ReadonlyArray<Memory> }
  readonly pages?: ReadonlyArray<{ readonly id: string; readonly title: string }> | undefined // pinned knowledge pages (titles only)
  readonly messages: ReadonlyArray<Message> // since the summary, in order; the last is from the user or another agent
  readonly cwd: string
  readonly filesDir?: string | undefined // where this chat's attachments live (<dataDir>/attachments/<chat>)
  readonly tools?: TurnTools | undefined
}

// "[Feito neste turno: editou src/a.ts (+2 −1); rodou `bun test` (ok)]", or nothing.
export function workNote(m: Message): string {
  const files = m.changes.map((c) => `${c.status === "added" ? "criou" : c.status === "deleted" ? "apagou" : "editou"} ${c.path} (+${c.added} −${c.removed})`)
  const runs = m.steps.filter((s) => s.tool === "run").map((s) => `rodou \`${s.args.slice(0, 120)}\` (${s.status === "ok" ? "ok" : s.status === "refused" ? "recusado" : "falhou"})`)
  const all = [...files, ...runs]
  if (!all.length) return ""
  return `\n\n[Feito neste turno: ${all.join("; ")}${m.revertedAt ? ". O usuário desfez essas mudanças depois." : ""}]`
}

export function buildTurn(i: TurnInput): Turn {
  const of = (scope: string) => i.pinned.filter((m) => m.scope === scope)
  const others = i.members.filter((a) => a.id !== i.agent?.id)
  const name = (id: string | null) => i.members.find((a) => a.id === id)?.name ?? "assistente"
  const channel =
    others.length > 0 &&
    [
      "Outros agentes neste chat (as mensagens deles chegam com o nome entre colchetes):",
      ...others.map((a) => `- @${handleOf(a)} (${[a.name, a.title].filter(Boolean).join(", ")}): ${a.description || a.instructions.split("\n")[0]?.slice(0, 140) || "sem descrição"}`),
      "Para passar parte do trabalho a um deles, mencione @handle na resposta: ele responde em seguida. Mencione só quando precisar; para só citar alguém, escreva o nome sem @."
    ].join("\n")

  // Stable: opens the native session (rarely changes; if it does, the session reopens from the resume point).
  const instructions = [
    "Você é um assistente num workspace de projetos. Responda no idioma do usuário, de forma direta.",
    "Use o contexto abaixo quando ajudar; não invente fatos que não estão nele.",
    i.tools?.defs.length && "Você tem ferramentas. Use quando a tarefa pedir; ações que mudam algo podem esperar a aprovação do usuário.",
    i.agent && section(`Você é ${[i.agent.name, i.agent.title].filter(Boolean).join(", ")}`, [i.agent.description, i.agent.instructions].filter(Boolean).join("\n\n")),
    channel && section("Canal", channel)
  ]
  const userMemories = section("O que você sabe sobre o usuário", bullets(of("user")))
  const projectParts = [
    i.project && section(`Projeto: ${i.project.name}`, i.project.brief),
    i.project?.path &&
      section(
        "Workspace",
        `Você trabalha na pasta do projeto: ${i.project.path}. Leia, edite e rode comandos nela com as suas ferramentas; o Zorel pede a aprovação do usuário quando o seu nível de acesso exige. Cada turno vira um ponto de restauração, e o usuário pode desfazer o que você mudou.`
      )
  ]
  const workMemories = [i.project && section("Memórias do projeto", bullets(of(`project:${i.project.id}`))), i.agent && section("Suas memórias de trabalho", bullets(of(`agent:${i.agent.id}`)))]
  const skillList = section("Skills disponíveis (procedimentos aprovados; siga quando a tarefa casar: leia os passos com zorel_read_skill; se achar um jeito melhor, proponha com zorel_propose_skill e improves)", i.skills.all.slice(0, SKILL_TITLES).map((s) => `- ${s.title}`).join("\n"))
  // Pinned pages: titles only (stable, cheap); the body comes with zorel_knowledge_read when needed.
  const pageList = section("Páginas de conhecimento fixadas (leia com zorel_knowledge_read; busque outras com zorel_knowledge_search)", (i.pages ?? []).map((p) => `- ${p.title} [${p.id}]`).join("\n"))
  const stable = [...instructions, userMemories, ...projectParts, ...workMemories, skillList, pageList].filter(Boolean).join("\n\n")
  // Dynamic: depends on the current message; in a native session it goes with the turn's message.
  const skillBodies = i.skills.relevant.map((s) => section(`Skill: ${s.title}`, s.text))
  const summary = section("Resumo do que veio antes nesta conversa", i.chat.summary)
  const retrieved = section("Memórias possivelmente relevantes para a mensagem atual", bullets(i.retrieved))
  const dynamic = [...skillBodies, summary, retrieved].filter(Boolean).join("\n\n")
  const system = [stable, dynamic].filter(Boolean).join("\n\n")
  const size = (xs: ReadonlyArray<unknown>) => xs.reduce<number>((n, x) => n + (typeof x === "string" ? x.length : 0), 0)
  const parts = {
    instructions: size([...instructions, ...projectParts]),
    memories: size([userMemories, ...workMemories, retrieved]),
    skills: size([skillList, ...skillBodies]),
    summary: size([summary])
  }

  const filesOf = (m: Message) => (i.filesDir ? m.attachments.map((a) => ({ name: a.name, mime: a.mime, path: join(i.filesDir!, a.id) })) : [])
  // From the replier's point of view: its own lines are "assistant"; other agents' lines arrive
  // as "user" with the name, so they don't look like its own.
  // Replies carry what their turn did in the workspace, so whoever answers next (another agent, or the
  // same agent after a provider switch) knows the files and commands without reading the old session.
  const messages: TurnMessage[] = i.messages
    .slice(-MAX_AFTER)
    .filter((m) => m.text.trim() || m.changes.length)
    .map((m) => {
      const text = `${m.text}${workNote(m)}`
      return m.role === "assistant" && m.agentId !== (i.agent?.id ?? null)
        ? { role: "user", text: `[${name(m.agentId)}]\n${text}`, at: m.at }
        : { role: m.role, text, at: m.at, files: filesOf(m) }
    })
  return { model: i.model, system, stable, dynamic, messages, cwd: i.cwd, tools: i.tools, parts }
}

// ---------- consolidation (continuous learning) ----------

export const CONSOLIDATION_SYSTEM = [
  "Você mantém a memória de um chat entre uma pessoa e agentes de IA.",
  "Recebe o resumo atual, um trecho de mensagens que vai sair da janela, as memórias e as skills que já existem.",
  "Responda SOMENTE com JSON, sem texto em volta, no formato:",
  '{"summary": "...", "memories": [{"scope": "user" | "project" | "agent", "text": "...", "evidence": [3]}], "confirm": ["m2"], "skills": [{"scope": "user" | "project" | "agent", "title": "...", "text": "..."}]}',
  '- "summary": o novo resumo, juntando o anterior e o trecho. Até 400 palavras. Guarde decisões, pendências, números, nomes e o estado do trabalho.',
  '- "memories": só fatos duráveis que valem fora desta conversa. Lista vazia é o normal.',
  '  - "user": preferências e jeito de trabalhar da pessoa (vale em tudo).',
  '  - "project": fatos e decisões do projeto (só quando a conversa é de um projeto).',
  '  - "agent": como fazer melhor o trabalho do agente que respondeu (só quando há um agente).',
  "  - Uma ideia por memória, frase curta, autossuficiente, em terceira pessoa. Não repita memórias existentes.",
  '  - "evidence": os números (#) das mensagens do trecho que provam o fato. Só valem mensagens da pessoa ([usuário]): um palpite, plano ou suposição de um agente nunca vira memória.',
  '- "confirm": os ids (m1, m2…) das memórias existentes que o trecho confirma de novo. Lista vazia é o normal.',
  '- "skills": procedimentos que valem repetir — algo resolvido em vários passos, uma saída de beco sem saída, ou uma correção do usuário sobre como fazer. Lista vazia é o normal.',
  '  - "title": nome curto do procedimento. "text": passo a passo objetivo, até 15 linhas. Não repita skills existentes.'
].join("\n")

export function consolidationPrompt(o: {
  summary: string
  chunk: ReadonlyArray<Message>
  existing: ReadonlyArray<Memory>
  skills: ReadonlyArray<Memory>
  forgotten: ReadonlyArray<Memory>
  hasProject: boolean
  hasAgent: boolean
  names: (agentId: string | null) => string
}): string {
  return [
    `Escopos permitidos: user${o.hasProject ? ", project" : ""}${o.hasAgent ? ", agent" : ""}.`,
    `Resumo atual:\n${o.summary || "(vazio)"}`,
    `Memórias existentes:\n${o.existing.map((m, i) => `- [m${i + 1}] ${m.text}`).join("\n") || "(nenhuma)"}`,
    `Skills existentes:\n${o.skills.map((s) => `- ${s.title}`).join("\n") || "(nenhuma)"}`,
    `O que a pessoa mandou esquecer (não proponha de novo, nem com outras palavras):\n${o.forgotten.map((m) => `- ${m.title || m.text}`).join("\n") || "(nada)"}`,
    `Trecho que sai da janela:\n${o.chunk.map((m, i) => `#${i + 1} [${m.role === "user" ? "usuário" : o.names(m.agentId)}] ${m.text}`).join("\n\n")}`
  ].join("\n\n")
}

type Scope = "user" | "project" | "agent"
export interface Consolidation {
  readonly summary: string
  readonly memories: ReadonlyArray<{ scope: Scope; text: string }>
  readonly confirm: ReadonlyArray<number> // indexes into the existing memories given to the prompt
  readonly skills: ReadonlyArray<{ scope: Scope; title: string; text: string }>
}

// Tolerates text around the JSON; drops items outside the allowed scopes or too long, and memories without
// evidence from the person: `fromUser(n)` says whether message #n of the chunk was theirs (a reference app's rule — an
// agent's guess never becomes a memory).
export function parseConsolidation(text: string, allowed: ReadonlyArray<string>, fromUser: (n: number) => boolean = () => true): Consolidation | undefined {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start < 0 || end <= start) return undefined
  try {
    const v = JSON.parse(text.slice(start, end + 1))
    if (typeof v?.summary !== "string" || !v.summary.trim()) return undefined
    const ok = (x: any, max: number) => allowed.includes(x?.scope) && typeof x.text === "string" && x.text.trim() && x.text.length <= max
    return {
      summary: v.summary.trim(),
      memories: (Array.isArray(v.memories) ? v.memories : [])
        .filter((m: any) => ok(m, 500) && Array.isArray(m.evidence) && m.evidence.some((n: unknown) => typeof n === "number" && fromUser(n)))
        .map((m: any) => ({ scope: m.scope, text: m.text.trim() })),
      confirm: (Array.isArray(v.confirm) ? v.confirm : []).flatMap((id: unknown) => {
        const n = typeof id === "string" ? Number(id.replace(/^m/, "")) : Number.NaN
        return Number.isInteger(n) && n > 0 ? [n - 1] : []
      }),
      skills: (Array.isArray(v.skills) ? v.skills : [])
        .filter((s: any) => ok(s, 4000) && typeof s.title === "string" && s.title.trim() && s.title.length <= 80)
        .map((s: any) => ({ scope: s.scope, title: s.title.trim(), text: s.text.trim() }))
    }
  } catch {
    return undefined
  }
}

// The words around the first match, on one line.
export const snippet = (text: string, q: string, around = 60) => {
  const flat = text.replace(/\s+/g, " ")
  const i = flat.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return flat.slice(0, around * 2)
  return `${i > around ? "…" : ""}${flat.slice(Math.max(0, i - around), i + q.length + around)}${i + q.length + around < flat.length ? "…" : ""}`
}
