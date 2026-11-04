// The gateway's SSE body: pings while the call waits, then the event, then it ends (and frees the MCP server).
import { expect, test } from "bun:test"
import { withPings } from "./tools.ts"

test("a slow tool result keeps the response alive with pings until it arrives", async () => {
  let push: (s: string) => void = () => {}
  let close: () => void = () => {}
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      push = (s) => c.enqueue(new TextEncoder().encode(s))
      close = () => c.close()
    }
  })
  let ended = false
  const out = withPings(body, () => (ended = true), 20)
  setTimeout(() => {
    push('event: message\ndata: {"ok":true}\n\n')
    close()
  }, 75)
  const text = await new Response(out).text()
  expect(text.split(": ping").length - 1).toBeGreaterThanOrEqual(2)
  expect(text).toContain('data: {"ok":true}')
  expect(ended).toBe(true)
})
