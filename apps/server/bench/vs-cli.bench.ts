// Zorel vs the CLI alone (the project's goal: cheaper and better than using Claude Code directly). Same small project,
// same model, same messages: four turns in one session, then a fifth in a new session that needs what was said before.
// Sides: Claude Code as installed (the person's settings, plugins and MCP servers), Claude Code bare (none of those, as
// Zorel runs it), and Zorel (its real runtime, a temporary database). Measures input tokens (cached included), cached
// share, output, cost, time, and whether the new session remembers. Real model calls on your subscription.
// Run: bun bench/vs-cli.bench.ts [model, default sonnet] [--only installed,bare,zorel]
import { type ChatEvent } from "@zorel/contracts/events"
import { Deferred, Effect, Fiber, Layer, Stream } from "effect"
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { Accounts } from "../src/accounts.ts"
import { Audit } from "../src/audit.ts"
import { BrowserService } from "../src/browser.ts"
import { DataDir } from "../src/chat.ts"
import { Store } from "../src/db.ts"
import { Engines } from "../src/engines.ts"
import { Pricing } from "../src/pricing.ts"
import { Runtime } from "../src/runtime.ts"
import { Secrets } from "../src/secrets.ts"
import { Tools } from "../src/tools.ts"
import { startVectors, vectorsReady } from "../src/vectors.ts"
import { Workspace } from "../src/workspace.ts"

const MODEL = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "sonnet"
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1]!.split(",") : ["installed", "bare", "zorel"]

const SESSION_ONE = [
  "Read this project and tell me in two sentences what it does.",
  "Which function computes the order total, and in which file?",
  "Remember for later: our team only deploys on Thursdays.",
  "List the edge cases that function doesn't handle yet."
]
const SESSION_TWO = "New question: when does our team deploy, and where is the order total computed?"
const remembers = (text: string) => /thursday/i.test(text) && /cart\.js/i.test(text)

// One price table for every side (Zorel's catalog, copied from ~/.zorel): each side's own estimate isn't comparable.
const PRICES = join(homedir(), ".zorel", "pricing.json")
const MODELS = join(homedir(), ".cache", "zorel", "models")
const dataDir = () => {
  const d = mkdtempSync(join(tmpdir(), "zorel-vs-data-"))
  if (existsSync(PRICES)) copyFileSync(PRICES, join(d, "pricing.json"))
  if (existsSync(MODELS)) cpSync(MODELS, join(d, "models"), { recursive: true }) // the local model (spec 003), not downloaded again
  return d
}

// A small project, the same for every side (a fresh copy each).
function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "zorel-vs-"))
  mkdirSync(join(dir, "src"))
  writeFileSync(join(dir, "README.md"), "# shop-cart\n\nA tiny shopping cart library: add items, apply a coupon, compute the order total with tax.\n")
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "shop-cart", version: "1.0.0", type: "module", scripts: { test: "node --test" } }, null, 2))
  writeFileSync(
    join(dir, "src", "cart.js"),
    [
      "export const TAX = 0.08",
      "export function addItem(cart, item) {",
      "  return { ...cart, items: [...cart.items, item] }",
      "}",
      "export function applyCoupon(cart, coupon) {",
      "  return { ...cart, coupon }",
      "}",
      "// The order total: items, minus the coupon's percent, plus tax.",
      "export function orderTotal(cart) {",
      "  const sum = cart.items.reduce((n, i) => n + i.price * i.qty, 0)",
      "  const off = cart.coupon ? sum * (cart.coupon.percent / 100) : 0",
      "  return Math.round((sum - off) * (1 + TAX) * 100) / 100",
      "}"
    ].join("\n")
  )
  writeFileSync(join(dir, "src", "format.js"), "export const money = (n) => `$${n.toFixed(2)}`\n")
  return dir
}

interface Turn { input: number; cached: number; output: number; cost: number; ms: number; text: string }

// ---------- Claude Code alone ----------
async function cli(bare: boolean): Promise<Turn[]> {
  const dir = project()
  const extra = bare ? ["--setting-sources", "", "--strict-mcp-config"] : []
  const one = async (text: string, resume?: string) => {
    const t = performance.now()
    const p = Bun.spawn(["claude", "-p", text, "--output-format", "json", "--model", MODEL, ...(resume ? ["--resume", resume] : []), ...extra], { cwd: dir, stdout: "pipe", stderr: "pipe" })
    const out = await new Response(p.stdout).text()
    await p.exited
    const j = JSON.parse(out) as { session_id: string; result: string; total_cost_usd: number; usage: { input_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number; output_tokens: number } }
    const u = j.usage
    const cached = u.cache_read_input_tokens ?? 0
    return { session: j.session_id, turn: { input: u.input_tokens + cached + (u.cache_creation_input_tokens ?? 0), cached, output: u.output_tokens, cost: j.total_cost_usd, ms: performance.now() - t, text: j.result } }
  }
  const turns: Turn[] = []
  let session: string | undefined
  for (const m of SESSION_ONE) {
    const r = await one(m, session)
    session = r.session
    turns.push(r.turn)
  }
  turns.push((await one(SESSION_TWO)).turn) // a new session
  return turns
}

// ---------- Zorel ----------
function zorel(): Promise<Turn[]> {
  const dir = project()
  const data = dataDir()
  const base = Layer.mergeAll(Layer.provideMerge(Layer.mergeAll(Engines.layer, Tools.layer), Layer.provideMerge(Secrets.memory(), Store.layer(join(data, "zorel.db")))), DataDir.layer(data))
  const layer = Layer.provideMerge(Runtime.layer, Layer.provideMerge(Layer.mergeAll(Accounts.layer, Workspace.layer, Pricing.layer, Audit.layer, BrowserService.layer), base))
  const model = `claude-cli/${MODEL}`
  const ask = (chatId: string, text: string) =>
    Effect.gen(function* () {
      const runtime = yield* Runtime
      const store = yield* Store
      const ready = yield* Deferred.make<void>()
      const events: ChatEvent[] = []
      const fiber = yield* runtime.subscribeChat(chatId).pipe(
        Stream.tap((e) => (e._tag === "snapshot" ? Deferred.succeed(ready, undefined) : Effect.sync(() => { events.push(e); if (process.env.VS_DEBUG) console.error(`  event ${e._tag}`) }))),
        Stream.takeUntil((e) => e._tag === "turn-completed" || e._tag === "turn-failed"),
        Stream.runDrain,
        Effect.forkChild
      )
      yield* Deferred.await(ready)
      const t = performance.now()
      const { turnId } = yield* runtime.send({ chatId, clientId: crypto.randomUUID(), text })
      yield* Fiber.join(fiber).pipe(Effect.timeout("4 minutes"))
      const row = (yield* store.turnRow(turnId))!
      console.error(`  zorel turn ${row.state} in ${((performance.now() - t) / 1000).toFixed(0)} s`)
      const reply = (yield* store.messages(chatId)).at(-1)!
      if (row.state !== "completed") throw new Error(`turn ${row.state}: ${row.error}`)
      return { input: row.inputTokens, cached: row.cachedTokens, output: row.outputTokens, cost: row.cost ?? 0, ms: performance.now() - t, text: reply.text } satisfies Turn
    })
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const store = yield* Store
        const p = yield* store.createProject({ name: "shop-cart", brief: "", path: dir })
        yield* Effect.promise(() => startVectors(data)) // as in an app already open: the local model is loaded
        console.error(`  local model ready: ${vectorsReady()}`)
        const first = yield* store.createChat({ projectId: p.id, agentIds: [], model })
        const turns: Turn[] = []
        for (const m of SESSION_ONE) turns.push(yield* ask(first.id, m))
        const second = yield* store.createChat({ projectId: p.id, agentIds: [], model })
        turns.push(yield* ask(second.id, SESSION_TWO))
        return turns
      })
    ).pipe(Effect.provide(layer)) as Effect.Effect<Turn[]>
  )
}

const sides: Array<[string, () => Promise<Turn[]>]> = [
  ["Claude Code (as installed)", () => cli(false)],
  ["Claude Code (bare)", () => cli(true)],
  ["Zorel", zorel]
].filter(([, ], i) => only.includes(["installed", "bare", "zorel"][i]!)) as Array<[string, () => Promise<Turn[]>]>

const pricing = await Effect.runPromise(Effect.gen(function* () { return yield* Pricing }).pipe(Effect.provide(Pricing.layer.pipe(Layer.provide(DataDir.layer(dataDir()))))))
const results: Array<{ name: string; turns: Turn[] }> = []
const saved = join(tmpdir(), `zorel-vs-${MODEL}-${Date.now()}.json`)
for (const [name, run] of sides) {
  console.log(`running ${name}…`)
  results.push({ name, turns: await run() })
  writeFileSync(saved, JSON.stringify(results, null, 1)) // raw turns, kept even if the report fails
}
console.log(`raw turns: ${saved}`)

const priced = (ts: Turn[]) => ts.reduce((n, t) => n + (pricing.cost(`claude-cli/${MODEL}`, { inputTokens: t.input, outputTokens: t.output, cachedTokens: t.cached }) ?? Number.NaN), 0)
const sum = (ts: Turn[], k: keyof Omit<Turn, "text">) => ts.reduce((n, t) => n + t[k], 0)
console.log(`\n## ${MODEL}: ${SESSION_ONE.length} turns in one session + 1 in a new one\n`)
console.log("| side | input tokens | cached | uncached | output | cost USD (same prices) | cost USD (as reported) | time s | new session remembers |")
console.log("|---|---|---|---|---|---|---|---|---|")
for (const { name, turns } of results) {
  const input = sum(turns, "input"), cached = sum(turns, "cached")
  console.log(`| ${name} | ${input} | ${((cached / (input || 1)) * 100).toFixed(1)}% | ${input - cached} | ${sum(turns, "output")} | ${priced(turns).toFixed(4)} | ${sum(turns, "cost").toFixed(4)} | ${(sum(turns, "ms") / 1000).toFixed(0)} | ${remembers(turns.at(-1)!.text) ? "yes" : "no"} |`)
}
console.log("\nPer turn (input tokens):")
for (const { name, turns } of results) console.log(`- ${name}: ${turns.map((t) => t.input).join(" / ")}`)
console.log("\nLast answers:")
for (const { name, turns } of results) console.log(`- ${name}: ${turns.at(-1)!.text.replace(/\s+/g, " ").slice(0, 200)}`)
process.exit(0) // Zorel's runtime keeps background work (routines, sleep) alive
