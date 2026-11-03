// Clients tipados derivados do mesmo contrato do server: HTTP para o CRUD e RPC (WebSocket em /rpc) para os turnos.
import { Api } from "@zero/contracts"
import { type ApprovalOutcome, type ChatEvent, ZeroRpc } from "@zero/contracts/events"
import { Effect, Layer, ManagedRuntime, Schedule, Scope, Stream } from "effect"
import { FetchHttpClient } from "effect/http"
import { HttpApiClient } from "effect/http-api"
import { RpcClient, RpcSerialization } from "effect/rpc"
import { Socket } from "effect/socket"

export const call = <A, E>(f: (c: HttpApiClient.ForApi<typeof Api>) => Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(Effect.flatMap(HttpApiClient.make(Api, { baseUrl: location.origin }), f).pipe(Effect.provide(FetchHttpClient.layer)))

// Uma conexão para a página inteira; o protocolo reconecta sozinho em falha transitória.
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

// clientId: reenviar (ex.: rede caiu no meio) não duplica a mensagem.
export const sendMessage = (chatId: string, text: string, clientId = crypto.randomUUID()) => rpc((c) => c.send({ chatId, clientId, text }))
export const interruptChat = (chatId: string) => rpc((c) => c.interrupt({ chatId }))
export const decideApproval = (approvalId: string, outcome: Exclude<ApprovalOutcome, "expired">) => rpc((c) => c.decide({ approvalId, outcome }))

// Assina os eventos do chat. Caiu a conexão: assina de novo e recebe outro snapshot. Devolve o cancelamento.
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
