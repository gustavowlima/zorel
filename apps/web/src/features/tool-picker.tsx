// Choosing a connector's tool (spec 013, FR-009): the connector first, then its tools of the kind the place needs (a
// watch reads, a destination posts a message, a step takes any), the likeliest one already chosen. A tool this
// routine's agent can't use now isn't offered; when none is left, the reason shows with the one place that fixes it.
import { type Agent, type CatalogTool, type McpServer, textFieldOf, type ToolState } from "@zorel/contracts"
import { t } from "@zorel/i18n"
import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import { useEffect } from "react"
import { catalogAtom, serversAtom, useList } from "../client.ts"
import { go, type Route } from "../state.ts"
import { Button, Field, Select, Spinner } from "@/ui"

export type Picked = { server: McpServer; tool: CatalogTool }
// watch: something new (a read); message: a channel's messages (a read, messages first); post: a destination (a write
// that takes a message); any: a flow step.
export type ToolNeed = "watch" | "message" | "post" | "any"

const FITS: Record<ToolNeed, (t: CatalogTool) => boolean> = {
  watch: (t) => t.cls === "read",
  message: (t) => t.cls === "read",
  post: (t) => t.cls !== "read" && textFieldOf(t.inputSchema) !== undefined,
  any: () => true
}
// The likeliest tool for the place first: the first pattern its name matches; a tool none matches comes last.
const LIKELY: Record<ToolNeed, ReadonlyArray<RegExp>> = {
  watch: [/list|search/, /get/],
  message: [/message|chat|conversation/, /channel/, /list|search/],
  post: [/(send|post).*(message|chat)|message.*(send|post)/, /comment|reply/, /send|post|create/],
  any: [/list|search/]
}
const rank = (need: ToolNeed, name: string) => {
  const i = LIKELY[need].findIndex((re) => re.test(name.toLowerCase()))
  return i === -1 ? LIKELY[need].length : i
}
export const likelyTools = (need: ToolNeed, tools: ReadonlyArray<CatalogTool>) =>
  tools.filter((x) => FITS[need](x) && x.state === "usable").sort((a, b) => rank(need, a.name) - rank(need, b.name) || a.name.localeCompare(b.name))

// Each reason a connector has nothing usable, and where it is fixed.
const FIX: Record<Exclude<ToolState, "usable">, (agent: Agent) => Route> = {
  "signed-out": () => ({ view: "settings", tab: "mcp" }),
  off: () => ({ view: "settings", tab: "mcp" }),
  "read-only": (agent) => ({ view: "agent", id: agent.id, tab: "tools" }),
  "no-access": (agent) => ({ view: "agent", id: agent.id, tab: "tools" })
}
// A connector just chosen, its tool not yet: ToolOf picks the likeliest as soon as the tools are read.
const NO_TOOL: CatalogTool = { name: "", description: "", cls: "read", inputSchema: {}, state: "usable" }

export function ConnectorTool({ agent, need, serverId, tool, onPick }: { agent: Agent; need: ToolNeed; serverId: string; tool: string; onPick: (p: Picked) => void }) {
  const servers = useList(serversAtom).filter((s) => s.enabled && (s.projectId === null || s.projectId === agent.projectId))
  const server = servers.find((s) => s.id === serverId)
  if (!servers.length)
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-muted">{t("flows.picker.noConnectors")}</p>
        <Button size="sm" variant="secondary" onPress={() => go({ view: "settings", tab: "mcp" })}>
          {t("flows.picker.addConnector")}
        </Button>
      </div>
    )
  const pickServer = (id: string) => {
    const s = servers.find((x) => x.id === id)
    if (s && id !== serverId) onPick({ server: s, tool: NO_TOOL })
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label={t("flows.picker.connector")}>
        <Select value={serverId} placeholder={t("flows.picker.pickConnector")} onChange={pickServer} options={servers.map((s) => ({ value: s.id, label: s.name }))} />
      </Field>
      {server && <ToolOf agent={agent} need={need} server={server} tool={tool} onPick={onPick} />}
    </div>
  )
}

function ToolOf({ agent, need, server, tool, onPick }: { agent: Agent; need: ToolNeed; server: McpServer; tool: string; onPick: (p: Picked) => void }) {
  const catalog = AsyncResult.getOrElse(useAtomValue(catalogAtom(server.id, agent.id)), () => undefined)
  const fit = likelyTools(need, catalog?.tools ?? [])
  const chosen = fit.find((x) => x.name === tool)
  const best = fit[0]
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new connector (no tool yet) or a new best name matters
  useEffect(() => {
    if (!tool && best) onPick({ server, tool: best })
  }, [tool, best?.name, server.id])
  if (!catalog)
    return (
      <div className="flex items-end pb-2">
        <Spinner />
      </div>
    )
  if (catalog.error) return <p className="self-end text-sm text-danger">{t("flows.picker.unreachable", { error: catalog.error.slice(0, 160) })}</p>
  if (!fit.length) {
    // Nothing usable: why (the first tool of the kind that isn't usable) and where to fix it.
    const blocked = catalog.tools.find((x) => FITS[need](x) && x.state !== "usable")
    const state = blocked?.state as Exclude<ToolState, "usable"> | undefined
    return (
      <div className="flex flex-col items-start gap-2 self-end">
        <p className="text-sm text-muted">{state ? t(`flows.picker.why.${state}`, { agent: agent.name }) : t(`flows.picker.none.${need}`)}</p>
        {state && (
          <Button size="sm" variant="secondary" onPress={() => go(FIX[state](agent))}>
            {t(`flows.picker.fix.${state}`)}
          </Button>
        )}
      </div>
    )
  }
  return (
    <Field label={t(`flows.picker.tool.${need}`)} hint={chosen?.description ? chosen.description.split("\n")[0]!.slice(0, 140) : undefined}>
      <Select
        value={chosen?.name ?? ""}
        placeholder={t("flows.picker.pickTool")}
        onChange={(name) => {
          const x = fit.find((y) => y.name === name)
          if (x) onPick({ server, tool: x })
        }}
        options={fit.map((x) => ({ value: x.name, label: x.name }))}
      />
    </Field>
  )
}
