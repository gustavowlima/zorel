import { expect, test } from "bun:test"
import { existsSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AGENT_DESKTOP_VERSION, archiveOf, checksumOf, desktopBin, desktopStatus, installDesktop, targetOf } from "./desktop.ts"
import { DesktopApps, desktopTools, itemize, pick, riskyClick, riskyKey } from "./desktop-apps.ts"
import type { Cli } from "./desktop.ts"

// A release server with this system's archive (a fake program and its helper) and a checksums.txt.
async function fakeRelease(tamper = false) {
  const exe = process.platform === "win32" ? "agent-desktop.exe" : "agent-desktop"
  const file = archiveOf(targetOf()!)
  const archive = await new Bun.Archive({ [exe]: "#!/bin/sh\necho '{\"ok\":true,\"data\":{}}'\n", "agent-desktop-helper": "helper" }, { compress: "gzip" }).bytes()
  const sum = new Bun.CryptoHasher("sha256").update(archive).digest("hex")
  const sums = `${tamper ? "0".repeat(64) : sum}  ${file}\n${"1".repeat(64)}  other.tar.gz\n`
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname
      if (path === `/v${AGENT_DESKTOP_VERSION}/${file}`) return new Response(archive)
      if (path === `/v${AGENT_DESKTOP_VERSION}/checksums.txt`) return new Response(sums)
      return new Response("not found", { status: 404 })
    }
  })
  return { url: `http://localhost:${server.port}`, stop: () => server.stop(true) }
}

test("agent-desktop installs from the release, checked against its checksum; a mismatch keeps nothing", async () => {
  expect(checksumOf(`${"a".repeat(64)}  x.tar.gz\n${"b".repeat(64)}  y.tar.gz`, "y.tar.gz")).toBe("b".repeat(64))
  expect(targetOf("darwin", "arm64")).toBe("aarch64-apple-darwin")
  expect(targetOf("win32", "x64")).toBe("x86_64-pc-windows-msvc")
  expect(targetOf("freebsd", "x64")).toBeUndefined()
  const data = mkdtempSync(join(tmpdir(), "zorel-ad-"))
  const bad = await fakeRelease(true)
  process.env.ZOREL_AGENT_DESKTOP_RELEASES = bad.url
  try {
    expect(await installDesktop(data)).toEqual({ ok: false, error: "The download didn't match the release's checksum, so it wasn't installed." })
    expect(desktopBin(data)).toBeUndefined()
  } finally {
    bad.stop()
  }
  const good = await fakeRelease()
  process.env.ZOREL_AGENT_DESKTOP_RELEASES = good.url
  try {
    expect(await installDesktop(data)).toEqual({ ok: true, version: AGENT_DESKTOP_VERSION })
    const bin = desktopBin(data)!
    expect(existsSync(join(bin, "..", "agent-desktop-helper"))).toBe(true) // the helper beside it
    const status = await desktopStatus(data, async () => ({ ok: true, data: { permissions: { accessibility: { state: "denied", suggestion: "Run agent-desktop permissions --guide." } } } }))
    expect(status).toMatchObject({ installed: true, version: AGENT_DESKTOP_VERSION, accessibility: "denied", suggestion: "Run agent-desktop permissions --guide." })
  } finally {
    good.stop()
    delete process.env.ZOREL_AGENT_DESKTOP_RELEASES
  }
})

const TREE = {
  role: "window",
  name: "Notes",
  children: [
    { role: "button", name: "New Note", ref_id: "@s1:e1" },
    { role: "row", ref_id: "@s1:e2", children: [{ role: "statictext", name: "Groceries" }] },
    { role: "textfield", name: "Search", value: "", ref_id: "@s1:e3" },
    { role: "button", name: "Delete", ref_id: "@s1:e4" },
    { role: "statictext", name: "3 notes" }
  ]
}

test("a window reads as a numbered list; a target is found by number or by text", () => {
  const { items, lines } = itemize(TREE)
  expect(lines).toEqual(['  #1 button "New Note"', '  #2 row "Groceries"', '  #3 textfield "Search"', '  #4 button "Delete"', '  text "3 notes"'])
  expect(pick("#2", items)).toMatchObject({ ref: "@s1:e2" })
  expect(pick("groceries", items)).toMatchObject({ ref: "@s1:e2" })
  expect(pick("#9", items)).toHaveProperty("error")
  expect(pick("e", items)).toHaveProperty("error") // several contain it: use the number
})

test("what commits asks first: sending, deleting, scheduling, a nameless click, Return and bulk-delete keys", () => {
  for (const n of ["Send", "Delete", "Pay now", "Enviar", "New Event", ""]) expect(riskyClick(n)).toBe(true)
  for (const n of ["New Note", "Groceries", "Search", "Bold"]) expect(riskyClick(n)).toBe(false)
  for (const k of ["return", "cmd+return", "cmd+shift+d", "cmd+backspace"]) expect(riskyKey(k)).toBe(true)
  for (const k of ["escape", "tab", "cmd+n", "shift+return"]) expect(riskyKey(k)).toBe(false)
})

test("an agent uses only the apps given to it, at their level; risky clicks wait for the person", async () => {
  const calls: string[][] = []
  const cli: Cli = async (args) => {
    calls.push([...args])
    if (args[0] === "snapshot") return { ok: true, data: { tree: TREE } }
    if (args[0] === "list-apps") return { ok: true, data: { apps: [{ name: "Notes" }] } }
    return { ok: true }
  }
  const asked: string[] = []
  const desktop = new DesktopApps(cli, "darwin", async () => true)
  const apps = [
    { name: "Notes", level: "use" as const },
    { name: "Calendar", level: "read" as const },
    { name: "Zorel", level: "use" as const }
  ]
  const c = { key: "chat:agent", apps, askAll: false, ask: async (s: string) => {
      asked.push(s)
      return false
    } }
  const text = (r: { content: unknown[] }) => (r.content[0] as { text: string }).text
  expect(desktopTools([]).length).toBe(0)
  expect(desktopTools([{ name: "Calendar", level: "read" }]).map((t) => t.name)).toEqual(["desktop_apps", "desktop_open", "desktop_read", "desktop_menu"])
  expect(desktopTools(apps).length).toBe(7)
  expect(text(await desktop.call(c, "desktop_apps", {}))).toContain("Notes: read and use · open")
  expect((await desktop.call(c, "desktop_read", { app: "Spotify" })).isError).toBe(true) // not given
  expect((await desktop.call(c, "desktop_read", { app: "Zorel" })).isError).toBe(true) // never itself
  expect(text(await desktop.call(c, "desktop_click", { app: "Calendar", target: "#1" }))).toContain("only read")
  expect(text(await desktop.call(c, "desktop_click", { app: "notes", target: "#1" }))).toContain("Read Notes first")
  expect(text(await desktop.call(c, "desktop_read", { app: "Notes" }))).toContain('#1 button "New Note"')
  await desktop.call(c, "desktop_click", { app: "Notes", target: "New Note" })
  expect(calls.some((a) => a[0] === "click" && a[1] === "@s1:e1")).toBe(true) // ordinary: no approval
  expect(asked).toEqual([])
  const declined = await desktop.call(c, "desktop_click", { app: "Notes", target: "Delete" })
  expect(asked).toEqual(['click "Delete" in Notes'])
  expect(declined.isError).toBe(true)
  expect(calls.some((a) => a[0] === "click" && a[1] === "@s1:e4")).toBe(false) // declined: never clicked
})
