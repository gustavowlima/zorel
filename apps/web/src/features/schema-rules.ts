// The rules of a tool's input form (spec 013), apart from React so they can be tested alone.
import { isRef, type JsonSchema } from "@zorel/contracts"
import { t } from "@zorel/i18n"

export type Prop = NonNullable<JsonSchema["properties"]>[string]

export const kindOf = (p: Prop): "choice" | "boolean" | "number" | "list" | "text" | "json" => {
  if (p.enum?.length) return "choice"
  if (p.type === "boolean") return "boolean"
  if (p.type === "number" || p.type === "integer") return "number"
  if (p.type === "array" && ["string", "number", "integer"].includes(String(p.items?.type))) return "list"
  if (p.type === "string" || p.type === undefined) return "text"
  return "json"
}

// What's wrong with a literal, as the person types (the server says it again on save).
export function fieldProblem(p: Prop, required: boolean, v: unknown): string | undefined {
  if (isRef(v)) return undefined
  if (v === undefined || v === "") return required ? t("flows.form.required") : undefined
  if (typeof v === "number") {
    if (p.type === "integer" && !Number.isInteger(v)) return t("flows.form.whole")
    if (p.minimum !== undefined && v < p.minimum) return t("flows.form.min", { n: p.minimum })
    if (p.maximum !== undefined && v > p.maximum) return t("flows.form.max", { n: p.maximum })
  }
  return undefined
}

