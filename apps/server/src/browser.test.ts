import { afterAll, expect, test } from "bun:test"
import { existsSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Browsers, parsePanelFrame, runBrowserTool } from "./browser.ts"

test("parsePanelFrame: positions as fractions, bounded text, known kinds only", () => {
  expect(parsePanelFrame(`{"t":"click","x":0.5,"y":0.25}`)).toEqual({ t: "click", x: 0.5, y: 0.25, button: "left", clicks: 1 })
  expect(parsePanelFrame(`{"t":"click","x":1.5,"y":0.2}`)).toBeUndefined() // off the frame
  expect(parsePanelFrame(`{"t":"wheel","x":0.1,"y":0.1,"dx":0,"dy":99999}`)).toMatchObject({ dy: 5000 }) // clamped
  expect(parsePanelFrame(`{"t":"key","key":"Enter"}`)).toEqual({ t: "key", key: "Enter" })
  expect(parsePanelFrame(`{"t":"nav","url":"example.com"}`)).toEqual({ t: "nav", url: "example.com" })
  expect(parsePanelFrame(`{"t":"release"}`)).toEqual({ t: "release" })
  expect(parsePanelFrame(`{"t":"eval","js":"1"}`)).toBeUndefined()
  expect(parsePanelFrame("nope")).toBeUndefined()
})

// A real Chrome (skipped when the machine has none): read, type and click by ref, and the person's hold.
const chrome = existsSync("/Applications/Google Chrome.app")
const site = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch: () =>
    new Response(`<title>Loja</title><h1>Loja</h1><label>Email <input></label><button onclick="document.querySelector('h1').textContent='ok '+document.querySelector('input').value">Comprar</button>`, {
      headers: { "content-type": "text/html" }
    })
})
const b = new Browsers(mkdtempSync(join(tmpdir(), "zero-browser-")))
afterAll(async () => {
  await b.close()
  site.stop(true)
})

test.skipIf(!chrome)(
  "browser tools: navigate, snapshot with refs, type and click by ref; a person's hold refuses the agent",
  async () => {
    expect(await runBrowserTool(b, "chat-1", "browser_navigate", { url: `http://127.0.0.1:${site.port}/` })).toContain("Loja")
    const snap = await runBrowserTool(b, "chat-1", "browser_snapshot", {})
    const input = /textbox "Email" \[ref=(e\d+)\]/.exec(snap)?.[1]
    const button = /button "Comprar" \[ref=(e\d+)\]/.exec(snap)?.[1]
    expect(input && button).toBeTruthy()
    await runBrowserTool(b, "chat-1", "browser_type", { ref: input, text: "a@b.c" })
    await runBrowserTool(b, "chat-1", "browser_click", { ref: button })
    expect(await runBrowserTool(b, "chat-1", "browser_snapshot", {})).toContain('heading "ok a@b.c"')
    expect((await b.tabs("chat-2")).length).toBe(0) // another chat has its own tabs

    b.setControl("chat-1", true)
    await expect(runBrowserTool(b, "chat-1", "browser_snapshot", {})).rejects.toThrow(/controlling the browser/)
    b.setControl("chat-1", false)
    expect(await runBrowserTool(b, "chat-1", "browser_snapshot", {})).toContain("Loja")
  },
  30_000
)
