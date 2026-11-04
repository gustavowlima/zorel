// Team tools (ARCHITECTURE §13, phase 4): agents read the team and create or change teammates from the
// conversation. Four tools, Zorel's own like the browser's: zorel_list_agents and zorel_read_agent only read;
// zorel_create_agent and zorel_update_agent always show the person a proposal card (the approval) and write only
// on their OK. A teammate never gets more access than the agent proposing it has (ask < workspace < full), and
// an agent can only narrow a teammate's access, never widen it: widening is the person's, on the agent's page.
// Models are checked by provider (any model of a known provider can be typed, as in the picker).
import { type Access, type Agent, type AgentPermissions, DEFAULT_PERMISSIONS, type Effort, type Grant } from "@zorel/contracts"
import { handleOf } from "./context.ts"
import { PROVIDERS } from "./engines.ts"

// What a proposed agent may reach (as in Tucano): the least the work needs. connectors: MCP servers here by name,
// each read or write (any not listed: no access); reason: why this agent, in a sentence. The person reviews and can change all of it before it is created.
const POWERS = {
  web: { type: "boolean", description: "Search and read the web. Only if the work needs it." },
  browser: { type: "boolean", description: "Its own browser (open pages, click, type). Only if the work needs it." },
  connectors: { type: "array", items: { type: "object", properties: { name: { type: "string" }, level: { type: "string", enum: ["read", "write"] } }, required: ["name"] } },
  reason: { type: "string", description: "Why this agent, in a sentence" }
} as const

export const TEAM_TOOLS = [
  {
    name: "zorel_list_agents",
    description:
      "List the agents you can work with: id, @handle, name, title, description (first 300 characters), model, access, scope (this project or global) and whether one is working now. Match work outside your remit to titles and descriptions.",
    inputSchema: { properties: {} },
    writes: false
  },
  {
    name: "zorel_read_agent",
    description: "Read one agent's whole setup: profile, instructions, model, effort, fallbacks and access. agent: an id or @handle.",
    inputSchema: { properties: { agent: { type: "string" } }, required: ["agent"] },
    writes: false
  },
  {
    name: "zorel_create_agent",
    description:
      "Propose new persistent teammates when the user asks for them: one (the fields below) or a whole team at once (agents: a list of the same fields, up to 8). The user sees every profile in one card and approves before any exists. Without model, each gets yours. Access is at most yours. scope: 'project' (default, this chat's project) or 'global'. Use zorel_update_agent for an existing agent.",
    inputSchema: {
      properties: {
        agents: {
          type: "array",
          maxItems: 8,
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              title: { type: "string" },
              description: { type: "string" },
              instructions: { type: "string" },
              model: { type: "string" },
              effort: { type: "string", enum: ["low", "medium", "high", "max"] },
              access: { type: "string", enum: ["ask", "workspace", "full"] },
              scope: { type: "string", enum: ["project", "global"] },
              ...POWERS
            },
            required: ["name", "instructions"]
          }
        },
        name: { type: "string" },
        title: { type: "string", description: "The role in a few words" },
        description: { type: "string", description: "What it does, one sentence (other agents read it to know when to pass it work)" },
        instructions: { type: "string" },
        model: { type: "string", description: "<provider>/<model>, e.g. claude-cli/claude-sonnet-5-5" },
        effort: { type: "string", enum: ["low", "medium", "high", "max"] },
        access: { type: "string", enum: ["ask", "workspace", "full"] },
        scope: { type: "string", enum: ["project", "global"] },
        ...POWERS
      },
    },
    writes: true
  },
  {
    name: "zorel_update_agent",
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

// Delegation (ARCHITECTURE §9.3): the teammate works in a chat of its own, in parallel, and its answer comes back
// to this chat as a message, where the asking agent continues. reply false: hand it over and don't hear back.
export const TASK_TOOL = {
  name: "zorel_start_task",
  description:
    "Hand work to a teammate (from zorel_list_agents) when it's in their remit or can run in parallel. It runs in its own chat; its answer comes back here as a message and you continue then, so don't wait or check on it. agent: an id or @handle. task: what to do and the context it needs (it doesn't see this chat). reply: false to hand it over without hearing back.",
  inputSchema: { properties: { agent: { type: "string" }, task: { type: "string" }, reply: { type: "boolean" } }, required: ["agent", "task"] },
  writes: false
} as const
// The agent asks the person and waits for the answer (a card in the chat and in Needs you; 30 min, then it goes on).
export const ASK_TOOL = {
  name: "zorel_ask_user",
  description:
    "Ask the user a question and wait for the answer, when you can't go on well without it (a choice only they can make, missing information). question: one short question. options: up to 6 short answers they can pick with one click; they can also type their own. Don't use it for approval of an action (actions ask by themselves) or for things you can find out.",
  inputSchema: { properties: { question: { type: "string" }, options: { type: "array", items: { type: "string" }, maxItems: 6 } }, required: ["question"] },
  writes: false
} as const
export const MAX_OPEN_TASKS = 4 // per chat, waiting for their results
export const MAX_TASK_DEPTH = 2 // a task may start tasks, whose tasks may not

// Memory beyond the prompt's budget: the agent searches it when it needs to (the turn already brings the most
// recently confirmed and the few that match the message). Read only; scopes are the chat's.
export const MEMORY_TOOL = {
  name: "zorel_search_memories",
  description:
    "Search what you and the team learned (the user's preferences, this project's facts, your own work notes) beyond what is already in your context. query: words to look for. Returns up to 10 memories, best match first.",
  inputSchema: { properties: { query: { type: "string" } }, required: ["query"] },
  writes: false
} as const

// Skills (as in Tucano): read a recipe when the task matches; propose a new one or a better version of one, with
// the reason. Proposals wait for the person in Knowledge, who sees what changes before approving.
export const SKILL_TOOLS = [
  {
    name: "zorel_read_skill",
    description: "Read the full steps of a skill listed in your context (by its title). Follow it when the task matches.",
    inputSchema: { properties: { skill: { type: "string" } }, required: ["skill"] },
    writes: false
  },
  {
    name: "zorel_propose_skill",
    description:
      "Propose a skill: a procedure worth repeating (steps that worked, a fix for a dead end, how the user wants something done). title: short name; steps: the recipe, up to 15 lines; reason: why, in a sentence. To improve an existing skill, pass its title in improves (the user sees the change before approving). scope: 'project' (default in a project), 'agent' (yours) or 'user'. Nothing changes until the user approves it.",
    inputSchema: {
      properties: { title: { type: "string" }, steps: { type: "string" }, reason: { type: "string" }, improves: { type: "string" }, scope: { type: "string", enum: ["project", "agent", "user"] } },
      required: ["title", "steps", "reason"]
    },
    writes: false
  }
] as const

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
export const visibleTo = (all: ReadonlyArray<Agent>, projectId: string | null) => all.filter((a) => !a.builtin && (a.projectId === null || a.projectId === projectId))

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
  readonly permissions: AgentPermissions
  readonly notes: { readonly reason: string; readonly connectors: string } // shown on the card, not stored
}

// The powers asked for, as permissions: web as given (default on), the browser only when asked for (as in Tucano:
// the least the work needs), connectors by name among
// the servers here (unlisted ones: no access, when any are listed); unknown names are an error to fix.
function powersOf(args: Record<string, unknown>, servers: ReadonlyArray<{ id: string; name: string }>): { permissions: AgentPermissions; connectors: string } {
  const listed = Array.isArray(args.connectors) ? (args.connectors as Array<Record<string, unknown>>) : undefined
  const grants: Record<string, Grant> = {}
  const named: string[] = []
  if (listed) {
    for (const s of servers) grants[s.id] = "none"
    for (const c of listed) {
      const s = servers.find((x) => x.name.toLowerCase() === String(c?.name ?? "").trim().toLowerCase())
      if (!s) throw new Error(`No connector "${String(c?.name ?? "")}" here. The ones here: ${servers.map((x) => x.name).join(", ") || "(none)"}.`)
      const level: Grant = c.level === "write" ? "write" : "read"
      grants[s.id] = level
      named.push(`${s.name} (${level})`)
    }
  }
  return {
    permissions: { web: args.web === undefined ? DEFAULT_PERMISSIONS.web : args.web === true, browser: args.browser === true, grants, always: [] },
    connectors: listed ? named.join(", ") || "none" : ""
  }
}

// A create proposal from the tool's arguments: checked, filled from the caller, access capped at the caller's.
export function createInput(args: Record<string, unknown>, caller: { model: string; effort: Effort | null; access: Access }, projectId: string | null, servers: ReadonlyArray<{ id: string; name: string }> = []): NewAgentInput {
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
    access: narrower(oneOf(args.access, ["ask", "workspace", "full"] as const, "access") ?? caller.access, caller.access),
    ...(() => {
      const p = powersOf(args, servers)
      return { permissions: p.permissions, notes: { reason: str(args.reason, 300, "reason") ?? "", connectors: p.connectors } }
    })()
  }
}

export const MAX_TEAM = 8

// One profile, or a team from `agents`: each checked like a single one; names must differ from each other.
export function createInputs(args: Record<string, unknown>, caller: { model: string; effort: Effort | null; access: Access }, projectId: string | null, servers: ReadonlyArray<{ id: string; name: string }> = []): NewAgentInput[] {
  const list = Array.isArray(args.agents) ? (args.agents as unknown[]) : [args]
  if (!list.length) throw new Error("agents is empty.")
  if (list.length > MAX_TEAM) throw new Error(`At most ${MAX_TEAM} agents at once.`)
  const out = list.map((a, i) => {
    try {
      return createInput((a ?? {}) as Record<string, unknown>, caller, projectId, servers)
    } catch (e) {
      throw new Error(`Agent ${i + 1}: ${e instanceof Error ? e.message : String(e)}`)
    }
  })
  const names = out.map((a) => a.name.toLowerCase())
  if (new Set(names).size !== names.length) throw new Error("Each agent needs its own name.")
  return out
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

// Routines from the conversation (phase 7): list them, or propose one or its removal (both are approval cards).
export const ROUTINES_TOOL = {
  name: "zorel_routines",
  description:
    "Recurring work. action 'list': the routines of the agents here. action 'create': propose one (name, prompt = what the agent should do each run, cron = 5-field pattern like '0 9 * * 1-5', agent = who runs it, default you); the user approves it first. action 'cancel': propose removing one (routine = its id).",
  inputSchema: {
    properties: {
      action: { type: "string", enum: ["list", "create", "cancel"] },
      name: { type: "string" },
      prompt: { type: "string" },
      cron: { type: "string" },
      agent: { type: "string" },
      routine: { type: "string" }
    },
    required: ["action"]
  },
  writes: true
} as const

// ---------- the Builder: the agent that designs agents and teams with you (Tucano's "Tuca", for whole teams) ----------

export const BUILDER = {
  name: "Builder",
  title: "Designs agents and teams",
  description: "Turns what you need into agents (one or a whole team) and their routines, always as proposals you approve.",
  instructions: [
    "You design agents for the user. You do no other work.",
    "1. Understand the goal: what should get done, in which project, how often, with what tools or accounts. Ask at most 3 short questions, only what you can't infer; otherwise propose right away.",
    "2. Call zorel_list_agents first so you don't duplicate an existing teammate; prefer improving one (zorel_update_agent) over adding a near-copy.",
    "3. Propose the whole team in ONE zorel_create_agent call (agents: [...]): one clear responsibility each, a title of a few words, a one-sentence description other agents can route by, and focused instructions (what to do, how to report, when to hand off to whom by @handle). Small teams win: 1 to 4 agents unless the user asks for more.",
    "4. Give each agent the least it needs (as in a good hire's first day): web and browser only if the work needs them, connectors by name with read unless it must write, access 'workspace' for code work. Leave model unset unless the user asks. Add reason (why this agent, one sentence). Code work belongs to a project: if this chat has no project (no project section in your context) and the user didn't ask for a global agent, don't propose yet; ask them to pick the project in the Project selector above the message box, or to say it's for every project.",
    "5. If the work is recurring, propose routines with zorel_routines (action create) after the agents exist.",
    "6. End with what each agent does and how to start: which one to @mention for what."
  ].join("\n"),
  access: "ask" as const
}

// Knowledge pages (phase 3b): search and read freely; write to the project's or your own pages directly (each
// write is a version the user can restore); a page about the user waits for the user's OK.
export const KNOWLEDGE_TOOLS = [
  {
    name: "zorel_knowledge_search",
    description: "Search the knowledge pages (decisions, how-tos, references, notes) of the user, this project and you. Returns titles, ids and the words around the match.",
    inputSchema: { properties: { query: { type: "string" } }, required: ["query"] },
    writes: false
  },
  {
    name: "zorel_knowledge_read",
    description: "Read a whole knowledge page. page: its id (from the search or the pinned list) or its exact title.",
    inputSchema: { properties: { page: { type: "string" } }, required: ["page"] },
    writes: false
  },
  {
    name: "zorel_knowledge_write",
    description:
      "Create or update a knowledge page in Markdown: a decision and why, a how-to that worked, a gotcha, a reference. page: an existing page's id to update (send the whole new body). scope: 'project' (default), 'agent' (your own notes) or 'user' (about the user: they approve it first). Keep pages short and current; update instead of duplicating.",
    inputSchema: {
      properties: { page: { type: "string" }, title: { type: "string" }, body: { type: "string" }, scope: { type: "string", enum: ["project", "agent", "user"] } },
      required: ["title", "body"]
    },
    writes: true
  }
] as const
