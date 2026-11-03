// A live engine session (ARCHITECTURE §6): kept across turns of the same (chat, agent).
// The runtime owns the lifecycle: opens it on the first turn, sends only what the session has not
// seen yet (watermark), and closes it when the stable context, the provider or the account changes.
import type { Effect, Stream } from "effect"
import type { Effort } from "@zero/contracts"
import type { EngineEvent, TurnFile, TurnTools } from "#server/engines.ts"

export interface SessionTurnInput {
  readonly model: string // may differ from the open model: the session switches live
  readonly prompt: string // what this turn adds: dynamic context + messages after the watermark
  readonly tools?: TurnTools | undefined
  readonly effort?: Effort | null | undefined // null: the model's default; applied live when it changes
  readonly images?: ReadonlyArray<TurnFile> | undefined // images attached to the new messages
}

export interface EngineSession {
  // Interrupting the stream interrupts the turn; the session stays usable.
  readonly turn: (input: SessionTurnInput) => Stream.Stream<EngineEvent>
  // Adds text to the turn that is running now (real steering). Absent when the engine can't do it:
  // the runtime then queues the message as a normal turn. Resolves false if no turn is running.
  readonly steer?: (text: string) => Promise<boolean>
  readonly alive: () => boolean
  readonly close: Effect.Effect<void>
}
