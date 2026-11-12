// The prototype's measuring chat (spec 019 T035, quickstart.md): on a running engine with a throwaway data folder,
// creates an agent and a chat over the API, then writes N messages (code blocks, tables, lists, links) straight into
// that folder's database. Never point it at real data.
// Run: bun scripts/seed-long-chat.ts <engine url> <session secret> <data folder> [messages=500]
import { Database } from "bun:sqlite"
import { join } from "node:path"

const [url, token, home, count = "500"] = process.argv.slice(2)
if (!url || !token || !home) throw new Error("usage: seed-long-chat.ts <engine url> <session secret> <data folder> [messages]")
if (home.includes(".zorel")) throw new Error("refusing to seed a real Zorel folder")

const api = async <T>(path: string, body: unknown): Promise<T> => {
  const r = await fetch(`${url}${path}`, { method: "POST", headers: { "x-zorel-token": token, "content-type": "application/json" }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`)
  return r.json() as Promise<T>
}
const model = "anthropic/claude-sonnet-4-5"
const agent = await api<{ id: string }>("/api/agents", { projectId: null, name: "Builder", instructions: "Builds things.", model })
const chat = await api<{ id: string }>("/api/chats", { projectId: null, agentIds: [agent.id], model })

const REPLIES = [
  "Here's the plan:\n\n1. Read the **contract** first\n2. Generate the types\n3. Wire the `rpc` client\n\nSee [the spec](https://example.com/spec).",
  "```rust\nfn main() {\n    let engine = Engine::start(launch).await?;\n    println!(\"{}\", engine.url);\n}\n```\n\nThat starts the server and waits until it answers.",
  "| Gate | Target | Measured |\n|---|---|---|\n| Idle memory | ≤ 180 MB | 40 MB |\n| Launch | ≤ 0.5 s | 0.3 s |\n\nBoth pass.",
  "> A quote from the design doc: tokens before values.\n\nSo every colour comes from `styles.css` and nothing is hard-coded.",
  "- one\n- two\n  - nested\n- three\n\nAnd a longer paragraph that wraps over several lines to make the row taller than the others, with *emphasis* and a bit of `inline code` to measure text shaping cost on a long chat."
]
const db = new Database(join(home, "zorel.db"))
const insert = db.prepare("INSERT INTO messages (id, chat_id, role, agent_id, text, at) VALUES (?, ?, ?, ?, ?, ?)")
const start = Date.now() - Number(count) * 60_000
db.transaction(() => {
  for (let i = 0; i < Number(count); i++) {
    const user = i % 2 === 0
    insert.run(crypto.randomUUID(), chat.id, user ? "user" : "assistant", user ? null : agent.id, user ? `Question ${i / 2 + 1}: how does this part work?` : REPLIES[(i >> 1) % REPLIES.length]!, start + i * 60_000)
  }
})()
db.close()
console.log(JSON.stringify({ agent: agent.id, chat: chat.id, messages: Number(count) }))
