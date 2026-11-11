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


// What's wrong with a tool's arguments written as JSON (the JSON mode of the form): each problem with the key it's
// on, when it's on one. A value taken from an earlier step ({"$from": …}) is checked by the server, not here.
type ArgProblem = { readonly key?: string; readonly message: string }
const typeOf = (v: unknown) => (Array.isArray(v) ? "array" : v === null ? "null" : typeof v === "number" ? (Number.isInteger(v) ? "integer" : "number") : typeof v)
function typeProblem(p: Prop, v: unknown): string | undefined {
  if (p.enum?.length) return p.enum.some((x) => x === v) ? undefined : t("flows.form.oneOf", { values: p.enum.map((x) => JSON.stringify(x)).join(", ") })
  if (typeof p.type !== "string") return undefined
  const got = typeOf(v)
  return got === p.type || (p.type === "number" && got === "integer") ? undefined : t("flows.form.wrongType", { type: p.type })
}
export function argProblems(schema: JsonSchema, args: unknown): ArgProblem[] {
  if (typeOf(args) !== "object") return [{ message: t("flows.form.notObject") }]
  const a = args as Record<string, unknown>
  const props = schema.properties ?? {}
  const required = new Set(schema.required ?? [])
  const missing = [...required].filter((k) => k in props && !(k in a)).map((k) => ({ message: t("flows.form.missing", { field: k }) }))
  const wrong = Object.entries(a).flatMap(([k, v]): ArgProblem[] => {
    const p = props[k]
    if (!p) return [{ key: k, message: t("flows.form.unknown", { field: k }) }]
    if (isRef(v)) return []
    const problem = typeProblem(p, v) ?? fieldProblem(p, required.has(k), v)
    return problem ? [{ key: k, message: problem }] : []
  })
  return [...missing, ...wrong]
}
// The fields a step's output can be read by (spec 013): from the tool's outputSchema when it declares one, else from
// what its last test gave. A list reads its first item ("items.0.id"). Three levels deep at most.
const DEPTH = 3
const MAX_PATHS = 60
export function pathsFromSchema(schema: unknown, prefix = "", depth = 0): string[] {
  const s = schema as JsonSchema & { items?: unknown } | undefined
  if (!s || depth >= DEPTH) return []
  if (s.type === "array" && s.items) return [`${prefix}0`, ...pathsFromSchema(s.items, `${prefix}0.`, depth + 1)]
  return Object.entries(s.properties ?? {}).flatMap(([k, p]) => [`${prefix}${k}`, ...pathsFromSchema(p, `${prefix}${k}.`, depth + 1)]).slice(0, MAX_PATHS)
}
export function pathsFromSample(value: unknown, prefix = "", depth = 0): string[] {
  if (depth >= DEPTH || !value || typeof value !== "object") return []
  if (Array.isArray(value)) return value.length ? [`${prefix}0`, ...pathsFromSample(value[0], `${prefix}0.`, depth + 1)] : []
  return Object.entries(value).flatMap(([k, v]) => [`${prefix}${k}`, ...pathsFromSample(v, `${prefix}${k}.`, depth + 1)]).slice(0, MAX_PATHS)
}

// What each tool step gave in its last test here (in memory, per page): its fields are offered to the steps after.
export const samples = new Map<string, unknown>()
