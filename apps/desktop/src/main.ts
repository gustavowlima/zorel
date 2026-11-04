// Desktop app (ARCHITECTURE D11). Electron only owns the window; the Zero server runs as its own process: the
// compiled Bun binary when packaged, `bun apps/server/src/main.ts` in dev. Closing the window frees its renderer
// but keeps the app and the server alive, so turns and routines go on (Dock on macOS, tray elsewhere); Quit stops
// the server. One instance per user: opening the app again focuses the window.
import { type ChildProcess, execFile, spawn } from "node:child_process"
import { openSync, readFileSync } from "node:fs"
import { createServer } from "node:net"
import { join } from "node:path"
import { app, BrowserWindow, dialog, Menu, nativeImage, nativeTheme, shell, Tray } from "electron"
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
  const [cmd, args] = dev ? ["bun", [join(root, "apps/server/src/main.ts")]] : [join(root, "zero-server"), []]
  server = spawn(cmd, args, {
    env: {
      ...process.env,
      PORT: String(port),
      ZERO_PARENT_PID: String(process.pid), // the server exits if this process dies without stopping it
      ...(browser ? { ZERO_DESKTOP_CDP: await cdpUrl(), ZERO_DESKTOP_CONTROL: browser.control, ZERO_DESKTOP_TOKEN: browser.token } : {}),
      ZERO_WEB_DIR: dev ? join(root, "apps/web/dist") : join(root, "web"),
      ...(dev ? {} : { ZERO_MIGRATIONS: join(root, "drizzle") })
    },
    stdio: ["ignore", dev ? "inherit" : log, dev ? "inherit" : log]
  })
  server.once("exit", (code) => {
    if (quitting) return
    dialog.showErrorBox("Zero", `The Zero server stopped (code ${code}). See ${join(app.getPath("logs"), "server.log")}.`)
    app.quit()
  })
  url = `http://127.0.0.1:${port}`
  for (let i = 0; i < 200; i++) {
    if (await fetch(`${url}/`).then((r) => r.ok, () => false)) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error("The Zero server didn't start in 10 s.")
}

function openWindow() {
  if (win) return win.isMinimized() ? win.restore() : win.focus()
  win = new BrowserWindow({
    title: "Zero",
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 560,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0d0d0d" : "#ececec", // --z-bg-frame: no white flash
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 22, y: 18 },
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false, preload: join(appDir, "dist", "preload.cjs") }
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

// Off macOS there's no Dock to reopen a closed window: a tray icon does it (and quits).
function addTray() {
  if (process.platform === "darwin") return
  tray = new Tray(nativeImage.createFromPath(join(appDir, "assets", "icon.png")).resize({ width: 16, height: 16 }))
  tray.setToolTip("Zero")
  tray.setContextMenu(Menu.buildFromTemplate([{ label: "Open Zero", click: openWindow }, { type: "separator" }, { label: "Quit", role: "quit" }]))
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
      openWindow()
      addTray()
    })
    .catch((e: unknown) => {
      dialog.showErrorBox("Zero", e instanceof Error ? e.message : String(e))
      quitting = true
      server?.kill("SIGTERM")
      app.quit()
    })
}
