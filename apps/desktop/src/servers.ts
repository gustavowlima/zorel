// Team servers in the desktop app (spec 014): besides "This computer" (the local server), Zorel servers of a team,
// each opened in a window of its own that loads that server's web app. Each server gets its own partition (cookies,
// storage: the sign-in stays per server) and a small bridge (switch servers, notification settings); nothing of this
// computer (folders, apps, the local secret) reaches it. The list and the last one opened live in servers.json.
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { app, BrowserWindow, type MenuItemConstructorOptions, nativeTheme, net, session, shell } from "electron"
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
// Spec 017: a server's window stays alive when you switch away (its page and notifications go on), hidden. The most
// recent MAX_ALIVE stay; one hidden longer than HIDDEN_FOR closes (memory: each is a renderer process) and reloads
// when you come back.
const MAX_ALIVE = 3
const HIDDEN_FOR = 30 * 60_000
const hiddenSince = new Map<string, number>()
const usedAt = new Map<string, number>()
const partition = (origin: string) => `persist:server-${createHash("sha256").update(origin).digest("hex").slice(0, 16)}`
const ALLOWED = new Set(["notifications", "clipboard-sanitized-write", "fullscreen"])

// Shows `next` where `from` was (same size and place), then hides `from`: switching servers reads as one window.
export function place(next: BrowserWindow, from: BrowserWindow | null | undefined) {
  if (from && from !== next && !from.isDestroyed() && from.isVisible()) {
    next.setBounds(from.getBounds())
    if (from.isMaximized()) next.maximize()
  }
  if (next.isMinimized()) next.restore()
  next.show()
  next.focus()
  if (from && from !== next && !from.isDestroyed()) from.hide()
}

// Opens (or shows) a server's window, in the place of `from` (the window it was chosen in); `page` is a page of it to
// show first (an invite).
export function openServer(origin: string, preload: string, page?: string, from?: BrowserWindow | null) {
  const s = readServers()
  save({ ...s, last: origin })
  usedAt.set(origin, Date.now())
  const shown = windows.get(origin)
  if (shown && !shown.isDestroyed()) {
    if (page) void shown.loadURL(withShell(page))
    return place(shown, from)
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
    ...(from && !from.isDestroyed() && { ...from.getBounds() }),
    webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false, preload }
  })
  windows.set(origin, w)
  w.webContents.setVisualZoomLevelLimits(1, 1).catch(() => undefined)
  w.once("ready-to-show", () => place(w, from))
  w.on("hide", () => hiddenSince.set(origin, Date.now()))
  w.on("show", () => hiddenSince.delete(origin))
  w.on("closed", () => {
    windows.delete(origin)
    hiddenSince.delete(origin)
  })
  // The server didn't answer: a small page of ours says so (never a blank window), with Try again.
  w.webContents.on("did-fail-load", (_e, code, _desc, url, mainFrame) => {
    if (!mainFrame || code === -3 || url.startsWith("data:")) return // -3: aborted (a newer navigation)
    void w.loadURL(offlinePage(origin, readServers().servers.find((x) => x.origin === origin)?.name ?? new URL(origin).host))
  })
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
// Hidden server windows past their time, or beyond the most recent MAX_ALIVE, close (they reload when chosen again).
export function trimServers(now = Date.now()) {
  const hidden = [...windows].filter(([, w]) => !w.isDestroyed() && !w.isVisible())
  const alive = [...windows].filter(([, w]) => !w.isDestroyed()).sort(([a], [b]) => (usedAt.get(b) ?? 0) - (usedAt.get(a) ?? 0))
  const keep = new Set(alive.slice(0, MAX_ALIVE).map(([o]) => o))
  for (const [origin, w] of hidden) if (!keep.has(origin) || now - (hiddenSince.get(origin) ?? now) > HIDDEN_FOR) w.close()
}

// Whether each server answers now (spec 017): asked when the picker opens, not on a timer (an open window already
// knows through its own connection). `/api/server` needs no sign-in and says it's a Zorel server.
export type ServerState = { state: "online" | "offline"; seenAt: number | null }
const seen = new Map<string, number>()
export async function checkServers(): Promise<Record<string, ServerState>> {
  const out: Record<string, ServerState> = {}
  await Promise.all(
    readServers().servers.map(async ({ origin }) => {
      const ok = await net
        .fetch(`${origin}/api/server`, { signal: AbortSignal.timeout(5000) })
        .then(async (r) => r.ok && (await r.json().catch(() => null))?.mode === "server")
        .catch(() => false)
      if (ok) seen.set(origin, Date.now())
      out[origin] = { state: ok ? "online" : "offline", seenAt: seen.get(origin) ?? null }
    })
  )
  return out
}

// The page shown when a server doesn't answer, in the system's language (main has no catalog: two strings).
const OFFLINE = {
  en: { title: "isn't answering", hint: "Check that it's running and that this computer can reach it.", retry: "Try again" },
  pt: { title: "não está respondendo", hint: "Confira se ele está ligado e se este computador consegue alcançá-lo.", retry: "Tentar de novo" }
} as const
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)
function offlinePage(origin: string, name: string) {
  const t = OFFLINE[app.getLocale().toLowerCase().startsWith("pt") ? "pt" : "en"]
  const dark = nativeTheme.shouldUseDarkColors
  const html = `<!doctype html><meta charset="utf-8"><title>${escapeHtml(name)}</title><body style="margin:0;height:100vh;display:grid;place-items:center;font:15px -apple-system,system-ui,sans-serif;background:${dark ? "#0d0d0d" : "#ececec"};color:${dark ? "#e8e8e8" : "#1a1a1a"}"><div style="text-align:center;max-width:420px;padding:24px"><p style="font-size:18px;font-weight:600;margin:0 0 8px">${escapeHtml(name)} ${t.title}</p><p style="opacity:.7;margin:0 0 20px">${t.hint}</p><a href="${escapeHtml(withShell(`${origin}/`))}" style="display:inline-block;padding:8px 16px;border-radius:999px;background:#2f6bff;color:#fff;text-decoration:none">${t.retry}</a></div></body>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
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
  // ⌘1 is this computer, ⌘2… the servers in their order (spec 017).
  const key = (i: number) => (i < 9 ? { accelerator: `CmdOrCtrl+${i + 1}` } : {})
  return [
    { label: "This computer", type: "radio", checked: now === LOCAL, click: () => open(LOCAL), ...key(0) },
    ...s.servers.map((x, i): MenuItemConstructorOptions => ({ label: x.name, type: "radio", checked: now === x.origin, click: () => open(x.origin), ...key(i + 1) })),
    { type: "separator" },
    { label: "Connect with the copied link", click: connectCopied },
    ...(now && now !== LOCAL ? [{ label: `Forget ${new URL(now).host}`, click: () => forget(now) }] : [])
  ]
}
