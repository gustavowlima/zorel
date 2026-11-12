// The Browser panel's socket (GET /api/browser?chat=…, spec 019 moved it into the contract): up, PanelFrame JSON;
// down, PanelMessage JSON as text plus the active tab's frames as binary JPEG. Positions are fractions of the frame.
import { Schema } from "effect"

const Fraction = Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 }))
const Owner = Schema.optional(Schema.String) // whose browser: an agent's profile, "assistant" or "you"; the server checks its shape

// ---------- up: from the panel ----------

export const PanelFrame = Schema.Union([
  Schema.Struct({ t: Schema.Literal("click"), x: Fraction, y: Fraction, button: Schema.optional(Schema.Literals(["left", "right"])), clicks: Schema.optional(Schema.Number) }),
  Schema.Struct({ t: Schema.Literal("wheel"), x: Fraction, y: Fraction, dx: Schema.Number, dy: Schema.Number }),
  Schema.Struct({ t: Schema.Literal("key"), key: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(40)) }),
  Schema.Struct({ t: Schema.Literal("text"), text: Schema.String.check(Schema.isMaxLength(10_000)) }),
  Schema.Struct({ t: Schema.Literal("nav"), url: Schema.String.check(Schema.isMaxLength(4000)) }),
  // A page the app opens (a server from the Terminal panel): a new tab, control unchanged.
  Schema.Struct({ t: Schema.Literal("open"), url: Schema.String.check(Schema.isMaxLength(4000)), owner: Owner }),
  Schema.Struct({ t: Schema.Literals(["back", "forward", "reload", "release", "previews"]) }),
  Schema.Struct({ t: Schema.Literal("newtab"), owner: Owner }),
  Schema.Struct({ t: Schema.Literals(["tab", "close", "view"]), id: Schema.String })
])
export type PanelFrame = typeof PanelFrame.Type

// ---------- down: to the panel ----------

export const BrowserTab = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  url: Schema.String,
  active: Schema.Boolean,
  owner: Schema.String // whose browser it's in: an agent's profile (its id), "assistant", or "you"
})
export type BrowserTab = typeof BrowserTab.Type

// An agent at work in a chat's browser: the tool, the element by its name and where it is, then done. What it types
// never travels: it may be a password.
export const BrowserAct = Schema.Struct({
  agentId: Schema.NullOr(Schema.String),
  tool: Schema.String,
  target: Schema.optional(Schema.String),
  x: Schema.optional(Schema.Number),
  y: Schema.optional(Schema.Number),
  done: Schema.optional(Schema.Boolean),
  at: Schema.Number
})
export type BrowserAct = typeof BrowserAct.Type

export const PanelMessage = Schema.Union([
  // yours: this viewer holds the browser (or nobody does); masked: a password/card field has focus and the frames are
  // only the holder's; mayControl: false on a team server for a watch-only person.
  Schema.Struct({ t: Schema.Literal("state"), tabs: Schema.Array(BrowserTab), userControl: Schema.Boolean, yours: Schema.Boolean, masked: Schema.Boolean, mayControl: Schema.Boolean }),
  Schema.Struct({ t: Schema.Literal("act"), ...BrowserAct.fields }),
  Schema.Struct({ t: Schema.Literal("previews"), previews: Schema.Record(Schema.String, Schema.String) }), // owner → JPEG base64
  Schema.Struct({ t: Schema.Literal("error"), message: Schema.String })
])
export type PanelMessage = typeof PanelMessage.Type
