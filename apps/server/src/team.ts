// Team tools (ARCHITECTURE §13, phase 4): agents read the team and create or change teammates from the
// conversation. Four tools, Zero's own like the browser's: zero_list_agents and zero_read_agent only read;
// zero_create_agent and zero_update_agent always show the person a proposal card (the approval) and write only
// on their OK. A teammate never gets more access than the agent proposing it has (ask < workspace < full), and
// an agent can only narrow a teammate's access, never widen it: widening is the person's, on the agent's page.
// Models are checked by provider (any model of a known provider can be typed, as in the picker).
import type { Access, Agent, Effort } from "@zero/contracts"
import { handleOf } from "./context.ts"
import { PROVIDERS } from "./engines.ts"

export const TEAM_TOOLS = [
  {
    name: "zero_list_agents",
    description:
      "List the agents you can work with: id, @handle, name, title, description (first 300 characters), model, access, scope (this project or global) and whether one is working now. Match work outside your remit to titles and descriptions.",
    inputSchema: { properties: {} },
    writes: false
  },
  {
    name: "zero_read_agent",
    description: "Read one agent's whole setup: profile, instructions, model, effort, fallbacks and access. agent: an id or @handle.",
    inputSchema: { properties: { agent: { type: "string" } }, required: ["agent"] },
    writes: false
  },
  {
    name: "zero_create_agent",
    description:
      "Propose a new persistent teammate when the user asks for one. The user sees the whole profile and approves it before it exists. Without model, it gets yours. Its access is at most yours. scope: 'project' (default, this chat's project) or 'global'. Use zero_update_agent for an existing agent.",
    inputSchema: {
      properties: {
        name: { type: "string" },
        title: { type: "string", description: "The role in a few words" },
        description: { type: "string", description: "What it does, one sentence (other agents read it to know when to pass it work)" },
        instructions: { type: "string" },
        model: { type: "string", description: "<provider>/<model>, e.g. claude-cli/claude-sonnet-5-5" },
        effort: { type: "string", enum: ["low", "medium", "high", "max"] },
        access: { type: "string", enum: ["ask", "workspace", "full"] },
        scope: { type: "string", enum: ["project", "global"] }
      },
      required: ["name", "instructions"]
    },
    writes: true
  },
  {
    name: "zero_update_agent",
    description:
      "Propose changes to an agent's name, title, description, instructions, model, effort or access, from the user's request; the user approves them first. You can narrow access, never widen it. agent: an id or @handle.",
    inputSchema: {
      properties: {
        agent: { type: "string" },
        name: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        instructions: { type: "string" },
        model: { type: "string" },
        effort: { type: "string", enum: ["low", "medium", "high", "max"] },
        access: { type: "string", enum: ["ask", "workspace", "full"] }
      },
      required: ["agent"]
    },
    writes: true
  }
] as const
export type TeamToolName = (typeof TEAM_TOOLS)[number]["name"]

const RANK: Record<Access, number> = { ask: 0, workspace: 1, full: 2 }
export const narrower = (a: Access, b: Access): Access => (RANK[a] <= RANK[b] ? a : b)
const LIMITS = { name: 80, title: 60, description: 300, instructions: 8000 } as const

const str = (v: unknown, max: number, field: string): string | undefined => {
  if (v === undefined || v === null) return undefined
  if (typeof v !== "string") throw new Error(`${field} must be text.`)
  const s = v.trim()
  if (s.length > max) throw new Error(`${field} is longer than ${max} characters.`)
  return s
}
const oneOf = <T extends string>(v: unknown, list: ReadonlyArray<T>, field: string): T | undefined => {
  if (v === undefined || v === null) return undefined
  if (!list.includes(v as T)) throw new Error(`${field} must be one of: ${list.join(", ")}.`)
  return v as T
}
const model = (v: unknown): string | undefined => {
  const m = str(v, 200, "model")
  if (m === undefined) return undefined
  const provider = m.split("/")[0] ?? ""
  if (!/^[a-z-]+\/\S+$/.test(m) || !PROVIDERS[provider]) throw new Error(`Unknown model "${m}". Use <provider>/<model> with a provider among: ${Object.keys(PROVIDERS).join(", ")}.`)
  return m
}

// The agent named by an id or "@handle" (handles are names in lowercase with dashes).
export const findAgent = (all: ReadonlyArray<Agent>, ref: unknown): Agent | undefined => {
  if (typeof ref !== "string") return undefined
  const r = ref.trim().replace(/^@/, "")
  return all.find((a) => a.id === r) ?? all.find((a) => handleOf(a) === r.toLowerCase())
}

// The agents visible from a chat: the global ones and those of its project.
export const visibleTo = (all: ReadonlyArray<Agent>, projectId: string | null) => all.filter((a) => a.projectId === null || a.projectId === projectId)

export const listText = (agents: ReadonlyArray<Agent>, working: (id: string) => boolean) =>
  JSON.stringify(
    agents.map((a) => ({
      id: a.id,
      handle: `@${handleOf(a)}`,
      name: a.name,
      title: a.title,
      description: a.description.slice(0, 300),
      model: a.model,
      access: a.access,
      scope: a.projectId ? "project" : "global",
      working: working(a.id)
    })),
    null,
    2
  )

export const readText = (a: Agent) =>
  JSON.stringify({ id: a.id, handle: `@${handleOf(a)}`, name: a.name, title: a.title, description: a.description, instructions: a.instructions, model: a.model, effort: a.effort, failover: a.failover, access: a.access, scope: a.projectId ? "project" : "global" }, null, 2)

export interface NewAgentInput {
  readonly projectId: string | null
  readonly name: string
  readonly title: string
  readonly description: string
  readonly instructions: string
  readonly model: string
  readonly effort: Effort | null
  readonly access: Access
}

// A create proposal from the tool's arguments: checked, filled from the caller, access capped at the caller's.
export function createInput(args: Record<string, unknown>, caller: { model: string; effort: Effort | null; access: Access }, projectId: string | null): NewAgentInput {
  const name = str(args.name, LIMITS.name, "name")
  const instructions = str(args.instructions, LIMITS.instructions, "instructions")
  if (!name) throw new Error("name is required.")
  if (!instructions) throw new Error("instructions are required.")
  const scope = oneOf(args.scope, ["project", "global"] as const, "scope") ?? "project"
  return {
    projectId: scope === "global" ? null : projectId,
    name,
    title: str(args.title, LIMITS.title, "title") ?? "",
    description: str(args.description, LIMITS.description, "description") ?? "",
    instructions,
    model: model(args.model) ?? caller.model,
    effort: oneOf(args.effort, ["low", "medium", "high", "max"] as const, "effort") ?? (args.model ? null : caller.effort),
    access: narrower(oneOf(args.access, ["ask", "workspace", "full"] as const, "access") ?? caller.access, caller.access)
  }
}

export type AgentChanges = Partial<Pick<Agent, "name" | "title" | "description" | "instructions" | "model" | "effort" | "access">>

// An update proposal: only the fields given, access only narrowed (never above the target's or the caller's).
export function updateInput(args: Record<string, unknown>, target: Agent, callerAccess: Access): AgentChanges {
  const out: Record<string, unknown> = {}
  const name = str(args.name, LIMITS.name, "name")
  if (name !== undefined) {
    if (!name) throw new Error("name can't be empty.")
    out.name = name
  }
  const title = str(args.title, LIMITS.title, "title")
  if (title !== undefined) out.title = title
  const description = str(args.description, LIMITS.description, "description")
  if (description !== undefined) out.description = description
  const instructions = str(args.instructions, LIMITS.instructions, "instructions")
  if (instructions !== undefined) out.instructions = instructions
  const m = model(args.model)
  if (m !== undefined) out.model = m
  const effort = oneOf(args.effort, ["low", "medium", "high", "max"] as const, "effort")
  if (effort !== undefined) out.effort = effort
  const access = oneOf(args.access, ["ask", "workspace", "full"] as const, "access")
  if (access !== undefined) {
    if (RANK[access] > RANK[target.access]) throw new Error("Only the user can widen an agent's access (on its page).")
    out.access = narrower(access, callerAccess)
  }
  // Only what actually changes.
  for (const k of Object.keys(out)) if ((target as Record<string, unknown>)[k] === out[k]) delete out[k]
  if (!Object.keys(out).length) throw new Error("Nothing to change.")
  return out as AgentChanges
}

// The proposal card's text: the fields, one per line (instructions cut for the card; the whole text is written).
export const proposalText = (fields: Record<string, unknown>) =>
  Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}: ${typeof v === "string" ? (v.length > 1200 ? `${v.slice(0, 1200)}…` : v) : JSON.stringify(v)}`)
    .join("\n")
