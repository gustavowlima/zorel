// Structured logs that never leak secrets (ARCHITECTURE §12): every value stored by `Secrets`
// is registered here, and the logger replaces any occurrence with *** before writing (idea from
// a reference app's registerSecretValue). Spans: Effect.withSpan on turn, engine and tool.
import { lintSource } from "@secretlint/core"
import { creator as recommended } from "@secretlint/secretlint-rule-preset-recommend"
import { Logger } from "effect"

const sensitive = new Set<string>()
const MIN = 6 // values that are too short (e.g. "1") would mask common text

export function registerSecret(value: string | undefined) {
  if (!value || value.length < MIN) return
  sensitive.add(value)
  // MCP variables and headers arrive as JSON: register each value too.
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === "object") for (const v of Object.values(parsed)) if (typeof v === "string") registerSecret(v)
  } catch {
    // not JSON: only the whole value
  }
}

export const mask = (text: string) => {
  let out = text
  for (const s of sensitive) if (out.includes(s)) out = out.replaceAll(s, "***")
  return out
}

// Credentials in free text that reaches a model or the database (consolidation): the values Zorel stores (above),
// the ones secretlint's recommended rules recognize (API keys and tokens of the major providers, private keys,
// connection strings with a password), and a password said in words ("the password is X"), which no rule covers.
const SECRET_RULES = { rules: [{ id: "@secretlint/secretlint-rule-preset-recommend", rule: recommended }] }
const SAID = /\b(password|passwd|senha|token|secret|api[ _-]?key)(\s*(?:is|é|=|:)\s*)(?!\[redacted\])\S+/gi // keeps the words
export const REDACTED = "[redacted]"
export async function redact(text: string): Promise<string> {
  const found = await lintSource({ source: { content: text, filePath: "chat", contentType: "text" }, options: { config: SECRET_RULES, noPhysicFilePath: true } })
  let out = text
  // From the end, so earlier ranges stay valid.
  for (const m of [...found.messages].sort((a, b) => b.range[0] - a.range[0])) out = out.slice(0, m.range[0]) + REDACTED + out.slice(m.range[1])
  return mask(out).replaceAll("***", REDACTED).replace(SAID, (_m, word: string, sep: string) => `${word}${sep}${REDACTED}`)
}
export const hasCredential = async (text: string) => (await redact(text)) !== text

// Single-line logfmt, masked.
export const maskedLogger = Logger.formatLogFmt.pipe(Logger.map(mask), Logger.withConsoleLog)
export const LoggerLive = Logger.layer([maskedLogger])
