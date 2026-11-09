// Telegram channel (spec 007): talk to Zorel from Telegram through the person's own bot. Long polling, so it works
// from a computer with no public address. Only paired Telegram accounts get through: pairing is a one-time code shown
// in Settings and sent to the bot as "/pair CODE" (10 minutes). Each Telegram chat is a Zorel chat; a message goes in
// through the runtime like one typed in the app and the reply comes back. The token lives in the keychain.
import { Effect, Layer, Schedule, Stream } from "effect"
import { Store } from "./db.ts"
import { Runtime } from "./runtime.ts"
import { Secrets } from "./secrets.ts"

export const TELEGRAM_KEY = "TELEGRAM_BOT_TOKEN"
const USERS = "telegramUsers" // JSON: paired Telegram user ids
const CHATS = "telegramChats" // JSON: Telegram chat id → Zorel chat id
const OFFSET = "telegramOffset" // the next update to read
const PAIR_MS = 10 * 60_000
const POLL_S = 25 // Telegram holds the request open this long when there's nothing new
const MAX_TEXT = 4_000 // under Telegram's 4,096 per message
const api = () => process.env.ZOREL_TELEGRAM_API ?? "https://api.telegram.org" // tests point it at a fake

let pairing: { code: string; until: number } | undefined
// A new one-time code (the previous one stops working).
export function newPairingCode(): { code: string; until: number } {
  const code = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("")
  pairing = { code, until: Date.now() + PAIR_MS }
  return pairing
}
export const pairingCode = () => (pairing && pairing.until > Date.now() ? pairing : undefined)

async function call<T>(token: string, method: string, body: Record<string, unknown>, timeoutMs = 15_000): Promise<T> {
  const res = await fetch(`${api()}/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) })
  const json = (await res.json()) as { ok: boolean; result?: T; description?: string }
  if (!json.ok) throw new Error(`Telegram ${method}: ${json.description ?? res.status}`) // never the URL: it holds the token
  return json.result as T
}

interface Update {
  update_id: number
  message?: { text?: string; chat: { id: number }; from?: { id: number; first_name?: string } }
}

const json = <T>(text: string | undefined, fallback: T): T => {
  try {
    return text ? (JSON.parse(text) as T) : fallback
  } catch {
    return fallback
  }
}

export const telegramUsers = Effect.gen(function* () {
  const store = yield* Store
  return json<number[]>(yield* store.preference(USERS), [])
})
export const unpairTelegram = Effect.gen(function* () {
  const store = yield* Store
  yield* store.setPreference(USERS, "[]")
})

export const TelegramChannel = Layer.effectDiscard(
  Effect.gen(function* () {
    const store = yield* Store
    const runtime = yield* Runtime
    const secrets = yield* Secrets
    const say = (token: string, chat: number, text: string) =>
      Effect.forEach(text.match(new RegExp(`[\\s\\S]{1,${MAX_TEXT}}`, "g")) ?? [""], (part) => Effect.promise(() => call(token, "sendMessage", { chat_id: chat, text: part }).catch(() => undefined)), { discard: true })

    // A paired person's message: into its Zorel chat, and the reply (or what stopped it) back.
    const relay = (token: string, u: Update, chatTg: number, text: string) =>
      Effect.gen(function* () {
        const map = json<Record<string, string>>(yield* store.preference(CHATS), {})
        let chatId = map[chatTg]
        if (!chatId || !(yield* store.chat(chatId))) {
          const model = (yield* store.chats())[0]?.model ?? "claude-cli/sonnet" // the model of the latest chat
          chatId = (yield* store.createChat({ projectId: null, agentIds: [], model, title: "Telegram" })).id
          yield* store.setPreference(CHATS, JSON.stringify({ ...map, [chatTg]: chatId }))
        }
        yield* Effect.promise(() => call(token, "sendChatAction", { chat_id: chatTg, action: "typing" }).catch(() => undefined))
        let turnId = ""
        const end = yield* runtime.subscribeChat(chatId).pipe(
          Stream.tap((e) =>
            e._tag === "snapshot"
              ? runtime.send({ chatId: chatId!, clientId: `tg-${u.update_id}`, text }).pipe(
                  Effect.tap((r) =>
                    Effect.sync(() => {
                      turnId = r.turnId
                    })
                  )
                )
              : Effect.void
          ),
          Stream.filter((e) => (e._tag === "turn-completed" || e._tag === "turn-failed" || e._tag === "interrupted" ? e.turn.id === turnId : e._tag === "approval")),
          Stream.tap((e) => (e._tag === "approval" ? say(token, chatTg, `Waiting for your approval in Zorel: ${e.approval.summary}`) : Effect.void)),
          Stream.filter((e) => e._tag !== "approval"),
          Stream.runHead
        )
        const done = end._tag === "Some" ? end.value : undefined
        const reply =
          done?._tag === "turn-completed" ? done.message.text : done?._tag === "turn-failed" ? `The reply failed: ${done.turn.error ?? "unknown error"}` : done?._tag === "interrupted" ? (done.message?.text ?? "Stopped.") : "No reply."
        yield* say(token, chatTg, reply.trim() || "(empty reply)")
      }).pipe(Effect.catchCause((c) => Effect.logWarning("telegram relay failed", String(c))))

    const handle = (token: string, u: Update) =>
      Effect.gen(function* () {
        const m = u.message
        const text = m?.text?.trim()
        if (!m || !text || !m.from) return
        const users = yield* telegramUsers
        if (!users.includes(m.from.id)) {
          const code = pairingCode()
          const offered = text.match(/^\/pair\s+(\S+)/i)?.[1]?.toUpperCase()
          if (code && offered === code.code) {
            pairing = undefined // one use
            yield* store.setPreference(USERS, JSON.stringify([...users, m.from.id]))
            return yield* say(token, m.chat.id, "Paired with Zorel. Send a message to start; /new starts a new chat.")
          }
          return yield* say(token, m.chat.id, "This bot is private. To use it, open Zorel › Settings › Channels and send /pair with the code shown there.")
        }
        if (text === "/start") return yield* say(token, m.chat.id, "Hi! Send a message to talk to Zorel; /new starts a new chat.")
        if (text === "/new") {
          const map = json<Record<string, string>>(yield* store.preference(CHATS), {})
          delete map[m.chat.id]
          yield* store.setPreference(CHATS, JSON.stringify(map))
          return yield* say(token, m.chat.id, "New chat. What's next?")
        }
        yield* Effect.forkDetach(relay(token, u, m.chat.id, text)) // a long reply doesn't hold the next messages
      })

    const poll = Effect.gen(function* () {
      const token = secrets.get(TELEGRAM_KEY)
      if (!token) return yield* Effect.sleep("3 seconds") // a keychain read in memory: cheap
      const offset = Number(yield* store.preference(OFFSET)) || 0
      const updates = yield* Effect.tryPromise(() => call<Update[]>(token, "getUpdates", { offset, timeout: POLL_S, allowed_updates: ["message"] }, (POLL_S + 10) * 1000))
      for (const u of updates) {
        yield* store.setPreference(OFFSET, String(u.update_id + 1)) // first: a message that breaks is never read twice
        yield* handle(token, u)
      }
    }).pipe(Effect.catchCause((c) => Effect.logWarning("telegram poll failed", String(c)).pipe(Effect.andThen(Effect.sleep("10 seconds")))))

    yield* Effect.forkScoped(Effect.repeat(poll, Schedule.forever))
  })
)
