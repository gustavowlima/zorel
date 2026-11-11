// Desktop app (ARCHITECTURE D11). Electron only owns the window; the Zorel server runs as its own process: the
// compiled Bun binary when packaged, `bun apps/server/src/main.ts` in dev. Closing the window frees its renderer
// but keeps the app and the server alive, so turns and routines go on (Dock on macOS, tray elsewhere); Quit stops
// the server. One instance per user: opening the app again focuses the window.
import { type ChildProcess, execFile, spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { existsSync, openSync, readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { isAbsolute, join } from "node:path"
import { app, BrowserWindow, dialog, ipcMain, Menu, type MenuItemConstructorOptions, nativeImage, nativeTheme, powerMonitor, powerSaveBlocker, session, shell, Tray } from "electron"
import { SESSION_BYTES, SESSION_HEADER, SESSION_STDIN_ENV } from "@zorel/contracts/session"
import { autoUpdater } from "electron-updater"

const dev = !app.isPackaged
// app.getAppPath(): apps/desktop in dev, the app.asar when packaged (the bundler bakes __dirname at build time).
const appDir = app.getAppPath()
const root = dev ? join(appDir, "..", "..") : process.resourcesPath
let server: ChildProcess | undefined
let url = ""
// In development (electron-vite dev) the window loads the interface from Vite (instant updates); its proxy reaches the
// server on a fixed port. Packaged, the server serves the interface itself on a free port.
const rendererUrl = dev ? process.env.ELECTRON_RENDERER_URL : undefined
const DEV_PORT = Number(process.env.ZOREL_DEV_PORT ?? 4317) // the port apps/web's Vite proxy points at (desktop:dev sets 4327)
const pageUrl = () => rendererUrl ?? url
// The server's per-launch secret: only this process and the server know it. Every request the app window makes to the
// server gets it as a header (auth()), so the page never holds it and nothing the server spawns inherits it.
const secret = randomBytes(SESSION_BYTES).toString("hex")
let win: BrowserWindow | undefined
let tray: Tray | undefined
let quitting = false
// Quitting asks first (agents and routines stop), unless the person said not to, an update or the system is closing
// the app, or it is quitting on an error. One question at a time, however many times Quit is pressed.
let confirmQuit = !rendererUrl // under electron-vite dev a restart is a quit: no question in its way
let asking = false
// The newest release: downloading (percent), then ready; installing once Restart was pressed (it can't be pressed
// again), and why an install failed (the button comes back to try again).
let update: { version: string; ready: boolean; percent?: number; installing?: boolean; error?: string } | null = null
const icon = () => nativeImage.createFromPath(join(appDir, "assets", "icon.png"))

// Fewer idle processes: no spare renderer kept warm, no media-key or cast services the app never uses.
app.commandLine.appendSwitch("disable-features", "SpareRendererForSitePerProcess,HardwareMediaKeyHandling,MediaRouter")
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

const READY_EVERY_MS = 100
const READY_TRIES = 1200 // 2 minutes: room for the keychain prompt on a new build's first launch
// The development port, once the last run's server let it go (electron-vite restarts the app on a main-process change;
// the old server may still be closing). Up to 10 seconds, then it tries anyway.
const portFree = (port: number) =>
  new Promise<boolean>((resolve) => {
    const probe = createServer().once("error", () => resolve(false))
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)))
  })
async function devPort() {
  for (let i = 0; i < 100 && !(await portFree(DEV_PORT)); i++) await new Promise((r) => setTimeout(r, 100))
  return DEV_PORT
}
const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const probe = createServer().once("error", reject)
    probe.listen(0, "127.0.0.1", () => {
      const port = (probe.address() as { port: number }).port
      probe.close(() => resolve(port))
    })
  })

async function startServer() {
  const port = rendererUrl ? await devPort() : await freePort()
  const log = openSync(join(app.getPath("logs"), "server.log"), "a")
  const [cmd, args] = dev ? ["bun", [join(root, "apps/server/src/main.ts")]] : [join(root, process.platform === "win32" ? "zorel-server.exe" : "zorel-server"), []]
  server = spawn(cmd, args, {
    env: {
      ...process.env,
      PORT: String(port),
      [SESSION_STDIN_ENV]: "1", // the secret comes on stdin, never in the environment (readable by any process of this user)
      ZOREL_PARENT_PID: String(process.pid), // the server exits if this process dies without stopping it
      ZOREL_WEB_DIR: dev ? join(root, "apps/web/dist") : join(root, "web"),
      ...(dev ? {} : { ZOREL_MIGRATIONS: join(root, "drizzle"), PLAYWRIGHT_BROWSERS_PATH: join(root, "browsers"), ZOREL_PLAYWRIGHT: join(root, "playwright-core"), ZOREL_ONNX: join(root, "onnxruntime-node", "dist", "index.cjs") }) // the bundled Chromium; the local model's runtime
    },
    stdio: ["pipe", dev ? "inherit" : log, dev ? "inherit" : log]
  })
  server.stdin?.end(`${secret}\n`)
  server.once("exit", (code) => {
    if (quitting) return
    dialog.showErrorBox("Zorel", `The Zorel server stopped (code ${code}). See ${join(app.getPath("logs"), "server.log")}.`)
    confirmQuit = false // already told why: no second question
    app.quit()
  })
  url = `http://127.0.0.1:${port}`
  // Ready once its routes answer: it listens before its services are up, and reading the keychain at start can wait
  // on macOS's password prompt (the first launch of a new build), so until then every path is a 404. Up to 2 minutes.
  const ready = (r: Response) => r.status !== 404 // the page answers 401 without the secret: that's ready too
  for (let i = 0; i < READY_TRIES; i++) {
    if (await fetch(`${url}/`).then(ready, () => false)) return
    await new Promise((r) => setTimeout(r, READY_EVERY_MS))
  }
  throw new Error("The Zorel server didn't start in 2 minutes.")
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
  win.webContents.setVisualZoomLevelLimits(1, 1).catch(() => undefined) // the page may reload first (Vite, in development)
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
  win.on("closed", () => {
    win = undefined
  })
  // The app's own pages stay in the window; every other link opens in the default browser. Compared by origin, not
  // by prefix: "http://127.0.0.1:<port>@elsewhere/" starts like the app's address but is another site. A link to
  // the app's own files (an attachment) downloads here, where the request carries the secret.
  const ours = (to: string) => URL.canParse(to) && new URL(to).origin === new URL(pageUrl()).origin
  const external = (to: string) => {
    if (/^https?:\/\//.test(to)) void shell.openExternal(to)
  }
  win.webContents.setWindowOpenHandler(({ url: to }) => {
    if (ours(to)) win?.webContents.downloadURL(to)
    else external(to)
    return { action: "deny" }
  })
  win.webContents.on("will-navigate", (e, to) => {
    if (ours(to)) return
    e.preventDefault()
    external(to)
  })
  void win.loadURL(`${pageUrl()}/?shell=desktop`)
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

// Updates (packaged builds): checked at start and every 6 hours. The app window hears of a new version (a button in
// the rail's corner) and can restart into it now; otherwise it installs when Zorel quits.
// macOS without a Developer ID (ad hoc build, scripts/adhoc-sign.cjs): the built-in updater can't install there (it
// checks the new app is signed by the same Developer ID), so the button runs the release's install.sh, which closes
// Zorel, swaps the app and opens it again. Windows and Linux update by themselves, signed or not.
function updates() {
  let manual = false
  const tell = (next: typeof update) => {
    update = next
    win?.webContents.send("update", update)
  }
  ipcMain.handle("update:get", (e) => (win && e.sender === win.webContents ? update : null))
  // "Check for updates" (Settings › General › About): now, not at the next 6-hour check. A new version then shows
  // as usual (the card under the chats).
  ipcMain.handle("update:check", async (e) => {
    if (!win || e.sender !== win.webContents) return "failed"
    if (dev) return "unsupported" // an unpackaged app can't update itself
    const r = await autoUpdater.checkForUpdates().catch((err: unknown) => {
      console.error("update check failed", err)
      return null
    })
    return !r ? "failed" : r.isUpdateAvailable ? "available" : "latest"
  })
  ipcMain.handle("update:install", (e) => {
    if (!win || e.sender !== win.webContents || !update?.ready || update.installing) return false
    tell({ version: update.version, ready: true, installing: true })
    // The installer (or the updater) closes Zorel to swap it: no question in its way.
    // ponytail: stays off for this run if the install then fails; reset it from the installer's exit if that matters.
    confirmQuit = false
    if (manual) return runInstaller((error) => update && tell({ version: update.version, ready: true, error }))
    quitting = true
    server?.kill("SIGTERM")
    autoUpdater.quitAndInstall()
    return true
  })
  if (dev) return
  autoUpdater.on("update-available", (i) => tell({ version: i.version, ready: manual }))
  // Progress in whole percents: one message per step, not per chunk.
  autoUpdater.on("download-progress", (p) => {
    const percent = Math.floor(p.percent)
    if (update && !update.ready && update.percent !== percent) tell({ ...update, percent })
  })
  autoUpdater.on("update-downloaded", (i) => tell({ version: i.version, ready: true }))
  autoUpdater.on("error", (e) => {
    console.error("update failed", e) // the button goes away rather than wait forever
    tell(null)
  })
  autoUpdater.autoInstallOnAppQuit = true
  const check = () => void autoUpdater.checkForUpdates().catch(() => undefined)
  void developerId().then((signed) => {
    manual = process.platform === "darwin" && !signed
    autoUpdater.autoDownload = !manual
    check()
    setInterval(check, 6 * 60 * 60_000).unref()
  })
}

// Whether this macOS app carries a Developer ID signature (codesign names the authority).
const developerId = () =>
  new Promise<boolean>((resolve) => {
    if (process.platform !== "darwin") return resolve(true)
    execFile("codesign", ["-dv", "--verbose=2", join(process.execPath, "..", "..", "..")], (_e, out, err) => resolve(/Authority=Developer ID Application/.test(`${out}${err}`)))
  })

// "Quit Zorel?": Quit, or Cancel to keep it running; "Don't ask again" is kept on this computer. Asked in Zorel's own
// dialog (the window, shown if hidden); the native one only when the page doesn't take the question in time (it
// isn't loaded, or there's no window).
const NO_ASK = () => join(app.getPath("userData"), "quit-without-asking")
const askedNotTo = () => existsSync(NO_ASK())
type QuitAnswer = { quit: boolean; dontAsk: boolean }
let answerQuit: ((a: QuitAnswer) => void) | undefined
const PAGE_ASK_MS = 1500 // how long the page has to show its dialog before the native one stands in

function askInPage(): Promise<QuitAnswer | undefined> {
  const w = win
  if (!w || w.isDestroyed()) return Promise.resolve(undefined)
  w.show()
  w.focus()
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      ipcMain.removeAllListeners("quit:shown")
      answerQuit = undefined
      resolve(undefined)
    }, PAGE_ASK_MS)
    ipcMain.once("quit:shown", (e) => {
      if (e.sender === w.webContents) clearTimeout(timer)
    })
    answerQuit = (a) => {
      clearTimeout(timer)
      answerQuit = undefined
      resolve(a)
    }
    w.webContents.send("quit:ask")
  })
}

async function askNatively(): Promise<QuitAnswer> {
  const options = {
    type: "question" as const,
    message: "Quit Zorel?",
    detail: "Agents stop working and routines don't run until you open Zorel again. Closing the window keeps them running.",
    buttons: ["Quit", "Cancel"],
    defaultId: 0,
    cancelId: 1,
    checkboxLabel: "Don't ask again"
  }
  const shown = win && !win.isDestroyed() && win.isVisible() ? win : undefined
  const { response, checkboxChecked } = await (shown ? dialog.showMessageBox(shown, options) : dialog.showMessageBox(options))
  return { quit: response === 0, dontAsk: checkboxChecked }
}

async function askToQuit() {
  if (asking) return
  asking = true
  const answer = (await askInPage()) ?? (await askNatively())
  asking = false
  if (!answer.quit) return
  if (answer.dontAsk) writeFileSync(NO_ASK(), "")
  confirmQuit = false
  app.quit()
}

// The release's install.sh, in its own process group so it outlives Zorel (it quits the app, then reopens it). The
// repository comes from the build's update settings (app-update.yml, written by electron-builder).
// `failed`: the installer ended without replacing Zorel (it's still running), with its last line as the reason.
function runInstaller(failed: (reason: string) => void) {
  const config = (() => {
    try {
      return readFileSync(join(process.resourcesPath, "app-update.yml"), "utf8")
    } catch {
      return ""
    }
  })()
  const field = (k: string) => new RegExp(`^${k}: *(\\S+)`, "m").exec(config)?.[1]
  const owner = field("owner")
  const repo = field("repo")
  if (!owner || !repo) {
    failed("No update settings in this build.")
    return false
  }
  const script = `https://github.com/${owner}/${repo}/releases/latest/download/install.sh`
  const logPath = join(app.getPath("logs"), "update.log")
  const log = openSync(logPath, "a")
  const child = spawn("/bin/sh", ["-c", `curl -fsSL "${script}" | ZOREL_REPO="${owner}/${repo}" sh`], { detached: true, stdio: ["ignore", log, log] })
  child.on("exit", (code) => {
    if (code === 0) return
    const last = readFileSync(logPath, "utf8").trim().split(/[\r\n]+/).filter((l) => /\w/.test(l) && !/%\s*$/.test(l)).at(-1)
    failed(last?.replace(/^\W+/, "").slice(0, 200) || "The update didn't install.")
  })
  child.unref()
  return true
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

// The page may show notifications and write to the clipboard (Copy buttons); reading it, the camera, microphone,
// location and the rest are refused: nothing in the app needs them.
function permissions() {
  const allowed = new Set(["notifications", "clipboard-sanitized-write", "fullscreen"])
  session.defaultSession.setPermissionRequestHandler((wc, permission, done) => done(wc === win?.webContents && allowed.has(permission)))
  session.defaultSession.setPermissionCheckHandler((wc, permission) => wc === win?.webContents && allowed.has(permission))
}

// The server's secret on every request to it from the app's own session (the agents' tabs live in other partitions).
function auth() {
  // The server, and in development Vite too (its proxy passes the header on to the server).
  const hosts = new Set([new URL(url).host, ...(rendererUrl ? [new URL(rendererUrl).host] : [])])
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ["http://127.0.0.1/*", "ws://127.0.0.1/*"] }, (d, done) =>
    done({ requestHeaders: URL.canParse(d.url) && hosts.has(new URL(d.url).host) ? { ...d.requestHeaders, [SESSION_HEADER]: secret } : d.requestHeaders })
  )
}

// Where the system's own notification switch for Zorel lives (Settings › General › Notifications links there).
const NOTIFICATION_SETTINGS: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "x-apple.systempreferences:com.apple.Notifications-Settings.extension",
  win32: "ms-settings:notifications"
}

// Preferences of this app that live outside the page (the main process acts on them before any window opens).
const prefsFile = () => join(app.getPath("userData"), "desktop.json")
const readPrefs = (): { keepAwake?: boolean } => {
  try {
    return JSON.parse(readFileSync(prefsFile(), "utf8"))
  } catch {
    return {}
  }
}

// "Keep this computer awake" (Settings › General): while on power, the computer doesn't sleep when idle, so routines
// run on time; the display can still turn off, and closing the lid still sleeps. On battery it sleeps as usual.
let awake: number | undefined
function keepAwake() {
  const want = !!readPrefs().keepAwake && !powerMonitor.isOnBatteryPower()
  if (want && awake === undefined) awake = powerSaveBlocker.start("prevent-app-suspension")
  if (!want && awake !== undefined) {
    powerSaveBlocker.stop(awake)
    awake = undefined
  }
}

function systemIpc() {
  const fromApp = (e: Electron.IpcMainInvokeEvent) => !!win && e.sender === win.webContents
  ipcMain.handle("notifications:settings", (e) => {
    const target = NOTIFICATION_SETTINGS[process.platform]
    if (!fromApp(e) || !target) return false
    void shell.openExternal(target)
    return true
  })
  // The apps' own icons for the apps picker, drawn by the system from each app's path. Only paths that are apps (a
  // bundle, a shortcut, a program) or icon files from an icon folder: a page can't use this to see other files.
  const icons = new Map<string, string>()
  ipcMain.handle("apps:icons", async (e, paths: unknown) => {
    if (!fromApp(e) || !Array.isArray(paths)) return {}
    const asked = paths.filter((p): p is string => typeof p === "string" && isAppPath(p)).slice(0, 400)
    const out: Record<string, string> = {}
    for (const p of asked) {
      if (!icons.has(p)) icons.set(p, await appIcon(p))
      const icon = icons.get(p)
      if (icon) out[p] = icon
    }
    return out
  })
  ipcMain.handle("quit:answer", (e, a: unknown) => {
    if (!fromApp(e) || !a || typeof a !== "object") return
    const { quit, dontAsk } = a as Record<string, unknown>
    answerQuit?.({ quit: quit === true, dontAsk: dontAsk === true })
  })
  ipcMain.handle("awake:get", (e) => (fromApp(e) ? !!readPrefs().keepAwake : false))
  ipcMain.handle("awake:set", (e, on: unknown) => {
    if (!fromApp(e) || typeof on !== "boolean") return false
    writeFileSync(prefsFile(), JSON.stringify({ ...readPrefs(), keepAwake: on }))
    keepAwake()
    return on
  })
  // The system's folder picker, for a project's folder: the chosen absolute path, or null when cancelled.
  ipcMain.handle("folder:pick", async (e, start: unknown) => {
    if (!fromApp(e) || !win) return null
    const r = await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"], ...(typeof start === "string" && { defaultPath: start }) })
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })
  powerMonitor.on("on-ac", keepAwake)
  powerMonitor.on("on-battery", keepAwake)
  keepAwake()
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
  app.on("before-quit", (e) => {
    if (!quitting && confirmQuit && !askedNotTo()) {
      e.preventDefault()
      void askToQuit()
      return
    }
    quitting = true
    server?.kill("SIGTERM")
  })
  // Logging out or shutting down: the system is closing every app, nothing to ask.
  powerMonitor.on("shutdown", () => {
    confirmQuit = false
  })
  // Told to stop by a signal (a terminal's Ctrl+C, the system, electron-vite restarting the app): no question.
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.on(signal, () => {
      confirmQuit = false
      app.quit()
    })
  void app
    .whenReady()
    .then(loginShellPath)
    .then(startServer)
    .then(() => {
      auth()
      loginItemIpc()
      systemIpc()
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

// An app's path, by kind: a macOS bundle, a Windows shortcut or program, or an icon file inside an icon folder (Linux).
const isAppPath = (p: string) => isAbsolute(p) && (/\.app$/i.test(p) || /\.(lnk|exe)$/i.test(p) || (/[\\/](icons|pixmaps)[\\/]/.test(p) && /\.(png|svg)$/i.test(p)))
// The icon as a data URL: an icon file as it is (small), else the system's thumbnail of the app (its real icon on
// macOS and Windows), else its file icon; "" when there's none.
async function appIcon(p: string): Promise<string> {
  if (/\.(png|svg)$/i.test(p)) {
    try {
      const data = readFileSync(p)
      if (data.length > 512 * 1024) return ""
      return `data:${p.toLowerCase().endsWith(".svg") ? "image/svg+xml" : "image/png"};base64,${data.toString("base64")}`
    } catch {
      return ""
    }
  }
  const thumb = await nativeImage.createThumbnailFromPath(p, { width: 64, height: 64 }).catch(() => undefined) // macOS and Windows only
  if (thumb && !thumb.isEmpty()) return thumb.toDataURL()
  return app.getFileIcon(p, { size: "normal" }).then((i) => i.toDataURL(), () => "")
}
