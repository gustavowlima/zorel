import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileVault } from "./secrets.ts"
import { serverModeFrom } from "./server-mode.ts"

test("server mode: off unless asked; needs an https public URL (http only for this machine); listen address parsed", () => {
  expect(serverModeFrom({})).toBeUndefined()
  expect(() => serverModeFrom({ ZOREL_SERVER: "1" })).toThrow("ZOREL_PUBLIC_URL is required")
  expect(() => serverModeFrom({ ZOREL_SERVER: "1", ZOREL_PUBLIC_URL: "http://zorel.example" })).toThrow("must be https")
  expect(() => serverModeFrom({ ZOREL_SERVER: "1", ZOREL_PUBLIC_URL: "nope" })).toThrow("isn't a URL")
  const m = serverModeFrom({ ZOREL_SERVER: "1", ZOREL_PUBLIC_URL: "https://zorel.example/some/path", ZOREL_LISTEN: "0.0.0.0:8080", ZOREL_TRUSTED_PROXIES: "127.0.0.1, 10.0.0.2" })!
  expect(m).toEqual({ host: "0.0.0.0", port: 8080, publicUrl: new URL("https://zorel.example"), trustedProxies: ["127.0.0.1", "10.0.0.2"] })
  expect(serverModeFrom({ ZOREL_SERVER: "1", ZOREL_PUBLIC_URL: "http://localhost:4317" })!.host).toBe("127.0.0.1") // default: this machine only
  expect(serverModeFrom({ ZOREL_SERVER: "1", ZOREL_PUBLIC_URL: "https://a.ts.net", ZOREL_LISTEN: "[::]:4317" })!.host).toBe("::")
  expect(() => serverModeFrom({ ZOREL_SERVER: "1", ZOREL_PUBLIC_URL: "https://a.ts.net", ZOREL_LISTEN: "0.0.0.0:99999" })).toThrow("no valid port")
})

test("file vault: values sealed on disk, readable again with the key, the key file only the user's", async () => {
  const dir = mkdtempSync(join(tmpdir(), "zorel-vault-"))
  const vault = fileVault(dir)
  await vault.set("AUTH_SECRET", "s3cret-value")
  expect(readFileSync(join(dir, "vault.json"), "utf8")).not.toContain("s3cret-value")
  expect(fileVault(dir).get("AUTH_SECRET")).toBe("s3cret-value") // a restart reads it back
  if (process.platform !== "win32") expect(statSync(join(dir, "vault.key")).mode & 0o777).toBe(0o600)
  await vault.set("AUTH_SECRET", "")
  expect(fileVault(dir).get("AUTH_SECRET")).toBeUndefined()
})

test("admin routes: members refused; access-granting changes need a confirmation from the last 5 minutes", async () => {
  const { adminCheck } = await import("./server-routes.ts")
  const now = 1_000_000_000
  const fresh = { role: "admin", sessionAt: now - 60_000 }
  const stale = { role: "admin", sessionAt: now - 10 * 60_000 }
  expect(adminCheck("GET", "/api/projects", { role: "member", sessionAt: 0 }, now)).toBeUndefined()
  expect(adminCheck("GET", "/api/audit", { role: "member", sessionAt: now }, now)).toBe("admins_only")
  expect(adminCheck("PUT", "/api/keys/OPENAI_API_KEY", fresh, now)).toBeUndefined()
  expect(adminCheck("PUT", "/api/keys/OPENAI_API_KEY", stale, now)).toBe("step_up")
  expect(adminCheck("PUT", "/api/preferences/max-running", stale, now)).toBeUndefined() // admin, but not access-granting
  expect(adminCheck("POST", "/api/mcp/abc/options", { role: "member", sessionAt: 0 }, now)).toBeUndefined() // a routine step's options
  expect(adminCheck("POST", "/api/mcp", { role: "member", sessionAt: now }, now)).toBe("admins_only")
})
