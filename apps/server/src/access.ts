// Quem faz a requisição (porta da D17). Hoje é sempre o dono local: o LocalOnly já barra quem não é.
// No modo hospedado (fase 8), um middleware de login resolve o Actor real por requisição.
import { Context, Layer } from "effect"

export interface ActorInfo {
  readonly id: string
  readonly role: "owner"
}

export const LOCAL_ACTOR: ActorInfo = { id: "local", role: "owner" }

export class Actor extends Context.Service<Actor, ActorInfo>()("Actor") {
  static local = Layer.succeed(Actor, LOCAL_ACTOR)
}
