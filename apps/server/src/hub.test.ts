import { afterAll, expect, test } from "bun:test"
import type { McpServer } from "@zorel/contracts"
import { Hub } from "./tools.ts"

// A service that rejects every credential, as a revoked token gets.
const refusing = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("unauthorized", { status: 401 }) })
afterAll(() => refusing.stop(true))

const secrets = { get: () => undefined, set: async () => {}, fromEnv: () => false }
const server = (id: string): McpServer => ({ id, projectId: null, name: "x", command: "", args: [], url: `http://127.0.0.1:${refusing.port}/mcp`, envKeys: [], mode: "approve", auth: "none", enabled: true, createdAt: 0 })

test("a refused sign-in marks the server, and new credentials clear it", async () => {
  const hub = new Hub(secrets)
  await expect(hub.tools(server("s1"))).rejects.toThrow()
  expect(hub.refused.has("s1")).toBe(true)
  await hub.close("s1") // what changing the token or signing in again does
  expect(hub.refused.has("s1")).toBe(false)
})

test("a server that's down isn't a refused sign-in", async () => {
  const hub = new Hub(secrets)
  await expect(hub.tools({ ...server("s2"), url: "http://127.0.0.1:9/mcp" })).rejects.toThrow()
  expect(hub.refused.has("s2")).toBe(false)
})
