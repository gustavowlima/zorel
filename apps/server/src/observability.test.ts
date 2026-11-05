import { expect, test } from "bun:test"
import { Effect, Logger } from "effect"
import { mask, registerSecret } from "./observability.ts"

test("registered secrets never show up in the log, not even inside MCP JSON", async () => {
  registerSecret("sk-or-1234567890")
  registerSecret(JSON.stringify({ Authorization: "Bearer abcdef123456" }))
  registerSecret("123") // too short: ignored so common text isn't masked
  expect(mask("key sk-or-1234567890 used")).toBe("key *** used")
  expect(mask("header Bearer abcdef123456")).toBe("header ***")
  expect(mask("turn 123 ok")).toBe("turn 123 ok")

  const lines: string[] = []
  const capture = Logger.formatLogFmt.pipe(Logger.map(mask), Logger.map((l) => lines.push(l)))
  await Effect.runPromise(Effect.logInfo("failed with sk-or-1234567890").pipe(Effect.annotateLogs({ key: "sk-or-1234567890" }), Effect.provide(Logger.layer([capture])))) // gitleaks:allow (a fake key: the test checks the log hides it)
  expect(lines.join("\n")).not.toContain("sk-or-1234567890")
  expect(lines.join("\n")).toContain("***")
})
