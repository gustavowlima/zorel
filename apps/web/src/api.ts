// Typed clients derived from the same server contract: HTTP for CRUD and RPC (WebSocket at /rpc) for turns.
import { Api, type Attachment, MAX_ATTACHMENT_BYTES } from "@zero/contracts"
import { type ApprovalOutcome, type ChatEvent, ZeroRpc } from "@zero/contracts/events"
import { Effect, Layer, ManagedRuntime, Schedule, Scope, Stream } from "effect"
import { FetchHttpClient } from "effect/http"
import { HttpApiClient } from "effect/http-api"
import { RpcClient, RpcSerialization } from "effect/rpc"
import { Socket } from "effect/socket"

export const call = <A, E>(f: (c: HttpApiClient.ForApi<typeof Api>) => Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(Effect.flatMap(HttpApiClient.make(Api, { baseUrl: location.origin }), f).pipe(Effect.provide(FetchHttpClient.layer)))

// One connection for the whole page; the protocol reconnects by itself on transient failure.
const runtime = ManagedRuntime.make(
  RpcClient.layerProtocolSocket({ retryTransientErrors: true }).pipe(
    Layer.provide(Socket.layerWebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/rpc`)),
    Layer.provide(Socket.layerWebSocketConstructorGlobal),
    Layer.provide(RpcSerialization.layerJson)
  )
)
const client = runtime.runPromise(Effect.flatMap(Scope.make(), (scope) => RpcClient.make(ZeroRpc).pipe(Scope.provide(scope))))
type Client = Awaited<typeof client>
const rpc = <A, E>(f: (c: Client) => Effect.Effect<A, E>) => client.then((c) => runtime.runPromise(f(c)))

// clientId: resending (e.g. network dropped midway) doesn't duplicate the message.
export const sendMessage = (chatId: string, text: string, attachmentIds: ReadonlyArray<string> = [], clientId = crypto.randomUUID()) =>
  rpc((c) => c.send({ chatId, clientId, text, ...(attachmentIds.length && { attachmentIds }) }))
export const interruptChat = (chatId: string) => rpc((c) => c.interrupt({ chatId }))
// Mid-turn correction: joins the running turn when the engine can (Codex), otherwise queues.
export const steerChat = (chatId: string, text: string, attachmentIds: ReadonlyArray<string> = []) =>
  rpc((c) => c.steer({ chatId, text, ...(attachmentIds.length && { attachmentIds }) }))

// Raw upload; the returned id goes with the message.
export async function uploadAttachment(chatId: string, file: File): Promise<Attachment> {
  if (file.size > MAX_ATTACHMENT_BYTES) throw new Error(`${file.name} passa de 20 MB.`)
  const r = await fetch(`/api/chats/${chatId}/attachments`, {
    method: "POST",
    headers: { "content-type": file.type || "application/octet-stream", "x-file-name": encodeURIComponent(file.name) },
    body: file
  })
  if (!r.ok) throw new Error(`Não deu para anexar ${file.name}.`)
  return r.json()
}
export const decideApproval = (approvalId: string, outcome: Exclude<ApprovalOutcome, "expired">) => rpc((c) => c.decide({ approvalId, outcome }))

// Subscribes to the chat events. Connection dropped: subscribes again and gets another snapshot. Returns the canceller.
export function subscribeChat(chatId: string, onEvent: (e: ChatEvent) => void, onError: (e: unknown) => void): () => void {
  let stop = () => {}
  let stopped = false
  client.then((c) => {
    if (stopped) return
    const fiber = runtime.runFork(
      c.subscribeChat({ chatId }).pipe(
        Stream.runForEach((e) => Effect.sync(() => onEvent(e))),
        Effect.tapError((e) => Effect.sync(() => onError(e))),
        Effect.retry(Schedule.spaced("1 second"))
      )
    )
    stop = () => fiber.interruptUnsafe()
  }, onError)
  return () => {
    stopped = true
    stop()
  }
}
