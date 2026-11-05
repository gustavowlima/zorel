// Memory system benchmark, part 1 (no model): seeds synthetic memories through the real Store and
// measures insert throughput, the turn's memory selection (chat.ts prepare → pinned + FTS retrieved),
// recall of planted facts (lexical and paraphrased queries), dedupe, prompt budget and scope leakage.
// Run: bun apps/server/bench/memory-recall.bench.ts [sizes, default 100,1000,10000]
import type { Agent, Chat, Memory } from "@zorel/contracts"
import { Effect } from "effect"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { prepare } from "../src/chat.ts"
import { MEMORY_BUDGET, pinned, RETRIEVED, scopesOf } from "../src/context.ts"
import { type Repository, Store } from "../src/db.ts"

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
const noiseFact = (scope: string): string => {
  const n = Math.floor(rnd() * 1000)
  if (scope === "user")
    return pick([
      () => `Prefers ${pick(W.style)} when discussing ${pick(W.lang)} code (${n})`,
      () => `Uses ${pick(W.tool)} as the main editor for ${pick(W.lang)} projects, setup ${n}`,
      () => `Has meetings on ${pick(W.day)} mornings and prefers async updates, slot ${n}`,
      () => `Likes ${pick(W.style)} and reviews pull requests in batches of ${n % 9 + 2}`,
      () => `Learning ${pick(W.lang)} on weekends, chapter ${n}`
    ])()
  if (scope.startsWith("project"))
    return pick([
      () => `The ${pick(W.svc)} service deploys to ${pick(W.host)} through ${pick(W.ci)} (pipeline ${n})`,
      () => `The ${pick(W.svc)} service stores its data in ${pick(W.db)}, cluster ${n}`,
      () => `The ${pick(W.team)} team owns the ${pick(W.svc)} module since sprint ${n}`,
      () => `Releases of ${pick(W.svc)} happen ${pick(W.cadence)}, train ${n}`,
      () => `Port ${3000 + n} serves the ${pick(W.svc)} API in development`,
      () => `Feature flag ${pick(W.svc)}_v${n} gates the new ${pick(W.svc)} flow`
    ])()
  return pick([
    () => `When reviewing ${pick(W.lang)} code, check ${pick(W.thing)} first (rule ${n})`,
    () => `Run ${pick(W.cmd)} before opening a pull request for ${pick(W.svc)} (rule ${n})`,
    () => `For the ${pick(W.svc)} module, prefer small commits and mention ticket ${n}`
  ])()
}
const noiseSkill = () => {
  const s = pick(W.svc)
  const n = Math.floor(rnd() * 1000)
  return { title: `Ship a ${s} hotfix #${n}`, text: `1. Branch from main.\n2. Run ${pick(W.cmd)}.\n3. Deploy ${s} to ${pick(W.host)}.\n4. Post in #${pick(W.team)}.` }
}

// Planted facts: [scope kind, text, lexical query, paraphrase query (no shared content words)]
type Needle = { scope: "user" | "project" | "agent"; text: string; lex: string; para: string }
const NEEDLES: Needle[] = [
  { scope: "user", text: "Daughter's name is Marina and she starts school in March.", lex: "when does Marina start school?", para: "when do classes begin for my kid?" },
  { scope: "user", text: "Prefers dark roast coffee without sugar.", lex: "how do I like my coffee roast?", para: "what hot drink should you bring me in the morning?" },
  { scope: "user", text: "Runs a half marathon every October in Lisbon.", lex: "which marathon do I run in Lisbon?", para: "what race am I training for this autumn?" },
  { scope: "user", text: "Is allergic to penicillin.", lex: "am I allergic to penicillin?", para: "which antibiotic can't I take?" },
  { scope: "user", text: "Reads code reviews on an iPad during the commute.", lex: "where do I read code reviews on the iPad?", para: "what device do I use on the train?" },
  { scope: "user", text: "Speaks Portuguese at home and English at work.", lex: "do I speak Portuguese at home?", para: "which tongue does my family use?" },
  { scope: "user", text: "Hates being interrupted with notifications before 10am.", lex: "can you send notifications before 10am?", para: "is it okay to ping me early?" },
  { scope: "user", text: "Drives a 2019 Volvo XC40 hybrid.", lex: "which Volvo do I drive?", para: "what car do I own?" },
  { scope: "project", text: "The billing service deploys to Fly.io from the release branch.", lex: "where does billing deploy?", para: "how do payments go live?" },
  { scope: "project", text: "Postgres backups run nightly at 03:00 UTC to an S3 bucket named zorel-pg-archive.", lex: "when do the postgres backups run?", para: "what time is the database snapshot taken?" },
  { scope: "project", text: "The staging environment password rotates every 30 days.", lex: "how often does the staging password rotate?", para: "when do pre-production credentials change?" },
  { scope: "project", text: "Image uploads are capped at 12 megabytes by the CDN.", lex: "what is the image upload cap?", para: "how big can a picture be?" },
  { scope: "project", text: "The mobile app supports Android 10 and newer only.", lex: "which Android versions does the app support?", para: "what's the minimum phone OS?" },
  { scope: "project", text: "Customer emails are sent through Postmark, never SES.", lex: "do customer emails go through Postmark?", para: "which provider delivers our transactional mail?" },
  { scope: "project", text: "Kubernetes namespace for the search cluster is search-prod-eu.", lex: "what namespace is the search cluster in?", para: "where does the lookup engine run in k8s?" },
  { scope: "project", text: "Invoices must be kept for seven years for tax compliance.", lex: "how long must invoices be kept?", para: "what is our retention period for bills?" },
  { scope: "project", text: "The design system uses Inter for body text and Söhne for headings.", lex: "which font for headings in the design system?", para: "what typeface do titles use?" },
  { scope: "project", text: "Load tests showed the checkout endpoint saturates at 1,800 requests per second.", lex: "when does the checkout endpoint saturate?", para: "what's the throughput ceiling of the purchase API?" },
  { scope: "project", text: "The analytics warehouse is BigQuery, dataset events_v2.", lex: "which BigQuery dataset is the analytics warehouse?", para: "where is telemetry stored for reporting?" },
  { scope: "project", text: "Legal approved the new privacy policy on 2026-09-14.", lex: "when did legal approve the privacy policy?", para: "did the lawyers sign off on the data notice?" },
  { scope: "agent", text: "When writing SQL migrations, always add a down migration and test it on a copy of production.", lex: "how should I write SQL migrations?", para: "what's the rule for schema changes?" },
  { scope: "agent", text: "Before touching the auth module, read docs/auth-threat-model.md.", lex: "what to read before the auth module?", para: "anything to review before changing login code?" },
  { scope: "agent", text: "The flaky test in payments_spec retries three times on CI; ignore single failures.", lex: "is the payments spec test flaky?", para: "a checkout check broke once in the pipeline, should I worry?" },
  { scope: "agent", text: "Translations live in locales/*.json and must keep keys sorted alphabetically.", lex: "where do translations live?", para: "how do I add a new language string?" },
  { scope: "agent", text: "Use pnpm, not npm, in the legacy dashboard repository.", lex: "pnpm or npm in the legacy dashboard?", para: "which package manager for the old admin panel?" }
]

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
      r.addMemory({ scope: scopeOf(n.scope), text: n.text, state: "active", origin: "manual", chatId: null }).pipe(Effect.map((m) => { needleIds.set(n.text, m!.id); inserted++ }))
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
          const m = yield* r.addMemory({ scope, text: noiseFact(scope), state, origin: "auto", chatId: null, ...(bob ? { owner: "bob" } : {}) })
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

    // Pinned set is the same for every query (recency only): compute once, as prepare does.
    const active = yield* r.activeMemories(scopes)
    const [, activeMs] = yield* time(r.activeMemories(scopes))
    const pin = pinned(active)
    const pinnedIds = new Set(pin.map((m) => m.id))
    const pinnedChars = pin.reduce((n, m) => n + m.text.length + 3, 0)

    const lat: number[] = [], searchLat: number[] = []
    const res = { lex: { h1: 0, h5: 0, prompt: 0, rr: 0 }, para: { h1: 0, h5: 0, prompt: 0, rr: 0 } }
    const leaks: string[] = []
    let memChars: number[] = [], retrievedChars: number[] = [], promptChars: number[] = []
    const misses: string[] = []
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
      activeMs, pinnedCount: pin.length, pinnedChars, needlesPinned: NEEDLES.filter((n) => pinnedIds.has(needleIds.get(n.text)!)).length,
      lat, searchLat, res, misses, leaks, memChars, retrievedChars, promptChars, dedupe, crossOwnerSwallowed: bobsCopy === undefined, bobPinned,
      pinnedByScope: ['user', 'project', 'agent'].map((k) => pin.filter((m) => m.scope.startsWith(k)).length).join(' / '),
      activeByScope: ['user', 'project', 'agent'].map((k) => active.filter((m) => m.scope.startsWith(k)).length).join(' / ')
    }
  })

const sizes = (process.argv[2] ?? "100,1000,10000").split(",").map(Number)
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
console.log(`\n## Part 1 — memory selection (budget ${MEMORY_BUDGET} chars, ${RETRIEVED} retrieved, ${Q} needles × 2 query types)\n`)
console.log("| metric | " + results.map((r) => `${r.total}`).join(" | ") + " |")
console.log("|---|" + results.map(() => "---").join("|") + "|")
const row = (name: string, f: (r: (typeof results)[number]) => string) => console.log(`| ${name} | ${results.map(f).join(" | ")} |`)
row("insert throughput (memories/s, addMemory, file DB)", (r) => (((r.noise + Q) / r.insertMs) * 1000).toFixed(0))
row("distinct memories kept (exact-normalized dedupe)", (r) => `${r.inserted}/${r.noise + Q}`)
row("active facts in chat scopes (user+project+agent)", (r) => `${r.scopesSize}`)
row("activeMemories() (loads all, every turn) ms", (r) => ms(r.activeMs))
row("prepare() p50 / p95 / max ms", (r) => `${ms(pct(r.lat, 50))} / ${ms(pct(r.lat, 95))} / ${ms(Math.max(...r.lat))}`)
row("searchMemories() p50 / p95 / max ms", (r) => `${ms(pct(r.searchLat, 50))} / ${ms(pct(r.searchLat, 95))} / ${ms(Math.max(...r.searchLat))}`)
row("pinned memories / chars (budget respected?)", (r) => `${r.pinnedCount} / ${r.pinnedChars} (${r.pinnedChars <= MEMORY_BUDGET ? "yes" : "NO"})`)
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

// --check (CI): fail when an invariant breaks. Asked in the needles' own words, every one reaches the prompt; no
// memory crosses a scope or an owner; the pinned layer stays within its budget.
if (process.argv.includes("--check")) {
  const broken = results.flatMap((r) => [
    ...(r.res.lex.prompt < Q ? [`${r.total}: ${Q - r.res.lex.prompt} needles asked in their own words missed the prompt`] : []),
    ...(r.leaks.length ? [`${r.total}: ${r.leaks.length} leaks`] : []),
    ...(r.bobPinned ? [`${r.total}: another owner's memories pinned`] : []),
    ...(r.pinnedChars > MEMORY_BUDGET ? [`${r.total}: pinned ${r.pinnedChars} chars, over the budget`] : [])
  ])
  if (broken.length) {
    console.error(`\nmemory check failed:\n${broken.map((b) => `- ${b}`).join("\n")}`)
    process.exit(1)
  }
  console.log("\nmemory check ok")
}
