// Monta o que um turno envia ao engine. Nada fica acumulado na sessão da CLI: a cada turno
// o contexto é recomposto em camadas, da mais estável para a mais volátil (bom para cache de prompt):
//   base → agente → canal → memórias do usuário → projeto (brief + memórias) → memórias do agente
//   → skills → resumo do chat → memórias recuperadas pela mensagem atual → últimas mensagens.
// Cada camada tem orçamento; o que não cabe fica pesquisável (FTS) e volta quando é relevante.
// Modelo de resumo contínuo + memórias + skills propostas derivado do Tucano (Apache-2.0), ver NOTICE.
import type { Agent, Chat, Memory, Message, Project } from "@zero/contracts"
import { normalize } from "./db.ts"
import type { Turn, TurnMessage, TurnTools } from "./engines.ts"

export const WINDOW = 30 // mensagens mantidas literais depois de uma consolidação
export const MAX_AFTER = 50 // mais que isso desde o resumo dispara uma consolidação
export const MEMORY_BUDGET = 8_000 // caracteres de memórias fixas no prompt
export const RETRIEVED = 5 // memórias trazidas por busca a cada turno
export const SKILL_TITLES = 30 // skills listadas pelo título
export const SKILL_BODIES = 2 // skills com o passo a passo inteiro, as mais relevantes para a mensagem
export const MAX_DEPTH = 3 // respostas seguidas entre agentes sem mensagem humana no meio

export const scopesOf = (chat: Pick<Chat, "projectId">, agentId: string | null): string[] => [
  "user",
  ...(chat.projectId ? [`project:${chat.projectId}`] : []),
  ...(agentId ? [`agent:${agentId}`] : [])
]

// "Copywriter Sênior" → "copywriter-senior"
export const handleOf = (a: Pick<Agent, "name">) => normalize(a.name).replace(/ /g, "-")

// Agentes mencionados (@handle) na ordem em que aparecem; código entre crases não conta.
export function mentioned(text: string, agents: ReadonlyArray<Agent>): Agent[] {
  const plain = text.replace(/```[\s\S]*?```|`[^`]*`/g, " ")
  const handles = [...plain.matchAll(/@([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu)].map((m) => normalize(m[1]!).replace(/ /g, "-"))
  return [...new Set(handles)].flatMap((h) => agents.filter((a) => handleOf(a) === h))
}

// As mais recentemente confirmadas primeiro, até o orçamento; o resto fica para a busca.
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
  readonly agent: Agent | undefined // quem responde agora
  readonly members: ReadonlyArray<Agent> // todos os agentes do chat
  readonly pinned: ReadonlyArray<Memory>
  readonly retrieved: ReadonlyArray<Memory>
  readonly skills: { readonly all: ReadonlyArray<Memory>; readonly relevant: ReadonlyArray<Memory> }
  readonly messages: ReadonlyArray<Message> // desde o resumo, em ordem; a última é do usuário ou de outro agente
  readonly cwd: string
  readonly tools?: TurnTools | undefined
}

export function buildTurn(i: TurnInput): Turn {
  const of = (scope: string) => i.pinned.filter((m) => m.scope === scope)
  const others = i.members.filter((a) => a.id !== i.agent?.id)
  const name = (id: string | null) => i.members.find((a) => a.id === id)?.name ?? "assistente"
  const channel =
    others.length > 0 &&
    [
      "Outros agentes neste chat (as mensagens deles chegam com o nome entre colchetes):",
      ...others.map((a) => `- @${handleOf(a)} (${a.name}): ${a.instructions.split("\n")[0]?.slice(0, 140) || "sem descrição"}`),
      "Para passar parte do trabalho a um deles, mencione @handle na resposta: ele responde em seguida. Mencione só quando precisar; para só citar alguém, escreva o nome sem @."
    ].join("\n")

  // Estável: abre a sessão nativa (muda pouco; se mudar, a sessão reabre com o ponto de retomada).
  const stable = [
    "Você é um assistente num workspace de projetos. Responda no idioma do usuário, de forma direta.",
    "Use o contexto abaixo quando ajudar; não invente fatos que não estão nele.",
    i.tools?.defs.length && "Você tem ferramentas. Use quando a tarefa pedir; ações que mudam algo podem esperar a aprovação do usuário.",
    i.agent && section(`Você é ${i.agent.name}`, i.agent.instructions),
    channel && section("Canal", channel),
    section("O que você sabe sobre o usuário", bullets(of("user"))),
    i.project && section(`Projeto: ${i.project.name}`, i.project.brief),
    i.project && section("Memórias do projeto", bullets(of(`project:${i.project.id}`))),
    i.agent && section("Suas memórias de trabalho", bullets(of(`agent:${i.agent.id}`))),
    section("Skills disponíveis (procedimentos aprovados; siga quando a tarefa casar)", i.skills.all.slice(0, SKILL_TITLES).map((s) => `- ${s.title}`).join("\n"))
  ]
    .filter(Boolean)
    .join("\n\n")
  // Dinâmico: depende da mensagem atual; numa sessão nativa vai junto da mensagem do turno.
  const dynamic = [
    ...i.skills.relevant.map((s) => section(`Skill: ${s.title}`, s.text)),
    section("Resumo do que veio antes nesta conversa", i.chat.summary),
    section("Memórias possivelmente relevantes para a mensagem atual", bullets(i.retrieved))
  ]
    .filter(Boolean)
    .join("\n\n")
  const system = [stable, dynamic].filter(Boolean).join("\n\n")

  // Do ponto de vista de quem responde: as próprias falas são "assistant"; as de outros agentes chegam
  // como "user" com o nome, para não parecer que ele mesmo disse.
  const messages: TurnMessage[] = i.messages
    .slice(-MAX_AFTER)
    .filter((m) => m.text.trim())
    .map((m) =>
      m.role === "assistant" && m.agentId !== (i.agent?.id ?? null)
        ? { role: "user", text: `[${name(m.agentId)}]\n${m.text}`, at: m.at }
        : { role: m.role, text: m.text, at: m.at }
    )
  return { model: i.model, system, stable, dynamic, messages, cwd: i.cwd, tools: i.tools }
}

// ---------- consolidação (aprendizado contínuo) ----------

export const CONSOLIDATION_SYSTEM = [
  "Você mantém a memória de um chat entre uma pessoa e agentes de IA.",
  "Recebe o resumo atual, um trecho de mensagens que vai sair da janela, as memórias e as skills que já existem.",
  "Responda SOMENTE com JSON, sem texto em volta, no formato:",
  '{"summary": "...", "memories": [{"scope": "user" | "project" | "agent", "text": "..."}], "skills": [{"scope": "user" | "project" | "agent", "title": "...", "text": "..."}]}',
  '- "summary": o novo resumo, juntando o anterior e o trecho. Até 400 palavras. Guarde decisões, pendências, números, nomes e o estado do trabalho.',
  '- "memories": só fatos duráveis que valem fora desta conversa. Lista vazia é o normal.',
  '  - "user": preferências e jeito de trabalhar da pessoa (vale em tudo).',
  '  - "project": fatos e decisões do projeto (só quando a conversa é de um projeto).',
  '  - "agent": como fazer melhor o trabalho do agente que respondeu (só quando há um agente).',
  "  - Uma ideia por memória, frase curta, autossuficiente, em terceira pessoa. Não repita memórias existentes.",
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
    `Memórias existentes:\n${o.existing.map((m) => `- ${m.text}`).join("\n") || "(nenhuma)"}`,
    `Skills existentes:\n${o.skills.map((s) => `- ${s.title}`).join("\n") || "(nenhuma)"}`,
    `O que a pessoa mandou esquecer (não proponha de novo, nem com outras palavras):\n${o.forgotten.map((m) => `- ${m.title || m.text}`).join("\n") || "(nada)"}`,
    `Trecho que sai da janela:\n${o.chunk.map((m) => `[${m.role === "user" ? "usuário" : o.names(m.agentId)}] ${m.text}`).join("\n\n")}`
  ].join("\n\n")
}

type Scope = "user" | "project" | "agent"
export interface Consolidation {
  readonly summary: string
  readonly memories: ReadonlyArray<{ scope: Scope; text: string }>
  readonly skills: ReadonlyArray<{ scope: Scope; title: string; text: string }>
}

// Tolera texto em volta do JSON; descarta itens fora dos escopos permitidos ou longos demais.
export function parseConsolidation(text: string, allowed: ReadonlyArray<string>): Consolidation | undefined {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start < 0 || end <= start) return undefined
  try {
    const v = JSON.parse(text.slice(start, end + 1))
    if (typeof v?.summary !== "string" || !v.summary.trim()) return undefined
    const ok = (x: any, max: number) => allowed.includes(x?.scope) && typeof x.text === "string" && x.text.trim() && x.text.length <= max
    return {
      summary: v.summary.trim(),
      memories: (Array.isArray(v.memories) ? v.memories : []).filter((m: any) => ok(m, 500)).map((m: any) => ({ scope: m.scope, text: m.text.trim() })),
      skills: (Array.isArray(v.skills) ? v.skills : [])
        .filter((s: any) => ok(s, 4000) && typeof s.title === "string" && s.title.trim() && s.title.length <= 80)
        .map((s: any) => ({ scope: s.scope, title: s.title.trim(), text: s.text.trim() }))
    }
  } catch {
    return undefined
  }
}
