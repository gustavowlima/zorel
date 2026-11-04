import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ChatEvent, ZorelRpc } from "./events.ts"

const decode = Schema.decodeUnknownSync(ChatEvent)
const turn = { id: "t1", chatId: "c1", agentId: "a1", model: "claude-cli/opus", accountId: null, clientId: "client-0001", state: "running", startedAt: 1, endedAt: null, firstTokenAt: null, error: null, usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0 } }

describe("ChatEvent", () => {
  test("decodifica um passo com edição e um handoff", () => {
    const step = decode({
      _tag: "step-finished",
      step: { id: "s1", turnId: "t1", kind: "edit", title: "Edited context.ts", tool: null, files: ["apps/server/src/context.ts"], status: "ok", startedAt: 1, durationMs: 29_000, changes: [{ path: "apps/server/src/context.ts", added: 84, removed: 31, status: "modified" }], output: "" }
    })
    expect(step._tag).toBe("step-finished")
    expect(decode({ _tag: "handoff", turnId: "t1", from: "a1", to: ["a2"], via: "start_task" })._tag).toBe("handoff")
    expect(decode({ _tag: "turn-started", turn })._tag).toBe("turn-started")
  })

  test("recusa tag desconhecida e estado de turno inválido", () => {
    expect(() => decode({ _tag: "nope" })).toThrow()
    expect(() => decode({ _tag: "turn-started", turn: { ...turn, state: "paused" } })).toThrow()
  })

  test("o grupo RPC tem os procedimentos da arquitetura", () => {
    expect([...ZorelRpc.requests.keys()].sort()).toEqual(["approvals", "decide", "interrupt", "runs", "send", "steer", "subscribeChat", "subscribeStatus"])
  })
})
