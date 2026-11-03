// Client tipado derivado do mesmo contrato do server + leitura do streaming (SSE) do envio.
import { Api, type SendEvent, type SendInput } from "@zero/contracts"
import { Effect } from "effect"
import { FetchHttpClient } from "effect/http"
import { HttpApiClient } from "effect/http-api"

export const call = <A, E>(f: (c: HttpApiClient.ForApi<typeof Api>) => Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(Effect.flatMap(HttpApiClient.make(Api, { baseUrl: location.origin }), f).pipe(Effect.provide(FetchHttpClient.layer)))

// Abortar o signal interrompe o turno; o server guarda o parcial como "interrompido".
export async function sendMessage(chatId: string, input: SendInput, onEvent: (e: SendEvent) => void, signal: AbortSignal): Promise<void> {
  const res = await fetch(`/api/chats/${chatId}/send`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input), signal })
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  let buf = ""
  for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
    buf += chunk
    let i: number
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const line = buf.slice(0, i)
      buf = buf.slice(i + 2)
      if (line.startsWith("data: ")) onEvent(JSON.parse(line.slice(6)) as SendEvent)
    }
  }
}
