// The agents' browser (see docs: the chat's Browser panel). One headless Chromium for the whole server, opened on
// first use by Playwright over a pipe only the server holds (never a debugging port another process here could
// reach): the installed Google Chrome, else Microsoft Edge, else the Chromium bundled with the desktop app (or
// Playwright's own). Each agent browses in a context of its own (cookies, storage, logins apart from the others; the
// person's tabs in one more), saved encrypted under the data folder so a site signed into once stays signed in.
// Each chat has its own tabs; the agents drive them through the tools below (read the page as an accessibility
// snapshot with [ref=eN] handles, act on a ref), and the Browser panel watches the chat's active tab live (CDP
// screencast) and can take over: while a person holds the browser, every agent tool on that chat is refused.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve, sep } from "node:path"
import { Context, Effect, Layer } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import type * as Playwright from "playwright-core"
import type { Browser, BrowserContext, CDPSession, Dialog, Page } from "playwright-core"

// playwright-core isn't compiled into the server binary: at run time it reads its own files (package.json,
// browsers.json) through __dirname, which `bun build --compile` freezes at the build machine's path, so the
// installed app crashed on the first browser use. The desktop app ships the package next to the server and
// names it in ZOREL_PLAYWRIGHT; in development it's the ordinary dependency.
const playwright = (): typeof Playwright => require(process.env.ZOREL_PLAYWRIGHT || "playwright-core")
import { DataDir } from "./chat.ts"
import { Store } from "./db.ts"
import { BROWSER_KEY, Secrets } from "./secrets.ts"

// Where to find a browser, in order: Google Chrome, Microsoft Edge (on every Windows), then Playwright's Chromium
// (bundled with the desktop app: PLAYWRIGHT_BROWSERS_PATH).
const CHANNELS = ["chrome", "msedge", undefined] as const
const ACTION_MS = 15_000
const NAV_MS = 30_000
const VIEWPORT = { width: 1280, height: 800 }
export const YOU = "you" // the profile of the tabs a person opens from the panel
const IV_BYTES = 12 // AES-GCM nonce
const TAG_BYTES = 16 // AES-GCM tag

export interface TabInfo {
  readonly id: string
  readonly title: string
  readonly url: string
  readonly active: boolean
}

interface ChatBrowser {
  readonly tabs: Map<string, Page>
  readonly profiles: Map<string, string> // tab → whose context it lives in
  active: string | undefined
  userControl: boolean // a person holds the browser: agent tools are refused
  readonly watchers: Set<Watcher>
  lastFrame?: Uint8Array | undefined // a still page sends no new frames: a panel that attaches gets this one
  dialogs: string[] // alerts/confirms/prompts the page opened since the last tool result (told to the agent)
  nextDialog?: { accept: boolean; text?: string | undefined } | undefined // how to answer the next one (default: dismiss)
}

// A Browser panel attached to a chat: it gets state changes and the active tab's frames.
export interface Watcher {
  readonly state: (s: { tabs: ReadonlyArray<TabInfo>; userControl: boolean }) => void
  readonly frame: (jpeg: Uint8Array) => void
}

export class BrowserError extends Error {}

// A context's name from an agent id (YOU for the person, "assistant" without an agent): also its file name.
export const profileOf = (agentId: string | undefined) => (agentId ?? "assistant").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 64) || "assistant"

type State = Awaited<ReturnType<BrowserContext["storageState"]>>

// Saved logins: AES-256-GCM with a key from the system keychain, so the file alone (readable by anything that can
// read the data folder, agents included) gives nothing away.
export const seal = (key: Buffer, state: State) => {
  const iv = randomBytes(IV_BYTES)
  const c = createCipheriv("aes-256-gcm", key, iv)
  const body = Buffer.concat([c.update(JSON.stringify(state), "utf8"), c.final()])
  return Buffer.concat([iv, c.getAuthTag(), body])
}
export const unseal = (key: Buffer, bytes: Buffer): State => {
  const d = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, IV_BYTES))
  d.setAuthTag(bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES))
  return JSON.parse(Buffer.concat([d.update(bytes.subarray(IV_BYTES + TAG_BYTES)), d.final()]).toString("utf8")) as State
}

// The first browser that starts, in CHANNELS order.
async function launch(): Promise<Browser> {
  let last: unknown
  for (const channel of CHANNELS) {
    try {
      return await playwright().chromium.launch({ headless: true, ...(channel && { channel }) })
    } catch (e) {
      last = e
    }
  }
  throw new BrowserError(`No browser to run: install Google Chrome, or run \`bunx playwright install chromium-headless-shell\`. (${last instanceof Error ? last.message.split("\n")[0] : last})`)
}

export class Browsers {
  private browser: Promise<Browser> | undefined
  private contexts = new Map<string, Promise<BrowserContext>>()
  private chats = new Map<string, ChatBrowser>()
  private screencast: { page: Page; cdp: CDPSession } | undefined

  constructor(
    private readonly stateDir: string,
    private readonly key: Buffer
  ) {}

  // Opened on first use and shared by every context.
  private open(): Promise<Browser> {
    this.browser ??= launch().catch((e) => {
      this.browser = undefined
      throw e
    })
    return this.browser
  }

  private file = (profile: string) => join(this.stateDir, `${profile}.bin`)

  // A profile's context, with its saved logins (a file that no longer decrypts starts empty).
  private context(profile: string): Promise<BrowserContext> {
    let ctx = this.contexts.get(profile)
    if (!ctx) {
      ctx = (async () => {
        const browser = await this.open()
        let storageState: State | undefined
        try {
          if (existsSync(this.file(profile))) storageState = unseal(this.key, readFileSync(this.file(profile)))
        } catch (e) {
          console.warn(`browser: saved logins of ${profile} not readable, starting empty`, e instanceof Error ? e.message : e)
        }
        return browser.newContext({ viewport: VIEWPORT, acceptDownloads: false, ...(storageState && { storageState }) })
      })()
      ctx.catch(() => this.contexts.delete(profile))
      this.contexts.set(profile, ctx)
    }
    return ctx
  }

  // Writes a profile's logins (after the agent acted, after a person, at exit).
  async save(profile: string) {
    const ctx = await this.contexts.get(profile)?.catch(() => undefined)
    if (!ctx) return
    const state = await ctx.storageState({ indexedDB: true }).catch(() => undefined)
    if (!state) return
    mkdirSync(this.stateDir, { recursive: true })
    writeFileSync(this.file(profile), seal(this.key, state), { mode: 0o600 })
  }

  private chat(chatId: string): ChatBrowser {
    let c = this.chats.get(chatId)
    if (!c) {
      c = { tabs: new Map(), profiles: new Map(), active: undefined, userControl: false, watchers: new Set(), dialogs: [] }
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

  async newTab(chatId: string, url?: string, profile = profileOf(undefined)): Promise<string> {
    const to = url && webUrl(url) // before any tab opens
    const page = await (await this.context(profile)).newPage()
    const id = await this.adopt(chatId, page, profile)
    if (to) await page.goto(to, { timeout: NAV_MS, waitUntil: "domcontentloaded" }).catch(() => undefined)
    return id
  }

  // A page joins the chat as its active tab (a new one, or a popup a page opened: same profile).
  private async adopt(chatId: string, page: Page, profile: string): Promise<string> {
    const id = crypto.randomUUID()
    const c = this.chat(chatId)
    c.tabs.set(id, page)
    c.profiles.set(id, profile)
    c.active = id
    const changed = () => void this.notify(chatId)
    page.on("framenavigated", (f) => f === page.mainFrame() && changed())
    page.on("load", changed)
    page.on("popup", (popup) => void this.adopt(chatId, popup, profile))
    page.on("dialog", (d) => void this.dialog(chatId, d))
    page.on("close", () => {
      c.tabs.delete(id)
      c.profiles.delete(id)
      if (c.active === id) c.active = [...c.tabs.keys()].at(-1)
      void this.watch(chatId)
      changed()
    })
    await this.watch(chatId)
    changed()
    return id
  }

  // A page's alert/confirm/prompt never blocks the agent: it is answered (dismissed unless the agent asked to
  // accept the next one with browser_dialog) and reported in the next tool result.
  private async dialog(chatId: string, d: Dialog) {
    const c = this.chat(chatId)
    const how = c.nextDialog
    c.nextDialog = undefined
    if (how?.accept) await d.accept(how.text).catch(() => undefined)
    else await d.dismiss().catch(() => undefined)
    c.dialogs.push(`${d.type()} "${d.message().slice(0, 300)}" → ${how?.accept ? "accepted" : "dismissed"}`)
  }
  setNextDialog(chatId: string, accept: boolean, text?: string) {
    this.chat(chatId).nextDialog = { accept, text }
  }
  takeDialogs(chatId: string): string[] {
    const c = this.chat(chatId)
    return c.dialogs.splice(0)
  }

  // The active tab, opening one in this profile when the chat has none.
  async page(chatId: string, tabId?: string, profile?: string): Promise<Page> {
    const c = this.chat(chatId)
    if (tabId) {
      const p = c.tabs.get(tabId)
      if (!p) throw new BrowserError(`No tab ${tabId} in this chat. Call browser_tabs to list them.`)
      return p
    }
    if (!c.active || !c.tabs.get(c.active)) await this.newTab(chatId, undefined, profile)
    return c.tabs.get(c.active!)!
  }

  // Whose context the chat's active tab lives in.
  activeProfile(chatId: string): string | undefined {
    const c = this.chat(chatId)
    return c.active ? c.profiles.get(c.active) : undefined
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
    const c = this.chat(chatId)
    if (c.userControl && !user) void this.save(this.activeProfile(chatId) ?? YOU) // what they signed into stays
    c.userControl = user
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
    for (const profile of this.contexts.keys()) await this.save(profile)
    const browser = await this.browser?.catch(() => undefined)
    await browser?.close().catch(() => undefined)
  }
}

export const normalizeUrl = (url: string) => (/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`)
// Agents browse the web only: file:, chrome:, view-source: and the like would read this computer without asking.
const WEB = /^https?:\/\//i
export const webUrl = (url: string) => {
  const u = normalizeUrl(url)
  if (!WEB.test(u)) throw new BrowserError("Only http and https addresses.")
  return u
}

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
  },
  {
    name: "browser_hover",
    description: "Move the pointer over the element with this ref (menus, tooltips).",
    inputSchema: { properties: { ref: { type: "string" } }, required: ["ref"] },
    writes: false
  },
  {
    name: "browser_select",
    description: "Choose option(s) of the <select> with this ref, by value or label.",
    inputSchema: { properties: { ref: { type: "string" }, values: { type: "array", items: { type: "string" } } }, required: ["ref", "values"] },
    writes: true
  },
  {
    name: "browser_scroll",
    description: "Scroll the active tab by dy pixels (negative goes up); read again with browser_snapshot.",
    inputSchema: { properties: { dy: { type: "number" } }, required: ["dy"] },
    writes: false
  },
  {
    name: "browser_upload",
    description: "Put files from the chat's folder into the file input (or the button that opens a file picker) with this ref. paths: relative to the chat's folder.",
    inputSchema: { properties: { ref: { type: "string" }, paths: { type: "array", items: { type: "string" } } }, required: ["ref", "paths"] },
    writes: true
  },
  {
    name: "browser_dialog",
    description: "Alerts, confirms and prompts are dismissed and reported in your next result. Call this to accept the NEXT one instead (text: a prompt's answer).",
    inputSchema: { properties: { accept: { type: "boolean" }, text: { type: "string" } }, required: ["accept"] },
    writes: false
  },
  {
    name: "browser_run",
    description:
      "Do several steps in one call and get the page back once (fewer round trips than one tool per step). steps: up to 20 of {navigate:url} | {click:ref} | {type:ref, text, submit?} | {press:key} | {hover:ref} | {select:ref, values} | {scroll:dy} | {wait:text|seconds}. Stops at the first step that fails, saying which.",
    inputSchema: { properties: { steps: { type: "array", maxItems: 20, items: { type: "object" } } }, required: ["steps"] },
    writes: true
  }
] as const

export type BrowserToolName = (typeof BROWSER_TOOLS)[number]["name"]
const str = (v: unknown) => (typeof v === "string" ? v : "")

const pageLine = async (page: Page) => `${(await page.title().catch(() => "")) || "(untitled)"} — ${page.url()}`

// One tool call on the chat's browser; the text the model gets back (with any dialog the page opened meanwhile).
// root: the chat's folder (uploads come only from inside it). profile: whose context a tab the agent opens uses.
export async function runBrowserTool(b: Browsers, chatId: string, name: BrowserToolName, args: Record<string, unknown>, root?: string, profile?: string): Promise<string> {
  b.guard(chatId)
  const text = await browserStep(b, chatId, name, args, root, profile)
  if (BROWSER_TOOLS.find((t) => t.name === name)?.writes) void b.save(b.activeProfile(chatId) ?? profileOf(undefined)) // a sign-in it just did stays
  const dialogs = b.takeDialogs(chatId)
  return dialogs.length ? `${text}\nDialogs: ${dialogs.join("; ")}` : text
}

// A browser_run step to the tool it stands for.
export function stepOf(step: Record<string, unknown>): { name: BrowserToolName; args: Record<string, unknown> } | undefined {
  if (typeof step.navigate === "string") return { name: "browser_navigate", args: { url: step.navigate } }
  if (typeof step.click === "string") return { name: "browser_click", args: { ref: step.click } }
  if (typeof step.type === "string") return { name: "browser_type", args: { ref: step.type, text: step.text, submit: step.submit } }
  if (typeof step.press === "string") return { name: "browser_press", args: { key: step.press } }
  if (typeof step.hover === "string") return { name: "browser_hover", args: { ref: step.hover } }
  if (typeof step.select === "string") return { name: "browser_select", args: { ref: step.select, values: step.values } }
  if (typeof step.scroll === "number") return { name: "browser_scroll", args: { dy: step.scroll } }
  if (typeof step.wait === "string") return { name: "browser_wait", args: { text: step.wait } }
  if (typeof step.wait === "number") return { name: "browser_wait", args: { seconds: step.wait } }
  return undefined
}

async function browserStep(b: Browsers, chatId: string, name: BrowserToolName, args: Record<string, unknown>, root?: string, profile?: string): Promise<string> {
  const page_ = () => b.page(chatId, undefined, profile)
  switch (name) {
    case "browser_navigate": {
      const page = await page_()
      const url = webUrl(str(args.url))
      await page.goto(url, { timeout: NAV_MS, waitUntil: "domcontentloaded" })
      return `Opened ${await pageLine(page)}`
    }
    case "browser_snapshot": {
      const page = await page_()
      const snap = await page.ariaSnapshot({ mode: "ai" })
      const head = `Page: ${await pageLine(page)}\n`
      return head + snap // a long page is shortened for the agent like any large result (tools.ts compact)
    }
    case "browser_click": {
      const page = await page_()
      await page.getByRef(str(args.ref)).click({ timeout: ACTION_MS })
      await page.waitForLoadState("domcontentloaded", { timeout: ACTION_MS }).catch(() => undefined)
      return `Clicked. Now: ${await pageLine(page)}`
    }
    case "browser_type": {
      const page = await page_()
      const field = page.getByRef(str(args.ref))
      await field.fill(str(args.text), { timeout: ACTION_MS })
      if (args.submit === true) await field.press("Enter", { timeout: ACTION_MS })
      return args.submit === true ? `Typed and submitted. Now: ${await pageLine(page)}` : "Typed."
    }
    case "browser_press": {
      const page = await page_()
      await page.keyboard.press(str(args.key))
      return `Pressed ${str(args.key)}. Now: ${await pageLine(page)}`
    }
    case "browser_wait": {
      const page = await page_()
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
      if (action === "new") await b.newTab(chatId, str(args.url) || undefined, profile)
      else if (action === "select") await b.select(chatId, str(args.id))
      else if (action === "close") await b.closeTab(chatId, str(args.id))
      const tabs = await b.tabs(chatId)
      return tabs.length ? tabs.map((t) => `${t.active ? "*" : " "} ${t.id}  ${t.title || "(untitled)"} — ${t.url}`).join("\n") : "No tabs."
    }
    case "browser_back": {
      const page = await page_()
      await page.goBack({ timeout: NAV_MS, waitUntil: "domcontentloaded" })
      return `Back. Now: ${await pageLine(page)}`
    }
    case "browser_hover": {
      const page = await page_()
      await page.getByRef(str(args.ref)).hover({ timeout: ACTION_MS })
      return "Hovered."
    }
    case "browser_select": {
      const page = await page_()
      const values = Array.isArray(args.values) ? args.values.map(String) : [str(args.values)]
      const chosen = await page.getByRef(str(args.ref)).selectOption(values, { timeout: ACTION_MS })
      return `Selected ${chosen.join(", ") || "nothing"}.`
    }
    case "browser_scroll": {
      const page = await page_()
      await page.mouse.wheel(0, Number(args.dy) || 0)
      return "Scrolled."
    }
    case "browser_upload": {
      if (!root) throw new BrowserError("Uploads need a chat folder.")
      const paths = (Array.isArray(args.paths) ? args.paths : []).map((p) => resolve(root, String(p)))
      const outside = paths.find((p) => !(p === root || p.startsWith(root + sep)) || !existsSync(p))
      if (!paths.length || outside) throw new BrowserError(`Only existing files inside the chat's folder${outside ? ` (not ${outside})` : ""}.`)
      const page = await page_()
      const target = page.getByRef(str(args.ref))
      // A file input takes the files directly; a button that opens a picker gets them through the chooser.
      await target.setInputFiles(paths, { timeout: ACTION_MS }).catch(async () => {
        const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: ACTION_MS }), target.click({ timeout: ACTION_MS })])
        await chooser.setFiles(paths)
      })
      return `Attached ${paths.length} file${paths.length > 1 ? "s" : ""}.`
    }
    case "browser_dialog": {
      b.setNextDialog(chatId, args.accept === true, typeof args.text === "string" ? args.text : undefined)
      return args.accept === true ? "The next dialog will be accepted." : "The next dialog will be dismissed."
    }
    case "browser_run": {
      const steps = (Array.isArray(args.steps) ? args.steps : []).slice(0, 20)
      for (const [i, raw] of steps.entries()) {
        const step = stepOf((raw ?? {}) as Record<string, unknown>)
        if (!step || step.name === "browser_run") throw new BrowserError(`Step ${i + 1} is not one of navigate, click, type, press, hover, select, scroll, wait.`)
        try {
          await browserStep(b, chatId, step.name, step.args, root, profile)
        } catch (e) {
          throw new BrowserError(`Step ${i + 1} (${step.name.replace("browser_", "")}) failed: ${e instanceof Error ? e.message.split("\n")[0] : e}`)
        }
      }
      return `Did ${steps.length} step${steps.length === 1 ? "" : "s"}.\n${await browserStep(b, chatId, "browser_snapshot", {}, root, profile)}`
    }
  }
}

export class BrowserService extends Context.Service<BrowserService, Browsers>()("BrowserService") {
  static layer = Layer.effect(
    BrowserService,
    Effect.gen(function* () {
      const dataDir = yield* DataDir
      const secrets = yield* Secrets
      // The key the saved logins are sealed with: made once, kept in the keychain.
      if (!secrets.get(BROWSER_KEY)) yield* Effect.promise(() => secrets.set(BROWSER_KEY, randomBytes(32).toString("hex")))
      const key = Buffer.from(secrets.get(BROWSER_KEY)!, "hex")
      return yield* Effect.acquireRelease(
        Effect.sync(() => new Browsers(join(dataDir, "browser", "state"), key)),
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
  if (f.t === "newtab") return void (await b.newTab(chatId, undefined, YOU))
  if (f.t === "tab") return b.select(chatId, f.id)
  if (f.t === "close") return b.closeTab(chatId, f.id)
  const page = await b.page(chatId, undefined, YOU)
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
      if (WEB.test(url)) await page.goto(url, { timeout: NAV_MS, waitUntil: "domcontentloaded" })
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
