# Contract: what agents see

The only external interface this feature changes is what Zorel hands to the agents (model-facing
text and one internal tool). No HTTP route, RPC or `packages/contracts` type changes. All text is
English (constitution V).

## Compacted tool result

Returned in place of any result of Zorel's own tools (gateway MCP tools, browser tools) longer than
`COMPACT_AT` characters:

```text
<first COMPACT_HEAD characters of the result>
[Result shortened: 48,213 characters in all, the first 3,000 shown. Read more with zorel_read_result
{"id":"r3","offset":3000}, or {"id":"r3","find":"some text"} for the lines holding it.]
```

Results at or under the limit are returned unchanged.

## Tool `zorel_read_result`

| Input | Type | Required | Meaning |
|---|---|---|---|
| `id` | string | yes | the handle from the shortened result |
| `offset` | integer ≥ 0 | no | where to start (default 0) |
| `length` | integer 1–`COMPACT_AT` | no | how much to return (default `COMPACT_HEAD`) |
| `find` | string | no | instead of a slice: the lines containing this text (case-insensitive), up to `COMPACT_AT` characters |

Output: the requested text, followed by `[characters X–Y of N]` for a slice, or
`[K matching lines]` for `find`.

Errors (as tool errors, not exceptions):
- unknown or dropped `id` → `That result is no longer available; run the tool again.`
- `offset` past the end → `The result has N characters.`

Classification: read (never asks for approval). Withheld from no access level; listed whenever the
turn has a tool whose result can be shortened (an MCP or browser tool). The tool list is fixed when
the turn starts, so "only after a result was shortened" would hide it from the turn that needs it.
Full results are kept in memory, the last 20 per chat (50 chats); after a restart the agent is told
to run the tool again.

## Turn prompt layout (sessionless engines)

```text
<stable part: instructions, pinned memories, project, skill list, page list>

<transcript>

<context>
<skill bodies named this turn, summary, recalled memories>
</context>
```

Native sessions keep their current layout (stable part as the session's system prompt, the
`<context>` block with the turn's message).
