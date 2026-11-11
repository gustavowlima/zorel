// Who makes the request (D17 seam). Locally (desktop, local web) it's always the one owner: LocalOnly already blocks
// anyone else. In server mode (spec 014) ServerGuard resolves the signed-in person and their role for each request.
// A Reference with the local owner as its default, not a layer service: handlers read the request's own value (a
// service captured when the routes were built would always be the local owner).
import { Context, Layer } from "effect"

interface ActorInfo {
  readonly id: string
  readonly role: "owner" | "admin" | "member"
  readonly device?: boolean // a paired device's session: its approvals must be signed (devices.ts)
}

export const LOCAL_ACTOR: ActorInfo = { id: "local", role: "owner" }

export const Actor = Object.assign(Context.Reference<ActorInfo>("Actor", { defaultValue: () => LOCAL_ACTOR }), {
  local: Layer.empty // kept for the layers that named it: the default already is the local owner
})
