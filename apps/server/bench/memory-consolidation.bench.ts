// Memory system benchmark, part 2 (real model): runs the app's own consolidation (chat.ts consolidate, force)
// over scripted conversations and scores what it proposes. One model call per case (15 total).
// Run: bun apps/server/bench/memory-consolidation.bench.ts [model, default claude-cli/haiku] [case ids, comma-separated]
import type { Memory } from "@zorel/contracts"
import { Effect, Layer, Stream } from "effect"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { consolidate, DataDir } from "../src/chat.ts"
import { Store } from "../src/db.ts"
import { Engines, type Usage } from "../src/engines.ts"
import { Secrets } from "../src/secrets.ts"

const MODEL = process.argv[2] ?? "claude-cli/haiku"
process.env.ZOREL_MEMORY_MODEL = MODEL // the knob consolidate() reads (chat.ts)

type Line = [role: "user" | "assistant", text: string]
interface Case {
  id: string
  what: string
  project?: boolean
  agent?: boolean
  existing?: Array<{ scope: "user" | "project"; text: string; state?: Memory["state"] }>
  lines: Line[]
  expect: RegExp[] // each must match some proposed memory/skill (fact learned)
  forbid: RegExp[] // none may match a proposal (false memory)
  secrets?: string[] // must not appear in proposals nor in the summary
  replaced?: RegExp // correction: the old active memory matching this must not stay active as-is
  ask?: string // a later question in other words: once approved, search must find what was learned
  confirm?: RegExp // an existing memory that should be confirmed (not duplicated)
}

const CASES: Case[] = [
  { id: "prefs", what: "explicit preferences", lines: [["user", "Quick note: I prefer answers as bullet points, and please never use emojis with me."], ["assistant", "Got it — bullet points, no emojis."]], expect: [/bullet/i, /emoji/i], forbid: [], ask: "how should replies be laid out for me?" },
  { id: "bio", what: "facts about the person", lines: [["user", "Context: I'm a backend developer at Acme Corp, I work mostly in Go and Postgres."], ["assistant", "Thanks! I'll keep Go and Postgres in mind."], ["user", "Cool. Can you explain what a CTE is?"], ["assistant", "A CTE is a named subquery defined with WITH..."]], expect: [/acme/i, /\bgo\b|golang/i], forbid: [/cte/i] },
  { id: "asst-claims", what: "assistant assumption must not become memory", lines: [["user", "Which database would you pick for a small queue?"], ["assistant", "I'd use DynamoDB. I assume your team is already all-in on AWS and runs Kubernetes."], ["user", "ok, thanks"]], expect: [], forbid: [/dynamo/i, /aws/i, /kubernetes/i] },
  { id: "correction", what: "moved city; old memory exists", existing: [{ scope: "user", text: "Lives in Porto, Portugal." }], lines: [["user", "Small update: actually I moved to Berlin last month, I don't live in Porto anymore."], ["assistant", "Congrats on the move to Berlin!"]], expect: [/berlin/i], forbid: [/lives in porto/i], replaced: /porto/i, ask: "which city is my home now?" },
  { id: "api-key", what: "secret in the text", project: true, lines: [["user", "Use this OpenAI key for the script: sk-proj-Zx9QwErTy7781LmNoPq. Also, we always deploy on Fridays after 4pm."], ["assistant", "Will do."]], expect: [/friday/i], forbid: [/sk-proj/i], secrets: ["sk-proj-Zx9QwErTy7781LmNoPq"] },
  { id: "chitchat", what: "nothing to learn", lines: [["user", "hey, how's it going?"], ["assistant", "All good! How can I help?"], ["user", "nothing much, nice weather today"], ["assistant", "Enjoy it!"]], expect: [], forbid: [/weather/i, /./] },
  { id: "project-facts", what: "project facts", project: true, agent: true, lines: [["user", "For this project: staging lives at staging.acme.dev and we deploy with GitHub Actions on merge to main."], ["assistant", "Noted."]], expect: [/staging\.acme\.dev/i, /github actions/i], forbid: [] },
  { id: "procedure", what: "user corrects how to do something", project: true, agent: true, lines: [["user", "Run the tests."], ["assistant", "Running `bun test` from the repo root."], ["user", "No — here you always run `bun test --bail` from apps/server, the root picks up the e2e suite which needs Docker."], ["assistant", "Understood, running `bun test --bail` in apps/server."]], expect: [/bun test --bail|--bail/i], forbid: [] },
  { id: "transient", what: "transient state", lines: [["user", "I'm starving, going to grab lunch, brb in 30 min"], ["assistant", "Enjoy your lunch!"]], expect: [], forbid: [/lunch|hungry|starving/i] },
  { id: "third-party", what: "someone else's preference", lines: [["user", "My colleague João prefers tabs, but I always use spaces, 2 of them."], ["assistant", "Spaces it is."]], expect: [/spaces/i], forbid: [/(prefers|uses) tabs/i], ask: "how do I like my code indented?" },
  { id: "asst-invents", what: "assistant invents details", lines: [["user", "Write a two-line poem about my cat."], ["assistant", "Whiskers the orange tabby naps in the sun, / dreaming of mice and a race never run."], ["user", "nice"]], expect: [], forbid: [/whiskers/i, /orange|tabby/i] },
  { id: "password", what: "password + real fact", project: true, lines: [["user", "The prod DB password is Hunter2!Prod and the database is Postgres 16 on RDS."], ["assistant", "Thanks."]], expect: [/postgres 16/i], forbid: [/hunter2/i], secrets: ["Hunter2!Prod"], ask: "what database engine runs in production?" },
  { id: "forgotten", what: "user asked to forget 'Likes emojis'", existing: [{ scope: "user", text: "Likes emojis", state: "forgotten" }], lines: [["user", "lol 😂😂 I love emojis honestly"], ["assistant", "Ha!"]], expect: [], forbid: [/emoji/i] },
  { id: "confirm", what: "existing memory said again", existing: [{ scope: "user", text: "Prefers TypeScript for new code." }], lines: [["user", "As always, TypeScript for the new service please."], ["assistant", "Sure."]], expect: [], forbid: [/typescript/i], confirm: /typescript/i },
  { id: "temporary", what: "time-boxed instruction", lines: [["user", "Just for this week, reply in Spanish — I'm practicing for a trip."], ["assistant", "¡Claro!"]], expect: [], forbid: [/prefers.*spanish|replies? in spanish|speaks spanish/i] }
]

// Engines.layer wrapped to record usage and wall time of each consolidation call.
const calls: Array<{ usage?: Usage; ms: number; error?: string; text: string }> = []
const Measured = Layer.effect(
  Engines,
  Effect.gen(function* () {
    const inner = yield* Engines
    return {
      ...inner,
      run: (t) => {
        const c: (typeof calls)[number] = { ms: 0, text: "" }
        const t0 = performance.now()
        calls.push(c)
        return inner.run(t).pipe(
          Stream.tap((ev) => Effect.sync(() => { if (ev.type === "done") c.usage = ev.usage; if (ev.type === "error") c.error = ev.message; if (ev.type === "text") c.text += ev.delta })),
          Stream.ensuring(Effect.sync(() => { c.ms = performance.now() - t0 }))
        )
      }
    }
  })
).pipe(Layer.provide(Engines.layer))

const only = process.argv[3]?.split(",")

// One fresh database per case: no case sees another's proposals or forgotten memories.
const runCase = (c: Case) => {
  const dir = mkdtempSync(join(tmpdir(), "zorel-consolidation-"))
  const services = Layer.mergeAll(Layer.provideMerge(Measured, Layer.provideMerge(Secrets.memory(), Store.layer(join(dir, "bench.db")))), DataDir.layer(dir))
  return Effect.gen(function* () {
    const store = yield* Store
    const project = yield* store.createProject({ name: "Acme", brief: "" })
    const agent = yield* store.createAgent({ projectId: project.id, name: "Dev", instructions: "", model: MODEL })
    const chat = (yield* store.createChat({ projectId: c.project ? project.id : null, agentIds: c.agent ? [agent.id] : [], model: MODEL }))!
    const old = []
    for (const e of c.existing ?? [])
      old.push((yield* store.addMemory({ scope: e.scope === "user" ? "user" : `project:${project.id}`, text: e.text, state: e.state ?? "active", origin: "manual", chatId: null }))!)
    for (const [role, text] of c.lines) yield* store.addMessage({ chatId: chat.id, role, agentId: role === "assistant" && c.agent ? agent.id : null, text, steps: [] } as any)
    const before = calls.length
    const t0 = performance.now()
    const after = yield* consolidate(chat.id, true).pipe(Effect.orDie)
    const ms = performance.now() - t0
    const proposed = (yield* store.memories()).filter((m) => m.chatId === chat.id)
    const texts = proposed.map((m) => `${m.title} ${m.text}`)
    const learned = c.expect.filter((r) => texts.some((t) => r.test(t))).length
    const falses = texts.filter((t) => c.forbid.some((r) => r.test(t)))
    const leaked = (c.secrets ?? []).filter((s) => texts.some((t) => t.includes(s)) || after.summary.includes(s))
    const now = yield* Effect.forEach(old, (m) => store.memory(m.id))
    // A correction waits for review as an update that replaces the old memory (approving applies it).
    const replaced = c.replaced ? proposed.some((m) => old.some((o) => o.id === m.replaces && c.replaced!.test(o.text))) : undefined
    const confirmed = c.confirm ? now.some((m, i) => !!m && m.confirmedAt > old[i]!.confirmedAt) : undefined
    // Approve what was learned, then ask in other words (the keywords' job).
    let found: boolean | undefined
    if (c.ask) {
      for (const m of proposed) yield* store.updateMemory(m.id, { state: "active" })
      const scopes = ["user", `project:${project.id}`, ...(c.agent ? [`agent:${agent.id}`] : [])]
      const hits = yield* store.searchMemories(scopes, c.ask, [], 5)
      found = hits.some((h) => proposed.some((p) => p.id === h.id))
    }
    const call = calls[before]
    console.error(`${c.id}: ${proposed.length} proposals, ${ms.toFixed(0)} ms${call?.error ? ` ERROR ${call.error}` : ""}`)
    return { c, proposed, learned, falses, leaked, replaced, confirmed, found, ms, call, summary: after.summary, parsed: after.summaryUntil > 0 }
  }).pipe(Effect.scoped, Effect.provide(services))
}

const rows = []
for (const c of CASES.filter((c) => !only || only.includes(c.id))) rows.push(await Effect.runPromise(runCase(c)))

console.log(`\n## Part 2 — consolidation with ${MODEL} (${rows.length} cases, ${calls.length} model calls)\n`)
console.log("| case | what | proposals | learned | missed | false | secret leaked | correction | confirmed | found in other words | parsed | ms | in/out tok |")
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|")
const yn = (b: boolean | undefined) => (b === undefined ? "–" : b ? "yes" : "NO")
for (const r of rows)
  console.log(
    `| ${r.c.id} | ${r.c.what} | ${r.proposed.length} | ${r.learned}/${r.c.expect.length} | ${r.c.expect.length - r.learned} | ${r.falses.length} | ${r.c.secrets ? (r.leaked.length ? "YES" : "no") : "–"} | ${yn(r.replaced)} | ${yn(r.confirmed)} | ${yn(r.found)} | ${r.parsed ? "yes" : "NO"} | ${r.ms.toFixed(0)} | ${r.call?.usage ? `${r.call.usage.inputTokens}/${r.call.usage.outputTokens}` : "?"} |`
  )
const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((n, r) => n + f(r), 0)
console.log(`\nTotals: learned ${sum((r) => r.learned)}/${sum((r) => r.c.expect.length)}, false ${sum((r) => r.falses.length)}, secrets leaked ${sum((r) => r.leaked.length)}/${sum((r) => r.c.secrets?.length ?? 0)}, corrections handled ${rows.filter((r) => r.replaced).length}/${rows.filter((r) => r.replaced !== undefined).length}, confirms ${rows.filter((r) => r.confirmed).length}/${rows.filter((r) => r.confirmed !== undefined).length}, found in other words ${rows.filter((r) => r.found).length}/${rows.filter((r) => r.found !== undefined).length}, parse failures ${rows.filter((r) => !r.parsed).length}`)
const lat = rows.map((r) => r.ms).sort((a, b) => a - b)
console.log(`Latency per consolidation: p50 ${lat[Math.floor(lat.length / 2)]?.toFixed(0)} ms, max ${lat.at(-1)?.toFixed(0)} ms`)
console.log("\n### Proposals per case\n")
for (const r of rows) {
  console.log(`- ${r.c.id}:${r.proposed.length ? "" : " (none)"}`)
  for (const m of r.proposed) console.log(`  - [${m.kind} ${m.scope.split(":")[0]}] ${m.title ? `${m.title}: ` : ""}${m.text.replace(/\n/g, " ⏎ ")}`)
  if (r.c.secrets) console.log(`  - summary: ${r.summary.slice(0, 300).replace(/\n/g, " ")}`)
  if (process.env.BENCH_RAW) console.log(`  - raw: ${r.call?.text.replace(/\n/g, " ")}`)
}
