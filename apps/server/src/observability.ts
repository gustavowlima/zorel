// Logs estruturados que nunca vazam segredo (ARCHITECTURE §12): todo valor guardado pelo `Secrets`
// é registrado aqui, e o logger troca qualquer ocorrência por *** antes de escrever (ideia do
// registerSecretValue do OpenBot). Spans: Effect.withSpan em turno, engine e ferramenta.
import { Logger } from "effect"

const sensitive = new Set<string>()
const MIN = 6 // valores curtos demais (ex.: "1") mascarariam texto comum

export function registerSecret(value: string | undefined) {
  if (!value || value.length < MIN) return
  sensitive.add(value)
  // Variáveis e cabeçalhos de MCP chegam como JSON: registra cada valor também.
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === "object") for (const v of Object.values(parsed)) if (typeof v === "string") registerSecret(v)
  } catch {
    // não é JSON: só o valor inteiro
  }
}

export const mask = (text: string) => {
  let out = text
  for (const s of sensitive) if (out.includes(s)) out = out.replaceAll(s, "***")
  return out
}

// Logfmt numa linha, mascarado.
export const maskedLogger = Logger.formatLogFmt.pipe(Logger.map(mask), Logger.withConsoleLog)
export const LoggerLive = Logger.layer([maskedLogger])
