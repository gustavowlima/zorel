// A live engine session (ARCHITECTURE §6): kept across turns of the same (chat, agent).
// The runtime owns the lifecycle: opens it on the first turn, sends only what the session has not
// seen yet (watermark), and closes it when the stable context, the provider or the account changes.
import type { Effect, Stream } from "effect"
import type { EngineEvent, TurnTools } from "#server/engines.ts"

export interface SessionTurnInput {
  readonly model: string // may differ from the open model: the session switches live
  readonly prompt: string // what this turn adds: dynamic context + messages after the watermark
  readonly tools?: TurnTools | undefined
}

export interface EngineSession {
  // Interrupting the stream interrupts the turn; the session stays usable.
  readonly turn: (input: SessionTurnInput) => Stream.Stream<EngineEvent>
  readonly alive: () => boolean
  readonly close: Effect.Effect<void>
}
