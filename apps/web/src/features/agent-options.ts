// The agents "#" and "@" offer in the message box, apart from the screen so the rule can be tested: who can be called
// (not the Builder; the project's own and the global ones), the list itself (the chat's members first, in the chat's
// order, then the rest, each with the line that says what it is or that it joins the chat), and who a message
// calls that is not in the chat yet (they join when it is sent).
import { type Agent, MENTION_RE } from "@zorel/contracts"
import { handleOf } from "../labels.ts"
import { handleKey } from "./mentions.ts"

export const callable = <A extends Pick<Agent, "projectId" | "builtin">>(agents: ReadonlyArray<A>, projectId: string | null): A[] =>
  agents.filter((a) => !a.builtin && (a.projectId === null || a.projectId === projectId))

export interface AgentOption<A> {
  readonly agent: A
  readonly id: string // the handle the text carries after the "@"
  readonly label: string
  readonly hint: string
  readonly member: boolean // already in the chat; the others join it when picked
}

export function agentOptions<A extends Pick<Agent, "id" | "name">>(
  agents: ReadonlyArray<A>,
  memberIds: ReadonlyArray<string>,
  hints: { member: (a: A) => string; outside: string }
): AgentOption<A>[] {
  const members = memberIds.flatMap((id) => agents.find((a) => a.id === id) ?? [])
  const outside = agents.filter((a) => !memberIds.includes(a.id))
  return [
    ...members.map((agent) => ({ agent, id: handleOf(agent), label: agent.name, hint: hints.member(agent), member: true })),
    ...outside.map((agent) => ({ agent, id: handleOf(agent), label: agent.name, hint: hints.outside, member: false }))
  ]
}

// Who a message names that must join the chat before it is sent: callable agents mentioned in the text who are not
// members, once each, in the order they appear. Read as the server reads mentions (MENTION_RE, code in backticks
// left out), so exactly the ones it would route to are the ones that join.
export function toJoin<A extends Pick<Agent, "id" | "name">>(text: string, chatAgentIds: ReadonlyArray<string>, callable: ReadonlyArray<A>): A[] {
  const out: A[] = []
  for (const m of text.replace(/```[\s\S]*?```|`[^`]*`/g, " ").matchAll(MENTION_RE)) {
    const handle = handleKey(m[1]!)
    const agent = callable.find((a) => handleOf(a) === handle)
    if (agent && !chatAgentIds.includes(agent.id) && !out.includes(agent)) out.push(agent)
  }
  return out
}
