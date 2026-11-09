// Memory system benchmark, part 1 (no model): seeds synthetic memories through the real Store and
// measures insert throughput, the turn's memory selection (chat.ts prepare → pinned + FTS retrieved),
// recall of planted facts (lexical and paraphrased queries), dedupe, prompt budget and scope leakage.
// Run: bun apps/server/bench/memory-recall.bench.ts [sizes, default 100,1000,10000]
import type { Agent, Chat, Memory } from "@zorel/contracts"
import { Effect } from "effect"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pinBudget, prepare, recall } from "../src/chat.ts"
import { type Mapped, MEMORY_BUDGET, pinned, RETRIEVED, scopesOf } from "../src/context.ts"
import { type Repository, Store } from "../src/db.ts"
import { ensure, settled, startVectors } from "../src/vectors.ts"
import { homedir } from "node:os"
import { type Needle, NEEDLES } from "./needles.ts"

// The real map of each needle (extract-needle-map.ts, frozen); a needle without one fails the run.
const NEEDLE_MAP = new Map((await Bun.file(join(import.meta.dir, "fixtures", "needle-map.json")).json() as Array<{ text: string } & Mapped>).map((x) => [x.text, x]))
for (const n of NEEDLES) if (!NEEDLE_MAP.has(n.text)) throw new Error(`no map for needle "${n.text}": run bench/extract-needle-map.ts`)
// The lowest paraphrased reach without pinning (map + words) at 1,000 memories that --check accepts.
const PARA_FLOOR = 15
const VECTORS = process.argv.includes("--vectors")
const FLOOR = VECTORS ? 25 : PARA_FLOOR // with the local model (spec 003), measured 25/25

// ---------- deterministic data ----------
let seed = 42
// mulberry32 (32-bit integer math; a float LCG loses precision and cycles early)
const rnd = () => {
  let t = (seed = (seed + 0x6d2b79f5) | 0)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = <T>(xs: ReadonlyArray<T>) => xs[Math.floor(rnd() * xs.length)]!

const W = {
  lang: ["TypeScript", "Go", "Rust", "Python", "Kotlin", "Swift", "Elixir", "Ruby"],
  tool: ["VS Code", "Neovim", "Zed", "IntelliJ", "Cursor", "Helix"],
  style: ["short answers", "bullet lists", "code first", "detailed explanations", "tables for comparisons", "no emojis"],
  svc: ["auth", "orders", "inventory", "notifications", "gateway", "reports", "profile", "catalog", "pricing", "webhooks"],
  host: ["Vercel", "Render", "AWS ECS", "Cloud Run", "Hetzner", "Railway", "Netlify"],
  ci: ["GitHub Actions", "CircleCI", "Buildkite", "GitLab CI"],
  db: ["MySQL", "SQLite", "MongoDB", "Redis", "DynamoDB", "ClickHouse"],
  team: ["platform", "growth", "mobile", "data", "infra", "frontend", "core"],
  cadence: ["weekly", "every two weeks", "monthly", "on demand"],
  thing: ["error handling", "naming", "test coverage", "null checks", "logging", "input validation", "query plans"],
  cmd: ["bun test", "make lint", "cargo clippy", "go vet", "ruff check", "tsc --noEmit"],
  day: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
}
// A noise fact and the list words it was made of: each becomes a point on the map, so noise competes there too.
const noiseFact = (scope: string): { text: string; topics: string[] } => {
  const topics: string[] = []
  const topic = (xs: ReadonlyArray<string>) => { const w = pick(xs); topics.push(w); return w }
  const n = Math.floor(rnd() * 1000)
  const text = make(scope, n, topic)
  return { text, topics: [...new Set(topics)] }
}
const make = (scope: string, n: number, topic: (xs: ReadonlyArray<string>) => string): string => {
  if (scope === "user")
    return pick([
      () => `Prefers ${topic(W.style)} when discussing ${topic(W.lang)} code (${n})`,
      () => `Uses ${topic(W.tool)} as the main editor for ${topic(W.lang)} projects, setup ${n}`,
      () => `Has meetings on ${topic(W.day)} mornings and prefers async updates, slot ${n}`,
      () => `Likes ${topic(W.style)} and reviews pull requests in batches of ${n % 9 + 2}`,
      () => `Learning ${topic(W.lang)} on weekends, chapter ${n}`
    ])()
  if (scope.startsWith("project"))
    return pick([
      () => `The ${topic(W.svc)} service deploys to ${topic(W.host)} through ${topic(W.ci)} (pipeline ${n})`,
      () => `The ${topic(W.svc)} service stores its data in ${topic(W.db)}, cluster ${n}`,
      () => `The ${topic(W.team)} team owns the ${topic(W.svc)} module since sprint ${n}`,
      () => `Releases of ${topic(W.svc)} happen ${topic(W.cadence)}, train ${n}`,
      () => `Port ${3000 + n} serves the ${topic(W.svc)} API in development`,
      () => `Feature flag ${topic(W.svc)}_v${n} gates the new ${topic(W.svc)} flow`
    ])()
  return pick([
    () => `When reviewing ${topic(W.lang)} code, check ${topic(W.thing)} first (rule ${n})`,
    () => `Run ${topic(W.cmd)} before opening a pull request for ${topic(W.svc)} (rule ${n})`,
    () => `For the ${topic(W.svc)} module, prefer small commits and mention ticket ${n}`
  ])()
}
const noiseSkill = () => {
  const s = pick(W.svc)
  const n = Math.floor(rnd() * 1000)
  return { title: `Ship a ${s} hotfix #${n}`, text: `1. Branch from main.\n2. Run ${pick(W.cmd)}.\n3. Deploy ${s} to ${pick(W.host)}.\n4. Post in #${pick(W.team)}.` }
}

// Near-duplicates: [original, variant, should the app treat them as the same memory?]
const NEAR_DUPES: Array<[string, string, string]> = [
  ["Prefers small pull requests", "prefers small pull requests!", "case+punct"],
  ["Prefers small pull requests", "Prefers  small   pull-requests.", "whitespace+hyphen"],
  ["Prefere respostas curtas e diretas", "Prefere respostas curtas e diretas.", "punct"],
  ["Gosta de café sem açúcar", "gosta de cafe sem acucar", "diacritics"],
  ["Prefers small pull requests", "Prefers small PRs", "abbreviation"],
  ["Prefers small pull requests", "Likes pull requests to be small", "reworded"],
  ["The API runs on port 8080", "API runs on port 8080", "dropped article"],
  ["The API runs on port 8080", "The API listens on port 8080", "synonym"],
  ["Deploys happen on Fridays", "Deploys happen on Friday", "plural"],
  ["Uses Neovim as the editor", "The user uses Neovim as their editor", "third-person rewrite"],
  ["Works in the America/Sao_Paulo timezone", "Works in the America/São_Paulo timezone", "diacritics in token"],
  ["Prefers TypeScript over JavaScript", "Prefers JavaScript over TypeScript", "reversed meaning (must NOT merge)"]
]

// ---------- harness ----------
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0
}
const ms = (n: number) => n.toFixed(2)
const time = function* <A>(e: Effect.Effect<A>) {
  const t = performance.now()
  const a = yield* e
  return [a, performance.now() - t] as const
}

const bench = (total: number, r: Repository, dataDir: string) =>
  Effect.gen(function* () {
    const projects = yield* Effect.forEach(Array.from({ length: 10 }, (_, i) => i), (i) => r.createProject({ name: `P${i}`, brief: `Project ${i}` }))
    const agents: Agent[] = yield* Effect.forEach(Array.from({ length: 20 }, (_, i) => i), (i) =>
      r.createAgent({ projectId: projects[i % 10]!.id, name: `Agent ${i}`, instructions: "", model: "claude-cli/haiku" })
    )
    const P0 = projects[0]!, A0 = agents[0]!
    const scopeOf = (s: Needle["scope"]) => (s === "user" ? "user" : s === "project" ? `project:${P0.id}` : `agent:${A0.id}`)

    // 1. Needles first (oldest confirmedAt: they are not favoured by the recency pin).
    const needleIds = new Map<string, string>()
    let inserted = 0
    const [, needleMs] = yield* time(Effect.forEach(NEEDLES, (n) =>
      r.addMemory({ scope: scopeOf(n.scope), text: n.text, state: "active", origin: "manual", chatId: null }).pipe(
        Effect.tap((m) => r.linkMemory(m!.id, m!.scope, NEEDLE_MAP.get(n.text)!)),
        Effect.map((m) => { needleIds.set(n.text, m!.id); inserted++ })
      )
    ))
    // Canaries: same words as needles, but must never reach a P0/A0/alice chat.
    const canaries = new Map<string, string>() // id → why it must not leak
    const canary = (scope: string, text: string, why: string, extra: { owner?: string; state?: Memory["state"] } = {}) =>
      r.addMemory({ scope, text, state: extra.state ?? "active", origin: "manual", chatId: null, ...(extra.owner ? { owner: extra.owner } : {}) }).pipe(
        Effect.map((m) => { if (m) canaries.set(m.id, why) })
      )
    yield* canary(`project:${projects[1]!.id}`, "Billing deploys to Heroku; Marina's school postgres backups run hourly.", "other project")
    yield* canary(`agent:${agents[1]!.id}`, "SQL migrations need a down migration; auth module docs; pnpm in the legacy dashboard.", "other agent")
    yield* canary("user", "Bob's daughter Marina starts school in May; Bob drives a Volvo.", "other owner (bob)", { owner: "bob" })
    yield* canary("user", "Volvo coffee penicillin marathon Lisbon notifications (pending).", "pending state", { state: "pending" })
    yield* canary("user", "Volvo coffee penicillin marathon Lisbon notifications (forgotten).", "forgotten state", { state: "forgotten" })

    // 2. Noise: 20% user (75% alice, 25% bob), 50% projects, 20% agents, 10% skills; 10% pending/forgotten.
    const bobIds = new Set<string>()
    const noise = Math.max(0, total - NEEDLES.length - canaries.size)
    const [, noiseMs] = yield* time(Effect.gen(function* () {
      for (let i = 0; i < noise; i++) {
        const x = rnd()
        const state: Memory["state"] = rnd() < 0.9 ? "active" : rnd() < 0.5 ? "pending" : "forgotten"
        if (x < 0.1) {
          const s = noiseSkill()
          yield* r.addMemory({ scope: rnd() < 0.5 ? "user" : `project:${pick(projects).id}`, kind: "skill", title: s.title, text: s.text, state, origin: "auto", chatId: null })
        } else {
          const scope = x < 0.3 ? "user" : x < 0.8 ? `project:${pick(projects).id}` : `agent:${pick(agents).id}`
          const bob = scope === "user" && rnd() < 0.25
          const f = noiseFact(scope)
          const m = yield* r.addMemory({ scope, text: f.text, state, origin: "auto", chatId: null, ...(bob ? { owner: "bob" } : {}) })
          if (m) yield* r.linkMemory(m.id, scope, { entities: f.topics.map((name) => ({ name, type: "concept" as const })), relations: [] })
          if (m) inserted++
          if (m && bob) bobIds.add(m.id)
        }
      }
    }))

    // 3. Chat as alice in P0 with A0; one message per query (only the last one drives retrieval).
    const chat: Chat = (yield* r.createChat({ projectId: P0.id, agentIds: [A0.id], model: "claude-cli/haiku" }))!
    const scopes = scopesOf(chat, A0.id)
    const turnFor = (q: string) =>
      Effect.gen(function* () {
        yield* r.addMessage({ chatId: chat.id, role: "user", agentId: null, text: q, steps: [] } as any)
        const c = (yield* r.chat(chat.id))!
        return yield* time(prepare(r, c, A0, "claude-cli/haiku", dataDir, undefined))
      })

    // --vectors: the local model (spec 003) gives every fact its vector before the questions.
    if (VECTORS) {
      yield* Effect.promise(() => startVectors(join(homedir(), ".cache", "zorel")))
      ensure(yield* r.activeMemories(scopes))
      yield* Effect.promise(settled)
    }
        // Pinned set is the same for every query (recency only): compute once, as prepare does.
    const active = yield* r.activeMemories(scopes)
    const [, activeMs] = yield* time(r.activeMemories(scopes))
    const pin = pinned(active, pinBudget())
    const pinnedIds = new Set(pin.map((m) => m.id))
    const pinnedChars = pin.reduce((n, m) => n + m.text.length + 3, 0)

    const lat: number[] = [], searchLat: number[] = []
    const res = { lex: { h1: 0, h5: 0, prompt: 0, rr: 0 }, para: { h1: 0, h5: 0, prompt: 0, rr: 0 } }
    const leaks: string[] = []
    let memChars: number[] = [], retrievedChars: number[] = [], promptChars: number[] = []
    const misses: string[] = []
    // How each paraphrased needle reaches the turn: by the map (recall's association part), by its words (FTS), only
    // because it is pinned, or not at all. Recall runs without excluding the pinned, to see what it finds on its own.
    const reach = { map: 0, words: 0, pin: 0, none: 0 }
    const paraMisses: string[] = []
    for (const kind of ["lex", "para"] as const)
      for (const n of NEEDLES) {
        const q = n[kind]
        const [turn, t] = yield* turnFor(q)
        lat.push(t)
        const [found, ts] = yield* time(r.searchMemories(scopes, q, [...pinnedIds], RETRIEVED))
        searchLat.push(ts)
        const id = needleIds.get(n.text)!
        const rank = found.findIndex((m) => m.id === id)
        const o = res[kind]
        if (rank === 0) o.h1++
        if (rank >= 0) { o.h5++; o.rr += 1 / (rank + 1) }
        if (rank >= 0 || pinnedIds.has(id)) o.prompt++
        else misses.push(`${kind}: "${q}" → top: ${found[0]?.text.slice(0, 50) ?? "(nothing)"}`)
        for (const m of [...found, ...pin]) {
          if (canaries.has(m.id)) leaks.push(`${canaries.get(m.id)}: "${m.text.slice(0, 50)}" for "${q}"`)
          if (!scopes.includes(m.scope)) leaks.push(`scope ${m.scope} for "${q}"`)
        }
        if (kind === "para") {
          const recalled = (yield* recall(r, scopes, q, [])).facts
          const byWords = (yield* r.searchMemories(scopes, q, [], RETRIEVED)).some((m) => m.id === id)
          const how = !recalled.some((m) => m.id === id) ? (pinnedIds.has(id) ? "pin" : "none") : byWords ? "words" : "map"
          reach[how]++
          if (how === "none" || how === "pin") paraMisses.push(`${how}: "${q}" → first: ${recalled[0]?.text.slice(0, 50) ?? "(nothing)"}`)
        }
        memChars.push(turn.parts.memories)
        retrievedChars.push(found.reduce((s, m) => s + m.text.length + 3, 0))
        promptChars.push(turn.system.length)
      }
    // Bob's noise in alice's prompt (owner is never filtered).
    const bobPinned = pin.filter((m) => bobIds.has(m.id)).length

    // 4. Dedupe (fresh scope per pair so noise doesn't interfere).
    const dedupe: Array<{ kind: string; merged: boolean }> = []
    for (const [i, [a, b, kind]] of NEAR_DUPES.entries()) {
      const scope = `project:dedupe-${i}`
      yield* r.addMemory({ scope, text: a, state: "active", origin: "manual", chatId: null })
      const second = yield* r.addMemory({ scope, text: b, state: "pending", origin: "auto", chatId: null })
      dedupe.push({ kind, merged: second === undefined })
    }
    // Cross-owner collision: bob saying what alice said is swallowed into alice's row.
    yield* r.addMemory({ scope: "user", text: "Likes tabs over spaces", state: "active", origin: "manual", chatId: null, owner: "alice" })
    const bobsCopy = yield* r.addMemory({ scope: "user", text: "Likes tabs over spaces", state: "active", origin: "manual", chatId: null, owner: "bob" })

    return {
      total, inserted, noise, insertMs: needleMs + noiseMs, scopesSize: active.length,
      activeMs, pinnedCount: pin.length, pinnedChars, budget: pinBudget(), needlesPinned: NEEDLES.filter((n) => pinnedIds.has(needleIds.get(n.text)!)).length,
      lat, searchLat, res, misses, reach, paraMisses, leaks, memChars, retrievedChars, promptChars, dedupe, crossOwnerSwallowed: bobsCopy === undefined, bobPinned,
      pinnedByScope: ['user', 'project', 'agent'].map((k) => pin.filter((m) => m.scope.startsWith(k)).length).join(' / '),
      activeByScope: ['user', 'project', 'agent'].map((k) => active.filter((m) => m.scope.startsWith(k)).length).join(' / ')
    }
  })

const sizes = (process.argv[2]?.startsWith("--") ? "100,1000,10000" : (process.argv[2] ?? "100,1000,10000")).split(",").map(Number)
const results = []
for (const total of sizes) {
  seed = 42
  const dir = mkdtempSync(join(tmpdir(), "zorel-membench-"))
  const out = await Effect.runPromise(
    Effect.scoped(Effect.gen(function* () { return yield* bench(total, yield* Store, dir) }).pipe(Effect.provide(Store.layer(join(dir, "bench.db")))))
  )
  rmSync(dir, { recursive: true, force: true })
  results.push(out)
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1)
const Q = NEEDLES.length
console.log(`\n## Part 1 — memory selection (budget ${results[0]?.budget ?? MEMORY_BUDGET} chars, ${RETRIEVED} retrieved, ${Q} needles × 2 query types)\n`)
console.log("| metric | " + results.map((r) => `${r.total}`).join(" | ") + " |")
console.log("|---|" + results.map(() => "---").join("|") + "|")
const row = (name: string, f: (r: (typeof results)[number]) => string) => console.log(`| ${name} | ${results.map(f).join(" | ")} |`)
row("insert throughput (memories/s, addMemory, file DB)", (r) => (((r.noise + Q) / r.insertMs) * 1000).toFixed(0))
row("distinct memories kept (exact-normalized dedupe)", (r) => `${r.inserted}/${r.noise + Q}`)
row("active facts in chat scopes (user+project+agent)", (r) => `${r.scopesSize}`)
row("activeMemories() (loads all, every turn) ms", (r) => ms(r.activeMs))
row("prepare() p50 / p95 / max ms", (r) => `${ms(pct(r.lat, 50))} / ${ms(pct(r.lat, 95))} / ${ms(Math.max(...r.lat))}`)
row("searchMemories() p50 / p95 / max ms", (r) => `${ms(pct(r.searchLat, 50))} / ${ms(pct(r.searchLat, 95))} / ${ms(Math.max(...r.searchLat))}`)
row("pinned memories / chars (budget respected?)", (r) => `${r.pinnedCount} / ${r.pinnedChars} (${r.pinnedChars <= r.budget ? "yes" : "NO"})`)
row("active by scope user / project / agent", (r) => r.activeByScope)
row("pinned by scope user / project / agent", (r) => r.pinnedByScope)
row("needles that are pinned (recency)", (r) => `${r.needlesPinned}/${Q}`)
for (const k of ["lex", "para"] as const) {
  row(`${k}: FTS hit@1`, (r) => `${r.res[k].h1}/${Q}`)
  row(`${k}: FTS hit@5 (= recall@5)`, (r) => `${r.res[k].h5}/${Q}`)
  row(`${k}: precision@5 (1 relevant per query)`, (r) => (r.res[k].h5 / (Q * RETRIEVED)).toFixed(3))
  row(`${k}: MRR`, (r) => (r.res[k].rr / Q).toFixed(3))
  row(`${k}: reaches the prompt (pinned or retrieved)`, (r) => `${r.res[k].prompt}/${Q}`)
}
row(VECTORS ? "para: reach by map or meaning" : "para: reach by map", (r) => `${r.reach.map}/${Q}`)
row("para: reach by words", (r) => `${r.reach.words}/${Q}`)
row("para: reach by pin only", (r) => `${r.reach.pin}/${Q}`)
row("para: total without pin", (r) => `${r.reach.map + r.reach.words}/${Q}`)
row("para: total", (r) => `${r.reach.map + r.reach.words + r.reach.pin}/${Q}`)
row("memory layer chars in prompt avg (≈ tokens = /4)", (r) => `${avg(r.memChars).toFixed(0)} (~${(avg(r.memChars) / 4).toFixed(0)} tok)`)
row("retrieved section chars avg / max (outside budget)", (r) => `${avg(r.retrievedChars).toFixed(0)} / ${Math.max(...r.retrievedChars)}`)
row("whole system prompt chars avg", (r) => avg(r.promptChars).toFixed(0))
row("scope/state/owner leaks", (r) => `${r.leaks.length}`)
row("bob's user memories pinned in alice's prompt", (r) => `${r.bobPinned}/${r.pinnedCount}`)
row("cross-owner identical text swallowed", (r) => `${r.crossOwnerSwallowed}`)

const last = results.at(-1)!
console.log(`\n### Dedupe (${NEAR_DUPES.length} near-duplicate pairs)\n`)
for (const d of last.dedupe) console.log(`- ${d.kind}: ${d.merged ? "merged" : "kept both"}`)
console.log(`\n### Leaks at ${last.total}\n`)
for (const l of [...new Set(last.leaks)]) console.log(`- ${l}`)
console.log(`\n### Misses at ${last.total} (not pinned, not in top ${RETRIEVED})\n`)
for (const m of last.misses) console.log(`- ${m}`)
console.log(`\n### Paraphrased needles not reached by map or words at ${last.total}\n`)
for (const m of last.paraMisses) console.log(`- ${m}`)

// --check (CI): fail when an invariant breaks. Asked in the needles' own words, every one reaches the prompt; no
// memory crosses a scope or an owner; the pinned layer stays within its budget.
if (process.argv.includes("--check")) {
  const broken = results.flatMap((r) => [
    ...(r.res.lex.prompt < Q ? [`${r.total}: ${Q - r.res.lex.prompt} needles asked in their own words missed the prompt`] : []),
    ...(r.total === 1000 && r.reach.map + r.reach.words < FLOOR ? [`${r.total}: paraphrased reach without pin ${r.reach.map + r.reach.words}/${Q}, below ${FLOOR}`] : []),
    ...(r.leaks.length ? [`${r.total}: ${r.leaks.length} leaks`] : []),
    ...(r.bobPinned ? [`${r.total}: another owner's memories pinned`] : []),
    ...(r.pinnedChars > r.budget ? [`${r.total}: pinned ${r.pinnedChars} chars, over the budget`] : [])
  ])
  if (broken.length) {
    console.error(`\nmemory check failed:\n${broken.map((b) => `- ${b}`).join("\n")}`)
    process.exit(1)
  }
  console.log("\nmemory check ok")
}
