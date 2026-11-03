import { expect, test } from "bun:test"
import { Effect, Logger } from "effect"
import { mask, registerSecret } from "./observability.ts"

test("segredos registrados nunca aparecem no log, nem dentro de JSON de MCP", async () => {
  registerSecret("sk-or-1234567890")
  registerSecret(JSON.stringify({ Authorization: "Bearer abcdef123456" }))
  registerSecret("123") // curto demais: ignorado para não mascarar texto comum
  expect(mask("chave sk-or-1234567890 usada")).toBe("chave *** usada")
  expect(mask("header Bearer abcdef123456")).toBe("header ***")
  expect(mask("turno 123 ok")).toBe("turno 123 ok")

  const lines: string[] = []
  const capture = Logger.formatLogFmt.pipe(Logger.map(mask), Logger.map((l) => lines.push(l)))
  await Effect.runPromise(Effect.logInfo("falhou com sk-or-1234567890").pipe(Effect.annotateLogs({ key: "sk-or-1234567890" }), Effect.provide(Logger.layer([capture]))))
  expect(lines.join("\n")).not.toContain("sk-or-1234567890")
  expect(lines.join("\n")).toContain("***")
})
