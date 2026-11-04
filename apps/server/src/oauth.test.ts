import { expect, test } from "bun:test"
import { finishSignIn, isSignedIn, McpOAuth } from "./oauth.ts"
import type { SecretStore } from "./secrets.ts"

const memory = (): SecretStore => {
  const m = new Map<string, string>()
  return { get: (n) => m.get(n), set: async (n, v) => void (v ? m.set(n, v) : m.delete(n)), fromEnv: () => false }
}
const url = async () => "https://example.invalid/mcp"

test("the callback only accepts a state Zorel issued, once", async () => {
  const secrets = memory()
  await expect(finishSignIn(secrets, "made-up", "code", url)).rejects.toThrow("expired")
  const state = new McpOAuth(secrets, "s1").state()
  // Issued: gets past the state check (then fails reaching the fake service).
  await expect(finishSignIn(secrets, state, "code", url)).rejects.not.toThrow("expired")
  await expect(finishSignIn(secrets, state, "code", url)).rejects.toThrow("expired") // single use
})

test("tokens live in the secret store, per server", async () => {
  const secrets = memory()
  await new McpOAuth(secrets, "s1").saveTokens({ access_token: "a", token_type: "bearer" })
  expect(isSignedIn(secrets, "s1")).toBe(true)
  expect(isSignedIn(secrets, "s2")).toBe(false)
  await new McpOAuth(secrets, "s1").invalidateCredentials("tokens")
  expect(isSignedIn(secrets, "s1")).toBe(false)
})
