// LongMemEval-S retrieval, zero model: each question's past sessions become chats of one project, the question is asked
// in a new chat of it, and the score is whether a session holding the answer is among the first k sessions recall
// ranks (hit@k, k = 5, 10: the same definition ai-memory publishes), and whether it reaches the turn within the
// recall budget (in-turn). Abstention questions (*_abs) are skipped, as there.
// Dataset (MIT): xiaowu0162/longmemeval, downloaded once to ~/.cache/zorel, checked against the hash ai-memory pins.
// Run: bun bench/longmemeval.bench.ts [--limit N] [--types a,b]
import { Effect } from "effect"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { recall } from "../src/chat.ts"
import { scopesOf } from "../src/context.ts"
import { Store } from "../src/db.ts"

const URL = "https://huggingface.co/datasets/xiaowu0162/longmemeval/resolve/main/longmemeval_s"
const SHA256 = "08d8dad4be43ee2049a22ff5674eb86725d0ce5ff434cde2627e5e8e7e117894"
const FILE = join(homedir(), ".cache", "zorel", "longmemeval_s.json")
const KS = [5, 10] as const

interface Question {
  question_id: string
  question_type: string
  question: string
  haystack_session_ids: string[]
  haystack_sessions: Array<Array<{ role: "user" | "assistant"; content: string }>>
  answer_session_ids: string[]
}

const arg = (name: string) => {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : undefined
}

async function dataset(): Promise<Question[]> {
  if (!existsSync(FILE)) {
    mkdirSync(join(homedir(), ".cache", "zorel"), { recursive: true })
    console.log(`downloading ${URL} (~278 MB) to ${FILE}`)
    const res = await fetch(URL)
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`)
    await Bun.write(FILE, res)
  }
  const bytes = await Bun.file(FILE).arrayBuffer()
  const hash = createHash("sha256").update(new Uint8Array(bytes)).digest("hex")
  if (hash !== SHA256) throw new Error(`${FILE}: sha256 ${hash}, expected ${SHA256}. Delete it to download again.`)
  return JSON.parse(new TextDecoder().decode(bytes)) as Question[]
}

// One question in a fresh database: the haystack as chats, the question in a new chat, recall's ranked sessions.
const runOne = (q: Question) =>
  Effect.gen(function* () {
    const store = yield* Store
    const project = yield* store.createProject({ name: "LongMemEval", brief: "" })
    for (const [i, session] of q.haystack_sessions.entries()) {
      const chat = (yield* store.createChat({ projectId: project.id, agentIds: [], model: "x/y", title: q.haystack_session_ids[i]! }))!
      for (const turn of session)
        if (turn.content.trim()) yield* store.addMessage({ chatId: chat.id, role: turn.role, agentId: null, text: turn.content, steps: [] } as any)
    }
    const asking = (yield* store.createChat({ projectId: project.id, agentIds: [], model: "x/y", title: "question" }))!
    yield* store.addMessage({ chatId: asking.id, role: "user", agentId: null, text: q.question, steps: [] } as any)
    const t = performance.now()
    const found = yield* recall(store, scopesOf(asking, null), q.question, [], { projectId: project.id, chatId: asking.id, after: Number.MAX_SAFE_INTEGER })
    const ms = performance.now() - t
    const titles = new Map((yield* store.chats()).map((c) => [c.id, c.title]))
    const sessions = [...new Set(found.ranked.flatMap((r) => (r.chatId ? [titles.get(r.chatId)!] : [])))]
    const inTurn = new Set(found.excerpts.map((e) => titles.get(e.chatId)!))
    const evidence = new Set(q.answer_session_ids)
    return {
      hit: Object.fromEntries(KS.map((k) => [k, sessions.slice(0, k).some((s) => evidence.has(s)) ? 1 : 0])) as Record<(typeof KS)[number], number>,
      inTurn: [...inTurn].some((s) => evidence.has(s)) ? 1 : 0,
      ms
    }
  })

const all = await dataset()
const types = arg("--types")?.split(",")
const scored = all.filter((q) => !q.question_id.endsWith("_abs") && (!types || types.includes(q.question_type)))
const questions = scored.slice(0, Number(arg("--limit") ?? scored.length))
const rows: Array<{ type: string; hit: Record<number, number>; inTurn: number; ms: number }> = []
const started = performance.now()
for (const [i, q] of questions.entries()) {
  const dir = mkdtempSync(join(tmpdir(), "zorel-lme-"))
  const r = await Effect.runPromise(Effect.scoped(runOne(q).pipe(Effect.provide(Store.layer(join(dir, "q.db"))))))
  rmSync(dir, { recursive: true, force: true })
  rows.push({ type: q.question_type, ...r })
  if ((i + 1) % 25 === 0) console.log(`${i + 1}/${questions.length} (${((performance.now() - started) / 1000).toFixed(0)} s)`)
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const line = (rs: typeof rows) => `hit@5 ${mean(rs.map((r) => r.hit[5]!)).toFixed(3)}  hit@10 ${mean(rs.map((r) => r.hit[10]!)).toFixed(3)}  in-turn ${mean(rs.map((r) => r.inTurn)).toFixed(3)}  (n=${rs.length})`
const p50 = [...rows.map((r) => r.ms)].sort((a, b) => a - b)[Math.floor(rows.length / 2)] ?? 0
console.log(`\nLongMemEval-S (zero model) — ${rows.length} questions scored, ${all.length - all.filter((q) => !q.question_id.endsWith("_abs")).length} abstention skipped`)
console.log(`${line(rows)}  recall p50 ${p50.toFixed(1)} ms`)
for (const t of [...new Set(rows.map((r) => r.type))].sort()) console.log(`- ${t}: ${line(rows.filter((r) => r.type === t))}`)
console.log("ai-memory 3.4.3 (FTS + observation stream): hit@5 0.951")
