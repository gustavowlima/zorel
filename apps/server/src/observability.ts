// Structured logs that never leak secrets (ARCHITECTURE §12): every value stored by `Secrets`
// is registered here, and the logger replaces any occurrence with *** before writing (idea from
// a reference app's registerSecretValue). Spans: Effect.withSpan on turn, engine and tool.
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

// Single-line logfmt, masked.
export const maskedLogger = Logger.formatLogFmt.pipe(Logger.map(mask), Logger.withConsoleLog)
export const LoggerLive = Logger.layer([maskedLogger])
