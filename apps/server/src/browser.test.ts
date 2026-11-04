import { afterAll, expect, test } from "bun:test"
import { existsSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Browsers, parsePanelFrame, runBrowserTool, stepOf } from "./browser.ts"

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

test("stepOf: browser_run steps to tools; anything else is refused", () => {
  expect(stepOf({ click: "e3" })).toEqual({ name: "browser_click", args: { ref: "e3" } })
  expect(stepOf({ type: "e1", text: "hi", submit: true })).toEqual({ name: "browser_type", args: { ref: "e1", text: "hi", submit: true } })
  expect(stepOf({ wait: 2 })).toEqual({ name: "browser_wait", args: { seconds: 2 } })
  expect(stepOf({ eval: "1" })).toBeUndefined()
})

// A real Chrome (skipped when the machine has none): read, type and click by ref, and the person's hold.
const chrome = existsSync("/Applications/Google Chrome.app")
const site = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch: () =>
    new Response(`<title>Shop</title><h1>Shop</h1><label>Email <input></label><button onclick="document.querySelector('h1').textContent='ok '+document.querySelector('input').value">Buy</button><button onclick="document.querySelector('h1').textContent=confirm('Sure?')?'yes':'no'">Ask</button>`, {
      headers: { "content-type": "text/html" }
    })
})
const b = new Browsers(mkdtempSync(join(tmpdir(), "zorel-browser-")))
afterAll(async () => {
  await b.close()
  site.stop(true)
})

test.skipIf(!chrome)(
  "browser tools: navigate, snapshot with refs, type and click by ref; a person's hold refuses the agent",
  async () => {
    expect(await runBrowserTool(b, "chat-1", "browser_navigate", { url: `http://127.0.0.1:${site.port}/` })).toContain("Shop")
    const snap = await runBrowserTool(b, "chat-1", "browser_snapshot", {})
    const input = /textbox "Email" \[ref=(e\d+)\]/.exec(snap)?.[1]
    const button = /button "Buy" \[ref=(e\d+)\]/.exec(snap)?.[1]
    expect(input && button).toBeTruthy()
    await runBrowserTool(b, "chat-1", "browser_type", { ref: input, text: "a@b.c" })
    await runBrowserTool(b, "chat-1", "browser_click", { ref: button })
    expect(await runBrowserTool(b, "chat-1", "browser_snapshot", {})).toContain('heading "ok a@b.c"')
    expect((await b.tabs("chat-2")).length).toBe(0) // another chat has its own tabs

    // One call, several steps; a confirm is dismissed by default and reported, or accepted when asked.
    const ask = /button "Ask" \[ref=(e\d+)\]/.exec(await runBrowserTool(b, "chat-1", "browser_snapshot", {}))?.[1]
    const run = await runBrowserTool(b, "chat-1", "browser_run", { steps: [{ click: ask }] })
    expect(run).toContain('heading "no"')
    expect(run).toContain('Dialogs: confirm "Sure?" → dismissed')
    await runBrowserTool(b, "chat-1", "browser_dialog", { accept: true })
    expect(await runBrowserTool(b, "chat-1", "browser_run", { steps: [{ click: ask }] })).toContain('heading "yes"')

    b.setControl("chat-1", true)
    await expect(runBrowserTool(b, "chat-1", "browser_snapshot", {})).rejects.toThrow(/controlling the browser/)
    b.setControl("chat-1", false)
    expect(await runBrowserTool(b, "chat-1", "browser_snapshot", {})).toContain("Shop")
  },
  30_000
)
