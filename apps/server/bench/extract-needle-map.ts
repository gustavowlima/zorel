// Freezes the app's own map extraction (MAP_SYSTEM, as the backfill runs it) of the recall benchmark's needles into
// fixtures/needle-map.json, so the benchmark measures recall through a real map without a model call per run.
// Run once by hand when NEEDLES or MAP_SYSTEM change: bun bench/extract-needle-map.ts [model, default claude-cli/haiku]
import { Effect, Layer, Stream } from "effect"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { MAP_SYSTEM, parseMapItems } from "../src/chat.ts"
import { mappedOf } from "../src/context.ts"
import { Store } from "../src/db.ts"
import { Engines } from "../src/engines.ts"
import { Secrets } from "../src/secrets.ts"
import { NEEDLES } from "./needles.ts"

const model = process.argv[2] ?? "claude-cli/haiku"
const dir = mkdtempSync(join(tmpdir(), "zorel-needle-map-"))
const services = Layer.provideMerge(Engines.layer, Layer.provideMerge(Secrets.memory(), Store.layer(join(dir, "bench.db"))))

const text = NEEDLES.map((n, i) => `#${i + 1} ${n.text}`).join("\n")
const answer = await Effect.runPromise(
  Effect.gen(function* () {
    const engines = yield* Engines
    return yield* Stream.runFold(engines.run({ model, system: MAP_SYSTEM, messages: [{ role: "user", text }], cwd: dir }), () => ({ text: "", error: "" }), (acc, ev) =>
      ev.type === "text" ? { ...acc, text: acc.text + ev.delta } : ev.type === "error" ? { ...acc, error: ev.message } : acc
    )
  }).pipe(Effect.scoped, Effect.provide(services))
)
if (answer.error) throw new Error(answer.error)
const items = parseMapItems(answer.text)
const out = NEEDLES.map((n, i) => {
  const item = items.find((x) => x.n === i + 1)
  if (!item) throw new Error(`no map for needle #${i + 1}: ${n.text}`)
  return { text: n.text, ...mappedOf(item.entities, item.relations) }
})
writeFileSync(join(import.meta.dir, "fixtures", "needle-map.json"), `[\n${out.map((o) => JSON.stringify(o)).join(",\n")}\n]\n`)
console.log(`${out.length} needles mapped with ${model}`)
