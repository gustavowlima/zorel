import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { antigravityFileStatus } from "./accounts.ts"
import { antigravityLoginFile } from "./engines.ts"

test("An extra Antigravity account is signed in when its folder holds agy's login file, named by its e-mail", () => {
  const dir = mkdtempSync(join(tmpdir(), "zorel-agy-account-"))
  expect(antigravityFileStatus(dir)).toEqual({ loggedIn: false, identity: null })
  const file = antigravityLoginFile(dir)
  mkdirSync(join(file, ".."), { recursive: true })
  writeFileSync(file, JSON.stringify({ auth_method: "oauth-personal", id_token_email: "someone@example.com", token: "secret" }))
  expect(antigravityFileStatus(dir)).toEqual({ loggedIn: true, identity: "someone@example.com" })
  writeFileSync(file, "not json")
  expect(antigravityFileStatus(dir)).toEqual({ loggedIn: false, identity: null })
})
