// "Used by": the agents that see a skill. The badge in lists ("All agents", "Only Reviewer", "Designer +1",
// "No agent") and the field in the editors (Knowledge, Settings → Skills): everyone, or a pick of agents.
// The editors keep the state with useUsedBy and write `value` (empty = everyone) once `valid`.
import type { Agent } from "@zorel/contracts"
import { t } from "@zorel/i18n"
import { useState } from "react"
import { agentsAtom, useList } from "../client.ts"
import { agentTint, agentTone } from "../labels.ts"
import { SEARCH_FROM, teamOf, usedByView } from "./skill-agents.ts"
import { AgentAvatar, Badge, CheckList, SearchInput, Segmented } from "@/ui"

export function UsedByBadge({ ids }: { ids: ReadonlyArray<string> | undefined }) {
  const agents = useList(agentsAtom)
  const team = teamOf(agents)
  const v = usedByView(ids, team)
  if (v.kind === "all") return <Badge>{t("usedBy.all")}</Badge>
  if (v.kind === "none") return <Badge tone="danger">{t("usedBy.none")}</Badge>
  // One agent: the chip wears its color; several stay neutral.
  const one = v.names.length === 1 ? team.find((a) => ids?.includes(a.id)) : undefined
  if (one) return <span className={`tinted ${agentTint(one, agents)} inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-xs font-medium`}>{t("usedBy.only", { name: one.name })}</span>
  const text = t("usedBy.some", { name: v.names[0] ?? "", count: v.names.length - 1 })
  // The full list on hover; the badge's own text already says the essential.
  return (
    <span title={v.names.join(", ")} className="inline-flex">
      <Badge>{text}</Badge>
    </span>
  )
}

export function useUsedBy(initial: ReadonlyArray<string> | undefined) {
  const agents = useList(agentsAtom)
  const team = teamOf(agents)
  const [mode, setMode] = useState<"all" | "pick">(initial?.length ? "pick" : "all")
  const [ids, setIds] = useState<string[]>([...(initial ?? [])])
  const gone = ids.filter((id) => !team.some((a) => a.id === id)) // removed or archived: the server refuses them
  const valid = mode === "all" || (ids.length > 0 && gone.length === 0)
  const reset = () => {
    setMode(initial?.length ? "pick" : "all")
    setIds([...(initial ?? [])])
  }
  return { mode, setMode, ids, setIds, gone, valid, reset, value: mode === "all" ? [] : ids, agents, team, changed: JSON.stringify(mode === "all" ? [] : [...ids].sort()) !== JSON.stringify([...(initial ?? [])].sort()) }
}

export function UsedBy({ state }: { state: ReturnType<typeof useUsedBy> }) {
  const { mode, setMode, ids, setIds, gone, agents, team } = state
  const [query, setQuery] = useState("")
  // Ticked ones on top, as they were when the field opened (rows don't jump while ticking).
  const [first] = useState(ids)
  const rows: Array<{ id: string; agent: Agent | undefined }> = [
    ...team.map((a) => ({ id: a.id, agent: a })),
    ...gone.map((id) => ({ id, agent: agents.find((a) => a.id === id) }))
  ].sort((a, b) => Number(first.includes(b.id)) - Number(first.includes(a.id)))
  const q = query.trim().toLowerCase()
  const shown = rows.filter((r) => ids.includes(r.id) || !q || (r.agent?.name ?? "").toLowerCase().includes(q))
  const problem = gone.length > 0 ? t("usedBy.goneHint") : mode === "pick" && ids.length === 0 ? t("usedBy.pickOne") : undefined
  return (
    <fieldset className="flex min-w-0 flex-col gap-2.5">
      <legend className="flex flex-col gap-0.5 pb-1">
        <span className="text-sm font-medium text-fg">{t("usedBy.title")}</span>
        <span className="text-sm text-muted">{t("usedBy.hint")}</span>
      </legend>
      <Segmented
        label={t("usedBy.title")}
        value={mode}
        onChange={setMode}
        fill
        options={[
          { id: "all", label: t("usedBy.allAgents") },
          { id: "pick", label: t("usedBy.choose") }
        ]}
      />
      {mode === "pick" && (
        <>
          {rows.length >= SEARCH_FROM && <SearchInput size="sm" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("usedBy.search")} aria-label={t("usedBy.search")} />}
          <CheckList
            label={t("usedBy.title")}
            value={ids}
            onChange={setIds}
            options={shown.map((r) => ({
              value: r.id,
              ...(r.agent && { tint: agentTint(r.agent, agents) }),
              label: r.agent ? (
                <>
                  <AgentAvatar id={r.agent.id} name={r.agent.name} tone={agentTone(r.agent, agents)} size={20} />
                  <span className="truncate">{r.agent.name}</span>
                </>
              ) : (
                <span className="truncate text-muted">{t("usedBy.removedAgent")}</span>
              ),
              trailing: !team.some((a) => a.id === r.id) && <Badge tone="danger">{r.agent ? t("usedBy.archived") : t("usedBy.removed")}</Badge>
            }))}
          />
          {shown.length === 0 && <p className="text-sm text-muted">{t("usedBy.noMatch")}</p>}
        </>
      )}
      {problem && (
        <p role="status" className="text-sm text-danger">
          {problem}
        </p>
      )}
    </fieldset>
  )
}
