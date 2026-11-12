// The Terminal panel's socket (GET /api/terminals?chat=…&cols=…&rows=…[&session=…|&run=…], spec 019 moved it into
// the contract): up, TerminalFrame JSON; down, TerminalMessage JSON as text plus the shell's output as binary bytes.
// Closing with code 4000 means the shell ended.
import { Schema } from "effect"

export const MAX_TERMINAL_INPUT = 64 * 1024 // one input frame (a paste)

const Size = (max: number) => Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: max }))

// i: input; r: resize to c columns × r rows; k: kill the session.
export const TerminalFrame = Schema.Union([
  Schema.Struct({ t: Schema.Literal("i"), d: Schema.String.check(Schema.isMaxLength(MAX_TERMINAL_INPUT)) }),
  Schema.Struct({ t: Schema.Literal("r"), c: Size(1000), r: Size(500) }),
  Schema.Struct({ t: Schema.Literal("k") })
])
export type TerminalFrame = typeof TerminalFrame.Type

// s: attached to session `id` (n: its number in the chat); the replay of the recent screen follows as bytes.
export const TerminalMessage = Schema.Struct({ t: Schema.Literal("s"), id: Schema.String, n: Schema.Number })
export type TerminalMessage = typeof TerminalMessage.Type
