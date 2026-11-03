// Interface text (ARCHITECTURE §10.1, D13): every visible string comes from a typed catalog. English is
// the source; another language enters only complete (`satisfies Messages` breaks the typecheck on a
// missing or extra key). Plurals, numbers, dates and durations go through Intl, no library.
import { en } from "./en.ts"

type Plural = { readonly one: string; readonly other: string }
type Leaf = string | Plural
type Tree = { readonly [key: string]: Leaf | Tree }
export type Messages = typeof en

// "chat.send", "inbox.title"… only keys that exist compile.
type Paths<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends Leaf ? `${P}${K}` : Paths<T[K], `${P}${K}.`>
}[keyof T & string]
export type MessageKey = Paths<Messages>
export type Params = Readonly<Record<string, string | number>>

// The single place that decides the language. Only "en" exists today.
const CATALOGS: Record<string, Tree> = { en }
export const locale = (): string => "en"

const lookup = (key: string): Leaf | undefined => {
  let node: Leaf | Tree | undefined = CATALOGS[locale()]
  for (const part of key.split(".")) {
    // A plural leaf has both "one" and "other" as text; any other object is a branch, even with an "other" key.
    const plural: boolean = typeof node === "object" && typeof (node as Tree).one === "string" && typeof (node as Tree).other === "string"
    const branch: boolean = typeof node === "object" && !plural
    node = branch ? (node as Tree)[part] : undefined
  }
  return node as Leaf | undefined
}

let plurals: Intl.PluralRules | undefined
const pluralOf = (count: number) => {
  plurals ??= new Intl.PluralRules(locale())
  return plurals.select(count)
}

// t("inbox.count", { count: 3 }) → "3 items". {name} placeholders are replaced; no HTML in the catalog.
export function t(key: MessageKey, params?: Params): string {
  const leaf = lookup(key)
  if (leaf === undefined) return key // unreachable while the types hold; visible if the catalog drifts
  const text = typeof leaf === "string" ? leaf : pluralOf(Number(params?.count ?? 0)) === "one" ? leaf.one : leaf.other
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) => {
    const v = params[name]
    return v === undefined ? match : typeof v === "number" ? formatNumber(v) : v
  })
}

// ---------- numbers, dates, durations ----------

const cache = new Map<string, Intl.NumberFormat>()
const numberFormat = (key: string, options: Intl.NumberFormatOptions) => {
  const hit = cache.get(key)
  if (hit) return hit
  const f = new Intl.NumberFormat(locale(), options)
  cache.set(key, f)
  return f
}

export const formatNumber = (n: number) => numberFormat("n", {}).format(n)
// 1.2K, 42K, 3.4M: token counts.
export const formatCompact = (n: number) => numberFormat("c", { notation: "compact", maximumFractionDigits: 1 }).format(n)
export const formatPercent = (ratio: number) => numberFormat("p", { style: "percent", maximumFractionDigits: 0 }).format(ratio)

// 512 B · 94 KB · 6.3 GB (decimal units, like the system's disk usage).
const BYTE_UNITS = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte"] as const
export function formatBytes(bytes: number): string {
  const i = Math.min(BYTE_UNITS.length - 1, Math.max(0, Math.floor(Math.log10(Math.max(1, bytes)) / 3)))
  if (i === 0) return `${formatNumber(Math.round(bytes))} B` // Intl spells it "byte"
  const u = BYTE_UNITS[i]!
  return numberFormat(`b:${u}`, { style: "unit", unit: u, unitDisplay: "short", maximumFractionDigits: i < 2 ? 0 : 1 }).format(bytes / 1000 ** i)
}

const unit = (u: "second" | "minute" | "hour" | "day" | "week", n: number) => numberFormat(`u:${u}`, { style: "unit", unit: u, unitDisplay: "narrow" }).format(n)

// 14s · 2m 10s · 1h 40m
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return unit("second", s)
  const m = Math.floor(s / 60)
  if (m < 60) return s % 60 ? `${unit("minute", m)} ${unit("second", s % 60)}` : unit("minute", m)
  const h = Math.floor(m / 60)
  return m % 60 ? `${unit("hour", h)} ${unit("minute", m % 60)}` : unit("hour", h)
}

// Short age for lists: 5m, 2h, 3d, 2w; under a minute → "now" from the catalog.
const SANE_SINCE = Date.UTC(2000, 0, 1)

export function formatAge(at: number, now = Date.now()): string {
  // Before 2000 is not a real timestamp here (0, 1, or seconds from old data): no age, never "Dec 31, 1969".
  if (!(at >= SANE_SINCE)) return ""
  const s = Math.max(0, (now - at) / 1000)
  if (s < 60) return t("time.now")
  if (s < 3600) return unit("minute", Math.floor(s / 60))
  if (s < 86400) return unit("hour", Math.floor(s / 3600))
  if (s < 86400 * 14) return unit("day", Math.floor(s / 86400))
  if (s < 86400 * 56) return unit("week", Math.floor(s / (86400 * 7)))
  // Older than 8 weeks: the date itself reads better (Mar 4, or Mar 4, 2025 in another year).
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear()
  return new Intl.DateTimeFormat(locale(), sameYear ? { month: "short", day: "numeric" } : { dateStyle: "medium" }).format(at)
}

// 14:30 today; Mar 4, 14:30 on another day.
export function formatTime(at: number, now = Date.now()): string {
  const sameDay = new Date(at).toDateString() === new Date(now).toDateString()
  return new Intl.DateTimeFormat(locale(), sameDay ? { hour: "2-digit", minute: "2-digit" } : { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(at)
}

let dateFormat: Intl.DateTimeFormat | undefined
export const formatDate = (at: number) => {
  dateFormat ??= new Intl.DateTimeFormat(locale(), { dateStyle: "medium" })
  return dateFormat.format(at)
}
