// A mention of a teammate, as a chip: its avatar and name; pressing it opens that agent. Quiet (the control tone,
// no colour of its own), so a line of text still reads as text.
import type { Agent } from "@zorel/contracts"
import { t } from "@zorel/i18n"
import { agentsAtom, useList } from "../client.ts"
import { agentTone } from "../labels.ts"
import { agentUrl, splitMentions } from "./mentions.ts"
import { AgentAvatar } from "@/ui"

export function MentionChip({ agent, agents }: { agent: Pick<Agent, "id" | "name">; agents: ReadonlyArray<Agent> }) {
  const full = agents.find((a) => a.id === agent.id)
  return (
    <a
      href={agentUrl(agent.id)}
      data-mention=""
      title={t("mention.open", { name: agent.name })}
      className="inline-flex max-w-full items-center gap-1 rounded-full bg-control py-px pr-2 pl-1 align-middle text-base font-medium text-secondary no-underline outline-none transition-colors duration-120 ease-out hover:bg-control-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
    >
      <AgentAvatar id={agent.id} name={agent.name} {...(full && { tone: agentTone(full, agents) })} size={16} />
      <span className="truncate">{agent.name}</span>
    </a>
  )
}

// A plain text (your own message) with its mentions as chips; code in backticks is left alone, as the server does.
export function MentionText({ text }: { text: string }) {
  const agents = useList(agentsAtom)
  return (
    <>
      {text.split(/(```[\s\S]*?```|`[^`]*`)/).flatMap((piece, n) =>
        n % 2 === 1
          ? [piece]
          : splitMentions(piece, agents).map((p, i) =>
              typeof p === "string" ? (
                p
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: parts of one text, in order
                <MentionChip key={`${n}:${i}`} agent={p.agent} agents={agents} />
              )
            )
      )}
    </>
  )
}
