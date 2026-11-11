// What the person pasted to connect the desktop app to a team server (servers.ts), checked without Electron.
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"])
// A server's address from what the person pasted (its address, or an invite link to it): HTTPS, or HTTP on this
// machine only (as the server itself requires). Undefined when it isn't one.
export function serverFrom(text: string): { origin: string; open: string } | undefined {
  const raw = text.trim()
  if (!URL.canParse(raw)) return undefined
  const u = new URL(raw)
  if (u.protocol !== "https:" && !(u.protocol === "http:" && LOOPBACK.has(u.hostname))) return undefined
  if (u.username || u.password) return undefined
  // An invite link opens its page (to join), the first owner's setup link its page with the one-time code; anything
  // else, the app.
  const open = u.pathname.startsWith("/invite/") ? `${u.origin}${u.pathname}` : u.pathname === "/setup" ? `${u.origin}/setup${u.search}` : `${u.origin}/`
  return { origin: u.origin, open }
}
