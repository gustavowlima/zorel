// Telegram channel (spec 007): talk to Zorel from Telegram through the person's own bot. Long polling, so it works
// from a computer with no public address. Only paired Telegram accounts get through: pairing is a one-time code shown
// in Settings and sent to the bot as "/pair CODE" (10 minutes). Each Telegram chat is a Zorel chat; a message goes in
// through the runtime like one typed in the app and the reply comes back. The token lives in the keychain.
import type { Approval, ChatEvent } from "@zorel/contracts/events"
import { Effect, Layer, Schedule, Stream } from "effect"
import { Store } from "./db.ts"
import { Runtime } from "./runtime.ts"
import { Secrets } from "./secrets.ts"
import { noteActivity } from "./time-profile.ts"

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
  // A tap on a card's button (spec 013: an "Ask me" or a routine's write, answered from Telegram).
  callback_query?: { id: string; from: { id: number }; data?: string; message?: { chat: { id: number }; message_id: number } }
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
// Sends a text to every paired person (spec 012: a routine's result, the morning brief). Not paired, or no token:
// nothing is sent and `sent` is false, so the caller falls back to the app's notification.
export const sayToPaired = (text: string) =>
  Effect.gen(function* () {
    const token = (yield* Secrets).get(TELEGRAM_KEY)
    const users = yield* telegramUsers
    if (!token || !users.length) return { sent: false }
    const parts = text.match(new RegExp(`[\\s\\S]{1,${MAX_TEXT}}`, "g")) ?? [""]
    const sent = yield* Effect.forEach(users, (chat) => Effect.forEach(parts, (part) => Effect.promise(() => call(token, "sendMessage", { chat_id: chat, text: part }).then(() => true, () => false))))
    return { sent: sent.some((r) => r.some(Boolean)) }
  })
// A routine's card on Telegram (spec 013, FR-019): what it asks, with two buttons. The answer comes back as a
// callback ("ap:<approval id>:y|n"), taken only from a paired account, and decides it like the app does.
const CARD = "ap:"
export const askOnTelegram = (a: Approval) =>
  Effect.gen(function* () {
    const token = (yield* Secrets).get(TELEGRAM_KEY)
    const users = yield* telegramUsers
    if (!token || !users.length) return
    const question = a.kind === "question"
    const text = [a.summary, a.args?.slice(0, 1500)].filter(Boolean).join("\n\n")
    const keyboard = { inline_keyboard: [[{ text: question ? "Yes" : "Allow", callback_data: `${CARD}${a.id}:y` }, { text: question ? "No" : "Deny", callback_data: `${CARD}${a.id}:n` }]] }
    yield* Effect.forEach(users, (chat) => Effect.promise(() => call(token, "sendMessage", { chat_id: chat, text: text.slice(0, MAX_TEXT), reply_markup: keyboard }).catch(() => undefined)), { discard: true })
  })
export const parseCard = (data: string | undefined): { id: string; approve: boolean } | undefined => {
  const m = data ? /^ap:([0-9a-f-]{36}):([yn])$/.exec(data) : null
  return m ? { id: m[1]!, approve: m[2] === "y" } : undefined
}

export const unpairTelegram = Effect.gen(function* () {
  const store = yield* Store
  yield* store.setPreference(USERS, "[]")
})

// What each chat event means on the Telegram side while a message waits for its reply: a note to send now, or the
// reply that ends the wait. Turn events count only for this message's turn; events not listed mean nothing here.
type Outcome = { readonly notify?: string; readonly reply?: string } | undefined
type On<K extends ChatEvent["_tag"]> = (e: Extract<ChatEvent, { _tag: K }>, turnId: string | undefined) => Outcome
const ON_EVENT: { readonly [K in ChatEvent["_tag"]]?: On<K> } = {
  approval: (e) => ({ notify: `Waiting for your approval in Zorel: ${e.approval.summary}` }),
  "turn-completed": (e, turnId) => (e.turn.id === turnId ? { reply: e.message.text } : undefined),
  "turn-failed": (e, turnId) => (e.turn.id === turnId ? { reply: `The reply failed: ${e.turn.error ?? "unknown error"}` } : undefined),
  interrupted: (e, turnId) => (e.turn.id === turnId ? { reply: e.message?.text ?? "Stopped." } : undefined)
}
const onEvent = (e: ChatEvent, turnId: string | undefined): Outcome => (ON_EVENT[e._tag] as On<ChatEvent["_tag"]> | undefined)?.(e as never, turnId)

export const TelegramChannel = Layer.effectDiscard(
  Effect.gen(function* () {
    const store = yield* Store
    const runtime = yield* Runtime
    const secrets = yield* Secrets
    const say = (token: string, chat: number, text: string) =>
      Effect.forEach(text.match(new RegExp(`[\\s\\S]{1,${MAX_TEXT}}`, "g")) ?? [""], (part) => Effect.promise(() => call(token, "sendMessage", { chat_id: chat, text: part }).catch(() => undefined)), { discard: true })

    // The bot's commands for a paired account: what each does, and the answer it sends.
    const COMMANDS: Record<string, (chat: number) => Effect.Effect<string>> = {
      "/start": () => Effect.succeed("Hi! Send a message to talk to Zorel; /new starts a new chat."),
      "/new": (chat) =>
        Effect.gen(function* () {
          const map = json<Record<string, string>>(yield* store.preference(CHATS), {})
          delete map[chat]
          yield* store.setPreference(CHATS, JSON.stringify(map))
          return "New chat. What's next?"
        })
    }

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
        // Subscribed first, then sent (on the snapshot), so no event of this turn is missed.
        let turnId: string | undefined
        const reply = yield* runtime.subscribeChat(chatId).pipe(
          Stream.mapEffect((e) =>
            Effect.gen(function* () {
              if (e._tag === "snapshot") {
                turnId = (yield* runtime.send({ chatId: chatId!, clientId: `tg-${u.update_id}`, text })).turnId
                return undefined
              }
              const outcome = onEvent(e, turnId)
              if (outcome?.notify) yield* say(token, chatTg, outcome.notify)
              return outcome?.reply
            })
          ),
          Stream.filter((r): r is string => r !== undefined),
          Stream.runHead
        )
        yield* say(token, chatTg, (reply._tag === "Some" ? reply.value : "No reply.").trim() || "(empty reply)")
      }).pipe(Effect.catchCause((c) => Effect.logWarning("telegram relay failed", String(c))))

    // A tap on a card: decided by a paired account only; the buttons go away either way.
    const answer = (token: string, q: NonNullable<Update["callback_query"]>) =>
      Effect.gen(function* () {
        const card = parseCard(q.data)
        const paired = (yield* telegramUsers).includes(q.from.id)
        const said = !card || !paired ? "This isn't yours to answer." : yield* runtime.decide(card.id, card.approve ? "approved" : "denied").pipe(Effect.as(card.approve ? "Done: yes." : "Done: no."), Effect.catchTag("ApprovalNotFound", () => Effect.succeed("Already answered or expired.")))
        yield* Effect.promise(() => call(token, "answerCallbackQuery", { callback_query_id: q.id, text: said }).catch(() => undefined))
        if (q.message && card && paired) yield* Effect.promise(() => call(token, "editMessageReplyMarkup", { chat_id: q.message!.chat.id, message_id: q.message!.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => undefined))
      })

    const handle = (token: string, u: Update) =>
      Effect.gen(function* () {
        if (u.callback_query) return yield* answer(token, u.callback_query)
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
        const command = COMMANDS[text]
        if (command) return yield* say(token, m.chat.id, yield* command(m.chat.id))
        yield* noteActivity(store) // the person is here (spec 012: their day starts)
        yield* Effect.forkDetach(relay(token, u, m.chat.id, text)) // a long reply doesn't hold the next messages
      })

    const poll = Effect.gen(function* () {
      const token = secrets.get(TELEGRAM_KEY)
      if (!token) return yield* Effect.sleep("3 seconds") // a keychain read in memory: cheap
      const offset = Number(yield* store.preference(OFFSET)) || 0
      const updates = yield* Effect.tryPromise(() => call<Update[]>(token, "getUpdates", { offset, timeout: POLL_S, allowed_updates: ["message", "callback_query"] }, (POLL_S + 10) * 1000))
      for (const u of updates) {
        yield* store.setPreference(OFFSET, String(u.update_id + 1)) // first: a message that breaks is never read twice
        yield* handle(token, u)
      }
    }).pipe(Effect.catchCause((c) => Effect.logWarning("telegram poll failed", String(c)).pipe(Effect.andThen(Effect.sleep("10 seconds")))))

    yield* Effect.forkScoped(Effect.repeat(poll, Schedule.forever))
  })
)
