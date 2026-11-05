import { afterAll, expect, test } from "bun:test"
import { randomBytes } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Browsers, parsePanelFrame, runBrowserTool, seal, stepOf, unseal, webUrl } from "./browser.ts"

const KEY = randomBytes(32)

test("agents open web addresses only, in a new tab too (file: would read this computer)", async () => {
  expect(webUrl("example.com")).toBe("https://example.com")
  expect(webUrl("http://127.0.0.1:3000/")).toBe("http://127.0.0.1:3000/")
  for (const u of ["file:///etc/hosts", "chrome://settings", "view-source:https://a.b", "javascript:alert(1)"]) expect(() => webUrl(u)).toThrow("Only http and https")
  // Refused before the browser even starts.
  await expect(new Browsers(join(tmpdir(), "zorel-unused"), KEY).newTab("c", "file:///etc/hosts")).rejects.toThrow("Only http and https")
})

test("saved logins are sealed: the file shows nothing and opens only with its key", () => {
  const state = { cookies: [{ name: "sid", value: "SECRET-COOKIE", domain: "a.b", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" as const }], origins: [] }
  const bytes = seal(KEY, state)
  expect(bytes.toString("utf8")).not.toContain("SECRET-COOKIE")
  expect(unseal(KEY, bytes)).toEqual(state)
  expect(() => unseal(randomBytes(32), bytes)).toThrow()
})

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
  fetch: (req) =>
    new URL(req.url).pathname === "/login"
      ? new Response("<title>In</title>signed in", { headers: { "content-type": "text/html", "set-cookie": "sid=agent-a; Path=/; Max-Age=3600" } })
      : new Response(`<title>Shop</title><h1>Shop</h1><label>Email <input></label><button onclick="document.querySelector('h1').textContent='ok '+document.querySelector('input').value">Buy</button><button onclick="document.querySelector('h1').textContent=confirm('Sure?')?'yes':'no'">Ask</button>`, {
      headers: { "content-type": "text/html" }
    })
})
const b = new Browsers(mkdtempSync(join(tmpdir(), "zorel-browser-")), KEY)
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

test.skipIf(!chrome)(
  "each agent browses in its own context; its logins survive a restart, sealed on disk",
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "zorel-browser-state-"))
    const one = new Browsers(dir, KEY)
    const site_ = `http://127.0.0.1:${site.port}`
    await runBrowserTool(one, "c", "browser_navigate", { url: `${site_}/login` }, undefined, "agent-a")
    const cookie = async (br: Browsers, chat: string, profile: string) => {
      await runBrowserTool(br, chat, "browser_navigate", { url: `${site_}/` }, undefined, profile)
      return (await (await br.page(chat)).context().cookies()).find((c) => c.name === "sid")?.value
    }
    expect(await cookie(one, "c", "agent-a")).toBe("agent-a")
    expect(await cookie(one, "other", "agent-b")).toBeUndefined() // another agent doesn't see it
    await one.close()
    expect(readFileSync(join(dir, "agent-a.bin")).toString("utf8")).not.toContain("agent-a\"")
    const two = new Browsers(dir, KEY)
    expect(await cookie(two, "c", "agent-a")).toBe("agent-a")
    await two.close()
    const wrongKey = new Browsers(dir, randomBytes(32))
    expect(await cookie(wrongKey, "c", "agent-a")).toBeUndefined() // starts empty, doesn't fail
    await wrongKey.close()
  },
  60_000
)
