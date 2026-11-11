// Team servers in the desktop app (spec 014): besides "This computer" (the local server), Zorel servers of a team,
// each opened in a window of its own that loads that server's web app. Each server gets its own partition (cookies,
// storage: the sign-in stays per server) and a small bridge (switch servers, notification settings); nothing of this
// computer (folders, apps, the local secret) reaches it. The list and the last one opened live in servers.json.
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { app, BrowserWindow, type MenuItemConstructorOptions, nativeTheme, session, shell } from "electron"
import { serverFrom } from "./server-link.ts"

export type Server = { origin: string; name: string }
type Saved = { servers: Server[]; last?: string } // last: a server's origin, or "local"
export const LOCAL = "local"

const file = () => join(app.getPath("userData"), "servers.json")
export function readServers(): Saved {
  try {
    const s = JSON.parse(readFileSync(file(), "utf8")) as Saved
    return { servers: Array.isArray(s.servers) ? s.servers.filter((x) => typeof x?.origin === "string") : [], ...(typeof s.last === "string" && { last: s.last }) }
  } catch {
    return { servers: [] }
  }
}
const save = (s: Saved) => writeFileSync(file(), JSON.stringify(s, null, 2))
// Remembers what opened last ("local" or a server's origin): Zorel opens it again next time.
export const markOpened = (target: string) => save({ ...readServers(), last: target })

const windows = new Map<string, BrowserWindow>()
const partition = (origin: string) => `persist:server-${createHash("sha256").update(origin).digest("hex").slice(0, 16)}`
const ALLOWED = new Set(["notifications", "clipboard-sanitized-write", "fullscreen"])

// Opens (or focuses) a server's window; `page` is a page of it to show first (an invite).
export function openServer(origin: string, preload: string, page?: string) {
  const s = readServers()
  save({ ...s, last: origin })
  const shown = windows.get(origin)
  if (shown && !shown.isDestroyed()) {
    if (page) void shown.loadURL(withShell(page))
    return shown.isMinimized() ? shown.restore() : shown.focus()
  }
  const ses = session.fromPartition(partition(origin))
  ses.setPermissionRequestHandler((_wc, permission, done) => done(ALLOWED.has(permission)))
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED.has(permission))
  const w = new BrowserWindow({
    title: `Zorel · ${new URL(origin).host}`,
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 560,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0d0d0d" : "#ececec",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false, preload }
  })
  windows.set(origin, w)
  w.webContents.setVisualZoomLevelLimits(1, 1).catch(() => undefined)
  w.once("ready-to-show", () => w.show())
  w.on("closed", () => windows.delete(origin))
  // The server's own pages stay here; any other link opens in the default browser.
  const ours = (to: string) => URL.canParse(to) && new URL(to).origin === origin
  const external = (to: string) => {
    if (/^https?:\/\//.test(to)) void shell.openExternal(to)
  }
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (ours(url)) w.webContents.downloadURL(url)
    else external(url)
    return { action: "deny" }
  })
  w.webContents.on("will-navigate", (e, to) => {
    if (ours(to)) return
    e.preventDefault()
    external(to)
  })
  void w.loadURL(withShell(page ?? `${origin}/`))
}
const withShell = (page: string) => {
  const u = new URL(page)
  u.searchParams.set("shell", "desktop")
  return u.toString()
}

// Adds a server (from a pasted address or invite link) and opens it. Undefined when the text isn't a server's address.
export function addServer(text: string, preload: string): Server | undefined {
  const found = serverFrom(text)
  if (!found) return undefined
  const s = readServers()
  const server = s.servers.find((x) => x.origin === found.origin) ?? { origin: found.origin, name: new URL(found.origin).host }
  save({ servers: [...s.servers.filter((x) => x.origin !== found.origin), server], last: found.origin })
  openServer(found.origin, preload, found.open)
  return server
}

// Forgets a server: its window closes and its sign-in and storage are erased from this computer.
export async function forgetServer(origin: string) {
  const s = readServers()
  windows.get(origin)?.close()
  save({ servers: s.servers.filter((x) => x.origin !== origin), ...(s.last && s.last !== origin && { last: s.last }) })
  await session.fromPartition(partition(origin)).clearStorageData().catch(() => undefined)
}

// Whose window sent a message: a server's origin, or undefined (not a server window).
export const serverOf = (sender: Electron.WebContents) => [...windows].find(([, w]) => !w.isDestroyed() && w.webContents === sender)?.[0]

// The menu entries: this computer, each server, connecting with a copied link, forgetting the open one.
export function serverMenu(current: () => string | undefined, open: (target: string) => void, connectCopied: () => void, forget: (origin: string) => void): MenuItemConstructorOptions[] {
  const s = readServers()
  const now = current()
  return [
    { label: "This computer", type: "radio", checked: now === LOCAL, click: () => open(LOCAL) },
    ...s.servers.map((x): MenuItemConstructorOptions => ({ label: x.name, type: "radio", checked: now === x.origin, click: () => open(x.origin) })),
    { type: "separator" },
    { label: "Connect with the copied link", click: connectCopied },
    ...(now && now !== LOCAL ? [{ label: `Forget ${new URL(now).host}`, click: () => forget(now) }] : [])
  ]
}
