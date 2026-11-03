// Who makes the request (D17 seam). Today it's always the local owner: LocalOnly already blocks anyone else.
// In hosted mode (phase 8), a login middleware resolves the real Actor per request.
import { Context, Layer } from "effect"

export interface ActorInfo {
  readonly id: string
  readonly role: "owner"
}

export const LOCAL_ACTOR: ActorInfo = { id: "local", role: "owner" }

export class Actor extends Context.Service<Actor, ActorInfo>()("Actor") {
  static local = Layer.succeed(Actor, LOCAL_ACTOR)
}
