// The agents' browser in the desktop app (ARCHITECTURE D11). The server asks for tabs over a local control
// endpoint (bearer token); each tab is a WebContentsView in a persistent partition per agent, so logins stay and
// agents don't share cookies. The server drives the views over CDP (Electron refuses to create targets itself).
// Views live in a hidden host window, so agents browse with no window open; the Browser panel borrows the active
// one into the app window at the panel's rectangle. While the agents hold it, a transparent overlay sits on top: a
// person's click lands there and becomes "take over" (CDP input goes straight to the page, under it).
import { randomBytes } from "node:crypto"
import { createServer } from "node:http"
import { BaseWindow, type BrowserWindow, ipcMain, type Rectangle, session, WebContentsView } from "electron"

const SIZE = { x: 0, y: 0, width: 1280, height: 800 } // a tab's size while no panel shows it
const MAX_TABS = 24 // ponytail: a fixed cap on live views (each is a renderer); per-agent idle discard if it bites
const ID = /^[0-9a-f-]{36}$/
const PROFILE = /^[a-z0-9-]{1,64}$/

export interface BrowserHost {
  readonly control: string
  readonly token: string
  readonly release: () => void // the app window is closing: its borrowed view goes back to the host
}

export async function startBrowserHost(appWindow: () => BrowserWindow | undefined): Promise<BrowserHost> {
  const host = new BaseWindow({ ...SIZE, show: false })
  const tabs = new Map<string, WebContentsView>()
  const overlay = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  overlay.setBackgroundColor("#00000000")
  overlay.webContents.on("before-mouse-event", (_e, input) => {
    if (input.type === "mouseDown" || input.type === "mouseWheel") appWindow()?.webContents.send("browser:take")
  })
  let shown: { view: WebContentsView; overlay: boolean } | undefined

  // Hardened once per partition: no camera, mic, location, notifications…; no downloads.
  const hardened = new Set<string>()
  const sessionFor = (partition: string) => {
    const s = session.fromPartition(partition)
    if (!hardened.has(partition)) {
      hardened.add(partition)
      s.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
      s.setPermissionCheckHandler(() => false)
      s.on("will-download", (e) => e.preventDefault())
    }
    return s
  }

  const open = (id: string, profile: string) => {
    const view = new WebContentsView({
      webPreferences: { session: sessionFor(`persist:agent-${profile}`), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
    })
    // Popups open in the same tab; only web addresses.
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) void view.webContents.loadURL(url)
      return { action: "deny" }
    })
    host.contentView.addChildView(view)
    view.setBounds(SIZE)
    tabs.set(id, view)
    void view.webContents.loadURL(`about:blank#zorel-tab-${id}`)
  }

  const close = (id: string) => {
    const view = tabs.get(id)
    if (!view) return
    tabs.delete(id)
    if (shown?.view === view) hide()
    view.webContents.close()
  }

  // Back to the host window, at the default size.
  const hide = () => {
    if (!shown) return
    host.contentView.addChildView(shown.view)
    shown.view.setBounds(SIZE)
    overlay.webContents.loadURL("about:blank")
    appWindow()?.contentView.removeChildView(overlay)
    shown = undefined
  }

  // The panel says what to show where (or null: nothing). Only the app window may ask.
  ipcMain.on("browser:show", (e, raw: unknown) => {
    const win = appWindow()
    if (!win || e.sender !== win.webContents) return
    const req = parseShow(raw)
    const view = req && tabs.get(req.tab)
    if (!req || !view) return hide()
    if (shown && shown.view !== view) hide()
    win.contentView.addChildView(view)
    view.setBounds(req.rect)
    if (req.overlay) {
      win.contentView.addChildView(overlay) // added last: on top
      overlay.setBounds(req.rect)
    } else win.contentView.removeChildView(overlay)
    shown = { view, overlay: req.overlay }
  })

  const token = randomBytes(24).toString("hex")
  const server = createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) return void res.writeHead(401).end()
    const del = /^\/tabs\/([^/]+)$/.exec(req.url ?? "")
    if (req.method === "DELETE" && del && ID.test(del[1]!)) {
      close(del[1]!)
      return void res.writeHead(204).end()
    }
    if (req.method !== "POST" || req.url !== "/tabs") return void res.writeHead(404).end()
    let body = ""
    req.on("data", (c: Buffer) => {
      body += c
      if (body.length > 1000) req.destroy()
    })
    req.on("end", () => {
      try {
        const { id, profile } = JSON.parse(body) as { id?: unknown; profile?: unknown }
        if (typeof id !== "string" || !ID.test(id) || typeof profile !== "string" || !PROFILE.test(profile)) return void res.writeHead(400).end("bad tab")
        if (tabs.size >= MAX_TABS) return void res.writeHead(429).end(`Too many open tabs (${MAX_TABS}). Close some with browser_tabs.`)
        open(id, profile)
        res.writeHead(201).end()
      } catch {
        res.writeHead(400).end("bad json")
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = (server.address() as { port: number }).port
  return { control: `http://127.0.0.1:${port}`, token, release: hide }
}

// {tab, rect:{x,y,width,height}, overlay} from the renderer, or undefined.
export function parseShow(raw: unknown): { tab: string; rect: Rectangle; overlay: boolean } | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const { tab, rect, overlay } = raw as Record<string, unknown>
  const r = rect as Record<string, unknown> | undefined
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 20_000 ? Math.round(v) : undefined)
  const x = n(r?.x)
  const y = n(r?.y)
  const width = n(r?.width)
  const height = n(r?.height)
  if (typeof tab !== "string" || x === undefined || y === undefined || !width || !height) return undefined
  return { tab, rect: { x, y, width, height }, overlay: overlay === true }
}
