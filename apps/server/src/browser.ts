// The agents' browser (see docs: the chat's Browser panel). One headless Chrome for the whole server, opened on
// first use with Playwright over the installed Google Chrome (falls back to Playwright's Chromium), in one
// persistent profile under the data folder, so a site signed into once stays signed in. Each chat has its own
// tabs; the agents drive them through the tools below (read the page as an accessibility snapshot with
// [ref=eN] handles, act on a ref), and the Browser panel watches the chat's active tab live (CDP screencast)
// and can take over: while a person holds the browser, every agent tool on that chat is refused.
import { join } from "node:path"
import { Context, Effect, Layer } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { type BrowserContext, type CDPSession, chromium, type Page } from "playwright-core"
import { DataDir } from "./chat.ts"
import { Store } from "./db.ts"

export const MAX_SNAPSHOT_CHARS = 30_000
const ACTION_MS = 15_000
const NAV_MS = 30_000
const VIEWPORT = { width: 1280, height: 800 }

export interface TabInfo {
  readonly id: string
  readonly title: string
  readonly url: string
  readonly active: boolean
}

interface ChatBrowser {
  readonly tabs: Map<string, Page>
  active: string | undefined
  userControl: boolean // a person holds the browser: agent tools are refused
  readonly watchers: Set<Watcher>
  lastFrame?: Uint8Array | undefined // a still page sends no new frames: a panel that attaches gets this one
}

// A Browser panel attached to a chat: it gets state changes and the active tab's frames.
export interface Watcher {
  readonly state: (s: { tabs: ReadonlyArray<TabInfo>; userControl: boolean }) => void
  readonly frame: (jpeg: Uint8Array) => void
}

export class BrowserError extends Error {}

export class Browsers {
  private context: Promise<BrowserContext> | undefined
  private chats = new Map<string, ChatBrowser>()
  private screencast: { page: Page; cdp: CDPSession } | undefined

  constructor(private readonly profileDir: string) {}

  // Opened on first use; the installed Chrome when there is one, else Playwright's Chromium.
  private open(): Promise<BrowserContext> {
    this.context ??= (async () => {
      const options = { headless: true, viewport: VIEWPORT, acceptDownloads: false }
      try {
        return await chromium.launchPersistentContext(this.profileDir, { ...options, channel: "chrome" })
      } catch {
        try {
          return await chromium.launchPersistentContext(this.profileDir, options)
        } catch (e) {
          this.context = undefined
          throw new BrowserError(`No browser to run: install Google Chrome, or run \`bunx playwright install chromium\`. (${e instanceof Error ? e.message.split("\n")[0] : e})`)
        }
      }
    })()
    return this.context
  }

  private chat(chatId: string): ChatBrowser {
    let c = this.chats.get(chatId)
    if (!c) {
      c = { tabs: new Map(), active: undefined, userControl: false, watchers: new Set() }
      this.chats.set(chatId, c)
    }
    return c
  }

  async tabs(chatId: string): Promise<TabInfo[]> {
    const c = this.chat(chatId)
    return Promise.all(
      [...c.tabs].map(async ([id, page]) => ({ id, url: page.url(), title: await page.title().catch(() => ""), active: id === c.active }))
    )
  }

  // Tells the chat's panels what changed (tabs, titles, control).
  private async notify(chatId: string) {
    const c = this.chat(chatId)
    if (!c.watchers.size) return
    const state = { tabs: await this.tabs(chatId), userControl: c.userControl }
    for (const w of c.watchers) w.state(state)
  }

  async newTab(chatId: string, url?: string): Promise<string> {
    const context = await this.open()
    const page = await context.newPage()
    const id = crypto.randomUUID()
    const c = this.chat(chatId)
    c.tabs.set(id, page)
    c.active = id
    const changed = () => void this.notify(chatId)
    page.on("framenavigated", (f) => f === page.mainFrame() && changed())
    page.on("load", changed)
    page.on("close", () => {
      c.tabs.delete(id)
      if (c.active === id) c.active = [...c.tabs.keys()].at(-1)
      void this.watch(chatId)
      changed()
    })
    // A page that opens a popup: the popup becomes a tab of the same chat.
    page.on("popup", (popup) => void this.adopt(chatId, popup))
    if (url) await page.goto(normalizeUrl(url), { timeout: NAV_MS, waitUntil: "domcontentloaded" }).catch(() => undefined)
    await this.watch(chatId)
    changed()
    return id
  }

  private async adopt(chatId: string, page: Page) {
    const id = crypto.randomUUID()
    const c = this.chat(chatId)
    c.tabs.set(id, page)
    c.active = id
    page.on("close", () => {
      c.tabs.delete(id)
      if (c.active === id) c.active = [...c.tabs.keys()].at(-1)
      void this.watch(chatId)
      void this.notify(chatId)
    })
    await this.watch(chatId)
    await this.notify(chatId)
  }

  // The active tab, opening one when the chat has none.
  async page(chatId: string, tabId?: string): Promise<Page> {
    const c = this.chat(chatId)
    if (tabId) {
      const p = c.tabs.get(tabId)
      if (!p) throw new BrowserError(`No tab ${tabId} in this chat. Call browser_tabs to list them.`)
      return p
    }
    if (!c.active || !c.tabs.get(c.active)) await this.newTab(chatId)
    return c.tabs.get(c.active!)!
  }

  async select(chatId: string, tabId: string) {
    const c = this.chat(chatId)
    if (!c.tabs.has(tabId)) throw new BrowserError(`No tab ${tabId} in this chat.`)
    c.active = tabId
    await this.watch(chatId)
    await this.notify(chatId)
  }

  async closeTab(chatId: string, tabId: string) {
    await this.chat(chatId).tabs.get(tabId)?.close()
  }

  // Agent tools pass here first: a person holding the browser blocks them.
  guard(chatId: string) {
    if (this.chat(chatId).userControl) throw new BrowserError("The user is controlling the browser right now. Wait for them to hand it back, then read the page again.")
  }

  setControl(chatId: string, user: boolean) {
    this.chat(chatId).userControl = user
    void this.notify(chatId)
  }

  // ---------- live view ----------

  async attach(chatId: string, w: Watcher): Promise<() => void> {
    const c = this.chat(chatId)
    c.watchers.add(w)
    await this.watch(chatId)
    await this.notify(chatId)
    if (c.lastFrame) w.frame(c.lastFrame)
    return () => {
      c.watchers.delete(w)
      void this.watch(chatId)
    }
  }

  // Screencasts the active tab of a chat that a panel watches (one screencast at a time: the last watched chat).
  private async watch(chatId: string) {
    const c = this.chat(chatId)
    const page = c.watchers.size && c.active ? c.tabs.get(c.active) : undefined
    if (this.screencast?.page === page) return
    if (this.screencast) {
      const old = this.screencast
      this.screencast = undefined
      await old.cdp.send("Page.stopScreencast").catch(() => undefined)
      await old.cdp.detach().catch(() => undefined)
    }
    if (!page) return
    const cdp = await page.context().newCDPSession(page)
    this.screencast = { page, cdp }
    cdp.on("Page.screencastFrame", (f) => {
      void cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => undefined)
      const jpeg = Buffer.from(f.data, "base64")
      c.lastFrame = jpeg
      for (const w of c.watchers) w.frame(jpeg)
    })
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 70, maxWidth: VIEWPORT.width, maxHeight: VIEWPORT.height, everyNthFrame: 1 }).catch(() => undefined)
  }

  async close() {
    const context = await this.context?.catch(() => undefined)
    await context?.close().catch(() => undefined)
  }
}

export const normalizeUrl = (url: string) => (/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`)

// ---------- the agents' tools ----------

export const BROWSER_TOOLS = [
  {
    name: "browser_navigate",
    description: "Open a URL in the chat's browser (the active tab; opens one if none). Returns the page title and URL; call browser_snapshot to read it.",
    inputSchema: { properties: { url: { type: "string" } }, required: ["url"] },
    writes: true
  },
  {
    name: "browser_snapshot",
    description:
      "Read the active tab as an accessibility tree. Each element has a [ref=eN] handle for browser_click / browser_type. Refs are valid until the page changes; read again after acting.",
    inputSchema: { properties: {} },
    writes: false
  },
  {
    name: "browser_click",
    description: "Click the element with this ref (from the last browser_snapshot). Returns the page title and URL.",
    inputSchema: { properties: { ref: { type: "string" }, element: { type: "string", description: "what it is, in words, for the user" } }, required: ["ref"] },
    writes: true
  },
  {
    name: "browser_type",
    description: "Replace the text of the field with this ref; submit=true presses Enter after.",
    inputSchema: { properties: { ref: { type: "string" }, text: { type: "string" }, submit: { type: "boolean" } }, required: ["ref", "text"] },
    writes: true
  },
  {
    name: "browser_press",
    description: "Press a key or chord in the active tab (Enter, Escape, ArrowDown, Control+A…).",
    inputSchema: { properties: { key: { type: "string" } }, required: ["key"] },
    writes: true
  },
  {
    name: "browser_wait",
    description: "Wait until some text shows on the page (up to 15 s), or for a number of seconds (up to 10).",
    inputSchema: { properties: { text: { type: "string" }, seconds: { type: "number" } } },
    writes: false
  },
  {
    name: "browser_tabs",
    description: "Manage the chat's tabs: list (default), new (optionally with url), select, or close (by id). Pages stay open between turns.",
    inputSchema: { properties: { action: { type: "string", enum: ["list", "new", "select", "close"] }, id: { type: "string" }, url: { type: "string" } } },
    writes: false
  },
  {
    name: "browser_back",
    description: "Go back in the active tab's history.",
    inputSchema: { properties: {} },
    writes: true
  }
] as const

export type BrowserToolName = (typeof BROWSER_TOOLS)[number]["name"]
const str = (v: unknown) => (typeof v === "string" ? v : "")

const pageLine = async (page: Page) => `${(await page.title().catch(() => "")) || "(untitled)"} — ${page.url()}`

// One tool call on the chat's browser; the text the model gets back.
export async function runBrowserTool(b: Browsers, chatId: string, name: BrowserToolName, args: Record<string, unknown>): Promise<string> {
  b.guard(chatId)
  switch (name) {
    case "browser_navigate": {
      const page = await b.page(chatId)
      const url = normalizeUrl(str(args.url))
      if (!/^https?:\/\//i.test(url)) throw new BrowserError("Only http and https addresses.")
      await page.goto(url, { timeout: NAV_MS, waitUntil: "domcontentloaded" })
      return `Opened ${await pageLine(page)}`
    }
    case "browser_snapshot": {
      const page = await b.page(chatId)
      const snap = await page.ariaSnapshot({ mode: "ai" })
      const head = `Page: ${await pageLine(page)}\n`
      return head + (snap.length > MAX_SNAPSHOT_CHARS ? `${snap.slice(0, MAX_SNAPSHOT_CHARS)}\n… (cut; scroll or narrow down)` : snap)
    }
    case "browser_click": {
      const page = await b.page(chatId)
      await page.locator(`aria-ref=${str(args.ref)}`).click({ timeout: ACTION_MS })
      await page.waitForLoadState("domcontentloaded", { timeout: ACTION_MS }).catch(() => undefined)
      return `Clicked. Now: ${await pageLine(page)}`
    }
    case "browser_type": {
      const page = await b.page(chatId)
      const field = page.locator(`aria-ref=${str(args.ref)}`)
      await field.fill(str(args.text), { timeout: ACTION_MS })
      if (args.submit === true) await field.press("Enter", { timeout: ACTION_MS })
      return args.submit === true ? `Typed and submitted. Now: ${await pageLine(page)}` : "Typed."
    }
    case "browser_press": {
      const page = await b.page(chatId)
      await page.keyboard.press(str(args.key))
      return `Pressed ${str(args.key)}. Now: ${await pageLine(page)}`
    }
    case "browser_wait": {
      const page = await b.page(chatId)
      if (str(args.text)) {
        await page.getByText(str(args.text)).first().waitFor({ state: "visible", timeout: ACTION_MS })
        return `"${str(args.text)}" is on the page.`
      }
      const s = Math.min(10, Math.max(0, Number(args.seconds) || 1))
      await page.waitForTimeout(s * 1000)
      return `Waited ${s} s.`
    }
    case "browser_tabs": {
      const action = str(args.action) || "list"
      if (action === "new") await b.newTab(chatId, str(args.url) || undefined)
      else if (action === "select") await b.select(chatId, str(args.id))
      else if (action === "close") await b.closeTab(chatId, str(args.id))
      const tabs = await b.tabs(chatId)
      return tabs.length ? tabs.map((t) => `${t.active ? "*" : " "} ${t.id}  ${t.title || "(untitled)"} — ${t.url}`).join("\n") : "No tabs."
    }
    case "browser_back": {
      const page = await b.page(chatId)
      await page.goBack({ timeout: NAV_MS, waitUntil: "domcontentloaded" })
      return `Back. Now: ${await pageLine(page)}`
    }
  }
}

export class BrowserService extends Context.Service<BrowserService, Browsers>()("BrowserService") {
  static layer = Layer.effect(
    BrowserService,
    Effect.gen(function* () {
      const dataDir = yield* DataDir
      return yield* Effect.acquireRelease(
        Effect.sync(() => new Browsers(join(dataDir, "browser", "profile"))),
        (b) => Effect.promise(() => b.close())
      )
    })
  )
}

// ---------- the Browser panel's socket ----------

// From the panel: input on the active tab (positions are fractions of the frame), navigation, tabs, control.
export type PanelFrame =
  | { t: "click"; x: number; y: number; button?: "left" | "right"; clicks?: number }
  | { t: "wheel"; x: number; y: number; dx: number; dy: number }
  | { t: "key"; key: string }
  | { t: "text"; text: string }
  | { t: "nav"; url: string }
  | { t: "back" | "forward" | "reload" | "newtab" | "release" }
  | { t: "tab" | "close"; id: string }

const frac = (n: unknown) => (typeof n === "number" && n >= 0 && n <= 1 ? n : undefined)
// One frame from the panel, or undefined when it isn't one of ours.
export function parsePanelFrame(raw: string): PanelFrame | undefined {
  try {
    const f = JSON.parse(raw) as Record<string, unknown>
    const x = frac(f.x)
    const y = frac(f.y)
    switch (f.t) {
      case "click":
        return x !== undefined && y !== undefined ? { t: "click", x, y, button: f.button === "right" ? "right" : "left", clicks: f.clicks === 2 ? 2 : 1 } : undefined
      case "wheel":
        return x !== undefined && y !== undefined && typeof f.dx === "number" && typeof f.dy === "number" ? { t: "wheel", x, y, dx: Math.max(-5000, Math.min(5000, f.dx)), dy: Math.max(-5000, Math.min(5000, f.dy)) } : undefined
      case "key":
        return typeof f.key === "string" && f.key.length > 0 && f.key.length <= 40 ? { t: "key", key: f.key } : undefined
      case "text":
        return typeof f.text === "string" && f.text.length <= 10_000 ? { t: "text", text: f.text } : undefined
      case "nav":
        return typeof f.url === "string" && f.url.length <= 4000 ? { t: "nav", url: f.url } : undefined
      case "back":
      case "forward":
      case "reload":
      case "newtab":
      case "release":
        return { t: f.t }
      case "tab":
      case "close":
        return typeof f.id === "string" ? { t: f.t, id: f.id } : undefined
    }
  } catch {}
  return undefined
}

// What a panel frame does. Any input means a person is driving: the browser is theirs until "release".
async function applyPanelFrame(b: Browsers, chatId: string, f: PanelFrame) {
  if (f.t === "release") return b.setControl(chatId, false)
  b.setControl(chatId, true)
  if (f.t === "newtab") return void (await b.newTab(chatId))
  if (f.t === "tab") return b.select(chatId, f.id)
  if (f.t === "close") return b.closeTab(chatId, f.id)
  const page = await b.page(chatId)
  const at = (x: number, y: number) => ({ x: x * VIEWPORT.width, y: y * VIEWPORT.height })
  switch (f.t) {
    case "click": {
      const p = at(f.x, f.y)
      return page.mouse.click(p.x, p.y, { button: f.button ?? "left", clickCount: f.clicks ?? 1 })
    }
    case "wheel": {
      const p = at(f.x, f.y)
      await page.mouse.move(p.x, p.y)
      return page.mouse.wheel(f.dx, f.dy)
    }
    case "key":
      return page.keyboard.press(f.key)
    case "text":
      return page.keyboard.insertText(f.text)
    case "nav": {
      const url = normalizeUrl(f.url.trim())
      if (/^https?:\/\//i.test(url)) await page.goto(url, { timeout: NAV_MS, waitUntil: "domcontentloaded" })
      return
    }
    case "back":
      return void (await page.goBack({ timeout: NAV_MS }).catch(() => undefined))
    case "forward":
      return void (await page.goForward({ timeout: NAV_MS }).catch(() => undefined))
    case "reload":
      return void (await page.reload({ timeout: NAV_MS }).catch(() => undefined))
  }
}

// GET /api/browser?chat=… upgrades to a WebSocket: down, the chat's state as text ({"t":"state",tabs,userControl})
// and the active tab's frames as JPEG bytes; up, PanelFrame JSON. Local only (LocalOnly checks Host and Origin).
export const BrowserSocket = HttpRouter.add(
  "GET",
  "/api/browser",
  Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest
    const chatId = new URL(req.url, "http://x").searchParams.get("chat") ?? ""
    const store = yield* Store
    if (!(yield* store.chat(chatId))) return HttpServerResponse.jsonUnsafe({ error: "chat_not_found" }, { status: 404 })
    const b = yield* BrowserService
    const socket = yield* req.upgrade
    const { write } = yield* socket.writer
    const reader = yield* socket.reader
    const run = (e: Effect.Effect<void, unknown>) => void Effect.runFork(Effect.ignore(e))
    const detach = yield* Effect.promise(() =>
      b.attach(chatId, {
        state: (s) => run(write(JSON.stringify({ t: "state", ...s }))),
        frame: (jpeg) => run(write(jpeg))
      })
    )
    const decoder = new TextDecoder()
    yield* Effect.forever(
      Effect.flatMap(reader.pull, (chunks) =>
        Effect.promise(async () => {
          for (const chunk of chunks) {
            const f = parsePanelFrame(typeof chunk === "string" ? chunk : decoder.decode(chunk))
            if (f) await applyPanelFrame(b, chatId, f).catch((e: unknown) => run(write(JSON.stringify({ t: "error", message: e instanceof Error ? e.message.split("\n")[0] : String(e) }))))
          }
        })
      )
    ).pipe(Effect.ignore, Effect.ensuring(Effect.sync(detach)))
    return HttpServerResponse.empty()
  }).pipe(Effect.scoped, Effect.orDie)
)
