import { describe, expect, test } from "bun:test"
import { commandOf, extraArgs } from "./receipt-args.ts"

const call = (tool: string, args: unknown) => ({ tool, args: typeof args === "string" ? args : JSON.stringify(args) })

describe("commandOf", () => {
  test("names the shell command or the file", () => {
    expect(commandOf(call("run", { command: "bun test" }))).toBe("bun test")
    expect(commandOf(call("edit", { file_path: "a.ts", old: "x" }))).toBe("a.ts")
  })
  test("falls back to the tool when there is no command or the arguments are not JSON", () => {
    expect(commandOf(call("search", { query: "q" }))).toBe("search")
    expect(commandOf(call("search", "not json"))).toBe("search")
  })
})

describe("extraArgs", () => {
  test("with a command: nothing when it is the only argument, the whole JSON when there are more", () => {
    const only = call("run", { command: "ls" })
    expect(extraArgs(only, commandOf(only))).toBeUndefined()
    const more = call("run", { command: "ls", timeout: 5 })
    expect(extraArgs(more, commandOf(more))).toBe(JSON.stringify({ command: "ls", timeout: 5 }, null, 2))
  })
  test("only a path: nothing more to show", () => {
    const a = call("read", { path: "src/a.ts" })
    expect(extraArgs(a, commandOf(a))).toBeUndefined()
  })
  test("one argument that is not a command (an MCP tool): shows it, since the line holds only the tool's name", () => {
    const a = call("search", { query: "zorel" })
    expect(extraArgs(a, commandOf(a))).toBe(JSON.stringify({ query: "zorel" }, null, 2))
  })
  test("no arguments or not JSON: nothing", () => {
    expect(extraArgs(call("ping", {}), "ping")).toBeUndefined()
    expect(extraArgs(call("ping", "nope"), "ping")).toBeUndefined()
  })
})
