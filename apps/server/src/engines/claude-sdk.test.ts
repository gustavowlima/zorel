import { describe, expect, test } from "bun:test"
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import { resolveSettings } from "@anthropic-ai/claude-agent-sdk"
import { childEnv, commandOf, mergeResults, SANDBOX_FLAG, SANDBOX_POLICY, settingsLayers, steerGate } from "./claude-sdk.ts"

const commands = [{ name: "review", description: "", argumentHint: null }, { name: "plugin:fix", description: "", argumentHint: null }]

test("commandOf finds a known command at the start of the message", () => {
  expect(commandOf("/review the auth module", commands)).toBe("review")
  expect(commandOf("  /plugin:fix", commands)).toBe("plugin:fix")
  expect(commandOf("/unknown thing", commands)).toBeUndefined()
  expect(commandOf("please /review", commands)).toBeUndefined()
  expect(commandOf("/reviewer", commands)).toBeUndefined()
})

describe("steerGate", () => {
  // A turn whose first frame already carries its own uuid: the CLI is known to stamp.
  const started = (opts: Parameters<typeof steerGate>[0] = {}, own = "me") => {
    const gate = steerGate(opts)
    gate.begin(own)
    expect(gate.see("assistant", [own])).toBe("pass")
    return gate
  }

  // Stop closes the CLI's session when a steer is still waiting (it would otherwise run unseen): abandon says how many.
  test("abandon counts the steers the CLI has not taken, and only those", () => {
    const gate = started()
    expect(gate.accept("s1")).toBe(true)
    expect(gate.accept("s2")).toBe(true)
    gate.consumed(["s1"]) // folded into the turn before the stop: not left behind
    expect(gate.abandon()).toBe(1)
    expect(gate.abandon()).toBe(0) // nothing left after
  })

  test("accepts a steer only while a turn runs and once the CLI is seen stamping our uuids", () => {
    const gate = steerGate()
    expect(gate.accept("a")).toBe(false) // no turn
    gate.begin("me")
    expect(gate.accept("a")).toBe(false) // not seen stamping yet: the runtime sends it another way
    gate.see("assistant", ["me"])
    expect(gate.accept("a")).toBe(true)
    gate.end()
    expect(gate.accept("b")).toBe(false) // the turn ended: the message must be queued instead
  })

  test("a CLI that never stamps never gets a steer", () => {
    const gate = steerGate()
    gate.begin("me")
    gate.see("assistant")
    gate.see("stream_event")
    expect(gate.accept("a")).toBe(false)
    expect(gate.see("result")).toBe("finish")
  })

  test("a result with no steer finishes at once", () => {
    expect(started().see("result", ["me"])).toBe("finish")
  })

  test("a steer folded into the turn: its uuid shows up on a frame, so the result is the last", () => {
    const gate = started()
    gate.accept("a")
    expect(gate.see("assistant", ["me", "a"])).toBe("pass")
    expect(gate.see("result")).toBe("finish")
  })

  test("a steer the turn did not take: the first result is only a segment, the turn ends at the next", () => {
    const gate = started()
    gate.accept("a")
    expect(gate.see("result")).toBe("segment")
    expect(gate.see("assistant", ["a"])).toBe("pass") // the steered text got a turn of its own
    expect(gate.see("result")).toBe("finish")
  })

  test("a slow first token leaks nothing: no clock decides, only the uuids", async () => {
    const gate = started({ limitMs: 10_000 })
    gate.accept("a")
    expect(gate.see("result")).toBe("segment")
    await Bun.sleep(80) // far longer than any grace window
    expect(gate.see("system")).toBe("pass")
    expect(gate.see("result")).toBe("segment") // still waiting on its turn
    gate.consumed(["a"])
    expect(gate.see("result")).toBe("finish")
    gate.end()
  })

  test("several steers: one batch consumed together, or one by one", () => {
    const gate = started()
    gate.accept("a")
    gate.accept("b")
    gate.consumed(["a"])
    expect(gate.see("result")).toBe("segment")
    gate.consumed(["b"])
    expect(gate.see("result")).toBe("finish")
  })

  test("a steer the CLI never consumes: after the limit the turn is closed, and the steer becomes an orphan", async () => {
    let limited = 0
    const gate = started({ limitMs: 20, onLimit: () => limited++ })
    gate.accept("a")
    expect(gate.see("result")).toBe("segment")
    await Bun.sleep(60)
    expect(limited).toBe(1)
    gate.end()
    gate.begin("next")
    expect(gate.see("assistant", ["a"])).toBe("skip") // if it does run later, it is not the next turn's
    gate.end()
  })

  test("frames keep the clock from running out while the steered turn is alive", async () => {
    let limited = 0
    const gate = started({ limitMs: 50, onLimit: () => limited++ })
    gate.accept("a")
    gate.see("result")
    for (let i = 0; i < 4; i++) {
      await Bun.sleep(25)
      gate.see("stream_event", ["a"])
    }
    expect(limited).toBe(0)
    expect(gate.see("result")).toBe("finish")
  })

  describe("a stop with a steer pending", () => {
    // The turn is stopped with "a" still queued in the CLI: it runs as a turn of its own after the stop.
    const stopped = (opts: Parameters<typeof steerGate>[0] = {}) => {
      const gate = started(opts)
      gate.accept("a")
      gate.abandon()
      gate.end()
      return gate
    }

    test("its frames and its late result never end the next turn", () => {
      const gate = stopped()
      gate.begin("next")
      expect(gate.see("system")).toBe("skip")
      expect(gate.see("assistant", ["a"])).toBe("skip")
      expect(gate.see("result")).toBe("skip") // however late it comes
      expect(gate.see("assistant", ["next"])).toBe("pass")
      expect(gate.see("result")).toBe("finish")
      gate.end()
    })

    test("a turn that merged the orphan with the next message is just the next turn", () => {
      const gate = stopped()
      gate.begin("next")
      expect(gate.see("assistant", ["a", "next"])).toBe("pass")
      expect(gate.see("result")).toBe("finish")
    })

    test("an orphan that never runs stops being skipped after the limit", async () => {
      const gate = stopped({ limitMs: 20 })
      gate.begin("next")
      await Bun.sleep(60)
      expect(gate.see("assistant")).toBe("pass")
      gate.end()
    })

    test("a new turn that never gets its stamp is closed at the limit, not left to the stall guard", async () => {
      let limited = 0
      const gate = stopped({ limitMs: 20, onLimit: () => limited++ })
      gate.begin("next")
      expect(gate.see("assistant")).toBe("skip")
      expect(gate.see("result")).toBe("skip") // its own result is among the skipped
      await Bun.sleep(60)
      expect(limited).toBe(1)
      gate.end()
    })

    test("a steer the stopped turn had already taken is not an orphan", () => {
      const gate = started()
      gate.accept("a")
      gate.consumed(["a"]) // folded in just before the stop
      gate.abandon()
      gate.end()
      gate.begin("next")
      expect(gate.see("assistant", ["next"])).toBe("pass")
    })
  })

  test("a new turn starts clean", () => {
    const gate = started()
    gate.accept("a")
    gate.end()
    gate.begin("n")
    expect(gate.see("result")).toBe("finish")
  })
})

describe("mergeResults", () => {
  const result = (usage: Record<string, number>, extra: object = {}) => ({ type: "result", subtype: "success", is_error: false, usage, ...extra }) as unknown as SDKMessage

  test("adds up the usage of every segment into the last result", () => {
    const merged = mergeResults([result({ input_tokens: 10, output_tokens: 5 }), result({ input_tokens: 1, cache_read_input_tokens: 7 })], result({ input_tokens: 2, output_tokens: 3 }, { result: "final" })) as unknown as { usage: Record<string, number>; result: string }
    expect(merged.usage).toMatchObject({ input_tokens: 13, output_tokens: 8, cache_read_input_tokens: 7, cache_creation_input_tokens: 0 })
    expect(merged.result).toBe("final")
  })

  test("without earlier segments the result is untouched", () => {
    const last = result({ input_tokens: 2 })
    expect(mergeResults([], last)).toBe(last)
  })
})

describe("sandbox layers", () => {
  test("the restrictions go in the policy tier, the choices of Zorel's in the flag layer", () => {
    const l = settingsLayers(true)
    expect(l.managedSettings.sandbox).toEqual(SANDBOX_POLICY)
    expect(l.managedSettings.sandbox?.allowUnsandboxedCommands).toBe(false)
    expect(JSON.stringify(l.managedSettings)).not.toContain("allowLocalBinding") // the tier would drop it without a word
    expect(l.sandbox).toEqual(SANDBOX_FLAG)
    expect(l.sandbox?.network.allowLocalBinding).toBe(true)
    expect(l.sandbox?.autoAllowBashIfSandboxed).toBe(false)
  })

  test("without a sandbox (full access, Windows) there is no sandbox block at all, and the lock stays", () => {
    const l = settingsLayers(false) as Record<string, any>
    expect(l.sandbox).toBeUndefined()
    expect(l.managedSettings.sandbox).toBeUndefined()
    expect(l.managedSettings).toMatchObject({ allowManagedPermissionRulesOnly: true, disableAllHooks: true })
  })

  test("nothing Zorel puts in the policy tier is dropped by the SDK's own filter", async () => {
    const r = await resolveSettings({ settingSources: [], managedSettings: settingsLayers(true).managedSettings } as never)
    expect(r.effective.sandbox).toMatchObject(SANDBOX_POLICY)
  })
})

describe("childEnv", () => {
  const zsh = () => true
  test("macOS: commands run in zsh, not the bash 3.2 of /bin/bash", () => {
    expect(childEnv(undefined, "darwin", { SHELL: "/bin/bash" }, zsh).CLAUDE_CODE_SHELL).toBe("/bin/zsh")
  })
  test("a shell the person set is kept", () => {
    expect(childEnv(undefined, "darwin", { CLAUDE_CODE_SHELL: "/opt/homebrew/bin/bash" }, zsh).CLAUDE_CODE_SHELL).toBe("/opt/homebrew/bin/bash")
  })
  test("macOS without /bin/zsh: nothing is set", () => {
    expect(childEnv(undefined, "darwin", {}, () => false).CLAUDE_CODE_SHELL).toBeUndefined()
  })
  test("Linux and Windows are left alone", () => {
    expect(childEnv(undefined, "linux", { SHELL: "/bin/bash" }, zsh).CLAUDE_CODE_SHELL).toBeUndefined()
    expect(childEnv(undefined, "win32", {}, zsh).CLAUDE_CODE_SHELL).toBeUndefined()
  })
  test("the app's own server settings do not reach the agent (its tests would use the installed app's migrations)", () => {
    const e = childEnv(undefined, "linux", { ZOREL_MIGRATIONS: "/app/drizzle", ZOREL_DB: "/real.db", ZOREL_HOME: "/real", ZOREL_PARENT_PID: "1", ZOREL_WEB_DIR: "/w", PATH: "/bin" }, zsh)
    expect(Object.keys(e).filter((k) => k.startsWith("ZOREL_"))).toEqual([])
    expect(e.PATH).toBe("/bin")
  })
  test("the account's folder and the gateway timeout still go through", () => {
    const e = childEnv("/acct", "linux", { A: "1" }, zsh)
    expect(e).toMatchObject({ A: "1", CLAUDE_CONFIG_DIR: "/acct" })
    expect(Number(e.MCP_TOOL_TIMEOUT)).toBeGreaterThan(30 * 60_000)
  })
})
