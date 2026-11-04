// Desktop app (ARCHITECTURE D11). Electron only owns the window; the Zorel server runs as its own process: the
// compiled Bun binary when packaged, `bun apps/server/src/main.ts` in dev. Closing the window frees its renderer
// but keeps the app and the server alive, so turns and routines go on (Dock on macOS, tray elsewhere); Quit stops
// the server. One instance per user: opening the app again focuses the window.
import { type ChildProcess, execFile, spawn } from "node:child_process"
import { openSync, readFileSync } from "node:fs"
import { createServer } from "node:net"
import { join } from "node:path"
import { app, BrowserWindow, dialog, ipcMain, Menu, type MenuItemConstructorOptions, nativeImage, nativeTheme, session, shell, Tray } from "electron"
import { autoUpdater } from "electron-updater"
import { type BrowserHost, startBrowserHost } from "./browser-host.ts"

const dev = !app.isPackaged
// app.getAppPath(): apps/desktop in dev, the app.asar when packaged (the bundler bakes __dirname at build time).
const appDir = app.getAppPath()
const root = dev ? join(appDir, "..", "..") : process.resourcesPath
let server: ChildProcess | undefined
let url = ""
let win: BrowserWindow | undefined
let tray: Tray | undefined
let quitting = false
let browser: BrowserHost | undefined
let update: { version: string; ready: boolean } | null = null // the newest release: downloading, then ready
const icon = () => nativeImage.createFromPath(join(appDir, "assets", "icon.png"))

// Fewer idle processes: no spare renderer kept warm, no media-key or cast services the app never uses.
app.commandLine.appendSwitch("disable-features", "SpareRendererForSitePerProcess,HardwareMediaKeyHandling,MediaRouter")
// CDP for the server to drive the agents' tabs: a free port on 127.0.0.1 only, read back from DevToolsActivePort.
app.commandLine.appendSwitch("remote-debugging-port", "0")

const cdpUrl = async () => {
  for (let i = 0; i < 100; i++) {
    try {
      const port = readFileSync(join(app.getPath("userData"), "DevToolsActivePort"), "utf8").split("\n")[0]?.trim()
      if (port) return `http://127.0.0.1:${port}`
    } catch {
      // not written yet
    }
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error("The browser debugging port didn't open.")
}

// Apps opened from Finder/Dock don't inherit the shell PATH; without it `claude`, `codex` and `opencode` aren't found.
const loginShellPath = () =>
  new Promise<void>((resolve) => {
    if (process.platform === "win32") return resolve()
    execFile(process.env.SHELL || "/bin/zsh", ["-ilc", 'printf "__PATH__%s" "$PATH"'], { timeout: 5000 }, (_e, out) => {
      const path = String(out ?? "").split("__PATH__").at(-1)?.trim()
      if (path) process.env.PATH = path
      resolve() // ponytail: no login shell → default PATH; providers then show "not installed"
    })
  })

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const probe = createServer().once("error", reject)
    probe.listen(0, "127.0.0.1", () => {
      const port = (probe.address() as { port: number }).port
      probe.close(() => resolve(port))
    })
  })

async function startServer() {
  const port = await freePort()
  const log = openSync(join(app.getPath("logs"), "server.log"), "a")
  const [cmd, args] = dev ? ["bun", [join(root, "apps/server/src/main.ts")]] : [join(root, process.platform === "win32" ? "zorel-server.exe" : "zorel-server"), []]
  server = spawn(cmd, args, {
    env: {
      ...process.env,
      PORT: String(port),
      ZOREL_PARENT_PID: String(process.pid), // the server exits if this process dies without stopping it
      ...(browser ? { ZOREL_DESKTOP_CDP: await cdpUrl(), ZOREL_DESKTOP_CONTROL: browser.control, ZOREL_DESKTOP_TOKEN: browser.token } : {}),
      ZOREL_WEB_DIR: dev ? join(root, "apps/web/dist") : join(root, "web"),
      ...(dev ? {} : { ZOREL_MIGRATIONS: join(root, "drizzle") })
    },
    stdio: ["ignore", dev ? "inherit" : log, dev ? "inherit" : log]
  })
  server.once("exit", (code) => {
    if (quitting) return
    dialog.showErrorBox("Zorel", `The Zorel server stopped (code ${code}). See ${join(app.getPath("logs"), "server.log")}.`)
    app.quit()
  })
  url = `http://127.0.0.1:${port}`
  for (let i = 0; i < 200; i++) {
    if (await fetch(`${url}/`).then((r) => r.ok, () => false)) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error("The Zorel server didn't start in 10 s.")
}

function openWindow() {
  if (win) return win.isMinimized() ? win.restore() : win.focus()
  win = new BrowserWindow({
    title: "Zorel",
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 560,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0d0d0d" : "#ececec", // --z-bg-frame: no white flash
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 }, // centered in the web app title bar (48px)
    ...(process.platform === "linux" && { icon: icon() }), // Windows takes the .exe's icon, macOS the bundle's
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false, preload: join(appDir, "dist", "preload.cjs") }
  })
  // An app, not a page: no pinch or Ctrl+wheel zoom.
  win.webContents.setVisualZoomLevelLimits(1, 1)
  // Right-click where the page has no menu of its own: Cut/Copy/Paste on text, nothing elsewhere (no Back, Reload or
  // Inspect). The page's own menus (rows, tabs) cancel the event, so they never reach this.
  win.webContents.on("context-menu", (_e, p) => {
    const items: MenuItemConstructorOptions[] = p.isEditable
      ? [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { type: "separator" }, { role: "selectAll" }]
      : p.selectionText.trim()
        ? [{ role: "copy" }]
        : []
    if (dev) items.push(...(items.length ? [{ type: "separator" } as const] : []), { label: "Inspect", click: () => win?.webContents.inspectElement(p.x, p.y) })
    if (items.length) Menu.buildFromTemplate(items).popup()
  })
  win.once("ready-to-show", () => win?.show())
  win.on("close", () => browser?.release())
  win.on("closed", () => {
    win = undefined
  })
  // The app's own pages stay in the window; every other link opens in the default browser.
  const external = (to: string) => {
    if (/^https?:\/\//.test(to)) void shell.openExternal(to)
  }
  win.webContents.setWindowOpenHandler(({ url: to }) => {
    external(to)
    return { action: "deny" }
  })
  win.webContents.on("will-navigate", (e, to) => {
    if (to.startsWith(url)) return
    e.preventDefault()
    external(to)
  })
  void win.loadURL(`${url}/?shell=desktop`)
}

// Open at login (Settings › General, desktop only): started that way, Zorel runs without a window (the server and
// its routines), until you open it from the Dock or the tray. Only the app window may ask.
const HIDDEN = "--hidden" // Windows passes it at login; macOS reports wasOpenedAtLogin
const openedAtLogin = () => process.argv.includes(HIDDEN) || (process.platform === "darwin" && app.getLoginItemSettings().wasOpenedAtLogin)
function loginItemIpc() {
  const fromApp = (e: Electron.IpcMainInvokeEvent) => !!win && e.sender === win.webContents
  ipcMain.handle("login:get", (e) => (fromApp(e) ? app.getLoginItemSettings().openAtLogin : false))
  ipcMain.handle("login:set", (e, on: unknown) => {
    if (!fromApp(e) || typeof on !== "boolean") return false
    app.setLoginItemSettings({ openAtLogin: on, ...(process.platform === "win32" && { args: [HIDDEN] }) })
    return app.getLoginItemSettings().openAtLogin
  })
}

// Updates (packaged builds; a release needs a signed app on macOS): checked at start and every 6 hours, downloaded
// in the background and installed when Zorel quits. Without a publish target in the build it stays quiet.
// The app window hears of it (a button in the rail's corner) and can ask to restart into it now.
function updates() {
  ipcMain.handle("update:get", (e) => (win && e.sender === win.webContents ? update : null))
  ipcMain.handle("update:install", (e) => {
    if (!win || e.sender !== win.webContents || !update?.ready) return false
    quitting = true
    server?.kill("SIGTERM")
    autoUpdater.quitAndInstall()
    return true
  })
  if (dev) return
  const tell = (next: typeof update) => {
    update = next
    win?.webContents.send("update", update)
  }
  autoUpdater.on("update-available", (i) => tell({ version: i.version, ready: false }))
  autoUpdater.on("update-downloaded", (i) => tell({ version: i.version, ready: true }))
  autoUpdater.autoInstallOnAppQuit = true
  const check = () => void autoUpdater.checkForUpdates().catch(() => undefined)
  check()
  setInterval(check, 6 * 60 * 60_000).unref()
}

// The menu bar of an app, not a browser's: no Reload, Back or Developer Tools in a release (dev keeps them). On
// macOS the app, Edit (its shortcuts: copy, paste, undo) and Window menus; Windows and Linux get no menu bar (the
// text shortcuts work without one).
function appMenu() {
  if (process.platform !== "darwin") return Menu.setApplicationMenu(dev ? Menu.buildFromTemplate([{ role: "viewMenu" }]) : null)
  const template: MenuItemConstructorOptions[] = [
    { role: "appMenu", submenu: [{ role: "about" }, { type: "separator" }, { role: "services" }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit" }] },
    { role: "editMenu" },
    { role: "windowMenu" }
  ]
  if (dev) template.push({ role: "viewMenu" })
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  app.setAboutPanelOptions({ applicationName: "Zorel", applicationVersion: app.getVersion(), website: "https://zorel.dev" })
}

// The page may show notifications and write to the clipboard; camera, microphone, location and the rest are refused.
function permissions() {
  const allowed = new Set(["notifications", "clipboard-sanitized-write", "clipboard-read", "fullscreen"])
  session.defaultSession.setPermissionRequestHandler((wc, permission, done) => done(wc === win?.webContents && allowed.has(permission)))
  session.defaultSession.setPermissionCheckHandler((wc, permission) => wc === win?.webContents && allowed.has(permission))
}

// Off macOS there's no Dock to reopen a closed window: a tray icon does it (and quits).
function addTray() {
  if (process.platform === "darwin") return
  tray = new Tray(icon().resize({ width: 16, height: 16 }))
  tray.setToolTip("Zorel")
  tray.setContextMenu(Menu.buildFromTemplate([{ label: "Open Zorel", click: openWindow }, { type: "separator" }, { label: "Quit", role: "quit" }]))
  tray.on("click", openWindow)
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on("second-instance", openWindow)
  app.on("activate", openWindow)
  app.on("window-all-closed", () => undefined) // stay running: the server keeps working with no window
  app.on("before-quit", () => {
    quitting = true
    server?.kill("SIGTERM")
  })
  void app
    .whenReady()
    .then(loginShellPath)
    .then(async () => {
      browser = await startBrowserHost(() => win)
    })
    .then(startServer)
    .then(() => {
      loginItemIpc()
      appMenu()
      permissions()
      if (dev) app.dock?.setIcon(icon()) // a packaged app shows the bundle's icon; dev would show Electron's
      if (!openedAtLogin()) openWindow()
      addTray()
      updates()
    })
    .catch((e: unknown) => {
      dialog.showErrorBox("Zorel", e instanceof Error ? e.message : String(e))
      quitting = true
      server?.kill("SIGTERM")
      app.quit()
    })
}
