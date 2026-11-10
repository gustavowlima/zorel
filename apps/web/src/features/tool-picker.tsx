// Picking a connector's tool for a step (spec 013, the ToolPicker board, FR-009): grouped by connector, searchable,
// reads apart from writes. A tool this routine's agent can't use now is shown, disabled, with why and the one place
// that fixes it.
import { type Agent, type CatalogTool, type McpServer, textFieldOf, type ToolState } from "@zorel/contracts"
import { t } from "@zorel/i18n"
import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import { useState } from "react"
import { catalogAtom, serversAtom, useList } from "../client.ts"
import { go, type Route } from "../state.ts"
import { Badge, Button, cx, RowHit, Rows, SearchInput, Section, Segmented, Spinner } from "@/ui"

type Filter = "all" | "read" | "write"
export type Picked = { server: McpServer; tool: CatalogTool }

// Each reason a tool is unusable, and where it is fixed.
const FIX: Record<Exclude<ToolState, "usable">, (agent: Agent) => Route> = {
  "signed-out": () => ({ view: "settings", tab: "mcp" }),
  off: () => ({ view: "settings", tab: "mcp" }),
  "read-only": (agent) => ({ view: "agent", id: agent.id, tab: "tools" }),
  "no-access": (agent) => ({ view: "agent", id: agent.id, tab: "tools" })
}

// only: a trigger watches with a read tool; a destination posts with a write one.
export function ToolPicker({ agent, only, onPick }: { agent: Agent; only?: "read" | "write" | undefined; onPick: (p: Picked) => void }) {
  const servers = useList(serversAtom).filter((s) => s.projectId === null || s.projectId === agent.projectId)
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<Filter>(only ?? "all")
  if (!servers.length) return <p className="text-muted">{t("flows.picker.noConnectors")}</p>
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <SearchInput aria-label={t("flows.picker.search")} placeholder={t("flows.picker.search")} className="min-w-48 flex-1" value={query} onChange={(e) => setQuery(e.target.value)} />
        {!only && (
          <Segmented
            label={t("flows.picker.filter")}
            value={filter}
            onChange={setFilter}
            options={[
              { id: "all", label: t("flows.picker.all") },
              { id: "read", label: t("flows.picker.reads") },
              { id: "write", label: t("flows.picker.writes") }
            ]}
          />
        )}
      </div>
      {servers.map((s) => (
        <ServerTools key={s.id} server={s} agent={agent} query={query.trim().toLowerCase()} filter={filter} onPick={onPick} />
      ))}
    </div>
  )
}

// A destination posts a message: only tools whose message field is found (text, content, message or body).
const takesText = (t: CatalogTool) => textFieldOf(t.inputSchema) !== undefined

function ServerTools({ server, agent, query, filter, onPick }: { server: McpServer; agent: Agent; query: string; filter: Filter; onPick: (p: Picked) => void }) {
  const result = useAtomValue(catalogAtom(server.id, agent.id))
  const catalog = AsyncResult.getOrElse(result, () => undefined)
  // A destination (only "write") posts text: only tools with an input that takes it.
  const tools = (catalog?.tools ?? []).filter((x) => (filter === "all" || (filter === "read") === (x.cls === "read")) && (filter !== "write" || takesText(x)) && (!query || `${x.name} ${x.description}`.toLowerCase().includes(query)))
  if (catalog && !tools.length && !catalog.error) return null
  return (
    <Section title={server.name}>
      <Rows>
        {!catalog && (
          <div className="py-3">
            <Spinner />
          </div>
        )}
        {catalog?.error && <p className="py-3 text-sm text-danger">{t("flows.picker.unreachable", { error: catalog.error.slice(0, 160) })}</p>}
        {tools.map((tool) => (
          <ToolRow key={tool.name} tool={tool} agent={agent} badge={filter === "all"} onPick={() => onPick({ server, tool })} />
        ))}
      </Rows>
    </Section>
  )
}

// badge: the read/write tag, only while both kinds are listed (on every row of a filtered list it says nothing).
function ToolRow({ tool, agent, badge, onPick }: { tool: CatalogTool; agent: Agent; badge: boolean; onPick: () => void }) {
  const usable = tool.state === "usable"
  return (
    <div className="relative flex items-center gap-3 py-3">
      {usable && <RowHit label={t("flows.picker.use", { tool: tool.name })} onPress={onPick} />}
      <span className="pointer-events-none relative flex min-w-0 flex-1 flex-col">
        <span className={cx("truncate font-mono text-sm", !usable && "text-muted")}>{tool.name}</span>
        <span className="truncate text-sm text-muted">{usable ? tool.description : t(`flows.picker.why.${tool.state}`, { agent: agent.name })}</span>
      </span>
      {badge && (
        <span className="pointer-events-none relative">
          <Badge tone="neutral">{t(`flows.picker.cls.${tool.cls}`)}</Badge>
        </span>
      )}
      {tool.state !== "usable" && (
        <Button size="sm" variant="secondary" className="relative" onPress={() => go(FIX[tool.state as Exclude<ToolState, "usable">](agent))}>
          {t(`flows.picker.fix.${tool.state}`)}
        </Button>
      )}
    </div>
  )
}
