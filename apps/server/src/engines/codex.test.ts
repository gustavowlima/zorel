import { expect, test } from "bun:test"
import { Effect, Fiber, Stream } from "effect"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { EngineEvent } from "#server/engines.ts"
import { openCodexSession } from "#server/engines/codex.ts"
import type { EngineSession } from "#server/engines/session.ts"

const fake = join(import.meta.dir, "fixtures", "fake-codex-app-server.ts")
const open = (env?: string) => {
  if (env) process.env.FAKE_CODEX = env
  else delete process.env.FAKE_CODEX
  const s = openCodexSession({
    model: "codex-cli/default", system: "S", cwd: join(tmpdir(), "zorel-codex-test"), home: join(tmpdir(), "zorel-codex-home"), web: false,
    gatewayUrl: "http://127.0.0.1:9/mcp", access: "ask", approve: async () => false, command: [process.execPath, fake]
  })
  if (typeof s === "string") throw new Error(s)
  return s
}
const turn = (s: EngineSession, prompt: string) => Effect.runPromise(Stream.runCollect(s.turn({ model: "codex-cli/default", prompt }))) as Promise<EngineEvent[]>

test("codex: one process, text across messages, usage and completion per turn", async () => {
  const s = open()
  const a = await turn(s, "hi")
  expect(a).toEqual([{ type: "text", delta: "echo 1" }, { type: "text", delta: "\n\nend" }, { type: "done", usage: { inputTokens: 10, outputTokens: 2, cachedTokens: 4 } }])
  const b = await turn(s, "again")
  expect(b[0]).toEqual({ type: "text", delta: "echo 2" }) // same thread, same process
  await Effect.runPromise(s.close)
})

test("codex: without a Zorel login the turn fails fast with the login hint", async () => {
  const s = open("nologin")
  const ev = await turn(s, "hi")
  expect(ev).toHaveLength(1)
  expect(ev[0]).toMatchObject({ type: "error" })
  expect((ev[0] as { message: string }).message).toContain("codex login")
  expect(s.alive()).toBe(false) // next turn reopens (e.g. after logging in)
  await Effect.runPromise(s.close)
})

test("codex: interrupting asks Codex to stop and the session stays usable; a dead process fails the turn", async () => {
  const s = open()
  const fiber = Effect.runFork(Stream.runCollect(s.turn({ model: "codex-cli/default", prompt: "hang" })))
  await Bun.sleep(300)
  await Effect.runPromise(Fiber.interrupt(fiber))
  expect((await turn(s, "later"))[0]).toEqual({ type: "text", delta: "echo 2" })
  const died = await turn(s, "die")
  expect(died.at(-1)).toMatchObject({ type: "error" })
  expect(s.alive()).toBe(false)
})

test("codex: effort goes with the turn (max = xhigh); steering joins the running turn", async () => {
  const s = open()
  const e = await Effect.runPromise(Stream.runCollect(s.turn({ model: "codex-cli/default", prompt: "hi", effort: "max" })))
  expect(e[0]).toEqual({ type: "text", delta: "echo 1 (xhigh)" })
  expect(await s.steer!("nothing to fix")).toBe(false) // no turn running
  const fiber = Effect.runFork(Stream.runCollect(s.turn({ model: "codex-cli/default", prompt: "hang" })))
  await Bun.sleep(300)
  expect(await s.steer!("use the src folder")).toBe(true)
  const events = await Effect.runPromise(Fiber.join(fiber))
  expect(events.map((x) => (x.type === "text" ? x.delta : x.type))).toEqual(["partial", "\n\ncorrected: use the src folder", "done"])
  await Effect.runPromise(s.close)
})
