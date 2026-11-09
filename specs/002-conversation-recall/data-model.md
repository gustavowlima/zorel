# Data Model: Recall from Past Conversations

## Message — existing, `messages` table

| Field | Use in this feature |
|---|---|
| `text` | indexed for search (new `message_index`); inserted once, never updated |
| `chatId` → `chats.projectId` | scope: only chats of the same project (or, for a chat without one, chats without one) |
| `role`, `agentId` | who said it, shown with the excerpt |
| `at` | excludes the current chat's messages after its `summaryUntil` (in the window); shown as a date |

## `message_index` — new FTS5 table (one migration)

| Column | Meaning |
|---|---|
| `id` (unindexed) | the message id |
| `body` | the message text |

Kept by triggers: insert on `messages` insert, delete on `messages` delete (chat deletion cascades).
The migration fills it from existing messages. Tokenizer `unicode61 remove_diacritics 2`, like
`memory_index`.

## Message excerpt — derived per turn, not stored

| Field | Meaning |
|---|---|
| `id` | the message id (RRF key, dedupe) |
| `chatId`, `chatTitle` | where it was said |
| `author` | "user" or the agent's name |
| `at` | when |
| `text` | FTS5 `snippet()` around the matches (~32 tokens, ≤ 300 characters) |

Dropped when it holds a credential, contains a forgotten fact's normalized text, or says the same as
a recalled fact.

## Recall result — derived per turn

`{ facts: Memory[], excerpts: Excerpt[], ranked: Array<{ kind: "fact" | "message", id, chatId }> }`:
facts and excerpts in fused order within 2,000 characters (for the prompt); `ranked` is the whole
fused list before the budget (for the benchmarks).
