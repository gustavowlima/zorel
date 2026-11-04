import { expect, test } from "bun:test"
import { type Agent, type Memory, type Message, namedSkills, skillHandle } from "@zero/contracts"
import { Effect, Stream } from "effect"
import { buildTurn, mentioned, parseConsolidation, pinned } from "./context.ts"
import { claudeArgs, claudeParser, classifyMessage, codexArgs, codexParser, Engines, splitModel, transcript, type EngineEvent, type Parser, type Turn } from "./engines.ts"
import { codexFailure, windowsOf } from "./engines/codex.ts"
import { Secrets } from "./secrets.ts"
import { classify, exposedName, needsApproval } from "./tools.ts"

const feed = (p: Parser, file: string) =>
  Bun.file(new URL(`./fixtures/${file}`, import.meta.url)).text().then((t) => [...t.split("\n").flatMap((l) => p.line(l)), ...p.end(0, "")] as EngineEvent[])

test("parser do Claude Code: texto em streaming + uso no fim", async () => {
  const ev = await feed(claudeParser(), "claude-stream.jsonl")
  expect(ev.filter((e) => e.type === "text").map((e) => (e as any).delta).join("")).toBe("oi, tudo certo.")
  expect(ev.at(-1)).toMatchObject({ type: "done" })
  expect(claudeParser().end(1, "boom")[0]).toMatchObject({ type: "error" })
})

test("parser do Codex: agent_message + turn.completed; ignora itens de erro de hook", async () => {
  const ev = await feed(codexParser(), "codex-exec.jsonl")
  expect(ev).toEqual([
    { type: "text", delta: "oi, tudo certo." },
    { type: "done", usage: { inputTokens: 14839, outputTokens: 9 } }
  ])
})

test("args das CLIs: sem sessão, sem ferramentas, modelo do id", () => {
  const t = { model: "claude-cli/opus", system: "S", messages: [{ role: "user" as const, text: "oi" }], cwd: "/tmp/x" }
  expect(claudeArgs(t)).toContain("--no-session-persistence")
  expect(claudeArgs(t).join(" ")).toContain("--model opus")
  expect(codexArgs({ ...t, model: "codex-cli/default" })).not.toContain("-m")
  expect(codexArgs({ ...t, model: "codex-cli/gpt-5" }).join(" ")).toContain("-m gpt-5")
  expect(splitModel("openrouter/meta/llama-4")).toEqual({ provider: "openrouter", model: "meta/llama-4" })
  expect(transcript([{ role: "user", text: "a" }, { role: "assistant", text: "b" }, { role: "user", text: "c" }])).toContain("Nova mensagem do usuário:\nc")
})

const mem = (text: string, confirmedAt: number, scope = "user", kind: Memory["kind"] = "fact", title = ""): Memory => ({ id: text, scope, kind, title, text, state: "active", origin: "manual", chatId: null, createdAt: 0, confirmedAt })
const agentOf = (id: string, name: string, instructions = ""): Agent => ({ id, projectId: "p", name, title: "", description: "", instructions, model: "x/y", accountId: null, effort: null, failover: [], access: "workspace", createdAt: 0 })
const msg = (role: "user" | "assistant", text: string, agentId: string | null = null): Message => ({ id: text, chatId: "c", role, agentId, text, model: null, error: null, steps: [], attachments: [], switches: [], turnId: null, changes: [], revertedAt: null, accountId: null, cost: null, inputTokens: 0, outputTokens: 0, at: 1 })

test("contexto: orçamento de memórias prioriza as recentes; camadas na ordem estável → volátil", () => {
  expect(pinned([mem("velha", 1), mem("nova", 2), mem("x".repeat(50), 3)], 59).map((m) => m.id)).toEqual(["x".repeat(50)])
  const dev = agentOf("a", "Dev", "INSTR")
  const turn = buildTurn({
    chat: { id: "c", projectId: "p", agentIds: ["a", "b"], title: "", accountId: null, effort: null, model: "anthropic/m", summary: "RESUMO", summaryUntil: 0, failover: null, position: null, preview: null, lastAt: null, createdAt: 0 },
    model: "anthropic/m",
    project: { id: "p", name: "P", brief: "BRIEF", path: null, createdAt: 0 },
    agent: dev,
    members: [dev, agentOf("b", "Revisor Sênior", "Revisa PRs")],
    pinned: [mem("EU", 1), mem("PROJ", 1, "project:p"), mem("AG", 1, "agent:a")],
    retrieved: [mem("BUSCA", 1)],
    skills: { all: [mem("corpo", 1, "project:p", "skill", "SKILLTITLE")], relevant: [mem("SKILLBODY", 1, "project:p", "skill", "S")] },
    messages: [msg("user", "oi"), msg("assistant", "minha fala", "a"), msg("assistant", "fala do revisor", "b"), msg("user", "e aí?")],
    cwd: "/tmp"
  })
  const order = ["INSTR", "@revisor-senior", "EU", "BRIEF", "PROJ", "AG", "SKILLTITLE", "SKILLBODY", "RESUMO", "BUSCA"].map((s) => turn.system.indexOf(s))
  expect(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1]!))).toBe(true)
  expect(turn.messages.map(({ role, text }) => ({ role, text }))).toEqual([
    { role: "user", text: "oi" },
    { role: "assistant", text: "minha fala" },
    { role: "user", text: "[Revisor Sênior]\nfala do revisor" },
    { role: "user", text: "e aí?" }
  ])
})

test("menções: por handle sem acento, na ordem, ignorando código", () => {
  const a = [agentOf("1", "Léo"), agentOf("2", "Ana Paula"), agentOf("3", "Nico")]
  expect(mentioned("@ana-paula e @leo, vejam; `@nico` não", a).map((x) => x.id)).toEqual(["2", "1"])
  expect(mentioned("email@nico.com", a).map((x) => x.id)).toEqual(["3"]) // ponytail: simple heuristic, same as a reference app
})

test("política de ferramentas: anotação > nome; sensível vence leitura", () => {
  expect(classify({ name: "search_docs" })).toBe("read")
  expect(classify({ name: "listAndDeleteFiles" })).toBe("sensitive")
  expect(classify({ name: "create_issue" })).toBe("write")
  expect(classify({ name: "create_issue", annotations: { readOnlyHint: true } })).toBe("read")
  expect(needsApproval("approve", "write")).toBe(true)
  expect(needsApproval("auto", "sensitive")).toBe(false)
  expect(exposedName("Meu Jira", "get.issue")).toBe("Meu_Jira__get_issue")
})

test("consolidação: aceita JSON com texto em volta, filtra escopos não permitidos", () => {
  const r = parseConsolidation('ok:\n{"summary":"S","memories":[{"scope":"user","text":"A"},{"scope":"project","text":"B"}],"skills":[{"scope":"user","title":"T","text":"passos"},{"scope":"user","text":"sem título"}]}', ["user"])
  expect(r).toEqual({ summary: "S", memories: [{ scope: "user", text: "A" }], skills: [{ scope: "user", title: "T", text: "passos" }] })
  expect(parseConsolidation("nada", ["user"])).toBeUndefined()
  expect(parseConsolidation('{"summary":""}', ["user"])).toBeUndefined()
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

test("engine de API (OpenAI-compatível): system + histórico vão como mensagens; stream vira text/done", async () => {
  const { sent, server } = mockOpenAi([[
    { choices: [{ index: 0, delta: { role: "assistant", content: "pro" }, finish_reason: null }] },
    { choices: [{ index: 0, delta: { content: "nto" }, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    { choices: [], usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 } }
  ]])
  process.env.OLLAMA_URL = `http://localhost:${server.port}/v1`
  try {
    const events = await runApi({ model: "ollama/llama3", system: "S", messages: [{ role: "user", text: "a" }, { role: "assistant", text: "b" }, { role: "user", text: "c" }], cwd: "/tmp" })
    expect(sent[0].model).toBe("llama3")
    expect(sent[0].messages.map((m: any) => [m.role, m.content])).toEqual([["system", "S"], ["user", "a"], ["assistant", "b"], ["user", "c"]])
    expect(events.filter((e) => e.type === "text").map((e: any) => e.delta).join("")).toBe("pronto")
    expect(events.at(-1)).toEqual({ type: "done", usage: { inputTokens: 7, outputTokens: 2 } })
  } finally {
    server.stop()
    delete process.env.OLLAMA_URL
  }
})

test("engine de API com ferramentas: modelo pede a ferramenta, o Zero executa e devolve o resultado, o modelo conclui", async () => {
  const { sent, server } = mockOpenAi([
    [
      { choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "docs__search", arguments: '{"q":"deploy"}' } }] }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
      { choices: [], usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 } }
    ],
    [
      { choices: [{ index: 0, delta: { role: "assistant", content: "Achei: Vercel." }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      { choices: [], usage: { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 } }
    ]
  ])
  process.env.OLLAMA_URL = `http://localhost:${server.port}/v1`
  const calls: unknown[] = []
  try {
    const events = await runApi({
      model: "ollama/llama3", system: "S", messages: [{ role: "user", text: "onde é o deploy?" }], cwd: "/tmp",
      tools: {
        url: "http://unused",
        defs: [{ name: "docs__search", description: "busca", inputSchema: { type: "object", properties: { q: { type: "string" } } } }],
        call: async (name, args) => {
          calls.push([name, args])
          return { content: [{ type: "text", text: "deploy na Vercel" }] }
        }
      }
    })
    expect(calls).toEqual([["docs__search", { q: "deploy" }]])
    expect(sent[0].tools.map((t: any) => t.function.name)).toEqual(["docs__search"])
    expect(JSON.stringify(sent[1].messages)).toContain("deploy na Vercel") // result went back to the model
    expect(events.filter((e) => e.type === "text").map((e: any) => e.delta).join("")).toBe("Achei: Vercel.")
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

test("skills por $handle: título vira handle; só o handle exato chama a skill", () => {
  const skills = [{ title: "Deploy na Vercel" }, { title: "Revisar PR" }]
  expect(skillHandle("Deploy na Vercel")).toBe("deploy-na-vercel")
  expect(namedSkills("faça o $deploy-na-vercel agora", skills).map((s) => s.title)).toEqual(["Deploy na Vercel"])
  expect(namedSkills("custa $5 e $deploy-na-vercelx", skills)).toEqual([])
})
