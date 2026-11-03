// Fake `codex app-server` for tests: answers the handshake and streams a scripted turn.
// FAKE_CODEX=nologin: no account. Prompt "hang": never completes (to test interrupt). Prompt "die": exits.
const out = (m: object) => process.stdout.write(`${JSON.stringify(m)}\n`)
let turn = 0
for await (const line of console) {
  const m = JSON.parse(line)
  if (m.method === "initialize") out({ id: m.id, result: { codexHome: process.env.CODEX_HOME } })
  else if (m.method === "account/read") out({ id: m.id, result: { account: process.env.FAKE_CODEX === "nologin" ? null : { type: "chatgpt", email: null, planType: "pro" }, requiresOpenaiAuth: true } })
  else if (m.method === "thread/start") out({ id: m.id, result: { thread: { id: "th-1" }, model: m.params.model ?? "gpt" } })
  else if (m.method === "turn/start") {
    const id = `tu-${++turn}`
    const text: string = m.params.input[0].text
    out({ id: m.id, result: { turn: { id, status: "inProgress" } } })
    if (text.includes("die")) process.exit(3)
    if (text.includes("hang")) {
      out({ method: "item/agentMessage/delta", params: { threadId: "th-1", turnId: id, itemId: "i1", delta: "parcial" } })
      continue
    }
    out({ method: "item/agentMessage/delta", params: { threadId: "th-1", turnId: id, itemId: "i1", delta: `eco ${turn}` } })
    out({ method: "item/agentMessage/delta", params: { threadId: "th-1", turnId: id, itemId: "i2", delta: "fim" } })
    out({ method: "thread/tokenUsage/updated", params: { threadId: "th-1", turnId: id, tokenUsage: { last: { inputTokens: 10, outputTokens: 2 } } } })
    out({ method: "turn/completed", params: { threadId: "th-1", turn: { id, status: "completed", error: null } } })
  } else if (m.method === "turn/interrupt") {
    out({ id: m.id, result: {} })
    out({ method: "turn/completed", params: { threadId: "th-1", turn: { id: m.params.turnId, status: "interrupted", error: null } } })
  } else if (m.id !== undefined) out({ id: m.id, result: {} })
}

export {}
