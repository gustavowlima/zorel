// A live engine session (ARCHITECTURE §6): kept across turns of the same (chat, agent).
// The runtime owns the lifecycle: opens it on the first turn, sends only what the session has not
// seen yet (watermark), and closes it when the stable context, the provider or the account changes.
import type { Effect, Stream } from "effect"
import type { Access, Effort } from "@zorel/contracts"
import type { EngineEvent, TurnFile, TurnTools } from "#server/engines.ts"

export interface SessionTurnInput {
  readonly model: string // may differ from the open model: the session switches live
  readonly prompt: string // what this turn adds: dynamic context + messages after the watermark
  readonly tools?: TurnTools | undefined
  readonly effort?: Effort | null | undefined // null: the model's default; applied live when it changes
  readonly images?: ReadonlyArray<TurnFile> | undefined // images attached to the new messages
  readonly command?: string | undefined // the new message, when it runs one of the CLI's slash commands
}

// A native tool call that needs the person's OK (ARCHITECTURE §9.2). The runtime shows the approval card
// and resolves true (allowed) or false (denied or expired).
export interface NativeApproval {
  readonly kind: "command" | "edit" | "tool" | "network"
  readonly tool: string
  readonly summary: string
  readonly args: string
  readonly cwd: string | null
}
export type Approver = (request: NativeApproval) => Promise<boolean>

// What a session gets about where and how freely it works.
export interface SessionAccess {
  readonly access: Access
  readonly approve: Approver
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

// How long an approval card waits for the person (ARCHITECTURE §9.2); then it counts as a denial. The engines'
// tool-call timeouts for Zorel's gateway must outlast it, or a call dies while the card is still open.
export const APPROVAL_MS = 30 * 60_000
export const GATEWAY_TOOL_TIMEOUT_MS = APPROVAL_MS + 60_000
