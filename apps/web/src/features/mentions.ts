// Mentions in a message's text, read the way the server routes them (context.ts `mentioned`, same MENTION_RE from
// contracts): an "@" not glued to a letter, digit, "_", "." or "-" (so "(@tester)" counts and an e-mail does not),
// followed by a token compared without accents or case to an agent's handle; code is left alone (the Markdown
// plugin below skips it). Every such mention is turned into a link to that agent. Pure, so it can be tested.
import { type Agent, MENTION_RE } from "@zorel/contracts"
import { handleOf } from "../labels.ts"

type Named = Pick<Agent, "id" | "name">
type MentionPart = string | { agent: Named; text: string }

export const agentUrl = (id: string) => `#/agent/${id}`
// A mention's token as the server compares it with a handle: no accents, no case.
export const handleKey = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()

export function splitMentions(text: string, agents: ReadonlyArray<Named>): MentionPart[] {
  if (!text.includes("@")) return [text]
  const byHandle = new Map<string, Named>()
  for (const a of agents) {
    const h = handleOf(a)
    if (h && !byHandle.has(h)) byHandle.set(h, a)
  }
  if (!byHandle.size) return [text]
  const parts: MentionPart[] = []
  let last = 0
  for (const m of text.matchAll(MENTION_RE)) {
    const agent = byHandle.get(handleKey(m[1]!))
    if (!agent) continue
    if (m.index > last) parts.push(text.slice(last, m.index))
    parts.push({ agent, text: m[0] })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

// A remark plugin: mentions in the Markdown's plain text become links to the agent (never inside code or a link).
type MdNode = { type: string; value?: string; url?: string; children?: MdNode[] }
const SKIP = new Set(["code", "inlineCode", "link", "linkReference", "definition", "html"])
export const linkMentions = (agents: ReadonlyArray<Named>) => () => {
  const walk = (node: MdNode) => {
    if (!node.children) return
    node.children = node.children.flatMap((child): MdNode[] => {
      if (child.type === "text" && child.value) {
        return splitMentions(child.value, agents).map((p): MdNode =>
          typeof p === "string" ? { type: "text", value: p } : { type: "link", url: agentUrl(p.agent.id), children: [{ type: "text", value: p.text }] }
        )
      }
      if (!SKIP.has(child.type)) walk(child)
      return [child]
    })
  }
  return (tree: unknown) => walk(tree as MdNode)
}
