// Recall by meaning (spec 003): a small sentence model run on this computer (all-MiniLM-L6-v2, 384 dimensions,
// 8-bit, ~23 MB, downloaded once to <dataDir>/models). Facts' vectors live in memory and are computed in the
// background; a turn never waits for the model: until it's ready, or for a fact not processed yet, this source adds
// nothing. ponytail: in memory, recomputed after each start (~1.3 ms per fact); store them if start-up at 10k+
// facts asks for it.
import { join } from "node:path"
import { Effect } from "effect"

const MODEL = "Xenova/all-MiniLM-L6-v2"
type Embed = (texts: string[]) => Promise<Float32Array[]>

let embed: Embed | undefined
let starting: Promise<void> | undefined
const index = new Map<string, { text: string; vector: Float32Array }>() // fact id → its vector and the text it came from
const queue = new Map<string, string>() // fact id → text waiting for a vector
let draining = false

// Loads the model in the background (download on first use). A failure leaves recall without this source.
export function startVectors(dataDir: string): Promise<void> {
  starting ??= (async () => {
    try {
      const { pipeline, env } = await import("@huggingface/transformers")
      env.cacheDir = join(dataDir, "models")
      const extractor = await pipeline("feature-extraction", MODEL, { dtype: "q8" })
      embed = async (texts) => {
        const out = await extractor(texts, { pooling: "mean", normalize: true })
        const dim = out.dims.at(-1)!
        const data = out.data as Float32Array
        return texts.map((_, i) => data.slice(i * dim, (i + 1) * dim))
      }
      drain()
    } catch (e) {
      await Effect.runPromise(Effect.logWarning("recall by meaning is off: the local model didn't load", { error: String(e) }))
    }
  })()
  return starting
}

// Tests and benchmarks: a given embedder (undefined: none).
export function setEmbedder(fn: Embed | undefined) {
  embed = fn
  index.clear()
  queue.clear()
}
export const vectorsReady = () => embed !== undefined

// Facts whose vector is missing or stale go to the background queue.
export function ensure(facts: ReadonlyArray<{ id: string; text: string }>) {
  for (const f of facts) if (index.get(f.id)?.text !== f.text) queue.set(f.id, f.text)
  drain()
}
// Resolves when every queued fact has its vector (benchmarks).
export async function settled(): Promise<void> {
  while (embed && (queue.size || draining)) await new Promise((r) => setTimeout(r, 10))
}

function drain() {
  if (draining || !embed || !queue.size) return
  draining = true
  void (async () => {
    try {
      while (queue.size && embed) {
        const batch = [...queue].slice(0, 32)
        const vectors = await embed(batch.map(([, t]) => t))
        batch.forEach(([id, text], i) => {
          if (queue.get(id) === text) queue.delete(id)
          index.set(id, { text, vector: vectors[i]! })
        })
      }
    } catch (e) {
      queue.clear()
      await Effect.runPromise(Effect.logWarning("recall by meaning: a batch failed", { error: String(e) }))
    } finally {
      draining = false
    }
  })()
}

// The facts closest in meaning to the question, best first: at most k, cosine ≥ min. Facts without a current vector
// are skipped (and queued). Empty when the model isn't ready.
export async function nearest<F extends { id: string; text: string }>(question: string, facts: ReadonlyArray<F>, k: number, min: number): Promise<F[]> {
  if (!embed || !question.trim() || !facts.length) return []
  ensure(facts)
  const [q] = await embed([question])
  const scored: Array<[F, number]> = []
  for (const f of facts) {
    const v = index.get(f.id)
    if (!v || v.text !== f.text) continue
    let s = 0
    for (let i = 0; i < v.vector.length; i++) s += v.vector[i]! * q![i]!
    if (s >= min) scored.push([f, s])
  }
  return scored.sort((a, b) => b[1] - a[1]).slice(0, k).map(([f]) => f)
}
