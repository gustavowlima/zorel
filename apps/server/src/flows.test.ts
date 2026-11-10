import { describe, expect, test } from "bun:test"
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js"
import { argsProblem, listToolFor, mayRetry, neverRan, optionsOf, resolveValue, savedArgsProblem, textFieldOf } from "./flows.ts"

describe("neverRan and mayRetry", () => {
  test("a connection that didn't open, or a request refused before running, never ran", () => {
    expect(neverRan(new Error("ECONNREFUSED"), "connect")).toBe(true)
    for (const code of [ErrorCode.ParseError, ErrorCode.InvalidRequest, ErrorCode.MethodNotFound, ErrorCode.InvalidParams]) expect(neverRan(new McpError(code, "no"), "call")).toBe(true)
  })
  test("closed, timed out, internal or unknown after sending may have run", () => {
    for (const code of [ErrorCode.ConnectionClosed, ErrorCode.RequestTimeout, ErrorCode.InternalError]) expect(neverRan(new McpError(code, "x"), "call")).toBe(false)
    expect(neverRan(new Error("socket hang up"), "call")).toBe(false)
  })
  test("a read retries on any failure; a write only when it surely never ran", () => {
    expect(mayRetry(false, { error: new McpError(ErrorCode.RequestTimeout, "t"), phase: "call", ranWithError: false })).toBe(true)
    expect(mayRetry(false, { phase: "call", ranWithError: true })).toBe(true)
    expect(mayRetry(true, { error: new McpError(ErrorCode.RequestTimeout, "t"), phase: "call", ranWithError: false })).toBe(false)
    expect(mayRetry(true, { phase: "call", ranWithError: true })).toBe(false) // it ran and said no
    expect(mayRetry(true, { error: new Error("refused"), phase: "connect", ranWithError: false })).toBe(true)
  })
})

describe("picking fields and ids", () => {
  test("textFieldOf finds the one required message field", () => {
    expect(textFieldOf({ properties: { channel_id: { type: "string" }, text: { type: "string" } }, required: ["channel_id", "text"] })).toBe("text")
    expect(textFieldOf({ properties: { text: { type: "string" }, body: { type: "string" } }, required: ["text", "body"] })).toBeUndefined()
    expect(textFieldOf({ properties: { text: { type: "string" } } })).toBeUndefined()
  })
  test("listToolFor: channel_id finds list_channels before search and get", () => {
    const tools = [
      { name: "get_channel", cls: "read" as const },
      { name: "send_message", cls: "sensitive" as const },
      { name: "list_channels", cls: "read" as const },
      { name: "searchChannels", cls: "read" as const }
    ]
    expect(listToolFor("channel_id", tools)).toBe("list_channels")
    expect(listToolFor("listId", [{ name: "get_lists", cls: "read" }])).toBe("get_lists")
    expect(listToolFor("categoryId", [{ name: "list_categories", cls: "read" }])).toBe("list_categories")
    expect(listToolFor("text", tools)).toBeUndefined()
    expect(listToolFor("project_id", tools)).toBeUndefined()
  })
  test("optionsOf reads ids and names from a list", () => {
    expect(optionsOf(JSON.stringify({ channels: [{ id: "C1", name: "general" }, { id: 7, title: "Seven" }, { nope: 1 }] }))).toEqual([
      { id: "C1", label: "general" },
      { id: "7", label: "Seven" }
    ])
  })
})

describe("values and inputs", () => {
  test("resolveValue reads an earlier step's output by path", () => {
    const outputs = new Map<string, unknown>([["r", { items: [{ id: "a1" }] }], ["a", "hello"]])
    expect(resolveValue({ channel: "C1", item: { $from: "r", path: "items.0.id" }, text: { $from: "a" } }, outputs)).toEqual({ channel: "C1", item: "a1", text: "hello" })
    expect(resolveValue({ $from: "r", path: "missing.x" }, outputs)).toBeUndefined()
  })
  test("argsProblem checks the tool's schema (and ignores $schema)", () => {
    const schema = { $schema: "https://json-schema.org/draft/2020-12/schema", properties: { n: { type: "integer", minimum: 1, maximum: 5 } }, required: ["n"] }
    expect(argsProblem(schema, { n: 3 })).toBeUndefined()
    expect(argsProblem(schema, { n: 9 })).toContain("n")
    expect(argsProblem(schema, {})).toBeDefined()
  })
  test("savedArgsProblem: a value from an earlier step counts as set", () => {
    const schema = { properties: { channel: { type: "string" }, text: { type: "string" } }, required: ["channel", "text"] }
    expect(savedArgsProblem(schema, { channel: "C1", text: { $from: "a" } })).toBeUndefined()
    expect(savedArgsProblem(schema, { text: { $from: "a" } })).toEqual({ field: "channel", problem: "This field is required." })
    expect(savedArgsProblem(schema, { channel: 4, text: "x" })).toBeDefined()
  })
})
