// How each kind of flow step looks and reads (spec 013), shared by the editor and the Run view.
import type { FlowKind, FlowNode, McpServer } from "@zorel/contracts"
import { t } from "@zorel/i18n"
import type { ReactNode } from "react"
import { Bot, CircleStop, cx, Filter, IconTile, ShieldCheck, Split, Wrench, Zap } from "@/ui"

// Only the trigger is blue (Single Voice); an "Ask me" is the one step that waits for you.
const LOOK: Record<FlowKind, { icon: () => ReactNode; tile: string }> = {
  trigger: { icon: () => <Zap />, tile: "bg-accent-soft text-accent-text" },
  tool: { icon: () => <Wrench />, tile: "" },
  agent: { icon: () => <Bot />, tile: "" },
  check: { icon: () => <Filter />, tile: "" },
  condition: { icon: () => <Split />, tile: "" },
  approval: { icon: () => <ShieldCheck />, tile: "text-warning" },
  end: { icon: () => <CircleStop />, tile: "text-dim" }
}
export const KindTile = ({ kind, size = "md" }: { kind: FlowKind; size?: "sm" | "md" }) => (
  <IconTile size={size} className={cx(LOOK[kind].tile)}>
    {LOOK[kind].icon()}
  </IconTile>
)

export const kindIcon = (kind: FlowKind) => LOOK[kind].icon()

const firstLine = (s: string) => s.trim().split("\n")[0]!.slice(0, 80)

const TRIGGER_TITLE: Record<Extract<FlowNode, { kind: "trigger" }>["config"]["on"], () => string> = {
  manual: () => t("flows.trigger.manual"),
  schedule: () => t("flows.trigger.schedule"),
  dayStart: () => t("flows.trigger.dayStart"),
  webhook: () => t("flows.trigger.webhook"),
  watch: () => t("flows.trigger.watch"),
  message: () => t("flows.trigger.message"),
  once: () => t("flows.trigger.once"),
  monthly: () => t("flows.trigger.monthly")
}

type TriggerConfig = Extract<FlowNode, { kind: "trigger" }>["config"]
const watching = (c: TriggerConfig, server: (id: string | undefined) => string) => `${server(c.serverId)} · ${c.tool ?? t("flows.pickTool")} · ${t("flows.every", { count: c.every ?? 5 })}`
const TRIGGER_DETAIL: Record<TriggerConfig["on"], (c: TriggerConfig, server: (id: string | undefined) => string) => string> = {
  schedule: (c) => c.cron ?? "",
  once: (c) => [c.date, c.time].filter(Boolean).join(" ") || t("flows.missing.date"),
  monthly: (c) => (c.day ? t("flows.monthlyAt", { day: c.day, time: c.time ?? "" }) : t("flows.missing.day")),
  watch: watching,
  message: watching,
  dayStart: () => t("flows.triggerHint.dayStart"),
  webhook: () => t("flows.triggerHint.webhook"),
  manual: () => t("flows.triggerHint.manual")
}

// A step's name (its own label, else what it does) and one line about it.
export function nodeTitle(n: FlowNode): string {
  if (n.label) return n.label
  if (n.kind === "trigger") return TRIGGER_TITLE[n.config.on]()
  if (n.kind === "tool") return n.config.tool || t("flows.kind.tool")
  return t(`flows.kind.${n.kind}`)
}
export function nodeDetail(n: FlowNode, servers: ReadonlyArray<McpServer>): string {
  const server = (id: string | undefined) => servers.find((s) => s.id === id)?.name ?? t("flows.noConnector")
  switch (n.kind) {
    case "trigger":
      return TRIGGER_DETAIL[n.config.on](n.config, server)
    case "tool":
      return n.config.tool ? server(n.config.serverId) : t("flows.pickTool")
    case "agent":
      return firstLine(n.config.prompt) || t("flows.empty.agent")
    case "check":
      return firstLine(n.config.onlyWhen) || t("flows.empty.check")
    case "condition":
      return n.config.rule === "ask" ? firstLine(n.config.arg ?? "") || t("flows.empty.condition") : t(`flows.rule.${n.config.rule}`)
    case "approval":
      return firstLine(n.config.summary) || t("flows.empty.approval")
    case "end":
      return t("flows.endHint")
  }
}
