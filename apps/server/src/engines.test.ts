import { expect, test } from "bun:test"

process.env.ZOREL_API_ENGINE = "direct" // these tests drive the direct API engine against a mock server
import { type Agent, DEFAULT_PERMISSIONS, type Memory, type Message, namedSkills, skillHandle } from "@zorel/contracts"
import { Effect, Stream } from "effect"
import { buildTurn, mentioned, parseConsolidation, pinned } from "./context.ts"
import { claudeArgs, claudeParser, classifyMessage, codexArgs, codexParser, Engines, splitModel, transcript, type EngineEvent, type Parser, type Turn } from "./engines.ts"
import { codexFailure, windowsOf } from "./engines/codex.ts"
import { Secrets } from "./secrets.ts"
import { classify, exposedName, needsApproval } from "./tools.ts"

const feed = (p: Parser, file: string) =>
  Bun.file(new URL(`./fixtures/${file}`, import.meta.url)).text().then((t) => [...t.split("\n").flatMap((l) => p.line(l)), ...p.end(0, "")] as EngineEvent[])

test("Claude Code parser: streamed text + usage at the end", async () => {
  const ev = await feed(claudeParser(), "claude-stream.jsonl")
  expect(ev.filter((e) => e.type === "text").map((e) => (e as any).delta).join("")).toBe("oi, tudo certo.")
  expect(ev.at(-1)).toMatchObject({ type: "done" })
  expect(claudeParser().end(1, "boom")[0]).toMatchObject({ type: "error" })
})

test("Codex parser: agent_message + turn.completed; ignores hook error items", async () => {
  const ev = await feed(codexParser(), "codex-exec.jsonl")
  expect(ev).toEqual([
    { type: "text", delta: "oi, tudo certo." },
    { type: "done", usage: { inputTokens: 14839, outputTokens: 9 } }
  ])
})

test("CLI args: no session, no tools, model from the id", () => {
  const t = { model: "claude-cli/opus", system: "S", messages: [{ role: "user" as const, text: "hi" }], cwd: "/tmp/x" }
  expect(claudeArgs(t)).toContain("--no-session-persistence")
  expect(claudeArgs(t).join(" ")).toContain("--model opus")
  expect(codexArgs({ ...t, model: "codex-cli/default" })).not.toContain("-m")
  expect(codexArgs({ ...t, model: "codex-cli/gpt-5" }).join(" ")).toContain("-m gpt-5")
  expect(splitModel("openrouter/meta/llama-4")).toEqual({ provider: "openrouter", model: "meta/llama-4" })
  expect(transcript([{ role: "user", text: "a" }, { role: "assistant", text: "b" }, { role: "user", text: "c" }])).toContain("New message from the user:\nc")
})

const mem = (text: string, confirmedAt: number, scope = "user", kind: Memory["kind"] = "fact", title = ""): Memory => ({ id: text, scope, kind, title, text, state: "active", origin: "manual", chatId: null, createdAt: 0, confirmedAt })
const agentOf = (id: string, name: string, instructions = ""): Agent => ({ id, projectId: "p", name, title: "", description: "", instructions, model: "x/y", accountId: null, effort: null, failover: [], permissions: DEFAULT_PERMISSIONS, access: "workspace", createdAt: 0 })
const msg = (role: "user" | "assistant", text: string, agentId: string | null = null): Message => ({ id: text, chatId: "c", role, agentId, text, model: null, error: null, steps: [], attachments: [], switches: [], turnId: null, changes: [], revertedAt: null, accountId: null, cost: null, inputTokens: 0, outputTokens: 0, durationMs: null, at: 1 })

test("context: the memory budget favors the recent ones; layers in stable → volatile order", () => {
  expect(pinned([mem("stale", 1), mem("fresh", 2), mem("x".repeat(50), 3)], 59).map((m) => m.id)).toEqual(["x".repeat(50)])
  const dev = agentOf("a", "Dev", "INSTR")
  const turn = buildTurn({
    chat: { id: "c", projectId: "p", agentIds: ["a", "b"], title: "", accountId: null, effort: null, model: "anthropic/m", summary: "SUMMARYTEXT", summaryUntil: 0, failover: null, position: null, worktree: null, resumeAt: null, preview: null, lastAt: null, createdAt: 0 },
    model: "anthropic/m",
    project: { id: "p", name: "P", brief: "BRIEF", path: null, defaultAgentId: null, createdAt: 0 },
    agent: dev,
    members: [dev, agentOf("b", "Senior Reviewer", "Reviews PRs")],
    pinned: [mem("MINE", 1), mem("PROJ", 1, "project:p"), mem("AG", 1, "agent:a")],
    retrieved: [mem("FOUND", 1)],
    skills: { all: [mem("body", 1, "project:p", "skill", "SKILLTITLE")], relevant: [mem("SKILLBODY", 1, "project:p", "skill", "S")] },
    messages: [msg("user", "hi"), msg("assistant", "my line", "a"), msg("assistant", "the reviewer's line", "b"), msg("user", "so?")],
    cwd: "/tmp"
  })
  const order = ["INSTR", "@senior-reviewer", "MINE", "BRIEF", "PROJ", "AG", "SKILLTITLE", "SKILLBODY", "SUMMARYTEXT", "FOUND"].map((s) => turn.system.indexOf(s))
  expect(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1]!))).toBe(true)
  expect(turn.messages.map(({ role, text }) => ({ role, text }))).toEqual([
    { role: "user", text: "hi" },
    { role: "assistant", text: "my line" },
    { role: "user", text: "[Senior Reviewer]\nthe reviewer's line" },
    { role: "user", text: "so?" }
  ])
})

test("mentions: by handle without accents, in order, ignoring code", () => {
  const a = [agentOf("1", "Léo"), agentOf("2", "Ana Paula"), agentOf("3", "Nico")]
  expect(mentioned("@ana-paula and @leo, take a look; `@nico` not", a).map((x) => x.id)).toEqual(["2", "1"])
  expect(mentioned("email@nico.com", a).map((x) => x.id)).toEqual(["3"]) // ponytail: simple heuristic, same as Tucano
})

test("tool policy: annotation > name; sensitive beats read", () => {
  expect(classify({ name: "search_docs" })).toBe("read")
  expect(classify({ name: "listAndDeleteFiles" })).toBe("sensitive")
  expect(classify({ name: "create_issue" })).toBe("write")
  expect(classify({ name: "create_issue", annotations: { readOnlyHint: true } })).toBe("read")
  expect(needsApproval("approve", "write")).toBe(true)
  expect(needsApproval("auto", "sensitive")).toBe(false)
  expect(exposedName("Meu Jira", "get.issue")).toBe("Meu_Jira__get_issue")
})

test("consolidation: takes JSON with text around it, drops scopes not allowed", () => {
  const r = parseConsolidation('ok:\n{"summary":"S","memories":[{"scope":"user","text":"A","evidence":[1]},{"scope":"project","text":"B","evidence":[1]}],"confirm":["m2","x"],"skills":[{"scope":"user","title":"T","text":"steps"},{"scope":"user","text":"no title"}]}', ["user"])
  expect(r).toEqual({ summary: "S", memories: [{ scope: "user", text: "A" }], confirm: [1], skills: [{ scope: "user", title: "T", text: "steps" }] })
  expect(parseConsolidation("nothing", ["user"])).toBeUndefined()
  expect(parseConsolidation('{"summary":""}', ["user"])).toBeUndefined()
})

test("consolidation: only what the person said becomes a memory (evidence from their message)", () => {
  const json = '{"summary":"S","memories":[{"scope":"user","text":"Likes Bun","evidence":[1]},{"scope":"user","text":"Uses Postgres","evidence":[2]},{"scope":"user","text":"No proof"}]}'
  const fromUser = (n: number) => n === 1 // #1 is the person's, #2 an agent's
  expect(parseConsolidation(json, ["user"], fromUser)?.memories.map((m) => m.text)).toEqual(["Likes Bun"])
})

// OpenAI-compatible mock: answers each request with the next chunk script.
function mockOpenAi(scripts: object[][]) {
  const sent: any[] = []
  const chunk = (o: object) => `data: ${JSON.stringify({ id: "1", object: "chat.completion.chunk", created: 0, model: "m", ...o })}\n\n`
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      sent.push(await req.json())
      const body = `${(scripts[sent.length - 1] ?? []).map(chunk).join("")}data: [DONE]\n\n`
      return new Response(body, { headers: { "content-type": "text/event-stream" } })
    }
  })
  return { sent, server }
}
const runApi = (turn: Turn) =>
  Effect.runPromise(Effect.gen(function* () { const e = yield* Engines; return yield* Stream.runCollect(e.run(turn)) }).pipe(Effect.provide(Engines.layer), Effect.provide(Secrets.memory())))

test("API engine (OpenAI-compatible): system + history go as messages; the stream becomes text/done", async () => {
  const { sent, server } = mockOpenAi([[
    { choices: [{ index: 0, delta: { role: "assistant", content: "do" }, finish_reason: null }] },
    { choices: [{ index: 0, delta: { content: "ne" }, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    { choices: [], usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 } }
  ]])
  process.env.OLLAMA_URL = `http://localhost:${server.port}/v1`
  try {
    const events = await runApi({ model: "ollama/llama3", system: "S", messages: [{ role: "user", text: "a" }, { role: "assistant", text: "b" }, { role: "user", text: "c" }], cwd: "/tmp" })
    expect(sent[0].model).toBe("llama3")
    expect(sent[0].messages.map((m: any) => [m.role, m.content])).toEqual([["system", "S"], ["user", "a"], ["assistant", "b"], ["user", "c"]])
    expect(events.filter((e) => e.type === "text").map((e: any) => e.delta).join("")).toBe("done")
    expect(events.at(-1)).toEqual({ type: "done", usage: { inputTokens: 7, outputTokens: 2 } })
  } finally {
    server.stop()
    delete process.env.OLLAMA_URL
  }
})

test("API engine with tools: the model asks for the tool, Zorel runs it and returns the result, the model concludes", async () => {
  const { sent, server } = mockOpenAi([
    [
      { choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "docs__search", arguments: '{"q":"deploy"}' } }] }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
      { choices: [], usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 } }
    ],
    [
      { choices: [{ index: 0, delta: { role: "assistant", content: "Found it: Vercel." }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      { choices: [], usage: { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 } }
    ]
  ])
  process.env.OLLAMA_URL = `http://localhost:${server.port}/v1`
  const calls: unknown[] = []
  try {
    const events = await runApi({
      model: "ollama/llama3", system: "S", messages: [{ role: "user", text: "where is the deploy?" }], cwd: "/tmp",
      tools: {
        url: "http://unused",
        defs: [{ name: "docs__search", description: "busca", inputSchema: { type: "object", properties: { q: { type: "string" } } } }],
        call: async (name, args) => {
          calls.push([name, args])
          return { content: [{ type: "text", text: "deploy on Vercel" }] }
        }
      }
    })
    expect(calls).toEqual([["docs__search", { q: "deploy" }]])
    expect(sent[0].tools.map((t: any) => t.function.name)).toEqual(["docs__search"])
    expect(JSON.stringify(sent[1].messages)).toContain("deploy on Vercel") // result went back to the model
    expect(events.filter((e) => e.type === "text").map((e: any) => e.delta).join("")).toBe("Found it: Vercel.")
    expect(events.at(-1)).toEqual({ type: "done", usage: { inputTokens: 14, outputTokens: 4 } })
  } finally {
    server.stop()
    delete process.env.OLLAMA_URL
  }
})

// ---------- failover signals (ARCHITECTURE §6.1) ----------

test("claude: a rejected rate_limit_event turns the failed result into a limit with its reset; readings become limits", () => {
  const p = claudeParser()
  const line = (v: object) => p.line(JSON.stringify(v))
  expect(line({ type: "rate_limit_event", rate_limit_info: { status: "allowed_warning", utilization: 0.82, resetsAt: 1_900_000_000, rateLimitType: "seven_day" } })).toEqual([
    { type: "limits", windows: [{ id: "seven_day", usedPercent: 82, resetsAt: 1_900_000_000_000 }] }
  ])
  line({ type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: 1_900_000_600 } })
  const [err] = line({ type: "result", subtype: "error_during_execution", is_error: true, result: "limit" })
  expect(err).toMatchObject({ type: "error", failure: { reason: "limit", until: 1_900_000_600_000 } })
})

test("claude: assistant error codes map to reasons; request errors don't switch", () => {
  const run = (error: string) => {
    const p = claudeParser()
    p.line(JSON.stringify({ type: "assistant", error, message: {} }))
    return p.line(JSON.stringify({ type: "result", subtype: "success", is_error: true, result: "x" }))[0]
  }
  expect(run("overloaded")).toMatchObject({ failure: { reason: "unavailable" } })
  expect(run("authentication_failed")).toMatchObject({ failure: { reason: "auth" } })
  expect(run("invalid_request")).toMatchObject({ failure: undefined })
})

test("codex: codexErrorInfo maps to reasons; a usage limit comes back when the top window resets", () => {
  const windows = windowsOf({ primary: { usedPercent: 100, resetsAt: 1_900_000_000, windowDurationMins: 300 }, secondary: { usedPercent: 40, resetsAt: 1_900_500_000, windowDurationMins: 10_080 } })
  expect(windows).toEqual([
    { id: "five_hour", usedPercent: 100, resetsAt: 1_900_000_000_000 },
    { id: "seven_day", usedPercent: 40, resetsAt: 1_900_500_000_000 }
  ])
  expect(codexFailure({ message: "x", codexErrorInfo: "usageLimitExceeded" }, windows)).toEqual({ reason: "limit", until: 1_900_000_000_000 })
  expect(codexFailure({ message: "x", codexErrorInfo: { httpConnectionFailed: { httpStatusCode: null } } }, [])).toEqual({ reason: "network" })
  expect(codexFailure({ message: "x", codexErrorInfo: "contextWindowExceeded" }, [])).toBeUndefined()
})

test("message heuristics for engines without structured errors", () => {
  expect(classifyMessage("429 Too Many Requests")).toEqual({ reason: "rate_limit" })
  expect(classifyMessage("Invalid API key")).toEqual({ reason: "auth" })
  expect(classifyMessage("fetch failed: ECONNREFUSED")).toEqual({ reason: "network" })
  expect(classifyMessage("503 Service Unavailable")).toEqual({ reason: "unavailable" })
  expect(classifyMessage("prompt is too long")).toBeUndefined()
})

test("skills by $handle: the title becomes the handle; only the exact handle calls the skill", () => {
  const skills = [{ title: "Deploy to Vercel" }, { title: "Review PR" }]
  expect(skillHandle("Deploy to Vercel")).toBe("deploy-to-vercel")
  expect(namedSkills("run $deploy-to-vercel now", skills).map((s) => s.title)).toEqual(["Deploy to Vercel"])
  expect(namedSkills("custa $5 e $deploy-to-vercelx", skills)).toEqual([])
})
